import config from '../config';
import { ProviderError, ErrorCode } from '../utils/errors';

let llmClient: any = null;

function getProviderApiKey(provider: string = config.llm.provider): string | undefined {
  if (provider === 'openai') return config.apiKeys.openai;
  if (provider === 'anthropic') return config.apiKeys.anthropic;
  return undefined;
}

export function initializeLLM(provider: string = config.llm.provider): void {
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    throw new ProviderError(`Missing API key for provider: ${provider}`, ErrorCode.PROVIDER_AUTH_ERROR, { provider });
  }

  if (provider === 'openai') {
    const { OpenAI } = require('openai');
    llmClient = new OpenAI({ apiKey });
  } else if (provider === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk').default;
    llmClient = new Anthropic({ apiKey });
  } else {
    throw new ProviderError(`Unsupported LLM provider: ${provider}`, ErrorCode.PROVIDER_UNSUPPORTED, { provider });
  }
}

export function getClient(): any {
  if (!llmClient) {
    initializeLLM();
  }
  return llmClient;
}