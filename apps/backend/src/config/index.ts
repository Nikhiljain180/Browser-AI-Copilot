import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const config = {
  port: process.env.PROXY_PORT || 3000,
  host: process.env.PROXY_HOST || '127.0.0.1',

  llm: {
    get provider(): string {
      return process.env.LLM_PROVIDER || 'openai';
    },
    get model(): string {
      return process.env.LLM_MODEL || 'gpt-4';
    },
    get timeoutMs(): number {
      return parseInt(process.env.LLM_TIMEOUT_MS || '', 10) || 30000;
    },
  },

  get maxPageContextChars(): number {
    const explicitChars = parseInt(process.env.MAX_PAGE_CONTEXT_CHARS || '', 10);
    if (Number.isFinite(explicitChars) && explicitChars > 0) return explicitChars;

    const tokenBudget = parseInt(process.env.MAX_PAGE_CONTEXT_TOKENS || '', 10);
    if (Number.isFinite(tokenBudget) && tokenBudget > 0) return tokenBudget * 4;

    return 12000;
  },

  apiKeys: {
    get openai(): string | undefined {
      return process.env.OPENAI_API_KEY;
    },
    get anthropic(): string | undefined {
      return process.env.ANTHROPIC_API_KEY;
    },
  },
};

export default config;
