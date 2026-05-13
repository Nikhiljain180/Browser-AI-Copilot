<template>
  <article :class="['message-row', message.role]" data-testid="chat-message">
    <div class="avatar">
      {{ message.role === 'user' ? 'You' : 'AI' }}
    </div>

    <div
      class="message-card"
      :data-testid="message.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'"
    >
      <div class="message-meta">
        <span class="message-role">
          {{ message.role === 'user' ? 'You' : 'Copilot' }}
        </span>
        <span>{{ formatTime(message.timestamp) }}</span>
      </div>

      <template v-if="tableData">
        <div class="message-table-wrap">
          <table class="message-table">
            <thead>
              <tr>
                <th v-for="column in tableData.columns" :key="column">
                  {{ formatColumnLabel(column) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in tableData.rows" :key="rowIndex">
                <td v-for="column in tableData.columns" :key="column">
                  {{ row[column] ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else-if="listItems.length">
        <ul class="message-list">
          <li
            v-for="(item, itemIndex) in listItems"
            :key="itemIndex"
            v-html="formatRichText(item)"
          ></li>
        </ul>
      </template>

      <p v-else class="message-content" v-html="formatRichText(message.content)" />

      <div v-if="listingChips.length" class="listing-pick-row" aria-label="Open product from this page">
        <button
          v-for="chip in listingChips"
          :key="chip.key"
          type="button"
          class="listing-pick-chip"
          :disabled="chipDisabled"
          :title="chip.title || `Open option ${chip.key}`"
          @click="onListingChip(chip.key)"
        >
          {{ chip.key }}
        </button>
      </div>

      <div v-if="message.toolsUsed && message.toolsUsed.length > 0" class="tool-badges">
        <span v-for="tool in message.toolsUsed" :key="tool" class="tool-badge">
          🔧 {{ tool }}
        </span>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useFormatters } from '../composables/useFormatters.js';
import { sendRuntimeMessage, getActiveBrowserTabId } from '../composables/useRuntime.js';

const props = defineProps({
  message: { type: Object, required: true },
  isAgentRunning: { type: Boolean, default: false },
  browserTabId: { type: Number, default: null },
});

const { formatTime, formatRichText, formatColumnLabel, getMessageList, getStructuredTable } = useFormatters();

const tableData = computed(() => getStructuredTable(props.message.content));
const listItems = computed(() => getMessageList(props.message.content));

const chipBusy = ref(false);
const listingChips = computed(() => {
  const q = props.message?.listingQuickPick;
  if (!Array.isArray(q) || !q.length) return [];
  return q
    .filter((x) => x && x.key && String(x.detailUrl || '').trim())
    .map((x) => ({
      key: String(x.key).trim().toUpperCase().slice(0, 1),
      title: String(x.title || x.name || '').trim(),
    }));
});

const chipDisabled = computed(() => props.isAgentRunning || chipBusy.value);

async function onListingChip(key) {
  if (chipDisabled.value) return;
  chipBusy.value = true;
  try {
    const tabId =
      props.browserTabId != null && props.browserTabId !== undefined
        ? props.browserTabId
        : await getActiveBrowserTabId();
    const res = await sendRuntimeMessage({ action: 'openListingPick', tabId, pickKey: key });
    if (res?.error) {
      console.warn('[ChatMessage] openListingPick:', res.error);
    }
  } catch (e) {
    console.warn('[ChatMessage] openListingPick failed', e);
  } finally {
    chipBusy.value = false;
  }
}
</script>

<style scoped>
.tool-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.75rem;
}

.tool-badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-secondary, #64748b);
  background-color: var(--bg-tertiary, #f1f5f9);
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  border: 1px solid var(--border-color, rgba(148, 163, 184, 0.18));
}

.listing-pick-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.65rem;
}

.listing-pick-chip {
  min-width: 2.25rem;
  padding: 0.35rem 0.55rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  border-radius: 8px;
  border: 1px solid var(--border-color, rgba(148, 163, 184, 0.35));
  background: var(--bg-secondary, #e2e8f0);
  color: var(--text-primary, #0f172a);
  cursor: pointer;
}

.listing-pick-chip:hover:not(:disabled) {
  background: var(--accent-muted, #cbd5e1);
}

.listing-pick-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
