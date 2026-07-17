import {
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  type LlmProviderId,
  type OpenosChannel,
} from "@openos/shared";

export type ServerEnv = {
  host: string;
  port: number;
  channel: OpenosChannel;
  bridgeToken: string;
  allowUnauthenticated: boolean;
  dataDir: string;
  llm: {
    provider: LlmProviderId | string;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
};

function normalizeProvider(raw: string | undefined): string {
  const value = raw?.trim() || "openai";
  // 兼容旧 env 默认值
  if (value === "openai-compatible" || value === "openai_compatible") {
    return "openai-compatible";
  }
  return value;
}

export function loadServerEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  const channel = (process.env.OPENOS_CHANNEL === "stable" ? "stable" : "dev") as OpenosChannel;
  const bridgeToken = process.env.OPENOS_BRIDGE_TOKEN?.trim() ?? "";
  const allowFromEnv = process.env.OPENOS_BRIDGE_ALLOW_UNAUTHENTICATED === "1";

  return {
    host: process.env.OPENOS_BRIDGE_HOST?.trim() || DEFAULT_BRIDGE_HOST,
    port: Number(process.env.OPENOS_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT) || DEFAULT_BRIDGE_PORT,
    channel,
    bridgeToken,
    // 开发通道默认可无 token 联调；stable 必须显式 token 或显式放行
    allowUnauthenticated:
      allowFromEnv || (channel === "dev" && !bridgeToken),
    dataDir: process.env.OPENOS_DATA_DIR?.trim() || "",
    llm: {
      provider: normalizeProvider(process.env.OPENOS_LLM_PROVIDER),
      baseUrl: (process.env.OPENOS_LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
        /\/$/,
        "",
      ),
      apiKey: process.env.OPENOS_LLM_API_KEY?.trim() || "",
      model: process.env.OPENOS_LLM_MODEL?.trim() || "gpt-4o-mini",
    },
    ...overrides,
  };
}
