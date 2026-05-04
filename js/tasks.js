// Task actions

    function getTaskDueDateInputValue() {
      return document.getElementById('taskDueDate')?.value.trim() || '';
    }

    function setTaskDueDateInput(dateStr) {
      const input = document.getElementById('taskDueDate');
      if (!input) return;
      input.value = isValidDueDateInput(dateStr) ? dateStr : '';
      clearDueDateValidationError();
    }

    function setDueDateValidationError(message = '') {
      const input = document.getElementById('taskDueDate');
      const errorEl = document.getElementById('taskDueDateError');
      if (errorEl) {
        errorEl.textContent = message;
      }
      if (!input) return;
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.removeAttribute('aria-invalid');
    }

    function clearDueDateValidationError() {
      setDueDateValidationError('');
    }

    function normalizeTaskDueDateInput() {
      const input = document.getElementById('taskDueDate');
      const rawValue = getTaskDueDateInputValue();

      if (!rawValue) {
        clearDueDateValidationError();
        return '';
      }

      if (!isValidDueDateInput(rawValue)) {
        setDueDateValidationError('Enter a valid due date in YYYY-MM-DD format.');
        return null;
      }

      const normalizedValue = toIsoDateInput(parseDateInputToDate(rawValue));
      if (input) {
        input.value = normalizedValue;
      }
      clearDueDateValidationError();
      return normalizedValue;
    }

    function initializeTaskDueDateInput() {
      const input = document.getElementById('taskDueDate');
      if (!input || input.dataset.bound === 'true') return;

      input.dataset.bound = 'true';
      input.addEventListener('input', () => {
        const currentValue = getTaskDueDateInputValue();
        if (!currentValue) {
          clearDueDateValidationError();
          return;
        }
        if (isValidDueDateInput(currentValue)) {
          clearDueDateValidationError();
        }
      });
      input.addEventListener('blur', () => {
        normalizeTaskDueDateInput();
      });
    }

    async function addTask() {
      const title = document.getElementById('taskInput').value.trim();
      const assigneeId = parseInt(document.getElementById('taskAssignee').value, 10);
      const dueDateInput = getTaskDueDateInputValue();
      const priority = document.getElementById('taskPriority').value;

      if (!title || !state.currentGroup) return;
      if (!dueDateInput) {
        setDueDateValidationError('Enter a due date in YYYY-MM-DD format.');
        showToast('Please enter a due date in YYYY-MM-DD format', 'alert');
        return;
      }

      const normalizedDueDate = normalizeTaskDueDateInput();
      if (!normalizedDueDate) {
        showToast('Please enter a valid due date in YYYY-MM-DD format', 'alert');
        return;
      }

      const assignee = state.members[assigneeId];
      if (!assignee) return;

      if (state.editingTaskId) {
        const task = state.tasks.find(t => t.id === state.editingTaskId);
        if (!task) return;
        if (!canEditTask(task)) {
          showToast('You can only edit tasks you created', 'alert');
          resetTaskForm();
          return;
        }

        const { error } = await supabaseClient
          .from('tasks')
          .update({
            title,
            assignee_user_id: assignee.dbId,
            due_date: normalizedDueDate,
            priority
          })
          .eq('id', state.editingTaskId);

        if (error) {
          console.error('updateTask failed', error);
          showToast('Failed to update task', 'alert');
          return;
        }

        resetTaskForm();
        await refreshTasks({ source: 'post-action:update-task' });
        showToast(`Task updated for ${state.members[assigneeId]?.name || 'A member'}`, 'task');
        return;
      }

      const { error } = await supabaseClient
        .from('tasks')
        .insert({
          group_id: state.currentGroup.id,
          title,
          assignee_user_id: assignee.dbId,
          due_date: normalizedDueDate,
          priority,
          completed: false,
          created_by: state.currentUser.id
        });

      if (error) {
        console.error('addTask failed', error);
        showToast('Failed to add task', 'alert');
        return;
      }

      resetTaskForm();
      await refreshTasks({ source: 'post-action:add-task' });
      showToast(`Task added for ${assignee.name}`, 'task');
    }


    async function completeTask(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task || task.completed) return;

      const completedAt = new Date().toISOString();
      if (!canCompleteTask(task)) {
        showToast('Only the creator or assignee can complete this task', 'alert');
        return;
      }

      const { error } = await supabaseClient
        .from('tasks')
        .update({
          completed: true,
          completed_at: completedAt
        })
        .eq('id', taskId);

      if (error) {
        console.error('completeTask failed', error);
        showToast('Failed to complete task', 'alert');
        return;
      }

      await refreshTasks({ source: 'post-action:complete-task' });
      showToast(`${state.members[task.assigneeId]?.name || 'A member'} completed a task`, 'task');
    }


    function editTask(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      if (!canEditTask(task)) {
        showToast('You can only edit tasks you created', 'alert');
        return;
      }

      document.getElementById('taskInput').value = task.title;
      document.getElementById('taskAssignee').value = String(task.assigneeId);
      setTaskDueDateInput(task.dueDate);
      document.getElementById('taskPriority').value = task.priority || 'Medium';
      state.editingTaskId = taskId;

      const taskButton = document.querySelector('#view-tasks .btn.btn-primary');
      if (taskButton) taskButton.textContent = 'Save Changes';

      switchView('tasks');
      document.getElementById('taskInput').focus();
    }


    function resetTaskForm() {
      document.getElementById('taskInput').value = '';
      setTaskDueDateInput('');
      document.getElementById('taskPriority').value = 'Medium';
      document.getElementById('taskAssignee').selectedIndex = 0;
      state.editingTaskId = null;

      const taskButton = document.querySelector('#view-tasks .btn.btn-primary');
      if (taskButton) taskButton.textContent = 'Add Task';
    }

    function canEditTask(task) {
      if (!task || !state.currentUser?.id) return false;
      return task.createdByUserId === state.currentUser.id;
    }

    function canCompleteTask(task) {
      if (!task || !state.currentUser?.id) return false;
      return task.assigneeUserId === state.currentUser.id || canEditTask(task);
    }
