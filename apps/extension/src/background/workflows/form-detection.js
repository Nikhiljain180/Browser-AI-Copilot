/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// FORM DETECTION UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

CopilotSw.isFormClearGoal = function isFormClearGoal(goal) {
  const lowerGoal = String(goal || '').toLowerCase();
  return /\b(clear|reset|empty|wipe|erase|start over)\b.*\b(form|fields)?\b|\b(form|fields)\b.*\b(clear|reset|empty|wipe|erase|start over)\b/.test(
    lowerGoal,
  );
};

CopilotSw.isFormEditGoal = function isFormEditGoal(goal) {
  const lowerGoal = String(goal || '').toLowerCase();
  return /\b(edit|change|modify|update|correct|fix|replace)\b/.test(lowerGoal);
};

CopilotSw.detectMultiStepForm = function detectMultiStepForm(pageContext) {
  const buttons = Array.isArray(pageContext?.buttons) ? pageContext.buttons : [];
  const hasNextButton = buttons.some((btn) =>
    /\b(next|continue|proceed)\b/i.test(String(btn.text || '')),
  );
  const hasPrevButton = buttons.some((btn) =>
    /\b(prev|previous|back)\b/i.test(String(btn.text || '')),
  );

  return { isMultiStep: hasNextButton || hasPrevButton, hasNextButton, hasPrevButton };
};

CopilotSw.detectDynamicFields = function detectDynamicFields(currentFields, previousFields = []) {
  if (!previousFields || previousFields.length === 0) return [];

  const prevFieldIds = new Set();
  previousFields.forEach((field) => {
    if (field?.agentId) prevFieldIds.add(field.agentId);
    if (field?.selector) prevFieldIds.add(field.selector);
  });

  return (currentFields || []).filter((field) => {
    return !prevFieldIds.has(field.agentId) && !prevFieldIds.has(field.selector);
  });
};

CopilotSw.isSelectField = function isSelectField(field) {
  return (
    field &&
    (field.type === 'select' ||
      field.tagName === 'SELECT' ||
      (Array.isArray(field.options) && field.options.length > 0))
  );
};

CopilotSw.formatSelectOptions = function formatSelectOptions(field) {
  if (!field?.options || field.options.length === 0) return null;

  return field.options
    .slice(0, 5)
    .map(
      (opt, idx) =>
        `${idx + 1}. ${typeof opt === 'string' ? opt : opt.label || opt.text || String(opt)}`,
    )
    .join('\n');
};

CopilotSw.isFileUploadField = function isFileUploadField(field) {
  return (
    !!field &&
    (field.type === 'file' ||
      field.inputType === 'file' ||
      (field.tagName === 'INPUT' && field.inputType === 'file'))
  );
};

CopilotSw.detectValidationErrors = function detectValidationErrors(pageContext) {
  const errors = [];
  const pageText = String(pageContext?.textContent || '').toLowerCase();

  if (/\b(error|invalid|required|please fix|must be)\b/.test(pageText)) {
    errors.push('Page shows validation errors');
  }

  const allFields = Array.isArray(pageContext?.forms)
    ? pageContext.forms.flatMap((form) => form?.fields || [])
    : [];

  const errorFields = allFields.filter((field) => {
    const className = String(field.className || '').toLowerCase();
    return (
      className.includes('error') || className.includes('invalid') || field.ariaInvalid === true
    );
  });

  return { hasErrors: errors.length > 0 || errorFields.length > 0, count: errorFields.length };
};

CopilotSw.detectConfirmationDialog = function detectConfirmationDialog(pageContext) {
  const buttons = Array.isArray(pageContext?.buttons) ? pageContext.buttons : [];
  const hasConfirmBtn = buttons.some((btn) =>
    /\b(confirm|yes|ok|agree|accept)\b/i.test(String(btn.text || '')),
  );
  const hasCancelBtn = buttons.some((btn) =>
    /\b(cancel|no|decline|close)\b/i.test(String(btn.text || '')),
  );

  return { isConfirmationDialog: hasConfirmBtn && hasCancelBtn, hasConfirmBtn, hasCancelBtn };
};
