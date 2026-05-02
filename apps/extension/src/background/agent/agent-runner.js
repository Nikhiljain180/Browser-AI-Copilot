/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS (private to this file)
// ─────────────────────────────────────────────────────────────────────────────

function ensureAgentStateShape() {
  if (!CopilotSw.agentState.formSession) {
    CopilotSw.agentState.formSession = {
      active: false,
      pendingFields: [],
      lastAskedField: null,
      filledFields: {},
    };
  }
}

function getStructuredRowsFromContext(lastContent, pageContext) {
  if (lastContent?.success && Array.isArray(lastContent.data) && lastContent.data.length > 0) {
    return lastContent.data;
  }

  const table = pageContext?.tables?.[0];
  if (!table?.headers?.length || !table?.rows?.length) {
    return [];
  }

  return table.rows.map(row => {
    const record = {};
    table.headers.forEach((header, index) => {
      const key = String(header || `col_${index}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || `col_${index}`;
      record[key] = row[index] ?? '';
    });
    return record;
  });
}

function getLastToolContent(chatHistory) {
  const lastToolMessage = [...chatHistory]
    .reverse()
    .find(message => message.role === 'tool' && message.content);
  return lastToolMessage?.content || null;
}

function formatExtractionAnswer(lastContent, pageContext) {
  const extractedRows = getStructuredRowsFromContext(lastContent, pageContext);
  if (extractedRows.length > 0) {
    return JSON.stringify(extractedRows, null, 2);
  }
  return null;
}

function formatSummaryAnswer(lastContent, goal) {
  if (!lastContent?.success || typeof lastContent.summary !== 'string' || !lastContent.summary.trim()) {
    return null;
  }

  const summaryText = lastContent.summary.trim();
  const lowerGoal = String(goal || '').toLowerCase();

  if (lowerGoal.includes('bullet')) {
    const items = summaryText
      .split(/[\n.;]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 5);

    if (items.length > 0) {
      return items.map(item => `- ${item}`).join('\n');
    }
  }

  return summaryText;
}

function formatDataPreviewAnswer(lastContent) {
  if (!lastContent?.success || !Array.isArray(lastContent.data) || lastContent.data.length === 0) {
    return null;
  }

  const preview = lastContent.data.slice(0, 5).map(item => {
    return typeof item === 'string' ? item : JSON.stringify(item);
  });
  return preview.map(item => `- ${item}`).join('\n');
}

function formatPageFallbackAnswer(pageContext) {
  const title = pageContext?.title ? `Page: ${pageContext.title}` : null;
  const text = typeof pageContext?.textContent === 'string'
    ? pageContext.textContent.trim().replace(/\s+/g, ' ').slice(0, 280)
    : '';

  const parts = [title, text].filter(Boolean);
  return parts.join('\n\n') || 'I could not complete the request.';
}

function formatFallbackAnswer(goal, pageContext, chatHistory) {
  const lowerGoal = String(goal || '').toLowerCase();
  const lastContent = getLastToolContent(chatHistory);

  if (CopilotSw.isStructuredExtractionGoal(lowerGoal)) {
    const extraction = formatExtractionAnswer(lastContent, pageContext);
    if (extraction) return extraction;
  }

  const summary = formatSummaryAnswer(lastContent, goal);
  if (summary) return summary;

  const dataPreview = formatDataPreviewAnswer(lastContent);
  if (dataPreview) return dataPreview;

  return formatPageFallbackAnswer(pageContext);
}

function collectRecentTools(chatHistory) {
  const recentTools = [];
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i];
    if (msg.role === 'user') break;
    if (msg.role === 'tool' && msg.toolName) recentTools.unshift(msg.toolName);
  }
  return [...new Set(recentTools)];
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM WORKFLOW HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handleFormWorkflow(goal, pageContext, tabId) {
  const normalizedGoal = String(goal || '').toLowerCase();

  const isFormIntent =
    CopilotSw.isFormFillGoal(normalizedGoal) ||
    CopilotSw.isFormSubmitGoal(normalizedGoal) ||
    (typeof CopilotSw.isFormClearGoal === 'function' && CopilotSw.isFormClearGoal(normalizedGoal));

  const isFormSessionActive = !!CopilotSw.agentState.formSession?.active;

  const directFormWorkflowAnswer = await CopilotSw.tryDirectFormWorkflow(goal, pageContext, tabId);

  if (!isFormSessionActive && !isFormIntent && !directFormWorkflowAnswer) {
    return null; // Not a form workflow — let the normal agent loop handle it
  }

  const assistantMessage =
    directFormWorkflowAnswer ||
    (isFormSessionActive
      ? 'Please provide the next requested form value.'
      : 'I found the form, but I could not process it automatically.');

  if (assistantMessage) {
    CopilotSw.updateAgentStatus('finalizing', 'Wrapping up the form workflow.', true);
    CopilotSw.agentState.chatHistory.push({
      role: 'assistant',
      content: assistantMessage,
      timestamp: Date.now(),
    });
  }

  if (!CopilotSw.agentState.formSession?.active) {
    CopilotSw.agentState.currentGoal = null;
  }

  return { handled: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function runAgentLoop(goal, tabId) {
  let continueLoop = true;

  while (
    continueLoop &&
    CopilotSw.agentState.isRunning &&
    CopilotSw.agentState.iterationCount < CopilotSw.CONFIG.MAX_REACT_ITERATIONS
  ) {
    CopilotSw.agentState.iterationCount++;
    CopilotSw.updateAgentStatus('thinking', 'Reasoning about the next step.', true);

    const llmResponse = await CopilotSw.callLLM(
      goal,
      CopilotSw.agentState.pageContext,
      CopilotSw.agentState.chatHistory
    );

    if (!CopilotSw.agentState.isRunning) break;

    CopilotSw.broadcastUI({
      action: 'updateReasoning',
      thought: llmResponse.thought,
      actionName: llmResponse.action,
      actionInput: llmResponse.action_input,
    });

    // ── Final Answer ──
    if (llmResponse.action === 'final_answer') {
      CopilotSw.updateAgentStatus('finalizing', 'Wrapping up the final answer.', true);

      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: llmResponse.answer,
        thought: llmResponse.thought,
        toolsUsed: collectRecentTools(CopilotSw.agentState.chatHistory),
        timestamp: Date.now(),
      });

      continueLoop = false;
      break;
    }

    // ── Execute Tool ──
    CopilotSw.updateAgentStatus('acting', `Running tool: ${llmResponse.action}.`, true);

    const toolResult = await CopilotSw.executeToolWithApproval(
      llmResponse.action,
      llmResponse.action_input,
      tabId
    );

    if (!CopilotSw.agentState.isRunning) break;

    // ── Cancelled by user ──
    if (toolResult?.error && toolResult.error.includes('cancel')) {
      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: 'Action cancelled. Workflow stopped.',
        timestamp: Date.now(),
      });
      continueLoop = false;
      break;
    }

    // ── Record tool result ──
    CopilotSw.agentState.chatHistory.push({
      role: 'tool',
      toolName: llmResponse.action,
      content: toolResult,
      timestamp: Date.now(),
    });

    // ── Refresh page context ──
    CopilotSw.agentState.pageContext = await CopilotSw.sendMessageToTab(tabId, {
      action: 'readPage',
      focusArea: null,
    }).catch(() => CopilotSw.agentState.pageContext);

    await CopilotSw.agentState.save();

    CopilotSw.broadcastUI({
      action: 'updateProgress',
      iteration: CopilotSw.agentState.iterationCount,
      maxIterations: CopilotSw.CONFIG.MAX_REACT_ITERATIONS,
    });
  }

  // ── Max iterations reached — fallback ──
  if (
    CopilotSw.agentState.isRunning &&
    CopilotSw.agentState.iterationCount >= CopilotSw.CONFIG.MAX_REACT_ITERATIONS
  ) {
    const fallbackAnswer = formatFallbackAnswer(
      goal,
      CopilotSw.agentState.pageContext,
      CopilotSw.agentState.chatHistory
    );

    CopilotSw.agentState.chatHistory.push({
      role: 'assistant',
      content: fallbackAnswer,
      timestamp: Date.now(),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

CopilotSw.clearAgentSession = async function clearAgentSession() {
  CopilotSw.agentState.chatHistory = [];
  CopilotSw.agentState.currentGoal = null;
  CopilotSw.agentState.pageContext = null;
  CopilotSw.agentState.iterationCount = 0;
  CopilotSw.agentState.isRunning = false;
  CopilotSw.agentState.formSession = {
    active: false,
    pendingFields: [],
    lastAskedField: null,
    filledFields: {},
  };

  if (CopilotSw.activeLLMController) {
    CopilotSw.activeLLMController.abort();
    CopilotSw.activeLLMController = null;
  }

  Object.keys(CopilotSw.approvalPromises || {}).forEach((approvalId) => {
    CopilotSw.approvalPromises[approvalId](false);
    delete CopilotSw.approvalPromises[approvalId];
    delete CopilotSw.pendingApprovals[approvalId];
  });

  await CopilotSw.agentState.save();
  CopilotSw.updateAgentStatus('idle', 'Ready for your next request.', false);

  return {
    success: true,
    chatHistory: [],
    iteration: 0,
    maxIterations: CopilotSw.CONFIG.MAX_REACT_ITERATIONS,
  };
};

CopilotSw.handleStartAgent = async function handleStartAgent(goal) {
  try {
    await CopilotSw.agentState.load();
    ensureAgentStateShape();

    if (CopilotSw.agentState.isRunning) {
      throw new Error('Agent is already running');
    }

    // ── Initialize state ──
    CopilotSw.agentState.isRunning = true;
    CopilotSw.agentState.currentGoal = goal;
    CopilotSw.agentState.iterationCount = 0;
    await CopilotSw.agentState.save();

      // ── Read current page ──
    CopilotSw.updateAgentStatus('reading', 'Collecting the current page context before starting.', true);

    const tab = await CopilotSw.getUsableTab();

    // Ensure content scripts are injected on this tab
    await CopilotSw.ensureContentScriptInjected(tab.id);

    const pageContext = await CopilotSw.sendMessageToTab(tab.id, {
      action: 'readPage',
      focusArea: null,
    });

    // Clear any stale form session only when the page changes.
    // Each user message starts a new agent run, so we must persist form state
    // across turns on the same page, while still preventing cross-page bleed.
    const sessionUrl = CopilotSw.agentState.formSession?.pageUrl;
    if (sessionUrl && pageContext?.url && sessionUrl !== pageContext.url) {
      CopilotSw.clearFormSession();
    }

    CopilotSw.agentState.pageContext = pageContext;

    CopilotSw.agentState.chatHistory.push({
      role: 'user',
      content: goal,
      timestamp: Date.now(),
    });

    // ── Try form workflow first ──
    const formResult = await handleFormWorkflow(goal, pageContext, tab.id);

    if (formResult?.handled) {
      CopilotSw.agentState.isRunning = false;
      await CopilotSw.agentState.save();
      CopilotSw.updateAgentStatus('idle', 'Ready for your next request.', false);

      return {
        success: true,
        chatHistory: CopilotSw.agentState.chatHistory,
      };
    }

    // ── Run normal agent loop ──
    await runAgentLoop(goal, tab.id);

    // ── Finalize ──
    CopilotSw.agentState.isRunning = false;
    await CopilotSw.agentState.save();
    CopilotSw.updateAgentStatus('idle', 'Ready for your next request.', false);

    return {
      success: true,
      chatHistory: CopilotSw.agentState.chatHistory,
    };
  } catch (error) {
    CopilotSw.agentState.isRunning = false;
    await CopilotSw.agentState.save();
    CopilotSw.updateAgentStatus('idle', error.message || 'The agent stopped unexpectedly.', false);
    throw error;
  }
};
