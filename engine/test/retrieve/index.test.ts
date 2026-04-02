import { describe, expect, test } from "bun:test";
import { atomToText } from "../../src/integrate/embedding-service";
import type { VectorIndex } from "../../src/integrate/types";
import { retrieve } from "../../src/retrieve/index";
import { allFixtureAtoms } from "./fixtures/sample-atoms";

/**
 * Mock embeddings: 4-dim vectors with known similarity.
 * Replication atoms → [1, 0, 0, 0] direction
 * Industry atoms → [0, 1, 0, 0] direction
 * Behavior atoms → [0, 0, 1, 0] direction
 * Noise atoms → [0, 0, 0, 1] direction
 */
function makeMockEmbeddings(): VectorIndex {
	return allFixtureAtoms.map((atom) => {
		let embedding: number[];
		if (atom.id.startsWith("dist-")) {
			embedding = [0.9 + Math.random() * 0.1, 0.1, 0, 0];
		} else if (atom.id.startsWith("ind-")) {
			embedding = [0, 0.9 + Math.random() * 0.1, 0.1, 0];
		} else if (atom.id.startsWith("beh-")) {
			embedding = [0, 0.1, 0.9 + Math.random() * 0.1, 0];
		} else {
			embedding = [0, 0, 0.1, 0.9 + Math.random() * 0.1];
		}
		return {
			atomId: atom.id,
			text: atomToText(atom),
			embedding,
		};
	});
}

describe("retrieve", () => {
	const atoms = allFixtureAtoms;
	const embeddings = makeMockEmbeddings();

	test("runs hybrid search end-to-end with preloaded data", async () => {
		const results = await retrieve({
			query: "replication lag",
			atoms,
			embeddings,
			queryEmbedding: [1, 0, 0, 0],
			topK: 5,
			method: "hybrid",
		});

		expect(results.length).toBe(5);
		// Should have atom data, score, and ranks
		expect(results[0]?.atom).toBeDefined();
		expect(results[0]?.score).toBeGreaterThan(0);
		expect(results[0]?.ranks).toBeDefined();
	});

	test("bm25-only mode does not require embeddings", async () => {
		const results = await retrieve({
			query: "replication lag",
			atoms,
			method: "bm25",
			topK: 5,
		});

		expect(results.length).toBe(5);
		// Top results should be dist-sys atoms
		const topIds = results.slice(0, 3).map((r) => r.atom.id);
		expect(topIds.some((id) => id.startsWith("dist-"))).toBe(true);
		// vector rank should be null in bm25-only mode
		expect(results[0]?.ranks.vector).toBeNull();
	});

	test("vector-only mode works with pre-computed query embedding", async () => {
		const results = await retrieve({
			query: "replication lag",
			atoms,
			embeddings,
			queryEmbedding: [1, 0, 0, 0],
			method: "vector",
			topK: 5,
		});

		expect(results.length).toBe(5);
		// Top results should be dist-sys atoms (aligned with [1,0,0,0])
		expect(results[0]?.atom.id.startsWith("dist-")).toBe(true);
		// bm25 rank should be null in vector-only mode
		expect(results[0]?.ranks.bm25).toBeNull();
	});

	test("returns structured RetrievalResult with atom and ranks", async () => {
		const results = await retrieve({
			query: "feedback loop habit formation",
			atoms,
			embeddings,
			queryEmbedding: [0, 0, 1, 0],
			topK: 3,
			method: "hybrid",
		});

		const first = results[0];
		expect(first).toBeDefined();
		if (!first) return;
		expect(first.atom.id).toBeDefined();
		expect(first.atom.frame).toBeDefined();
		expect(first.atom.roles).toBeDefined();
		expect(typeof first.score).toBe("number");
		expect("bm25" in first.ranks).toBe(true);
		expect("vector" in first.ranks).toBe(true);
	});

	test("handles missing embeddings gracefully (falls back to BM25)", async () => {
		const results = await retrieve({
			query: "replication lag",
			atoms,
			// no embeddings, no queryEmbedding
			method: "hybrid",
			topK: 5,
		});

		// Should still return results (BM25-only fallback)
		expect(results.length).toBeGreaterThan(0);
	});

	test("respects topK", async () => {
		const results = await retrieve({
			query: "replication",
			atoms,
			method: "bm25",
			topK: 2,
		});
		expect(results.length).toBe(2);
	});
});
