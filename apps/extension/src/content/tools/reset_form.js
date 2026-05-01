function resetForm(toolInput = {}) {
  try {
    const { selector, agentId, agent_id } = toolInput;

    // If a specific form is targeted, reset just that form
    if (selector || agentId || agent_id) {
      const form = resolveElement({ selector, agentId, agent_id });
      if (!form) {
        return { error: `Form not found: ${selector || agentId || agent_id}` };
      }

      if (form.tagName === 'FORM') {
        const clearedCount = clearFormFields(form);
        return {
          success: true,
          message: `✓ Reset form: cleared ${clearedCount} field(s)`,
          timestamp: Date.now()
        };
      }

      // If target is not a <form>, try to find the closest form
      const parentForm = form.closest('form');
      if (parentForm) {
        const clearedCount = clearFormFields(parentForm);
        return {
          success: true,
          message: `✓ Reset parent form: cleared ${clearedCount} field(s)`,
          timestamp: Date.now()
        };
      }
    }

    // No specific target — reset ALL forms on the page
    const forms = document.querySelectorAll('form');
    if (forms.length === 0) {
      // Fallback: clear all visible inputs even if not inside a <form>
      const clearedCount = clearAllInputs();
      return {
        success: true,
        message: `✓ No forms found. Cleared ${clearedCount} standalone input(s)`,
        timestamp: Date.now()
      };
    }

    let totalCleared = 0;
    forms.forEach(form => {
      totalCleared += clearFormFields(form);
    });

    return {
      success: true,
      message: `✓ Reset ${forms.length} form(s): cleared ${totalCleared} field(s)`,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

function clearFormFields(form) {
  let count = 0;

  form.querySelectorAll('input, textarea, select').forEach(field => {
    if (field.disabled) return;

    const cleared = clearSingleField(field);
    if (cleared) count++;
  });

  return count;
}

function clearAllInputs() {
  let count = 0;

  document.querySelectorAll('input, textarea, select').forEach(field => {
    if (field.disabled) return;
    if (!isElementVisible(field)) return;

    const cleared = clearSingleField(field);
    if (cleared) count++;
  });

  return count;
}

function clearSingleField(field) {
  const type = (field.type || '').toLowerCase();

  // Skip hidden, submit, and button inputs
  if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) {
    return false;
  }

  if (type === 'checkbox' || type === 'radio') {
    if (field.checked) {
      field.checked = false;
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  if (field.tagName === 'SELECT') {
    if (field.selectedIndex !== 0) {
      field.selectedIndex = 0;
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  // Text inputs, textareas
  if (field.value !== '') {
    field.focus();
    setNativeValue(field, '');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  return false;
}