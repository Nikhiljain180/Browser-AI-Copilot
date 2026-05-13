export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .join('\n');
  }

  if (content == null) return '';

  return JSON.stringify(content);
}

export function inferQueryType(goal: string): 'action' | 'informational' {
  const text = String(goal || '').toLowerCase();

  const actionSignals = [
    'click',
    'tap',
    'press',
    'scroll',
    'navigate',
    'open',
    'go to',
    'fill',
    'type',
    'enter',
    'submit',
    'apply',
    'sign in',
    'login',
    'log in',
    'download',
    'upload',
    'extract',
    'copy',
    'paste',
    'select',
    'choose',
    'search for',
    'find and click',
    'book',
    'buy',
    'purchase',
  ];

  if (actionSignals.some((signal) => text.includes(signal))) {
    return 'action';
  }

  const structuredAnalysisSignals = [
    'find the ',
    'find a ',
    'which ',
    'who ',
    'what is the total',
    'total value',
    'sum of',
    'how many',
    'most popular',
    'most reviews',
    'highest rating',
    'low in stock',
    'low stock',
    'delivered orders',
    'create an order',
    'place an order',
  ];

  if (structuredAnalysisSignals.some((signal) => text.includes(signal))) {
    return 'action';
  }

  if (/\b(fetch|list|browse)\s/.test(text) || /\ball\s+products?\b/.test(text)) {
    return 'action';
  }

  return 'informational';
}

/**
 * OpenAI Chat Completions may return 400 asking for `max_completion_tokens` instead of
 * `max_tokens` — wording varies; we match on substrings, not model id.
 */
export function isOpenAIMaxTokensParameterError(error: unknown): boolean {
  const msg = String((error as Error)?.message || '').toLowerCase();
  return (
    msg.includes('max_tokens') &&
    msg.includes('max_completion_tokens') &&
    (msg.includes('unsupported') || msg.includes('not support'))
  );
}

/**
 * Some OpenAI Chat Completions models only accept the API default temperature; we detect from the
 * 400 message and retry without sending `temperature`.
 */
export function isOpenAITemperatureNotSupportedError(error: unknown): boolean {
  const msg = String((error as Error)?.message || '').toLowerCase();
  return (
    msg.includes('temperature') &&
    (msg.includes('unsupported') || msg.includes('not support')) &&
    (msg.includes('default') || msg.includes('only'))
  );
}

export function isRetryableLLMError(error: any): boolean {
  const status = error?.status || error?.statusCode || error?.code;
  const message = String(error?.message || '').toLowerCase();

  const retryableStatuses = [408, 409, 429, 500, 502, 503, 504];
  const retryableMessages = [
    'timeout',
    'timed out',
    'internal server error',
    'overloaded',
    'rate limit',
  ];

  return (
    retryableStatuses.includes(status) || retryableMessages.some((msg) => message.includes(msg))
  );
}
