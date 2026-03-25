import { describe, expect, test } from "bun:test";
import { createKimiProvider } from "../../src/llm/kimi-adapter";
import type { LLMRequest } from "../../src/llm/types";

describe("createKimiProvider", () => {
	test("sets capabilities correctly", () => {
		const provider = createKimiProvider({
			provider: "kimi",
			model: "moonshot-v1-128k",
			apiKey: "test-key",
		});

		expect(provider.capabilities.vision).toBe(false);
		expect(provider.capabilities.structuredOutput).toBe(false);
		expect(provider.capabilities.maxContextTokens).toBe(128_000);
	});

	test("infers context window from model name", () => {
		const p32k = createKimiProvider({
			provider: "kimi",
			model: "moonshot-v1-32k",
			apiKey: "test",
		});
		expect(p32k.capabilities.maxContextTokens).toBe(32_000);

		const p8k = createKimiProvider({
			provider: "kimi",
			model: "moonshot-v1-8k",
			apiKey: "test",
		});
		expect(p8k.capabilities.maxContextTokens).toBe(8_000);
	});

	test("falls back to KIMI_API_KEY env var", () => {
		const original = process.env.KIMI_API_KEY;
		process.env.KIMI_API_KEY = "env-test-key";
		try {
			const provider = createKimiProvider({
				provider: "kimi",
				model: "moonshot-v1-128k",
			});
			expect(provider).toBeDefined();
		} finally {
			if (original) {
				process.env.KIMI_API_KEY = original;
			} else {
				process.env.KIMI_API_KEY = undefined as unknown as string;
			}
		}
	});
});

describe("kimi adapter — sendMessage", () => {
	test("translates text messages to OpenAI format", async () => {
		let capturedArgs: Record<string, unknown> = {};

		const provider = createKimiProvider(
			{ provider: "kimi", model: "moonshot-v1-128k", apiKey: "test" },
			{
				async create(args: Record<string, unknown>) {
					capturedArgs = args;
					return {
						choices: [{ message: { content: '{"result": "ok"}' } }],
						usage: { prompt_tokens: 100, completion_tokens: 50 },
					};
				},
			},
		);

		const request: LLMRequest = {
			messages: [
				{
					role: "system",
					content: [{ type: "text", text: "Be helpful." }],
				},
				{ role: "user", content: [{ type: "text", text: "Hello" }] },
			],
			maxTokens: 1000,
		};

		const response = await provider.sendMessage(request);

		// System message should stay in messages array (OpenAI style)
		const messages = capturedArgs.messages as Array<{
			role: string;
			content: string;
		}>;
		expect(messages[0]?.role).toBe("system");
		expect(messages[0]?.content).toBe("Be helpful.");
		expect(messages[1]?.role).toBe("user");
		expect(messages[1]?.content).toBe("Hello");
		expect(response.content).toBe('{"result": "ok"}');
		expect(response.usage.inputTokens).toBe(100);
		expect(response.usage.outputTokens).toBe(50);
	});

	test("converts image content to text placeholder", async () => {
		let capturedArgs: Record<string, unknown> = {};

		const provider = createKimiProvider(
			{ provider: "kimi", model: "moonshot-v1-128k", apiKey: "test" },
			{
				async create(args: Record<string, unknown>) {
					capturedArgs = args;
					return {
						choices: [{ message: { content: "I see text only" } }],
						usage: { prompt_tokens: 50, completion_tokens: 10 },
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
							data: new Uint8Array([1, 2, 3]),
							mediaType: "image/png",
						},
					],
				},
			],
		});

		// Image should be converted to text placeholder
		const messages = capturedArgs.messages as Array<{
			role: string;
			content: string;
		}>;
		expect(messages[0]?.content).toContain("What's this?");
		expect(messages[0]?.content).toContain("[Image]");
	});

	test("injects schema into system prompt when responseSchema provided", async () => {
		let capturedArgs: Record<string, unknown> = {};

		const provider = createKimiProvider(
			{ provider: "kimi", model: "moonshot-v1-128k", apiKey: "test" },
			{
				async create(args: Record<string, unknown>) {
					capturedArgs = args;
					return {
						choices: [{ message: { content: '{"name":"test"}' } }],
						usage: { prompt_tokens: 100, completion_tokens: 20 },
					};
				},
			},
		);

		await provider.sendMessage({
			messages: [
				{
					role: "system",
					content: [{ type: "text", text: "Extract data." }],
				},
				{ role: "user", content: [{ type: "text", text: "Content here" }] },
			],
			responseSchema: {
				type: "object",
				properties: { name: { type: "string" } },
			},
		});

		const messages = capturedArgs.messages as Array<{
			role: string;
			content: string;
		}>;
		// System message should include schema instruction
		expect(messages[0]?.content).toContain("Extract data.");
		expect(messages[0]?.content).toContain("JSON");
	});
});
