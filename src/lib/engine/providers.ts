/**
 * Model providers (§3.3). Every agent runs through the same Claude Code CLI;
 * the provider just varies the endpoint + auth + model per dispatch. Non-Claude
 * providers (Kimi, DeepSeek) expose Anthropic-compatible endpoints, so they work
 * with `claude -p` by setting ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN.
 *
 * The wedge makes this safe: whatever model writes the code, the engine verifies
 * the output itself — so choosing a cheaper/faster model is low-risk.
 */
export interface Provider {
  id: string;
  name: string;
  /** model string passed to `claude --model` */
  defaultModel: string;
  /** Anthropic-compatible base URL; undefined = native Anthropic */
  baseUrl?: string;
  /** SecretsStore key holding this provider's token/key */
  secretKey: string;
}

export const PROVIDERS: Record<string, Provider> = {
  claude: {
    id: "claude",
    name: "Claude (Anthropic)",
    defaultModel: "claude-sonnet-4-6",
    secretKey: "anthropic_api_key",
  },
  kimi: {
    id: "kimi",
    name: "Kimi (Moonshot)",
    defaultModel: "kimi-k2",
    baseUrl: "https://api.moonshot.ai/anthropic",
    secretKey: "moonshot_api_key",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    defaultModel: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com/anthropic",
    secretKey: "deepseek_api_key",
  },
};

export function getProvider(id: string): Provider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`unknown provider: ${id}`);
  return provider;
}

export interface AgentEnv {
  env: Record<string, string>;
  model: string;
}

/**
 * Compose the per-agent env + model for a provider, given its resolved token.
 * Native Claude uses ANTHROPIC_API_KEY; Anthropic-compatible providers use
 * ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN (NOT _API_KEY). Model is applied via
 * `dispatchStory`'s `--model`, not env, to avoid double-setting.
 */
export function resolveAgentEnv(
  provider: Provider,
  token: string,
  modelOverride?: string
): AgentEnv {
  const env: Record<string, string> = {};
  if (provider.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = token;
  } else {
    env.ANTHROPIC_API_KEY = token;
  }
  return { env, model: modelOverride ?? provider.defaultModel };
}
