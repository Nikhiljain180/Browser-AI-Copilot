<template>
  <div class="copilot-shell">
    <header class="shell-header">
      <div>
        <p class="eyebrow">Browser AI Copilot</p>
        <h1>Agent workspace</h1>
        <p class="header-subtitle">
          Browse, ask, and automate from a full-height side panel.
        </p>
      </div>

      <div class="header-actions">
        <div :class="['status-pill', isRunning ? 'live' : offline ? 'offline' : 'idle']">
          <span class="status-dot" />
          {{ statusLabel }}
        </div>

        <button
          v-if="!isRunning && visibleMessages.length > 0"
          class="icon-button"
          type="button"
          title="Start a new chat"
          @click="startNewChat"
        >
          New chat
        </button>

        <button
          v-if="isRunning"
          class="icon-button danger"
          type="button"
          title="Stop agent"
          @click="stopAgent"
        >
          Stop
        </button>
      </div>
    </header>

    <main ref="chatScroller" class="chat-feed">
      <div v-if="!isHydrated" class="history-skeleton">
        <div v-for="row in 3" :key="row" :class="['skeleton-row', row % 2 === 0 ? 'user' : 'assistant']">
          <div class="skeleton-avatar" />
          <div class="skeleton-card">
            <div class="skeleton-line short" />
            <div class="skeleton-line" />
            <div class="skeleton-line medium" />
          </div>
        </div>
      </div>

      <div v-else-if="visibleMessages.length === 0" class="empty-state">
        <div class="empty-icon">AI</div>
        <h2>Ask anything about the current page</h2>
        <p>
          Try research, summaries, form filling, or guided actions. The panel will show
          live progress while the agent works.
        </p>
      </div>

      <template v-else>
        <article
          v-for="(message, index) in visibleMessages"
          :key="`${message.timestamp || index}-${message.role}-${index}`"
          :class="['message-row', message.role]"
          data-testid="chat-message"
        >
          <div class="avatar">
            {{ message.role === 'user' ? 'You' : 'AI' }}
          </div>

          <div class="message-card" :data-testid="message.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'">
            <div class="message-meta">
              <span class="message-role">
                {{ message.role === 'user' ? 'You' : 'Copilot' }}
              </span>
              <span>{{ formatTime(message.timestamp) }}</span>
            </div>

            <template v-if="getStructuredTable(message.content)">
              <div class="message-table-wrap">
                <table class="message-table">
                  <thead>
                    <tr>
                      <th
                        v-for="column in getStructuredTable(message.content).columns"
                        :key="`${index}-${column}`"
                      >
                        {{ formatColumnLabel(column) }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(row, rowIndex) in getStructuredTable(message.content).rows"
                      :key="`${index}-row-${rowIndex}`"
                    >
                      <td
                        v-for="column in getStructuredTable(message.content).columns"
                        :key="`${index}-${rowIndex}-${column}`"
                      >
                        {{ row[column] ?? '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <template v-else-if="getMessageList(message.content).length">
              <ul class="message-list">
                <li
                  v-for="(item, itemIndex) in getMessageList(message.content)"
                  :key="`${index}-${itemIndex}`"
                  v-html="formatRichText(item)"
                ></li>
              </ul>
            </template>
            <p v-else class="message-content" v-html="formatRichText(message.content)" />
            
            <div v-if="message.toolsUsed && message.toolsUsed.length > 0" class="tool-badges">
              <span v-for="tool in message.toolsUsed" :key="tool" class="tool-badge">
                🔧 {{ tool }}
              </span>
            </div>
          </div>
        </article>
      </template>

      <article v-if="isRunning" class="message-row assistant pending" data-testid="chat-message-pending">
        <div class="avatar">AI</div>

        <div class="message-card pending-card">
          <div class="message-meta">
            <span class="message-role">Copilot</span>
            <span>{{ livePhaseLabel }}</span>
          </div>

          <p class="message-content">
            {{ liveStatusDetail }}
          </p>

          <transition-group name="thought-stream" tag="div" class="thought-stream">
            <div v-for="line in liveThoughtLines" :key="line.id" class="thought-line">
              <span class="thought-line-dot" />
              <span>{{ line.text }}</span>
            </div>
          </transition-group>

          <div class="typing-indicator" aria-label="Agent is working">
            <span />
            <span />
            <span />
          </div>
        </div>
      </article>
      <div ref="chatEndAnchor" class="chat-end-anchor" aria-hidden="true" />
    </main>

    <footer class="composer-shell">
      <div class="composer-card">
        <textarea
          v-model="draft"
          class="composer-input"
          rows="1"
          placeholder="Message the copilot..."
          data-testid="composer-input"
          @keydown.enter.exact.prevent="submitPrompt"
          @keydown.meta.enter.prevent="submitPrompt"
          @keydown.ctrl.enter.prevent="submitPrompt"
        />

        <div class="composer-actions">
          <span class="composer-hint">
            {{ isRunning ? 'Agent is working. You can stop it any time.' : 'Enter to send, Ctrl/Cmd+Enter also works.' }}
          </span>

          <button
            class="send-button"
            type="button"
            :disabled="!canSend"
            data-testid="composer-send"
            @click="submitPrompt"
          >
            <span v-if="isRunning" class="button-spinner" />
            {{ isRunning ? 'Working' : 'Send' }}
          </button>
        </div>
      </div>
    </footer>

    <transition name="fade">
      <div v-if="approvalRequest" class="modal-backdrop">
        <div class="approval-modal" data-testid="approval-modal">
          <div class="modal-header">
            <div>
              <p class="eyebrow">Approval required</p>
              <h2>Review action before continuing</h2>
            </div>
            <button class="icon-button" type="button" data-testid="approval-close" @click="rejectApproval">
              Close
            </button>
          </div>

          <div class="modal-body">
            <div :class="['risk-pill', approvalRequest.riskLevel]">
              {{ approvalRiskLabel }}
            </div>

            <div class="approval-summary">
              <h3>{{ approvalHeadline }}</h3>
              <p>{{ approvalDescription }}</p>
            </div>

            <div class="approval-note">
              <span class="block-label">Why approval is needed</span>
              <p>{{ approvalRiskExplanation }}</p>
            </div>
          </div>

          <div class="modal-footer">
            <button class="secondary-button" type="button" data-testid="reject-button" @click="rejectApproval">
              Reject
            </button>
            <button class="send-button approve" type="button" data-testid="approve-button" @click="approveApproval">
              Approve
            </button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="offline" class="banner offline-banner">
        <span>🔴 Backend Unavailable — The AI Copilot proxy server is unreachable</span>
        <div class="banner-actions">
          <button class="icon-button" type="button" @click="checkBackendHealth">
            Retry
          </button>
        </div>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="errorMessage" class="banner error-banner">
        <span>{{ errorMessage }}</span>
        <div class="banner-actions">
          <button
            v-if="canRetryLastPrompt"
            class="icon-button"
            type="button"
            @click="retryLastPrompt"
          >
            Retry
          </button>
          <button class="icon-button" type="button" @click="clearError">Dismiss</button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

const draft = ref('');
const messages = ref([]);
const isHydrated = ref(false);
const isRunning = ref(false);
const offline = ref(false);
const errorMessage = ref(null);
const approvalRequest = ref(null);
const currentThought = ref('');
const currentAction = ref('');
const currentActionInput = ref(null);
const phase = ref('idle');
const phaseDetail = ref('Ready for your next request.');
const chatScroller = ref(null);
const chatEndAnchor = ref(null);
const liveThoughtLines = ref([]);
const lastPrompt = ref('');
let errorTimeoutId = null;
let liveThoughtId = 0;
let chatMutationObserver = null;
let chatResizeObserver = null;
let healthCheckIntervalId = null;

const visibleMessages = computed(() => {
  return messages.value.filter(message => message.role !== 'tool');
});

const canSend = computed(() => draft.value.trim().length > 0 && !isRunning.value);
const canRetryLastPrompt = computed(() => {
  return Boolean(lastPrompt.value) && !isRunning.value;
});

const statusLabel = computed(() => {
  if (isRunning.value) return 'Live';
  if (offline.value) return 'Offline';
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

  if (phase.value && phaseMap[phase.value]) {
    return phaseMap[phase.value];
  }

  return 'Working through the current request';
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
    final_answer: 'Preparing the final response'
  };

  return actionMap[action] || action.replaceAll('_', ' ');
});

const approvalRiskLabel = computed(() => {
  if (approvalRequest.value?.riskLevel === 'high') return 'High risk action';
  return 'Medium risk action';
});

const approvalHeadline = computed(() => {
  if (!approvalRequest.value) return '';

  const explicit = String(approvalRequest.value.actionDescription || '').trim();
  if (explicit) {
    return explicit.replace(/\s+/g, ' ');
  }

  const description = String(approvalRequest.value.toolInput?.description || '').trim();
  if (description) {
    return description.replace(/\s+/g, ' ');
  }

  if (approvalRequest.value.toolName === 'click_element') {
    return 'Proceed with this page action?';
  }

  return 'Review this action before continuing';
});

const approvalDescription = computed(() => {
  if (!approvalRequest.value) return '';

  if (approvalRequest.value.toolName === 'click_element') {
    return 'The copilot is ready to continue with an action on the current page. Once approved, it will perform that action immediately.';
  }

  return 'The copilot is asking for confirmation before it continues.';
});

const approvalRiskExplanation = computed(() => {
  if (!approvalRequest.value) return '';

  if (approvalRequest.value.toolName === 'click_element') {
    return 'This may submit information, trigger navigation, or cause a change that is hard to undo.';
  }

  return 'This action could affect the current page or your data, so confirmation is required first.';
});

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTime(timestamp) {
  if (!timestamp) return 'Just now';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(response);
    });
  });
}

function getMessageList(content) {
  if (Array.isArray(content) && content.every(item => typeof item === 'string')) {
    return content;
  }

  if (typeof content !== 'string') return [];

  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
      return parsed;
    }
  } catch {
    const compact = normalized.replace(/\r/g, '');
    if (compact.startsWith('[') && compact.endsWith(']')) {
      const matches = [...compact.matchAll(/"([^"\n]+)"/g)].map(match => match[1]);
      if (matches.length > 0) {
        return matches;
      }
    }
  }

  // Markdown-style bullet / numbered lists.
  const lines = normalized.replace(/\r/g, '').split('\n');
  const items = [];
  for (const line of lines) {
    const bulletMatch = line.match(/^\s*(?:[-*•])\s+(.+?)\s*$/);
    if (bulletMatch?.[1]) {
      items.push(bulletMatch[1]);
      continue;
    }
    const numberedMatch = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
    if (numberedMatch?.[1]) {
      items.push(numberedMatch[1]);
    }
  }
  if (items.length > 0) return items;

  return [];
}

function parseStructuredContent(content) {
  if (Array.isArray(content)) {
    return content;
  }

  if (typeof content !== 'string') return null;

  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function getStructuredTable(content) {
  const parsed = parseStructuredContent(content);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
    return null;
  }

  const columns = [...new Set(parsed.flatMap(row => Object.keys(row)))];
  if (columns.length === 0) return null;

  const rows = parsed.map(row => {
    const normalizedRow = {};
    columns.forEach(column => {
      const value = row[column];
      normalizedRow[column] =
        value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
    return normalizedRow;
  });

  return { columns, rows };
}

function formatColumnLabel(column) {
  return String(column || '')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function formatRichText(content) {
  const escaped = escapeHtml(content);

  const withMarkdownLinks = escaped.replace(
    /\[([^\]]+?)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label, url) => {
      const safeUrl = escapeHtmlAttribute(url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
  );

  const withBareLinks = withMarkdownLinks.replace(
    /(https?:\/\/[^\s<]+?)([).,!?;:]?)(?=\s|$)/g,
    (_, url, trailing) => {
      const safeUrl = escapeHtmlAttribute(url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing || ''}`;
    }
  );

  return withBareLinks
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

async function syncHistory() {
  try {
    let hasStoredHistory = false;
    const storageData = await chrome.storage.local.get('agentState');
    if (storageData?.agentState) {
      messages.value = storageData.agentState.chatHistory || [];
      isRunning.value = Boolean(storageData.agentState.isRunning);
      hasStoredHistory = messages.value.length > 0;
      isHydrated.value = true;
    }

    const response = await sendRuntimeMessage({ action: 'getChatHistory' });
    const runtimeHistory = response?.history || [];
    if (runtimeHistory.length > 0 || !hasStoredHistory) {
      messages.value = runtimeHistory;
    }
    isRunning.value = Boolean(response?.isRunning ?? isRunning.value);

    if (response?.isRunning) {
      phase.value = 'thinking';
      phaseDetail.value = response?.currentGoal
        ? `Continuing: ${response.currentGoal}`
        : 'Resuming the current agent run.';
    }
  } catch (error) {
    console.error('Failed to load chat history', error);
  } finally {
    isHydrated.value = true;
    await scrollChatToBottom();
  }
}

function applyStatusUpdate(status) {
  if (!status) return;
  if (status.phase) phase.value = status.phase;
  if (status.detail) phaseDetail.value = status.detail;
  if (typeof status.isRunning === 'boolean') isRunning.value = status.isRunning;
}

function pushLiveThought(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return;

  const previous = liveThoughtLines.value[0];
  if (previous?.text === normalized) return;

  const entry = { id: ++liveThoughtId, text: normalized };
  liveThoughtLines.value = [entry];
}

function resetLiveThoughts() {
  liveThoughtLines.value = [];
}

async function scrollChatToBottom() {
  await nextTick();

  const scroller = chatScroller.value;
  if (!scroller) return;

  const forceScroll = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };

  forceScroll();
  requestAnimationFrame(forceScroll);
  setTimeout(forceScroll, 48);
  setTimeout(forceScroll, 140);
}

function bindChatAutoScrollObservers() {
  const scroller = chatScroller.value;
  if (!scroller) return;

  chatMutationObserver?.disconnect();
  chatResizeObserver?.disconnect();

  const forceBottom = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };

  chatMutationObserver = new MutationObserver(() => {
    forceBottom();
    requestAnimationFrame(forceBottom);
  });

  chatMutationObserver.observe(scroller, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  if (typeof ResizeObserver !== 'undefined') {
    chatResizeObserver = new ResizeObserver(() => {
      forceBottom();
    });
    chatResizeObserver.observe(scroller);
  }
}

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
  if (!goal || isRunning.value) return;

  clearError();
  offline.value = false;
  draft.value = '';
  isRunning.value = true;
  lastPrompt.value = goal;
  phase.value = 'reading';
  phaseDetail.value = 'Collecting the current page context before asking the model.';
  resetLiveThoughts();
  pushLiveThought('Opening the current page and collecting visible context');

  messages.value.push({
    role: 'user',
    content: goal,
    timestamp: Date.now(),
  });
  await scrollChatToBottom();

  try {
    const response = await sendRuntimeMessage({
      action: 'startAgent',
      goal,
    });

    if (response?.error) {
      throw new Error(response.error);
    }

    if (response?.chatHistory) {
      messages.value = response.chatHistory;
      await scrollChatToBottom();
    }

    phase.value = 'idle';
    phaseDetail.value = 'Ready for your next request.';
  } catch (error) {
    const message = error.message || 'Failed to start agent.';
    offline.value = isConnectivityError(message);
    showTransientError(message);
    phase.value = 'idle';
    phaseDetail.value = offline.value
      ? 'The backend connection looks unavailable.'
      : 'The agent could not start on this page.';
  } finally {
    isRunning.value = false;
    resetLiveThoughts();
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
    isRunning.value = false;
    phase.value = 'stopped';
    phaseDetail.value = 'Agent run stopped.';
    resetLiveThoughts();
  }
}

/**
 * Check backend health status
 * Updates offline state based on proxy availability
 */
async function checkBackendHealth() {
  try {
    const backendURL = 'http://127.0.0.1:3000/api/health';
    const response = await fetch(backendURL, {
      method: 'GET',
      timeout: 5000,
    });

    if (response.ok) {
      offline.value = false;
    } else {
      offline.value = true;
    }
  } catch (error) {
    // Backend unreachable
    offline.value = true;
  }
}

/**
 * Start periodic backend health checks
 * Checks every 30 seconds
 */
function startHealthCheckPolling() {
  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId);
  }

  checkBackendHealth();
  healthCheckIntervalId = setInterval(checkBackendHealth, 30000);
}

/**
 * Stop health check polling
 */
function stopHealthCheckPolling() {
  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId);
    healthCheckIntervalId = null;
  }
}

async function startNewChat() {
  try {
    const response = await sendRuntimeMessage({ action: 'clearChat' });
    if (response?.error) {
      throw new Error(response.error);
    }

    messages.value = [];
    draft.value = '';
    errorMessage.value = null;
    offline.value = false;
    approvalRequest.value = null;
    currentThought.value = '';
    currentAction.value = '';
    currentActionInput.value = null;
    isRunning.value = false;
    phase.value = 'idle';
    phaseDetail.value = 'Ready for your next request.';
    resetLiveThoughts();
  } catch (error) {
    showTransientError(error.message || 'Could not start a new chat.');
  }
}

async function approveApproval() {
  if (!approvalRequest.value) return;
  await sendRuntimeMessage({
    action: 'approveAction',
    actionId: approvalRequest.value.id,
  });
  approvalRequest.value = null;
}

async function rejectApproval() {
  if (!approvalRequest.value) return;
  await sendRuntimeMessage({
    action: 'rejectAction',
    actionId: approvalRequest.value.id,
  });
  approvalRequest.value = null;
}

function handleRuntimeMessage(message) {
  if (message.action === 'pageContextChanged') {
    schedulePromptRefresh();
    return;
  }

  if (message.action === 'updateReasoning') {
    currentThought.value = message.thought || '';
    currentAction.value = message.actionName || message.action || '';
    currentActionInput.value = message.actionInput || null;
    phase.value = 'thinking';
    phaseDetail.value = currentAction.value
      ? `Planning: ${currentAction.value}`
      : 'Reasoning about the next step.';
    pushLiveThought(polishedStage.value);
    pushLiveThought(polishedAction.value);
    return;
  }

  if (message.action === 'updateProgress') {
    return;
  }

  if (message.action === 'requestApproval') {
    approvalRequest.value = {
      id: message.approvalId,
      toolName: message.toolName,
      toolInput: message.toolInput,
      riskLevel: message.riskLevel || 'medium',
      actionDescription: message.actionDescription || '',
    };
    phase.value = 'acting';
    phaseDetail.value = 'Waiting for your approval to continue.';
    pushLiveThought('Waiting for approval before continuing');
    return;
  }

  if (message.action === 'updateStatus') {
    applyStatusUpdate(message);
    if (message.phase === 'reading') pushLiveThought('Scanning the current page');
    if (message.phase === 'thinking') pushLiveThought('Understanding the request');
    if (message.phase === 'acting') pushLiveThought(polishedAction.value);
    if (message.phase === 'finalizing') pushLiveThought('Composing the response');
  }
}

function isConnectivityError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('failed to fetch') ||
    normalized.includes('backend') ||
    normalized.includes('networkerror') ||
    normalized.includes('network error') ||
    normalized.includes('llm api error') ||
    normalized.includes('load failed');
}

watch(
  [visibleMessages, isRunning, currentThought, currentAction, phaseDetail, liveThoughtLines],
  scrollChatToBottom,
  { deep: true, flush: 'post' }
);

watch(
  () => [isHydrated.value, visibleMessages.value.length],
  ([hydrated, count]) => {
    if (hydrated && count > 0) {
      scrollChatToBottom();
    }
  },
  { flush: 'post' }
);

onMounted(async () => {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  await syncHistory();
  bindChatAutoScrollObservers();
  await scrollChatToBottom();
  startHealthCheckPolling();
});

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  chatMutationObserver?.disconnect();
  chatResizeObserver?.disconnect();
  stopHealthCheckPolling();
  if (errorTimeoutId) {
    clearTimeout(errorTimeoutId);
    errorTimeoutId = null;
  }
});
</script>

<style scoped>
.tool-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.75rem;
}

.tool-badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-secondary);
  background-color: var(--bg-tertiary);
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  border: 1px solid var(--border-color);
}
</style>
