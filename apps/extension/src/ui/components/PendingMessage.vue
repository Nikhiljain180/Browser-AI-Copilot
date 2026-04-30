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
});
</script>
