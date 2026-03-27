import { describe, expect, test } from "bun:test";
import {
	filterChapters,
	isSkippableChapter,
} from "../../src/comprehend/content-filter";
import type { NormalizedChapter } from "../../src/comprehend/types";

function makeChapter(title: string, blocks = 10): NormalizedChapter {
	return {
		id: title,
		title,
		order: 0,
		sections: [
			{
				id: "s1",
				title,
				level: 1,
				content: Array.from({ length: blocks }, (_, i) => ({
					type: "paragraph" as const,
					text: `Paragraph ${i}`,
				})),
				sections: [],
			},
		],
		metadata: {
			totalBlockCount: blocks,
			hasImages: false,
			estimatedTokens: blocks * 50,
		},
	};
}

describe("isSkippableChapter", () => {
	test("skips Chinese front matter", () => {
		expect(isSkippableChapter(makeChapter("版权页"))).toBe(true);
		expect(isSkippableChapter(makeChapter("目　录"))).toBe(true);
		expect(isSkippableChapter(makeChapter("目次"))).toBe(true);
		expect(isSkippableChapter(makeChapter("索引"))).toBe(true);
		expect(isSkippableChapter(makeChapter("参考书目"))).toBe(true);
		expect(isSkippableChapter(makeChapter("致谢"))).toBe(true);
		expect(isSkippableChapter(makeChapter("【作者简介】"))).toBe(true);
		expect(isSkippableChapter(makeChapter("版权信息"))).toBe(true);
		expect(isSkippableChapter(makeChapter("版权声明"))).toBe(true);
		expect(isSkippableChapter(makeChapter("赞誉"))).toBe(true);
	});

	test("skips English front matter", () => {
		expect(isSkippableChapter(makeChapter("COPYRIGHT PAGE"))).toBe(true);
		expect(isSkippableChapter(makeChapter("TITLE PAGE"))).toBe(true);
		expect(isSkippableChapter(makeChapter("Index"))).toBe(true);
		expect(isSkippableChapter(makeChapter("ACKNOWLEDGMENTS"))).toBe(true);
		expect(isSkippableChapter(makeChapter("ABOUT THE AUTHOR"))).toBe(true);
		expect(isSkippableChapter(makeChapter("Glossary"))).toBe(true);
		expect(isSkippableChapter(makeChapter("ANNOTATED BIBLIOGRAPHY"))).toBe(
			true,
		);
	});

	test("keeps real content chapters", () => {
		expect(isSkippableChapter(makeChapter("第一章 导论"))).toBe(false);
		expect(isSkippableChapter(makeChapter("1: THE MADE AND THE BORN"))).toBe(
			false,
		);
		expect(isSkippableChapter(makeChapter("前言　行为设计的价值"))).toBe(false);
		expect(isSkippableChapter(makeChapter("Chapter 1: Introduction"))).toBe(
			false,
		);
	});

	test("skips tiny chapters with single section", () => {
		expect(isSkippableChapter(makeChapter("Something", 3))).toBe(true);
		expect(isSkippableChapter(makeChapter("Something", 10))).toBe(false);
	});
});

describe("filterChapters", () => {
	test("separates content from front/back matter", () => {
		const chapters = [
			makeChapter("版权页"),
			makeChapter("第一章 导论"),
			makeChapter("第二章 方法论"),
			makeChapter("索引"),
		];
		const { content, skipped } = filterChapters(chapters);

		expect(content).toHaveLength(2);
		expect(skipped).toHaveLength(2);
		expect(content[0]?.title).toBe("第一章 导论");
	});
});
