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

/**
 * Whether a native-Claude fleet agent should run on the user's claude.ai CLI
 * login (empty auth env → the spawned `claude` falls back to its keychain login)
 * rather than an injected API key.
 *
 * Prefer the login whenever one is actually present on the machine, OR when the
 * user has explicitly opted into login mode. This matters because an injected
 * ANTHROPIC_API_KEY (a) bills the API instead of the subscription and (b) makes
 * Claude Code disable the claude.ai/org connectors — connectors load only under
 * subscription auth. So if a login exists, using it is strictly better.
 */
export function preferClaudeLogin(loginAvailable: boolean, useLoginToggle: boolean): boolean {
  return loginAvailable || useLoginToggle;
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
  // Trim the token — a pasted key with a trailing newline/space is invalid, and
  // `claude -p` HANGS silently on a bad key rather than erroring.
  const key = token.trim();
  const env: Record<string, string> = {};
  if (provider.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = key;
  } else {
    env.ANTHROPIC_API_KEY = key;
  }
  return { env, model: modelOverride ?? provider.defaultModel };
}
