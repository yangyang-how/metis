import { describe, expect, test } from "bun:test";
import { atomToText } from "../../src/integrate/embedding-service";
import { buildBM25Index, queryBM25 } from "../../src/retrieve/bm25";
import {
	allFixtureAtoms,
	behaviorAtoms,
	distSysAtoms,
	industryAtoms,
} from "./fixtures/sample-atoms";

const docs = allFixtureAtoms.map((a) => ({ id: a.id, text: atomToText(a) }));

describe("buildBM25Index", () => {
	test("builds index from document array", () => {
		const index = buildBM25Index(docs);
		expect(index.docCount).toBe(docs.length);
		expect(index.avgDocLength).toBeGreaterThan(0);
	});

	test("computes IDF — rare terms have higher IDF than common terms", () => {
		const index = buildBM25Index(docs);
		// "replication" appears in several dist-sys docs
		// "photosynthesis" appears in only 1 doc
		const idfReplication = index.idf.get("replication") ?? 0;
		const idfPhotosynthesis = index.idf.get("photosynthesis") ?? 0;
		expect(idfPhotosynthesis).toBeGreaterThan(idfReplication);
	});
});

describe("queryBM25", () => {
	const index = buildBM25Index(docs);

	test("ranks replication-related atoms highest for 'replication lag'", () => {
		const results = queryBM25(index, "replication lag", 5);
		expect(results.length).toBe(5);
		// Top results should be dist-sys atoms that mention replication lag
		const topIds = results.slice(0, 3).map((r) => r.id);
		const hasDistSys = topIds.some((id) => id.startsWith("dist-"));
		expect(hasDistSys).toBe(true);
	});

	test("ranks industry atoms highest for CJK query '行业生命周期'", () => {
		const results = queryBM25(index, "行业生命周期", 5);
		expect(results.length).toBeGreaterThan(0);
		// Top result should be ind-01 (taxonomy of 行业生命周期)
		expect(results[0]?.id).toBe("ind-01");
	});

	test("returns empty for query with no matching terms", () => {
		const results = queryBM25(index, "xyzzy plugh", 5);
		expect(results).toEqual([]);
	});

	test("handles query terms not in corpus without crashing", () => {
		const results = queryBM25(index, "replication xyzzy", 5);
		// Should still return results for "replication", ignore "xyzzy"
		expect(results.length).toBeGreaterThan(0);
	});

	test("respects top-k limit", () => {
		const results = queryBM25(index, "replication lag", 2);
		expect(results.length).toBe(2);
	});

	test("documents with more matching terms rank higher", () => {
		// "replication lag" has 2 terms; docs matching both should rank higher
		// than docs matching only one
		const results = queryBM25(index, "replication lag", docs.length);
		if (results.length >= 2) {
			const first = results[0];
			const last = results[results.length - 1];
			if (first && last) {
				expect(first.score).toBeGreaterThan(last.score);
			}
		}
	});

	test("scores are positive for matching documents", () => {
		const results = queryBM25(index, "feedback loop habit", 5);
		for (const r of results) {
			expect(r.score).toBeGreaterThan(0);
		}
	});

	test("returns results sorted by descending score", () => {
		const results = queryBM25(index, "penetration rate industry", 10);
		for (let i = 1; i < results.length; i++) {
			const prev = results[i - 1];
			const curr = results[i];
			if (prev && curr) {
				expect(prev.score).toBeGreaterThanOrEqual(curr.score);
			}
		}
	});
});
