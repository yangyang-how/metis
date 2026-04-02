/**
 * Embedding provider interface — same abstraction pattern as LLMProvider.
 *
 * Pipeline stages call this interface, never an SDK directly.
 * Currently: OpenAI adapter. Future: Ollama, Voyage.
 */

export interface EmbeddingProvider {
	/** Embed a batch of texts. Returns embeddings in same order. */
	embed(texts: string[]): Promise<number[][]>;
	/** Model dimensions (e.g., 3072 for text-embedding-3-large) */
	dimensions: number;
	/** Max batch size the provider supports */
	maxBatchSize: number;
}

export interface EmbeddingConfig {
	provider: "openai";
	model: string;
	apiKey?: string;
}
