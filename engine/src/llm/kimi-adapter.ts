/**
 * Kimi adapter — OpenAI-compatible API with custom base URL.
 *
 * Kimi (Moonshot AI) uses the OpenAI message format. This adapter uses
 * the `openai` npm package with baseURL pointed at Kimi's API.
 *
 * This same pattern works for ANY OpenAI-compatible provider:
 * Ollama (local), Together, Groq, etc. — just change the baseURL.
 */
import OpenAI from "openai";
import type {
	LLMProvider,
	LLMRequest,
	LLMResponse,
	Message,
	MessageContent,
	ProviderCapabilities,
	ProviderConfig,
} from "./types";

const KIMI_BASE_URL = "https://api.moonshot.cn/v1";

/** Injected dependency for testing */
export interface OpenAICompatibleClient {
	create(args: Record<string, unknown>): Promise<{
		choices: Array<{ message: { content: string | null } }>;
		usage?: { prompt_tokens: number; completion_tokens: number };
	}>;
}

export function createKimiProvider(
	config: ProviderConfig,
	mockClient?: OpenAICompatibleClient,
): LLMProvider {
	const apiKey = config.apiKey ?? process.env.KIMI_API_KEY;
	const client = mockClient ?? createRealClient(apiKey);

	const capabilities: ProviderCapabilities = {
		vision: false,
		structuredOutput: false,
		maxContextTokens: inferMaxTokens(config.model),
	};

	return {
		capabilities,
		async sendMessage(request: LLMRequest): Promise<LLMResponse> {
			const messages = request.messages.map((msg) =>
				translateMessage(msg, request.responseSchema),
			);

			// If responseSchema provided and there's a system message,
			// inject schema instruction into it (Kimi lacks native structured output)
			if (request.responseSchema && messages.length > 0) {
				const systemIdx = messages.findIndex((m) => m.role === "system");
				if (systemIdx >= 0) {
					const existing = messages[systemIdx];
					if (existing) {
						existing.content += `\n\nRespond with JSON matching this schema:\n${JSON.stringify(request.responseSchema, null, 2)}\n\nRespond with valid JSON only.`;
					}
				}
			}

			const args: Record<string, unknown> = {
				model: config.model,
				messages,
				max_tokens: request.maxTokens ?? 4096,
			};

			if (request.temperature !== undefined) {
				args.temperature = request.temperature;
			}

			const result = await client.create(args);

			const content = result.choices[0]?.message?.content ?? "";
			const usage = result.usage ?? {
				prompt_tokens: 0,
				completion_tokens: 0,
			};

			return {
				content,
				usage: {
					inputTokens: usage.prompt_tokens,
					outputTokens: usage.completion_tokens,
				},
			};
		},
	};
}

function translateMessage(
	msg: Message,
	_schema?: Record<string, unknown>,
): { role: string; content: string } {
	// OpenAI format: messages have role + content as string
	const textParts: string[] = [];

	for (const part of msg.content) {
		if (part.type === "text") {
			textParts.push(part.text);
		} else if (part.type === "image") {
			// Kimi is text-only — convert images to placeholder
			textParts.push("[Image]");
		}
	}

	return {
		role: msg.role,
		content: textParts.join("\n"),
	};
}

function createRealClient(apiKey: string | undefined): OpenAICompatibleClient {
	const sdk = new OpenAI({
		apiKey: apiKey ?? "",
		baseURL: KIMI_BASE_URL,
	});

	return {
		async create(args) {
			const raw = (await sdk.chat.completions.create(
				args as unknown as Parameters<typeof sdk.chat.completions.create>[0],
			)) as unknown as {
				choices: Array<{ message: { content: string | null } }>;
				usage?: { prompt_tokens: number; completion_tokens: number };
			};

			return {
				choices: raw.choices.map((c) => ({
					message: { content: c.message.content },
				})),
				usage: raw.usage
					? {
							prompt_tokens: raw.usage.prompt_tokens,
							completion_tokens: raw.usage.completion_tokens ?? 0,
						}
					: undefined,
			};
		},
	};
}

function inferMaxTokens(model: string): number {
	if (model.includes("128k")) return 128_000;
	if (model.includes("32k")) return 32_000;
	if (model.includes("8k")) return 8_000;
	return 128_000; // default for Kimi
}
