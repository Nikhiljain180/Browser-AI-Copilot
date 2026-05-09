/**
 * Type definitions for the CopilotSw global namespace
 */

declare global {
  var CopilotSw: CopilotSwNamespace;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system' | 'navigation';
  content: string | string[] | unknown;
  thought?: string;
  toolName?: string;
  timestamp?: number;
  url?: string;
  title?: string;
  toolsUsed?: string[];
  errorCode?: string;
  errorCategory?: string;
}

export interface FormFieldRef {
  agent_id?: string;
  agentId?: string;
  label?: string;
  question?: string;
  selector?: string;
  name?: string;
  type?: string;
  value?: string;
  disabled?: boolean;
  visible?: boolean;
  [key: string]: unknown;
}

export interface FormButton {
  text?: string;
  selector?: string;
  agentId?: string;
  intent?: string;
  type?: string;
  visible?: boolean;
  disabled?: boolean;
}

export interface FormDescriptor {
  id?: string;
  agentId?: string;
  selector?: string;
  title?: string;
  fields: FormFieldRef[];
  buttons?: FormButton[];
  submitButtons?: FormButton[];
  targetButton?: FormButton;
  requiredUnfilledFields?: FormFieldRef[];
  [key: string]: unknown;
}

export type FormData = FormDescriptor;

export interface FormsInventory {
  forms: FormDescriptor[];
  extraFields: FormFieldRef[];
  extraButtons: FormButton[];
}

export interface WorkflowPlan {
  fields: FormFieldRef[];
  missingRequired?: FormFieldRef[];
  submitButtons?: FormButton[];
  targetButton?: FormButton;
  nextAction?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface FormSession {
  active: boolean;
  pendingFields: FormFieldRef[];
  lastAskedField: FormFieldRef | null;
  filledFields: Record<string, string>;
  [key: string]: unknown;
}

export interface AgentState {
  formSession: FormSession;
  isRunning: boolean;
  iterationCount: number;
  pageContext: PageContext | null;
  chatHistory: ChatMessage[];
  currentGoal: string | null;
  url: string | null;
  load: (url?: string | null) => Promise<void>;
  save: () => Promise<void>;
  clear: () => Promise<void>;
  clearAll: () => Promise<void>;
}

export interface PageContext {
  url?: string;
  title?: string;
  textContent?: string;
  [key: string]: unknown;
}

export interface LLMToolResult {
  success?: boolean;
  summary?: string;
  data?: unknown;
  error?: string;
  [key: string]: unknown;
}

export interface LLMResponse {
  thought: string;
  action: string;
  action_input?: Record<string, unknown>;
  answer?: string;
}

export interface AppErrorInstance extends Error {
  name: string;
  code: string;
  category: string;
  retryable: boolean;
  details: Record<string, unknown> | null;
  toJSON(): Record<string, unknown>;
}

export interface Config {
  MAX_REACT_ITERATIONS: number;
  LLM_TIMEOUT_MS: number;
  TOOL_TIMEOUT_MS: number;
  [key: string]: unknown;
}

export interface CopilotSwNamespace {
  // Error taxonomy
  ErrorCode: Record<string, string>;
  AppError: any;
  AppErrorInstance: AppErrorInstance;
  createProviderError: (message: string, code?: string, details?: Record<string, unknown> | null) => AppErrorInstance;
  createActionError: (message: string, code?: string, details?: Record<string, unknown> | null) => AppErrorInstance;
  createPerceptionError: (message: string, code?: string, details?: Record<string, unknown> | null) => AppErrorInstance;
  createPermissionError: (message: string, code?: string, details?: Record<string, unknown> | null) => AppErrorInstance;
  createApprovalError: (message: string, code?: string, details?: Record<string, unknown> | null) => AppErrorInstance;
  normalizeError: (err: unknown, defaultCode?: string) => AppErrorInstance;

  // Core state
  AgentState: typeof AgentState;
  agentState: AgentState;
  CONFIG: Config;
  activeLLMController: AbortController | null;
  approvalPromises: Record<string, (approved: boolean) => void>;
  pendingApprovals: Record<string, unknown>;

  // Agent lifecycle
  handleStartAgent?: (goal: string) => Promise<{ success: boolean; chatHistory: ChatMessage[] }>;
  clearAgentSession?: (url?: string | null) => Promise<{ success: boolean; chatHistory: ChatMessage[]; iteration: number; maxIterations: number }>;

  // Actions from UI
  handleApproveAction?: (actionId?: string) => Promise<{ success: boolean }>;
  handleRejectAction?: (actionId?: string) => Promise<{ success: boolean }>;

  // Core methods
  updateAgentStatus: (status: string, message: string, showLoading: boolean) => void;
  broadcastUI: (data: unknown) => void;
  callLLM: (goal: string, pageContext: PageContext | null, chatHistory: ChatMessage[]) => Promise<LLMResponse>;
  executeToolWithApproval: (toolName: string, toolInput: Record<string, unknown>, tabId: number) => Promise<LLMToolResult>;
  sendMessageToTab: (tabId: number, message: unknown) => Promise<PageContext>;
  clearFormSession: () => void;
  getUsableTab: () => Promise<chrome.tabs.Tab>;
  ensureContentScriptInjected: (tabId: number) => Promise<void>;

  // URL checking
  isRestrictedUrl: (url: string) => boolean;

  // Goal detection
  isStructuredExtractionGoal: (goal: string) => boolean;
  isFormFillGoal: (goal: string) => boolean;
  isFormSubmitGoal: (goal: string) => boolean;
  isFormClearGoal?: (goal: string) => boolean;
  isFormEditGoal?: (goal: string) => boolean;
  tryDirectFormWorkflow: (goal: string, pageContext: PageContext, tabId: number) => Promise<string | null>;

  // Form session
  ensureFormSessionState: () => FormSession;
  setFormSession: (fields?: FormFieldRef[], active?: boolean, meta?: Partial<FormSession>) => FormSession;
  normalizeFieldRef: (item?: Record<string, unknown>) => unknown;
  fieldKey: (field?: unknown) => string;
  buildFieldLookup: (fields?: unknown[]) => unknown;
  buildButtonLookup: (buttons?: unknown[]) => unknown;
  splitUserValues: (goal: string) => string[];

  // Form detection
  detectMultiStepForm?: (pageContext: PageContext) => unknown;
  detectDynamicFields?: (currentFields: unknown[], previousFields?: unknown[]) => unknown;
  isSelectField?: (field: unknown) => boolean;
  formatSelectOptions?: (field: unknown) => unknown;
  isFileUploadField?: (field: unknown) => boolean;
  detectValidationErrors?: (pageContext: PageContext) => unknown;
  detectConfirmationDialog?: (pageContext: PageContext) => unknown;

  // Form buttons
  isLikelySubmitButton: (button: unknown) => boolean;
  resolveSubmitButton?: (pageContext: unknown, workflowPlan?: unknown, session?: unknown) => unknown;

  // Form fields
  findEditField?: (formsInventory: unknown, normalizedGoal: string) => unknown;
  validateFormWorkflowPlan?: (plan: unknown, forms?: unknown[]) => unknown;
  buildFormsInventory?: (pageContext: unknown) => FormDescriptor[];

  // Form API
  requestFormFillPlan?: (goal: string, forms: FormDescriptor[], chatHistory: ChatMessage[]) => Promise<unknown>;

  // Approvals
  waitForApproval?: (approvalId: string, timeoutMs: number) => Promise<boolean>;
  classifyAction?: (toolName: string, toolInput: Record<string, unknown>) => {
    requiresApproval: boolean;
    riskLevel: string;
    actionDescription: string;
  };
  isDestructiveAction?: (toolName: string, toolInput: Record<string, unknown>) => boolean;

  // Tools
  executeTool?: (toolName: string, toolInput: Record<string, unknown>, tabId: number) => Promise<LLMToolResult>;

  // JSON
  parseJsonResponse?: (text: string) => unknown;

  // Intent
  isSubmitIntent?: (goal: string) => boolean;
  isNegativeIntent?: (goal: string) => boolean;
  askForField?: (field: FormFieldRef, session: FormSession) => Promise<string>;
  wasRecentFormFillConversation?: () => boolean;
  isFormValueFollowupGoal?: (goal: string) => boolean;
}