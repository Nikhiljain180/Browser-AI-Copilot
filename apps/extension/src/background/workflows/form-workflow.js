/* global CopilotSw */

function ensureFormSessionState() {
  if (!CopilotSw.agentState.formSession) {
    CopilotSw.agentState.formSession = {
      active: false,
      pendingFields: [],
      lastAskedField: null,
      filledFields: {},
      awaitingSubmitConfirmation: false,
      editMode: false,
      editField: null,
      submitButtons: [],
      targetButton: null
    };
  } else {
    const s = CopilotSw.agentState.formSession;
    if (typeof s.active !== 'boolean') s.active = false;
    if (!Array.isArray(s.pendingFields)) s.pendingFields = [];
    if (!s.lastAskedField) s.lastAskedField = null;
    if (!s.filledFields || typeof s.filledFields !== 'object') s.filledFields = {};
    if (typeof s.awaitingSubmitConfirmation !== 'boolean') s.awaitingSubmitConfirmation = false;
    if (typeof s.editMode !== 'boolean') s.editMode = false;
    if (!s.editField) s.editField = null;
    if (!Array.isArray(s.submitButtons)) s.submitButtons = [];
    if (!s.targetButton) s.targetButton = null;
  }

  return CopilotSw.agentState.formSession;
}

function normalizeFieldRef(item = {}) {
  return {
    agentId: item.agentId || item.agent_id || '',
    selector: item.selector || '',
    label: item.label || item.name || item.question || item.selector || '',
    question: item.question || '',
    type: item.type || '',
    value: typeof item.value === 'string' ? item.value : '',
    reason: item.reason || ''
  };
}

function fieldKey(field = {}) {
  return field.selector || field.agentId || field.label || field.name || '';
}

function buildFieldLookup(fields = []) {
  const map = new Map();
  fields.forEach(field => {
    if (field?.agentId) {
      map.set(field.agentId, field);
    }
    if (field?.selector) {
      map.set(field.selector, field);
    }
  });
  return map;
}

function buildButtonLookup(buttons = []) {
  const map = new Map();
  buttons.forEach(button => {
    if (button?.agentId) {
      map.set(button.agentId, button);
    }
    if (button?.selector) {
      map.set(button.selector, button);
    }
  });
  return map;
}

function validateFormFillPlan(plan, fields = []) {
  const fieldLookup = buildFieldLookup(fields);
  const validFields = [];

  for (const item of plan.fields || []) {
    const agentId = item?.agent_id || item?.agentId || '';
    const selector = item?.selector || '';
    const rawValue = item?.value;

    if ((!agentId && !selector) || typeof rawValue !== 'string') continue;

    const field = fieldLookup.get(agentId) || fieldLookup.get(selector);
    if (!field || field.disabled || field.visible === false) continue;

    validFields.push({
      agentId: field.agentId || agentId || '',
      selector: field.selector || selector || '',
      value: rawValue.trim(),
      label: field.label || field.name || selector || agentId,
      reason: item.reason || ''
    });
  }

  return validFields;
}

CopilotSw.validateFormWorkflowPlan = function validateFormWorkflowPlan(plan, forms = []) {
  const allForms = Array.isArray(forms) ? forms : [];
  const allFields = allForms.flatMap(form => form?.fields || []);
  const allButtons = allForms.flatMap(form => form?.buttons || []);
  const allSubmitButtons = allForms.flatMap(form => form?.submitButtons || []);

  const safePlan = {
    fields: validateFormFillPlan(plan, allFields),
    missingRequired: Array.isArray(plan?.missing_required)
      ? plan.missing_required.map(normalizeFieldRef)
      : [],
    nextAction: String(plan?.next_action || '').trim(),
    summary: String(plan?.summary || '').trim(),
    targetButton: null,
    submitButtons: allSubmitButtons
  };

  const buttonLookup = buildButtonLookup(allButtons);
  if (plan?.target_button_agent_id) {
    safePlan.targetButton = buttonLookup.get(plan.target_button_agent_id) || null;
  }

  return safePlan;
};

CopilotSw.buildFormsInventory = function buildFormsInventory(pageContext) {
  const forms = Array.isArray(pageContext?.forms) ? pageContext.forms : [];
  const standaloneInputs = Array.isArray(pageContext?.inputs) ? pageContext.inputs : [];
  const standaloneButtons = Array.isArray(pageContext?.buttons) ? pageContext.buttons : [];

  const usedFieldIds = new Set();
  forms.forEach(form => {
    (form.fields || []).forEach(field => {
      if (field?.agentId) usedFieldIds.add(field.agentId);
      if (field?.selector) usedFieldIds.add(field.selector);
    });
  });

  const extraFields = standaloneInputs
    .filter(item => item && item.visible !== false && !item.disabled)
    .filter(item => !usedFieldIds.has(item.agentId) && !usedFieldIds.has(item.selector))
    .map(item => ({
      agentId: item.agentId,
      name: item.type || item.tagName,
      type: item.type || '',
      value: '',
      placeholder: item.text || '',
      label: item.ariaLabel || item.text || '',
      ariaLabel: item.ariaLabel || '',
      requiredText: '',
      required: false,
      disabled: !!item.disabled,
      visible: item.visible !== false,
      currentValue: '',
      options: [],
      selector: item.selector
    }));

  const extraButtons = standaloneButtons
    .filter(item => item && item.visible !== false && !item.disabled)
    .map(item => ({
      agentId: item.agentId,
      text: item.text || '',
      type: item.type || 'button',
      visible: item.visible !== false,
      disabled: !!item.disabled,
      selector: item.selector,
      intent: 'unknown'
    }));

  if (extraFields.length === 0) return forms;

  return [
    ...forms,
    {
      id: 'page_inputs',
      agentId: 'page_inputs',
      selector: '',
      title: 'Page inputs',
      fields: extraFields,
      buttons: extraButtons,
      submitButtons: [],
      requiredUnfilledFields: []
    }
  ];
};

CopilotSw.isFormClearGoal = function isFormClearGoal(goal) {
  const lowerGoal = String(goal || '').toLowerCase();
  return /\b(clear|reset|empty|wipe|erase|start over)\b.*\b(form|fields)?\b|\b(form|fields)\b.*\b(clear|reset|empty|wipe|erase|start over)\b/.test(lowerGoal);
};

CopilotSw.isFormEditGoal = function isFormEditGoal(goal) {
  const lowerGoal = String(goal || '').toLowerCase();
  return /\b(edit|change|modify|update|correct|fix|replace)\b/.test(lowerGoal);
};

CopilotSw.detectMultiStepForm = function detectMultiStepForm(pageContext) {
  const buttons = Array.isArray(pageContext?.buttons) ? pageContext.buttons : [];
  const hasNextButton = buttons.some(btn => /\b(next|continue|proceed)\b/i.test(String(btn.text || '')));
  const hasPrevButton = buttons.some(btn => /\b(prev|previous|back)\b/i.test(String(btn.text || '')));

  return {
    isMultiStep: hasNextButton || hasPrevButton,
    hasNextButton,
    hasPrevButton
  };
};

CopilotSw.detectDynamicFields = function detectDynamicFields(currentFields, previousFields = []) {
  if (!previousFields || previousFields.length === 0) return [];

  const prevFieldIds = new Set();
  previousFields.forEach(field => {
    if (field?.agentId) prevFieldIds.add(field.agentId);
    if (field?.selector) prevFieldIds.add(field.selector);
  });

  return (currentFields || []).filter(field => {
    return !prevFieldIds.has(field.agentId) && !prevFieldIds.has(field.selector);
  });
};

CopilotSw.isSelectField = function isSelectField(field) {
  return field && (
    field.type === 'select' ||
    field.tagName === 'SELECT' ||
    (Array.isArray(field.options) && field.options.length > 0)
  );
};

CopilotSw.formatSelectOptions = function formatSelectOptions(field) {
  if (!field?.options || field.options.length === 0) return null;

  return field.options
    .slice(0, 5)
    .map((opt, idx) => `${idx + 1}. ${typeof opt === 'string' ? opt : opt.label || opt.text || String(opt)}`)
    .join('\n');
};

CopilotSw.isFileUploadField = function isFileUploadField(field) {
  return !!field && (
    field.type === 'file' ||
    field.inputType === 'file' ||
    (field.tagName === 'INPUT' && field.inputType === 'file')
  );
};

CopilotSw.detectValidationErrors = function detectValidationErrors(pageContext) {
  const errors = [];
  const pageText = String(pageContext?.textContent || '').toLowerCase();

  if (/\b(error|invalid|required|please fix|must be)\b/.test(pageText)) {
    errors.push('Page shows validation errors');
  }

  const allFields = Array.isArray(pageContext?.forms)
    ? pageContext.forms.flatMap(form => form?.fields || [])
    : [];

  const errorFields = allFields.filter(field => {
    const className = String(field.className || '').toLowerCase();
    return className.includes('error') || className.includes('invalid') || field.ariaInvalid === true;
  });

  return {
    hasErrors: errors.length > 0 || errorFields.length > 0,
    count: errorFields.length
  };
};

CopilotSw.detectConfirmationDialog = function detectConfirmationDialog(pageContext) {
  const buttons = Array.isArray(pageContext?.buttons) ? pageContext.buttons : [];
  const hasConfirmBtn = buttons.some(btn => /\b(confirm|yes|ok|agree|accept)\b/i.test(String(btn.text || '')));
  const hasCancelBtn = buttons.some(btn => /\b(cancel|no|decline|close)\b/i.test(String(btn.text || '')));

  return {
    isConfirmationDialog: hasConfirmBtn && hasCancelBtn,
    hasConfirmBtn,
    hasCancelBtn
  };
};

CopilotSw.requestFormFillPlan = async function requestFormFillPlan(goal, forms, chatHistory) {
  const response = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}/api/forms/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, forms, chatHistory })
  });

  if (!response.ok) {
    let message = `Form plan error: ${response.statusText}`;
    try {
      const errorData = await response.json();
      message = errorData.error || errorData.message || message;
    } catch {
      // noop
    }
    throw new Error(message);
  }

  const data = await response.json();
  const parsed = CopilotSw.parseJsonResponse(data.content);
  if (!parsed?.fields || !Array.isArray(parsed.fields)) {
    throw new Error('The form plan response was not valid.');
  }
  return parsed;
};

function splitUserValues(goal) {
  return String(goal || '')
    .split(/[\n,]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

async function fillOneField(tabId, field, value) {
  if (!field || !value) return null;

  return CopilotSw.executeTool('fill_input', {
    agent_id: field.agentId,
    selector: field.selector,
    value
  }, tabId);
}

function askForField(field) {
  const label = field?.label || field?.name || field?.selector || 'this field';
  const question = field?.question || '';

  if (question) return question;

  const type = String(field?.type || '').toLowerCase();
  if (type === 'email') return 'What is your email address?';
  if (type === 'textarea') return 'What message would you like to send?';
  if (type === 'tel' || type === 'phone') return 'What is your phone number?';
  if (type === 'number') return `What is your ${label}?`;

  return `Please provide ${label}.`;
}

function askForEditField(field) {
  const type = String(field?.type || '').toLowerCase();

  if (type === 'email') return 'What is the new email address?';
  if (type === 'textarea') return 'What is the new message you would like to send?';
  if (type === 'tel' || type === 'phone') return 'What is the new phone number?';

  const label = field?.label || field?.name || field?.selector || 'value';
  return `What is the new ${label}?`;
}

function isSubmitIntent(goal) {
  const text = String(goal || '').toLowerCase().trim();

  return (
    text === 'yes' ||
    text === 'y' ||
    text === 'ok' ||
    text === 'okay' ||
    text === 'submit' ||
    text === 'send' ||
    text === 'proceed' ||
    text === 'go ahead' ||
    text === 'please submit' ||
    text === 'submit form' ||
    text === 'send form'
  );
}

function isNegativeIntent(goal) {
  const text = String(goal || '').toLowerCase().trim();

  return (
    text === 'no' ||
    text === 'nope' ||
    text === 'nah' ||
    text === 'not now' ||
    text === 'later' ||
    text === 'cancel' ||
    text === 'stop' ||
    text.includes("don't submit") ||
    text.includes('do not submit') ||
    /\b(don't|do not|not)\s+(submit|send|continue|proceed)\b/.test(text)
  );
}

function isLikelySubmitButton(button) {
  const text = String(button?.text || '').toLowerCase();
  const intent = String(button?.intent || '').toLowerCase();
  const type = String(button?.type || '').toLowerCase();

  return (
    intent === 'submit' ||
    type === 'submit' ||
    /\b(submit|send|finish|complete|post|save|confirm|yes|ok|okay)\b/.test(text)
  );
}

function resolveSubmitButton(pageContext, workflowPlan = null, session = null) {
  const candidates = [];

  if (workflowPlan?.targetButton) candidates.push(workflowPlan.targetButton);
  if (Array.isArray(workflowPlan?.submitButtons)) candidates.push(...workflowPlan.submitButtons);
  if (session?.targetButton) candidates.push(session.targetButton);
  if (Array.isArray(session?.submitButtons)) candidates.push(...session.submitButtons);
  if (Array.isArray(pageContext?.buttons)) candidates.push(...pageContext.buttons);

  const submitLike = candidates.find(btn => btn && (btn.agentId || btn.selector) && isLikelySubmitButton(btn));
  if (submitLike) return submitLike;

  return candidates.find(btn => btn && (btn.agentId || btn.selector)) || null;
}

function findEditField(formsInventory, normalizedGoal) {
  const allFields = (formsInventory || []).flatMap(form => form?.fields || []);
  const goal = String(normalizedGoal || '').toLowerCase();

  const semanticHints = [
    'email',
    'name',
    'message',
    'phone',
    'mobile',
    'tel',
    'address',
    'city',
    'state',
    'zip',
    'postal',
    'subject',
    'password',
    'username',
    'comment',
    'note',
    'company',
    'first name',
    'last name'
  ];

  for (const hint of semanticHints) {
    if (!goal.includes(hint)) continue;

    const match = allFields.find(field => {
      const haystack = [
        field.label,
        field.name,
        field.question,
        field.type,
        field.placeholder,
        field.ariaLabel,
        field.selector
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(hint);
    });

    if (match) return match;
  }

  const scored = allFields.map(field => {
    const haystack = [
      field.label,
      field.name,
      field.question,
      field.type,
      field.placeholder,
      field.ariaLabel,
      field.selector
    ].filter(Boolean).join(' ').toLowerCase();

    let score = 0;
    for (const token of goal.split(/\s+/).filter(Boolean)) {
      if (token.length >= 3 && haystack.includes(token)) score += 1;
    }

    if (field.type && goal.includes(String(field.type).toLowerCase())) score += 2;
    if (field.label && goal.includes(String(field.label).toLowerCase())) score += 2;

    return { field, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].field : null;
}

function setFormSession(fields = [], active = true, meta = {}) {
  const session = ensureFormSessionState();
  session.active = active;
  session.pendingFields = fields.map(normalizeFieldRef);
  session.lastAskedField = session.pendingFields[0] || null;
  session.filledFields = session.filledFields || {};
  session.awaitingSubmitConfirmation = !!meta.awaitingSubmitConfirmation;
  session.editMode = !!meta.editMode;
  session.editField = meta.editField ? normalizeFieldRef(meta.editField) : null;
  session.submitButtons = Array.isArray(meta.submitButtons) ? meta.submitButtons : (session.submitButtons || []);
  session.targetButton = meta.targetButton || session.targetButton || null;
  return session;
}

function clearFormSession() {
  CopilotSw.agentState.formSession = {
    active: false,
    pendingFields: [],
    lastAskedField: null,
    filledFields: {},
    awaitingSubmitConfirmation: false,
    editMode: false,
    editField: null,
    submitButtons: [],
    targetButton: null
  };
  return CopilotSw.agentState.formSession;
}

async function clearFieldsInForm(formsInventory, tabId) {
  const allFields = (formsInventory || []).flatMap(form => form?.fields || []);

  for (const field of allFields) {
    if (!field || !field.selector || CopilotSw.isFileUploadField(field)) continue;

    await CopilotSw.executeTool('fill_input', {
      agent_id: field.agentId,
      selector: field.selector,
      value: ''
    }, tabId);
  }
}

async function consumeFollowUpAnswers(goal, pageContext, tabId) {
  const session = ensureFormSessionState();

  if (!session.active) return null;

  const pending = Array.isArray(session.pendingFields) ? session.pendingFields : [];
  if (pending.length === 0) {
    session.active = false;
    session.awaitingSubmitConfirmation = true;
    session.lastAskedField = null;
    return null;
  }

  const values = splitUserValues(goal);
  if (values.length === 0) {
    const nextField = session.lastAskedField || pending[0];
    session.lastAskedField = nextField || null;

    return {
      type: 'chat',
      message: askForField(nextField)
    };
  }

  const filled = [];
  let remainingValues = [...values];

  while (remainingValues.length > 0 && pending.length > 0) {
    const field = pending.shift();
    const value = remainingValues.shift();

    if (!field || !value) continue;

    const result = await fillOneField(tabId, field, value);
    if (result?.error) {
      continue;
    }

    filled.push({ field, value });

    session.filledFields = session.filledFields || {};
    session.filledFields[fieldKey(field)] = value;

    CopilotSw.agentState.chatHistory.push({
      role: 'tool',
      toolName: 'fill_input',
      content: result,
      timestamp: Date.now()
    });
  }

  session.pendingFields = pending;
  session.lastAskedField = pending[0] || null;

  if (filled.length === 0) {
    const fallbackField = session.lastAskedField || (values[0] ? normalizeFieldRef({ label: values[0] }) : null);
    return {
      type: 'chat',
      message: askForField(fallbackField)
    };
  }

  if (pending.length > 0) {
    const nextField = pending[0];
    return {
      type: 'chat',
      message: askForField(nextField)
    };
  }

  session.active = false;
  session.awaitingSubmitConfirmation = true;
  session.lastAskedField = null;

  return {
    type: 'chat',
    message: 'Thanks! I have filled the form fields. Say "yes" or "submit" if you want me to submit the form.'
  };
}

CopilotSw.tryDirectFormWorkflow = async function tryDirectFormWorkflow(goal, pageContext, tabId) {
  ensureFormSessionState();

  const normalizedGoal = String(goal || '').toLowerCase();

  const wantsEdit = CopilotSw.isFormEditGoal(normalizedGoal);
  const wantsFill =
    CopilotSw.isFormFillGoal(normalizedGoal) ||
    wantsEdit ||
    (CopilotSw.wasRecentFormFillConversation(CopilotSw.agentState.chatHistory) &&
      CopilotSw.isFormValueFollowupGoal(normalizedGoal));

  const wantsSubmit = CopilotSw.isFormSubmitGoal(normalizedGoal);
  const submitConfirmationIntent = isSubmitIntent(goal);
  const wantsClear = CopilotSw.isFormClearGoal(normalizedGoal);
  const wantsNegative = isNegativeIntent(goal);

  const session = CopilotSw.agentState.formSession;
  const formsInventory = CopilotSw.buildFormsInventory(pageContext);

  if (
    !wantsFill &&
    !wantsSubmit &&
    !submitConfirmationIntent &&
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

  // Clear / reset flow
  if (wantsClear) {
    const clearButtons = Array.isArray(pageContext?.buttons)
      ? pageContext.buttons.filter(btn => /\b(clear|reset|cancel|start over|wipe|empty)\b/i.test(String(btn.text || '')))
      : [];

    if (clearButtons.length > 0) {
      const clearBtn = clearButtons[0];
      const result = await CopilotSw.executeTool('click_element', {
        agent_id: clearBtn.agentId,
        selector: clearBtn.selector,
        description: clearBtn.text || 'Clear form'
      }, tabId);

      if (!result?.error) {
        clearFormSession();
        return `Cleared the form using "${clearBtn.text || 'Clear'}" button.`;
      }
    }

    await clearFieldsInForm(formsInventory, tabId);
    clearFormSession();
    return 'Cleared all form fields.';
  }

  // Edit / modify flow
  if (wantsEdit || session?.editMode) {
    session.active = true;
    session.awaitingSubmitConfirmation = false;

    if (!session.editMode) {
      const matchedField = findEditField(formsInventory, normalizedGoal);

      session.editMode = true;
      session.editField = matchedField ? normalizeFieldRef(matchedField) : null;

      await CopilotSw.agentState.save();

      if (session.editField) {
        return askForEditField(session.editField);
      }

      return 'Which field would you like to modify? (name, email, message)';
    }

    if (!session.editField) {
      const matchedField = findEditField(formsInventory, normalizedGoal);

      if (!matchedField) {
        await CopilotSw.agentState.save();
        return 'Please tell me which field to update: name, email, or message.';
      }

      session.editField = normalizeFieldRef(matchedField);
      await CopilotSw.agentState.save();

      return askForEditField(session.editField);
    }

    const editField = session.editField;
    const newValue = String(goal || '').trim();

    if (!newValue) {
      await CopilotSw.agentState.save();
      return askForEditField(editField);
    }

    const result = await fillOneField(tabId, editField, newValue);
    if (result?.error) {
      return `I could not update the ${editField.label || editField.name || 'field'}: ${result.error}`;
    }

    session.filledFields = session.filledFields || {};
    session.filledFields[fieldKey(editField)] = newValue;

    session.pendingFields = Array.isArray(session.pendingFields)
      ? session.pendingFields.filter(item => fieldKey(item) !== fieldKey(editField))
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
      timestamp: Date.now()
    });

    await CopilotSw.agentState.save();

    if (morePending) {
      return `${editField.label || editField.name || 'Field'} updated. ${askForField(session.pendingFields[0])}`;
    }

    return `${editField.label || editField.name || 'Field'} updated. Say "yes" or "submit" if you want me to submit the form.`;
  }

  // If user is confirming submission after fill
  if (session?.awaitingSubmitConfirmation) {
    if (submitConfirmationIntent || wantsSubmit) {
      const submitButton = resolveSubmitButton(pageContext, null, session);

      if (!submitButton?.selector && !submitButton?.agentId) {
        return 'I could not find a submit button for this form.';
      }

      CopilotSw.updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
      const submitResult = await CopilotSw.executeToolWithApproval('click_element', {
        agent_id: submitButton.agentId,
        selector: submitButton.selector,
        description: submitButton.text || 'Submit form'
      }, tabId);

      if (submitResult?.error) {
        return submitResult.error.includes('cancel')
          ? 'Submission was cancelled.'
          : `I could not submit the form: ${submitResult.error}`;
      }

      clearFormSession();
      return 'Submitted the form after your approval.';
    }

    if (wantsNegative) {
      session.awaitingSubmitConfirmation = false;
      session.active = false;
      await CopilotSw.agentState.save();
      return 'Okay, I will not submit it yet.';
    }

    return 'Say "yes" or "submit" if you want me to submit the form.';
  }

  // If a form session is already active, treat the message as follow-up input first.
  if (session?.active) {
    const followUp = await consumeFollowUpAnswers(goal, pageContext, tabId);
    if (followUp) {
      await CopilotSw.agentState.save();
      return followUp.message;
    }
  }

  // Handle explicit submit intent first when no active session remains.
  if (wantsSubmit) {
    const plan = await CopilotSw.requestFormFillPlan(goal, formsInventory, CopilotSw.agentState.chatHistory);
    const workflowPlan = CopilotSw.validateFormWorkflowPlan(plan, formsInventory);

    if (workflowPlan.missingRequired.length > 0) {
      setFormSession(workflowPlan.missingRequired, true, {
        submitButtons: workflowPlan.submitButtons,
        targetButton: workflowPlan.targetButton,
        awaitingSubmitConfirmation: false,
        editMode: false,
        editField: null
      });
      await CopilotSw.agentState.save();

      const questions = workflowPlan.missingRequired
        .slice(0, 3)
        .map(item => `- ${askForField(item)}`);

      return [
        'I found the form, but these required fields are missing:',
        ...questions
      ].join('\n');
    }

    const submitButton = resolveSubmitButton(pageContext, workflowPlan, session);
    if (!submitButton?.selector && !submitButton?.agentId) {
      return 'I could not find a submit button for this form.';
    }

    CopilotSw.updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
    const submitResult = await CopilotSw.executeToolWithApproval('click_element', {
      agent_id: submitButton.agentId,
      selector: submitButton.selector,
      description: submitButton.text || 'Submit form'
    }, tabId);

    if (submitResult?.error) {
      return submitResult.error.includes('cancel')
        ? 'Submission was cancelled.'
        : `I could not submit the form: ${submitResult.error}`;
    }

    clearFormSession();
    return 'Submitted the form after your approval.';
  }

  // If no active session, try to plan and fill the form.
  if (!session?.active) {
    const plan = await CopilotSw.requestFormFillPlan(goal, formsInventory, CopilotSw.agentState.chatHistory);
    const workflowPlan = CopilotSw.validateFormWorkflowPlan(plan, formsInventory);
    const responseLines = [];

    // Fill any fields suggested by the plan
    if (workflowPlan.fields.length > 0) {
      const filledFields = [];

      for (const fieldPlan of workflowPlan.fields) {
        const result = await CopilotSw.executeTool('fill_input', {
          agent_id: fieldPlan.agentId,
          selector: fieldPlan.selector,
          value: fieldPlan.value
        }, tabId);

        if (result?.error) continue;

        filledFields.push({
          field: fieldPlan.label,
          value: fieldPlan.value
        });

        CopilotSw.agentState.chatHistory.push({
          role: 'tool',
          toolName: 'fill_input',
          content: result,
          timestamp: Date.now()
        });
      }

      if (filledFields.length > 0) {
        responseLines.push([
          workflowPlan.summary || 'Filled the form with the information provided:',
          ...filledFields.map(item => `- ${item.field}: ${item.value}`)
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

    // Ask the user for missing information and start a form session.
    if (workflowPlan.missingRequired.length > 0 || workflowPlan.nextAction === 'ask_user') {
      setFormSession(workflowPlan.missingRequired, true, {
        submitButtons: workflowPlan.submitButtons,
        targetButton: workflowPlan.targetButton,
        awaitingSubmitConfirmation: false,
        editMode: false,
        editField: null
      });
      await CopilotSw.agentState.save();

      const questions = workflowPlan.missingRequired.length > 0
        ? workflowPlan.missingRequired.slice(0, 3).map(item => `- ${askForField(item)}`)
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

    // Continue / next button flow
    if (workflowPlan.nextAction === 'continue' && workflowPlan.targetButton) {
      const buttonText = String(workflowPlan.targetButton.text || '').toLowerCase();
      const buttonIntent = String(workflowPlan.targetButton.intent || '').toLowerCase();
      const looksLikeSubmit = buttonIntent === 'submit' || /\b(submit|apply|send|finish|complete|post)\b/.test(buttonText);

      if (looksLikeSubmit && !wantsSubmit) {
        responseLines.push('I filled the fields. Say "yes" or "submit" if you want me to submit the form.');
      } else {
        const clickFn = looksLikeSubmit ? CopilotSw.executeToolWithApproval : CopilotSw.executeTool;
        const continueResult = await clickFn('click_element', {
          agent_id: workflowPlan.targetButton.agentId,
          selector: workflowPlan.targetButton.selector,
          description: workflowPlan.targetButton.text || 'Continue'
        }, tabId);

        if (continueResult?.error) {
          return [
            ...responseLines,
            `I could not continue to the next step: ${continueResult.error}`
          ].filter(Boolean).join('\n\n');
        }

        responseLines.push(`Moved to the next step using "${workflowPlan.targetButton.text || 'Continue'}".`);
      }
    }

    if (wantsSubmit) {
      const submitButton = resolveSubmitButton(pageContext, workflowPlan, session);
      if (!submitButton?.selector && !submitButton?.agentId) {
        return [
          ...responseLines,
          'I could not find a submit button for this form.'
        ].filter(Boolean).join('\n\n');
      }

      CopilotSw.updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
      const submitResult = await CopilotSw.executeToolWithApproval('click_element', {
        agent_id: submitButton.agentId,
        selector: submitButton.selector,
        description: submitButton.text || 'Submit form'
      }, tabId);

      if (submitResult?.error) {
        return [
          ...responseLines,
          submitResult.error.includes('cancel')
            ? 'Submission was cancelled.'
            : `I could not submit the form: ${submitResult.error}`
        ].filter(Boolean).join('\n\n');
      }

      clearFormSession();
      responseLines.push('Submitted the form after your approval.');
    } else if (workflowPlan.nextAction === 'request_approval') {
      session.awaitingSubmitConfirmation = true;
      session.active = false;
      session.submitButtons = workflowPlan.submitButtons || [];
      session.targetButton = workflowPlan.targetButton || null;
      responseLines.push('Say "yes" or "submit" if you want me to submit the form.');
    }

    if (responseLines.length === 0) {
      if (workflowPlan.summary) {
        return workflowPlan.summary;
      }
      if (wantsFill) {
        return 'I found the form, but I could not update any fields automatically on this page.';
      }
      return null;
    }

    await CopilotSw.agentState.save();
    return responseLines.join('\n\n');
  }

  return null;
};