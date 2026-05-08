/**
 * Type definitions for the CopilotSw global namespace
 */

declare global {
  var CopilotSw: CopilotSwNamespace;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  thought?: string;
  toolName?: string;
  timestamp: number;
}

export interface FormSession {
  active: boolean;
  pendingFields: string[];
  lastAskedField: string | null;
  filledFields: Record<string, string>;
}

export interface AgentState {
  formSession: FormSession;
  isRunning: boolean;
  iterationCount: number;
  pageContext: PageContext | null;
  chatHistory: ChatMessage[];
  currentGoal: string | null;
  load: () => Promise<void>;
  save: () => Promise<void>;
}

export interface PageContext {
  title?: string;
  textContent?: string;
  tables?: Array<{
    headers: string[];
    rows: string[][];
  }>;
  [key: string]: unknown;
}

export interface LLMToolResult {
  success?: boolean;
  summary?: string;
  data?: unknown[];
  error?: string;
  [key: string]: unknown;
}

export interface LLMResponse {
  thought: string;
  action: string;
  action_input?: Record<string, unknown>;
  answer?: string;
}

export interface Config {
  MAX_REACT_ITERATIONS: number;
  [key: string]: unknown;
}

export interface CopilotSwNamespace {
  agentState: AgentState;
  CONFIG: Config;
  activeLLMController: AbortController | null;
  approvalPromises: Record<string, (approved: boolean) => void>;
  pendingApprovals: Record<string, unknown>;

  // Methods
  updateAgentStatus: (status: string, message: string, showLoading: boolean) => void;
  broadcastUI: (data: unknown) => void;
  callLLM: (goal: string, pageContext: PageContext | null, chatHistory: ChatMessage[]) => Promise<LLMResponse>;
  executeToolWithApproval: (toolName: string, toolInput: Record<string, unknown>, tabId: number) => Promise<LLMToolResult>;
  sendMessageToTab: (tabId: number, message: unknown) => Promise<PageContext>;
  clearFormSession: () => void;
  getUsableTab: () => Promise<chrome.tabs.Tab>;
  ensureContentScriptInjected: (tabId: number) => Promise<void>;
  isStructuredExtractionGoal: (goal: string) => boolean;
  isFormFillGoal: (goal: string) => boolean;
  isFormSubmitGoal: (goal: string) => boolean;
  isFormClearGoal?: (goal: string) => boolean;
  tryDirectFormWorkflow: (goal: string, pageContext: PageContext, tabId: number) => Promise<string | null>;

  // Assigned dynamically
  clearAgentSession?: () => Promise<{
    success: boolean;
    chatHistory: ChatMessage[];
    iteration: number;
    maxIterations: number;
  }>;
  handleStartAgent?: (goal: string) => Promise<{
    success: boolean;
    chatHistory: ChatMessage[];
  }>;
}

export {};