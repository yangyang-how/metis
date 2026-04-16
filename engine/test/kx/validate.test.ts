import { describe, expect, test } from "bun:test";
import { computeContentId, computeDocId } from "../../src/kx/hash";
import { validateKX } from "../../src/kx/validate";
import type { KXDocument } from "../../src/kx/types";

function makeDoc(overrides?: Partial<KXDocument>): KXDocument {
	const base: KXDocument = {
		version: "kx/1.0",
		contentId: "",
		docId: "",
		profile: "casual",
		meta: {
			domains: ["test"],
			sources: [
				{
					id: "src-1",
					type: "book",
					title: "Test Book",
					authors: ["Author"],
				},
			],
			generatedBy: "metis/0.2",
			generatedAt: "2026-04-15T00:00:00Z",
		},
		units: [
			{
				id: "u-1",
				kind: "definition",
				content: "A test is a test.",
				roles: { term: "test" },
				conditions: [],
				confidence: 0.9,
				source: { ref: "src-1" },
				domains: ["test"],
			},
		],
		relations: [],
		...overrides,
	};
	base.contentId = computeContentId(base);
	base.docId = computeDocId(base);
	return base;
}

describe("validateKX", () => {
	test("valid casual doc passes", () => {
		const doc = makeDoc();
		const result = validateKX(doc);
		expect(result.valid).toBe(true);
		expect(result.violations).toHaveLength(0);
	});

	test("rejects bad version", () => {
		const doc = makeDoc();
		(doc as unknown as Record<string, unknown>).version = "kx/2.0";
		const result = validateKX(doc);
		expect(result.valid).toBe(false);
		expect(result.violations.some((v) => v.rule === "version")).toBe(true);
	});

	test("rejects minProfile below threshold", () => {
		const doc = makeDoc({ profile: "casual" });
		const result = validateKX(doc, { minProfile: "strict" });
		expect(result.valid).toBe(false);
		expect(result.violations.some((v) => v.rule === "minProfile")).toBe(true);
	});

	test("detects broken source ref", () => {
		const doc = makeDoc();
		doc.units[0]!.source.ref = "nonexistent";
		doc.contentId = computeContentId(doc);
		doc.docId = computeDocId(doc);
		const result = validateKX(doc);
		expect(result.valid).toBe(false);
		expect(result.violations.some((v) => v.rule === "referentialIntegrity")).toBe(
			true,
		);
	});

	test("detects tampered contentId", () => {
		const doc = makeDoc();
		doc.contentId = "sha256:wrong";
		const result = validateKX(doc);
		expect(result.valid).toBe(false);
		expect(result.violations.some((v) => v.rule === "contentAddress")).toBe(true);
	});

	test("standard requires provenance", () => {
		const doc = makeDoc({ profile: "standard" });
		doc.contentId = computeContentId(doc);
		doc.docId = computeDocId(doc);
		const result = validateKX(doc);
		expect(result.valid).toBe(false);
		expect(
			result.violations.some((v) => v.rule === "profileRequired"),
		).toBe(true);
	});

	test("strict requires language on units", () => {
		const doc = makeDoc({ profile: "strict" });
		doc.meta.sources[0]!.language = "en";
		doc.meta.sources[0]!.sourceId = "uuid-1";
		doc.meta.sources[0]!.contentHash = "sha256:abc";
		doc.units[0]!.provenance = {
			quotedSpans: [{ text: "a test" }],
			roleTypes: { term: "verbatim" },
			roleSpans: { term: { text: "test" } },
			extraction: {
				method: "llm",
				provider: "kimi",
				model: "k2.5",
				promptVersion: "v1",
				extractedAt: "2026-04-15T00:00:00Z",
			},
		};
		doc.contentId = computeContentId(doc);
		doc.docId = computeDocId(doc);
		const result = validateKX(doc);
		expect(result.violations.some((v) => v.rule === "strictLanguage")).toBe(
			true,
		);
	});

	test("strict rejects paraphrased roles", () => {
		const doc = makeDoc({ profile: "strict" });
		doc.meta.sources[0]!.language = "en";
		doc.meta.sources[0]!.sourceId = "uuid-1";
		doc.meta.sources[0]!.contentHash = "sha256:abc";
		doc.units[0]!.language = "en";
		doc.units[0]!.provenance = {
			quotedSpans: [{ text: "a test" }],
			roleTypes: { term: "paraphrase" },
			extraction: {
				method: "llm",
				provider: "kimi",
				model: "k2.5",
				promptVersion: "v1",
				extractedAt: "2026-04-15T00:00:00Z",
			},
		};
		doc.contentId = computeContentId(doc);
		doc.docId = computeDocId(doc);
		const result = validateKX(doc);
		expect(
			result.violations.some((v) => v.rule === "strictVerbatim"),
		).toBe(true);
	});
});
