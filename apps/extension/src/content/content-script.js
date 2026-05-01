/**
 * Content Script Entry Point
 * 
 * All utilities, tools, and observers are loaded before this file via manifest.json.
 * This file is responsible only for:
 *   1. Listening for messages from the background/popup
 *   2. Dispatching tool execution
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'ping') {
      sendResponse({ ok: true });
    } else if (request.action === 'readPage') {
      const pageData = extractAccessibilityTree(request.focusArea);
      sendResponse(pageData);
    } else if (request.action === 'executeTool') {
      executeTool(request.toolName, request.toolInput).then(sendResponse).catch(err => {
        sendResponse({ error: err.message });
      });
      return true; // keep the message channel open for async sendResponse
    }
  } catch (error) {
    console.error('Content script error:', error);
    sendResponse({ error: error.message });
  }
});

async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case 'read_page':
      return extractAccessibilityTree(toolInput.focus_area);

    case 'click_element':
      return clickElement(toolInput, toolInput.description);

    case 'fill_input':
      return fillInput(toolInput, toolInput.value);

    case 'extract_data':
      return extractData(toolInput.target, toolInput.schema);

    case 'draft_reply':
      return draftReply(toolInput);

    case 'summarize_page':
      return summarizePage(toolInput.max_length);

    case 'reset_form':
      return resetForm(toolInput);  

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}