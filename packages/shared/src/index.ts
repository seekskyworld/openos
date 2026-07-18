/** 运行通道：dev 与 stable 隔离 userData / 身份 */
export type OpenosChannel = "dev" | "stable";

/**
 * 内置 LLM 提供商（经 Vercel AI SDK 适配）。
 * 参考 OpenCode BUNDLED_PROVIDERS：官方一键 = 厂商 + 模型 + Key。
 */
export type LlmProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "perplexity"
  | "azure"
  | "alibaba"
  | "deepseek"
  | "moonshot"
  | "zhipu"
  | "siliconflow"
  | "dashscope"
  | "groq"
  | "deepinfra"
  | "cerebras"
  | "togetherai"
  | "fireworks"
  | "openrouter"
  | "openai-compatible";

export type LlmProviderCategory =
  | "official"
  | "china"
  | "gateway"
  | "compatible"
  | "custom";

export type LlmProviderMeta = {
  id: LlmProviderId;
  label: string;
  category: LlmProviderCategory;
  /** 是否支持自定义 baseUrl（兼容端点 / 代理） */
  supportsBaseUrl: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  /** 推荐模型列表（设置页快捷选项） */
  suggestedModels: string[];
  apiKeyHint: string;
  /** 对应环境变量名（可被 env 自动注入） */
  envKeys: string[];
  /**
   * 底层 AI SDK npm 包标识（对齐 OpenCode BUNDLED_PROVIDERS 思路）
   * 运行时由 server 映射到 create* 工厂
   */
  npm: string;
  docsUrl?: string;
  description?: string;
};

/**
 * 官方服务目录：设置页「官方服务」只填 厂商 / 模型 / Key。
 * 参考 OpenCode bundled providers + 常用国内一键接入。
 */
export const LLM_PROVIDERS: LlmProviderMeta[] = [
  // —— 国际官方 ——
  {
    id: "openai",
    label: "OpenAI",
    category: "official",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    suggestedModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini", "o3-mini"],
    apiKeyHint: "sk-…",
    envKeys: ["OPENAI_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/openai",
    docsUrl: "https://platform.openai.com/api-keys",
    description: "官方 OpenAI API",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    category: "official",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-5",
    suggestedModels: [
      "claude-sonnet-4-5",
      "claude-opus-4-5",
      "claude-haiku-4-5",
      "claude-3-5-haiku-latest",
      "claude-3-7-sonnet-latest",
    ],
    apiKeyHint: "sk-ant-…",
    envKeys: ["ANTHROPIC_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/anthropic",
    docsUrl: "https://console.anthropic.com/settings/keys",
    description: "Claude Messages API",
  },
  {
    id: "google",
    label: "Google Gemini",
    category: "official",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    suggestedModels: [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ],
    apiKeyHint: "AIza…",
    envKeys: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/google",
    docsUrl: "https://aistudio.google.com/apikey",
    description: "Google AI Studio / Gemini",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    category: "official",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
    suggestedModels: ["grok-3-mini", "grok-3", "grok-2", "grok-2-vision-1212"],
    apiKeyHint: "xai-…",
    envKeys: ["XAI_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/xai",
    docsUrl: "https://console.x.ai/",
    description: "xAI Grok",
  },
  {
    id: "mistral",
    label: "Mistral",
    category: "official",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    suggestedModels: [
      "mistral-small-latest",
      "mistral-large-latest",
      "mistral-medium-latest",
      "codestral-latest",
      "open-mistral-nemo",
      "pixtral-large-latest",
    ],
    apiKeyHint: "…",
    envKeys: ["MISTRAL_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/mistral",
    docsUrl: "https://console.mistral.ai/",
    description: "Mistral / Codestral",
  },
  {
    id: "cohere",
    label: "Cohere",
    category: "official",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.cohere.com/v2",
    defaultModel: "command-r-plus",
    suggestedModels: ["command-r-plus", "command-r", "command-a-03-2025", "command-r7b-12-2024"],
    apiKeyHint: "…",
    envKeys: ["COHERE_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/cohere",
    docsUrl: "https://dashboard.cohere.com/api-keys",
    description: "Cohere Command",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    category: "official",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.perplexity.ai",
    defaultModel: "sonar",
    suggestedModels: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro"],
    apiKeyHint: "pplx-…",
    envKeys: ["PERPLEXITY_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/perplexity",
    docsUrl: "https://www.perplexity.ai/settings/api",
    description: "Perplexity Sonar 联网检索",
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    category: "official",
    supportsBaseUrl: true,
    defaultBaseUrl: "",
    defaultModel: "gpt-4o-mini",
    suggestedModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "o4-mini"],
    apiKeyHint: "Azure API Key",
    envKeys: ["AZURE_OPENAI_API_KEY", "AZURE_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/azure",
    docsUrl: "https://portal.azure.com/",
    description: "Azure OpenAI；Base URL 用资源端点（可在自定义里改）",
  },
  {
    id: "alibaba",
    label: "Alibaba Cloud (Qwen)",
    category: "official",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    suggestedModels: ["qwen-plus", "qwen-turbo", "qwen-max", "qwen-long", "qwen3-coder-plus"],
    apiKeyHint: "sk-…",
    envKeys: ["ALIBABA_API_KEY", "DASHSCOPE_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/alibaba",
    docsUrl: "https://modelstudio.console.alibabacloud.com/",
    description: "阿里云国际 Model Studio / Qwen",
  },

  // —— 国内一键官方 ——
  {
    id: "deepseek",
    label: "DeepSeek",
    category: "china",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    apiKeyHint: "sk-…",
    envKeys: ["DEEPSEEK_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    docsUrl: "https://platform.deepseek.com/api_keys",
    description: "DeepSeek 官方",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    category: "china",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-auto",
    suggestedModels: [
      "moonshot-v1-auto",
      "moonshot-v1-128k",
      "moonshot-v1-32k",
      "moonshot-v1-8k",
      "kimi-latest",
    ],
    apiKeyHint: "sk-…",
    envKeys: ["MOONSHOT_API_KEY", "KIMI_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
    description: "月之暗面 Kimi",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    category: "china",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    suggestedModels: ["glm-4-flash", "glm-4-plus", "glm-4-air", "glm-4-long", "glm-z1-flash"],
    apiKeyHint: "…",
    envKeys: ["ZHIPU_API_KEY", "BIGMODEL_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    docsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    description: "智谱 BigModel",
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    category: "china",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    suggestedModels: [
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen2.5-72B-Instruct",
      "Qwen/Qwen3-8B",
      "THUDM/glm-4-9b-chat",
    ],
    apiKeyHint: "sk-…",
    envKeys: ["SILICONFLOW_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    docsUrl: "https://cloud.siliconflow.cn/account/ak",
    description: "硅基流动聚合",
  },
  {
    id: "dashscope",
    label: "通义千问 DashScope",
    category: "china",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    suggestedModels: [
      "qwen-plus",
      "qwen-turbo",
      "qwen-max",
      "qwen-long",
      "qwen-coder-plus",
      "qwq-plus",
    ],
    apiKeyHint: "sk-…",
    envKeys: ["DASHSCOPE_API_KEY", "ALIBABA_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    docsUrl: "https://dashscope.console.aliyun.com/apiKey",
    description: "阿里云百炼兼容模式",
  },

  // —— 聚合 / 网关 ——
  {
    id: "openrouter",
    label: "OpenRouter",
    category: "gateway",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    suggestedModels: [
      "openai/gpt-4o-mini",
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat",
      "x-ai/grok-3-mini",
    ],
    apiKeyHint: "sk-or-…",
    envKeys: ["OPENROUTER_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@openrouter/ai-sdk-provider",
    docsUrl: "https://openrouter.ai/keys",
    description: "统一路由多家模型",
  },
  {
    id: "groq",
    label: "Groq",
    category: "gateway",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    suggestedModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "qwen/qwen3-32b",
      "gemma2-9b-it",
    ],
    apiKeyHint: "gsk_…",
    envKeys: ["GROQ_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/groq",
    docsUrl: "https://console.groq.com/keys",
    description: "高速推理",
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    category: "gateway",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.deepinfra.com/v1/openai",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    suggestedModels: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct",
      "meta-llama/Meta-Llama-3.1-8B-Instruct",
      "Qwen/Qwen2.5-72B-Instruct",
      "deepseek-ai/DeepSeek-V3",
    ],
    apiKeyHint: "…",
    envKeys: ["DEEPINFRA_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/deepinfra",
    docsUrl: "https://deepinfra.com/dash/api_keys",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    category: "gateway",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    suggestedModels: ["llama-3.3-70b", "llama3.1-8b", "qwen-3-32b"],
    apiKeyHint: "csk-…",
    envKeys: ["CEREBRAS_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/cerebras",
    docsUrl: "https://cloud.cerebras.ai/",
  },
  {
    id: "togetherai",
    label: "Together AI",
    category: "gateway",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    suggestedModels: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "deepseek-ai/DeepSeek-V3",
    ],
    apiKeyHint: "…",
    envKeys: ["TOGETHER_API_KEY", "TOGETHERAI_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/togetherai",
    docsUrl: "https://api.together.xyz/",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    category: "compatible",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    suggestedModels: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/qwen2p5-72b-instruct",
      "accounts/fireworks/models/deepseek-v3",
    ],
    apiKeyHint: "fw_…",
    envKeys: ["FIREWORKS_API_KEY", "OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    docsUrl: "https://fireworks.ai/account/api-keys",
    description: "Fireworks Inference",
  },

  // —— 自定义入口（设置页「自定义」模式使用）——
  {
    id: "openai-compatible",
    label: "Custom",
    category: "custom",
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    suggestedModels: ["gpt-4o-mini", "deepseek-chat", "qwen-plus", "glm-4", "llama3"],
    apiKeyHint: "任意兼容端点的 Bearer Token",
    envKeys: ["OPENOS_LLM_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    description: "自建 / 代理 / 任意协议端点（见自定义模式）",
  },
];

export function getLlmProviderMeta(id: string): LlmProviderMeta {
  return (
    LLM_PROVIDERS.find((p) => p.id === id) ??
    LLM_PROVIDERS.find((p) => p.id === "openai-compatible")!
  );
}

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === "string" && LLM_PROVIDERS.some((p) => p.id === value);
}

/**
 * 自定义接入协议（对齐 OpenCode protocols 分层）。
 * 官方厂商走 provider 目录；自定义时由 protocol 决定 SDK/请求形态。
 */
export type LlmProtocolId =
  | "openai-compatible"
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages"
  | "google-gemini";

export type LlmAuthStyle = "bearer" | "x-api-key" | "query" | "none";

export type LlmProtocolMeta = {
  id: LlmProtocolId;
  label: string;
  description: string;
  defaultAuthStyle: LlmAuthStyle;
  /** 是否通常需要 baseUrl */
  requiresBaseUrl: boolean;
  defaultBaseUrl: string;
  apiKeyHint: string;
};

export const LLM_PROTOCOLS: LlmProtocolMeta[] = [
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    description: "Chat Completions 兼容（DeepSeek / Ollama / OneAPI / 多数中转）",
    defaultAuthStyle: "bearer",
    requiresBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyHint: "Bearer Token / sk-…",
  },
  {
    id: "openai-chat",
    label: "OpenAI Chat Completions",
    description: "标准 /v1/chat/completions",
    defaultAuthStyle: "bearer",
    requiresBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyHint: "sk-…",
  },
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    description: "OpenAI Responses API（/v1/responses）",
    defaultAuthStyle: "bearer",
    requiresBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyHint: "sk-…",
  },
  {
    id: "anthropic-messages",
    label: "Anthropic Messages",
    description: "Claude Messages API（x-api-key）",
    defaultAuthStyle: "x-api-key",
    requiresBaseUrl: true,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    apiKeyHint: "sk-ant-…",
  },
  {
    id: "google-gemini",
    label: "Google Gemini",
    description: "Google Generative Language API",
    defaultAuthStyle: "query",
    requiresBaseUrl: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyHint: "AIza…",
  },
];

export function getLlmProtocolMeta(id: string): LlmProtocolMeta {
  return (
    LLM_PROTOCOLS.find((p) => p.id === id) ??
    LLM_PROTOCOLS.find((p) => p.id === "openai-compatible")!
  );
}

export function isLlmProtocolId(value: unknown): value is LlmProtocolId {
  return typeof value === "string" && LLM_PROTOCOLS.some((p) => p.id === value);
}

export function isLlmAuthStyle(value: unknown): value is LlmAuthStyle {
  return (
    value === "bearer" ||
    value === "x-api-key" ||
    value === "query" ||
    value === "none"
  );
}

/** 推理强度（对齐 OpenAI reasoningEffort / Anthropic thinking / Google thinkingConfig） */
export type LlmReasoningEffort = "off" | "minimal" | "low" | "medium" | "high";

export const LLM_REASONING_EFFORTS: Array<{
  id: LlmReasoningEffort;
  label: string;
}> = [
  { id: "off", label: "关闭 / 默认" },
  { id: "minimal", label: "最小" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
];

export function isLlmReasoningEffort(value: unknown): value is LlmReasoningEffort {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high"
  );
}

/**
 * 自定义接入预设（对齐 OpenCode openai-compatible profiles，并补充常见中转/本地）。
 * 选择预设会自动填充 protocol / baseUrl / model / authStyle。
 */
export type LlmCompatibleProfile = {
  id: string;
  label: string;
  protocol: LlmProtocolId;
  baseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  authStyle: LlmAuthStyle;
  apiKeyHint?: string;
  description?: string;
  docsUrl?: string;
};

export const LLM_COMPATIBLE_PROFILES: LlmCompatibleProfile[] = [
  {
    id: "custom",
    label: "完全自定义",
    protocol: "openai-compatible",
    baseUrl: "",
    defaultModel: "",
    suggestedModels: [],
    authStyle: "bearer",
    description: "手动填写协议、地址与模型",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    authStyle: "bearer",
    apiKeyHint: "sk-…",
    docsUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    suggestedModels: [
      "openai/gpt-4o-mini",
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat",
    ],
    authStyle: "bearer",
    apiKeyHint: "sk-or-…",
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    id: "groq",
    label: "Groq",
    protocol: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    suggestedModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"],
    authStyle: "bearer",
    apiKeyHint: "gsk_…",
    docsUrl: "https://console.groq.com/keys",
  },
  {
    id: "togetherai",
    label: "Together AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    suggestedModels: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
    ],
    authStyle: "bearer",
    docsUrl: "https://api.together.xyz/",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    protocol: "openai-compatible",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    suggestedModels: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/qwen2p5-72b-instruct",
    ],
    authStyle: "bearer",
    apiKeyHint: "fw_…",
    docsUrl: "https://fireworks.ai/account/api-keys",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    protocol: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    suggestedModels: ["llama-3.3-70b", "llama3.1-8b"],
    authStyle: "bearer",
    apiKeyHint: "csk-…",
    docsUrl: "https://cloud.cerebras.ai/",
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    suggestedModels: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct",
      "Qwen/Qwen2.5-72B-Instruct",
    ],
    authStyle: "bearer",
    docsUrl: "https://deepinfra.com/dash/api_keys",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    protocol: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
    suggestedModels: ["grok-3-mini", "grok-3", "grok-2"],
    authStyle: "bearer",
    apiKeyHint: "xai-…",
    docsUrl: "https://console.x.ai/",
  },
  {
    id: "baseten",
    label: "Baseten",
    protocol: "openai-compatible",
    baseUrl: "https://inference.baseten.co/v1",
    defaultModel: "openai/gpt-oss-120b",
    suggestedModels: ["openai/gpt-oss-120b"],
    authStyle: "bearer",
  },
  {
    id: "ollama",
    label: "Ollama (本地)",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "llama3.2",
    suggestedModels: ["llama3.2", "llama3.1", "qwen2.5", "deepseek-r1", "mistral"],
    authStyle: "none",
    description: "本地 Ollama OpenAI 兼容接口，通常无需 Key",
    docsUrl: "https://ollama.com/",
  },
  {
    id: "lmstudio",
    label: "LM Studio (本地)",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    defaultModel: "local-model",
    suggestedModels: ["local-model"],
    authStyle: "none",
    description: "LM Studio 本地服务器",
  },
  {
    id: "vllm",
    label: "vLLM / 本地 OpenAI Server",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:8000/v1",
    defaultModel: "default",
    suggestedModels: ["default"],
    authStyle: "none",
    description: "vLLM / llama.cpp server / 任意本地 OpenAI 兼容服务",
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    protocol: "openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    suggestedModels: [
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen2.5-72B-Instruct",
    ],
    authStyle: "bearer",
    docsUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    protocol: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-auto",
    suggestedModels: ["moonshot-v1-auto", "moonshot-v1-128k", "moonshot-v1-32k"],
    authStyle: "bearer",
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    suggestedModels: ["glm-4-flash", "glm-4-plus", "glm-4-air"],
    authStyle: "bearer",
    docsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "dashscope",
    label: "通义千问 DashScope",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    suggestedModels: ["qwen-plus", "qwen-turbo", "qwen-max", "qwen-long"],
    authStyle: "bearer",
    docsUrl: "https://dashscope.console.aliyun.com/apiKey",
  },
  {
    id: "volcengine",
    label: "火山方舟 Volcengine",
    protocol: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-pro-32k",
    suggestedModels: ["doubao-pro-32k", "doubao-lite-32k"],
    authStyle: "bearer",
  },
  {
    id: "oneapi",
    label: "OneAPI / NewAPI 中转",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:3000/v1",
    defaultModel: "gpt-4o-mini",
    suggestedModels: ["gpt-4o-mini", "gpt-4o", "claude-sonnet-4", "deepseek-chat"],
    authStyle: "bearer",
    description: "常见 API 中转站，地址按你的部署修改",
  },
  {
    id: "openai-proxy",
    label: "OpenAI 官方 / 代理",
    protocol: "openai-chat",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    suggestedModels: ["gpt-4o-mini", "gpt-4o", "o4-mini"],
    authStyle: "bearer",
    apiKeyHint: "sk-…",
  },
  {
    id: "openai-responses",
    label: "OpenAI Responses 代理",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    suggestedModels: ["gpt-4o-mini", "gpt-4o", "o4-mini"],
    authStyle: "bearer",
    apiKeyHint: "sk-…",
  },
  {
    id: "anthropic-proxy",
    label: "Anthropic / Claude 代理",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-5",
    suggestedModels: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
    authStyle: "x-api-key",
    apiKeyHint: "sk-ant-…",
  },
  {
    id: "gemini-proxy",
    label: "Gemini 代理",
    protocol: "google-gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    authStyle: "query",
    apiKeyHint: "AIza…",
  },
];

export function getLlmCompatibleProfile(id: string): LlmCompatibleProfile {
  return (
    LLM_COMPATIBLE_PROFILES.find((p) => p.id === id) ??
    LLM_COMPATIBLE_PROFILES.find((p) => p.id === "custom")!
  );
}

/** 前端可感知的运行时信息（不含密钥） */
export type BootstrapInfo = {
  appName: string;
  version: string;
  channel: OpenosChannel;
  apiBase: string;
  authMode: "bridge-token" | "open";
  llm: {
    provider: LlmProviderId | string;
    model: string;
    configured: boolean;
    baseUrl?: string;
    protocol?: LlmProtocolId;
    profile?: string;
  };
};

export type HealthResponse = {
  ok: true;
  service: "openos-bridge";
  channel: OpenosChannel;
  uptimeMs: number;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  /** 可选覆盖模型；默认走服务端配置 */
  model?: string;
};

export type ChatResponse = {
  id: string;
  model: string;
  provider: string;
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

/** 设置页读取的 LLM 配置（密钥脱敏） */
export type LlmSettingsPublic = {
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  /** 自定义协议；官方厂商可为空（由 provider 隐含） */
  protocol: LlmProtocolId;
  /** 鉴权方式 */
  authStyle: LlmAuthStyle;
  /** 自定义预设 id */
  profile: string;
  /** 推理强度 */
  reasoningEffort: LlmReasoningEffort;
  /** 是否已配置密钥（不回传明文） */
  hasApiKey: boolean;
  /** 脱敏预览，如 sk-…abcd */
  apiKeyPreview: string;
  /** 来源：用户持久化 / 环境变量 / 默认 */
  source: "persisted" | "env" | "default";
  providers: LlmProviderMeta[];
  protocols: LlmProtocolMeta[];
  profiles: LlmCompatibleProfile[];
  reasoningEfforts: Array<{ id: LlmReasoningEffort; label: string }>;
};

/** 设置页写入的 LLM 配置 */
export type LlmSettingsUpdate = {
  provider: LlmProviderId;
  model: string;
  /** 空字符串表示清空为提供商默认 */
  baseUrl?: string;
  /** 自定义协议 */
  protocol?: LlmProtocolId;
  /** 鉴权方式 */
  authStyle?: LlmAuthStyle;
  /** 自定义预设 */
  profile?: string;
  /** 推理强度 */
  reasoningEffort?: LlmReasoningEffort;
  /**
   * 不传 = 保留原密钥；
   * 空字符串 = 清除持久化密钥（回退 env）；
   * 非空 = 写入新密钥
   */
  apiKey?: string;
};

export type LlmTestRequest = {
  /** 可选临时覆盖；不传则用当前生效配置 */
  provider?: LlmProviderId;
  model?: string;
  baseUrl?: string;
  protocol?: LlmProtocolId;
  authStyle?: LlmAuthStyle;
  profile?: string;
  reasoningEffort?: LlmReasoningEffort;
  apiKey?: string;
  prompt?: string;
};

export type LlmTestResponse = {
  ok: boolean;
  provider: string;
  model: string;
  content?: string;
  latencyMs: number;
  error?: {
    code: string;
    message: string;
  };
};

/** 远程模型发现（按协议路由到各厂商端点） */
export type LlmModelsRequest = {
  provider?: LlmProviderId;
  baseUrl?: string;
  apiKey?: string;
  protocol?: LlmProtocolId;
  authStyle?: LlmAuthStyle;
};

export type LlmRemoteModel = {
  id: string;
  name?: string;
};

export type LlmModelsResponse = {
  ok: boolean;
  provider: string;
  baseUrl: string;
  models: LlmRemoteModel[];
  error?: {
    code: string;
    message: string;
  };
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

/**
 * 提供商授权（对齐 OpenCode Auth + ProviderAuth UI）
 * - api: API Key
 * - oauth: 浏览器授权 / 授权码
 */
export type ProviderAuthType = "api" | "oauth";

export type ProviderAuthMethod = {
  type: ProviderAuthType;
  label: string;
  /** OAuth 时的说明 */
  description?: string;
};

export type ProviderAuthInfoPublic = {
  providerId: string;
  label: string;
  type: ProviderAuthType | "env";
  /** api 脱敏 / oauth 账号信息 */
  preview: string;
  source: "auth" | "env" | "settings";
  expiresAt?: number;
  accountId?: string;
  /** 若该提供商是当前激活的 LLM，带上模型名 */
  activeModel?: string;
};

export type ProviderAuthCatalogItem = {
  providerId: string;
  label: string;
  category: LlmProviderCategory;
  description?: string;
  docsUrl?: string;
  methods: ProviderAuthMethod[];
  /** 推荐模型（Connect 后选择） */
  defaultModel?: string;
  suggestedModels?: string[];
  /** 是否在 Popular 区展示 */
  popular?: boolean;
  connected?: boolean;
  connectedInfo?: ProviderAuthInfoPublic;
};

export type ProviderAuthListResponse = {
  connected: ProviderAuthInfoPublic[];
  catalog: ProviderAuthCatalogItem[];
};

export type ProviderAuthSetRequest = {
  providerId: string;
  type: "api";
  key: string;
  /**
   * 是否在保存凭证后立刻激活为当前 LLM。
   * 默认 false：先连供应商，再由用户选模型后调用 /auth/activate。
   */
  activate?: boolean;
  model?: string;
};

export type ProviderAuthRemoveRequest = {
  providerId: string;
};

/** 已连接供应商上选择模型并激活为当前 LLM */
export type ProviderAuthActivateRequest = {
  providerId: string;
  model: string;
};

export type ProviderOauthAuthorizeRequest = {
  providerId: string;
  /** 方法索引，默认 0 */
  method?: number;
};

export type ProviderOauthAuthorizeResponse = {
  url: string;
  /** auto = 本地回调自动完成；code = 用户粘贴授权码 */
  method: "auto" | "code";
  instructions: string;
  /** code 模式下可展示的用户码（device flow） */
  userCode?: string;
  state: string;
};

export type ProviderOauthCallbackRequest = {
  providerId: string;
  method?: number;
  /** code 模式必填 */
  code?: string;
  state?: string;
};

export type ProviderOauthCallbackResponse = {
  ok: boolean;
  providerId: string;
  type: ProviderAuthType;
  preview: string;
  error?: { code: string; message: string };
};

export const BRIDGE_TOKEN_HEADER = "x-openos-token";
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 47821;
export * from "./gen-apps.js";
export * from "./gen-app-runtime.js";
