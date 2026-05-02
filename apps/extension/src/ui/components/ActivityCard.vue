<template>
  <article class="activity-card" data-testid="activity-card">
    <header class="activity-header">
      <div class="activity-title">
        <span class="activity-icon" aria-hidden="true">⌘</span>
        <span class="activity-label">{{ label }}</span>
      </div>
      <span :class="['activity-status', statusClass]">
        {{ statusText }}
      </span>
    </header>

    <details v-if="detailsText" class="activity-details">
      <summary>Details</summary>
      <pre class="activity-pre">{{ detailsText }}</pre>
    </details>
  </article>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  message: { type: Object, required: true },
});

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const toolName = computed(() => String(props.message.toolName || '').trim());

const label = computed(() => {
  const name = toolName.value || 'tool';
  const pretty = name.replaceAll('_', ' ');
  if (pretty === 'fill input') return 'Fill input';
  if (pretty === 'click element') return 'Click element';
  if (pretty === 'read page') return 'Read page';
  if (pretty === 'extract data') return 'Extract data';
  if (pretty === 'summarize page') return 'Summarize page';
  if (pretty === 'draft reply') return 'Draft reply';
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
});

const toolContent = computed(() => props.message.content ?? null);

const statusText = computed(() => {
  if (!toolContent.value || typeof toolContent.value !== 'object') return 'Done';
  if (toolContent.value?.error) return 'Error';
  if (toolContent.value?.success === true) return 'Done';
  return 'Done';
});

const statusClass = computed(() => (statusText.value === 'Error' ? 'error' : 'done'));

const detailsText = computed(() => {
  if (!toolContent.value) return '';
  if (typeof toolContent.value === 'string') return toolContent.value;
  return safeStringify(toolContent.value);
});
</script>

<style scoped>
.activity-card {
  border: 1px solid var(--panel-border);
  background: var(--panel-bg);
  border-radius: 14px;
  padding: 12px 12px 10px;
  box-shadow: var(--panel-shadow);
}

.activity-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.activity-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.activity-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: rgba(148, 163, 184, 0.14);
  color: rgba(226, 232, 240, 0.9);
  font-weight: 800;
}

.activity-label {
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.01em;
}

.activity-status {
  font-size: 12px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  flex: 0 0 auto;
}

.activity-status.done {
  color: rgba(148, 163, 184, 0.9);
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.16);
}

.activity-status.error {
  color: rgba(248, 113, 113, 0.95);
  background: rgba(248, 113, 113, 0.10);
  border-color: rgba(248, 113, 113, 0.18);
}

.activity-details {
  margin-top: 10px;
}

.activity-details summary {
  cursor: pointer;
  color: rgba(148, 163, 184, 0.9);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.activity-pre {
  margin: 10px 0 0;
  padding: 10px;
  border-radius: 12px;
  background: rgba(2, 6, 23, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.12);
  color: rgba(226, 232, 240, 0.92);
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  white-space: pre;
}
</style>

