// @ts-nocheck
/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// FIELD MATCHING, VALIDATION & INVENTORY
// ─────────────────────────────────────────────────────────────────────────────

const SEMANTIC_FIELD_HINTS = [
  'email', 'name', 'message', 'phone', 'mobile', 'tel', 'address',
  'city', 'state', 'zip', 'postal', 'subject', 'password', 'username',
  'comment', 'note', 'company', 'first name', 'last name',
];

function getFieldHaystack(field) {
  return [
    field.label, field.name, field.question, field.type,
    field.placeholder, field.ariaLabel, field.selector,
  ].filter(Boolean).join(' ').toLowerCase();
}

function isFieldFilled(field) {
  if (!field) return false;
  if (typeof field.isFilled === 'boolean') return field.isFilled;

  const type = String(field.type || '').toLowerCase();
  if (type === 'checkbox' || type === 'radio') {
    return !!field.checked;
  }

  const currentValue = typeof field.currentValue === 'string'
    ? field.currentValue.trim()
    : typeof field.value === 'string'
      ? field.value.trim()
      : '';

  if (Array.isArray(field.options) && field.options.some(option => option?.selected && option?.value)) {
    return true;
  }

  return currentValue.length > 0;
}

function mergeFieldRefs(primary = [], fallback = []) {
  const merged = [];
  const seen = new Set();

  for (const item of [...primary, ...fallback]) {
    const normalized = CopilotSw.normalizeFieldRef(item);
    const key = CopilotSw.fieldKey(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }

  return merged;
}

CopilotSw.findEditField = function findEditField(formsInventory, normalizedGoal) {
  const allFields = (formsInventory || []).flatMap(form => form?.fields || []);
  const goal = String(normalizedGoal || '').toLowerCase();

  for (const hint of SEMANTIC_FIELD_HINTS) {
    if (!goal.includes(hint)) continue;
    const match = allFields.find(field => getFieldHaystack(field).includes(hint));
    if (match) return match;
  }

  const scored = allFields.map(field => {
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
  const allFields = allForms.flatMap(form => form?.fields || []);
  const allButtons = allForms.flatMap(form => form?.buttons || []);
  const allSubmitButtons = allForms.flatMap(form => form?.submitButtons || []);

  const fieldLookup = CopilotSw.buildFieldLookup(allFields);
  const validFields = [];

  for (const item of plan.fields || []) {
    const agentId = item?.agent_id || item?.agentId || '';
    const selector = item?.selector || '';
    const rawValue = item?.value;

    if ((!agentId && !selector) || typeof rawValue !== 'string') continue;

    const field = fieldLookup.get(agentId) || fieldLookup.get(selector);
    // Do not drop fields based on visibility heuristics. Some pages misreport
    // visibility while still being user-fillable, which causes incomplete plans.
    if (!field || field.disabled) continue;

    validFields.push({
      agentId: field.agentId || agentId || '',
      selector: field.selector || selector || '',
      value: rawValue.trim(),
      label: field.label || field.name || selector || agentId,
      reason: item.reason || '',
    });
  }

  const safePlan = {
    fields: validFields,
    missingRequired: [],
    nextAction: String(plan?.next_action || '').trim(),
    summary: String(plan?.summary || '').trim(),
    targetButton: null,
    submitButtons: allSubmitButtons,
  };

  if (Array.isArray(plan?.missing_required)) {
    const normalizedMissing = plan.missing_required.map(item => {
      const agentId = item?.agent_id || item?.agentId || '';
      const selector = item?.selector || '';
      const field = fieldLookup.get(agentId) || fieldLookup.get(selector);

      return CopilotSw.normalizeFieldRef({
        ...field,
        ...item,
        agentId: field?.agentId || agentId || '',
        selector: field?.selector || selector || '',
        label: item?.label || field?.label || field?.name || '',
        question: item?.question || '',
        type: field?.type || item?.type || '',
      });
    });

    safePlan.missingRequired = mergeFieldRefs(normalizedMissing);
  }

  const buttonLookup = CopilotSw.buildButtonLookup(allButtons);
  if (plan?.target_button_agent_id) {
    safePlan.targetButton = buttonLookup.get(plan.target_button_agent_id) || null;
  }

  return safePlan;
};

CopilotSw.mergeMissingFieldRefs = function mergeMissingFieldRefs(primary = [], fallback = []) {
  return mergeFieldRefs(primary, fallback);
};

CopilotSw.collectMissingFieldsFromInventory = function collectMissingFieldsFromInventory(formsInventory = [], options = {}) {
  const allForms = Array.isArray(formsInventory) ? formsInventory : [];
  const includeOptionalImportant = !!options.includeOptionalImportant;
  const includeOptionalAll = !!options.includeOptionalAll;
  const fields = allForms.flatMap(form => form?.fields || []);

  const missingFields = fields.filter(field => {
    if (!field || field.disabled || CopilotSw.isFileUploadField?.(field)) return false;
    if (isFieldFilled(field)) return false;
    if (field.required) return true;
    if (includeOptionalAll) return true;
    if (!includeOptionalImportant) return false;
    return SEMANTIC_FIELD_HINTS.some(hint => getFieldHaystack(field).includes(hint));
  });

  return mergeFieldRefs(missingFields);
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
    // Do not filter on "visible" here; read_page visibility heuristics can be wrong.
    // We still avoid disabled inputs.
    .filter(item => item && !item.disabled)
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
      selector: item.selector,
    }));

  const extraButtons = standaloneButtons
    .filter(item => item && !item.disabled)
    .map(item => ({
      agentId: item.agentId,
      text: item.text || '',
      type: item.type || 'button',
      visible: item.visible !== false,
      disabled: !!item.disabled,
      selector: item.selector,
      intent: 'unknown',
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
      requiredUnfilledFields: [],
    },
  ];
};
