import { describe, expect, test } from "bun:test";
import { canonicalize, computeContentId, computeDocId } from "../../src/kx/hash";
import type { KXDocument } from "../../src/kx/types";

describe("canonicalize", () => {
	test("sorts keys", () => {
		expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
	});

	test("handles nested objects", () => {
		expect(canonicalize({ z: { b: 1, a: 2 } })).toBe('{"z":{"a":2,"b":1}}');
	});

	test("handles arrays in order", () => {
		expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
	});

	test("handles null", () => {
		expect(canonicalize(null)).toBe("null");
	});

	test("handles strings", () => {
		expect(canonicalize("hello")).toBe('"hello"');
	});

	test("omits undefined values", () => {
		expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
	});
});

describe("content addressing", () => {
	const doc: KXDocument = {
		version: "kx/1.0",
		contentId: "",
		docId: "",
		profile: "casual",
		meta: {
			domains: ["test"],
			sources: [{ id: "s1", type: "book", title: "Book", authors: ["A"] }],
			generatedBy: "metis/0.2",
			generatedAt: "2026-04-15T00:00:00Z",
		},
		units: [
			{
				id: "u1",
				kind: "definition",
				content: "Test.",
				roles: { term: "test" },
				conditions: [],
				confidence: 0.9,
				source: { ref: "s1" },
				domains: ["test"],
			},
		],
		relations: [],
	};

	test("contentId is deterministic", () => {
		const a = computeContentId(doc);
		const b = computeContentId(doc);
		expect(a).toBe(b);
		expect(a).toMatch(/^sha256:/);
	});

	test("contentId ignores generatedAt", () => {
		const doc2 = {
			...doc,
			meta: { ...doc.meta, generatedAt: "2099-01-01T00:00:00Z" },
		};
		expect(computeContentId(doc)).toBe(computeContentId(doc2));
	});

	test("contentId changes with unit content", () => {
		const doc2 = {
			...doc,
			units: [
				{ ...doc.units[0]!, roles: { term: "different" } },
			],
		};
		expect(computeContentId(doc)).not.toBe(computeContentId(doc2));
	});

	test("docId differs from contentId", () => {
		expect(computeDocId(doc)).not.toBe(computeContentId(doc));
	});

	test("docId changes with generatedAt", () => {
		const doc2 = {
			...doc,
			meta: { ...doc.meta, generatedAt: "2099-01-01T00:00:00Z" },
		};
		expect(computeDocId(doc)).not.toBe(computeDocId(doc2));
	});
});
