// Chat composer and messaging actions

    async function sendMessage() {
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      if (!text || !state.currentGroup) return;

      const senderId = getCurrentMemberIndex();
      const sender = state.members[senderId];
      if (!sender) return;

      let insertedMessage;
      try {
        insertedMessage = await createEncryptedChatMessage(state.currentGroup.id, sender.dbId, text);
      } catch (error) {
        console.error('sendMessage failed', error);
        const errorMessage = String(error?.message || '');
        if (errorMessage.includes('Missing group key envelope')) {
          showToast('Encrypted chat is not ready yet for your account. Ask an existing member to open the group so your key envelope can be backfilled.', 'alert');
        } else {
          showToast('Failed to send message', 'alert');
        }
        return;
      }

      input.value = '';
      state.messages.push({
        id: insertedMessage.id,
        type: insertedMessage.type || 'text',
        senderId,
        text,
        time: formatTime(new Date(insertedMessage.created_at || Date.now())),
        createdAt: insertedMessage.created_at || new Date().toISOString(),
        alertId: null
      });
      state.messages.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
      renderChatMessages();
      await refreshMessages({ source: 'post-action:send-message' });
      showToast(`${sender.name} sent a message`, 'chat');
    }


    function togglePlusMenu(event) {
      event.stopPropagation();
      document.getElementById('plusMenu').classList.toggle('open');
    }


    function openAlertComposer() {
      closeComposerPanels();
      document.getElementById('plusMenu').classList.remove('open');
      document.getElementById('alertComposer').classList.add('open');
      document.getElementById('alertInput').focus();
    }


    function openUploadComposer() {
      closeComposerPanels();
      document.getElementById('plusMenu').classList.remove('open');
      document.getElementById('uploadComposer').classList.add('open');
    }


    function closeComposerPanels() {
      document.getElementById('alertComposer').classList.remove('open');
      document.getElementById('uploadComposer').classList.remove('open');
    }
