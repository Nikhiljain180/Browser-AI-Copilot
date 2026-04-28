import { CONFIG } from '../core/config.js';
import { agentState, activeLLMController, setActiveLLMController } from '../core/state.js';
import { broadcastUI, updateAgentStatus } from '../core/ui.js';
import { getUsableTab, sendMessageToTab } from '../core/tabs.js';
import { callLLM } from '../llm/llm.js';
import { TokenBudgetManager } from '../../tools/token-budget.js';

const tokenBudgetManager = new TokenBudgetManager(CONFIG.MAX_PAGE_CONTEXT_TOKENS);

function buildPromptPayload(chatHistory, pageContext) {
  const windowedHistory = tokenBudgetManager.createConversationWindow(chatHistory, 10);
  const safeContext = tokenBudgetManager.truncatePageContext(pageContext || {}, CONFIG.MAX_PAGE_CONTEXT_TOKENS);
  return { windowedHistory, safeContext };
}

function normalizeToolName(toolName) {
  return String(toolName || '').trim();
}

function getStructuredRowsFromContext(lastContent, pageContext) {
  if (lastContent?.success && Array.isArray(lastContent.data) && lastContent.data.length > 0) {
    return lastContent.data;
  }

  const table = pageContext?.tables?.[0];
  if (!table?.headers?.length || !table?.rows?.length) {
    return [];
  }

  return table.rows.map(row => {
    const record = {};
    table.headers.forEach((header, index) => {
      const key = String(header || `col_${index}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || `col_${index}`;
      record[key] = row[index] ?? '';
    });
    return record;
  });
}

function formatFallbackAnswer(goal, pageContext, chatHistory) {
  const lastToolMessage = [...chatHistory].reverse().find(message => message.role === 'tool' && message.content);
  const lastContent = lastToolMessage?.content || null;

  if (lastContent?.success && typeof lastContent.summary === 'string' && lastContent.summary.trim()) {
    const summaryText = lastContent.summary.trim();
    if (goal && goal.toLowerCase().includes('bullet')) {
      const items = summaryText
        .split(/[\n.;]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 5);

      if (items.length > 0) {
        return items.map(item => `- ${item}`).join('\n');
      }
    }

    return summaryText;
  }

  if (lastContent?.success && Array.isArray(lastContent.data) && lastContent.data.length > 0) {
    const preview = lastContent.data.slice(0, 5).map(item => {
      if (typeof item === 'string') return item;
      return JSON.stringify(item);
    });
    return preview.map(item => `- ${item}`).join('\n');
  }

  const title = pageContext?.title ? `Page: ${pageContext.title}` : null;
  const text = typeof pageContext?.textContent === 'string'
    ? pageContext.textContent.trim().replace(/\s+/g, ' ').slice(0, 280)
    : '';

  const parts = [title, text].filter(Boolean);
  return parts.join('\n\n') || 'I could not complete the request.';
}

export async function clearAgentSession({ approvalPromises, pendingApprovals } = {}) {
  agentState.chatHistory = [];
  agentState.currentGoal = null;
  agentState.pageContext = null;
  agentState.iterationCount = 0;
  agentState.isRunning = false;

  if (activeLLMController) {
    activeLLMController.abort();
    setActiveLLMController(null);
  }

  if (approvalPromises && pendingApprovals) {
    Object.keys(approvalPromises).forEach((approvalId) => {
      approvalPromises[approvalId](false);
      delete approvalPromises[approvalId];
      delete pendingApprovals[approvalId];
    });
  }

  await agentState.save();
  updateAgentStatus('idle', 'Ready for your next request.', false);

  return {
    success: true,
    chatHistory: [],
    iteration: 0,
    maxIterations: CONFIG.MAX_REACT_ITERATIONS
  };
}

export async function handleStartAgent(goal, { executeToolWithApproval } = {}) {
  try {
    await agentState.load();

    if (agentState.isRunning) {
      throw new Error('Agent is already running');
    }

    agentState.isRunning = true;
    agentState.currentGoal = goal;
    agentState.iterationCount = 0;
    await agentState.save();
    updateAgentStatus('reading', 'Collecting the current page context before starting.', true);

    const tab = await getUsableTab();
    
    // Check if we're on a restricted URL before proceeding
    if (tab?.url && (tab.url.startsWith('chrome://') || 
        tab.url.startsWith('chrome-extension://') || 
        tab.url.startsWith('edge://') || 
        tab.url.startsWith('about:'))) {
      throw new Error('Open the Copilot on a normal web page, then try again.');
    }
    
    const pageContext = await sendMessageToTab(tab.id, {
      action: 'readPage',
      focusArea: null
    });

    agentState.pageContext = pageContext;

    agentState.chatHistory.push({
      role: 'user',
      content: goal,
      timestamp: Date.now()
    });

    const toolsUsed = [];
    let continueLoop = true;
    while (continueLoop && agentState.isRunning && agentState.iterationCount < CONFIG.MAX_REACT_ITERATIONS) {
      agentState.iterationCount++;
      updateAgentStatus('thinking', 'Reasoning about the next step.', true);

      const { windowedHistory, safeContext } = buildPromptPayload(agentState.chatHistory, agentState.pageContext);
      
      // Set up streaming callback for real-time UI updates
      const onChunk = (partialParsed, accumulatedContent) => {
        if (!agentState.isRunning) return;
        
        broadcastUI({
          action: 'updateReasoning',
          thought: partialParsed.thought || 'Thinking...',
          actionName: partialParsed.action || 'Processing...',
          actionInput: partialParsed.action_input || {},
          isStreaming: true
        });
      };
      
      const lmmResponse = await callLLM(goal, safeContext, windowedHistory, onChunk);
      if (!agentState.isRunning) break;

      // Final update with complete response
      broadcastUI({
        action: 'updateReasoning',
        thought: lmmResponse.thought,
        actionName: lmmResponse.action,
        actionInput: lmmResponse.action_input,
        isStreaming: false
      });

      if (lmmResponse.action === 'final_answer') {
        updateAgentStatus('finalizing', 'Wrapping up the final answer.', true);
        agentState.chatHistory.push({
          role: 'assistant',
          content: lmmResponse.answer,
          thought: lmmResponse.thought,
          toolsUsed,
          timestamp: Date.now()
        });
        continueLoop = false;
        break;
      }

      updateAgentStatus('acting', `Running tool: ${lmmResponse.action}.`, true);
      const toolName = normalizeToolName(lmmResponse.action);
      if (toolName) {
        toolsUsed.push(toolName);
      }

      let toolResult = await executeToolWithApproval(
        toolName,
        lmmResponse.action_input,
        tab.id
      );
      if (!agentState.isRunning) break;

      if (toolResult?.error && /user cancelled|cancelled/i.test(String(toolResult.error))) {
        agentState.chatHistory.push({
          role: 'assistant',
          content: 'Action was cancelled. I stopped this run to avoid repeating approval prompts. You can send a new instruction any time.',
          timestamp: Date.now()
        });
        continueLoop = false;
        break;
      }

      if (toolResult?.error) {
        toolResult = await executeToolWithApproval(
          toolName,
          lmmResponse.action_input,
          tab.id
        );
      }

      if (toolResult?.error) {
        agentState.chatHistory.push({
          role: 'assistant',
          content: `I tried "${toolName}" twice but it failed: ${toolResult.error}`,
          timestamp: Date.now()
        });
        continueLoop = false;
        break;
      }

      agentState.chatHistory.push({
        role: 'tool',
        toolName,
        content: toolResult,
        timestamp: Date.now()
      });

      agentState.pageContext = await sendMessageToTab(tab.id, {
        action: 'readPage',
        focusArea: null
      }).catch(() => agentState.pageContext);

      await agentState.save();

      broadcastUI({
        action: 'updateProgress',
        iteration: agentState.iterationCount,
        maxIterations: CONFIG.MAX_REACT_ITERATIONS
      });
    }

    if (agentState.isRunning && agentState.iterationCount >= CONFIG.MAX_REACT_ITERATIONS) {
      const fallbackAnswer = formatFallbackAnswer(goal, agentState.pageContext, agentState.chatHistory);
      agentState.chatHistory.push({
        role: 'assistant',
        content: fallbackAnswer,
        timestamp: Date.now()
      });
    }

    agentState.isRunning = false;
    await agentState.save();
    updateAgentStatus('idle', 'Ready for your next request.', false);

    return {
      success: true,
      chatHistory: agentState.chatHistory
    };
  } catch (error) {
    agentState.isRunning = false;
    await agentState.save();
    
    // Handle extension context invalidated specifically
    if (error.message?.includes('Extension context invalidated') || error.message?.includes('signal is aborted without reason')) {
      updateAgentStatus('idle', 'Extension was reloaded. Please refresh the page and try again.', false);
      return {
        success: false,
        error: 'Extension context invalidated. Please reload the extension and refresh the page.',
        chatHistory: agentState.chatHistory
      };
    }
    
    updateAgentStatus('idle', error.message || 'The agent stopped unexpectedly.', false);
    throw error;
  }
}

