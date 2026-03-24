import { comprehend } from "./comprehend/index";
import { createProvider, withRetry } from "./llm/provider";
/**
 * Pipeline runner — parse an EPUB and comprehend it with a real LLM.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run src/run-pipeline.ts <path-to-epub> [model]
 *
 * Example:
 *   ANTHROPIC_API_KEY=sk-... bun run src/run-pipeline.ts ~/books/ddia.epub claude-sonnet-4-20250514
 *
 * Outputs the ComprehensionResult as JSON to stdout.
 * Progress updates go to stderr so they don't pollute the JSON output.
 */
import { parse } from "./parse/index";

async function main() {
	const args = process.argv.slice(2);
	const epubPath = args[0];
	const model = args[1] ?? "claude-sonnet-4-20250514";

	if (!epubPath) {
		console.error("Usage: bun run src/run-pipeline.ts <path-to-epub> [model]");
		console.error("  model defaults to claude-sonnet-4-20250514");
		console.error("");
		console.error("Set ANTHROPIC_API_KEY environment variable before running.");
		process.exit(1);
	}

	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
		console.error("Export it before running:");
		console.error("  export ANTHROPIC_API_KEY=sk-ant-...");
		process.exit(1);
	}

	// === Phase 1: Parse ===
	console.error(`[parse] Parsing ${epubPath}...`);
	const tree = await parse({
		filePath: epubPath,
		options: { extractImages: false },
	});
	console.error(
		`[parse] Done. ${tree.chapters.length} chapters, "${tree.metadata.title}"`,
	);

	// === Phase 2: Comprehend ===
	const provider = withRetry(
		createProvider({
			provider: "anthropic",
			model,
		}),
	);

	console.error(`[comprehend] Starting comprehension with ${model}...`);
	console.error(
		`[comprehend] ${tree.chapters.length} chapters to process (sequential)`,
	);

	const result = await comprehend({
		documentTree: tree,
		provider,
	});

	// === Report ===
	console.error("");
	console.error("=== Results ===");
	console.error(`Chapters comprehended: ${result.chapterMaps.length}`);
	console.error(
		`Failed chapters: ${result.usage.failedChapters.length > 0 ? result.usage.failedChapters.join(", ") : "none"}`,
	);
	console.error(`Total LLM calls: ${result.usage.callCount}`);
	console.error(
		`Total tokens: ${result.usage.totalInputTokens} in / ${result.usage.totalOutputTokens} out`,
	);
	console.error(
		`Cross-cutting themes: ${result.bookSynthesis.crossCuttingThemes.length}`,
	);
	console.error(
		`Entity index entries: ${result.bookSynthesis.entityIndex.length}`,
	);
	console.error("");

	// Print chapter summaries to stderr for quick review
	for (const map of result.chapterMaps) {
		console.error(
			`  [${map.chapterType}] ${map.chapterId}: ${map.summary.slice(0, 100)}`,
		);
		console.error(
			`    Structures: ${map.structures.map((s) => s.name).join(", ") || "none"}`,
		);
		console.error(`    Sections analyzed: ${map.sectionAnalyses.length}`);
	}

	// Full JSON to stdout (can be piped to a file)
	console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.error("Pipeline failed:", err);
	process.exit(1);
});
