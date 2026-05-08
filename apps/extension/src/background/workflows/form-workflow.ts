/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// FIELD FILLING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function fillOneField(tabId, field, value) {
  if (!field || !value) return null;

  return CopilotSw.executeTool('fill_input', {
    agent_id: field.agentId,
    selector: field.selector,
    value,
  }, tabId);
}

async function clearFieldsInForm(formsInventory, tabId) {
  const allFields = (formsInventory || []).flatMap(form => form?.fields || []);

  for (const field of allFields) {
    if (!field || !field.selector || CopilotSw.isFileUploadField(field)) continue;

    await CopilotSw.executeTool('fill_input', {
      agent_id: field.agentId,
      selector: field.selector,
      value: '',
    }, tabId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UP ANSWER CONSUMER
// ─────────────────────────────────────────────────────────────────────────────

async function consumeFollowUpAnswers(goal, pageContext, tabId) {
  const session = CopilotSw.ensureFormSessionState();

  if (!session.active) return null;

  const pending = Array.isArray(session.pendingFields) ? session.pendingFields : [];
  if (pending.length === 0) {
    session.active = false;
    session.awaitingSubmitConfirmation = true;
    session.lastAskedField = null;
    return null;
  }

  const values = CopilotSw.splitUserValues(goal);
  if (values.length === 0) {
    const nextField = session.lastAskedField || pending[0];
    session.lastAskedField = nextField || null;
    return { type: 'chat', message: CopilotSw.askForField(nextField) };
  }

  const filled = [];
  let remainingValues = [...values];

  while (remainingValues.length > 0 && pending.length > 0) {
    const field = pending.shift();
    const value = remainingValues.shift();

    if (!field || !value) continue;

    const result = await fillOneField(tabId, field, value);
    if (result?.error) continue;

    filled.push({ field, value });
    session.filledFields = session.filledFields || {};
    session.filledFields[CopilotSw.fieldKey(field)] = value;

    CopilotSw.agentState.chatHistory.push({
      role: 'tool',
      toolName: 'fill_input',
      content: result,
      timestamp: Date.now(),
    });
  }

  session.pendingFields = pending;
  session.lastAskedField = pending[0] || null;

  if (filled.length === 0) {
    const fallbackField = session.lastAskedField || (values[0] ? CopilotSw.normalizeFieldRef({ label: values[0] }) : null);
    return { type: 'chat', message: CopilotSw.askForField(fallbackField) };
  }

  if (pending.length > 0) {
    return { type: 'chat', message: CopilotSw.askForField(pending[0]) };
  }

  session.active = false;
  session.awaitingSubmitConfirmation = true;
  session.lastAskedField = null;

  return {
    type: 'chat',
    message: 'Thanks! I have filled the form fields. Say "yes" or "submit" if you want me to submit the form.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

async function handleClearFlow(pageContext, formsInventory, tabId) {
  const clearButtons = Array.isArray(pageContext?.buttons)
    ? pageContext.buttons.filter(btn => /\b(clear|reset|cancel|start over|wipe|empty)\b/i.test(String(btn.text || '')))
    : [];

  if (clearButtons.length > 0) {
    const clearBtn = clearButtons[0];
    const result = await CopilotSw.executeTool('click_element', {
      agent_id: clearBtn.agentId,
      selector: clearBtn.selector,
      description: clearBtn.text || 'Clear form',
    }, tabId);

    if (!result?.error) {
      CopilotSw.clearFormSession();
      return `Cleared the form using "${clearBtn.text || 'Clear'}" button.`;
    }
  }

  await clearFieldsInForm(formsInventory, tabId);
  CopilotSw.clearFormSession();
  return 'Cleared all form fields.';
}

async function handleEditFlow(goal, formsInventory, tabId) {
  const session = CopilotSw.agentState.formSession;
  const normalizedGoal = String(goal || '').toLowerCase();

  session.active = true;
  session.awaitingSubmitConfirmation = false;

  if (!session.editMode) {
    const matchedField = CopilotSw.findEditField(formsInventory, normalizedGoal);
    session.editMode = true;
    session.editField = matchedField ? CopilotSw.normalizeFieldRef(matchedField) : null;
    await CopilotSw.agentState.save();

    if (session.editField) return CopilotSw.askForEditField(session.editField);
    return 'Which field would you like to modify? (name, email, message)';
  }

  if (!session.editField) {
    const matchedField = CopilotSw.findEditField(formsInventory, normalizedGoal);

    if (!matchedField) {
      await CopilotSw.agentState.save();
      return 'Please tell me which field to update: name, email, or message.';
    }

    session.editField = CopilotSw.normalizeFieldRef(matchedField);
    await CopilotSw.agentState.save();
    return CopilotSw.askForEditField(session.editField);
  }

  const editField = session.editField;
  const newValue = String(goal || '').trim();

  if (!newValue) {
    await CopilotSw.agentState.save();
    return CopilotSw.askForEditField(editField);
  }

  const result = await fillOneField(tabId, editField, newValue);
  if (result?.error) {
    return `I could not update the ${editField.label || editField.name || 'field'}: ${result.error}`;
  }

  session.filledFields = session.filledFields || {};
  session.filledFields[CopilotSw.fieldKey(editField)] = newValue;
  session.pendingFields = Array.isArray(session.pendingFields)
    ? session.pendingFields.filter(item => CopilotSw.fieldKey(item) !== CopilotSw.fieldKey(editField))
    : [];
  session.editMode = false;
  session.editField = null;
  session.lastAskedField = session.pendingFields[0] || null;

  const morePending = session.pendingFields.length > 0;
  session.active = morePending;
  session.awaitingSubmitConfirmation = !morePending;

  CopilotSw.agentState.chatHistory.push({
    role: 'tool',
    toolName: 'fill_input',
    content: result,
    timestamp: Date.now(),
  });

  await CopilotSw.agentState.save();

  const fieldLabel = editField.label || editField.name || 'Field';
  if (morePending) {
    return `${fieldLabel} updated. ${CopilotSw.askForField(session.pendingFields[0])}`;
  }
  return `${fieldLabel} updated. Say "yes" or "submit" if you want me to submit the form.`;
}

async function handleSubmitConfirmation(goal, pageContext, session, tabId) {
  if (CopilotSw.isSubmitIntent(goal) || CopilotSw.isFormSubmitGoal(String(goal || '').toLowerCase())) {
    const submitButton = CopilotSw.resolveSubmitButton(pageContext, null, session);

    if (!submitButton?.selector && !submitButton?.agentId) {
      return 'I could not find a submit button for this form.';
    }

    CopilotSw.updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
    const submitResult = await CopilotSw.executeToolWithApproval('click_element', {
      agent_id: submitButton.agentId,
      selector: submitButton.selector,
      description: submitButton.text || 'Submit form',
    }, tabId);

    if (submitResult?.error) {
      return submitResult.error.includes('cancel')
        ? 'Submission was cancelled.'
        : `I could not submit the form: ${submitResult.error}`;
    }

    CopilotSw.clearFormSession();
    return 'Submitted the form after your approval.';
  }

  if (CopilotSw.isNegativeIntent(goal)) {
    session.awaitingSubmitConfirmation = false;
    session.active = false;
    await CopilotSw.agentState.save();
    return 'Okay, I will not submit it yet.';
  }

  return 'Say "yes" or "submit" if you want me to submit the form.';
}

async function handleExplicitSubmit(goal, pageContext, formsInventory, session, tabId) {
  const plan = await CopilotSw.requestFormFillPlan(goal, formsInventory, CopilotSw.agentState.chatHistory);
  const workflowPlan = CopilotSw.validateFormWorkflowPlan(plan, formsInventory);

  if (workflowPlan.missingRequired.length > 0) {
    CopilotSw.setFormSession(workflowPlan.missingRequired, true, {
      submitButtons: workflowPlan.submitButtons,
      targetButton: workflowPlan.targetButton,
      awaitingSubmitConfirmation: false,
      editMode: false,
      editField: null,
    });
    await CopilotSw.agentState.save();

    const questions = workflowPlan.missingRequired
      .slice(0, 3)
      .map(item => `- ${CopilotSw.askForField(item)}`);

    return ['I found the form, but these required fields are missing:', ...questions].join('\n');
  }

  const submitButton = CopilotSw.resolveSubmitButton(pageContext, workflowPlan, session);
  if (!submitButton?.selector && !submitButton?.agentId) {
    return 'I could not find a submit button for this form.';
  }

  CopilotSw.updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
  const submitResult = await CopilotSw.executeToolWithApproval('click_element', {
    agent_id: submitButton.agentId,
    selector: submitButton.selector,
    description: submitButton.text || 'Submit form',
  }, tabId);

  if (submitResult?.error) {
    return submitResult.error.includes('cancel')
      ? 'Submission was cancelled.'
      : `I could not submit the form: ${submitResult.error}`;
  }

  CopilotSw.clearFormSession();
  return 'Submitted the form after your approval.';
}

async function handleFreshFormFill(goal, pageContext, formsInventory, session, tabId) {
  const normalizedGoal = String(goal || '').toLowerCase();
  const wantsSubmit = CopilotSw.isFormSubmitGoal(normalizedGoal);

  const plan = await CopilotSw.requestFormFillPlan(goal, formsInventory, CopilotSw.agentState.chatHistory);
  const workflowPlan = CopilotSw.validateFormWorkflowPlan(plan, formsInventory);
  const responseLines = [];

  // ── Fill fields from plan ──
  if (workflowPlan.fields.length > 0) {
    const filledFields = [];

    for (const fieldPlan of workflowPlan.fields) {
      const result = await CopilotSw.executeTool('fill_input', {
        agent_id: fieldPlan.agentId,
        selector: fieldPlan.selector,
        value: fieldPlan.value,
      }, tabId);

      if (result?.error) continue;

      filledFields.push({ field: fieldPlan.label, value: fieldPlan.value });

      CopilotSw.agentState.chatHistory.push({
        role: 'tool',
        toolName: 'fill_input',
        content: result,
        timestamp: Date.now(),
      });
    }

    if (filledFields.length > 0) {
      responseLines.push([
        workflowPlan.summary || 'Filled the form with the information provided:',
        ...filledFields.map(item => `- ${item.field}: ${item.value}`),
      ].join('\n'));

      if (workflowPlan.nextAction !== 'continue' && !wantsSubmit) {
        session.awaitingSubmitConfirmation = true;
        session.active = false;
        session.submitButtons = workflowPlan.submitButtons || [];
        session.targetButton = workflowPlan.targetButton || null;
        responseLines.push('Say "yes" or "submit" if you want me to submit the form.');
      }
    }
  }

  // ── Ask for missing fields ──
  if (workflowPlan.missingRequired.length > 0 || workflowPlan.nextAction === 'ask_user') {
    CopilotSw.setFormSession(workflowPlan.missingRequired, true, {
      submitButtons: workflowPlan.submitButtons,
      targetButton: workflowPlan.targetButton,
      awaitingSubmitConfirmation: false,
      editMode: false,
      editField: null,
    });
    await CopilotSw.agentState.save();

    const questions = workflowPlan.missingRequired.length > 0
      ? workflowPlan.missingRequired.slice(0, 3).map(item => `- ${CopilotSw.askForField(item)}`)
      : [];

    if (workflowPlan.summary) responseLines.push(workflowPlan.summary);
    if (questions.length > 0) {
      responseLines.push('I found the form, but these required fields are missing:');
      responseLines.push(...questions);
    } else {
      responseLines.push('I need a bit more information before I can continue.');
    }

    return responseLines.filter(Boolean).join('\n\n');
  }

  // ── Continue / next button flow ──
  if (workflowPlan.nextAction === 'continue' && workflowPlan.targetButton) {
    const buttonText = String(workflowPlan.targetButton.text || '').toLowerCase();
    const buttonIntent = String(workflowPlan.targetButton.intent || '').toLowerCase();
    const looksLikeSubmit = buttonIntent === 'submit' ||
      /\b(submit|apply|send|finish|complete|post)\b/.test(buttonText);

    if (looksLikeSubmit && !wantsSubmit) {
      responseLines.push('I filled the fields. Say "yes" or "submit" if you want me to submit the form.');
    } else {
      const clickFn = looksLikeSubmit ? CopilotSw.executeToolWithApproval : CopilotSw.executeTool;
      const continueResult = await clickFn('click_element', {
        agent_id: workflowPlan.targetButton.agentId,
        selector: workflowPlan.targetButton.selector,
        description: workflowPlan.targetButton.text || 'Continue',
      }, tabId);

      if (continueResult?.error) {
        return [...responseLines, `I could not continue to the next step: ${continueResult.error}`]
          .filter(Boolean).join('\n\n');
      }

      responseLines.push(`Moved to the next step using "${workflowPlan.targetButton.text || 'Continue'}".`);
    }
  }

  // ── Handle submit if requested ──
  if (wantsSubmit) {
    const submitButton = CopilotSw.resolveSubmitButton(pageContext, workflowPlan, session);
    if (!submitButton?.selector && !submitButton?.agentId) {
      return [...responseLines, 'I could not find a submit button for this form.']
        .filter(Boolean).join('\n\n');
    }

    CopilotSw.updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
    const submitResult = await CopilotSw.executeToolWithApproval('click_element', {
      agent_id: submitButton.agentId,
      selector: submitButton.selector,
      description: submitButton.text || 'Submit form',
    }, tabId);

    if (submitResult?.error) {
      return [...responseLines, submitResult.error.includes('cancel')
        ? 'Submission was cancelled.'
        : `I could not submit the form: ${submitResult.error}`
      ].filter(Boolean).join('\n\n');
    }

    CopilotSw.clearFormSession();
    responseLines.push('Submitted the form after your approval.');
  } else if (workflowPlan.nextAction === 'request_approval') {
    session.awaitingSubmitConfirmation = true;
    session.active = false;
    session.submitButtons = workflowPlan.submitButtons || [];
    session.targetButton = workflowPlan.targetButton || null;
    responseLines.push('Say "yes" or "submit" if you want me to submit the form.');
  }

  // ── Final response ──
  if (responseLines.length === 0) {
    if (workflowPlan.summary) return workflowPlan.summary;
    if (CopilotSw.isFormFillGoal(normalizedGoal)) {
      return 'I found the form, but I could not update any fields automatically on this page.';
    }
    return null;
  }

  await CopilotSw.agentState.save();
  return responseLines.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

CopilotSw.tryDirectFormWorkflow = async function tryDirectFormWorkflow(goal, pageContext, tabId) {
  CopilotSw.ensureFormSessionState();

  const normalizedGoal = String(goal || '').toLowerCase();
  const session = CopilotSw.agentState.formSession;
  const formsInventory = CopilotSw.buildFormsInventory(pageContext);

  // ── Determine intent ──
  const wantsEdit = CopilotSw.isFormEditGoal(normalizedGoal);
  const wantsFill =
    CopilotSw.isFormFillGoal(normalizedGoal) ||
    wantsEdit ||
    (CopilotSw.wasRecentFormFillConversation(CopilotSw.agentState.chatHistory) &&
      CopilotSw.isFormValueFollowupGoal(normalizedGoal));
  const wantsSubmit = CopilotSw.isFormSubmitGoal(normalizedGoal);
  const wantsClear = CopilotSw.isFormClearGoal(normalizedGoal);

  // ── Bail out if not a form workflow ──
  if (
    !wantsFill &&
    !wantsSubmit &&
    !CopilotSw.isSubmitIntent(goal) &&
    !wantsClear &&
    !session?.active &&
    !session?.awaitingSubmitConfirmation &&
    !session?.editMode
  ) {
    return null;
  }

  if (!formsInventory.length && !session?.active && !session?.awaitingSubmitConfirmation && !session?.editMode) {
    return 'I could not find any form fields on this page.';
  }

  // ── Route to appropriate handler ──
  if (wantsClear) {
    return handleClearFlow(pageContext, formsInventory, tabId);
  }

  if (wantsEdit || session?.editMode) {
    return handleEditFlow(goal, formsInventory, tabId);
  }

  if (session?.awaitingSubmitConfirmation) {
    return handleSubmitConfirmation(goal, pageContext, session, tabId);
  }

  if (session?.active) {
    const followUp = await consumeFollowUpAnswers(goal, pageContext, tabId);
    if (followUp) {
      await CopilotSw.agentState.save();
      return followUp.message;
    }
  }

  if (wantsSubmit) {
    return handleExplicitSubmit(goal, pageContext, formsInventory, session, tabId);
  }

  if (!session?.active) {
    return handleFreshFormFill(goal, pageContext, formsInventory, session, tabId);
  }

  return null;
};