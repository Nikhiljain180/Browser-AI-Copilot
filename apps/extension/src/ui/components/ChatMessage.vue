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

      <div v-if="message.toolsUsed && message.toolsUsed.length > 0" class="tool-badges">
        <span v-for="tool in message.toolsUsed" :key="tool" class="tool-badge">
          🔧 {{ tool }}
        </span>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import { useFormatters } from '../composables/useFormatters.js';

const props = defineProps({
  message: { type: Object, required: true },
});

const { formatTime, formatRichText, formatColumnLabel, getMessageList, getStructuredTable } = useFormatters();

const tableData = computed(() => getStructuredTable(props.message.content));
const listItems = computed(() => getMessageList(props.message.content));
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
</style>