/**
 * Anthropic adapter — translates our LLMRequest into Anthropic SDK calls.
 *
 * This is the ONLY file in the codebase that imports @anthropic-ai/sdk.
 * If Anthropic changes their API, we change this file. The pipeline
 * doesn't even know it happened. That's the adapter pattern.
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

/** Injected dependency for testing — lets us mock the SDK */
export interface AnthropicClient {
	create(args: Record<string, unknown>): Promise<{
		content: Array<{ type: string; text?: string }>;
		usage: { input_tokens: number; output_tokens: number };
	}>;
}

export function createAnthropicProvider(
	config: ProviderConfig,
	mockClient?: AnthropicClient,
): LLMProvider {
	const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
	const client = mockClient ?? createRealClient(apiKey);

	const capabilities: ProviderCapabilities = {
		vision: true,
		structuredOutput: true,
		maxContextTokens: inferMaxTokens(config.model),
	};

	return {
		capabilities,
		async sendMessage(request: LLMRequest): Promise<LLMResponse> {
			// Extract system message (Anthropic takes it as a top-level param)
			const systemMessages = request.messages.filter(
				(m) => m.role === "system",
			);
			const nonSystemMessages = request.messages.filter(
				(m) => m.role !== "system",
			);

			const systemText = systemMessages
				.flatMap((m) =>
					m.content
						.filter(
							(c): c is Extract<MessageContent, { type: "text" }> =>
								c.type === "text",
						)
						.map((c) => c.text),
				)
				.join("\n\n");

			// Translate messages to Anthropic format
			const messages = nonSystemMessages.map((msg) => ({
				role: msg.role as "user" | "assistant",
				content: msg.content.map(translateContent),
			}));

			const args: Record<string, unknown> = {
				model: config.model,
				messages,
				max_tokens: request.maxTokens ?? 4096,
			};

			if (systemText) {
				args.system = systemText;
			}

			if (request.temperature !== undefined) {
				args.temperature = request.temperature;
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
	// Image → Anthropic's base64 format
	const base64 = Buffer.from(content.data).toString("base64");
	return {
		type: "image",
		source: {
			type: "base64",
			media_type: content.mediaType,
			data: base64,
		},
	};
}

function createRealClient(apiKey: string | undefined): AnthropicClient {
	const sdk = new Anthropic({ apiKey: apiKey ?? "" });
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

function inferMaxTokens(model: string): number {
	if (model.includes("opus") || model.includes("sonnet")) return 200_000;
	if (model.includes("haiku")) return 200_000;
	return 100_000; // conservative default
}
