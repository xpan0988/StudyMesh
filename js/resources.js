// Resource upload and filter actions


    async function handleChatFileInput(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) {
        showToast('Please choose a file to upload', 'alert');
        return;
      }
      if (!state.currentGroup) {
        showToast('Please join or select a group first', 'alert');
        event.target.value = '';
        return;
      }
      if (!state.currentUser) {
        showToast('Please sign in before uploading', 'alert');
        event.target.value = '';
        return;
      }

      const senderId = getCurrentMemberIndex();
      const sender = state.members[senderId];
      if (!sender) {
        showToast('Could not determine uploader', 'alert');
        event.target.value = '';
        return;
      }

      const fileType = inferFileTypeLabel(file);
      const fileSizeLabel = formatFileSize(file.size || 0);
      const icon = getFileIcon(fileType.toLowerCase());

      try {
        const uploadMeta = await uploadResourceBinary(file, state.currentGroup.id, state.currentUser.id);

        await addResource({
          senderId,
          name: file.name,
          icon,
          type: fileType,
          size: fileSizeLabel,
          sizeBytes: uploadMeta.sizeBytes,
          mimeType: uploadMeta.mimeType,
          storagePath: uploadMeta.storagePath,
          bucketName: uploadMeta.bucketName,
          originalName: uploadMeta.originalName
        });
      } catch (error) {
        console.error('handleChatFileInput failed', error);
        showToast('Failed to upload file', 'alert');
        event.target.value = '';
        return;
      }

      event.target.value = '';
      closeComposerPanels();
      switchView('resources');
      showToast(`File uploaded by ${state.members[senderId]?.name || 'A member'}`, 'file');    
    }


    async function addResource(resourceInput) {
      if (!state.currentGroup) return;

      const sender = state.members[resourceInput.senderId];
      if (!sender) return;

      try {
        await createResourceRecord({
          group_id: state.currentGroup.id,
          sender_user_id: sender.dbId,
          name: resourceInput.name,
          original_name: resourceInput.originalName || resourceInput.name,
          type: resourceInput.type,
          size_label: resourceInput.size,
          size_bytes: resourceInput.sizeBytes || 0,
          mime_type: resourceInput.mimeType || '',
          storage_path: resourceInput.storagePath || '',
          bucket_name: resourceInput.bucketName || 'group-files',
          icon: resourceInput.icon
        });

        if (!resourceInput.skipFileMessage) {
          await createFileMessage(state.currentGroup.id, sender.dbId, resourceInput.name);
        }
      } catch (error) {
        console.error('addResource failed', error);
        showToast('Failed to upload resource', 'alert');
        return;
      }

      await refreshResources({ source: 'post-action:add-resource' });
    }


    function populateResourceTypeFilter() {
      const select = document.getElementById('resourceTypeFilter');
      if (!select) return;

      const types = [...new Set(state.resources.map(item => item.type).filter(Boolean))].sort();
      const currentValue = select.value || 'all';

      select.innerHTML = `<option value="all">All Types</option>` +
        types.map(type => `<option value="${type}">${type}</option>`).join('');

      if ([...select.options].some(option => option.value === currentValue)) {
        select.value = currentValue;
      }
    }


    function resetResourceFilters() {
      const typeFilter = document.getElementById('resourceTypeFilter');
      const searchInput = document.getElementById('resourceSearchInput');
      if (typeFilter) typeFilter.value = 'all';
      if (searchInput) searchInput.value = '';
      renderResources();
    }


    function inferFileTypeLabel(file) {
      const name = file?.name || '';
      const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      return ext ? ext.toUpperCase() : 'FILE';
    }


    async function downloadResource(resourceId) {
      const resource = state.resources.find(item => String(item.id) === String(resourceId));
      if (!resource) {
        showToast('Resource not found', 'alert');
        return;
      }
      if (!resource.storagePath) {
        showToast('Download is unavailable for this resource', 'alert');
        return;
      }

      try {
        const signedUrl = await getSignedResourceDownloadUrl(resource);
        if (!signedUrl) {
          throw new Error('Empty signed URL');
        }
        window.open(signedUrl, '_blank', 'noopener');
      } catch (error) {
        console.error('downloadResource failed', error);
        showToast('Failed to generate download link', 'alert');
      }
    }
