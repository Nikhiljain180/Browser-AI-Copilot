// @ts-nocheck
/**
 * Form Reset
 * Handles: native forms, contenteditable, rich text editors,
 *          default values, partial resets, and undo capability
 */
function resetForm(toolInput = {}) {
  try {
    const {
      selector,
      agentId,
      agent_id,
      mode = 'empty',           // 'empty' | 'defaults' | 'native'
      fields = null,            // array of field names/selectors to reset (null = all)
      clearValidation = true,   // also clear validation error styles
      clearVisualState = true,  // clear any highlight/border changes from fillInput
      saveUndo = true,          // store previous values for undo
      confirm = false           // if true, would require confirmation (for safety)
    } = toolInput;

    // ── 1. Find the target form(s) ──
    const forms = resolveTargetForms({ selector, agentId, agent_id });

    if (forms.length === 0) {
      // Fallback: clear standalone inputs
      const result = clearStandaloneInputs(mode, fields, clearVisualState);
      return result;
    }

    // ── 2. Save undo state (before clearing) ──
    let undoData = null;
    if (saveUndo) {
      undoData = captureFormState(forms);
    }

    // ── 3. Reset each form ──
    let totalCleared = 0;
    let totalForms = 0;

    forms.forEach(form => {
      const cleared = resetSingleForm(form, {
        mode,
        fields,
        clearValidation,
        clearVisualState
      });
      totalCleared += cleared;
      totalForms++;
    });

    // ── 4. Store undo state globally ──
    if (saveUndo && undoData) {
      window.__copilotFormUndo = undoData;
    }

    return {
      success: true,
      message: `✓ Reset ${totalForms} form(s): cleared ${totalCleared} field(s)`,
      mode,
      formsReset: totalForms,
      fieldsCleared: totalCleared,
      undoAvailable: saveUndo,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}


/**
 * Undo form reset — restore previous values
 */
function undoFormReset() {
  const undoData = window.__copilotFormUndo;
  if (!undoData) {
    return { error: 'No undo data available. No previous reset to undo.' };
  }

  let restoredCount = 0;

  undoData.forEach(({ selector, value, type, checked }) => {
    const element = document.querySelector(selector);
    if (!element) return;

    if (type === 'checkbox' || type === 'radio') {
      element.checked = checked;
    } else if (element.tagName === 'SELECT') {
      element.value = value;
    } else if (element.isContentEditable) {
      element.innerText = value;
    } else {
      setNativeValue(element, value);
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    restoredCount++;
  });

  window.__copilotFormUndo = null;

  return {
    success: true,
    message: `✓ Undo complete: restored ${restoredCount} field(s)`,
    timestamp: Date.now()
  };
}


// ═══════════════════════════════════════════════════
// FORM RESOLUTION
// ═══════════════════════════════════════════════════

function resolveTargetForms({ selector, agentId, agent_id }) {
  // Specific target provided
  if (selector || agentId || agent_id) {
    const target = resolveElement({ selector, agentId, agent_id });
    if (!target) return [];

    // Target IS a form
    if (target.tagName === 'FORM') return [target];

    // Target is inside a form
    const parentForm = target.closest('form');
    if (parentForm) return [parentForm];

    // Target is a container with forms inside
    const childForms = target.querySelectorAll('form');
    if (childForms.length > 0) return Array.from(childForms);

    // Target is a container with inputs (no <form> tag)
    if (target.querySelector('input, textarea, select')) {
      return [target]; // Treat container as a pseudo-form
    }

    return [];
  }

  // No target — get all forms
  const allForms = document.querySelectorAll('form');
  return Array.from(allForms);
}


// ═══════════════════════════════════════════════════
// SINGLE FORM RESET
// ═══════════════════════════════════════════════════

function resetSingleForm(form, options) {
  const { mode, fields, clearValidation, clearVisualState } = options;
  let clearedCount = 0;

  // ── Native reset (uses HTML default values) ──
  if (mode === 'native' && form.tagName === 'FORM') {
    form.reset();
    // Still need to fire events for frameworks
    form.querySelectorAll('input, textarea, select').forEach(field => {
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clearedCount = form.querySelectorAll('input, textarea, select').length;
  } else {
    // ── Manual reset (field by field) ──
    const formFields = form.querySelectorAll('input, textarea, select, [contenteditable="true"]');

    formFields.forEach(field => {
      // Skip if we're only resetting specific fields
      if (fields && !shouldResetField(field, fields)) return;

      // Skip disabled fields
      if (field.disabled) return;

      const cleared = clearField(field, mode);
      if (cleared) clearedCount++;
    });
  }

  // ── Clear validation state ──
  if (clearValidation) {
    clearValidationState(form);
  }

  // ── Clear visual state (borders, shadows from fillInput) ──
  if (clearVisualState) {
    clearVisualStyles(form);
  }

  return clearedCount;
}


// ═══════════════════════════════════════════════════
// FIELD CLEARING (universal)
// ═══════════════════════════════════════════════════

function clearField(field, mode) {
  const tagName = field.tagName.toUpperCase();
  const type = (field.type || '').toLowerCase();

  // Skip non-clearable types
  if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(type)) {
    return false;
  }

  // ── Determine target value ──
  let targetValue = '';
  if (mode === 'defaults') {
    targetValue = getDefaultValue(field);
  }

  // ── CHECKBOX ──
  if (type === 'checkbox') {
    const defaultChecked = mode === 'defaults' ? field.defaultChecked : false;
    if (field.checked !== defaultChecked) {
      field.checked = defaultChecked;
      fireFieldEvents(field);
      return true;
    }
    return false;
  }

  // ── RADIO ──
  if (type === 'radio') {
    const defaultChecked = mode === 'defaults' ? field.defaultChecked : false;
    if (field.checked !== defaultChecked) {
      field.checked = defaultChecked;
      fireFieldEvents(field);
      return true;
    }
    return false;
  }

  // ── SELECT ──
  if (tagName === 'SELECT') {
    const defaultIndex = mode === 'defaults' ? getDefaultSelectedIndex(field) : 0;
    if (field.selectedIndex !== defaultIndex) {
      field.selectedIndex = defaultIndex;
      fireFieldEvents(field);
      return true;
    }
    return false;
  }

  // ── CONTENTEDITABLE ──
  if (field.isContentEditable || field.contentEditable === 'true') {
    const currentContent = field.innerText || '';
    if (currentContent.trim()) {
      field.innerHTML = '';
      field.innerText = targetValue;
      field.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContent'
      }));
      return true;
    }
    return false;
  }

  // ── TEXT INPUTS / TEXTAREA ──
  if (field.value !== targetValue) {
    field.focus();
    setNativeValue(field, targetValue);
    fireFieldEvents(field);
    field.blur();
    return true;
  }

  return false;
}


/**
 * Get the HTML default value for a field
 */
function getDefaultValue(field) {
  // defaultValue is the value from the HTML source (not current state)
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  return '';
}


/**
 * Get default selected index for <select>
 */
function getDefaultSelectedIndex(select) {
  const options = select.options;
  for (let i = 0; i < options.length; i++) {
    if (options[i].defaultSelected) return i;
  }
  return 0; // First option
}


/**
 * Determine if a field should be reset (partial reset)
 */
function shouldResetField(field, fieldList) {
  const fieldName = field.name || '';
  const fieldId = field.id || '';
  const fieldLabel = getFieldLabel(field).toLowerCase();
  const fieldSelector = generateSelector(field);

  return fieldList.some(target => {
    const t = target.toLowerCase();
    return fieldName.toLowerCase() === t ||
           fieldId.toLowerCase() === t ||
           fieldLabel.includes(t) ||
           fieldSelector === target;
  });
}


// ═══════════════════════════════════════════════════
// VISUAL & VALIDATION STATE CLEANUP
// ═══════════════════════════════════════════════════

/**
 * Clear validation error styles and messages
 */
function clearValidationState(form) {
  // Clear native validation
  form.querySelectorAll(':invalid').forEach(field => {
    field.setCustomValidity('');
  });

  // Clear common validation error classes
  const errorClasses = [
    'is-invalid', 'has-error', 'error', 'invalid',
    'field-error', 'input-error', 'form-error',
    'was-validated'
  ];

  errorClasses.forEach(cls => {
    form.querySelectorAll(`.${cls}`).forEach(el => {
      el.classList.remove(cls);
    });
  });

  // Also remove from form itself
  form.classList.remove('was-validated');

  // Hide error message elements
  const errorMessageSelectors = [
    '.error-message', '.field-error-message', '.invalid-feedback',
    '.help-block.error', '[class*="error-msg"]', '[class*="error-text"]',
    '[role="alert"]'
  ];

  errorMessageSelectors.forEach(selector => {
    form.querySelectorAll(selector).forEach(el => {
      el.style.display = 'none';
      el.textContent = '';
    });
  });
}


/**
 * Clear any visual styles added by fillInput (green borders, glows, etc.)
 */
function clearVisualStyles(form) {
  const fields = form.querySelectorAll('input, textarea, select, [contenteditable]');

  fields.forEach(field => {
    // Remove inline styles that fillInput might have added
    field.style.removeProperty('border-color');
    field.style.removeProperty('box-shadow');
    field.style.removeProperty('background-color');
    field.style.removeProperty('outline');
    field.style.removeProperty('border');

    // Remove success/highlight classes
    const highlightClasses = [
      'is-valid', 'success', 'filled', 'highlighted',
      'copilot-filled', 'ai-filled', 'auto-filled'
    ];
    highlightClasses.forEach(cls => field.classList.remove(cls));

    // Remove animation classes
    field.classList.remove('highlight-extract', 'animate-fill');
  });
}


// ═══════════════════════════════════════════════════
// STANDALONE INPUTS (no <form> tag)
// ═══════════════════════════════════════════════════

function clearStandaloneInputs(mode, fields, clearVisualState) {
  let count = 0;

  const allInputs = document.querySelectorAll(
    'input:not(form input), textarea:not(form textarea), ' +
    'select:not(form select), [contenteditable="true"]:not(form [contenteditable])'
  );

  // If no standalone inputs, try ALL visible inputs
  const inputs = allInputs.length > 0
    ? allInputs
    : document.querySelectorAll('input, textarea, select, [contenteditable="true"]');

  inputs.forEach(field => {
    if (!isElementVisible(field)) return;
    if (field.disabled) return;
    if (fields && !shouldResetField(field, fields)) return;

    const cleared = clearField(field, mode);
    if (cleared) count++;

    if (clearVisualState) {
      field.style.removeProperty('border-color');
      field.style.removeProperty('box-shadow');
      field.style.removeProperty('background-color');
    }
  });

  return {
    success: true,
    message: `✓ No <form> found. Cleared ${count} standalone input(s)`,
    mode,
    fieldsCleared: count,
    timestamp: Date.now()
  };
}


// ═══════════════════════════════════════════════════
// FORM STATE CAPTURE (for undo)
// ═══════════════════════════════════════════════════

function captureFormState(forms) {
  const state = [];

  forms.forEach(form => {
    const fields = form.querySelectorAll('input, textarea, select, [contenteditable]');

    fields.forEach(field => {
      const type = (field.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset'].includes(type)) return;

      const fieldState = {
        selector: generateSelector(field),
        type
      };

      if (type === 'checkbox' || type === 'radio') {
        fieldState.checked = field.checked;
      } else if (field.tagName === 'SELECT') {
        fieldState.value = field.value;
      } else if (field.isContentEditable) {
        fieldState.value = field.innerText;
      } else {
        fieldState.value = field.value;
      }

      state.push(fieldState);
    });
  });

  return state;
}


// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════

