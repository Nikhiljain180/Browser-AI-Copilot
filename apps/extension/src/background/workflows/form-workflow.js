/* global CopilotSw */

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
    if ((!item?.agent_id && !item?.selector) || typeof item.value !== 'string') continue;
    const field = fieldLookup.get(item.agent_id) || fieldLookup.get(item.selector);
    if (!field || field.disabled || field.visible === false) continue;
    validFields.push({
      agentId: field.agentId || item.agent_id || '',
      selector: field.selector || item.selector || '',
      value: item.value.trim(),
      label: field.label || field.name || item.selector,
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
    missingRequired: Array.isArray(plan?.missing_required) ? plan.missing_required : [],
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

CopilotSw.tryDirectFormWorkflow = async function tryDirectFormWorkflow(goal, pageContext, tabId) {
  const normalizedGoal = String(goal || '').toLowerCase();
  const wantsFill =
    CopilotSw.isFormFillGoal(normalizedGoal) ||
    (CopilotSw.wasRecentFormFillConversation(CopilotSw.agentState.chatHistory) && CopilotSw.isFormValueFollowupGoal(normalizedGoal));
  const wantsSubmit = CopilotSw.isFormSubmitGoal(normalizedGoal);

  if (!wantsFill && !wantsSubmit) return null;

  const formsInventory = CopilotSw.buildFormsInventory(pageContext);
  if (!formsInventory.length) return 'I could not find any form fields on this page.';

  const plan = await CopilotSw.requestFormFillPlan(goal, formsInventory, CopilotSw.agentState.chatHistory);
  const workflowPlan = CopilotSw.validateFormWorkflowPlan(plan, formsInventory);
  const responseLines = [];

  if (workflowPlan.fields.length > 0) {
    const filledFields = [];
    for (const fieldPlan of workflowPlan.fields) {
      const result = await CopilotSw.executeTool('fill_input', {
        agent_id: fieldPlan.agentId,
        selector: fieldPlan.selector,
        value: fieldPlan.value
      }, tabId);

      if (result?.error) {
        continue;
      }

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
        workflowPlan.summary || 'Filled the form with generated values:',
        ...filledFields.map(item => `- ${item.field}: ${item.value}`)
      ].join('\n'));
    }
  }

  if (workflowPlan.nextAction === 'ask_user' && workflowPlan.missingRequired.length > 0) {
    const questions = workflowPlan.missingRequired
      .slice(0, 3)
      .map(item => `- ${item.question || `Please provide ${item.label || 'this required detail'}.`}`);
    return [
      ...responseLines,
      'I need a bit more information before I can continue:',
      ...questions
    ].filter(Boolean).join('\n');
  }

  if (workflowPlan.nextAction === 'continue' && workflowPlan.targetButton) {
    const buttonText = String(workflowPlan.targetButton.text || '').toLowerCase();
    const buttonIntent = String(workflowPlan.targetButton.intent || '').toLowerCase();
    const looksLikeSubmit = buttonIntent === 'submit' || /\b(submit|apply|send|finish|complete|post)\b/.test(buttonText);

    if (looksLikeSubmit && !wantsSubmit) {
      responseLines.push('I filled the fields. Tell me to submit if you want me to submit the form.');
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
    const submitButton = workflowPlan.targetButton || workflowPlan.submitButtons?.[0];
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

    responseLines.push('Submitted the form after your approval.');
  } else if (workflowPlan.nextAction === 'request_approval') {
    responseLines.push('I filled the fields. Tell me to submit if you want me to submit the form.');
  }

  if (responseLines.length === 0) {
    if (wantsFill) {
      return 'I found the form, but I could not update any fields automatically on this page.';
    }
    return null;
  }

  return responseLines.join('\n\n');
};

