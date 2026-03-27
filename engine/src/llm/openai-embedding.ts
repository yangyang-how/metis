/**
 * OpenAI embedding adapter.
 *
 * Uses the `openai` npm package (already installed for Kimi adapter).
 * Same pattern: injectable client for testing, real client for production.
 */
import OpenAI from "openai";
import type { EmbeddingConfig, EmbeddingProvider } from "./embedding-types";

/** Injectable dependency for testing */
export interface OpenAIEmbeddingClient {
	create(args: Record<string, unknown>): Promise<{
		data: Array<{ embedding: number[]; index: number }>;
	}>;
}

export function createOpenAIEmbeddingProvider(
	config: EmbeddingConfig,
	mockClient?: OpenAIEmbeddingClient,
): EmbeddingProvider {
	const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
	const client = mockClient ?? createRealClient(apiKey);
	const dimensions = inferDimensions(config.model);

	return {
		dimensions,
		maxBatchSize: 2048,
		async embed(texts: string[]): Promise<number[][]> {
			const response = await client.create({
				model: config.model,
				input: texts,
			});
			// OpenAI returns embeddings sorted by index
			const sorted = [...response.data].sort((a, b) => a.index - b.index);
			return sorted.map((d) => d.embedding);
		},
	};
}

function createRealClient(
	apiKey: string | undefined,
): OpenAIEmbeddingClient {
	const sdk = new OpenAI({ apiKey: apiKey ?? "" });
	return {
		async create(args) {
			const response = await sdk.embeddings.create(
				args as unknown as Parameters<typeof sdk.embeddings.create>[0],
			);
			return {
				data: response.data.map((d) => ({
					embedding: d.embedding,
					index: d.index,
				})),
			};
		},
	};
}

function inferDimensions(model: string): number {
	if (model.includes("3-large")) return 3072;
	if (model.includes("3-small")) return 1536;
	if (model.includes("ada")) return 1536;
	return 3072;
}
