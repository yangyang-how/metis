import { describe, expect, test } from "bun:test";
import {
	estimateTokens,
	fitsInContext,
} from "../../src/comprehend/token-estimator";

describe("estimateTokens", () => {
	test("estimates English text at ~chars/4", () => {
		const text = "Hello world, this is a test sentence with some words."; // 53 chars
		const tokens = estimateTokens(text);
		expect(tokens).toBeGreaterThan(10);
		expect(tokens).toBeLessThan(20);
	});

	test("estimates CJK text at ~chars/2", () => {
		const text = "这是一个中文测试句子用来验证"; // 13 CJK chars
		const tokens = estimateTokens(text);
		expect(tokens).toBeGreaterThan(5);
		expect(tokens).toBeLessThan(10);
	});

	test("handles mixed CJK and English", () => {
		const text = "Hello 你好 World 世界"; // mix of both
		const tokens = estimateTokens(text);
		expect(tokens).toBeGreaterThan(3);
		expect(tokens).toBeLessThan(15);
	});

	test("returns 0 for empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});
});

describe("fitsInContext", () => {
	test("returns true when tokens fit within 80% margin", () => {
		expect(fitsInContext(1000, 2000)).toBe(true); // 1000 < 1600
	});

	test("returns false when tokens exceed 80% margin", () => {
		expect(fitsInContext(1700, 2000)).toBe(false); // 1700 > 1600
	});

	test("accepts custom safety margin", () => {
		expect(fitsInContext(900, 1000, 0.9)).toBe(true); // 900 <= 900
		expect(fitsInContext(950, 1000, 0.9)).toBe(false); // 950 > 900
	});
});
