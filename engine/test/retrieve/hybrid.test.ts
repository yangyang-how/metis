import { describe, expect, test } from "bun:test";
import { type RankedList, fuseResults } from "../../src/retrieve/hybrid";

describe("fuseResults", () => {
	test("fuses two ranked lists using RRF", () => {
		const lists: RankedList[] = [
			{
				method: "bm25",
				results: [
					{ id: "a", score: 5.0 },
					{ id: "b", score: 3.0 },
					{ id: "c", score: 1.0 },
				],
			},
			{
				method: "vector",
				results: [
					{ id: "b", score: 0.95 },
					{ id: "a", score: 0.8 },
					{ id: "d", score: 0.7 },
				],
			},
		];

		const fused = fuseResults(lists, 10);
		expect(fused.length).toBe(4); // a, b, c, d

		// "b" is #2 in bm25, #1 in vector → RRF = 1/62 + 1/61
		// "a" is #1 in bm25, #2 in vector → RRF = 1/61 + 1/62
		// They should be very close, with "a" and "b" at the top
		const topIds = fused.slice(0, 2).map((r) => r.id);
		expect(topIds).toContain("a");
		expect(topIds).toContain("b");
	});

	test("atom ranked highly in both lists outranks atom in only one", () => {
		const lists: RankedList[] = [
			{
				method: "bm25",
				results: [
					{ id: "both", score: 5.0 },
					{ id: "bm25-only", score: 3.0 },
				],
			},
			{
				method: "vector",
				results: [
					{ id: "both", score: 0.95 },
					{ id: "vector-only", score: 0.8 },
				],
			},
		];

		const fused = fuseResults(lists, 10);
		expect(fused[0]?.id).toBe("both");
		// "both" should score higher than either single-method atom
		const bm25Only = fused.find((r) => r.id === "bm25-only");
		expect(bm25Only).toBeDefined();
		expect(fused[0]?.score).toBeGreaterThan(bm25Only?.score ?? 0);
	});

	test("handles atoms appearing in only one list", () => {
		const lists: RankedList[] = [
			{
				method: "bm25",
				results: [{ id: "only-bm25", score: 5.0 }],
			},
			{
				method: "vector",
				results: [{ id: "only-vector", score: 0.95 }],
			},
		];

		const fused = fuseResults(lists, 10);
		expect(fused.length).toBe(2);
		const ids = fused.map((r) => r.id);
		expect(ids).toContain("only-bm25");
		expect(ids).toContain("only-vector");
	});

	test("handles empty lists", () => {
		expect(fuseResults([], 10)).toEqual([]);
		expect(fuseResults([{ method: "bm25", results: [] }], 10)).toEqual([]);
	});

	test("handles single-method mode", () => {
		const lists: RankedList[] = [
			{
				method: "bm25",
				results: [
					{ id: "a", score: 5.0 },
					{ id: "b", score: 3.0 },
				],
			},
		];

		const fused = fuseResults(lists, 10);
		expect(fused.length).toBe(2);
		expect(fused[0]?.id).toBe("a");
		expect(fused[1]?.id).toBe("b");
	});

	test("respects top-k after fusion", () => {
		const lists: RankedList[] = [
			{
				method: "bm25",
				results: [
					{ id: "a", score: 5.0 },
					{ id: "b", score: 3.0 },
					{ id: "c", score: 1.0 },
				],
			},
		];

		const fused = fuseResults(lists, 2);
		expect(fused.length).toBe(2);
	});

	test("preserves per-method rank information", () => {
		const lists: RankedList[] = [
			{
				method: "bm25",
				results: [
					{ id: "a", score: 5.0 },
					{ id: "b", score: 3.0 },
				],
			},
			{
				method: "vector",
				results: [
					{ id: "b", score: 0.95 },
					{ id: "a", score: 0.8 },
				],
			},
		];

		const fused = fuseResults(lists, 10);
		const atomA = fused.find((r) => r.id === "a");
		const atomB = fused.find((r) => r.id === "b");
		expect(atomA).toBeDefined();
		expect(atomB).toBeDefined();
		if (!atomA || !atomB) return;
		expect(atomA.ranks.bm25).toBe(1);
		expect(atomA.ranks.vector).toBe(2);
		expect(atomB.ranks.bm25).toBe(2);
		expect(atomB.ranks.vector).toBe(1);
	});
});
