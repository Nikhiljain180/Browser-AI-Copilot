/* global CopilotSw */

CopilotSw.getSuggestedPrompts = async function getSuggestedPrompts() {
  const fallbackPrompts = [
    'Summarize this page in 5 bullets',
    'Find the main CTA and explain it',
    'Draft a reply based on this page',
  ];

  const isSearchLikeField = (field) => {
    const type = String(field?.type || '').toLowerCase();
    const label = String(field?.label || '').toLowerCase();
    const placeholder = String(field?.placeholder || '').toLowerCase();
    const ariaLabel = String(field?.ariaLabel || '').toLowerCase();
    const text = `${label} ${placeholder} ${ariaLabel}`.trim();

    if (type === 'search') return true;
    return /\bsearch\b/.test(text) || /\bsearch for\b/.test(text);
  };

  const countMeaningfulFormFields = (forms = []) => {
    const allFields = (forms || []).flatMap(form => form?.fields || []);
    return allFields.filter(field => {
      if (!field || field.visible === false || field.disabled) return false;
      const type = String(field.type || '').toLowerCase();
      if (type === 'hidden') return false;
      if (isSearchLikeField(field)) return false;
      return true;
    }).length;
  };

  const hasSearchBox = (pageContext) => {
    const inputs = Array.isArray(pageContext?.inputs) ? pageContext.inputs : [];
    const formFields = (Array.isArray(pageContext?.forms) ? pageContext.forms : [])
      .flatMap(form => form?.fields || []);

    const candidates = [...inputs, ...formFields];
    return candidates.some(field => {
      if (!field || field.visible === false || field.disabled) return false;
      return isSearchLikeField(field);
    });
  };

  try {
    const tab = await CopilotSw.getUsableTab();
    const pageContext = await CopilotSw.sendMessageToTab(tab.id, {
      action: 'readPage',
      focusArea: null
    });

    const meaningfulFields = countMeaningfulFormFields(pageContext?.forms || []);

    if (meaningfulFields >= 2) {
      return {
        prompts: [
          'Fill this form with dummy data',
          'Fill with some other value',
          'Explain what this form is asking for',
        ]
      };
    }

    if (hasSearchBox(pageContext)) {
      return {
        prompts: [
          'Search for "wireless headphones" and summarize the top results',
          'Find today\'s best deal on this page',
          'What can I do on this page?',
        ]
      };
    }

    if (pageContext?.tables?.length) {
      return {
        prompts: [
          'Extract all rows from this page',
          'Summarize the key data in this table',
          'Find the most important item and explain why',
        ]
      };
    }

    if (pageContext?.buttons?.length) {
      return {
        prompts: [
          'Find the main CTA and explain it',
          'Summarize this page in 5 bullets',
          'What actions can I take on this page?',
        ]
      };
    }
  } catch (error) {
    console.warn('Could not infer starter prompts from page context', error);
  }

  return { prompts: fallbackPrompts };
};

