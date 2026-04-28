/* global CopilotSw */

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

function formatFallbackAnswer(goal, pageContext, chatHistory) {
  const lowerGoal = String(goal || '').toLowerCase();
  const lastToolMessage = [...chatHistory].reverse().find(message => message.role === 'tool' && message.content);
  const lastContent = lastToolMessage?.content || null;

  if (CopilotSw.isStructuredExtractionGoal(lowerGoal)) {
    const extractedRows = getStructuredRowsFromContext(lastContent, pageContext);
    if (extractedRows.length > 0) {
      return JSON.stringify(extractedRows, null, 2);
    }
  }

  if (lastContent?.success && typeof lastContent.summary === 'string' && lastContent.summary.trim()) {
    const summaryText = lastContent.summary.trim();
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

  if (lastContent?.success && Array.isArray(lastContent.data) && lastContent.data.length > 0) {
    const preview = lastContent.data.slice(0, 5).map(item => {
      if (typeof item === 'string') return item;
      return JSON.stringify(item);
    });
    return preview.map(item => `- ${item}`).join('\n');
  }

  const title = pageContext?.title ? `Page: ${pageContext.title}` : null;
  const text = typeof pageContext?.textContent === 'string'
    ? pageContext.textContent.trim().replace(/\s+/g, ' ').slice(0, 280)
    : '';

  const parts = [title, text].filter(Boolean);
  return parts.join('\n\n') || 'I could not complete the request.';
}

CopilotSw.clearAgentSession = async function clearAgentSession() {
  CopilotSw.agentState.chatHistory = [];
  CopilotSw.agentState.currentGoal = null;
  CopilotSw.agentState.pageContext = null;
  CopilotSw.agentState.iterationCount = 0;
  CopilotSw.agentState.isRunning = false;

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
    maxIterations: CopilotSw.CONFIG.MAX_REACT_ITERATIONS
  };
};

CopilotSw.handleStartAgent = async function handleStartAgent(goal) {
  try {
    await CopilotSw.agentState.load();

    if (CopilotSw.agentState.isRunning) {
      throw new Error('Agent is already running');
    }

    CopilotSw.agentState.isRunning = true;
    CopilotSw.agentState.currentGoal = goal;
    CopilotSw.agentState.iterationCount = 0;
    await CopilotSw.agentState.save();
    CopilotSw.updateAgentStatus('reading', 'Collecting the current page context before starting.', true);

    const tab = await CopilotSw.getUsableTab();
    const pageContext = await CopilotSw.sendMessageToTab(tab.id, {
      action: 'readPage',
      focusArea: null
    });

    CopilotSw.agentState.pageContext = pageContext;

    CopilotSw.agentState.chatHistory.push({
      role: 'user',
      content: goal,
      timestamp: Date.now()
    });

    const normalizedGoal = String(goal || '').toLowerCase();
    const directFormWorkflowAnswer = await CopilotSw.tryDirectFormWorkflow(goal, CopilotSw.agentState.pageContext, tab.id);
    if (directFormWorkflowAnswer && (CopilotSw.isFormFillGoal(normalizedGoal) || CopilotSw.isFormSubmitGoal(normalizedGoal))) {
      CopilotSw.updateAgentStatus('finalizing', 'Wrapping up the form workflow.', true);
      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: directFormWorkflowAnswer,
        timestamp: Date.now()
      });
      CopilotSw.agentState.currentGoal = null;
      CopilotSw.agentState.isRunning = false;
      await CopilotSw.agentState.save();
      CopilotSw.updateAgentStatus('idle', 'Ready for your next request.', false);
      return {
        success: true,
        chatHistory: CopilotSw.agentState.chatHistory
      };
    }

    let continueLoop = true;
    while (continueLoop && CopilotSw.agentState.isRunning && CopilotSw.agentState.iterationCount < CopilotSw.CONFIG.MAX_REACT_ITERATIONS) {
      CopilotSw.agentState.iterationCount++;
      CopilotSw.updateAgentStatus('thinking', 'Reasoning about the next step.', true);

      const lmmResponse = await CopilotSw.callLLM(goal, CopilotSw.agentState.pageContext, CopilotSw.agentState.chatHistory);
      if (!CopilotSw.agentState.isRunning) break;

      CopilotSw.broadcastUI({
        action: 'updateReasoning',
        thought: lmmResponse.thought,
        actionName: lmmResponse.action,
        actionInput: lmmResponse.action_input
      });

      if (lmmResponse.action === 'final_answer') {
        CopilotSw.updateAgentStatus('finalizing', 'Wrapping up the final answer.', true);
        CopilotSw.agentState.chatHistory.push({
          role: 'assistant',
          content: lmmResponse.answer,
          thought: lmmResponse.thought,
          toolsUsed: [],
          timestamp: Date.now()
        });
        continueLoop = false;
        break;
      }

      CopilotSw.updateAgentStatus('acting', `Running tool: ${lmmResponse.action}.`, true);
      const toolResult = await CopilotSw.executeToolWithApproval(
        lmmResponse.action,
        lmmResponse.action_input,
        tab.id
      );
      if (!CopilotSw.agentState.isRunning) break;

      CopilotSw.agentState.chatHistory.push({
        role: 'tool',
        toolName: lmmResponse.action,
        content: toolResult,
        timestamp: Date.now()
      });

      CopilotSw.agentState.pageContext = await CopilotSw.sendMessageToTab(tab.id, {
        action: 'readPage',
        focusArea: null
      }).catch(() => CopilotSw.agentState.pageContext);

      await CopilotSw.agentState.save();

      CopilotSw.broadcastUI({
        action: 'updateProgress',
        iteration: CopilotSw.agentState.iterationCount,
        maxIterations: CopilotSw.CONFIG.MAX_REACT_ITERATIONS
      });
    }

    if (CopilotSw.agentState.isRunning && CopilotSw.agentState.iterationCount >= CopilotSw.CONFIG.MAX_REACT_ITERATIONS) {
      const fallbackAnswer = formatFallbackAnswer(goal, CopilotSw.agentState.pageContext, CopilotSw.agentState.chatHistory);
      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: fallbackAnswer,
        timestamp: Date.now()
      });
    }

    CopilotSw.agentState.isRunning = false;
    await CopilotSw.agentState.save();
    CopilotSw.updateAgentStatus('idle', 'Ready for your next request.', false);

    return {
      success: true,
      chatHistory: CopilotSw.agentState.chatHistory
    };
  } catch (error) {
    CopilotSw.agentState.isRunning = false;
    await CopilotSw.agentState.save();
    CopilotSw.updateAgentStatus('idle', error.message || 'The agent stopped unexpectedly.', false);
    throw error;
  }
};

