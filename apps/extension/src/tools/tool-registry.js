/**
 * Tool Registry
 * All available tools for the agent — defines what the LLM can call
 */

const TOOL_REGISTRY = {
  READ_PAGE: {
    name: 'read_page',
    description: 'Extracts an accessible, structured map of the current page',
    parameters: {
      focus_area: 'optional CSS selector to scope extraction',
    },
  },
  CLICK_ELEMENT: {
    name: 'click_element',
    description: 'Clicks a target element using stable selectors',
    requiresApproval: true,
    parameters: {
      selector: 'CSS selector for the element',
      description: 'What the click does (e.g., "Submit form", "Click buy button")',
    },
  },
  FILL_INPUT: {
    name: 'fill_input',
    description: 'Fills form fields with framework-compatible synthetic events',
    requiresApproval: false,
    parameters: {
      selector: 'CSS selector for the input',
      value: 'Value to fill',
    },
  },
  EXTRACT_DATA: {
    name: 'extract_data',
    description: 'Extracts structured data as JSON (e.g., from tables, lists)',
    requiresApproval: false,
    parameters: {
      target: 'CSS selector for container',
      schema: 'optional schema object',
    },
  },
  DRAFT_REPLY: {
    name: 'draft_reply',
    description: 'Generates a reply and auto-fills it into text fields',
    requiresApproval: false,
    parameters: {
      selector: 'CSS selector for text field',
      context: 'Context for generating the reply',
      tone: 'optional tone (professional, casual, formal)',
    },
  },
  SUMMARIZE_PAGE: {
    name: 'summarize_page',
    description: 'Summarizes the current page content',
    requiresApproval: false,
    parameters: {
      max_length: 'optional max length for summary',
    },
  },
  REQUEST_APPROVAL: {
    name: 'request_approval',
    description: 'Pauses execution and requests user approval via modal',
    requiresApproval: false,
    parameters: {
      action_description: 'What action needs approval',
      risk_level: 'medium or high',
    },
  },
  FINAL_ANSWER: {
    name: 'final_answer',
    description: 'Return final answer to user - ends the ReAct loop',
    requiresApproval: false,
    parameters: {
      answer: 'The final response to the user',
    },
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TOOL_REGISTRY;
}
