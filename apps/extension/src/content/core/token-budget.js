function applyTokenBudget(tree) {
  const maxTokens = window.__MAX_PAGE_CONTEXT_TOKENS__ || 3000;

  // Ensure all arrays exist (prevents "Cannot read properties of undefined" errors)
  tree.buttons = tree.buttons || [];
  tree.links = tree.links || [];
  tree.elements = tree.elements || [];
  tree.sections = tree.sections || [];
  tree.textContent = tree.textContent || '';

  const preambleTokens = estimateTokens(tree.url) + estimateTokens(tree.title);

  const budgets = {
    buttons: Math.floor(maxTokens * 0.1),
    links: Math.floor(maxTokens * 0.15),
    elements: Math.floor(maxTokens * 0.2),
    text: Math.floor(maxTokens * 0.4),
    sections: Math.floor(maxTokens * 0.15),
  };

  let buttonsTokens = 0;
  tree.buttons = tree.buttons
    .sort((a, b) => (b.visible ? 1 : -1) - (a.visible ? 1 : -1))
    .filter((btn) => {
      const tokens = estimateTokens(btn.text);
      if (buttonsTokens + tokens <= budgets.buttons) {
        buttonsTokens += tokens;
        return true;
      }
      return false;
    });

  let linksTokens = 0;
  tree.links = tree.links.filter((link) => {
    const tokens = estimateTokens(link.text + link.href);
    if (linksTokens + tokens <= budgets.links) {
      linksTokens += tokens;
      return true;
    }
    return false;
  });
  if (tree.links.length > 20) {
    tree.links = tree.links.slice(0, 20);
    tree._linksExceeded = true;
  }

  let elementsTokens = 0;
  tree.elements = tree.elements
    .sort((a, b) => (b.visible ? 1 : -1) - (a.visible ? 1 : -1))
    .filter((el) => {
      const tokens = estimateTokens(el.text);
      if (elementsTokens + tokens <= budgets.elements) {
        elementsTokens += tokens;
        return true;
      }
      return false;
    });

  let textTokens = 0;
  const _textTokens = estimateTokens(tree.textContent);
  if (_textTokens > budgets.text) {
    const maxChars = budgets.text * 4;
    tree.textContent =
      tree.textContent.substring(0, maxChars) + '\n[... text truncated for token budget]';
    tree._textTruncated = true;
    textTokens = budgets.text;
  } else {
    textTokens = _textTokens;
  }

  let sectionsTokens = 0;
  tree.sections = tree.sections.filter((section) => {
    const tokens = estimateTokens(section.title + section.text);
    if (sectionsTokens + tokens <= budgets.sections) {
      sectionsTokens += tokens;
      return true;
    }
    return false;
  });
  if (tree.sections.length > 8) {
    tree.sections = tree.sections.slice(0, 8);
    tree._sectionsExceeded = true;
  }

  const estimated = preambleTokens + buttonsTokens + linksTokens + elementsTokens + textTokens + sectionsTokens;
  tree._tokenInfo = {
    estimated,
    maxBudget: maxTokens,
    exceeded: estimated > maxTokens,
  };

  return tree;
}
