// Rendering and DOM update helpers

    function updateHeaderGroupTag() {
      const tag = document.getElementById('headerGroupTag');
      if (!tag) return;

      if (state.currentGroup) {
        tag.textContent = state.currentGroup.name;
        return;
      }

      tag.textContent = 'Student Group Board';
    }


    function renderAvatars() {
      const el = document.getElementById('memberAvatars');
      if (state.members.length === 0) {
        el.innerHTML = '';
        return;
      }

      el.innerHTML = state.members.map(m =>
        `<div class="avatar" style="background:${m.color}" title="${m.name}">${m.initials}</div>`
      ).join('');
    }


    function populateMemberSelects() {
      const taskSelect = document.getElementById('taskAssignee');
      if (!taskSelect) return;

      if (state.members.length === 0) {
        taskSelect.innerHTML = '';
        return;
      }

      const options = state.members.map(m => `<option value="${m.id}" ${m.dbId === state.currentUser?.id ? 'selected' : ''}>${m.name}</option>`).join('');
      taskSelect.innerHTML = options;
    }


    function refreshAll() {
      recalculateContributions();
      renderChatMessages();
      renderAlerts();
      renderTasks();
      renderCompletedTasks();
      syncMeetingRecommendationUI();
      renderResources();
      populateResourceTypeFilter();
      renderNearestDue();
      renderProgress();
      updateStatusChips();
    }


    function recalculateContributions() {
      const taskCountsByDbId = new Map();
      const fileCountsByDbId = new Map();

      state.tasks.forEach(task => {
        if (!task.completed) return;
        const assigneeDbId = state.members[task.assigneeId]?.dbId;
        if (!assigneeDbId) return;
        taskCountsByDbId.set(assigneeDbId, (taskCountsByDbId.get(assigneeDbId) || 0) + 1);
      });

      state.resources.forEach(resource => {
        const senderDbId = state.members[resource.senderId]?.dbId;
        if (!senderDbId) return;
        fileCountsByDbId.set(senderDbId, (fileCountsByDbId.get(senderDbId) || 0) + 1);
      });

      state.contributions = state.members.map(member => ({
        tasksCompleted: taskCountsByDbId.get(member.dbId) || 0,
        filesUploaded: fileCountsByDbId.get(member.dbId) || 0
      }));
    }

    function createElementFromHtml(html) {
      const template = document.createElement('template');
      template.innerHTML = html.trim();
      return template.content.firstElementChild;
    }

    function isNearBottom(container, threshold = 90) {
      if (!container) return true;
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      return distanceFromBottom <= threshold;
    }

    function captureListUiState(container) {
      if (!container) return { scrollTop: 0, expandedIds: new Set() };
      const expandedIds = new Set(
        Array.from(container.querySelectorAll('[data-item-id].expanded,[data-item-id].open,[data-item-id][aria-expanded="true"]'))
          .map(node => node.dataset.itemId)
          .filter(Boolean)
      );

      return {
        scrollTop: container.scrollTop,
        expandedIds
      };
    }

    function restoreListUiState(container, uiState) {
      if (!container || !uiState) return;
      container.scrollTop = uiState.scrollTop || 0;
      const escapeSelector = (value) => {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        return String(value).replace(/"/g, '\\"');
      };
      (uiState.expandedIds || new Set()).forEach((itemId) => {
        const node = container.querySelector(`[data-item-id="${escapeSelector(itemId)}"]`);
        if (!node) return;
        node.classList.add('expanded');
        node.classList.add('open');
        if (node.hasAttribute('aria-expanded')) {
          node.setAttribute('aria-expanded', 'true');
        }
      });
    }

    function patchKeyedList(container, items, options) {
      if (!container) return;
      const {
        emptyHtml,
        itemId,
        itemSignature,
        renderItemHtml
      } = options;

      const previousUiState = captureListUiState(container);
      if (items.length === 0) {
        if (container.innerHTML !== emptyHtml) {
          container.innerHTML = emptyHtml;
        }
        container.scrollTop = previousUiState.scrollTop || 0;
        return;
      }

      const currentNodesById = new Map(
        Array.from(container.querySelectorAll('[data-item-id]'))
          .map(node => [node.dataset.itemId, node])
      );
      const currentIds = Array.from(container.querySelectorAll('[data-item-id]')).map(node => node.dataset.itemId);
      const nextIds = items.map(item => String(itemId(item)));
      const isSameOrder = currentIds.length === nextIds.length
        && currentIds.every((id, index) => id === nextIds[index]);
      const hasRenderableChanges = items.some((item) => {
        const id = String(itemId(item));
        const expectedSignature = itemSignature(item);
        return currentNodesById.get(id)?.dataset.renderSignature !== expectedSignature;
      });
      if (isSameOrder && !hasRenderableChanges) {
        restoreListUiState(container, previousUiState);
        return;
      }

      const fragment = document.createDocumentFragment();
      items.forEach(item => {
        const id = String(itemId(item));
        const signature = itemSignature(item);
        const existingNode = currentNodesById.get(id);
        if (existingNode && existingNode.dataset.renderSignature === signature) {
          fragment.appendChild(existingNode);
          return;
        }

        const nextNode = createElementFromHtml(renderItemHtml(item, signature));
        if (nextNode) {
          fragment.appendChild(nextNode);
        }
      });

      container.innerHTML = '';
      container.appendChild(fragment);
      restoreListUiState(container, previousUiState);
    }

    function getChatAlertMeta(alertId, currentSenderId) {
      const alert = state.alerts.find(a => a.id === alertId);
      const hasRead = alert ? alert.acknowledgedBy.includes(currentSenderId) : true;
      const acknowledgedCount = alert ? alert.acknowledgedBy.length : 0;
      const pendingCount = Math.max(0, state.members.length - acknowledgedCount);
      return { hasRead, pendingCount, acknowledgedCount };
    }

    function getMessageRenderSignature(msg, currentSenderId) {
      if (msg.type === 'alert') {
        const alertMeta = getChatAlertMeta(msg.alertId, currentSenderId);
        return `${msg.id}|${msg.type}|${msg.text}|${msg.time}|${alertMeta.acknowledgedCount}|${alertMeta.hasRead}|${state.members.length}`;
      }
      return `${msg.id}|${msg.type}|${msg.text}|${msg.time}`;
    }

    function renderChatMessageHtml(msg, currentSenderId, signature) {
      const member = state.members[msg.senderId];
      if (!member) return '';

      if (msg.type === 'alert') {
        const { hasRead, pendingCount, acknowledgedCount } = getChatAlertMeta(msg.alertId, currentSenderId);
        const canAcknowledge = currentSenderId !== -1;
        return `
          <div class="msg alert" data-message-id="${msg.id}" data-render-signature="${escHtml(signature)}">
            <div class="msg-avatar" style="background:${member.color}">${member.initials}</div>
            <div class="msg-body">
              <div class="msg-meta">
                <span class="msg-name" style="color:${member.color}">${member.name}</span>
                <span class="msg-time">${msg.time}</span>
              </div>
              <div class="msg-text">
                ${escHtml(msg.text)}
                <div class="msg-alert-meta">
                  <span class="alert-inline-badge">ALERT</span>
                  <span class="meta-pill">${acknowledgedCount}/${state.members.length} read</span>
                  <span class="meta-pill">${pendingCount} pending</span>
                  <button class="ack-btn" onclick="acknowledgeAlert('${msg.alertId}')" ${hasRead || !canAcknowledge ? 'disabled' : ''}>
                    ${hasRead ? 'Acknowledged' : 'Mark as Read'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      }

      if (msg.type === 'file') {
        return `
          <div class="msg file" data-message-id="${msg.id}" data-render-signature="${escHtml(signature)}">
            <div class="msg-avatar" style="background:${member.color}">${member.initials}</div>
            <div class="msg-body">
              <div class="msg-meta">
                <span class="msg-name" style="color:${member.color}">${member.name}</span>
                <span class="msg-time">${msg.time}</span>
              </div>
              <div class="msg-text">📁 ${escHtml(msg.text)}</div>
            </div>
          </div>
        `;
      }

      return `
        <div class="msg" data-message-id="${msg.id}" data-render-signature="${escHtml(signature)}">
          <div class="msg-avatar" style="background:${member.color}">${member.initials}</div>
          <div class="msg-body">
            <div class="msg-meta">
              <span class="msg-name" style="color:${member.color}">${member.name}</span>
              <span class="msg-time">${msg.time}</span>
            </div>
            <div class="msg-text">${escHtml(msg.text)}</div>
          </div>
        </div>
      `;
    }

    function renderChatMessages() {
      const wrap = document.getElementById('chatMessages');
      if (!wrap) return;
      const currentSenderId = getCurrentMemberIndex();
      const visibleMessages = state.messages.filter(msg => state.members[msg.senderId]);
      if (visibleMessages.length === 0) {
        wrap.innerHTML = `<div class="empty-state"><div class="emo">💬</div>No messages yet</div>`;
        return;
      }

      const wasNearBottom = isNearBottom(wrap, 90);
      const previousScrollTop = wrap.scrollTop;
      const previousScrollHeight = wrap.scrollHeight;
      const currentIds = Array.from(wrap.querySelectorAll('[data-message-id]')).map(node => node.dataset.messageId);
      const nextIds = visibleMessages.map(msg => String(msg.id));
      const appendOnly = currentIds.length > 0
        && nextIds.length >= currentIds.length
        && currentIds.every((id, index) => id === nextIds[index]);

      if (appendOnly) {
        const existingNodesById = new Map(
          Array.from(wrap.querySelectorAll('[data-message-id]')).map(node => [node.dataset.messageId, node])
        );

        visibleMessages.forEach(msg => {
          const signature = getMessageRenderSignature(msg, currentSenderId);
          const id = String(msg.id);
          const existingNode = existingNodesById.get(id);
          if (existingNode) {
            if (existingNode.dataset.renderSignature !== signature) {
              const nextNode = createElementFromHtml(renderChatMessageHtml(msg, currentSenderId, signature));
              if (nextNode) existingNode.replaceWith(nextNode);
            }
            return;
          }

          const nextNode = createElementFromHtml(renderChatMessageHtml(msg, currentSenderId, signature));
          if (nextNode) wrap.appendChild(nextNode);
        });
      } else {
        wrap.innerHTML = visibleMessages.map(msg => {
          const signature = getMessageRenderSignature(msg, currentSenderId);
          return renderChatMessageHtml(msg, currentSenderId, signature);
        }).join('');
      }

      if (wasNearBottom) {
        wrap.scrollTop = wrap.scrollHeight;
      } else if (!appendOnly) {
        const distanceFromBottom = previousScrollHeight - previousScrollTop;
        wrap.scrollTop = Math.max(0, wrap.scrollHeight - distanceFromBottom);
      }
    }


    function renderAlerts() {
      const activeAlerts = getDisplayAlerts();
      const scroller = document.getElementById('alertsScroller');
      patchKeyedList(scroller, activeAlerts, {
        emptyHtml: `<div class="empty-state"><div class="emo">🔕</div>No alerts yet</div>`,
        itemId: alert => alert.id,
        itemSignature: alert => `${alert.id}|${alert.text}|${alert.time}|${alert.acknowledgedBy.join(',')}`,
        renderItemHtml: (alert, signature) => {
          const member = state.members[alert.senderId];
          if (!member) return `<div class="alert-item" data-item-id="${alert.id}" data-render-signature="${escHtml(signature)}"></div>`;
          return `
            <div class="alert-item" data-item-id="${alert.id}" data-render-signature="${escHtml(signature)}">
              <div class="alert-top">
                <div class="alert-badge">🚨 Alert Notice</div>
                <div class="alert-meta">${member.name}<br>${alert.time}</div>
              </div>
              <div class="alert-text">${escHtml(alert.text)}</div>
              <div class="ack-list">
                ${state.members.map(m => `<span class="ack-pill ${alert.acknowledgedBy.includes(m.id) ? 'read' : ''}">${m.initials}</span>`).join('')}
              </div>
              <div class="alert-footer">${alert.acknowledgedBy.length}/${state.members.length} members have acknowledged this alert.</div>
            </div>
          `;
        }
      });

      document.getElementById('alertSummaryChip').textContent = `${activeAlerts.length} alerts`;
    }


    function renderTasks() {
      const inProgress = state.tasks.filter(t => !t.completed).sort(sortByDueDateAsc);
      renderTaskList('inProgressTasks', inProgress, false);
    }


    function renderCompletedTasks() {
      const completed = state.tasks.filter(t => t.completed).sort(sortByDueDateAsc);
      renderTaskList('completedTasks', completed, true);
    }


    function renderTaskList(targetId, items, showCompletedStatus) {
      const el = document.getElementById(targetId);
      patchKeyedList(el, items, {
        emptyHtml: `<div class="empty-state"><div class="emo">📝</div>No tasks to show</div>`,
        itemId: task => task.id,
        itemSignature: task => `${task.id}|${task.title}|${task.assigneeId}|${task.dueDate}|${task.priority}|${task.completed}|${task.completedAt || ''}`,
        renderItemHtml: (task, signature) => {
        const member = state.members[task.assigneeId];
        if (!member) return `<div class="task-item ${task.completed ? 'done' : ''}" data-item-id="${task.id}" data-render-signature="${escHtml(signature)}"></div>`;
        const statusLabel = task.completed ? 'Completed' : 'In Progress';
        const priority = task.priority || 'Medium';
        const priorityClass = `priority-${priority.toLowerCase()}`;

        return `
          <div class="task-item ${task.completed ? 'done' : ''}" data-item-id="${task.id}" data-render-signature="${escHtml(signature)}">
            <div class="task-main">
              <div class="task-title">${escHtml(task.title)}</div>
              <div class="task-meta">
                <span class="meta-pill assignee-pill" style="background:${member.color}">${member.name}</span>
                <span class="meta-pill priority-pill ${priorityClass}">${priority} Priority</span>
                <span class="meta-pill">Due ${formatDateLabel(task.dueDate)}</span>
                ${showCompletedStatus ? `<span class="meta-pill">${statusLabel}</span>` : ''}
              </div>
            </div>
            <div class="task-actions">
              <div class="task-status ${task.completed ? 'done' : 'pending'}">${statusLabel}</div>
              <div class="task-actions-row">
                ${task.completed
                  ? `<button class="btn btn-secondary btn-small" disabled>Done</button>`
                  : (canCompleteTask(task)
                    ? `<button class="btn btn-primary btn-small" onclick="completeTask('${task.id}')">Mark Complete</button>`
                    : `<button class="btn btn-secondary btn-small" disabled>Mark Complete</button>`)
                }
                ${canEditTask(task)
                  ? `<button class="btn btn-secondary btn-small" onclick="editTask('${task.id}')">Edit</button>
                     <button class="btn btn-danger btn-small" onclick="deleteTask('${task.id}')">Delete</button>`
                  : ''
                }
              </div>
            </div>
          </div>
        `;
        }
      });
    }


    function renderSchedule() {
      const grid = document.getElementById('scheduleGrid');

      grid.innerHTML = SCHEDULE_DAYS.map(day => {
        const sectionHtml = SCHEDULE_SECTIONS.map(section => {
          const open = isScheduleSectionOpen(day.weekday, section.key);

          const sectionMembers = state.availabilityBlocks
            .filter(block => block.weekday === day.weekday && section.hours.includes(block.start_hour))
            .map(block => state.memberByDbId.get(block.user_id))
            .filter(Boolean);

          const uniqueMembers = Array.from(new Map(sectionMembers.map(member => [member.dbId, member])).values());

          const blocksHtml = section.hours.map(startHour => {
            const endHour = startHour + 2;

            const matchingBlocks = state.availabilityBlocks.filter(block =>
              block.weekday === day.weekday && block.start_hour === startHour
            );

            const visibleMembers = matchingBlocks
              .map(block => state.memberByDbId.get(block.user_id))
              .filter(Boolean);

            const selectedByMe = isMyAvailabilityBlockSelected(day.weekday, startHour);

            return `
              <div class="slot-item ${selectedByMe ? 'selected-by-me' : ''}" onclick="toggleAvailabilityBlock(${day.weekday}, ${startHour})">
                <div class="slot-time">${formatHourRange(startHour, endHour)}</div>
                <div class="slot-members">
                  ${visibleMembers.length > 0
                    ? visibleMembers.map(member => `<span class="mini-member" style="background:${member.color}">${member.initials}</span>`).join('')
                    : `<span class="meta-pill">No selection</span>`
                  }
                </div>
              </div>
            `;
          }).join('');

          return `
            <div class="schedule-section ${open ? 'open' : ''}">
              <div class="schedule-section-head" onclick="toggleScheduleSection(${day.weekday}, '${section.key}')">
                <div>
                  <div class="schedule-section-title">${section.label}</div>
                  <div class="schedule-section-summary">${uniqueMembers.length} selected</div>
                </div>
                <div class="schedule-section-arrow">${open ? 'Hide' : 'Show'}</div>
              </div>
              <div class="schedule-section-body">
                ${blocksHtml}
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="day-column">
            <div class="day-head">
              <div class="day-name">${day.label}</div>
              <div class="day-sub">${day.shortDate}</div>
            </div>
            <div class="slot-list">${sectionHtml}</div>
          </div>
        `;
      }).join('');

      syncMeetingRecommendationUI();
    }

    function syncMeetingRecommendationUI() {
      renderMeetingRecommendations();
      renderDashboardMeetingRecommendation();
    }

    function renderMeetingRecommendations() {
      const wrap = document.getElementById('meetingRecommendationsWrap');
      if (!wrap) return;

      const slots = getBestMeetingSlots(3);
      if (slots.length === 0) {
        wrap.innerHTML = `<div class="empty-state"><div class="emo">🗓️</div>No recommended meeting slots yet</div>`;
        return;
      }

      wrap.innerHTML = slots.map((slot, index) => `
        <div class="resource-item">
          <div class="resource-main">
            <div class="resource-icon">${index === 0 ? '⭐' : '🕒'}</div>
            <div>
              <div class="resource-name">${slot.weekdayLabel} · ${formatHourRange(slot.startHour, slot.endHour)}</div>
              <div class="resource-meta">${slot.availableCount}/${slot.totalMembers} members available</div>
            </div>
          </div>
          <div class="resource-actions">
            <div class="ack-list">
              ${slot.availableMembers.map(member => `<span class="ack-pill read">${member.initials}</span>`).join('')}
            </div>
          </div>
        </div>
      `).join('');
    }


    function renderDashboardMeetingRecommendation() {
      const wrap = document.getElementById('dashboardMeetingRecommendation');
      if (!wrap) return;

      const topSlot = getRecommendedMeetingSlot();
      if (!topSlot) {
        wrap.innerHTML = `<div class="empty-state"><div class="emo">📅</div>No meeting recommendation yet</div>`;
        return;
      }

      wrap.innerHTML = `
        <div class="due-card">
          <div class="due-left">
            <div class="due-kicker">Best Meeting Time</div>
            <div class="due-title">${topSlot.weekdayLabel} · ${formatHourRange(topSlot.startHour, topSlot.endHour)}</div>
            <div class="due-meta">
              <span>${topSlot.availableCount}/${topSlot.totalMembers} members available</span>
              <span>${topSlot.availableMembers.map(member => member.initials).join(' · ')}</span>
            </div>
          </div>
        </div>
      `;
    }

         

    function renderResources() {
      const el = document.getElementById('resourceList');
      const typeFilter = document.getElementById('resourceTypeFilter');
      const searchInput = document.getElementById('resourceSearchInput');
      const selectedType = typeFilter ? typeFilter.value : 'all';
      const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

      const filteredResources = state.resources.filter(resource => {
        const matchesType = selectedType === 'all' || resource.type === selectedType;
        const matchesSearch = !query || resource.name.toLowerCase().includes(query);
        return matchesType && matchesSearch;
      });
      patchKeyedList(el, filteredResources, {
        emptyHtml: `<div class="empty-state"><div class="emo">📂</div>No matching files found</div>`,
        itemId: resource => resource.id,
        itemSignature: resource => `${resource.id}|${resource.name}|${resource.type}|${resource.size}|${resource.time}|${resource.senderId}|${resource.storagePath || ''}`,
        renderItemHtml: (resource, signature) => {
          const member = state.members[resource.senderId];
          if (!member) return `<div class="resource-item" data-item-id="${resource.id}" data-render-signature="${escHtml(signature)}"></div>`;
          return `
            <div class="resource-item" data-item-id="${resource.id}" data-render-signature="${escHtml(signature)}">
              <div class="resource-main">
                <div class="resource-icon">${resource.icon}</div>
                <div>
                  <div class="resource-name">${escHtml(resource.name)}</div>
                  <div class="resource-meta">${resource.type} · ${resource.size} · Uploaded at ${resource.time}</div>
                </div>
              </div>
              <div class="resource-actions">
                ${resource.storagePath
                  ? `<button class="btn btn-secondary btn-small" onclick="downloadResource('${resource.id}')">Download</button>`
                  : ''
                }
                <div class="resource-by" style="background:${member.color}">${member.name}</div>
              </div>
            </div>
          `;
        }
      });
    }


    function renderNearestDue() {
      const wrap = document.getElementById('nearestDueWrap');
      const upcoming = getNearestDueTask();

      if (!upcoming) {
        wrap.innerHTML = `<div class="empty-state"><div class="emo">⏳</div>No unfinished tasks with a due date</div>`;
        return;
      }

      const member = state.members[upcoming.assigneeId];
      if (!member) {
        wrap.innerHTML = `<div class="empty-state"><div class="emo">⏳</div>No member data for the nearest task</div>`;
        return;
      }

      wrap.innerHTML = `
        <div class="due-card">
          <div class="due-left">
            <div class="due-kicker">⚠ Closest Deadline</div>
            <div class="due-title">${escHtml(upcoming.title)}</div>
            <div class="due-meta">
              <span>Due ${formatDateLabel(upcoming.dueDate)}</span>
              <span>${daysUntilText(upcoming.dueDate)}</span>
            </div>
          </div>
          <div class="due-assignee" style="background:${member.color}">${member.name}</div>
        </div>
      `;
    }


    function renderProgress() {
      const memberList = document.getElementById('memberProgressList');
      if (!memberList) return;

      const totals = state.contributions.map(c => (c?.tasksCompleted || 0) + (c?.filesUploaded || 0));
      const totalUnits = totals.reduce((sum, n) => sum + n, 0);
      const completedTasks = state.tasks.filter(t => t.completed).length;
      const uploadedFiles = state.resources.length;

      memberList.innerHTML = state.members.map((member, i) => {
        const pct = totalUnits > 0 ? Math.round((totals[i] / totalUnits) * 100) : 0;
        return `
          <div class="member-progress-item">
            <div class="member-top">
              <div class="member-dot" style="background:${member.color}"></div>
              <div class="member-name">${member.name}</div>
              <div class="member-percent">${pct}%</div>
            </div>
            <div class="member-mini-bar">
              <div class="member-mini-fill" style="width:${pct}%;background:${member.color}"></div>
            </div>
            <div class="member-stats-row">
              <span class="member-stat-chip">✅ ${(state.contributions[i]?.tasksCompleted) || 0} tasks</span>
              <span class="member-stat-chip">📁 ${(state.contributions[i]?.filesUploaded) || 0} files</span>
            </div>
          </div>
        `;
      }).join('');

      document.getElementById('metricCompleted').textContent = completedTasks;
      document.getElementById('metricFiles').textContent = uploadedFiles;
      document.getElementById('metricUnits').textContent = totalUnits;

      const taskButton = document.querySelector('#view-tasks .btn.btn-primary');
      if (taskButton && !state.editingTaskId) {
        taskButton.textContent = 'Add Task';
      }
    }


    function renderSnapshots() {
      const list = document.getElementById('snapshotList');
      if (!list) return;
      const incompleteTasks = state.tasks.filter(t => !t.completed).length;
      const activeAlerts = getDisplayAlerts().length;
      const nearestTask = getNearestDueTask();

      list.innerHTML = `
        <div class="snapshot-item">
          <div class="snapshot-left">
            <div class="snapshot-label">In Progress Tasks</div>
            <div class="snapshot-value">${incompleteTasks}</div>
          </div>
          <div class="snapshot-pill">task board</div>
        </div>

        <div class="snapshot-item">
          <div class="snapshot-left">
            <div class="snapshot-label">Shared Resources</div>
            <div class="snapshot-value">${state.resources.length}</div>
          </div>
          <div class="snapshot-pill">resource list</div>
        </div>

        <div class="snapshot-item">
          <div class="snapshot-left">
            <div class="snapshot-label">Alerts</div>
            <div class="snapshot-value">${activeAlerts}</div>
          </div>
          <div class="snapshot-pill">notice board</div>
        </div>

        <div class="snapshot-item">
          <div class="snapshot-left">
            <div class="snapshot-label">Nearest Task</div>
            <div class="snapshot-value">${nearestTask ? escHtml(nearestTask.title) : 'None'}</div>
          </div>
          <div class="snapshot-pill">deadline reminder</div>
        </div>
      `;
    }


    function updateStatusChips() {
      document.getElementById('tasksStatusChip').textContent = `${state.tasks.length} tasks · ${state.tasks.filter(t => !t.completed).length} active`;
      document.getElementById('resourcesStatusChip').textContent = `${state.resources.length} files`;
      document.getElementById('dashboardStatusChip').textContent = state.currentGroup
        ? `${state.currentGroup.name} · ${state.tasks.filter(t => !t.completed).length} active tasks · ${getDisplayAlerts().length} alerts`
        : 'Project overview';
    }


    function getNearestDueTask() {
      const upcoming = state.tasks.filter(t => !t.completed).sort(sortByDueDateAsc);
      return upcoming[0] || null;
    }


    function getDisplayAlerts() {
      return [...state.alerts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
