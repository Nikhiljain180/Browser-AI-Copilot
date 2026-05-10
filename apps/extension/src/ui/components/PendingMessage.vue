<template>
  <article class="message-row assistant pending" data-testid="chat-message-pending">
    <div class="avatar">AI</div>

    <div class="message-card pending-card">
      <div class="message-meta">
        <span class="message-role">Copilot</span>
        <span>{{ livePhaseLabel }}</span>
      </div>

      <p class="message-content">
        {{ liveStatusDetail }}
      </p>

      <div v-if="currentThought" class="thought-reasoning">
        <span class="thought-reasoning-text">{{ currentThought }}</span>
      </div>

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
</template>

<script setup>
defineProps({
  livePhaseLabel: { type: String, default: 'Working' },
  liveStatusDetail: { type: String, default: '' },
  liveThoughtLines: { type: Array, default: () => [] },
  currentThought: { type: String, default: '' },
});
</script>

<style scoped>
.thought-reasoning {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(124, 58, 237, 0.08);
  border: 1px solid rgba(124, 58, 237, 0.14);
}

.thought-reasoning-text {
  display: block;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
