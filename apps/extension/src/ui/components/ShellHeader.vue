<template>
  <header class="shell-header">
    <div class="shell-header-left">
      <span class="shell-header-brand">AI Copilot</span>
    </div>

    <div class="header-actions">
      <div :class="['status-pill', isRunning ? 'live' : offline ? 'offline' : 'idle']">
        <span class="status-dot" />
        {{ statusLabel }}
      </div>

      <button
        class="icon-button"
        type="button"
        title="Toggle theme"
        @click="emit('toggle-theme')"
      >
        {{ theme === 'dark' ? 'Light' : 'Dark' }}
      </button>

      <button
        v-if="!isRunning && hasMessages"
        class="icon-button"
        type="button"
        title="Start a new chat"
        @click="emit('new-chat')"
      >
        New chat
      </button>

      <button
        v-if="isRunning"
        class="icon-button danger"
        type="button"
        title="Stop agent"
        @click="emit('stop-agent')"
      >
        Stop
      </button>
    </div>
  </header>
</template>

<script setup>
const emit = defineEmits(['new-chat', 'stop-agent', 'toggle-theme']);

defineProps({
  isRunning: { type: Boolean, default: false },
  offline: { type: Boolean, default: false },
  hasMessages: { type: Boolean, default: false },
  statusLabel: { type: String, default: 'Ready' },
  theme: { type: String, default: 'dark' },
});
</script>
