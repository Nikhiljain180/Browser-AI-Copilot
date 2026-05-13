/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// FIELD MATCHING, VALIDATION & INVENTORY
// ─────────────────────────────────────────────────────────────────────────────

const SEMANTIC_FIELD_HINTS = [
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
  'last name',
];

function getFieldHaystack(field) {
  return [
    field.label,
    field.name,
    field.question,
    field.type,
    field.placeholder,
    field.ariaLabel,
    field.selector,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

CopilotSw.findEditField = function findEditField(formsInventory, normalizedGoal) {
  const allFields = (formsInventory || []).flatMap((form) => form?.fields || []);
  const goal = String(normalizedGoal || '').toLowerCase();

  for (const hint of SEMANTIC_FIELD_HINTS) {
    if (!goal.includes(hint)) continue;
    const match = allFields.find((field) => getFieldHaystack(field).includes(hint));
    if (match) return match;
  }

  const scored = allFields.map((field) => {
    const haystack = getFieldHaystack(field);
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
};

CopilotSw.validateFormWorkflowPlan = function validateFormWorkflowPlan(plan, forms = []) {
  const allForms = Array.isArray(forms) ? forms : [];
  const allFields = allForms.flatMap((form) => form?.fields || []);
  const allButtons = allForms.flatMap((form) => form?.buttons || []);
  const allSubmitButtons = allForms.flatMap((form) => form?.submitButtons || []);

  const fieldLookup = CopilotSw.buildFieldLookup(allFields);
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
      reason: item.reason || '',
    });
  }

  const rawMissing = Array.isArray(plan?.missing_fields)
    ? plan.missing_fields.map(CopilotSw.normalizeFieldRef)
    : Array.isArray(plan?.missing_required)
      ? plan.missing_required.map(CopilotSw.normalizeFieldRef)
      : [];

  const dedupedMissing = [];
  const seenMissing = new Set();
  for (const ref of rawMissing) {
    const key = CopilotSw.fieldKey(ref);
    if (!key || seenMissing.has(key)) continue;
    seenMissing.add(key);
    dedupedMissing.push(ref);
  }

  const safePlan = {
    fields: validFields,
    missingFields: dedupedMissing,
    nextAction: String(plan?.next_action || '').trim(),
    summary: String(plan?.summary || '').trim(),
    targetButton: null,
    submitButtons: allSubmitButtons,
  };

  const buttonLookup = CopilotSw.buildButtonLookup(allButtons);
  if (plan?.target_button_agent_id) {
    const resolved = buttonLookup.get(plan.target_button_agent_id) || null;
    safePlan.targetButton = CopilotSw.normalizeButtonRef(resolved);
  }

  return safePlan;
};

CopilotSw.buildFormsInventory = function buildFormsInventory(pageContext) {
  const forms = Array.isArray(pageContext?.forms) ? pageContext.forms : [];
  const standaloneInputs = Array.isArray(pageContext?.inputs) ? pageContext.inputs : [];
  const standaloneButtons = Array.isArray(pageContext?.buttons) ? pageContext.buttons : [];

  const usedFieldIds = new Set();
  forms.forEach((form) => {
    (form.fields || []).forEach((field) => {
      if (field?.agentId) usedFieldIds.add(field.agentId);
      if (field?.selector) usedFieldIds.add(field.selector);
    });
  });

  const extraFields = standaloneInputs
    .filter((item) => item && item.visible !== false && !item.disabled)
    .filter((item) => !usedFieldIds.has(item.agentId) && !usedFieldIds.has(item.selector))
    .map((item) => ({
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
      selector: item.selector,
    }));

  const extraButtons = standaloneButtons
    .filter((item) => item && item.visible !== false && !item.disabled)
    .map((item) => ({
      agentId: item.agentId,
      text: item.text || '',
      type: item.type || 'button',
      visible: item.visible !== false,
      disabled: !!item.disabled,
      selector: item.selector,
      intent: 'unknown',
    }));

  if (extraFields.length === 0 && extraButtons.length === 0) return forms;

  return [
    ...forms,
    {
      id: 'page_inputs',
      agentId: 'page_inputs',
      selector: '',
      title: extraFields.length > 0 ? 'Page inputs' : 'Page actions',
      fields: extraFields,
      buttons: extraButtons,
      submitButtons: [],
      requiredUnfilledFields: [],
    },
  ];
};
