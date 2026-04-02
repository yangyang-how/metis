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

	const batchSize = 100;

	return {
		dimensions,
		maxBatchSize: batchSize,
		async embed(texts: string[]): Promise<number[][]> {
			if (texts.length === 0) return [];
			// Filter out empty strings — OpenAI rejects them
			const cleanTexts = texts.map((t) => t.trim() || "empty");

			// Auto-batch: split into chunks of batchSize
			const allResults: number[][] = new Array(cleanTexts.length);
			for (let start = 0; start < cleanTexts.length; start += batchSize) {
				const batchTexts = cleanTexts.slice(start, start + batchSize);
				const response = await client.create({
					model: config.model,
					input: batchTexts,
					encoding_format: "float",
				});
				const sorted = [...response.data].sort((a, b) => a.index - b.index);
				for (let i = 0; i < sorted.length; i++) {
					const entry = sorted[i];
					if (entry) allResults[start + i] = entry.embedding;
				}
			}
			return allResults;
		},
	};
}

function createRealClient(apiKey: string | undefined): OpenAIEmbeddingClient {
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
