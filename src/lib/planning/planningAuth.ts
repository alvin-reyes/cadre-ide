import { getProvider } from "../engine/providers";

export interface PlanningAuth {
  apiKey: string;
  baseUrl?: string;
  ready: boolean;
  reason?: string;
}

export async function resolvePlanningAuth(
  providerId: string,
  useLogin: boolean,
  getSecret: (k: string) => Promise<string | null>,
): Promise<PlanningAuth> {
  const provider = getProvider(providerId);
  const apiKey = (await getSecret(provider.secretKey))?.trim() ?? "";
  if (apiKey) return { apiKey, baseUrl: provider.baseUrl, ready: true };
  if (providerId === "claude" && useLogin) {
    return {
      apiKey: "",
      ready: false,
      reason:
        "Claude login powers dispatch, but planning still needs a key — add an Anthropic key (or wait for CLI planning).",
    };
  }
  return {
    apiKey: "",
    baseUrl: provider.baseUrl,
    ready: false,
    reason: `Add a ${provider.name} API key to enable planning.`,
  };
}
