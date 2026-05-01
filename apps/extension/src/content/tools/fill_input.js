function fillInput(target, value) {
  try {
    const element = resolveElement(target);
    if (!element) {
      return { error: `Input not found: ${target?.agentId || target?.selector || 'unknown target'}` };
    }

    element.focus();
    setNativeValue(element, value);

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      success: true,
      message: `✓ Filled input with: "${value}"`,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}