/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// ACTION CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

const HIGH_RISK_PATTERN = /\b(submit|apply|send|finish|complete|post|delete|remove|confirm)\b/;

CopilotSw.classifyAction = function classifyAction(toolName, toolInput) {
  const description = String(toolInput?.description || '').trim();
  const selector = String(toolInput?.selector || '').toLowerCase();
  const combined = `${description.toLowerCase()} ${selector}`.trim();

  if (toolName === 'click_element' && HIGH_RISK_PATTERN.test(combined)) {
    return {
      requiresApproval: true,
      riskLevel: 'high',
      actionDescription: description || `Click "${toolInput?.selector || 'element'}" — this looks like a destructive submit/delete action.`,
    };
  }

  if (toolName === 'click_element') {
    return {
      requiresApproval: true,
      riskLevel: 'medium',
      actionDescription: description || `Click "${toolInput?.selector || 'element'}".`,
    };
  }

  return { requiresApproval: false, riskLevel: 'low', actionDescription: description };
};

CopilotSw.isDestructiveAction = function isDestructiveAction(toolName, toolInput) {
  return CopilotSw.classifyAction(toolName, toolInput).requiresApproval;
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOL EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_RETRY_DELAY_MS = 250;
const MAX_TOOL_ATTEMPTS = 2;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateApprovalId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

CopilotSw.executeToolWithApproval = async function executeToolWithApproval(toolName, toolInput, tabId) {
  const classification = CopilotSw.classifyAction(toolName, toolInput);

  if (!classification.requiresApproval) {
    return CopilotSw.executeTool(toolName, toolInput, tabId);
  }

  // ── Request human approval ──
  const approvalId = generateApprovalId();

  CopilotSw.pendingApprovals[approvalId] = {
    toolName,
    toolInput,
    riskLevel: classification.riskLevel,
    actionDescription: classification.actionDescription,
    timestamp: Date.now(),
  };

  CopilotSw.broadcastUI({
    action: 'requestApproval',
    approvalId,
    toolName,
    toolInput,
    riskLevel: classification.riskLevel,
    actionDescription: classification.actionDescription,
  });

  const approved = await CopilotSw.waitForApproval(approvalId, CopilotSw.CONFIG.TOOL_TIMEOUT_MS);
  delete CopilotSw.pendingApprovals[approvalId];

  if (!approved) {
    return { error: 'User cancelled the action.', errorCategory: 'approval', errorCode: CopilotSw.ErrorCode.APPROVAL_REJECTED };
  }

  return CopilotSw.executeTool(toolName, toolInput, tabId);
};

CopilotSw.executeTool = async function executeTool(toolName, toolInput, tabId) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_TOOL_ATTEMPTS; attempt += 1) {
    if (CopilotSw.agentState?.isRunning === false) {
      return { error: 'Agent stopped by user.', errorCategory: 'unknown', errorCode: CopilotSw.ErrorCode.AGENT_STOPPED_BY_USER };
    }

    try {
      const result = await CopilotSw.sendMessageToTab(tabId, {
        action: 'executeTool',
        toolName,
        toolInput,
      });

      if (result && !result.error) {
        return result;
      }

      const errorMessage = String(result?.error) || 'Tool returned an unknown error.';
      const errorCategory = result?.errorCategory || 'action';
      const errorCode = result?.errorCode || CopilotSw.ErrorCode.ACTION_TOOL_FAILED;
      lastError = new Error(errorMessage);
      lastError.errorCategory = errorCategory;
      lastError.errorCode = errorCode;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!lastError.errorCategory) lastError.errorCategory = 'perception';
      if (!lastError.errorCode) lastError.errorCode = CopilotSw.ErrorCode.PERCEPTION_PAGE_READ_FAILED;
    }

    if (attempt < MAX_TOOL_ATTEMPTS) {
      await delay(TOOL_RETRY_DELAY_MS);
    }
  }

  return {
    error: lastError?.message || 'Tool failed.',
    errorCategory: lastError?.errorCategory || 'action',
    errorCode: lastError?.errorCode || CopilotSw.ErrorCode.ACTION_TOOL_FAILED,
  };
};