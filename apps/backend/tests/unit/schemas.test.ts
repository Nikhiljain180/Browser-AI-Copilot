/**
 * Tests for Zod Validation Schemas
 */

import {
  llmStreamRequestSchema,
  formPlanRequestSchema,
  configUpdateSchema,
  chatMessageSchema,
  pageContextSchema,
} from '../../src/schemas';

describe('llmStreamRequestSchema', () => {
  it('should validate a valid request', () => {
    const validRequest = {
      goal: 'Fill out the contact form',
      pageContext: {
        url: 'https://example.com',
        title: 'Contact Page',
        textContent: 'Contact form here',
      },
      chatHistory: [],
    };

    expect(() => llmStreamRequestSchema.parse(validRequest)).not.toThrow();
  });

  it('should reject empty goal', () => {
    const invalidRequest = {
      goal: '',
    };

    expect(() => llmStreamRequestSchema.parse(invalidRequest)).toThrow();
  });

  it('should reject goal exceeding max length', () => {
    const invalidRequest = {
      goal: 'a'.repeat(10001),
    };

    expect(() => llmStreamRequestSchema.parse(invalidRequest)).toThrow();
  });

  it('should validate optional temperature', () => {
    const request = {
      goal: 'Test',
      temperature: 0.5,
    };

    expect(() => llmStreamRequestSchema.parse(request)).not.toThrow();
  });

  it('should reject temperature out of range', () => {
    const request = {
      goal: 'Test',
      temperature: 3,
    };

    expect(() => llmStreamRequestSchema.parse(request)).toThrow();
  });

  it('should validate chat history', () => {
    const request = {
      goal: 'Test',
      chatHistory: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    };

    expect(() => llmStreamRequestSchema.parse(request)).not.toThrow();
  });

  it('should reject invalid chat history role', () => {
    const request = {
      goal: 'Test',
      chatHistory: [{ role: 'invalid', content: 'test' }],
    };

    expect(() => llmStreamRequestSchema.parse(request)).toThrow();
  });

  it('should reject too many chat messages', () => {
    const request = {
      goal: 'Test',
      chatHistory: Array(101).fill({ role: 'user', content: 'test' }),
    };

    expect(() => llmStreamRequestSchema.parse(request)).toThrow();
  });
});

describe('formPlanRequestSchema', () => {
  it('should validate a valid form plan request', () => {
    const validRequest = {
      goal: 'Enter my name as John Doe',
      forms: [{ fields: [] }],
      chatHistory: [],
    };

    expect(() => formPlanRequestSchema.parse(validRequest)).not.toThrow();
  });

  it('should reject empty goal', () => {
    const invalidRequest = {
      goal: '',
    };

    expect(() => formPlanRequestSchema.parse(invalidRequest)).toThrow();
  });
});

describe('configUpdateSchema', () => {
  it('should validate valid config update', () => {
    const validConfig = {
      provider: 'anthropic',
      model: 'claude-3-sonnet-20240229',
    };

    expect(() => configUpdateSchema.parse(validConfig)).not.toThrow();
  });

  it('should reject invalid provider', () => {
    const invalidConfig = {
      provider: 'invalid',
    };

    expect(() => configUpdateSchema.parse(invalidConfig)).toThrow();
  });

  it('should validate all optional fields', () => {
    const validConfig = {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1000,
    };

    expect(() => configUpdateSchema.parse(validConfig)).not.toThrow();
  });

  it('should reject invalid temperature', () => {
    const invalidConfig = {
      temperature: 5,
    };

    expect(() => configUpdateSchema.parse(invalidConfig)).toThrow();
  });
});

describe('chatMessageSchema', () => {
  it('should validate user message', () => {
    const message = {
      role: 'user' as const,
      content: 'Hello',
    };

    expect(() => chatMessageSchema.parse(message)).not.toThrow();
  });

  it('should validate assistant message with thinking', () => {
    const message = {
      role: 'assistant' as const,
      content: 'Answer',
      thought: 'Reasoning...',
    };

    expect(() => chatMessageSchema.parse(message)).not.toThrow();
  });

  it('should validate tool message', () => {
    const message = {
      role: 'tool' as const,
      content: 'Result',
      toolName: 'fill_input',
    };

    expect(() => chatMessageSchema.parse(message)).not.toThrow();
  });

  it('should accept array content', () => {
    const message = {
      role: 'assistant' as const,
      content: ['line1', 'line2'],
    };

    expect(() => chatMessageSchema.parse(message)).not.toThrow();
  });
});

describe('pageContextSchema', () => {
  it('should validate minimal page context', () => {
    const context = {
      url: 'https://example.com',
    };

    expect(() => pageContextSchema.parse(context)).not.toThrow();
  });

  it('should validate full page context', () => {
    const context = {
      url: 'https://example.com',
      title: 'Example',
      textContent: 'Page content',
      textContentLength: 1000,
      buttons: [{ text: 'Submit', selector: '#submit' }],
      links: [{ text: 'Link', href: 'https://example.com/link' }],
      tables: [{ headers: ['Col1', 'Col2'], rows: [['a', 'b']] }],
    };

    expect(() => pageContextSchema.parse(context)).not.toThrow();
  });

  it('should reject invalid URL', () => {
    const context = {
      url: 'not-a-url',
    };

    expect(() => pageContextSchema.parse(context)).toThrow();
  });
});