import { describe, expect, test } from "bun:test";
import { createProvider, withRetry } from "../../src/llm/provider";
import type { LLMProvider, LLMRequest, LLMResponse } from "../../src/llm/types";

describe("createProvider", () => {
	test("creates Anthropic provider for 'anthropic' config", () => {
		const provider = createProvider({
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			apiKey: "test-key",
		});
		expect(provider.capabilities.vision).toBe(true);
	});

	test("throws for unimplemented providers", () => {
		expect(() =>
			createProvider({ provider: "openai", model: "gpt-4o" }),
		).toThrow("not yet implemented");
	});
});

describe("withRetry", () => {
	function makeFlakyProvider(
		failCount: number,
		errorType: "network" | "auth" = "network",
	): { provider: LLMProvider; attempts: number[] } {
		const state = { attempts: [] as number[] };
		let attempt = 0;

		const provider: LLMProvider = {
			capabilities: {
				vision: false,
				structuredOutput: true,
				maxContextTokens: 100_000,
			},
			async sendMessage(): Promise<LLMResponse> {
				attempt++;
				state.attempts.push(attempt);
				if (attempt <= failCount) {
					const err = new Error(
						errorType === "auth" ? "401 Unauthorized" : "Connection failed",
					);
					(err as unknown as Record<string, unknown>).status =
						errorType === "auth" ? 401 : 500;
					throw err;
				}
				return {
					content: "success",
					usage: { inputTokens: 10, outputTokens: 5 },
				};
			},
		};

		return { provider, ...state };
	}

	test("returns response on first success", async () => {
		const { provider } = makeFlakyProvider(0);
		const retrying = withRetry(provider, 2);
		const response = await retrying.sendMessage({
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
		});
		expect(response.content).toBe("success");
	});

	test("retries on failure and eventually succeeds", async () => {
		const state = makeFlakyProvider(2); // fails twice, succeeds on 3rd
		const retrying = withRetry(state.provider, 2);
		const response = await retrying.sendMessage({
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
		});
		expect(response.content).toBe("success");
		expect(state.attempts).toHaveLength(3); // 1 initial + 2 retries
	});

	test("throws after exhausting retries", async () => {
		const state = makeFlakyProvider(5); // always fails
		const retrying = withRetry(state.provider, 2);
		await expect(
			retrying.sendMessage({
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			}),
		).rejects.toThrow("Connection failed");
		expect(state.attempts).toHaveLength(3); // 1 initial + 2 retries
	});

	test("does NOT retry auth errors", async () => {
		const state = makeFlakyProvider(5, "auth");
		const retrying = withRetry(state.provider, 2);
		await expect(
			retrying.sendMessage({
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			}),
		).rejects.toThrow("401");
		expect(state.attempts).toHaveLength(1); // no retry
	});

	test("preserves capabilities from wrapped provider", () => {
		const { provider } = makeFlakyProvider(0);
		const retrying = withRetry(provider, 2);
		expect(retrying.capabilities).toEqual(provider.capabilities);
	});
});
