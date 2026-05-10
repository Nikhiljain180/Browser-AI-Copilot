<template>
  <transition name="fade">
    <div v-if="offline" class="banner offline-banner">
      <span>🔴 Backend Unavailable — The AI Copilot proxy server is unreachable</span>
      <div class="banner-actions">
        <button class="icon-button" type="button" @click="$emit('retry-health')">
          Retry
        </button>
      </div>
    </div>
    <div v-else-if="errorMessage" class="banner error-banner">
      <span>{{ errorMessage }}</span>
      <div class="banner-actions">
        <button
          v-if="canRetry"
          class="icon-button"
          type="button"
          @click="$emit('retry')"
        >
          Retry
        </button>
        <button class="icon-button" type="button" @click="$emit('dismiss')">
          Dismiss
        </button>
      </div>
    </div>
  </transition>
</template>

<script setup>
defineProps({
  offline: { type: Boolean, default: false },
  errorMessage: { type: String, default: null },
  canRetry: { type: Boolean, default: false },
});

defineEmits(['retry-health', 'retry', 'dismiss']);
</script>