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
    /**
     * Not limited to OpenAI.com: same SDK/key slot for any OpenAI-compatible API (OpenCode Zen, OpenRouter, etc.).
     * Use OPENAI_API_KEY or OPENCODE_API_KEY (Zen key from opencode.ai/zen).
     */
    get openai(): string | undefined {
      const direct = process.env.OPENAI_API_KEY?.trim();
      const zen = process.env.OPENCODE_API_KEY?.trim();
      return direct || zen || undefined;
    },
    /** OpenAI-compatible chat Completions API (omit for api.openai.com). Used by OpenRouter, OpenCode Zen, local proxies, etc. */
    get openaiBaseURL(): string | undefined {
      const raw = process.env.OPENAI_BASE_URL?.trim();
      if (!raw) return undefined;
      return raw.replace(/\/?$/, '');
    },
    get anthropic(): string | undefined {
      return process.env.ANTHROPIC_API_KEY;
    },
  },
};

export default config;
