/**
 * Token Budget Management
 * Handles context truncation and optimization
 */

export class TokenBudgetManager {
  constructor(maxTokens = 3000) {
    this.maxTokens = maxTokens;
  }

  /**
   * Estimate tokens (simple: ~4 chars = 1 token)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Truncate page context to fit token budget
   */
  truncatePageContext(pageContext, availableTokens) {
    const truncated = { ...pageContext };
    let usedTokens = 0;

    // Priority 1: Viewport elements
    if (truncated.elements) {
      const visibleElements = truncated.elements.filter(el => el.visible);
      truncated.elements = visibleElements.slice(0, 20); // Limit to 20 visible elements
      usedTokens += this.estimateTokens(JSON.stringify(truncated.elements));
    }

    // Priority 2: Forms (often important)
    if (truncated.forms && usedTokens < availableTokens * 0.5) {
      truncated.forms = truncated.forms.slice(0, 3); // Limit to 3 forms
      usedTokens += this.estimateTokens(JSON.stringify(truncated.forms));
    }

    // Priority 3: Text content (truncate)
    if (truncated.textContent) {
      const maxTextTokens = Math.max(100, availableTokens - usedTokens);
      const maxChars = maxTextTokens * 4;
      if (truncated.textContent.length > maxChars) {
        truncated.textContent = truncated.textContent.substring(0, maxChars) + '\n[... truncated]';
      }
    }

    // Priority 4: Tables (summarize)
    if (truncated.tables && usedTokens < availableTokens * 0.7) {
      truncated.tables = truncated.tables.map(table => ({
        ...table,
        rows: table.rows.slice(0, 5) // First 5 rows only
      }));
    }

    // Mark off-screen content
    truncated.offScreen = `[... ${pageContext.elements?.filter(el => !el.visible).length || 0} off-screen elements]`;

    return truncated;
  }

  /**
   * Create sliding window of conversation history
   */
  createConversationWindow(chatHistory, maxMessages = 10) {
    if (chatHistory.length <= maxMessages) {
      return chatHistory;
    }

    // Keep last N messages
    const recentMessages = chatHistory.slice(-maxMessages);

    // Optionally prepend summary of older messages
    const olderMessages = chatHistory.slice(0, -maxMessages);
    if (olderMessages.length > 0) {
      const summary = {
        role: 'system',
        content: `Previous context: ${olderMessages.length} earlier messages summarized. User has been asking about: [${
          olderMessages.map(m => m.content?.substring(0, 30)).join(', ')
        }]`
      };
      return [summary, ...recentMessages];
    }

    return recentMessages;
  }
}
