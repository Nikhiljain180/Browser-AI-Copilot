<template>
  <main ref="chatScrollerRef" class="chat-feed">
    <!-- Skeleton loading -->
    <div v-if="!isHydrated" class="history-skeleton">
      <div
        v-for="row in 3"
        :key="row"
        :class="['skeleton-row', row % 2 === 0 ? 'user' : 'assistant']"
      >
        <div class="skeleton-avatar" />
        <div class="skeleton-card">
          <div class="skeleton-line short" />
          <div class="skeleton-line" />
          <div class="skeleton-line medium" />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="visibleMessages.length === 0" class="empty-state">
      <div class="empty-icon">AI</div>
      <h2>Ask anything about the current page</h2>
      <p>
        Try research, summaries, form filling, or guided actions. The panel will show
        live progress while the agent works.
      </p>
    </div>

    <!-- Messages -->
    <template v-else>
      <template
        v-for="(message, index) in visibleMessages"
        :key="`${message.timestamp || index}-${message.role}-${index}`"
      >
        <ActivityCard v-if="message.role === 'tool'" :message="message" />
        <ChatMessage
          v-else
          :message="message"
          :is-agent-running="isRunning"
          :browser-tab-id="browserTabId"
        />
      </template>
    </template>

    <!-- Pending message -->
    <PendingMessage
      v-if="isRunning"
      :live-phase-label="livePhaseLabel"
      :live-status-detail="liveStatusDetail"
      :live-thought-lines="liveThoughtLines"
    />

    <div ref="chatEndAnchorRef" class="chat-end-anchor" aria-hidden="true" />
  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import ChatMessage from './ChatMessage.vue';
import PendingMessage from './PendingMessage.vue';
import ActivityCard from './ActivityCard.vue';

defineProps({
  isHydrated: { type: Boolean, default: false },
  isRunning: { type: Boolean, default: false },
  browserTabId: { type: Number, default: null },
  visibleMessages: { type: Array, default: () => [] },
  livePhaseLabel: { type: String, default: 'Working' },
  liveStatusDetail: { type: String, default: '' },
  liveThoughtLines: { type: Array, default: () => [] },
});

const chatScrollerRef = ref(null);
const chatEndAnchorRef = ref(null);

defineExpose({
  chatScrollerRef,
  chatEndAnchorRef,
});
</script>
