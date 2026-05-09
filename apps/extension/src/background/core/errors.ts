/* global CopilotSw */

CopilotSw.ErrorCode = {
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_API_ERROR: 'PROVIDER_API_ERROR',
  PROVIDER_UNSUPPORTED: 'PROVIDER_UNSUPPORTED',
  PROVIDER_PARSE_ERROR: 'PROVIDER_PARSE_ERROR',
  PROVIDER_AUTH_ERROR: 'PROVIDER_AUTH_ERROR',

  ACTION_ELEMENT_NOT_FOUND: 'ACTION_ELEMENT_NOT_FOUND',
  ACTION_ELEMENT_NOT_INTERACTABLE: 'ACTION_ELEMENT_NOT_INTERACTABLE',
  ACTION_EXECUTION_FAILED: 'ACTION_EXECUTION_FAILED',
  ACTION_TOOL_FAILED: 'ACTION_TOOL_FAILED',
  ACTION_INVALID_INPUT: 'ACTION_INVALID_INPUT',

  PERCEPTION_PAGE_READ_FAILED: 'PERCEPTION_PAGE_READ_FAILED',
  PERCEPTION_EXTRACTION_FAILED: 'PERCEPTION_EXTRACTION_FAILED',

  PERMISSION_RESTRICTED_URL: 'PERMISSION_RESTRICTED_URL',
  PERMISSION_INJECTION_BLOCKED: 'PERMISSION_INJECTION_BLOCKED',

  APPROVAL_REJECTED: 'APPROVAL_REJECTED',
  APPROVAL_TIMEOUT: 'APPROVAL_TIMEOUT',

  AGENT_ALREADY_RUNNING: 'AGENT_ALREADY_RUNNING',
  AGENT_STOPPED_BY_USER: 'AGENT_STOPPED_BY_USER',
  UNKNOWN: 'UNKNOWN',
};

const ERROR_CATEGORY = {
  PROVIDER_TIMEOUT: 'provider',
  PROVIDER_API_ERROR: 'provider',
  PROVIDER_UNSUPPORTED: 'provider',
  PROVIDER_PARSE_ERROR: 'provider',
  PROVIDER_AUTH_ERROR: 'provider',
  ACTION_ELEMENT_NOT_FOUND: 'action',
  ACTION_ELEMENT_NOT_INTERACTABLE: 'action',
  ACTION_EXECUTION_FAILED: 'action',
  ACTION_TOOL_FAILED: 'action',
  ACTION_INVALID_INPUT: 'action',
  PERCEPTION_PAGE_READ_FAILED: 'perception',
  PERCEPTION_EXTRACTION_FAILED: 'perception',
  PERMISSION_RESTRICTED_URL: 'permission',
  PERMISSION_INJECTION_BLOCKED: 'permission',
  APPROVAL_REJECTED: 'approval',
  APPROVAL_TIMEOUT: 'approval',
  AGENT_ALREADY_RUNNING: 'unknown',
  AGENT_STOPPED_BY_USER: 'unknown',
  UNKNOWN: 'unknown',
};

CopilotSw.AppError = class AppError extends Error {
  code: string;
  retryable: boolean;
  details: Record<string, unknown> | null;
  category: string;

  constructor(message: string, code: string = CopilotSw.ErrorCode.UNKNOWN, retryable: boolean = false, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.category = ERROR_CATEGORY[code] || 'unknown';
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.message,
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      details: this.details,
    };
  }
};

function makeErrorFactory(name, defaultCode, getRetryable) {
  return function createError(message, code = defaultCode, details = null) {
    const retryable = typeof getRetryable === 'function' ? getRetryable(code) : !!getRetryable;
    const err = new CopilotSw.AppError(message, code, retryable, details);
    err.name = name;
    return err;
  };
}

CopilotSw.createProviderError = makeErrorFactory('ProviderError', CopilotSw.ErrorCode.PROVIDER_API_ERROR, (code) =>
  code === CopilotSw.ErrorCode.PROVIDER_TIMEOUT || code === CopilotSw.ErrorCode.PROVIDER_API_ERROR
);

CopilotSw.createActionError = makeErrorFactory('ActionError', CopilotSw.ErrorCode.ACTION_EXECUTION_FAILED, true);

CopilotSw.createPerceptionError = makeErrorFactory('PerceptionError', CopilotSw.ErrorCode.PERCEPTION_PAGE_READ_FAILED, true);

CopilotSw.createPermissionError = makeErrorFactory('PermissionError', CopilotSw.ErrorCode.PERMISSION_RESTRICTED_URL, false);

CopilotSw.createApprovalError = makeErrorFactory('ApprovalError', CopilotSw.ErrorCode.APPROVAL_REJECTED, false);

CopilotSw.normalizeError = function normalizeError(err, defaultCode = CopilotSw.ErrorCode.UNKNOWN) {
  if (err instanceof CopilotSw.AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CopilotSw.AppError(message, defaultCode, false, { original: err });
};
