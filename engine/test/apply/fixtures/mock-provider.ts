// engine/test/apply/fixtures/mock-provider.ts
/**
 * Mock LLM provider for Apply pipeline tests.
 * Returns canned responses for query understanding and section summaries.
 */
import type {
	LLMProvider,
	LLMRequest,
	LLMResponse,
} from "../../../src/llm/types";

export function createMockProvider(
	responseContent: string | ((request: LLMRequest) => string),
): LLMProvider {
	return {
		capabilities: {
			vision: false,
			structuredOutput: true,
			maxContextTokens: 128000,
		},
		async sendMessage(request: LLMRequest): Promise<LLMResponse> {
			const content =
				typeof responseContent === "function"
					? responseContent(request)
					: responseContent;
			return {
				content,
				usage: { inputTokens: 100, outputTokens: 50 },
			};
		},
	};
}

/** A mock that returns a valid QueryPlan JSON for any input */
export const mockUnderstandProvider = createMockProvider(
	JSON.stringify({
		intent: "understand the topic",
		analysisType: "exploration",
		targetDomains: ["distributed-systems"],
		targetFrameTypes: ["definition", "procedure"],
		targetEntities: ["entity-replication"],
		weights: {
			domainMatch: 0.7,
			frameTypeMatch: 0.5,
			entityMatch: 0.6,
		},
		groupingStrategy: "entity",
	}),
);

/** A mock that returns a summary string for any section */
export const mockSummaryProvider = createMockProvider(
	"This section covers key concepts about the topic with supporting evidence from multiple sources.",
);
