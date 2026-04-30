<template>
  <footer class="composer-shell">
    <div class="composer-card">
      <textarea
        ref="inputRef"
        :value="modelValue"
        class="composer-input"
        rows="1"
        placeholder="Message the copilot..."
        data-testid="composer-input"
        @input="$emit('update:modelValue', $event.target.value)"
        @keydown.enter.exact.prevent="$emit('submit')"
        @keydown.meta.enter.prevent="$emit('submit')"
        @keydown.ctrl.enter.prevent="$emit('submit')"
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
          @click="$emit('submit')"
        >
          <span v-if="isRunning" class="button-spinner" />
          {{ isRunning ? 'Working' : 'Send' }}
        </button>
      </div>
    </div>
  </footer>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  modelValue: { type: String, default: '' },
  isRunning: { type: Boolean, default: false },
  canSend: { type: Boolean, default: false },
});

defineEmits(['update:modelValue', 'submit']);

const inputRef = ref(null);

defineExpose({ inputRef });
</script>