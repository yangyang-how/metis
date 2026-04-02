import { describe, expect, test } from "bun:test";
import type { VectorIndex } from "../../src/integrate/types";
import { queryVectors } from "../../src/retrieve/vector-search";

/**
 * Small 4-dim vectors with known similarity relationships.
 * Cosine sim: similar1 ≈ similar2 > unrelated
 */
const mockIndex: VectorIndex = [
	{
		atomId: "atom-a",
		text: "replication lag definition",
		embedding: [1, 0, 0, 0],
	},
	{
		atomId: "atom-b",
		text: "replication delay causes stale reads",
		embedding: [0.9, 0.1, 0, 0], // similar to atom-a
	},
	{
		atomId: "atom-c",
		text: "habit formation feedback loop",
		embedding: [0, 0, 1, 0], // orthogonal to a/b
	},
	{
		atomId: "atom-d",
		text: "industry lifecycle penetration rate",
		embedding: [0, 0, 0, 1], // orthogonal to all above
	},
	{
		atomId: "atom-e",
		text: "another replication topic",
		embedding: [0.8, 0.2, 0.1, 0], // somewhat similar to atom-a
	},
];

describe("queryVectors", () => {
	test("finds nearest neighbors by cosine similarity", () => {
		const queryEmbedding = [1, 0, 0, 0]; // should match atom-a most
		const results = queryVectors(queryEmbedding, mockIndex, 3);
		expect(results[0]?.id).toBe("atom-a");
		expect(results[0]?.score).toBeCloseTo(1.0, 4);
	});

	test("returns results sorted by descending similarity", () => {
		const queryEmbedding = [1, 0, 0, 0];
		const results = queryVectors(queryEmbedding, mockIndex, 5);
		for (let i = 1; i < results.length; i++) {
			const prev = results[i - 1];
			const curr = results[i];
			if (prev && curr) {
				expect(prev.score).toBeGreaterThanOrEqual(curr.score);
			}
		}
	});

	test("respects top-k limit", () => {
		const results = queryVectors([1, 0, 0, 0], mockIndex, 2);
		expect(results.length).toBe(2);
	});

	test("handles empty embedding index", () => {
		const results = queryVectors([1, 0, 0, 0], [], 5);
		expect(results).toEqual([]);
	});

	test("handles query embedding of all zeros", () => {
		const results = queryVectors([0, 0, 0, 0], mockIndex, 5);
		// cosine similarity with zero vector = 0, so all scores should be 0
		for (const r of results) {
			expect(r.score).toBe(0);
		}
	});

	test("correctly identifies orthogonal vectors as dissimilar", () => {
		// Query aligned with atom-c (habit formation)
		const results = queryVectors([0, 0, 1, 0], mockIndex, 5);
		expect(results[0]?.id).toBe("atom-c");
		expect(results[0]?.score).toBeCloseTo(1.0, 4);
		// atom-a should have ~0 similarity
		const atomA = results.find((r) => r.id === "atom-a");
		expect(atomA?.score).toBeCloseTo(0, 4);
	});
});
