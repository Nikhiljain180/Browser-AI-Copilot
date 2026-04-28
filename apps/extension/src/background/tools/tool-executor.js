import { CONFIG } from '../core/config.js';
import { broadcastUI } from '../core/ui.js';
import { sendMessageToTab } from '../core/tabs.js';
import { pendingApprovals, waitForApproval } from './approvals.js';

export function isDestructiveAction(toolName, toolInput) {
  const destructiveTools = ['click_element', 'fill_input'];
  if (!destructiveTools.includes(toolName)) return false;

  const description = String(toolInput?.description || '').toLowerCase();
  const selector = String(toolInput?.selector || '').toLowerCase();
  const combined = `${description} ${selector}`.trim();

  const highRiskClickPattern = /\b(submit|apply|send|finish|complete|post|place order|buy now|checkout|pay|payment|confirm|delete|remove|cancel subscription|save changes|update profile|sign out|logout)\b/;
  const lowRiskNavigationPattern = /\b(search|result|listing|product card|card|next|previous|open details|view details|sort|filter|category|see more|show more)\b/;

  // Form submit / finalize actions are always high-stakes.
  if (toolName === 'click_element') {
    if (highRiskClickPattern.test(combined)) {
      return true;
    }

    if (lowRiskNavigationPattern.test(combined)) {
      return false;
    }

    // Keep unknown clicks approval-gated by default.
    return true;
  }

  return false;
}

export async function executeToolWithApproval(toolName, toolInput, tabId) {
  if (!isDestructiveAction(toolName, toolInput)) {
    return executeTool(toolName, toolInput, tabId);
  }

  const approvalId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  pendingApprovals[approvalId] = {
    toolName,
    toolInput,
    timestamp: Date.now()
  };

  broadcastUI({
    action: 'requestApproval',
    approvalId,
    toolName,
    toolInput,
    riskLevel: 'high'
  });

  const approved = await waitForApproval(approvalId, CONFIG.TOOL_TIMEOUT_MS);
  delete pendingApprovals[approvalId];

  if (!approved) {
    return { error: 'User cancelled the action.' };
  }

  return executeTool(toolName, toolInput, tabId);
}

export async function executeTool(toolName, toolInput, tabId) {
  const result = await sendMessageToTab(tabId, {
    action: 'executeTool',
    toolName,
    toolInput
  });

  return result;
}
