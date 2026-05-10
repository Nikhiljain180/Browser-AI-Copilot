import { ref, computed } from 'vue';

export function useAgent() {
  const isRunning = ref(false);
  const phase = ref('idle');
  const phaseDetail = ref('Ready for your next request.');
  const currentThought = ref('');
  const currentAction = ref('');
  const currentActionInput = ref(null);

  const statusLabel = computed(() => {
    if (isRunning.value) return 'Live';
    return 'Ready';
  });

  const livePhaseLabel = computed(() => {
    const phaseLabels = {
      reading: 'Reading page',
      thinking: 'Thinking',
      acting: 'Taking action',
      finalizing: 'Finalizing',
      stopped: 'Stopped',
      idle: 'Ready',
    };
    return phaseLabels[phase.value] || 'Working';
  });

  const liveStatusDetail = computed(() => {
    if (phaseDetail.value) return phaseDetail.value;
    if (polishedAction.value) return polishedAction.value;
    return 'Working through your request and preparing the next update.';
  });

  const polishedStage = computed(() => {
    const phaseMap = {
      reading: 'Scanning the current page',
      thinking: 'Understanding the request',
      acting: 'Using page tools',
      finalizing: 'Composing the response',
      stopped: 'Run stopped',
      idle: 'Waiting for your next request',
    };
    return phaseMap[phase.value] || 'Working through the current request';
  });

  const polishedAction = computed(() => {
    const action = String(currentAction.value || '').trim();
    if (!action) {
      if (phase.value === 'reading') return 'Building a structured view of the page';
      if (phase.value === 'thinking') return 'Looking for the best next step';
      if (phase.value === 'finalizing') return 'Turning the result into a clear answer';
      return 'Preparing the next update';
    }

    const actionMap = {
      read_page: 'Inspecting visible content and interactive elements',
      click_element: 'Interacting with a page element',
      fill_input: 'Filling the selected field',
      extract_data: 'Pulling structured information from the page',
      draft_reply: 'Drafting a response for the current context',
      summarize_page: 'Summarizing the most relevant content',
      request_approval: 'Waiting for approval before continuing',
      final_answer: 'Preparing the final response',
    };

    return actionMap[action] || action.replaceAll('_', ' ');
  });

  function applyStatusUpdate(status) {
    if (!status) return;
    if (status.phase) phase.value = status.phase;
    if (status.detail) phaseDetail.value = status.detail;
    if (typeof status.isRunning === 'boolean') isRunning.value = status.isRunning;
  }

  function resetAgentState() {
    currentThought.value = '';
    currentAction.value = '';
    currentActionInput.value = null;
    isRunning.value = false;
    phase.value = 'idle';
    phaseDetail.value = 'Ready for your next request.';
  }

  return {
    isRunning,
    phase,
    phaseDetail,
    currentThought,
    currentAction,
    currentActionInput,
    statusLabel,
    livePhaseLabel,
    liveStatusDetail,
    polishedStage,
    polishedAction,
    applyStatusUpdate,
    resetAgentState,
  };
}
