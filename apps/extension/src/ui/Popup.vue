<template>
  <div class="copilot-shell">
    <ShellHeader
      :is-running="agent.isRunning.value"
      :offline="health.offline.value"
      :has-messages="chat.visibleMessages.value.length > 0"
      :status-label="statusLabel"
      :show-activity="chat.showActivity.value"
      :theme="theme.theme.value"
      @new-chat="startNewChat"
      @stop-agent="stopAgent"
      @toggle-activity="toggleActivity"
      @toggle-theme="theme.toggleTheme"
    />

    <ChatFeed
      ref="chatFeedRef"
      :is-hydrated="chat.isHydrated.value"
      :is-running="agent.isRunning.value"
      :visible-messages="chat.visibleMessages.value"
      :live-phase-label="agent.livePhaseLabel.value"
      :live-status-detail="agent.liveStatusDetail.value"
      :live-thought-lines="chat.showActivity.value ? chat.liveThoughtLines.value : []"
      :show-activity="chat.showActivity.value"
    />

    <ComposerBar
      v-model="draft"
      :is-running="agent.isRunning.value"
      :can-send="canSend"
      @submit="submitPrompt"
    />

    <ApprovalModal
      :approval-request="approval.approvalRequest.value"
      :risk-label="approval.approvalRiskLabel.value"
      :headline="approval.approvalHeadline.value"
      :description="approval.approvalDescription.value"
      :risk-explanation="approval.approvalRiskExplanation.value"
      @approve="approval.approveApproval"
      @reject="approval.rejectApproval"
    />

    <ErrorBanner
      :offline="health.offline.value"
      :error-message="errorMessage"
      :can-retry="canRetryLastPrompt"
      @retry-health="health.checkBackendHealth"
      @retry="retryLastPrompt"
      @dismiss="clearError"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import ShellHeader from './components/ShellHeader.vue';
import ChatFeed from './components/ChatFeed.vue';
import ComposerBar from './components/ComposerBar.vue';
import ApprovalModal from './components/ApprovalModal.vue';
import ErrorBanner from './components/ErrorBanner.vue';

import { useAgent } from './composables/useAgent.js';
import { useChat } from './composables/useChat.js';
import { useApproval } from './composables/useApproval.js';
import { useHealth } from './composables/useHealth.js';
import { useTheme } from './composables/useTheme.js';
import { sendRuntimeMessage } from './composables/useRuntime.js';

const agent = useAgent();
const chat = useChat();
const approval = useApproval();
const health = useHealth();
const theme = useTheme();

const draft = ref('');
const errorMessage = ref(null);
const lastPrompt = ref('');
const chatFeedRef = ref(null);
let errorTimeoutId = null;

const canSend = computed(() => draft.value.trim().length > 0 && !agent.isRunning.value);
const canRetryLastPrompt = computed(() => Boolean(lastPrompt.value) && !agent.isRunning.value);

const statusLabel = computed(() => {
  if (agent.isRunning.value) return 'Live';
  if (health.offline.value) return 'Offline';
  return 'Ready';
});

function clearError() {
  errorMessage.value = null;
  if (errorTimeoutId) {
    clearTimeout(errorTimeoutId);
    errorTimeoutId = null;
  }
}

function showTransientError(message) {
  clearError();
  errorMessage.value = message;
  errorTimeoutId = setTimeout(() => {
    errorMessage.value = null;
    errorTimeoutId = null;
  }, 5000);
}

async function submitPrompt() {
  const goal = draft.value.trim();
  if (!goal || agent.isRunning.value) return;

  clearError();
  health.offline.value = false;
  draft.value = '';
  agent.isRunning.value = true;
  lastPrompt.value = goal;
  agent.phase.value = 'reading';
  agent.phaseDetail.value = 'Collecting the current page context before asking the model.';
  chat.resetLiveThoughts();
  chat.pushLiveThought('Opening the current page and collecting visible context');

  chat.messages.value.push({
    role: 'user',
    content: goal,
    timestamp: Date.now(),
  });
  await chat.scrollChatToBottom();

  try {
    const response = await sendRuntimeMessage({ action: 'startAgent', goal });

    if (response?.error) throw new Error(response.error);

    if (response?.chatHistory) {
      chat.messages.value = response.chatHistory;
      await chat.scrollChatToBottom();
    }

    agent.phase.value = 'idle';
    agent.phaseDetail.value = 'Ready for your next request.';
  } catch (error) {
    const message = error.message || 'Failed to start agent.';
    health.offline.value = health.isConnectivityError(message);
    showTransientError(message);
    agent.phase.value = 'idle';
    agent.phaseDetail.value = health.offline.value
      ? 'The backend connection looks unavailable.'
      : 'The agent could not start on this page.';
  } finally {
    agent.isRunning.value = false;
    chat.resetLiveThoughts();
  }
}

async function retryLastPrompt() {
  if (!canRetryLastPrompt.value) return;
  draft.value = lastPrompt.value;
  await submitPrompt();
}

async function stopAgent() {
  try {
    await sendRuntimeMessage({ action: 'stopAgent' });
  } catch (error) {
    console.error('Failed to stop agent', error);
  } finally {
    agent.isRunning.value = false;
    agent.phase.value = 'stopped';
    agent.phaseDetail.value = 'Agent run stopped.';
    chat.resetLiveThoughts();
  }
}

async function startNewChat() {
  try {
    const response = await sendRuntimeMessage({ action: 'clearChat' });
    if (response?.error) throw new Error(response.error);

    chat.messages.value = [];
    draft.value = '';
    errorMessage.value = null;
    health.offline.value = false;
    approval.approvalRequest.value = null;
    agent.resetAgentState();
    chat.resetLiveThoughts();
  } catch (error) {
    showTransientError(error.message || 'Could not start a new chat.');
  }
}

function toggleActivity() {
  chat.showActivity.value = !chat.showActivity.value;
  if (!chat.showActivity.value) {
    chat.resetLiveThoughts();
  }
}

function handleRuntimeMessage(message) {
  if (message.action === 'pageContextChanged') {
    return;
  }

  if (message.action === 'updateReasoning') {
    agent.currentThought.value = message.thought || '';
    agent.currentAction.value = message.actionName || message.action || '';
    agent.currentActionInput.value = message.actionInput || null;
    agent.phase.value = 'thinking';
    agent.phaseDetail.value = agent.currentAction.value
      ? `Planning: ${agent.currentAction.value}`
      : 'Reasoning about the next step.';
    chat.pushLiveThought(agent.polishedStage.value);
    chat.pushLiveThought(agent.polishedAction.value);
    return;
  }

  if (message.action === 'updateProgress') {
    return;
  }

  if (message.action === 'requestApproval') {
    approval.setApprovalRequest(message);
    agent.phase.value = 'acting';
    agent.phaseDetail.value = 'Waiting for your approval to continue.';
    chat.pushLiveThought('Waiting for approval before continuing');
    return;
  }

  if (message.action === 'updateStatus') {
    agent.applyStatusUpdate(message);
    if (message.phase === 'reading') chat.pushLiveThought('Scanning the current page');
    if (message.phase === 'thinking') chat.pushLiveThought('Understanding the request');
    if (message.phase === 'acting') chat.pushLiveThought(agent.polishedAction.value);
    if (message.phase === 'finalizing') chat.pushLiveThought('Composing the response');
  }
}

watch(
  [chat.visibleMessages, agent.isRunning, agent.phaseDetail, chat.liveThoughtLines],
  () => chat.scrollChatToBottom(),
  { deep: true, flush: 'post' }
);

onMounted(async () => {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  const response = await chat.syncHistory();
  if (response) {
    agent.isRunning.value = Boolean(response.isRunning);
    if (response.isRunning) {
      agent.phase.value = 'thinking';
      agent.phaseDetail.value = response.currentGoal
        ? `Continuing: ${response.currentGoal}`
        : 'Resuming the current agent run.';
    }
  }

  // Bind scroll observers to the ChatFeed's internal scroller
  const feedEl = chatFeedRef.value?.chatScrollerRef;
  if (feedEl) {
    chat.chatScroller.value = feedEl;
    chat.bindChatAutoScrollObservers();
  }

  await chat.scrollChatToBottom();
  health.startHealthCheckPolling();
  theme.loadTheme();});

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  chat.destroyScrollObservers();
  health.stopHealthCheckPolling();
  if (errorTimeoutId) {
    clearTimeout(errorTimeoutId);
    errorTimeoutId = null;
  }
});
</script>
