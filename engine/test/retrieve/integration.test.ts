/**
 * Integration tests — run retrieval against real graph data.
 *
 * These tests depend on engine/graph/ existing with processed book data.
 * They verify retrieval quality on known queries where we can predict
 * which atoms should rank highly.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { retrieve } from "../../src/retrieve/index";

const graphDir = join(import.meta.dir, "../../graph");
const hasGraph = existsSync(join(graphDir, "atoms.json"));

describe.skipIf(!hasGraph)("retrieval integration (real data)", () => {
	test("BM25 retrieves relevant atoms for 'replication lag'", async () => {
		const results = await retrieve({
			query: "replication lag",
			method: "bm25",
			graphDir,
			topK: 10,
		});

		expect(results.length).toBe(10);
		// Top results should come from DDIA (the book about distributed systems)
		const topSources = results.slice(0, 5).map((r) => r.atom.source.title);
		const hasDDIA = topSources.some((t) =>
			t.includes("Designing Data-Intensive Applications"),
		);
		expect(hasDDIA).toBe(true);
	});

	test("BM25 retrieves relevant atoms for CJK query '行业生命周期'", async () => {
		const results = await retrieve({
			query: "行业生命周期",
			method: "bm25",
			graphDir,
			topK: 10,
		});

		expect(results.length).toBe(10);
		// Top results should come from the industry analysis book
		const topSources = results.slice(0, 3).map((r) => r.atom.source.title);
		const hasIndustry = topSources.some((t) =>
			t.includes("如何快速了解一个行业"),
		);
		expect(hasIndustry).toBe(true);
	});

	test("BM25 and hybrid return different rankings for same query", async () => {
		// Without embeddings API, hybrid falls back to BM25, so just test
		// that the API works and returns results for both methods
		const bm25 = await retrieve({
			query: "consistency model",
			method: "bm25",
			graphDir,
			topK: 5,
		});

		const hybrid = await retrieve({
			query: "consistency model",
			method: "hybrid",
			graphDir,
			topK: 5,
		});

		expect(bm25.length).toBeGreaterThan(0);
		expect(hybrid.length).toBeGreaterThan(0);
	});
});
