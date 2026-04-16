import { describe, expect, test } from "bun:test";
import {
	normalizeForSpanMatch,
	verifyAtomSpans,
	verifySpan,
} from "../../src/extract/span-verifier";
import type { AtomProvenance } from "../../src/extract/types";

describe("normalizeForSpanMatch", () => {
	test("collapses whitespace", () => {
		expect(normalizeForSpanMatch("hello   world")).toBe("hello world");
	});

	test("trims", () => {
		expect(normalizeForSpanMatch("  hello  ")).toBe("hello");
	});

	test("normalizes smart quotes", () => {
		expect(normalizeForSpanMatch("\u201CHello\u201D")).toBe('"Hello"');
		expect(normalizeForSpanMatch("\u2018it\u2019s\u2019")).toBe("'it's'");
	});

	test("normalizes em-dashes", () => {
		expect(normalizeForSpanMatch("a\u2014b")).toBe("a-b");
		expect(normalizeForSpanMatch("a\u2013b")).toBe("a-b");
	});

	test("applies NFC normalization", () => {
		const nfd = "caf\u0065\u0301";
		const nfc = "caf\u00E9";
		expect(normalizeForSpanMatch(nfd)).toBe(normalizeForSpanMatch(nfc));
	});
});

describe("verifySpan", () => {
	const section =
		"Never feed honey to a baby under one year old. It contains spores that can cause infant botulism.";

	test("finds exact substring", () => {
		const result = verifySpan({ text: "honey to a baby" }, section);
		expect(result.found).toBe(true);
	});

	test("finds span with whitespace differences", () => {
		const sectionWithSpaces =
			"Never feed  honey   to a baby under one year old.";
		const result = verifySpan(
			{ text: "honey to a baby" },
			sectionWithSpaces,
		);
		expect(result.found).toBe(true);
	});

	test("rejects text not in section", () => {
		const result = verifySpan({ text: "sugar is safe" }, section);
		expect(result.found).toBe(false);
	});

	test("handles smart quotes in source matching straight in span", () => {
		const sourceWithSmartQuotes =
			'The author said \u201Cnever feed honey\u201D to infants.';
		const result = verifySpan(
			{ text: '"never feed honey"' },
			sourceWithSmartQuotes,
		);
		expect(result.found).toBe(true);
	});

	test("handles em-dash in source matching hyphen in span", () => {
		const sourceWithDash = "Honey\u2014never for infants.";
		const result = verifySpan(
			{ text: "Honey-never for infants." },
			sourceWithDash,
		);
		expect(result.found).toBe(true);
	});

	test("returns computedStart", () => {
		const result = verifySpan({ text: "honey" }, section);
		expect(result.found).toBe(true);
		expect(typeof result.computedStart).toBe("number");
	});

	test("rejects empty span", () => {
		const result = verifySpan({ text: "" }, section);
		expect(result.found).toBe(false);
	});
});

describe("verifyAtomSpans", () => {
	const sectionText =
		"Never feed honey to a baby under one year old. It contains spores that can cause infant botulism.";

	test("passes when all spans found", () => {
		const provenance: AtomProvenance = {
			quotedSpans: [{ text: "Never feed honey to a baby under one year old." }],
			roleSpans: {
				subject: { text: "a baby under one year old" },
				risk: { text: "honey" },
			},
			extraction: {
				method: "llm",
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				promptVersion: "abc",
				extractedAt: "2026-04-15T00:00:00Z",
			},
		};
		const result = verifyAtomSpans(provenance, sectionText);
		expect(result.valid).toBe(true);
		expect(result.failures).toHaveLength(0);
	});

	test("fails when quotedSpan not found", () => {
		const provenance: AtomProvenance = {
			quotedSpans: [{ text: "This text is not in the section at all." }],
			extraction: {
				method: "llm",
				provider: "kimi",
				model: "k2.5",
				promptVersion: "def",
				extractedAt: "2026-04-15T00:00:00Z",
			},
		};
		const result = verifyAtomSpans(provenance, sectionText);
		expect(result.valid).toBe(false);
		expect(result.failures[0]!.field).toBe("quotedSpans[0]");
		expect(result.failures[0]!.reason).toBe("not_found");
	});

	test("fails when roleSpan not found", () => {
		const provenance: AtomProvenance = {
			quotedSpans: [{ text: "honey" }],
			roleSpans: {
				subject: { text: "nonexistent phrase" },
			},
			extraction: {
				method: "human",
				author: "Sam",
				extractedAt: "2026-04-15T00:00:00Z",
			},
		};
		const result = verifyAtomSpans(provenance, sectionText);
		expect(result.valid).toBe(false);
		expect(result.failures[0]!.field).toBe("roleSpans.subject");
	});

	test("passes with no roleSpans", () => {
		const provenance: AtomProvenance = {
			quotedSpans: [{ text: "infant botulism" }],
			extraction: {
				method: "algorithmic",
				tool: "metis-extract",
				version: "0.1",
				extractedAt: "2026-04-15T00:00:00Z",
			},
		};
		const result = verifyAtomSpans(provenance, sectionText);
		expect(result.valid).toBe(true);
	});
});
