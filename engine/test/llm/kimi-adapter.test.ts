import { describe, expect, test } from "bun:test";
import { createKimiProvider } from "../../src/llm/kimi-adapter";
import type { KimiClient } from "../../src/llm/kimi-adapter";
import type { LLMRequest } from "../../src/llm/types";

function mockKimiClient(
	responseText: string,
	onCapture?: (args: Record<string, unknown>) => void,
): KimiClient {
	return {
		async create(args: Record<string, unknown>) {
			if (onCapture) onCapture(args);
			return {
				content: [{ type: "text", text: responseText }],
				usage: { input_tokens: 100, output_tokens: 50 },
			};
		},
	};
}

describe("createKimiProvider", () => {
	test("sets capabilities correctly", () => {
		const provider = createKimiProvider({
			provider: "kimi",
			model: "kimi-for-coding",
			apiKey: "test-key",
		});

		expect(provider.capabilities.vision).toBe(false);
		expect(provider.capabilities.structuredOutput).toBe(true);
		expect(provider.capabilities.maxContextTokens).toBe(262_144);
	});

	test("falls back to MOONSHOT_API_KEY then KIMI_API_KEY", () => {
		const origMoonshot = process.env.MOONSHOT_API_KEY;
		const origKimi = process.env.KIMI_API_KEY;
		process.env.MOONSHOT_API_KEY = "moonshot-test";
		process.env.KIMI_API_KEY = "kimi-test";
		try {
			const provider = createKimiProvider({
				provider: "kimi",
				model: "kimi-for-coding",
			});
			expect(provider).toBeDefined();
		} finally {
			process.env.MOONSHOT_API_KEY = origMoonshot;
			process.env.KIMI_API_KEY = origKimi;
		}
	});
});

describe("kimi adapter — sendMessage", () => {
	test("separates system message as top-level param (Anthropic format)", async () => {
		let captured: Record<string, unknown> = {};

		const provider = createKimiProvider(
			{ provider: "kimi", model: "kimi-for-coding", apiKey: "test" },
			mockKimiClient('{"result": "ok"}', (args) => {
				captured = args;
			}),
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

		// System message should be a top-level param (Anthropic format)
		expect(captured.system).toContain("Be helpful.");

		// Only user message in messages array
		const messages = captured.messages as Array<{
			role: string;
			content: unknown;
		}>;
		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe("user");

		expect(response.content).toBe('{"result": "ok"}');
		expect(response.usage.inputTokens).toBe(100);
		expect(response.usage.outputTokens).toBe(50);
	});

	test("converts image content to text placeholder", async () => {
		let captured: Record<string, unknown> = {};

		const provider = createKimiProvider(
			{ provider: "kimi", model: "kimi-for-coding", apiKey: "test" },
			mockKimiClient("I see text only", (args) => {
				captured = args;
			}),
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

		const messages = captured.messages as Array<{
			role: string;
			content: Array<{ type: string; text: string }>;
		}>;
		const contentTexts = messages[0]?.content.map((c) => c.text).join(" ");
		expect(contentTexts).toContain("What's this?");
		expect(contentTexts).toContain("[Image]");
	});

	test("injects schema into system param when responseSchema provided", async () => {
		let captured: Record<string, unknown> = {};

		const provider = createKimiProvider(
			{ provider: "kimi", model: "kimi-for-coding", apiKey: "test" },
			mockKimiClient('{"name":"test"}', (args) => {
				captured = args;
			}),
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

		// Schema should be injected into the system param
		expect(captured.system).toContain("Extract data.");
		expect(captured.system).toContain("JSON");
	});

	test("clamps temperature to 0.0-1.0", async () => {
		let captured: Record<string, unknown> = {};

		const provider = createKimiProvider(
			{ provider: "kimi", model: "kimi-for-coding", apiKey: "test" },
			mockKimiClient("ok", (args) => {
				captured = args;
			}),
		);

		await provider.sendMessage({
			messages: [
				{ role: "user", content: [{ type: "text", text: "hi" }] },
			],
			temperature: 1.5,
		});

		expect(captured.temperature).toBe(1.0);
	});
});
