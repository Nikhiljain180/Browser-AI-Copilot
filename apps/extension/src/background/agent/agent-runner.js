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
      awaitingExtractionValueConfirmation: false,
      allowExtractionAutofill: false,
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

  return table.rows.map((row) => {
    const record = {};
    table.headers.forEach((header, index) => {
      const key =
        String(header || `col_${index}`)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || `col_${index}`;
      record[key] = row[index] ?? '';
    });
    return record;
  });
}

function isMeaningfulValue(value) {
  return String(value ?? '')
    .trim()
    .length > 0;
}

function hasMeaningfulRows(rows = []) {
  return rows.some((row) =>
    Object.values(row || {}).some((value) => isMeaningfulValue(value)),
  );
}

function getLastToolContent(chatHistory) {
  const lastToolMessage = [...chatHistory]
    .reverse()
    .find((message) => message.role === 'tool' && message.content);
  return lastToolMessage?.content || null;
}

function formatExtractionAnswer(lastContent, pageContext) {
  const extractedRows = getStructuredRowsFromContext(lastContent, pageContext);
  if (extractedRows.length > 0 && hasMeaningfulRows(extractedRows)) {
    return JSON.stringify(extractedRows, null, 2);
  }
  return null;
}

function formatSummaryAnswer(lastContent, goal) {
  if (!lastContent?.success) {
    return null;
  }

  let summaryText = '';
  if (typeof lastContent.summary === 'string') {
    summaryText = lastContent.summary.trim();
  } else if (Array.isArray(lastContent.summary)) {
    summaryText = lastContent.summary
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .join('. ');
  }

  if (!summaryText) return null;

  const lowerGoal = String(goal || '').toLowerCase();

  if (lowerGoal.includes('bullet')) {
    const items = summaryText
      .split(/[\n.;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);

    if (items.length > 0) {
      return items.map((item) => `- ${item}`).join('\n');
    }
  }

  return summaryText;
}

function hasMissingRequiredFormFields(pageContext) {
  const forms = Array.isArray(pageContext?.forms) ? pageContext.forms : [];
  const allFields = forms.flatMap((form) => form?.fields || []);
  return allFields.some(
    (field) =>
      field &&
      field.visible !== false &&
      !field.disabled &&
      field.required === true &&
      field.isFilled !== true,
  );
}

function formatDataPreviewAnswer(lastContent) {
  if (!lastContent?.success || !Array.isArray(lastContent.data) || lastContent.data.length === 0) {
    return null;
  }

  if (
    lastContent.data.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        !Object.values(item).some((value) => isMeaningfulValue(value)),
    )
  ) {
    return null;
  }

  const preview = lastContent.data.slice(0, 5).map((item) => {
    return typeof item === 'string' ? item : JSON.stringify(item);
  });
  return preview.map((item) => `- ${item}`).join('\n');
}

function formatPageFallbackAnswer(pageContext) {
  const title = pageContext?.title ? `Page: ${pageContext.title}` : null;
  const text =
    typeof pageContext?.textContent === 'string'
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

function formatAssistantAnswer(answer) {
  if (Array.isArray(answer)) {
    return answer.filter((item) => typeof item === 'string' && item.trim()).join('\n');
  }
  if (typeof answer === 'string') return answer;
  return '';
}

async function buildExtractionPreview(tabId) {
  let extractionPreview = '';

  try {
    const extractionAnswer = await CopilotSw.callLLM(
      'find product info',
      CopilotSw.agentState.pageContext,
      CopilotSw.agentState.chatHistory,
    );
    if (extractionAnswer?.action === 'final_answer') {
      extractionPreview = formatAssistantAnswer(extractionAnswer.answer);
    }
  } catch {
    /* fallback below */
  }

  if (!extractionPreview) {
    extractionPreview = formatFallbackAnswer(
      'find product info',
      CopilotSw.agentState.pageContext,
      CopilotSw.agentState.chatHistory,
    );
  }

  if (!extractionPreview || extractionPreview === 'I could not complete the request.') {
    const summarizeResult = await CopilotSw.executeTool('summarize_page', {}, tabId);
    if (summarizeResult && !summarizeResult.error) {
      CopilotSw.agentState.chatHistory.push({
        role: 'tool',
        toolName: 'summarize_page',
        content: summarizeResult,
        timestamp: Date.now(),
      });
      extractionPreview =
        formatSummaryAnswer(summarizeResult, 'find product info') ||
        formatDataPreviewAnswer(summarizeResult) ||
        extractionPreview;
    }
  }

  if (!extractionPreview || extractionPreview === 'I could not complete the request.') {
    return 'I extracted product information.';
  }
  return extractionPreview;
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

function getFieldByReference(pageContext, actionInput = {}) {
  const agentId = String(actionInput.agent_id || actionInput.agentId || '').trim();
  const selector = String(actionInput.selector || '').trim();
  const forms = Array.isArray(pageContext?.forms) ? pageContext.forms : [];
  const formFields = forms.flatMap((form) => form?.fields || []);
  const inputFields = Array.isArray(pageContext?.inputs) ? pageContext.inputs : [];
  const allFields = [...formFields, ...inputFields];
  return (
    allFields.find((field) => field?.agentId && field.agentId === agentId) ||
    allFields.find((field) => field?.selector && field.selector === selector) ||
    null
  );
}

function isLikelyStructuredPayload(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) || (parsed && typeof parsed === 'object');
    } catch {
      return false;
    }
  }
  return false;
}

function shouldBlockStructuredFill(goal, pageContext, llmResponse) {
  if (llmResponse?.action !== 'fill_input') return null;

  const actionInput = llmResponse.action_input || {};
  const rawValue = actionInput.value;
  if (typeof rawValue !== 'string') return null;
  if (!isLikelyStructuredPayload(rawValue)) return null;

  const normalizedGoal = String(goal || '').toLowerCase();
  const isCompoundIntent =
    CopilotSw.isStructuredExtractionGoal(normalizedGoal) &&
    (CopilotSw.isFormFillGoal(normalizedGoal) || CopilotSw.isFormSubmitGoal(normalizedGoal));

  if (!isCompoundIntent) return null;

  const field = getFieldByReference(pageContext, actionInput);
  const fieldLabel = field?.label || field?.name || field?.selector || 'the target field';
  const fieldType = String(field?.type || '').toLowerCase();

  return {
    success: false,
    error:
      `Blocked invalid fill for ${fieldLabel} (${fieldType || 'unknown'}). ` +
      'Do not paste full extracted JSON into one field. Map single values to matching fields ' +
      '(for example name/email/message) and ask the user only for missing required fields.',
  };
}

function resolveFallbackIntentPlan(goal, session) {
  const normalizedGoal = String(goal || '').toLowerCase();
  const isExtractionIntent = CopilotSw.isStructuredExtractionGoal(normalizedGoal);
  const isFormIntent =
    CopilotSw.isFormFillGoal(normalizedGoal) ||
    CopilotSw.isFormSubmitGoal(normalizedGoal) ||
    (typeof CopilotSw.isFormClearGoal === 'function' && CopilotSw.isFormClearGoal(normalizedGoal));

  return {
    needsExtraction: isExtractionIntent,
    needsFormFill: isFormIntent || !!session?.active,
    needsSubmit: CopilotSw.isFormSubmitGoal(normalizedGoal) || CopilotSw.isSubmitIntent(goal),
    needsClear:
      typeof CopilotSw.isFormClearGoal === 'function' ? CopilotSw.isFormClearGoal(normalizedGoal) : false,
    needsClarification: false,
    clarificationQuestion: '',
    reason: 'fallback-intent-heuristic',
  };
}

async function resolveIntentPlan(goal, pageContext, formsInventory) {
  try {
    const plan = await CopilotSw.requestIntentPlan(
      goal,
      pageContext,
      formsInventory,
      CopilotSw.agentState.chatHistory,
    );

    if (
      !plan ||
      typeof plan.needsExtraction !== 'boolean' ||
      typeof plan.needsFormFill !== 'boolean' ||
      typeof plan.needsSubmit !== 'boolean' ||
      typeof plan.needsClear !== 'boolean'
    ) {
      throw new Error('Invalid intent plan shape');
    }
    return plan;
  } catch {
    return resolveFallbackIntentPlan(goal, CopilotSw.agentState.formSession || {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM WORKFLOW HANDLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * If the model asked "list vs order" and the user says yes, prefer extraction/listing (non-destructive)
 * instead of looping on needs_clarification.
 */
function relaxAffirmativeClarification(goal, chatHistory, plan) {
  if (!plan?.needsClarification) return plan;

  const raw = String(goal || '').trim();
  if (!/^(yes|yeah|yep|sure|ok|y)(\s*[!.])?$/i.test(raw)) return plan;

  const assistants = (chatHistory || []).filter((m) => m?.role === 'assistant');
  const lastAssistant = assistants.length ? assistants[assistants.length - 1] : null;
  const prev = String(lastAssistant?.content || '').toLowerCase();
  if (!prev.includes('?')) return plan;

  const offeredAlternatives =
    /\bor\b/.test(prev) &&
    ((/\blist\b|\ball\b|\bsee\b|\bshow\b|\bfetch\b|\bproducts?\b|\bavailable\b/.test(prev) &&
      /\border\b|\bform\b|\bfill\b|\bplace\b|\bsubmit\b/.test(prev)) ||
      (/\bview\b|\bsee\b/.test(prev) && /\border\b|\bpurchase\b/.test(prev)));

  if (!offeredAlternatives) return plan;

  return {
    ...plan,
    needsClarification: false,
    clarificationQuestion: '',
    needsExtraction: true,
    needsFormFill: false,
    needsSubmit: false,
    reason: `${plan.reason || ''}; affirmative-default-catalog`,
  };
}

async function handleFormWorkflow(goal, pageContext, tabId) {
  const session = CopilotSw.agentState.formSession || {};
  const formsInventory = CopilotSw.buildFormsInventory(pageContext);
  let intentPlan = await resolveIntentPlan(goal, pageContext, formsInventory);
  intentPlan = relaxAffirmativeClarification(goal, CopilotSw.agentState.chatHistory, intentPlan);

  const isFormSessionActive = !!CopilotSw.agentState.formSession?.active;
  const isFormIntent =
    intentPlan.needsFormFill ||
    intentPlan.needsSubmit ||
    intentPlan.needsClear ||
    isFormSessionActive ||
    !!session?.awaitingSubmitConfirmation;
  const isCompoundIntent = intentPlan.needsExtraction && (intentPlan.needsFormFill || intentPlan.needsSubmit);

  if (session.awaitingExtractionValueConfirmation) {
    if (CopilotSw.isSubmitIntent(goal)) {
      session.awaitingExtractionValueConfirmation = false;
      session.allowExtractionAutofill = true;
      await CopilotSw.agentState.save();
      const useExtractedFlow = await CopilotSw.tryDirectFormWorkflow(
        'fill the form using extracted values',
        pageContext,
        tabId,
      );
      const message =
        useExtractedFlow || 'I will use extracted values where possible and ask for missing fields.';
      CopilotSw.updateAgentStatus('finalizing', 'Continuing form fill with extracted values.', true);
      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: message,
        timestamp: Date.now(),
      });
      return { handled: true };
    }

    if (CopilotSw.isNegativeIntent(goal)) {
      session.awaitingExtractionValueConfirmation = false;
      session.allowExtractionAutofill = false;
      await CopilotSw.agentState.save();
      const independentFlow = await CopilotSw.tryDirectFormWorkflow('fill the form', pageContext, tabId);
      const message =
        independentFlow || 'Okay, I will keep extraction and form fill independent. Let us fill the form now.';
      CopilotSw.updateAgentStatus('finalizing', 'Continuing independent form fill.', true);
      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: message,
        timestamp: Date.now(),
      });
      return { handled: true };
    }

    CopilotSw.updateAgentStatus('finalizing', 'Waiting for extracted-value confirmation.', true);
    CopilotSw.agentState.chatHistory.push({
      role: 'assistant',
      content: 'Do you want me to use extracted values for form fields where possible? (yes/no)',
      timestamp: Date.now(),
    });
    return { handled: true };
  }

  if (intentPlan.needsClarification && intentPlan.clarificationQuestion) {
    CopilotSw.updateAgentStatus('finalizing', 'Need one clarification before proceeding.', true);
    CopilotSw.agentState.chatHistory.push({
      role: 'assistant',
      content: intentPlan.clarificationQuestion,
      timestamp: Date.now(),
    });
    return { handled: true };
  }

  // Let ReAct own fresh compound goals so it can execute extraction first,
  // then field filling with tool calls in the same run.
  if (isCompoundIntent && !isFormSessionActive) {
    return null;
  }

  const directGoal = intentPlan.needsClear
    ? 'clear the form'
    : intentPlan.needsSubmit && !intentPlan.needsFormFill
      ? 'submit the form'
      : goal;

  const directFormWorkflowAnswer = await CopilotSw.tryDirectFormWorkflow(directGoal, pageContext, tabId, {
    treatAsFormFill: intentPlan.needsFormFill === true,
  });

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
    try {
      CopilotSw.agentState.iterationCount++;
      CopilotSw.updateAgentStatus('thinking', 'Reasoning about the next step.', true);

      const llmResponse = await CopilotSw.callLLM(
        goal,
        CopilotSw.agentState.pageContext,
        CopilotSw.agentState.chatHistory,
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

      if (llmResponse.action === 'request_approval') {
        CopilotSw.updateAgentStatus('finalizing', 'Waiting for your approval to continue.', true);
        CopilotSw.agentState.chatHistory.push({
          role: 'assistant',
          content:
            'Approval is required for that step. Please confirm the action you want me to take (for example: "submit the form").',
          timestamp: Date.now(),
        });
        continueLoop = false;
        break;
      }

      // ── Execute Tool ──
      CopilotSw.updateAgentStatus('acting', `Running tool: ${llmResponse.action}.`, true);

      const blockedFillResult = shouldBlockStructuredFill(
        goal,
        CopilotSw.agentState.pageContext,
        llmResponse,
      );

      const toolResult =
        blockedFillResult ||
        (await CopilotSw.executeToolWithApproval(
          llmResponse.action,
          llmResponse.action_input,
          tabId,
        ));

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

      const normalizedGoal = String(goal || '').toLowerCase();
      const isExtractionIntent = CopilotSw.isStructuredExtractionGoal(normalizedGoal);
      const isFillIntent = CopilotSw.isFormFillGoal(normalizedGoal);
      const isSubmitIntent = CopilotSw.isFormSubmitGoal(normalizedGoal) || CopilotSw.isSubmitIntent(goal);
      const isCompoundIntent = isExtractionIntent && (isFillIntent || isSubmitIntent);
      const missingRequiredFields = hasMissingRequiredFormFields(CopilotSw.agentState.pageContext);
      const shouldAskExtractedValueConfirmation =
        llmResponse.action === 'extract_data' &&
        !toolResult?.error &&
        isExtractionIntent &&
        isFillIntent &&
        missingRequiredFields &&
        !CopilotSw.isFormValueFollowupGoal(goal);

      if (shouldAskExtractedValueConfirmation) {
        CopilotSw.ensureFormSessionState();
        CopilotSw.agentState.formSession.awaitingExtractionValueConfirmation = true;
        CopilotSw.agentState.formSession.allowExtractionAutofill = false;
        const extractionPreview = await buildExtractionPreview(tabId);

        CopilotSw.updateAgentStatus('finalizing', 'Confirming extracted value usage for form fill.', true);
        CopilotSw.agentState.chatHistory.push({
          role: 'assistant',
          content:
            `${extractionPreview}\n\nDo you want me to use extracted values for form fields where possible? (yes/no)`,
          timestamp: Date.now(),
        });
        continueLoop = false;
        break;
      }

      const shouldProceedToSubmitFlow =
        llmResponse.action === 'extract_data' &&
        !toolResult?.error &&
        isCompoundIntent &&
        isSubmitIntent &&
        !isFillIntent;

      if (shouldProceedToSubmitFlow) {
        const extractionPreview = await buildExtractionPreview(tabId);
        if (extractionPreview) {
          CopilotSw.agentState.chatHistory.push({
            role: 'assistant',
            content: extractionPreview,
            timestamp: Date.now(),
          });
        }

        const submitFlowAnswer = await CopilotSw.tryDirectFormWorkflow(
          'submit the form',
          CopilotSw.agentState.pageContext,
          tabId,
        );
        if (submitFlowAnswer) {
          CopilotSw.updateAgentStatus('finalizing', 'Proceeding to form submit flow.', true);
          CopilotSw.agentState.chatHistory.push({
            role: 'assistant',
            content: submitFlowAnswer,
            timestamp: Date.now(),
          });
          continueLoop = false;
          break;
        }
      }

      await CopilotSw.agentState.save();

      CopilotSw.broadcastUI({
        action: 'updateProgress',
        iteration: CopilotSw.agentState.iterationCount,
        maxIterations: CopilotSw.CONFIG.MAX_REACT_ITERATIONS,
      });
    } catch (error) {
      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: `Error during iteration: ${error.message}`,
        timestamp: Date.now(),
      });
      console.error('[Agent] Loop iteration error:', error);
      break;
    }
  }

  // ── Max iterations reached — fallback ──
  if (
    CopilotSw.agentState.isRunning &&
    CopilotSw.agentState.iterationCount >= CopilotSw.CONFIG.MAX_REACT_ITERATIONS
  ) {
    const fallbackAnswer = formatFallbackAnswer(
      goal,
      CopilotSw.agentState.pageContext,
      CopilotSw.agentState.chatHistory,
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

CopilotSw.clearAgentSession = async function clearAgentSession(tabId) {
  await CopilotSw.loadAllTabSessions();
  await CopilotSw.setActiveTabSession(tabId);

  const anyRunning =
    CopilotSw.activeLLMController != null ||
    Object.keys(CopilotSw._tabSessions).some((k) => CopilotSw._tabSessions[k]?.isRunning);

  if (anyRunning) {
    await CopilotSw.abortInFlightAgentRun();
    await CopilotSw.setActiveTabSession(tabId);
  }

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

  const approvalIds = Object.keys(CopilotSw.approvalPromises || {});
  approvalIds.forEach((approvalId) => {
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

CopilotSw.handleStartAgent = async function handleStartAgent(goal, tabId) {
  try {
    await CopilotSw.abortInFlightAgentRun();
    await CopilotSw.setActiveTabSession(tabId);
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
    CopilotSw.updateAgentStatus(
      'reading',
      'Collecting the current page context before starting.',
      true,
    );

    const tab = await CopilotSw.resolveAgentTab(tabId);

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
