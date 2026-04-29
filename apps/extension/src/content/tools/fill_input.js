function fillInput(target, value) {
  try {
    const element = resolveElement(target);
    if (!element) {
      return { error: `Input not found: ${target?.agentId || target?.selector || 'unknown target'}` };
    }

    // Set value and trigger change event (React, Vue, Angular compatible)
    element.value = value;

    const inputEvent = new Event('input', { bubbles: true });
    const changeEvent = new Event('change', { bubbles: true });

    element.dispatchEvent(inputEvent);
    element.dispatchEvent(changeEvent);

    return {
      success: true,
      message: `✓ Filled input with: "${value}"`,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}