function clickElement(target, description) {
  try {
    const element = resolveElement(target);
    if (!element) {
      return { error: `Element not found: ${target?.agentId || target?.selector || 'unknown target'}` };
    }

    if (!isElementVisible(element)) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    element.focus();
    element.click();

    return {
      success: true,
      message: `✓ Clicked: ${description || target?.selector || target?.agentId}`,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}