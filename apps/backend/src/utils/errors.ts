export const ErrorCode = {
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_API_ERROR: 'PROVIDER_API_ERROR',
  PROVIDER_UNSUPPORTED: 'PROVIDER_UNSUPPORTED',
  PROVIDER_PARSE_ERROR: 'PROVIDER_PARSE_ERROR',
  PROVIDER_AUTH_ERROR: 'PROVIDER_AUTH_ERROR',

  ACTION_ELEMENT_NOT_FOUND: 'ACTION_ELEMENT_NOT_FOUND',
  ACTION_EXECUTION_FAILED: 'ACTION_EXECUTION_FAILED',

  PERCEPTION_PAGE_READ_FAILED: 'PERCEPTION_PAGE_READ_FAILED',

  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

export type ErrorCategory = 'provider' | 'action' | 'perception' | 'permission' | 'approval' | 'validation' | 'unknown';

const ERROR_CATEGORY_MAP: Record<string, ErrorCategory> = {
  PROVIDER_TIMEOUT: 'provider',
  PROVIDER_API_ERROR: 'provider',
  PROVIDER_UNSUPPORTED: 'provider',
  PROVIDER_PARSE_ERROR: 'provider',
  PROVIDER_AUTH_ERROR: 'provider',
  ACTION_ELEMENT_NOT_FOUND: 'action',
  ACTION_EXECUTION_FAILED: 'action',
  PERCEPTION_PAGE_READ_FAILED: 'perception',
  RATE_LIMITED: 'validation',
  VALIDATION_ERROR: 'validation',
  UNKNOWN: 'unknown',
};

export class AppError extends Error {
  public readonly category: ErrorCategory;

  constructor(
    message: string,
    public readonly code: ErrorCodeType = ErrorCode.UNKNOWN,
    public readonly retryable: boolean = false,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    this.category = ERROR_CATEGORY_MAP[code] || 'unknown';
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      category: this.category,
      retryable: this.retryable,
    };
  }
}

export class ProviderError extends AppError {
  constructor(message: string, code: ErrorCodeType = ErrorCode.PROVIDER_API_ERROR, details?: Record<string, unknown>) {
    const retryable = code === ErrorCode.PROVIDER_TIMEOUT || code === ErrorCode.PROVIDER_API_ERROR;
    const statusCode = code === ErrorCode.PROVIDER_AUTH_ERROR ? 401 : 502;
    super(message, code, retryable, statusCode, details);
    this.name = 'ProviderError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code: ErrorCodeType = ErrorCode.VALIDATION_ERROR, details?: Record<string, unknown>) {
    super(message, code, false, 400, details);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, ErrorCode.RATE_LIMITED, false, 429);
    this.name = 'RateLimitError';
  }
}
