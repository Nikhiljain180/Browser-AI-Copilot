export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const REACT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_page',
      description: 'Read the current page content and structure including sections, tables, links, and buttons',
      parameters: {
        type: 'object',
        properties: {
          focusArea: {
            type: 'string',
            description: 'Optional CSS selector or area description to focus reading on',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_element',
      description: 'Click on an element in the page identified by a CSS selector',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the element to click',
          },
          description: {
            type: 'string',
            description: 'Human-readable description of what is being clicked',
          },
        },
        required: ['selector'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_input',
      description: 'Fill a value into an input field identified by a CSS selector',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the input field',
          },
          value: {
            type: 'string',
            description: 'The value to fill into the field',
          },
          description: {
            type: 'string',
            description: 'Human-readable description of what is being filled',
          },
        },
        required: ['selector', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_data',
      description: 'Extract structured data from the page (products, leads, rows, table data)',
      parameters: {
        type: 'object',
        properties: {
          extractionType: {
            type: 'string',
            enum: ['table', 'list', 'cards', 'structured'],
            description: 'Type of data structure to extract',
          },
        },
        required: ['extractionType'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_reply',
      description: 'Draft and insert a reply into a text input field or editor',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the reply field or editor',
          },
          draft: {
            type: 'string',
            description: 'The draft content to insert',
          },
        },
        required: ['selector', 'draft'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_page',
      description: 'Summarize the current page content into concise bullet points',
      parameters: {
        type: 'object',
        properties: {
          maxBullets: {
            type: 'number',
            description: 'Maximum number of bullet points',
            default: 5,
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reset_form',
      description: 'Reset form fields to their initial state',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the form or fields to reset',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'final_answer',
      description: 'Provide the final answer to the user. Call this when the task is complete or you have enough information to answer',
      parameters: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            description: 'The final answer text. Use bullet points for multi-item answers.',
          },
          thought: {
            type: 'string',
            description: 'Brief reasoning about the final answer',
          },
        },
        required: ['answer'],
        additionalProperties: false,
      },
    },
  },
];

export function getToolsForProvider(provider: string): ToolDefinition[] {
  return REACT_TOOLS;
}
