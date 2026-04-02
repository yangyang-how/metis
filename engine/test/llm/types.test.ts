import { describe, expect, test } from "bun:test";
import type {
	LLMProvider,
	LLMRequest,
	LLMResponse,
	Message,
	MessageContent,
	ProviderCapabilities,
	ProviderConfig,
} from "../../src/llm/types";

describe("llm types", () => {
	test("LLMRequest accepts text-only messages", () => {
		const request: LLMRequest = {
			messages: [
				{
					role: "system",
					content: [{ type: "text", text: "You are helpful." }],
				},
				{ role: "user", content: [{ type: "text", text: "Hello" }] },
			],
		};
		expect(request.messages).toHaveLength(2);
	});

	test("LLMRequest accepts image content", () => {
		const request: LLMRequest = {
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "What's in this image?" },
						{
							type: "image",
							data: new Uint8Array([1, 2, 3]),
							mediaType: "image/png",
						},
					],
				},
			],
		};
		expect(request.messages[0]?.content).toHaveLength(2);
	});

	test("ProviderConfig supports all four providers", () => {
		const configs: ProviderConfig[] = [
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "openai", model: "gpt-4o" },
			{ provider: "gemini", model: "gemini-pro" },
			{ provider: "kimi", model: "moonshot-v1" },
		];
		expect(configs).toHaveLength(4);
	});

	test("LLMRequest accepts optional responseSchema", () => {
		const request: LLMRequest = {
			messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
			responseSchema: {
				type: "object",
				properties: { name: { type: "string" } },
			},
			maxTokens: 1000,
			temperature: 0.5,
		};
		expect(request.responseSchema).toBeDefined();
	});
});
