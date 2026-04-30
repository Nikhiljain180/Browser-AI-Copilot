<template>
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
        v-if="!isRunning && hasMessages"
        class="icon-button"
        type="button"
        title="Start a new chat"
        @click="$emit('new-chat')"
      >
        New chat
      </button>

      <button
        v-if="isRunning"
        class="icon-button danger"
        type="button"
        title="Stop agent"
        @click="$emit('stop-agent')"
      >
        Stop
      </button>
    </div>
  </header>
</template>

<script setup>
defineProps({
  isRunning: { type: Boolean, default: false },
  offline: { type: Boolean, default: false },
  hasMessages: { type: Boolean, default: false },
  statusLabel: { type: String, default: 'Ready' },
});

defineEmits(['new-chat', 'stop-agent']);
</script>
