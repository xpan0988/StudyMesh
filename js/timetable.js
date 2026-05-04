// Timetable interactions

    async function toggleAvailabilityBlock(weekday, startHour) {
      if (!state.currentGroup || !state.currentUser) return;

      const existingBlock = state.availabilityBlocks.find(block =>
        block.group_id === state.currentGroup.id &&
        block.user_id === state.currentUser.id &&
        block.weekday === weekday &&
        block.start_hour === startHour
      );

      if (existingBlock) {
        const { error } = await supabaseClient
          .from('availability_blocks')
          .delete()
          .eq('id', existingBlock.id);

        if (error) {
          console.error('toggleAvailabilityBlock delete failed', error);
          showToast('Failed to remove time block', 'alert');
          return;
        }
      } else {
        const { error } = await supabaseClient
          .from('availability_blocks')
          .insert({
            group_id: state.currentGroup.id,
            user_id: state.currentUser.id,
            weekday,
            start_hour: startHour,
            end_hour: startHour + 2
          });

        if (error) {
          console.error('toggleAvailabilityBlock insert failed', error);
          showToast('Failed to save time block', 'alert');
          return;
        }
      }

      await refreshAvailability({ source: 'post-action:update-availability' });
      showToast('Availability updated', 'task');
    }


    function isMyAvailabilityBlockSelected(weekday, startHour) {
      return state.availabilityBlocks.some(block =>
        block.group_id === state.currentGroup?.id &&
        block.user_id === state.currentUser?.id &&
        block.weekday === weekday &&
        block.start_hour === startHour
      );
    }


    function getScheduleSectionStateKey(weekday, sectionKey) {
      return `${weekday}-${sectionKey}`;
    }


    function toggleScheduleSection(weekday, sectionKey) {
      const stateKey = getScheduleSectionStateKey(weekday, sectionKey);
      state.openScheduleSections[stateKey] = !state.openScheduleSections[stateKey];
      renderSchedule();
    }


    function isScheduleSectionOpen(weekday, sectionKey) {
      return !!state.openScheduleSections[getScheduleSectionStateKey(weekday, sectionKey)];
    }


    function getAvailableMembersForSlot(weekday, startHour) {
      const validMembersByDbId = new Map(
        state.members
          .filter(member => member && member.dbId != null)
          .map(member => [member.dbId, member])
      );

      const uniqueMembersById = new Map();

      state.availabilityBlocks
        .filter(block => block.weekday === weekday && block.start_hour === startHour)
        .forEach(block => {
          const member = validMembersByDbId.get(block.user_id);
          if (member) uniqueMembersById.set(member.dbId, member);
        });

      return Array.from(uniqueMembersById.values());
    }


    function getSlotAvailabilityCount(weekday, startHour) {
      return getAvailableMembersForSlot(weekday, startHour).length;
    }


    function isWeekendSlot(weekday) {
      return weekday === 6 || weekday === 7;
    }


    function getSlotScore(weekday, startHour) {
      const availableCount = getSlotAvailabilityCount(weekday, startHour);
      return {
        availableCount,
        isWeekday: !isWeekendSlot(weekday),
        weekdayPriority: -weekday,
        hourPriority: -startHour,
      };
    }


    function getAllCandidateMeetingSlots() {
      return SCHEDULE_DAYS.flatMap(day =>
        SCHEDULE_START_HOURS.map(startHour => {
          const endHour = startHour + 2;
          const availableMembers = getAvailableMembersForSlot(day.weekday, startHour);
          return {
            weekday: day.weekday,
            weekdayLabel: day.label,
            startHour,
            endHour,
            availableMembers,
            availableCount: availableMembers.length,
          };
        })
      );
    }


    function getBestMeetingSlots(limit = 3) {
      const totalMembers = state.members.filter(member => member && member.dbId != null).length;

      return getAllCandidateMeetingSlots()
        .filter(slot => slot.availableCount > 0)
        .sort((a, b) => {
          const aScore = getSlotScore(a.weekday, a.startHour);
          const bScore = getSlotScore(b.weekday, b.startHour);

          if (aScore.availableCount !== bScore.availableCount) {
            return bScore.availableCount - aScore.availableCount;
          }
          if (aScore.isWeekday !== bScore.isWeekday) {
            return Number(bScore.isWeekday) - Number(aScore.isWeekday);
          }
          if (a.weekday !== b.weekday) {
            return a.weekday - b.weekday;
          }
          return a.startHour - b.startHour;
        })
        .slice(0, Math.max(0, limit))
        .map(slot => ({
          ...slot,
          label: `${slot.weekdayLabel} ${formatHourRange(slot.startHour, slot.endHour)}`,
          totalMembers,
        }));
    }


    function getRecommendedMeetingSlot() {
      const bestSlots = getBestMeetingSlots(1);
      return bestSlots[0] || null;
    }
