/* global CopilotSw */

CopilotSw.classifyAction = function classifyAction(toolName, toolInput) {
  const description = String(toolInput?.description || '').trim();
  const selector = String(toolInput?.selector || '').toLowerCase();
  const combined = `${description.toLowerCase()} ${selector}`.trim();

  // submit/delete verbs → high risk
  if (toolName === 'click_element' && /\b(submit|apply|send|finish|complete|post|delete|remove|confirm)\b/.test(combined)) {
    return {
      requiresApproval: true,
      riskLevel: 'high',
      actionDescription: description || `Click "${toolInput?.selector || 'element'}" — this looks like a destructive submit/delete action.`
    };
  }

  if (toolName === 'click_element') {
    return {
      requiresApproval: true,
      riskLevel: 'medium',
      actionDescription: description || `Click "${toolInput?.selector || 'element'}".`
    };
  }

  return { requiresApproval: false, riskLevel: 'low', actionDescription: description };
};

CopilotSw.isDestructiveAction = function isDestructiveAction(toolName, toolInput) {
  return CopilotSw.classifyAction(toolName, toolInput).requiresApproval;
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

CopilotSw.executeToolWithApproval = async function executeToolWithApproval(toolName, toolInput, tabId) {
  const classification = CopilotSw.classifyAction(toolName, toolInput);
  if (!classification.requiresApproval) {
    return CopilotSw.executeTool(toolName, toolInput, tabId);
  }

  const approvalId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  CopilotSw.pendingApprovals[approvalId] = {
    toolName,
    toolInput,
    riskLevel: classification.riskLevel,
    actionDescription: classification.actionDescription,
    timestamp: Date.now()
  };

  CopilotSw.broadcastUI({
    action: 'requestApproval',
    approvalId,
    toolName,
    toolInput,
    riskLevel: classification.riskLevel,
    actionDescription: classification.actionDescription
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
