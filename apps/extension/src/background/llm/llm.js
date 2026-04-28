import { CONFIG } from '../core/config.js';
import { agentState, activeLLMController, setActiveLLMController } from '../core/state.js';

function parseStructuredResponse(content) {
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = String(content || '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}

function parsePartialJSON(text) {
  // Lightweight partial JSON parser for streaming responses
  // Attempts to extract thought, action, and action_input from incomplete JSON
  const result = {};
  
  // Extract thought
  const thoughtMatch = text.match(/"thought"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (thoughtMatch) {
    result.thought = thoughtMatch[1].replace(/\\"/g, '"');
  }
  
  // Extract action
  const actionMatch = text.match(/"action"\s*:\s*"([^"]+)"/);
  if (actionMatch) {
    result.action = actionMatch[1];
  }
  
  // Extract action_input (simplified)
  const actionInputMatch = text.match(/"action_input"\s*:\s*(\{[\s\S]*?\})/);
  if (actionInputMatch) {
    try {
      result.action_input = JSON.parse(actionInputMatch[1]);
    } catch {
      result.action_input = {};
    }
  }
  
  // Extract answer (for final_answer)
  const answerMatch = text.match(/"answer"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (answerMatch) {
    result.answer = answerMatch[1].replace(/\\"/g, '"');
  }
  
  return result;
}

export async function callLLM(goal, pageContext, chatHistory, onChunk = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.LLM_TIMEOUT_MS);
  setActiveLLMController(controller);

  try {
    const response = await fetch(`${CONFIG.BACKEND_URL}/api/llm/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal,
        pageContext,
        chatHistory
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      let errorMessage = `LLM API error: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        // ignore
      }
      throw new Error(errorMessage);
    }

    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      let currentEvent = '';
      
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (currentEvent === 'error') {
              throw new Error(data.error);
            }
            
            if (currentEvent === 'chunk' && data.content) {
              accumulatedContent += data.content;
              
              // Call onChunk callback with partial parsing
              if (onChunk && typeof onChunk === 'function') {
                const partialParsed = parsePartialJSON(accumulatedContent);
                onChunk(partialParsed, accumulatedContent);
              }
            } else if (currentEvent === 'complete') {
              accumulatedContent = data.content || accumulatedContent;
            }
          } catch (parseError) {
            console.warn('[LLM Stream Parse Error]', parseError.message);
          }
        }
      }
    }

    // Final parsing of complete response
    let parsed = parseStructuredResponse(accumulatedContent);

    if (!parsed) {
      // Fallback to retry endpoint if streaming failed to parse
      const retryResponse = await fetch(`${CONFIG.BACKEND_URL}/api/llm/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, pageContext, chatHistory }),
        signal: controller.signal
      });
      const retryData = await retryResponse.json();
      parsed = parseStructuredResponse(retryData.content);
    }

    if (!parsed) {
      throw new Error('I got an unexpected model response. Please try again.');
    }

    return parsed;
  } catch (error) {
    if (error.name === 'AbortError' && !agentState.isRunning) {
      throw new Error('Agent stopped by user');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (activeLLMController === controller) {
      setActiveLLMController(null);
    }
  }
}
