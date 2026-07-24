# 第三方依赖许可

OpenOS 本身按根目录 `LICENSE` 中的 MIT 许可证发布。运行时依赖来自 npm，具体版本、完整依赖树和每个包声明的许可证以提交的 `package-lock.json` 为准；构建时不得使用未锁定的依赖版本。

以下清单由当前 `package-lock.json` 中非开发、非 workspace 的顶层安装包生成：

| 包 | 锁定版本 | 声明许可证 |
| --- | --- | --- |
| `@ai-sdk/alibaba` | 2.0.13 | Apache-2.0 |
| `@ai-sdk/anthropic` | 4.0.15 | Apache-2.0 |
| `@ai-sdk/azure` | 4.0.16 | Apache-2.0 |
| `@ai-sdk/cerebras` | 3.0.11 | Apache-2.0 |
| `@ai-sdk/cohere` | 4.0.10 | Apache-2.0 |
| `@ai-sdk/deepinfra` | 3.0.11 | Apache-2.0 |
| `@ai-sdk/deepseek` | 3.0.11 | Apache-2.0 |
| `@ai-sdk/gateway` | 4.0.22 | Apache-2.0 |
| `@ai-sdk/google` | 4.0.17 | Apache-2.0 |
| `@ai-sdk/groq` | 4.0.11 | Apache-2.0 |
| `@ai-sdk/mistral` | 4.0.12 | Apache-2.0 |
| `@ai-sdk/openai` | 4.0.15 | Apache-2.0 |
| `@ai-sdk/openai-compatible` | 3.0.11 | Apache-2.0 |
| `@ai-sdk/perplexity` | 4.0.11 | Apache-2.0 |
| `@ai-sdk/provider` | 4.0.3 | Apache-2.0 |
| `@ai-sdk/provider-utils` | 5.0.10 | Apache-2.0 |
| `@ai-sdk/togetherai` | 3.0.12 | Apache-2.0 |
| `@ai-sdk/xai` | 4.0.15 | Apache-2.0 |
| `@nodable/entities` | 3.0.0 | MIT |
| `@openrouter/ai-sdk-provider` | 3.0.0 | Apache-2.0 |
| `@standard-schema/spec` | 1.1.0 | MIT |
| `@vercel/oidc` | 3.2.0 | Apache-2.0 |
| `@workflow/serde` | 4.1.0 | Apache-2.0 |
| `ai` | 7.0.30 | Apache-2.0 |
| `anynum` | 1.0.1 | MIT |
| `entities` | 6.0.1 | BSD-2-Clause |
| `eventsource-parser` | 3.1.0 | MIT |
| `fast-xml-builder` | 1.3.0 | MIT |
| `fast-xml-parser` | 5.10.1 | MIT |
| `is-unsafe` | 2.0.0 | MIT |
| `json-schema` | 0.4.0 | (AFL-2.1 OR BSD-3-Clause) |
| `parse5` | 7.3.0 | MIT |
| `path-expression-matcher` | 1.6.2 | MIT |
| `react` | 19.2.7 | MIT |
| `react-dom` | 19.2.7 | MIT |
| `scheduler` | 0.27.0 | MIT |
| `strnum` | 2.4.1 | MIT |
| `xml-naming` | 0.3.0 | MIT |
| `zod` | 4.4.3 | MIT |

发布二进制或镜像时，应保留依赖包随附的许可证和版权声明。升级依赖后请检查 `package-lock.json` 的许可证字段，并在发布说明中记录可能影响再分发义务的变更；不能仅依据包名推断许可证。
