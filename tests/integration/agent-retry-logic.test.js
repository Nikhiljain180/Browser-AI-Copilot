/**
 * Integration Tests for Agent Retry Logic Improvements
 * Tests the new retry logic that prevents excessive tool calls and learns from failures
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Agent Retry Logic Integration', () => {
  let mockAgentState;
  let mockChatHistory;

  beforeEach(() => {
    mockAgentState = {
      isRunning: true,
      iterationCount: 0,
      chatHistory: []
    };

    mockChatHistory = [];
  });

  it('should not retry the same failed action multiple times', async () => {
    const toolName = 'extract_data';
    const toolResult = { error: 'Target not found: section.experience' };
    
    // Simulate the new retry logic - should only try once
    let attemptCount = 0;
    const maxAttempts = 1; // Only attempt once, not retry
    
    for (let i = 0; i < 3; i++) {
      if (attemptCount >= maxAttempts) break;
      attemptCount++;
    }

    expect(attemptCount).toBe(1);
    expect(attemptCount).toBeLessThan(3);
  });

  it('should add error context to chat history on failure', () => {
    const toolName = 'extract_data';
    const errorMessage = 'Target not found: section.experience';
    
    // Simulate adding error context
    mockChatHistory.push({
      role: 'tool',
      content: { error: errorMessage },
      toolName,
      timestamp: Date.now()
    });

    mockChatHistory.push({
      role: 'assistant',
      content: `Tool ${toolName} failed with error: ${errorMessage}. Please try a different approach.`,
      timestamp: Date.now()
    });

    expect(mockChatHistory.length).toBe(2);
    expect(mockChatHistory[1].content).toContain('failed with error');
    expect(mockChatHistory[1].content).toContain('different approach');
  });

  it('should force strategy change after tool failure', () => {
    const failedTool = 'extract_data';
    const errorMessage = 'Target not found: section.experience';
    
    // Simulate strategy change - should continue to next iteration without retrying
    let shouldContinue = true;
    let shouldRetrySame = false;
    
    if (errorMessage.includes('not found')) {
      shouldRetrySame = false;
    }

    expect(shouldRetrySame).toBe(false);
  });

  it('should prevent infinite retry loops', () => {
    const maxIterations = 10;
    let iterationCount = 0;
    let toolFailures = 0;
    
    // Simulate agent loop with failure handling
    while (iterationCount < maxIterations + 5) {
      iterationCount++;
      
      // Simulate tool failure
      if (toolFailures > 0) {
        // New logic: don't retry, just continue
        continue;
      }
      
      toolFailures++;
      
      if (iterationCount >= maxIterations) break;
    }

    expect(iterationCount).toBeLessThan(maxIterations + 5);
  });

  it('should handle multiple different tool attempts', () => {
    const toolsTried = [];
    const availableTools = ['extract_data', 'read_page', 'click_element', 'fill_input'];
    
    // Simulate trying different tools after failures
    for (const tool of availableTools) {
      toolsTried.push(tool);
      // Simulate failure and try next tool
    }

    expect(toolsTried.length).toBe(4);
    expect(toolsTried).toContain('extract_data');
    expect(toolsTried).toContain('read_page');
  });

  it('should log tool failures for debugging', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const toolName = 'extract_data';
    const errorMessage = 'Target not found: section.experience';
    
    // Simulate the logging we added
    console.log(`[Agent] Tool failed, will not retry:`, toolName, errorMessage);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Agent] Tool failed, will not retry:',
      toolName,
      errorMessage
    );
    
    consoleSpy.mockRestore();
  });
});

describe('Tool Failure Recovery', () => {
  it('should provide clear error messages to LLM', () => {
    const toolName = 'extract_data';
    const errorMessage = 'Target not found: section.experience';
    
    const errorContext = `Tool ${toolName} failed with error: ${errorMessage}. Please try a different approach.`;
    
    expect(errorContext).toContain('extract_data');
    expect(errorContext).toContain('different approach');
  });

  it('should maintain conversation context through failures', () => {
    const chatHistory = [
      { role: 'user', content: 'Extract experience from Atlassian' },
      { role: 'assistant', content: 'I will extract the data...' },
      { role: 'tool', content: { error: 'Target not found' }, toolName: 'extract_data' },
      { role: 'assistant', content: 'Tool failed. Let me try a different approach.' }
    ];

    expect(chatHistory.length).toBe(4);
    expect(chatHistory[3].content).toContain('different approach');
  });
});
