/* global CopilotSw */

CopilotSw.isDestructiveAction = function isDestructiveAction(toolName, toolInput) {
  const destructiveTools = ['click_element', 'fill_input'];
  if (!destructiveTools.includes(toolName)) return false;

  const description = String(toolInput?.description || '').toLowerCase();
  const selector = String(toolInput?.selector || '').toLowerCase();
  const combined = `${description} ${selector}`.trim();

  // Form submit / finalize actions are always high-stakes.
  if (toolName === 'click_element' && /\b(submit|apply|send|finish|complete|post)\b/.test(combined)) {
    return true;
  }

  return toolName === 'click_element';
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

CopilotSw.executeToolWithApproval = async function executeToolWithApproval(toolName, toolInput, tabId) {
  if (!CopilotSw.isDestructiveAction(toolName, toolInput)) {
    return CopilotSw.executeTool(toolName, toolInput, tabId);
  }

  const approvalId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  CopilotSw.pendingApprovals[approvalId] = {
    toolName,
    toolInput,
    timestamp: Date.now()
  };

  CopilotSw.broadcastUI({
    action: 'requestApproval',
    approvalId,
    toolName,
    toolInput
  });

  const approved = await CopilotSw.waitForApproval(approvalId, CopilotSw.CONFIG.TOOL_TIMEOUT_MS);
  delete CopilotSw.pendingApprovals[approvalId];

  if (!approved) {
    return { error: 'User cancelled the action.' };
  }

  return CopilotSw.executeTool(toolName, toolInput, tabId);
};

CopilotSw.executeTool = async function executeTool(toolName, toolInput, tabId) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (CopilotSw.agentState && CopilotSw.agentState.isRunning === false) {
      return { error: 'Agent stopped by user.' };
    }

    try {
      const result = await CopilotSw.sendMessageToTab(tabId, {
        action: 'executeTool',
        toolName,
        toolInput
      });

      if (result && !result.error) {
        return result;
      }

      lastError = new Error(result?.error || 'Tool returned an unknown error.');
    } catch (error) {
      lastError = error;
    }

    if (attempt === 1) {
      await delay(250);
    }
  }

  return { error: lastError?.message || 'Tool failed.' };
};
