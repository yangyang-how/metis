import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createAnthropicProvider } from "../../src/llm/anthropic-adapter";
import type { LLMRequest } from "../../src/llm/types";

// We test the adapter by mocking the Anthropic SDK's messages.create method.
// This verifies our translation logic without making real API calls.

describe("createAnthropicProvider", () => {
	test("sets capabilities correctly", () => {
		const provider = createAnthropicProvider({
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			apiKey: "test-key",
		});

		expect(provider.capabilities.vision).toBe(true);
		expect(provider.capabilities.structuredOutput).toBe(true);
		expect(provider.capabilities.maxContextTokens).toBeGreaterThan(0);
	});

	test("falls back to env var when apiKey not provided", () => {
		// This just verifies it doesn't throw during construction
		const original = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = "env-test-key";
		try {
			const provider = createAnthropicProvider({
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
			});
			expect(provider).toBeDefined();
		} finally {
			if (original) {
				process.env.ANTHROPIC_API_KEY = original;
			} else {
				process.env.ANTHROPIC_API_KEY = undefined as unknown as string;
			}
		}
	});
});

describe("anthropic adapter — sendMessage", () => {
	test("translates text messages to Anthropic format", async () => {
		let capturedArgs: Record<string, unknown> = {};

		const provider = createAnthropicProvider(
			{
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "test",
			},
			{
				// Inject a mock create function
				async create(args: Record<string, unknown>) {
					capturedArgs = args;
					return {
						content: [{ type: "text", text: '{"result": "ok"}' }],
						usage: { input_tokens: 100, output_tokens: 50 },
					};
				},
			},
		);

		const request: LLMRequest = {
			messages: [
				{ role: "system", content: [{ type: "text", text: "Be helpful." }] },
				{ role: "user", content: [{ type: "text", text: "Hello" }] },
			],
			maxTokens: 1000,
		};

		const response = await provider.sendMessage(request);

		// System message should be extracted to top-level param
		expect(capturedArgs.system).toBeDefined();
		// User message should be in messages array
		expect(capturedArgs.messages).toBeDefined();
		expect(response.content).toBe('{"result": "ok"}');
		expect(response.usage.inputTokens).toBe(100);
		expect(response.usage.outputTokens).toBe(50);
	});

	test("translates image content to Anthropic base64 format", async () => {
		let capturedArgs: Record<string, unknown> = {};

		const provider = createAnthropicProvider(
			{
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "test",
			},
			{
				async create(args: Record<string, unknown>) {
					capturedArgs = args;
					return {
						content: [{ type: "text", text: "I see an image" }],
						usage: { input_tokens: 200, output_tokens: 30 },
					};
				},
			},
		);

		await provider.sendMessage({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "What's this?" },
						{
							type: "image",
							data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
							mediaType: "image/png",
						},
					],
				},
			],
		});

		// Verify image was translated to base64 source format
		const messages = capturedArgs.messages as Array<{
			content: Array<{ type: string; source?: { type: string } }>;
		}>;
		const userContent = messages[0]?.content;
		const imageBlock = userContent?.find((c) => c.type === "image");
		expect(imageBlock).toBeDefined();
		expect(imageBlock?.source?.type).toBe("base64");
	});

	test("returns usage stats from response", async () => {
		const provider = createAnthropicProvider(
			{
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "test",
			},
			{
				async create() {
					return {
						content: [{ type: "text", text: "done" }],
						usage: { input_tokens: 500, output_tokens: 250 },
					};
				},
			},
		);

		const response = await provider.sendMessage({
			messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
		});

		expect(response.usage.inputTokens).toBe(500);
		expect(response.usage.outputTokens).toBe(250);
	});
});
