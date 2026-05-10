import {
  inferQueryType,
  normalizeMessageContent,
  isRetryableLLMError,
} from '../../src/utils/helpers';

describe('inferQueryType', () => {
  it('should return "action" for click-based goals', () => {
    expect(inferQueryType('click the submit button')).toBe('action');
  });

  it('should return "action" for fill-based goals', () => {
    expect(inferQueryType('fill the form with my name')).toBe('action');
  });

  it('should return "informational" for summary requests', () => {
    expect(inferQueryType('summarize this page')).toBe('informational');
  });

  it('should return "informational" for generic questions', () => {
    expect(inferQueryType('what is this page about?')).toBe('informational');
  });
});

describe('normalizeMessageContent', () => {
  it('should return string as-is', () => {
    expect(normalizeMessageContent('hello')).toBe('hello');
  });

  it('should join arrays with newline', () => {
    expect(normalizeMessageContent(['line1', 'line2'])).toBe('line1\nline2');
  });

  it('should return empty string for null', () => {
    expect(normalizeMessageContent(null)).toBe('');
  });

  it('should stringify objects', () => {
    expect(normalizeMessageContent({ key: 'value' })).toBe('{"key":"value"}');
  });
});

describe('isRetryableLLMError', () => {
  it('should return true for 429 rate limit', () => {
    expect(isRetryableLLMError({ status: 429 })).toBe(true);
  });

  it('should return true for timeout messages', () => {
    expect(isRetryableLLMError({ message: 'Request timed out' })).toBe(true);
  });

  it('should return false for 401 unauthorized', () => {
    expect(isRetryableLLMError({ status: 401 })).toBe(false);
  });

  it('should return false for generic errors', () => {
    expect(isRetryableLLMError({ message: 'Invalid API key' })).toBe(false);
  });
});
