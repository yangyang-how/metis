import { describe, expect, test } from "bun:test";
import { assignContentIds, computeAtomId } from "../../src/extract/atom-id";
import type { CandidateAtom } from "../../src/extract/types";

describe("computeAtomId", () => {
	test("same content produces same ID", () => {
		const a = computeAtomId({
			frame: "definition",
			roles: { term: "honey", meaning: "sweet substance" },
			conditions: ["general"],
			source: { sourceId: "abc123" },
		});
		const b = computeAtomId({
			frame: "definition",
			roles: { term: "honey", meaning: "sweet substance" },
			conditions: ["general"],
			source: { sourceId: "abc123" },
		});
		expect(a).toBe(b);
	});

	test("different roles produce different ID", () => {
		const a = computeAtomId({
			frame: "definition",
			roles: { term: "honey", meaning: "sweet substance" },
			conditions: [],
			source: { sourceId: "abc123" },
		});
		const b = computeAtomId({
			frame: "definition",
			roles: { term: "sugar", meaning: "sweet substance" },
			conditions: [],
			source: { sourceId: "abc123" },
		});
		expect(a).not.toBe(b);
	});

	test("different conditions produce different ID", () => {
		const a = computeAtomId({
			frame: "heuristic",
			roles: { action: "avoid honey" },
			conditions: ["infants under 1 year"],
			source: { sourceId: "abc123" },
		});
		const b = computeAtomId({
			frame: "heuristic",
			roles: { action: "avoid honey" },
			conditions: ["immunocompromised children"],
			source: { sourceId: "abc123" },
		});
		expect(a).not.toBe(b);
	});

	test("different source produces different ID", () => {
		const a = computeAtomId({
			frame: "definition",
			roles: { term: "x" },
			conditions: [],
			source: { sourceId: "source-a" },
		});
		const b = computeAtomId({
			frame: "definition",
			roles: { term: "x" },
			conditions: [],
			source: { sourceId: "source-b" },
		});
		expect(a).not.toBe(b);
	});

	test("role key order does not affect ID", () => {
		const a = computeAtomId({
			frame: "causal",
			roles: { cause: "A", effect: "B" },
			conditions: [],
			source: { sourceId: "s1" },
		});
		const b = computeAtomId({
			frame: "causal",
			roles: { effect: "B", cause: "A" },
			conditions: [],
			source: { sourceId: "s1" },
		});
		expect(a).toBe(b);
	});

	test("condition order does not affect ID", () => {
		const a = computeAtomId({
			frame: "heuristic",
			roles: { action: "do X" },
			conditions: ["web", "mobile"],
			source: { sourceId: "s1" },
		});
		const b = computeAtomId({
			frame: "heuristic",
			roles: { action: "do X" },
			conditions: ["mobile", "web"],
			source: { sourceId: "s1" },
		});
		expect(a).toBe(b);
	});

	test("ID is a 24-char hex string", () => {
		const id = computeAtomId({
			frame: "definition",
			roles: { term: "test" },
			conditions: [],
			source: { sourceId: "s1" },
		});
		expect(id).toMatch(/^[a-f0-9]{24}$/);
	});
});

describe("assignContentIds", () => {
	const baseAtom: CandidateAtom = {
		id: "old-positional-id",
		frame: "definition",
		roles: { term: "test" },
		conditions: [],
		confidence: 0.9,
		source: {
			title: "Book",
			authors: ["Author"],
			chapterId: "ch1",
			sectionId: "s1",
		},
		domain: [],
		examples: [],
		flags: [],
	};

	test("preserves positional ID when sourceId absent", () => {
		const result = assignContentIds([baseAtom]);
		expect(result[0]!.id).toBe("old-positional-id");
	});

	test("replaces ID when sourceId present", () => {
		const atom = {
			...baseAtom,
			source: { ...baseAtom.source, sourceId: "uuid-123" },
		};
		const result = assignContentIds([atom]);
		expect(result[0]!.id).not.toBe("old-positional-id");
		expect(result[0]!.id).toMatch(/^[a-f0-9]{24}$/);
	});
});
