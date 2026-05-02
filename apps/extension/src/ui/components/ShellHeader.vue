<template>
  <header class="shell-header">
    <div>
      <p class="eyebrow">Browser AI Copilot</p>
      <h1>AI Chat</h1>
      <p class="header-subtitle">
        Sidebar assistant for reading pages and filling forms.
      </p>
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
        class="icon-button"
        type="button"
        title="Toggle activity trace"
        @click="emit('toggle-activity')"
      >
        {{ showActivity ? 'Hide activity' : 'Show activity' }}
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
const emit = defineEmits(['new-chat', 'stop-agent', 'toggle-activity', 'toggle-theme']);

defineProps({
  isRunning: { type: Boolean, default: false },
  offline: { type: Boolean, default: false },
  hasMessages: { type: Boolean, default: false },
  statusLabel: { type: String, default: 'Ready' },
  showActivity: { type: Boolean, default: true },
  theme: { type: String, default: 'dark' },
});
</script>
