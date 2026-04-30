<template>
  <transition name="fade">
    <div v-if="approvalRequest" class="modal-backdrop">
      <div class="approval-modal" data-testid="approval-modal">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Approval required</p>
            <h2>Review action before continuing</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            data-testid="approval-close"
            @click="$emit('reject')"
          >
            Close
          </button>
        </div>

        <div class="modal-body">
          <div :class="['risk-pill', approvalRequest.riskLevel]">
            {{ riskLabel }}
          </div>

          <div class="approval-summary">
            <h3>{{ headline }}</h3>
            <p>{{ description }}</p>
          </div>

          <div class="approval-note">
            <span class="block-label">Why approval is needed</span>
            <p>{{ riskExplanation }}</p>
          </div>
        </div>

        <div class="modal-footer">
          <button
            class="secondary-button"
            type="button"
            data-testid="reject-button"
            @click="$emit('reject')"
          >
            Reject
          </button>
          <button
            class="send-button approve"
            type="button"
            data-testid="approve-button"
            @click="$emit('approve')"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
defineProps({
  approvalRequest: { type: Object, default: null },
  riskLabel: { type: String, default: '' },
  headline: { type: String, default: '' },
  description: { type: String, default: '' },
  riskExplanation: { type: String, default: '' },
});

defineEmits(['approve', 'reject']);
</script>