import { ref, computed } from 'vue';
import { sendRuntimeMessage } from './useRuntime.js';

export function useApproval() {
  const approvalRequest = ref(null);

  const approvalRiskLabel = computed(() => {
    if (approvalRequest.value?.riskLevel === 'high') return 'High risk action';
    return 'Medium risk action';
  });

  const approvalHeadline = computed(() => {
    if (!approvalRequest.value) return '';

    const explicit = String(approvalRequest.value.actionDescription || '').trim();
    if (explicit) return explicit.replace(/\s+/g, ' ');

    const description = String(approvalRequest.value.toolInput?.description || '').trim();
    if (description) return description.replace(/\s+/g, ' ');

    if (approvalRequest.value.toolName === 'click_element') {
      return 'Proceed with this page action?';
    }

    return 'Review this action before continuing';
  });

  const approvalDescription = computed(() => {
    if (!approvalRequest.value) return '';

    if (approvalRequest.value.toolName === 'click_element') {
      return 'The copilot is ready to continue with an action on the current page. Once approved, it will perform that action immediately.';
    }

    return 'The copilot is asking for confirmation before it continues.';
  });

  const approvalRiskExplanation = computed(() => {
    if (!approvalRequest.value) return '';

    if (approvalRequest.value.toolName === 'click_element') {
      return 'This may submit information, trigger navigation, or cause a change that is hard to undo.';
    }

    return 'This action could affect the current page or your data, so confirmation is required first.';
  });

  function setApprovalRequest(data) {
    approvalRequest.value = {
      id: data.approvalId,
      toolName: data.toolName,
      toolInput: data.toolInput,
      riskLevel: data.riskLevel || 'medium',
      actionDescription: data.actionDescription || '',
    };
  }

  async function approveApproval() {
    if (!approvalRequest.value) return;
    await sendRuntimeMessage({
      action: 'approveAction',
      actionId: approvalRequest.value.id,
    });
    approvalRequest.value = null;
  }

  async function rejectApproval() {
    if (!approvalRequest.value) return;
    await sendRuntimeMessage({
      action: 'rejectAction',
      actionId: approvalRequest.value.id,
    });
    approvalRequest.value = null;
  }

  return {
    approvalRequest,
    approvalRiskLabel,
    approvalHeadline,
    approvalDescription,
    approvalRiskExplanation,
    setApprovalRequest,
    approveApproval,
    rejectApproval,
  };
}