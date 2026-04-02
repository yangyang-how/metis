/**
 * Reusable mock LLMProvider for testing comprehend modules.
 *
 * Records all calls for assertion. Returns canned responses in order.
 * No real API calls — fast, free, deterministic.
 */
import type {
	LLMProvider,
	LLMRequest,
	LLMResponse,
	ProviderCapabilities,
} from "../../../src/llm/types";

export function createMockProvider(
	responses: string[],
	capabilities?: Partial<ProviderCapabilities>,
): {
	provider: LLMProvider;
	calls: LLMRequest[];
} {
	const calls: LLMRequest[] = [];
	let callIndex = 0;

	const provider: LLMProvider = {
		capabilities: {
			vision: false,
			structuredOutput: true,
			maxContextTokens: 200_000,
			...capabilities,
		},
		async sendMessage(request: LLMRequest): Promise<LLMResponse> {
			calls.push(request);
			const content = responses[callIndex] ?? "{}";
			callIndex++;
			return {
				content,
				usage: { inputTokens: 1000, outputTokens: 500 },
			};
		},
	};

	return { provider, calls };
}

/**
 * Mock provider that throws on every call — for testing error handling.
 */
export function createFailingProvider(error: Error): {
	provider: LLMProvider;
	callCount: number[];
} {
	const state = { callCount: [0] };
	const provider: LLMProvider = {
		capabilities: {
			vision: false,
			structuredOutput: true,
			maxContextTokens: 200_000,
		},
		async sendMessage(): Promise<LLMResponse> {
			const current = state.callCount[0] ?? 0;
			state.callCount[0] = current + 1;
			throw error;
		},
	};
	return { provider, callCount: state.callCount };
}
