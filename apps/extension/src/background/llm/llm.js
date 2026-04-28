/* global CopilotSw */

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

CopilotSw.callLLM = async function callLLM(goal, pageContext, chatHistory) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CopilotSw.CONFIG.LLM_TIMEOUT_MS);
  CopilotSw.activeLLMController = controller;

  try {
    const response = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}/api/llm/stream`, {
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

    const data = await response.json();
    let parsed = parseStructuredResponse(data.content);

    if (!parsed) {
      const retryResponse = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}/api/llm/retry`, {
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
    if (error.name === 'AbortError' && !CopilotSw.agentState.isRunning) {
      throw new Error('Agent stopped by user');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (CopilotSw.activeLLMController === controller) {
      CopilotSw.activeLLMController = null;
    }
  }
};

