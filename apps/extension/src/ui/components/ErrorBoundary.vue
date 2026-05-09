<template>
  <div class="error-boundary">
    <slot v-if="!hasError"></slot>
    <div v-else class="error-fallback">
      <div class="error-icon">⚠️</div>
      <h3>Something went wrong</h3>
      <p>{{ errorMessage }}</p>
      <button @click="reset">Try Again</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue';

const hasError = ref(false);
const errorMessage = ref('An unexpected error occurred');

onErrorCaptured((err, instance, info) => {
  console.error('[ErrorBoundary] Caught error:', err, info);
  hasError.value = true;
  errorMessage.value = err?.message || 'Unknown error';
  return false; // Prevent error from propagating
});

function reset() {
  hasError.value = false;
  errorMessage.value = '';
}
</script>

<style scoped>
.error-boundary {
  width: 100%;
  height: 100%;
}

.error-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  margin: 10px;
}

.error-icon {
  font-size: 32px;
  margin-bottom: 10px;
}

.error-fallback h3 {
  margin: 0 0 8px;
  color: #991b1b;
}

.error-fallback p {
  margin: 0 0 16px;
  color: #7f1d1d;
  font-size: 14px;
}

.error-fallback button {
  padding: 8px 16px;
  background: #dc2626;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.error-fallback button:hover {
  background: #b91c1c;
}
</style>