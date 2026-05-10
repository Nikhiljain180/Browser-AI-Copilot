import { ref, computed, nextTick } from 'vue';
import { sendRuntimeMessage } from './useRuntime.js';

export function useChat() {
  const messages = ref([]);
  const isHydrated = ref(false);
  const chatScroller = ref(null);
  const chatEndAnchor = ref(null);
  const liveThoughtLines = ref([]);
  let liveThoughtId = 0;
  let chatMutationObserver = null;
  let chatResizeObserver = null;

  const visibleMessages = computed(() => messages.value);

  function pushLiveThought(text) {
    const normalized = String(text || '').trim();
    if (!normalized) return;

    const previous = liveThoughtLines.value[0];
    if (previous?.text === normalized) return;

    const entry = { id: ++liveThoughtId, text: normalized };
    if (liveThoughtLines.value.length >= 5) {
      liveThoughtLines.value.shift();
    }
    liveThoughtLines.value.push(entry);
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
    });

    if (typeof ResizeObserver !== 'undefined') {
      chatResizeObserver = new ResizeObserver(() => {
        forceBottom();
      });
      chatResizeObserver.observe(scroller);
    }
  }

  function destroyScrollObservers() {
    chatMutationObserver?.disconnect();
    chatResizeObserver?.disconnect();
    chatMutationObserver = null;
    chatResizeObserver = null;
  }

  async function syncHistory() {
    try {
      let hasStoredHistory = false;
      const storageData = await chrome.storage.local.get('agentState');
      if (storageData?.agentState) {
        messages.value = storageData.agentState.chatHistory || [];
        hasStoredHistory = messages.value.length > 0;
        isHydrated.value = true;
      }

      const response = await sendRuntimeMessage({ action: 'getChatHistory' });
      const runtimeHistory = response?.history || [];
      if (runtimeHistory.length > 0 || !hasStoredHistory) {
        messages.value = runtimeHistory;
      }

      return response;
    } catch (error) {
      console.error('Failed to load chat history', error);
      return null;
    } finally {
      isHydrated.value = true;
      await scrollChatToBottom();
    }
  }

  return {
    messages,
    isHydrated,
    chatScroller,
    chatEndAnchor,
    liveThoughtLines,
    visibleMessages,
    pushLiveThought,
    resetLiveThoughts,
    scrollChatToBottom,
    bindChatAutoScrollObservers,
    destroyScrollObservers,
    syncHistory,
  };
}
