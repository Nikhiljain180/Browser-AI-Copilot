// @ts-nocheck
function applyTokenBudget(tree) {
  const maxTokens = window.__MAX_PAGE_CONTEXT_TOKENS__ || 3000;
  let currentTokens = 0;

  currentTokens += estimateTokens(tree.url);
  currentTokens += estimateTokens(tree.title);

  // Ensure all arrays exist (prevents "Cannot read properties of undefined" errors)
  tree.buttons = tree.buttons || [];
  tree.links = tree.links || [];
  tree.elements = tree.elements || [];
  tree.sections = tree.sections || [];
  tree.textContent = tree.textContent || '';

  const budgets = {
    buttons: Math.floor(maxTokens * 0.1),
    links: Math.floor(maxTokens * 0.15),
    elements: Math.floor(maxTokens * 0.2),
    text: Math.floor(maxTokens * 0.4),
    sections: Math.floor(maxTokens * 0.15)
  };

  tree.buttons = tree.buttons
    .sort((a, b) => (b.visible ? 1 : -1) - (a.visible ? 1 : -1))
    .filter(btn => {
      const tokens = estimateTokens(btn.text);
      if (currentTokens + tokens <= budgets.buttons) {
        currentTokens += tokens;
        return true;
      }
      return false;
    });

  tree.links = tree.links
    .filter(link => {
      const tokens = estimateTokens(link.text + link.href);
      if (currentTokens + tokens <= budgets.links) {
        currentTokens += tokens;
        return true;
      }
      return false;
    });
  if (tree.links.length > 20) {
    tree.links = tree.links.slice(0, 20);
    tree._linksExceeded = true;
  }

  tree.elements = tree.elements
    .sort((a, b) => (b.visible ? 1 : -1) - (a.visible ? 1 : -1))
    .filter(el => {
      const tokens = estimateTokens(el.text);
      if (currentTokens + tokens <= budgets.elements) {
        currentTokens += tokens;
        return true;
      }
      return false;
    });

  const textTokens = estimateTokens(tree.textContent);
  if (textTokens > budgets.text) {
    const maxChars = budgets.text * 4;
    tree.textContent = tree.textContent.substring(0, maxChars) + '\n[... text truncated for token budget]';
    tree._textTruncated = true;
  }
  currentTokens += estimateTokens(tree.textContent);

  tree.sections = tree.sections.filter(section => {
    const tokens = estimateTokens(section.title + section.text);
    if (currentTokens + tokens <= budgets.sections) {
      currentTokens += tokens;
      return true;
    }
    return false;
  });
  if (tree.sections.length > 8) {
    tree.sections = tree.sections.slice(0, 8);
    tree._sectionsExceeded = true;
  }

  tree._tokenInfo = {
    estimated: currentTokens,
    maxBudget: maxTokens,
    exceeded: currentTokens > maxTokens
  };

  return tree;
}