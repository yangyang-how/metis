/**
 * Kimi adapter — Anthropic Messages-compatible API.
 *
 * As of 2026, Kimi Code's endpoint migrated from OpenAI-compatible
 * /chat/completions to Anthropic Messages-compatible /v1/messages.
 * This adapter uses the Anthropic SDK with base_url pointed at Kimi.
 *
 * Key differences from direct Anthropic:
 * - base_url: https://api.kimi.com/coding
 * - API key: MOONSHOT_API_KEY (not ANTHROPIC_API_KEY)
 * - Model: kimi-for-coding (the only model served)
 * - Temperature: 0.0-1.0 only (>1.0 returns 400)
 * - User-Agent whitelist: claude-code/0.1.0
 * - supports_reasoning: true (K2.6 is a reasoning model)
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
	LLMProvider,
	LLMRequest,
	LLMResponse,
	MessageContent,
	ProviderCapabilities,
	ProviderConfig,
} from "./types";

const KIMI_BASE_URL = "https://api.kimi.com/coding";

const KIMI_HEADERS = {
	"User-Agent": "claude-code/0.1.0",
};

/** Injected dependency for testing */
export interface KimiClient {
	create(args: Record<string, unknown>): Promise<{
		content: Array<{ type: string; text?: string }>;
		usage: { input_tokens: number; output_tokens: number };
	}>;
}

export function createKimiProvider(
	config: ProviderConfig,
	mockClient?: KimiClient,
): LLMProvider {
	const apiKey =
		config.apiKey ?? process.env.MOONSHOT_API_KEY ?? process.env.KIMI_API_KEY;
	const client = mockClient ?? createRealClient(apiKey);

	const capabilities: ProviderCapabilities = {
		vision: false,
		structuredOutput: true,
		maxContextTokens: 262_144,
	};

	return {
		capabilities,
		async sendMessage(request: LLMRequest): Promise<LLMResponse> {
			// Extract system message (Anthropic format: top-level param)
			const systemMessages = request.messages.filter(
				(m) => m.role === "system",
			);
			const nonSystemMessages = request.messages.filter(
				(m) => m.role !== "system",
			);

			let systemText = systemMessages
				.flatMap((m) =>
					m.content
						.filter(
							(c): c is Extract<MessageContent, { type: "text" }> =>
								c.type === "text",
						)
						.map((c) => c.text),
				)
				.join("\n\n");

			// Inject schema instruction into system prompt
			if (request.responseSchema) {
				systemText += `\n\nRespond with JSON matching this schema:\n${JSON.stringify(request.responseSchema, null, 2)}\n\nRespond with valid JSON only. No markdown code fences.`;
			}

			// Translate messages to Anthropic format
			const messages = nonSystemMessages.map((msg) => ({
				role: msg.role as "user" | "assistant",
				content: msg.content.map(translateContent),
			}));

			const args: Record<string, unknown> = {
				model: config.model || "kimi-for-coding",
				messages,
				max_tokens: request.maxTokens ?? 16384,
			};

			if (systemText) {
				args.system = systemText;
			}

			if (request.temperature !== undefined) {
				// Kimi requires temperature 0.0-1.0
				args.temperature = Math.min(1.0, Math.max(0, request.temperature));
			}

			const result = await client.create(args);

			// Extract text content from response
			const content = result.content
				.filter((block) => block.type === "text" && block.text)
				.map((block) => block.text ?? "")
				.join("");

			return {
				content,
				usage: {
					inputTokens: result.usage.input_tokens,
					outputTokens: result.usage.output_tokens,
				},
			};
		},
	};
}

function translateContent(content: MessageContent): Record<string, unknown> {
	if (content.type === "text") {
		return { type: "text", text: content.text };
	}
	// Kimi doesn't support images — convert to text placeholder
	return { type: "text", text: "[Image]" };
}

function createRealClient(apiKey: string | undefined): KimiClient {
	const sdk = new Anthropic({
		apiKey: apiKey ?? "",
		baseURL: KIMI_BASE_URL,
		defaultHeaders: KIMI_HEADERS,
	});

	return {
		async create(args) {
			const result = (await sdk.messages.create(
				args as unknown as Parameters<typeof sdk.messages.create>[0],
			)) as unknown as {
				content: Array<{ type: string; text?: string }>;
				usage: { input_tokens: number; output_tokens: number };
			};
			return {
				content: result.content,
				usage: {
					input_tokens: result.usage.input_tokens,
					output_tokens: result.usage.output_tokens,
				},
			};
		},
	};
}
