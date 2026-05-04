// Alert creation and acknowledgement actions


    async function createAlert() {
      const input = document.getElementById('alertInput');
      const text = input.value.trim();
      if (!text || !state.currentGroup) return;

      const senderId = getCurrentMemberIndex();
      const sender = state.members[senderId];
      if (!sender) return;

      const { data: insertedAlert, error } = await supabaseClient
        .from('alerts')
        .insert({
          group_id: state.currentGroup.id,
          sender_user_id: sender.dbId,
          text
        })
        .select()
        .single();

      if (error || !insertedAlert) {
        console.error('createAlert failed', error);
        showToast('Failed to create alert', 'alert');
        return;
      }

      const { error: readError } = await supabaseClient
        .from('alert_reads')
        .insert({
          alert_id: insertedAlert.id,
          user_id: sender.dbId
        });

      if (readError) {
        console.error('createAlert read insert failed', readError);
      }

      input.value = '';
      await refreshAlerts({ source: 'post-action:create-alert' });
      closeComposerPanels();
      switchView('dashboard');
      refreshAlertSurfaces();
      showToast('Alert created and posted to dashboard', 'alert');
    }


    function addAlert(senderId, text, timeLabel) {
      const alert = {
        id: `local-alert-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        senderId,
        text,
        time: timeLabel || formatTime(new Date()),
        createdAt: new Date().toISOString(),
        acknowledgedBy: [senderId],
      };

      state.alerts.unshift(alert);
      state.messages.push({
        id: 'alert-' + alert.id,
        type: 'alert',
        senderId,
        text,
        time: alert.time,
        alertId: alert.id,
      });

      refreshAll();
    }


    async function acknowledgeAlert(alertId, memberId = getCurrentMemberIndex()) {
      const alert = state.alerts.find(a => a.id === alertId);
      if (!alert) return;
      if (alert.acknowledgedBy.includes(memberId)) return;

      const member = state.members[memberId];
      if (!member) return;

      const { error } = await supabaseClient
        .from('alert_reads')
        .insert({
          alert_id: alertId,
          user_id: member.dbId
        });

      if (error) {
        console.error('acknowledgeAlert failed', error);
        showToast('Failed to acknowledge alert', 'alert');
        return;
      }

      await refreshAlerts({ source: 'post-action:ack-alert' });
      refreshAlertSurfaces();
      showToast(`${member.name} acknowledged an alert`, 'alert');
    }

    function refreshAlertSurfaces() {
      renderAlerts();
      renderChatMessages();
      renderSnapshots();
      updateStatusChips();
    }
