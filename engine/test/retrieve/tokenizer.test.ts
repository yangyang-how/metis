import { describe, expect, test } from "bun:test";
import { tokenize, tokenizeWithFrequency } from "../../src/retrieve/tokenizer";

describe("tokenize", () => {
	test("lowercases and splits English text on non-alphanumeric chars", () => {
		const tokens = tokenize("Replication Lag — the delay");
		expect(tokens).toContain("replication");
		expect(tokens).toContain("lag");
		expect(tokens).toContain("delay");
		// should not contain punctuation or empty strings
		expect(tokens.every((t) => t.length > 0)).toBe(true);
		expect(tokens.every((t) => /^[a-z0-9\u4e00-\u9fff]+$/.test(t))).toBe(true);
	});

	test("filters common English stopwords", () => {
		const tokens = tokenize("the delay between a write and its reflection");
		expect(tokens).not.toContain("the");
		expect(tokens).not.toContain("between");
		expect(tokens).not.toContain("a");
		expect(tokens).not.toContain("and");
		expect(tokens).not.toContain("its");
		expect(tokens).toContain("delay");
		expect(tokens).toContain("write");
		expect(tokens).toContain("reflection");
	});

	test("handles CJK text with character bigrams", () => {
		const tokens = tokenize("行业生命周期");
		// "行业生命周期" → ["行业", "业生", "生命", "命周", "周期"]
		expect(tokens).toContain("行业");
		expect(tokens).toContain("生命");
		expect(tokens).toContain("周期");
		expect(tokens.length).toBe(5);
	});

	test("handles mixed EN/CJK text", () => {
		const tokens = tokenize("渗透率 penetration rate 10%");
		// Should have CJK bigrams and English words
		expect(tokens).toContain("渗透");
		expect(tokens).toContain("透率");
		expect(tokens).toContain("penetration");
		expect(tokens).toContain("rate");
		// "10" could be included as a number token
	});

	test("returns empty array for empty string", () => {
		expect(tokenize("")).toEqual([]);
	});

	test("returns empty array for stopwords-only input", () => {
		expect(tokenize("the a an is")).toEqual([]);
	});

	test("handles single CJK character (no bigram possible)", () => {
		const tokens = tokenize("人");
		// Single char — can't form bigram, include as-is
		expect(tokens).toEqual(["人"]);
	});
});

describe("tokenizeWithFrequency", () => {
	test("counts term frequency correctly", () => {
		const freq = tokenizeWithFrequency(
			"replication lag causes replication delay",
		);
		expect(freq.get("replication")).toBe(2);
		expect(freq.get("lag")).toBe(1);
		expect(freq.get("delay")).toBe(1);
	});

	test("counts CJK bigram frequency", () => {
		const freq = tokenizeWithFrequency("行业分析行业");
		// "行业分析行业" → ["行业", "业分", "分析", "析行", "行业"]
		expect(freq.get("行业")).toBe(2);
		expect(freq.get("分析")).toBe(1);
	});
});
