/**
 * Content Script Entry Point
 * 
 * All utilities, tools, and observers are loaded before this file via manifest.json.
 * This file is responsible only for:
 *   1. Listening for messages from the background/popup
 *   2. Dispatching tool execution
 *   3. Input validation & error handling
 */

// ═══════════════════════════════════════════════════
// MESSAGE LISTENER
// ═══════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request)
    .then(sendResponse)
    .catch(err => {
      console.error('[Copilot] Message handling error:', err);
      sendResponse({ 
        error: err.message,
        stack: err.stack?.substring(0, 200) 
      });
    });

  // Always return true to keep channel open for async responses
  return true;
});


async function handleMessage(request) {
  console.log('[Copilot] Received action:', request.action, request.toolName || '');

  switch (request.action) {
    case 'ping':
      return { 
        ok: true, 
        ready: true,
        url: window.location.href,
        timestamp: Date.now() 
      };

    case 'readPage':
      return extractAccessibilityTree(request.focusArea);

    case 'executeTool':
      return executeTool(request.toolName, request.toolInput || {});

    default:
      throw new Error(`Unknown action: ${request.action}`);
  }
}


// ═══════════════════════════════════════════════════
// TOOL EXECUTOR
// ═══════════════════════════════════════════════════

async function executeTool(toolName, toolInput) {
  const startTime = performance.now();

  // Validate tool exists
  if (!TOOL_REGISTRY[toolName]) {
    throw new Error(`Unknown tool: "${toolName}". Available tools: ${Object.keys(TOOL_REGISTRY).join(', ')}`);
  }

  const tool = TOOL_REGISTRY[toolName];

  // Validate required params
  const validationError = validateToolInput(tool, toolInput);
  if (validationError) {
    return { error: validationError };
  }

  try {
    // Execute the tool (await handles both sync and async)
    const result = await tool.execute(toolInput);

    // Add execution metadata
    const duration = Math.round(performance.now() - startTime);

    // Log for debugging
    console.log(`[Copilot] ✓ ${toolName} (${duration}ms)`, result?.success ? '' : result);

    return {
      ...result,
      _meta: {
        tool: toolName,
        duration: `${duration}ms`,
        timestamp: Date.now()
      }
    };

  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    console.error(`[Copilot] ✗ ${toolName} (${duration}ms)`, error);

    return {
      error: error.message,
      tool: toolName,
      _meta: {
        tool: toolName,
        duration: `${duration}ms`,
        timestamp: Date.now()
      }
    };
  }
}


// ═══════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════

const TOOL_REGISTRY = {

  // ── Page Reading ──
  read_page: {
    description: 'Extract accessibility tree of the page',
    params: { required: [], optional: ['focus_area'] },
    execute: (input) => extractAccessibilityTree(input.focus_area || null)
  },

  summarize_page: {
    description: 'Get structured summary of the page',
    params: { required: [], optional: ['maxLength', 'focusArea', 'includeData', 'includeForms'] },
    execute: (input) => summarizePage(input)
  },

  // ── Data Extraction ──
  extract_data: {
    description: 'Extract structured data from a target element',
    params: { required: [], optional: ['target', 'schema'] },
    execute: (input) => extractData(input.target || null, input.schema || null)
  },

  extract_page_data: {
    description: 'Extract all structured data from the entire page',
    params: { required: [], optional: [] },
    execute: () => extractPageData()
  },

  extract_reply_context: {
    description: 'Extract conversation context around a reply field',
    params: { required: [], optional: ['selector'] },
    execute: (input) => extractReplyContext(input.selector || null)
  },

  // ── Interactions ──
  click_element: {
    description: 'Click an element on the page',
    params: { required: ['selector'], optional: ['description', 'clickType', 'hoverFirst', 'force'] },
    execute: (input) => {
      const target = {
        selector: input.selector,
        agentId: input.agentId || input.agent_id
      };
      const options = {
        description: input.description,
        clickType: input.clickType || input.click_type || 'single',
        hoverFirst: input.hoverFirst || input.hover_first || false,
        force: input.force || false,
        waitForScroll: input.waitForScroll !== false
      };
      return clickElement(target, options);
    }
  },

  fill_input: {
    description: 'Fill a form field with a value',
    params: { required: ['value'], optional: ['selector', 'agentId'] },
    execute: (input) => {
      const target = {
        selector: input.selector,
        agentId: input.agentId || input.agent_id
      };
      return fillInput(target, input.value);
    }
  },

  // ── Drafting ──
  draft_reply: {
    description: 'Draft a reply in a text field',
    params: { required: [], optional: ['selector', 'draft', 'context', 'tone', 'mode', 'format', 'signature'] },
    execute: (input) => draftReply(input)
  },

  // ── Form Management ──
  reset_form: {
    description: 'Reset/clear a form',
    params: { required: [], optional: ['selector', 'mode', 'fields', 'clearValidation', 'clearVisualState'] },
    execute: (input) => resetForm(input)
  },

  undo_form_reset: {
    description: 'Undo the last form reset',
    params: { required: [], optional: [] },
    execute: () => undoFormReset()
  },

  // ── Utility ──
  scroll_to: {
    description: 'Scroll to an element or position',
    params: { required: ['target'], optional: ['behavior'] },
    execute: (input) => scrollToElement(input)
  },

  wait: {
    description: 'Wait for a specified duration',
    params: { required: ['ms'], optional: [] },
    execute: (input) => new Promise(resolve => {
      const ms = Math.min(parseInt(input.ms) || 1000, 10000); // max 10s
      setTimeout(() => resolve({ 
        success: true, 
        message: `✓ Waited ${ms}ms` 
      }), ms);
    })
  },

  get_element_info: {
    description: 'Get detailed info about a specific element',
    params: { required: ['selector'], optional: [] },
    execute: (input) => getElementInfo(input)
  }
};


// ═══════════════════════════════════════════════════
// INPUT VALIDATION
// ═══════════════════════════════════════════════════

function validateToolInput(tool, input) {
  if (!tool.params) return null;

  // Check required params
  for (const param of tool.params.required) {
    // Check both camelCase and snake_case versions
    const camelCase = param;
    const snakeCase = param.replace(/([A-Z])/g, '_$1').toLowerCase();

    if (input[camelCase] === undefined && input[snakeCase] === undefined) {
      return `Missing required parameter: "${param}" for tool "${tool.description}"`;
    }
  }

  return null;
}


// ═══════════════════════════════════════════════════
// ADDITIONAL UTILITY TOOLS
// ═══════════════════════════════════════════════════

/**
 * Scroll to an element or position
 */
function scrollToElement(input) {
  try {
    if (input.target === 'top') {
      window.scrollTo({ top: 0, behavior: input.behavior || 'smooth' });
      return { success: true, message: '✓ Scrolled to top' };
    }

    if (input.target === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: input.behavior || 'smooth' });
      return { success: true, message: '✓ Scrolled to bottom' };
    }

    const element = document.querySelector(input.target) || 
                    resolveElement({ selector: input.target, agentId: input.agentId });

    if (!element) {
      return { error: `Element not found: ${input.target}` };
    }

    element.scrollIntoView({ 
      behavior: input.behavior || 'smooth', 
      block: 'center' 
    });

    return { 
      success: true, 
      message: `✓ Scrolled to: ${input.target}` 
    };

  } catch (error) {
    return { error: error.message };
  }
}


/**
 * Get detailed info about a specific element
 */
function getElementInfo(input) {
  try {
    const element = document.querySelector(input.selector) ||
                    resolveElement({ selector: input.selector, agentId: input.agentId });

    if (!element) {
      return { error: `Element not found: ${input.selector}` };
    }

    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);

    return {
      success: true,
      info: {
        tag: element.tagName.toLowerCase(),
        type: element.type || undefined,
        id: element.id || undefined,
        classes: element.className || undefined,
        text: sanitizeText(element.innerText).substring(0, 200),
        value: element.value || undefined,
        visible: isElementVisible(element),
        disabled: isDisabled(element),
        position: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          inViewport: isElementInViewport(element)
        },
        aria: {
          label: element.getAttribute('aria-label') || undefined,
          role: element.getAttribute('role') || undefined,
          expanded: element.getAttribute('aria-expanded') || undefined
        },
        data: element.dataset && Object.keys(element.dataset).length > 0
          ? { ...element.dataset }
          : undefined,
        children: element.children.length,
        parentSection: getParentSectionTitle(element) || undefined
      }
    };

  } catch (error) {
    return { error: error.message };
  }
}