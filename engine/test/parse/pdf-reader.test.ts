import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, test, beforeAll } from "bun:test";
import { parsePdf } from "../../src/parse/pdf-reader";

// We can't ship real PDFs as fixtures (binary, large).
// Test against any PDF found on the system, or skip gracefully.
const SAMPLE_PDF =
	"/Users/shuang/adk-samples/python/agents/medical-pre-authorization/tests/sample_data/patient_medical_diagnosis.pdf";
const hasSample = existsSync(SAMPLE_PDF);

describe("parsePdf", () => {
	test.skipIf(!hasSample)("parses a real PDF into DocumentTree", async () => {
		const tree = await parsePdf(SAMPLE_PDF);

		expect(tree.metadata.title).toBeDefined();
		expect(tree.metadata.title.length).toBeGreaterThan(0);
		expect(tree.chapters.length).toBeGreaterThan(0);

		// Should have at least one section with content
		const allSections = tree.chapters.flatMap((ch) => ch.sections);
		expect(allSections.length).toBeGreaterThan(0);

		const allBlocks = allSections.flatMap((s) => s.content);
		expect(allBlocks.length).toBeGreaterThan(0);
	});

	test.skipIf(!hasSample)(
		"detects sections from heading-like patterns",
		async () => {
			const tree = await parsePdf(SAMPLE_PDF);

			// The medical PDF has structured sections
			const sectionTitles = tree.chapters
				.flatMap((ch) => ch.sections)
				.map((s) => s.title);
			expect(sectionTitles.length).toBeGreaterThan(1);
		},
	);

	test.skipIf(!hasSample)("produces paragraph content blocks", async () => {
		const tree = await parsePdf(SAMPLE_PDF);

		const blocks = tree.chapters
			.flatMap((ch) => ch.sections)
			.flatMap((s) => s.content);
		const paragraphs = blocks.filter((b) => b.type === "paragraph");
		expect(paragraphs.length).toBeGreaterThan(0);
	});
});
