// MVP E2EE helpers (browser-global, no build tools).
// This first pass stores private key material in localStorage for simplicity.
// Tradeoff: localStorage is convenient for MVP but not the strongest key storage model.

const E2EE_STORAGE_PREFIX = 'studymesh.e2ee.userkey';
const E2EE_KEY_VERSION = 1;
const E2EE_MESSAGE_ENCRYPTION_VERSION = 'aes-gcm-v1';
const E2EE_ENVELOPE_ALGORITHM = 'rsa-oaep-v1';
const E2EE_DECRYPT_FAIL_PLACEHOLDER = 'Unable to decrypt message';
const rawGroupKeyByCryptoKey = new WeakMap();

function e2eeUserStorageKey(userId) {
  return `${E2EE_STORAGE_PREFIX}.${userId}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  arr.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function textToBytes(text) {
  return new TextEncoder().encode(String(text || ''));
}

function bytesToText(bytes) {
  return new TextDecoder().decode(bytes);
}

async function importUserPublicKeyFromRecord(publicKeyRecord) {
  if (!publicKeyRecord) return null;

  const rawPublicKey = publicKeyRecord.public_key || publicKeyRecord.publicKey || publicKeyRecord.key;
  if (!rawPublicKey) return null;

  const jwk = typeof rawPublicKey === 'string' ? JSON.parse(rawPublicKey) : rawPublicKey;
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256'
    },
    true,
    ['encrypt']
  );
}

async function loadLocalPrivateKey(userId) {
  if (!userId) return null;

  if (state.userKeypair?.userId === userId?.toString() && state.userKeypair.privateKey) {
    return state.userKeypair.privateKey;
  }

  const storedRaw = localStorage.getItem(e2eeUserStorageKey(userId));
  if (!storedRaw) return null;

  try {
    const stored = JSON.parse(storedRaw);
    if (!stored?.privateJwk || !stored?.publicJwk) return null;

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      stored.privateJwk,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256'
      },
      true,
      ['decrypt']
    );

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      stored.publicJwk,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256'
      },
      true,
      ['encrypt']
    );

    state.userKeypair = {
      userId: String(userId),
      privateKey,
      publicKey,
      publicJwk: stored.publicJwk
    };
    state.userKeypairReady = true;

    return privateKey;
  } catch (error) {
    console.error('loadLocalPrivateKey failed', error);
    return null;
  }
}

async function upsertUserPublicKey(userId, publicKeyJwk) {
  if (!userId || !publicKeyJwk) return;
  await upsertMemberPublicKey(userId, publicKeyJwk);
}

async function ensureLocalUserKeypair(userId = state.currentUser?.id) {
  if (!userId) return null;

  const existingPrivateKey = await loadLocalPrivateKey(userId);
  if (existingPrivateKey && state.userKeypair?.publicJwk) {
    await upsertUserPublicKey(userId, state.userKeypair.publicJwk);
    return state.userKeypair;
  }

  const generated = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['encrypt', 'decrypt']
  );

  const publicJwk = await crypto.subtle.exportKey('jwk', generated.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', generated.privateKey);

  localStorage.setItem(e2eeUserStorageKey(userId), JSON.stringify({
    version: 1,
    algorithm: 'RSA-OAEP-256',
    publicJwk,
    privateJwk,
    createdAt: new Date().toISOString()
  }));

  state.userKeypair = {
    userId: String(userId),
    privateKey: generated.privateKey,
    publicKey: generated.publicKey,
    publicJwk
  };
  state.userKeypairReady = true;

  await upsertUserPublicKey(userId, publicJwk);
  return state.userKeypair;
}

async function importGroupContentKey(rawKeyBytes) {
  return await crypto.subtle.importKey(
    'raw',
    rawKeyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function decryptGroupKeyEnvelope(envelopeRecord, privateKey) {
  if (!envelopeRecord || !privateKey) return null;
  const encryptedGroupKey =
    envelopeRecord.encrypted_group_key ||
    envelopeRecord.encrypted_key ||
    envelopeRecord.ciphertext;
  if (!encryptedGroupKey) return null;

  const decryptedRaw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToBytes(encryptedGroupKey)
  );
  const rawGroupKey = new Uint8Array(decryptedRaw);
  const groupKey = await importGroupContentKey(rawGroupKey);
  rawGroupKeyByCryptoKey.set(groupKey, rawGroupKey);
  return groupKey;
}

async function getRawGroupContentKey(groupKey) {
  if (!groupKey) return null;

  const cachedRaw = rawGroupKeyByCryptoKey.get(groupKey);
  if (cachedRaw) return cachedRaw;

  try {
    const exportedRaw = new Uint8Array(await crypto.subtle.exportKey('raw', groupKey));
    rawGroupKeyByCryptoKey.set(groupKey, exportedRaw);
    return exportedRaw;
  } catch (error) {
    console.warn('[e2ee:envelope-backfill] group key is not exportable and no cached raw key is available');
    return null;
  }
}

async function bootstrapGroupKeyEnvelopes(groupId, memberIds) {
  if (!groupId || !memberIds || memberIds.length === 0) {
    throw new Error('Cannot bootstrap group key without group and members');
  }

  const groupKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const rawGroupKey = new Uint8Array(await crypto.subtle.exportKey('raw', groupKey));
  rawGroupKeyByCryptoKey.set(groupKey, rawGroupKey);

  const publicKeyRows = await getMemberPublicKeys(memberIds);
  const publicKeyByUserId = new Map((publicKeyRows || []).map(row => [row.user_id, row]));

  const envelopeRows = [];
  for (const memberId of memberIds) {
    const keyRow = publicKeyByUserId.get(memberId);
    if (!keyRow) {
      console.warn('Skipping envelope creation; member has no public key yet', { groupId, memberId });
      continue;
    }

    const memberPublicKey = await importUserPublicKeyFromRecord(keyRow);
    const wrappedKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      memberPublicKey,
      rawGroupKey
    );

    envelopeRows.push({
      group_id: groupId,
      user_id: memberId,
      key_version: E2EE_KEY_VERSION,
      algorithm: E2EE_ENVELOPE_ALGORITHM,
      encrypted_group_key: bytesToBase64(wrappedKey)
    });
  }

  if (envelopeRows.length === 0) {
    throw new Error('No member public keys available to bootstrap group envelopes');
  }

  await upsertGroupKeyEnvelopes(envelopeRows);
  return groupKey;
}

async function getGroupEnvelopeState(groupId, keyVersion = E2EE_KEY_VERSION) {
  if (!groupId) {
    return {
      groupId: null,
      keyVersion,
      memberIds: [],
      membersWithPublicKeys: [],
      membersMissingPublicKeys: [],
      membersWithEnvelopes: [],
      membersMissingEnvelope: [],
      hasAnyEnvelope: false,
      envelopeCount: 0
    };
  }

  const [dbMemberIds, hydratedMemberIds] = await Promise.all([
    getGroupMemberUserIds(groupId),
    Promise.resolve(state.currentGroup?.id === groupId
      ? state.members.map(member => member.dbId).filter(Boolean)
      : [])
  ]);
  const uniqueMemberIds = [...new Set([...(dbMemberIds || []), ...(hydratedMemberIds || [])])];

  if (uniqueMemberIds.length === 0) {
    return {
      groupId,
      keyVersion,
      memberIds: [],
      membersWithPublicKeys: [],
      membersMissingPublicKeys: [],
      membersWithEnvelopes: [],
      membersMissingEnvelope: [],
      hasAnyEnvelope: false,
      envelopeCount: 0
    };
  }

  const [publicKeyRows, envelopeRows] = await Promise.all([
    getMemberPublicKeys(uniqueMemberIds),
    getGroupKeyEnvelopes(groupId, keyVersion)
  ]);

  const publicKeyUserIds = new Set((publicKeyRows || []).map((row) => row.user_id));
  const envelopeUserIds = new Set((envelopeRows || []).map((row) => row.user_id));
  const membersWithPublicKeys = uniqueMemberIds.filter((memberId) => publicKeyUserIds.has(memberId));
  const membersMissingPublicKeys = uniqueMemberIds.filter((memberId) => !publicKeyUserIds.has(memberId));
  const membersWithEnvelopes = uniqueMemberIds.filter((memberId) => envelopeUserIds.has(memberId));
  const membersMissingEnvelope = membersWithPublicKeys.filter((memberId) => !envelopeUserIds.has(memberId));
  debugLog(DEBUG_E2EE_LOGS, '[e2ee:envelope-state]', {
    groupId,
    keyVersion,
    memberCount: uniqueMemberIds.length,
    memberIds: uniqueMemberIds,
    membersWithPublicKeys,
    membersMissingPublicKeys,
    envelopeCount: envelopeRows.length,
    membersWithEnvelopes,
    membersMissingEnvelope
  });

  return {
    groupId,
    keyVersion,
    memberIds: uniqueMemberIds,
    membersWithPublicKeys,
    membersMissingPublicKeys,
    membersWithEnvelopes,
    membersMissingEnvelope,
    hasAnyEnvelope: envelopeRows.length > 0,
    envelopeCount: envelopeRows.length
  };
}

async function resolveGroupKeyForBackfill(groupId, keyVersion = E2EE_KEY_VERSION, existingGroupKey = null) {
  if (!groupId || !state.currentUser?.id) return { groupKey: null, rawGroupKey: null, source: 'none' };

  if (existingGroupKey) {
    const rawFromExisting = await getRawGroupContentKey(existingGroupKey);
    if (rawFromExisting) {
      return {
        groupKey: existingGroupKey,
        rawGroupKey: rawFromExisting,
        source: 'existing-group-key'
      };
    }
  }

  const privateKey = await loadLocalPrivateKey(state.currentUser.id);
  if (!privateKey) {
    console.warn('[e2ee:envelope-backfill] current user private key is unavailable');
    return { groupKey: null, rawGroupKey: null, source: 'missing-private-key' };
  }

  const envelope = await getMyGroupKeyEnvelope(groupId, state.currentUser.id, keyVersion);
  if (!envelope) {
    console.warn('[e2ee:envelope-backfill] current user has no envelope to recover group key for backfill', {
      groupId,
      userId: state.currentUser.id,
      keyVersion
    });
    return { groupKey: null, rawGroupKey: null, source: 'missing-envelope' };
  }

  const groupKey = await decryptGroupKeyEnvelope(envelope, privateKey);
  const rawGroupKey = await getRawGroupContentKey(groupKey);
  return {
    groupKey,
    rawGroupKey,
    source: rawGroupKey ? 'decrypted-envelope' : 'decrypted-envelope-missing-raw'
  };
}

async function backfillMissingGroupKeyEnvelopes(groupId, groupKey, keyVersion = E2EE_KEY_VERSION) {
  if (!groupId || !groupKey) return { insertedCount: 0, targetCount: 0 };

  const envelopeState = await getGroupEnvelopeState(groupId, keyVersion);
  const targetMemberIds = envelopeState.membersMissingEnvelope;
  if (targetMemberIds.length === 0) {
    if (envelopeState.membersMissingPublicKeys.length > 0) {
      debugLog(DEBUG_E2EE_LOGS, '[e2ee:envelope-backfill] pending members still missing public keys', {
        groupId,
        keyVersion,
        missingPublicKeys: envelopeState.membersMissingPublicKeys
      });
    }
    return { insertedCount: 0, targetCount: 0 };
  }

  const publicKeyRows = await getMemberPublicKeys(targetMemberIds);
  const keyRowByUserId = new Map((publicKeyRows || []).map((row) => [row.user_id, row]));
  const keyMaterial = await resolveGroupKeyForBackfill(groupId, keyVersion, groupKey);
  const rawGroupKey = keyMaterial.rawGroupKey;
  if (keyMaterial.groupKey && !state.groupContentKeys[groupId]) {
    state.groupContentKeys[groupId] = keyMaterial.groupKey;
  }
  debugLog(DEBUG_E2EE_LOGS, '[e2ee:envelope-backfill] key material availability', {
    groupId,
    keyVersion,
    source: keyMaterial.source,
    hasRawGroupKey: !!rawGroupKey,
    targetCount: targetMemberIds.length
  });
  if (!rawGroupKey) {
    console.warn('[e2ee:envelope-backfill] cannot backfill envelopes without raw group key material', {
      groupId,
      keyVersion,
      targetCount: targetMemberIds.length
    });
    return { insertedCount: 0, targetCount: targetMemberIds.length };
  }
  const envelopeRows = [];

  for (const memberId of targetMemberIds) {
    const keyRow = keyRowByUserId.get(memberId);
    if (!keyRow) {
      console.warn('[e2ee:envelope-backfill] skipping target due to missing public key', { groupId, memberId, keyVersion });
      continue;
    }

    const memberPublicKey = await importUserPublicKeyFromRecord(keyRow);
    const wrappedKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      memberPublicKey,
      rawGroupKey
    );

    envelopeRows.push({
      group_id: groupId,
      user_id: memberId,
      key_version: keyVersion,
      algorithm: E2EE_ENVELOPE_ALGORITHM,
      encrypted_group_key: bytesToBase64(wrappedKey)
    });
  }

  if (envelopeRows.length > 0) {
    await upsertGroupKeyEnvelopes(envelopeRows);
    debugLog(DEBUG_E2EE_LOGS, '[e2ee:envelope-backfill] upserted missing envelopes', {
      groupId,
      keyVersion,
      targets: targetMemberIds,
      upsertCount: envelopeRows.length
    });
  }

  return {
    insertedCount: envelopeRows.length,
    targetCount: targetMemberIds.length
  };
}

async function maybeBackfillMissingGroupKeyEnvelopes(groupId, groupKey, keyVersion = E2EE_KEY_VERSION) {
  if (!groupId || !groupKey) return;

  if (!state.groupEnvelopeBackfillInFlight) state.groupEnvelopeBackfillInFlight = {};
  if (!state.groupEnvelopeBackfillLastRunAt) state.groupEnvelopeBackfillLastRunAt = {};
  if (state.groupEnvelopeBackfillInFlight[groupId]) {
    return state.groupEnvelopeBackfillInFlight[groupId];
  }

  const lastRunAt = Number(state.groupEnvelopeBackfillLastRunAt[groupId] || 0);
  const now = Date.now();
  if (now - lastRunAt < 3000) return;

  const job = (async () => {
    try {
      await backfillMissingGroupKeyEnvelopes(groupId, groupKey, keyVersion);
    } catch (error) {
      console.error('[e2ee:envelope-backfill] failed', { groupId, keyVersion, error });
    } finally {
      state.groupEnvelopeBackfillLastRunAt[groupId] = Date.now();
      delete state.groupEnvelopeBackfillInFlight[groupId];
    }
  })();

  state.groupEnvelopeBackfillInFlight[groupId] = job;
  return job;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureGroupContentKey(groupId = state.currentGroup?.id) {
  if (!groupId || !state.currentUser?.id) return null;
  if (!state.hasResolvedMembership || !state.currentGroup?.id || state.currentGroup.id !== groupId || !state.currentMembership) {
    debugLog(DEBUG_E2EE_LOGS, 'Skipping group content key init; group context not ready', {
      groupId,
      currentGroupId: state.currentGroup?.id || null,
      hasResolvedMembership: !!state.hasResolvedMembership,
      hasMembership: !!state.currentMembership
    });
    return null;
  }

  if (!state.groupContentKeys) state.groupContentKeys = {};
  if (state.groupContentKeys[groupId]) {
    debugLog(DEBUG_E2EE_LOGS, '[e2ee:group-key] using cached group content key', { groupId, keyVersion: E2EE_KEY_VERSION });
    await maybeBackfillMissingGroupKeyEnvelopes(groupId, state.groupContentKeys[groupId], E2EE_KEY_VERSION);
    return state.groupContentKeys[groupId];
  }

  await ensureLocalUserKeypair(state.currentUser.id);
  const privateKey = await loadLocalPrivateKey(state.currentUser.id);

  let envelope = null;
  try {
    envelope = await getMyGroupKeyEnvelope(groupId, state.currentUser.id, E2EE_KEY_VERSION);
  } catch (error) {
    console.error('[e2ee:envelope-fetch] getMyGroupKeyEnvelope failed', { groupId, userId: state.currentUser.id, error });
    throw error;
  }

  if (!envelope) {
    let groupEnvelopeState = null;
    try {
      groupEnvelopeState = await getGroupEnvelopeState(groupId, E2EE_KEY_VERSION);
    } catch (error) {
      console.error('[e2ee:envelope-state] getGroupEnvelopeState failed', { groupId, keyVersion: E2EE_KEY_VERSION, error });
      throw error;
    }
    if (!groupEnvelopeState?.hasAnyEnvelope) {
      const memberIds = groupEnvelopeState?.memberIds?.length
        ? groupEnvelopeState.memberIds
        : state.members.map(member => member.dbId).filter(Boolean);
      debugLog(DEBUG_E2EE_LOGS, '[e2ee:envelope-bootstrap] no active envelopes found; bootstrapping', {
        groupId,
        keyVersion: E2EE_KEY_VERSION,
        memberCount: memberIds.length
      });
      try {
        await bootstrapGroupKeyEnvelopes(groupId, memberIds);
      } catch (error) {
        console.error('[e2ee:envelope-bootstrap] bootstrapGroupKeyEnvelopes failed', { groupId, memberCount: memberIds.length, error });
        throw error;
      }
      try {
        envelope = await getMyGroupKeyEnvelope(groupId, state.currentUser.id, E2EE_KEY_VERSION);
      } catch (error) {
        console.error('[e2ee:envelope-fetch] getMyGroupKeyEnvelope after bootstrap failed', { groupId, userId: state.currentUser.id, error });
        throw error;
      }
    } else {
      console.warn('[e2ee:envelope-recovery] current user missing envelope for existing group key; waiting for backfill', {
        groupId,
        userId: state.currentUser.id,
        keyVersion: E2EE_KEY_VERSION,
        envelopeCount: groupEnvelopeState?.envelopeCount || 0
      });

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await sleep(800);
        envelope = await getMyGroupKeyEnvelope(groupId, state.currentUser.id, E2EE_KEY_VERSION);
        if (envelope) {
          debugLog(DEBUG_E2EE_LOGS, '[e2ee:envelope-recovery] recovered current user envelope', { groupId, userId: state.currentUser.id, attempt });
          break;
        }
      }

      if (!envelope) {
        throw new Error('Missing group key envelope for current user in an existing encrypted group. Another member must backfill your envelope.');
      }
    }
  }

  if (!envelope) {
    throw new Error('Missing group key envelope for current user');
  }

  const groupKey = await decryptGroupKeyEnvelope(envelope, privateKey);
  debugLog(DEBUG_E2EE_LOGS, '[e2ee:group-key] decrypted group content key for current user', {
    groupId,
    userId: state.currentUser.id,
    keyVersion: E2EE_KEY_VERSION
  });
  state.groupContentKeys[groupId] = groupKey;
  await maybeBackfillMissingGroupKeyEnvelopes(groupId, groupKey, E2EE_KEY_VERSION);
  return groupKey;
}

async function getDecryptedGroupKey(groupId = state.currentGroup?.id) {
  return await ensureGroupContentKey(groupId);
}

async function encryptGroupMessageText(groupId, plaintext) {
  const groupKey = await ensureGroupContentKey(groupId);
  if (!groupKey) {
    throw new Error('Cannot encrypt message without an active group key context');
  }
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    groupKey,
    textToBytes(plaintext)
  );

  return {
    ciphertext: bytesToBase64(ciphertext),
    nonce: bytesToBase64(nonce),
    keyVersion: E2EE_KEY_VERSION,
    encryptionVersion: E2EE_MESSAGE_ENCRYPTION_VERSION
  };
}

async function decryptMessageRecord(messageRecord, groupKey) {
  if (!messageRecord?.is_encrypted) {
    return messageRecord?.text || '';
  }

  const ciphertext = messageRecord.ciphertext;
  const nonce = messageRecord.nonce;
  if (!ciphertext || !nonce) {
    return E2EE_DECRYPT_FAIL_PLACEHOLDER;
  }

  try {
    const resolvedGroupKey = groupKey || await ensureGroupContentKey(messageRecord.group_id || state.currentGroup?.id);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(nonce) },
      resolvedGroupKey,
      base64ToBytes(ciphertext)
    );
    return bytesToText(new Uint8Array(decrypted));
  } catch (error) {
    console.warn('decryptMessageRecord failed', error);
    return E2EE_DECRYPT_FAIL_PLACEHOLDER;
  }
}

async function getRenderableMessageText(messageRecord) {
  if (!messageRecord?.is_encrypted) {
    return messageRecord?.text || '';
  }
  return await decryptMessageRecord(messageRecord);
}

async function createEncryptedChatMessage(groupId, senderUserId, plaintext) {
  let encrypted;
  try {
    encrypted = await encryptGroupMessageText(groupId, plaintext);
  } catch (error) {
    console.error('[e2ee:message-encryption] encryptGroupMessageText failed', { groupId, senderUserId, error });
    throw error;
  }

  try {
    return await createMessageRecord({
      group_id: groupId,
      sender_user_id: senderUserId,
      type: 'text',
      text: null,
      is_encrypted: true,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      key_version: encrypted.keyVersion,
      encryption_version: encrypted.encryptionVersion
    });
  } catch (error) {
    console.error('[e2ee:message-insert] createMessageRecord failed', { groupId, senderUserId, error });
    throw error;
  }
}
