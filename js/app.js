// App bootstrap, shared utilities, and remaining actions

// =========================
    // Config / constants
    // =========================
    
// =========================
    // Global app state
    // =========================
    
    // =========================
    // App bootstrap
    // =========================
    async function runStartupPhase(label, work) {
      const timerLabel = `[startup] ${label}`;
      if (DEBUG_LOGS) {
        console.time(timerLabel);
      }
      try {
        return await work();
      } finally {
        if (DEBUG_LOGS) {
          console.timeEnd(timerLabel);
        }
      }
    }

    async function hydrateCurrentGroupData() {
      if (!state.currentGroup) return;

      // Member data is a dependency for mapping user ids in the datasets below.
      await runStartupPhase('loadMembers', loadMembers);

      // Ensure this user can decrypt group messages before loading chat history.
      try {
        await runStartupPhase('ensureGroupContentKey', () => ensureGroupContentKey(state.currentGroup.id));
      } catch (error) {
        // MVP: keep app usable even if key bootstrap/decrypt hits a transient issue.
        console.warn('ensureGroupContentKey failed during hydration', error);
      }

      // These loaders are independent once members are ready.
      await Promise.all([
        runStartupPhase('loadTasks', loadTasks),
        runStartupPhase('loadAlerts', loadAlerts),
        runStartupPhase('loadResources', loadResources),
        runStartupPhase('loadAvailabilityBlocks', loadAvailabilityBlocks),
      ]);

      // Messages include synthetic alert messages, so load after alerts complete.
      await runStartupPhase('loadMessages', loadMessages);
    }

    function renderInitialVisibleSurfaces() {
      renderAvatars();
      populateMemberSelects();
      initializeTaskDueDateInput();
      resetTaskForm();
      refreshAll();
    }

    function buildPostAuthPhaseError(phase, message, cause) {
      const error = new Error(message);
      error.postAuthPhase = phase;
      error.cause = cause;
      return error;
    }

    async function handlePostAuthSuccess() {
      state.e2eeInitWarning = '';
      hideAuthUI();
      try {
        await runStartupPhase('ensureProfile', ensureProfile);
      } catch (error) {
        console.error('[post-auth:profile] ensureProfile failed', error);
        throw buildPostAuthPhaseError('profile', 'Signed in, but failed to initialize your profile.', error);
      }

      try {
        await runStartupPhase('ensureLocalUserKeypair', () => ensureLocalUserKeypair(state.currentUser?.id));
      } catch (error) {
        // Non-fatal: auth/profile may still proceed for onboarding and app access.
        state.e2eeInitWarning = 'Message encryption setup is not ready yet. Chat encryption may be unavailable until this is resolved.';
        console.error('[post-auth:e2ee-user-key] ensureLocalUserKeypair failed (continuing)', error);
      }

      let hasMembership = false;
      try {
        hasMembership = await runStartupPhase('membership resolution', ensureMembershipOrShowOnboarding);
      } catch (error) {
        console.error('[post-auth:membership] ensureMembershipOrShowOnboarding failed', error);
        throw buildPostAuthPhaseError('membership', 'Signed in, but failed to load your group membership state.', error);
      }
      if (!hasMembership) return;

      state.isHydratingInitialData = true;
      try {
        try {
          await runStartupPhase('group hydration', hydrateCurrentGroupData);
        } catch (error) {
          console.error('[post-auth:hydration] hydrateCurrentGroupData failed', error);
          throw buildPostAuthPhaseError('hydration', 'Signed in, but failed to load group data.', error);
        }
        updateHeaderGroupTag();
        seedInitialData();
        try {
          await runStartupPhase('initial render block', async () => renderInitialVisibleSurfaces());
        } catch (error) {
          console.error('[post-auth:render] initial render failed', error);
          throw buildPostAuthPhaseError('render', 'Signed in, but failed to render the app shell.', error);
        }
      } finally {
        state.isHydratingInitialData = false;
      }

      try {
        await runStartupPhase('startGroupPolling', () => startGroupPolling(state.currentGroup?.id));
      } catch (error) {
        console.error('[post-auth:polling] startGroupPolling failed', error);
      }

    }

    async function init() {
      // Note: run StudyMesh from a local HTTP server (for example http://localhost),
      // not from file://, so browser auth/storage APIs can work correctly.
      document.addEventListener('click', function (e) {
        const plusWrap = document.querySelector('.plus-menu-wrap');
        if (plusWrap && !plusWrap.contains(e.target)) {
          document.getElementById('plusMenu').classList.remove('open');
        }
      });

      if (DEBUG_LOGS) {
        console.time('[startup] total');
      }
      await runStartupPhase('initSupabase', initSupabase);
      await runStartupPhase('initAuthStateSync', async () => initAuthStateSync());
      state.isAuthBootstrapping = true;
      if (typeof setAuthActionAvailability === 'function') {
        setAuthActionAvailability(false, 'Restoring previous session…');
      }
      try {
        const session = await runStartupPhase('restoreSession', restoreSession);
        if (!session) {
          showAuthUI();
          return;
        }

        try {
          await handlePostAuthSuccess();
        } catch (postAuthError) {
          console.error('post-auth initialization failed after session restore (auth restored)', {
            phase: postAuthError?.postAuthPhase || 'unknown',
            error: postAuthError
          });
          showAuthUI();
          const statusEl = document.getElementById('authStatusMessage');
          if (statusEl) {
            statusEl.textContent = postAuthError?.message || 'Session restored, but app initialization failed.';
          }
        }
      } finally {
        state.isAuthBootstrapping = false;
        if (typeof setAuthActionAvailability === 'function') {
          const statusEl = document.getElementById('authStatusMessage');
          setAuthActionAvailability(!state.isAuthActionPending, statusEl?.textContent || '');
        }
        if (DEBUG_LOGS) {
          console.timeEnd('[startup] total');
        }
      }
    }



    // =========================
    // Auth / profile / group flow
    // =========================

    // =========================
    // Supabase data loading
    // =========================

    // =========================
    // Timetable interactions
    // =========================

    // =========================
    // Onboarding / group membership flow
    // =========================

    // =========================
    // UI helpers / shared rendering helpers
    // =========================

    function seedInitialData() {
      if (state.members.length === 0 || state.tasks.length > 0 || state.resources.length > 0 || state.messages.length > 0 || state.alerts.length > 0) {
        return;
      }

      const memberCount = state.members.length;
      const safeMember = (index) => index % memberCount;

      addTaskSeed('Create low-fi dashboard sketches', safeMember(0), 'High', offsetDate(1), true);

      if (memberCount >= 2) {
        addTaskSeed('Prepare tutorial demo notes', safeMember(1), 'High', offsetDate(4), false);
      }
      if (memberCount >= 3) {
        addTaskSeed('Refine interview question wording', safeMember(2), 'Medium', offsetDate(2), false);
      }
      if (memberCount >= 4) {
        addTaskSeed('Review final report structure', safeMember(3), 'Low', offsetDate(6), false);
      }

      
    }

    function switchView(view) {
      state.currentView = view;
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
      });
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-' + view).classList.add('active');
      if (view === 'timetable') {
        renderSchedule();
        state.hasRenderedSchedule = true;
      }
    }

    // =========================
    // Chat / alert / resource actions
    // =========================

    // =========================
    // Task actions
    // =========================

    async function deleteTask(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      if (!canEditTask(task)) {
        showToast('You can only delete tasks you created', 'alert');
        return;
      }

      const { error } = await supabaseClient
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) {
        console.error('deleteTask failed', error);
        showToast('Failed to delete task', 'alert');
        return;
      }

      if (state.editingTaskId === taskId) {
        resetTaskForm();
      }

      await refreshTasks({ source: 'post-action:delete-task' });
      showToast(`Task deleted: ${task.title}`, 'task');
    }

    function getCurrentMemberIndex() {
      return state.memberIndexByDbId.get(state.currentUser?.id) ?? -1;
    }

    function addTaskSeed(title, assigneeId, priority, dueDate, completed) {
      const task = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        title,
        assigneeId,
        priority,
        dueDate,
        completed,
        createdAt: new Date().toISOString(),
        completedAt: completed ? new Date().toISOString() : null,
      };

      state.tasks.push(task);
      if (completed) state.contributions[assigneeId].tasksCompleted += 1;
    }

    

    function sortByDueDateAsc(a, b) {
      return parseDateInputToDate(a.dueDate) - parseDateInputToDate(b.dueDate);
    }

    function formatTime(date) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function formatDateLabel(dateStr) {
      const date = parseDateInputToDate(dateStr);
      if (Number.isNaN(date.getTime())) return 'Invalid date';
      const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const day = String(date.getDate()).padStart(2, '0');
      const month = monthLabels[date.getMonth()] || '—';
      const year = date.getFullYear();
      return `${day} ${month} ${year}`;
    }

    function formatHourRange(startHour, endHour) {
      const pad = (value) => String(value).padStart(2, '0');
      const normalizedEnd = endHour === 24 ? '24:00' : `${pad(endHour)}:00`;
      return `${pad(startHour)}:00–${normalizedEnd}`;
    }

    function offsetDate(days) {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date.toISOString().slice(0, 10);
    }

    function daysUntilText(dateStr) {
      const now = new Date();
      const due = parseDateInputToDate(dateStr);
      if (Number.isNaN(due.getTime())) return 'Due date unavailable';
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

      if (diff <= 0) return 'Due today';
      if (diff === 1) return 'Due in 1 day';
      return `Due in ${diff} days`;
    }

    function isValidDueDateInput(dateStr) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return false;
      const date = parseDateInputToDate(dateStr);
      return !Number.isNaN(date.getTime()) && toIsoDateInput(date) === dateStr;
    }

    function parseDateInputToDate(dateStr) {
      const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return new Date('invalid');
      const year = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      const day = Number(match[3]);
      return new Date(year, monthIndex, day);
    }

    function toIsoDateInput(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    function formatFileSize(bytes) {
      const mb = bytes / 1024 / 1024;
      return mb < 1 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${mb.toFixed(1)}MB`;
    }

    function getFileIcon(ext) {
      const map = {
        pdf: '📄',
        doc: '📝',
        docx: '📝',
        txt: '📃',
        xls: '📋',
        xlsx: '📋',
        png: '🖼️',
        jpg: '🖼️',
        jpeg: '🖼️',
        fig: '🎨',
        csv: '📊',
        html: '🌐',
        css: '🎨',
        js: '💛'
      };
      return map[ext] || '📎';
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showToast(message, type = 'chat') {
      const wrap = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.textContent = message;
      wrap.appendChild(toast);
      setTimeout(() => toast.remove(), 3200);
    }

    init();
