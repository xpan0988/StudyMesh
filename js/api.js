// Supabase data loading and persistence

    async function upsertMemberPublicKey(userId, publicKeyJwk) {
      // `member_public_keys` is user-scoped in MVP. Do not write `key_version` here;
      // versioned key metadata belongs to `group_key_envelopes` and `messages`.
      const { error } = await supabaseClient
        .from('member_public_keys')
        .upsert({
          user_id: userId,
          public_key: publicKeyJwk
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;
    }

    async function getMemberPublicKeys(userIds) {
      if (!Array.isArray(userIds) || userIds.length === 0) return [];
      const { data, error } = await supabaseClient
        .from('member_public_keys')
        .select('*')
        .in('user_id', userIds);

      if (error) throw error;
      return data || [];
    }

    async function getMyGroupKeyEnvelope(groupId, userId, keyVersion = 1) {
      const { data, error } = await supabaseClient
        .from('group_key_envelopes')
        .select('group_id,user_id,encrypted_group_key,key_version,algorithm')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('key_version', keyVersion)
        .maybeSingle();

      if (error) throw error;
      return data || null;
    }

    async function getGroupKeyEnvelopeCount(groupId, keyVersion = 1) {
      if (!groupId) return 0;
      const { count, error } = await supabaseClient
        .from('group_key_envelopes')
        .select('group_id', {
          head: true,
          count: 'exact'
        })
        .eq('group_id', groupId)
        .eq('key_version', keyVersion);

      if (error) throw error;
      return count || 0;
    }

    async function getGroupMemberUserIds(groupId) {
      if (!groupId) return [];
      const { data, error } = await supabaseClient
        .from('group_members')
        .select('user_id')
        .eq('group_id', groupId);

      if (error) throw error;
      return (data || []).map((row) => row.user_id).filter(Boolean);
    }

    async function getGroupKeyEnvelopes(groupId, keyVersion = 1) {
      if (!groupId) return [];
      const { data, error } = await supabaseClient
        .from('group_key_envelopes')
        .select('group_id,user_id,encrypted_group_key,key_version,algorithm')
        .eq('group_id', groupId)
        .eq('key_version', keyVersion);

      if (error) throw error;
      return data || [];
    }

    async function upsertGroupKeyEnvelopes(envelopes) {
      if (!Array.isArray(envelopes) || envelopes.length === 0) return;
      const normalizedEnvelopes = envelopes.map((row) => ({
        group_id: row.group_id,
        user_id: row.user_id,
        encrypted_group_key: row.encrypted_group_key,
        key_version: row.key_version,
        algorithm: row.algorithm
      }));

      const { error } = await supabaseClient
        .from('group_key_envelopes')
        .upsert(normalizedEnvelopes, {
          onConflict: 'group_id,user_id,key_version'
        });

      if (error) throw error;
    }

    async function createMessageRecord(messageInput) {
      const { data, error } = await supabaseClient
        .from('messages')
        .insert(messageInput)
        .select('*')
        .single();

      if (error) throw error;
      return data;
    }

    async function loadMembers() {
      if (!state.currentGroup) {
        state.members = [];
        state.contributions = [];
        return;
      }

      const { data, error } = await supabaseClient
        .from('group_members')
        .select(`
          id,
          group_id,
          user_id,
          profiles:user_id (
            id,
            display_name
          )
        `)
        .eq('group_id', state.currentGroup.id)
        .order('joined_at', { ascending: true });

      if (error) {
        console.error('loadMembers failed', error);
        state.members = [];
        state.contributions = [];
        return;
      }

      state.members = (data || []).map((row, i) => ({
        id: i,
        dbId: row.user_id,
        membershipId: row.id,
        name: row.profiles?.display_name || 'User',
        initials: (row.profiles?.display_name || 'U').slice(0, 2).toUpperCase(),
        color: ['#7c6af7','#f7c56a','#6af7b8','#f76a9f'][i % 4]
      }));
      state.memberIndexByDbId = new Map(state.members.map(member => [member.dbId, member.id]));
      state.memberByDbId = new Map(state.members.map(member => [member.dbId, member]));

      state.contributions = state.members.map(() => ({
        tasksCompleted: 0,
        filesUploaded: 0
      }));
    }


    async function loadMessages() {
      if (!state.currentGroup) {
        state.messages = [];
        return;
      }

      const { data, error } = await supabaseClient
        .from('messages')
        .select('*')
        .eq('group_id', state.currentGroup.id)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('loadMessages failed', error);
        state.messages = [];
        return;
      }

      const dbMessages = [];
      for (const row of (data || [])) {
        const senderIndex = state.memberIndexByDbId.get(row.sender_user_id) ?? -1;
        const text = await getRenderableMessageText(row);
        dbMessages.push({
          id: row.id,
          type: row.type || 'text',
          senderId: senderIndex,
          text,
          time: formatTime(new Date(row.created_at || Date.now())),
          createdAt: row.created_at,
          alertId: null
        });
      }

      const alertMessages = state.alerts
        .map(alert => ({
          id: `alert-message-${alert.id}`,
          type: 'alert',
          senderId: alert.senderId,
          text: alert.text,
          time: alert.time,
          createdAt: alert.createdAt,
          alertId: alert.id
        }))
        .filter(msg => msg.senderId !== -1);

      state.messages = [...dbMessages, ...alertMessages].filter(msg => msg.senderId !== -1).sort((a, b) => {
        const aTime = new Date(a.createdAt || Date.now()).getTime();
        const bTime = new Date(b.createdAt || Date.now()).getTime();
        return aTime - bTime;
      });
    }


    async function loadTasks() {
      if (!state.currentGroup) {
        state.tasks = [];
        return;
      }

      const { data, error } = await supabaseClient
        .from('tasks')
        .select('*')
        .eq('group_id', state.currentGroup.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('loadTasks failed', error);
        state.tasks = [];
        return;
      }

      state.tasks = (data || []).map(row => {
        const assigneeIndex = state.memberIndexByDbId.get(row.assignee_user_id) ?? -1;
        return {
          id: row.id,
          title: row.title,
          assigneeId: assigneeIndex,
          assigneeUserId: row.assignee_user_id,
          createdByUserId: row.created_by,
          dueDate: row.due_date,
          priority: row.priority || 'Medium',
          completed: !!row.completed,
          createdAt: row.created_at,
          completedAt: row.completed_at
        };
      }).filter(task => task.assigneeId !== -1);
    }


    async function loadAlerts() {
      if (!state.currentGroup) {
        state.alerts = [];
        return;
      }

      const { data, error } = await supabaseClient
        .from('alerts')
        .select('*')
        .eq('group_id', state.currentGroup.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('loadAlerts failed', error);
        state.alerts = [];
        return;
      }

      const { data: readRows, error: readError } = await supabaseClient
        .from('alert_reads')
        .select('*')
        .in('alert_id', (data || []).map(row => row.id));

      if (readError) {
        console.error('loadAlerts read rows failed', readError);
      }

      const readsByAlert = new Map();
      (readRows || []).forEach(row => {
        if (!readsByAlert.has(row.alert_id)) {
          readsByAlert.set(row.alert_id, []);
        }
        readsByAlert.get(row.alert_id).push(row.user_id);
      });

      state.alerts = (data || []).map(row => {
        const senderIndex = state.memberIndexByDbId.get(row.sender_user_id) ?? -1;
        const acknowledgedDbIds = readsByAlert.get(row.id) || [];
        const acknowledgedBy = acknowledgedDbIds
          .map(dbId => state.memberIndexByDbId.get(dbId) ?? -1)
          .filter(index => index !== -1);

        return {
          id: row.id,
          senderId: senderIndex,
          text: row.text,
          time: formatTime(new Date(row.created_at || Date.now())),
          createdAt: row.created_at,
          acknowledgedBy,
        };
      }).filter(alert => alert.senderId !== -1);
    }


    async function loadResources() {
      if (!state.currentGroup) {
        state.resources = [];
        return;
      }

      const { data, error } = await supabaseClient
        .from('resources')
        .select('*')
        .eq('group_id', state.currentGroup.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('loadResources failed', error);
        state.resources = [];
        return;
      }

      state.resources = (data || []).map(row => {
        const senderIndex = state.memberIndexByDbId.get(row.sender_user_id) ?? -1;
        return {
          id: row.id,
          senderId: senderIndex,
          name: row.name,
          icon: row.icon || getFileIcon((row.type || '').toLowerCase()),
          type: row.type,
          size: row.size_label || '—',
          sizeBytes: row.size_bytes || 0,
          mimeType: row.mime_type || '',
          storagePath: row.storage_path || '',
          bucketName: row.bucket_name || 'group-files',
          originalName: row.original_name || row.name,
          time: formatTime(new Date(row.created_at || Date.now())),
          createdAt: row.created_at,
          simulated: false
        };
      }).filter(resource => resource.senderId !== -1);
    }


    async function uploadResourceBinary(file, groupId, userId) {
      const bucketName = 'group-files';
      if (!file) throw new Error('Missing file for upload');
      if (!groupId) throw new Error('Missing group id for upload');
      if (!userId) throw new Error('Missing user id for upload');

      const sanitizedOriginalName = String(file.name || 'file')
        .replace(/[^\w.\- ]+/g, '_')
        .replace(/\s+/g, '_');
      const timestamp = Date.now();
      const storagePath = `${groupId}/${userId}/${timestamp}_${sanitizedOriginalName}`;

      const { error } = await supabaseClient
        .storage
        .from(bucketName)
        .upload(storagePath, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false
        });

      if (error) throw error;

      return {
        bucketName,
        storagePath,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size || 0,
        originalName: file.name || 'file'
      };
    }


    async function createResourceRecord(resourceInput) {
      const { data, error } = await supabaseClient
        .from('resources')
        .insert(resourceInput)
        .select('*')
        .single();

      if (error) throw error;
      return data;
    }


    async function createFileMessage(groupId, senderUserId, fileDisplayText) {
      return await createMessageRecord({
        group_id: groupId,
        sender_user_id: senderUserId,
        type: 'file',
        text: fileDisplayText,
        is_encrypted: false
      });
    }


    async function getSignedResourceDownloadUrl(resource) {
      if (!resource?.storagePath) {
        throw new Error('Resource is missing storage path');
      }

      const bucketName = resource.bucketName || 'group-files';
      const { data, error } = await supabaseClient
        .storage
        .from(bucketName)
        .createSignedUrl(resource.storagePath, 60, {
          download: resource.originalName || resource.name || 'download'
        });

      if (error) throw error;
      return data?.signedUrl || '';
    }


    async function loadAvailabilityBlocks() {
      if (!state.currentGroup) {
        state.availabilityBlocks = [];
        return;
      }

      const { data, error } = await supabaseClient
        .from('availability_blocks')
        .select('*')
        .eq('group_id', state.currentGroup.id)
        .order('weekday', { ascending: true })
        .order('start_hour', { ascending: true });

      if (error) {
        console.error('loadAvailabilityBlocks failed', error);
        state.availabilityBlocks = [];
        return;
      }

      state.availabilityBlocks = data || [];
    }


    const POLLING_INTERVALS_MS = {
      messages: 2000,
      alerts: 4000,
      tasks: 4000,
      availability: 4000,
      resources: 5000,
      members: 5000,
      e2ee: 5000
    };

    function getPollingState() {
      if (!state.groupPolling || typeof state.groupPolling !== 'object') {
        state.groupPolling = {
          activeGroupId: null,
          timers: {},
          inFlight: {}
        };
      }
      if (!state.groupPolling.timers || typeof state.groupPolling.timers !== 'object') {
        state.groupPolling.timers = {};
      }
      if (!state.groupPolling.inFlight || typeof state.groupPolling.inFlight !== 'object') {
        state.groupPolling.inFlight = {};
      }
      return state.groupPolling;
    }

    function isPollingContextActive(groupId) {
      if (!groupId) return false;
      return !!state.currentUser?.id
        && !!state.currentMembership
        && state.currentGroup?.id === groupId;
    }

    function clearPollingTimer(timerKey) {
      const polling = getPollingState();
      const timer = polling.timers[timerKey];
      if (!timer) return;
      clearInterval(timer);
      delete polling.timers[timerKey];
      delete polling.inFlight[timerKey];
    }

    async function stopGroupPolling(reason = 'manual-stop') {
      const polling = getPollingState();
      Object.keys(polling.timers).forEach(clearPollingTimer);
      polling.activeGroupId = null;
      console.log('[polling] stopped', { reason });
    }

    async function runPollingRefresh(timerKey, groupId, work, sourceLabel) {
      const polling = getPollingState();
      if (!isPollingContextActive(groupId) || polling.activeGroupId !== groupId) {
        return;
      }
      if (polling.inFlight[timerKey]) {
        return;
      }

      polling.inFlight[timerKey] = true;
      try {
        await work();
      } catch (error) {
        console.error('[polling] refresh failed', {
          timerKey,
          groupId,
          source: sourceLabel,
          error
        });
      } finally {
        polling.inFlight[timerKey] = false;
      }
    }

    function startPollingTimer(timerKey, intervalMs, groupId, work) {
      clearPollingTimer(timerKey);
      const timer = setInterval(async () => {
        await runPollingRefresh(timerKey, groupId, work, `poll:${timerKey}`);
      }, intervalMs);
      getPollingState().timers[timerKey] = timer;
    }

    async function refreshMessages(options = {}) {
      const groupId = options.groupId || state.currentGroup?.id;
      if (!groupId || !isPollingContextActive(groupId)) return;

      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh messages start', { groupId, source: options.source || 'manual' });
      await loadMessages();
      renderChatMessages();
      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh messages done', { groupId, count: state.messages.length, source: options.source || 'manual' });
    }

    async function refreshAlerts(options = {}) {
      const groupId = options.groupId || state.currentGroup?.id;
      if (!groupId || !isPollingContextActive(groupId)) return;

      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh alerts start', { groupId, source: options.source || 'manual' });
      await loadAlerts();
      await loadMessages();
      refreshAlertSurfaces();
      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh alerts done', { groupId, count: state.alerts.length, source: options.source || 'manual' });
    }

    async function refreshTasks(options = {}) {
      const groupId = options.groupId || state.currentGroup?.id;
      if (!groupId || !isPollingContextActive(groupId)) return;

      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh tasks start', { groupId, source: options.source || 'manual' });
      await loadTasks();
      recalculateContributions();
      renderTasks();
      renderCompletedTasks();
      renderNearestDue();
      renderProgress();
      renderSnapshots();
      updateStatusChips();
      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh tasks done', { groupId, count: state.tasks.length, source: options.source || 'manual' });
    }

    async function refreshResources(options = {}) {
      const groupId = options.groupId || state.currentGroup?.id;
      if (!groupId || !isPollingContextActive(groupId)) return;

      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh resources start', { groupId, source: options.source || 'manual' });
      await loadResources();
      await loadMessages();
      recalculateContributions();
      renderResources();
      populateResourceTypeFilter();
      renderChatMessages();
      renderProgress();
      renderSnapshots();
      updateStatusChips();
      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh resources done', { groupId, count: state.resources.length, source: options.source || 'manual' });
    }

    async function refreshAvailability(options = {}) {
      const groupId = options.groupId || state.currentGroup?.id;
      if (!groupId || !isPollingContextActive(groupId)) return;

      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh availability start', { groupId, source: options.source || 'manual' });
      await loadAvailabilityBlocks();
      if (state.currentView === 'timetable') {
        renderSchedule();
      }
      syncMeetingRecommendationUI();
      renderSnapshots();
      updateStatusChips();
      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh availability done', { groupId, count: state.availabilityBlocks.length, source: options.source || 'manual' });
    }

    async function refreshGroupMembers(options = {}) {
      const groupId = options.groupId || state.currentGroup?.id;
      if (!groupId || !isPollingContextActive(groupId)) return;

      const previousMemberSignature = state.members.map(member => member.dbId).join('|');
      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh members start', { groupId, source: options.source || 'manual' });
      await loadMembers();
      renderAvatars();
      populateMemberSelects();

      const nextMemberSignature = state.members.map(member => member.dbId).join('|');
      if (previousMemberSignature !== nextMemberSignature) {
        debugLog(DEBUG_POLLING_LOGS, '[polling] members changed, reconciling group state', { groupId });
        await reconcileGroupState({ groupId, source: options.source || 'members-refresh' });
        return;
      }

      recalculateContributions();
      renderProgress();
      updateStatusChips();
      debugLog(DEBUG_POLLING_LOGS, '[polling] refresh members done', { groupId, count: state.members.length, source: options.source || 'manual' });
    }

    async function refreshGroupEncryptionState(options = {}) {
      const groupId = options.groupId || state.currentGroup?.id;
      if (!groupId || !isPollingContextActive(groupId)) return;

      try {
        await ensureGroupContentKey(groupId);
      } catch (error) {
        console.warn('[polling] ensureGroupContentKey failed', { groupId, error });
        return;
      }

      await refreshMessages({ groupId, source: options.source || 'poll:e2ee' });
    }

    async function reconcileGroupState(options = {}) {
      const groupId = options.groupId || state.currentGroup?.id;
      if (!groupId || !isPollingContextActive(groupId)) return;

      debugLog(DEBUG_POLLING_LOGS, '[polling] reconcile group state start', { groupId, source: options.source || 'manual' });
      await ensureGroupContentKey(groupId);
      await Promise.all([
        loadTasks(),
        loadAlerts(),
        loadResources(),
        loadAvailabilityBlocks()
      ]);
      await loadMessages();
      renderAvatars();
      populateMemberSelects();
      refreshAll();
      debugLog(DEBUG_POLLING_LOGS, '[polling] reconcile group state done', { groupId, source: options.source || 'manual' });
    }

    async function startGroupPolling(groupId = state.currentGroup?.id) {
      if (!isPollingContextActive(groupId)) return;

      const polling = getPollingState();
      if (polling.activeGroupId === groupId && Object.keys(polling.timers).length > 0) {
        return;
      }

      await stopGroupPolling('start-group-polling');
      polling.activeGroupId = groupId;

      console.log('[polling] started', { groupId });
      startPollingTimer('messages', POLLING_INTERVALS_MS.messages, groupId, async () => refreshMessages({ groupId, source: 'poll:messages' }));
      startPollingTimer('alerts', POLLING_INTERVALS_MS.alerts, groupId, async () => refreshAlerts({ groupId, source: 'poll:alerts' }));
      startPollingTimer('tasks', POLLING_INTERVALS_MS.tasks, groupId, async () => refreshTasks({ groupId, source: 'poll:tasks' }));
      startPollingTimer('availability', POLLING_INTERVALS_MS.availability, groupId, async () => refreshAvailability({ groupId, source: 'poll:availability' }));
      startPollingTimer('resources', POLLING_INTERVALS_MS.resources, groupId, async () => refreshResources({ groupId, source: 'poll:resources' }));
      startPollingTimer('members', POLLING_INTERVALS_MS.members, groupId, async () => refreshGroupMembers({ groupId, source: 'poll:members' }));
      startPollingTimer('e2ee', POLLING_INTERVALS_MS.e2ee, groupId, async () => refreshGroupEncryptionState({ groupId, source: 'poll:e2ee' }));
    }
