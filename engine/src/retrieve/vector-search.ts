/**
 * Vector similarity search over pre-computed atom embeddings.
 *
 * Reuses cosineSimilarity from the Integrate stage's embedding service.
 * This is a brute-force linear scan — fine for our ~4K atom dataset.
 * For 100K+ atoms you'd want an approximate nearest neighbor index (HNSW).
 */
import { cosineSimilarity } from "../integrate/embedding-service";
import type { VectorIndex } from "../integrate/types";

/**
 * Find the top-k most similar atoms to a query embedding.
 */
export function queryVectors(
	queryEmbedding: number[],
	index: VectorIndex,
	topK: number,
): Array<{ id: string; score: number }> {
	if (index.length === 0) return [];

	const scored: Array<{ id: string; score: number }> = [];

	for (const entry of index) {
		const score = cosineSimilarity(queryEmbedding, entry.embedding);
		scored.push({ id: entry.atomId, score });
	}

	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, topK);
}
