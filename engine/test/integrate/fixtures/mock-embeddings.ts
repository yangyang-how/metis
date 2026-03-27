/**
 * Mock embedding provider and pre-computed embeddings for deterministic tests.
 *
 * Strategy: use short vectors (8-dim) instead of 3072-dim. Tests validate
 * the logic (batching, caching, similarity), not the embedding quality.
 * Pre-computed vectors are designed so that:
 *   - "replication lag" and "replication delay" have cosine similarity ~0.92
 *   - "feedback loop" (distributed) and "反馈循环" have similarity ~0.78
 *   - Unrelated concepts have similarity < 0.5
 */
import type { EmbeddingProvider } from "../../../src/llm/embedding-types";

export const MOCK_DIMENSIONS = 8;

/** Pre-computed vectors with designed similarity relationships */
export const MOCK_VECTORS: Record<string, number[]> = {
	// Replication cluster (high mutual similarity)
	"replication lag": [0.9, 0.3, 0.1, 0.0, 0.0, 0.1, 0.0, 0.0],
	"replication delay": [0.88, 0.32, 0.12, 0.02, 0.0, 0.08, 0.0, 0.0],
	"the delay between a write on the leader and its reflection on a follower":
		[0.85, 0.35, 0.15, 0.0, 0.05, 0.1, 0.0, 0.0],
	"time for a write to propagate from primary to replica": [
		0.84, 0.34, 0.14, 0.01, 0.04, 0.09, 0.0, 0.0,
	],

	// Stale reads / inconsistency (related to replication)
	"stale reads from followers": [0.7, 0.5, 0.2, 0.0, 0.1, 0.1, 0.0, 0.0],
	"read inconsistency in distributed databases": [
		0.68, 0.48, 0.22, 0.02, 0.12, 0.08, 0.0, 0.0,
	],

	// Consistency cluster
	"strong consistency requires synchronous replication": [
		0.3, 0.1, 0.8, 0.4, 0.0, 0.0, 0.0, 0.0,
	],
	"strong consistency does not require synchronous replication": [
		0.3, 0.1, 0.75, 0.35, 0.0, 0.0, 0.1, 0.0,
	],

	// Feedback loop — distributed systems
	"feedback loop in retry logic": [
		0.1, 0.0, 0.0, 0.0, 0.8, 0.3, 0.2, 0.0,
	],
	"cascading failures across services": [
		0.0, 0.0, 0.1, 0.0, 0.6, 0.5, 0.1, 0.0,
	],

	// Feedback loop — behavioral science
	反馈循环: [0.12, 0.0, 0.0, 0.0, 0.7, 0.25, 0.3, 0.2],
	"feedback loop in habit formation": [
		0.1, 0.0, 0.0, 0.0, 0.72, 0.28, 0.28, 0.18,
	],

	// Replication lag has_property
	"increases during peak load": [0.6, 0.4, 0.2, 0.1, 0.0, 0.0, 0.0, 0.0],
};

/** Deterministic fallback: hash the text to a stable vector */
function hashToVector(text: string): number[] {
	const vec = new Array(MOCK_DIMENSIONS).fill(0) as number[];
	for (let i = 0; i < text.length; i++) {
		vec[i % MOCK_DIMENSIONS]! += text.charCodeAt(i) / 1000;
	}
	// Normalize
	const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
	return mag > 0 ? vec.map((v) => v / mag) : vec;
}

export function createMockEmbeddingProvider(): EmbeddingProvider {
	return {
		dimensions: MOCK_DIMENSIONS,
		maxBatchSize: 50,
		async embed(texts: string[]): Promise<number[][]> {
			return texts.map((text) => {
				const normalized = text.toLowerCase().trim();
				// Check for exact match first
				if (MOCK_VECTORS[normalized]) return MOCK_VECTORS[normalized];
				// Check for substring match
				for (const [key, vec] of Object.entries(MOCK_VECTORS)) {
					if (normalized.includes(key) || key.includes(normalized))
						return vec;
				}
				// Fallback to hash
				return hashToVector(text);
			});
		},
	};
}
