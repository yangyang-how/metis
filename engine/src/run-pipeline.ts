/**
 * Pipeline runner — parse, comprehend, and extract from an EPUB.
 *
 * Usage:
 *   bun run src/run-pipeline.ts <path-to-epub> [options]
 *
 * Options:
 *   --comprehend-provider anthropic|kimi  (default: anthropic)
 *   --comprehend-model <model>            (default: claude-sonnet-4-20250514)
 *   --extract-provider anthropic|kimi     (default: kimi)
 *   --extract-model <model>               (default: kimi-k2-0711-preview)
 *   --skip-extract                         skip extraction stage
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — for Anthropic provider
 *   KIMI_API_KEY       — for Kimi provider
 *
 * Progress to stderr, full JSON to stdout.
 */
import { comprehend } from "./comprehend/index";
import { normalizeChapters } from "./comprehend/structure-inference";
import { createRegistry, extract } from "./extract/index";
import { createProvider, withRetry } from "./llm/provider";
import type { ProviderConfig } from "./llm/types";
import { parse } from "./parse/index";

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	let epubPath = "";
	let comprehendProvider = "anthropic";
	let comprehendModel = "claude-sonnet-4-20250514";
	let extractProvider = "kimi";
	let extractModel = "kimi-k2-0711-preview";
	let skipExtract = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--comprehend-provider") {
			comprehendProvider = args[++i] ?? comprehendProvider;
		} else if (arg === "--comprehend-model") {
			comprehendModel = args[++i] ?? comprehendModel;
		} else if (arg === "--extract-provider") {
			extractProvider = args[++i] ?? extractProvider;
		} else if (arg === "--extract-model") {
			extractModel = args[++i] ?? extractModel;
		} else if (arg === "--skip-extract") {
			skipExtract = true;
		} else if (!arg?.startsWith("--")) {
			epubPath = arg ?? "";
		}
	}

	return {
		epubPath,
		comprehendProvider,
		comprehendModel,
		extractProvider,
		extractModel,
		skipExtract,
	};
}

async function main() {
	const config = parseArgs(process.argv);

	if (!config.epubPath) {
		console.error(
			"Usage: bun run src/run-pipeline.ts <path-to-epub> [options]",
		);
		console.error("");
		console.error("Options:");
		console.error(
			"  --comprehend-provider anthropic|kimi  (default: anthropic)",
		);
		console.error(
			"  --comprehend-model <model>            (default: claude-sonnet-4-20250514)",
		);
		console.error("  --extract-provider anthropic|kimi     (default: kimi)");
		console.error(
			"  --extract-model <model>               (default: kimi-k2-0711-preview)",
		);
		console.error("  --skip-extract                        skip extraction");
		console.error("");
		console.error("Environment: ANTHROPIC_API_KEY, KIMI_API_KEY");
		process.exit(1);
	}

	// === Phase 1: Parse ===
	console.error(`[parse] Parsing ${config.epubPath}...`);
	const tree = await parse({
		filePath: config.epubPath,
		options: { extractImages: false },
	});
	console.error(
		`[parse] Done. ${tree.chapters.length} chapters, "${tree.metadata.title}"`,
	);

	// === Phase 2: Comprehend ===
	const comprehendProviderConfig: ProviderConfig = {
		provider: config.comprehendProvider as ProviderConfig["provider"],
		model: config.comprehendModel,
	};
	const comprehendLLM = withRetry(createProvider(comprehendProviderConfig));

	console.error(
		`[comprehend] Starting with ${config.comprehendProvider}/${config.comprehendModel}...`,
	);
	console.error(
		`[comprehend] ${tree.chapters.length} chapters to process (sequential)`,
	);

	const comprehendResult = await comprehend({
		documentTree: tree,
		provider: comprehendLLM,
	});

	console.error(
		`[comprehend] Done. ${comprehendResult.chapterMaps.length} maps, ${comprehendResult.usage.failedChapters.length} failed`,
	);

	if (config.skipExtract) {
		console.error("[extract] Skipped (--skip-extract)");
		console.log(JSON.stringify(comprehendResult, null, 2));
		return;
	}

	// === Phase 3: Extract ===
	const extractProviderConfig: ProviderConfig = {
		provider: config.extractProvider as ProviderConfig["provider"],
		model: config.extractModel,
	};
	const extractLLM = withRetry(createProvider(extractProviderConfig));
	const registry = createRegistry();
	const normalizedChapters = normalizeChapters(tree);

	console.error(
		`[extract] Starting with ${config.extractProvider}/${config.extractModel}...`,
	);

	let totalAtoms = 0;
	let totalExtractCalls = 0;
	let totalExtractInput = 0;
	let totalExtractOutput = 0;
	const allAtoms: unknown[] = [];
	const allProposedTypes: unknown[] = [];

	for (const chapter of normalizedChapters) {
		const map = comprehendResult.chapterMaps.find(
			(m) => m.chapterId === chapter.id,
		);
		if (!map) continue;

		console.error(`[extract] Chapter: ${chapter.title.slice(0, 50)}...`);

		const extractResult = await extract({
			chapter,
			comprehensionMap: map,
			bookMetadata: tree.metadata,
			registry,
			provider: extractLLM,
		});

		totalAtoms += extractResult.atoms.length;
		totalExtractCalls += extractResult.usage.callCount;
		totalExtractInput += extractResult.usage.inputTokens;
		totalExtractOutput += extractResult.usage.outputTokens;
		allAtoms.push(...extractResult.atoms);
		allProposedTypes.push(...extractResult.proposedFrameTypes);

		console.error(
			`  → ${extractResult.atoms.length} atoms, ${extractResult.skippedSections.length} skipped, ${extractResult.flaggedAtoms.length} flagged`,
		);
	}

	// === Report ===
	console.error("");
	console.error("=== Results ===");
	console.error(
		`Comprehend: ${comprehendResult.chapterMaps.length} chapters, ${comprehendResult.usage.callCount} calls, ${comprehendResult.usage.totalInputTokens} in / ${comprehendResult.usage.totalOutputTokens} out`,
	);
	console.error(
		`Extract: ${totalAtoms} atoms, ${totalExtractCalls} calls, ${totalExtractInput} in / ${totalExtractOutput} out`,
	);
	console.error(`Domain types proposed: ${allProposedTypes.length}`);
	console.error(
		`Registry: ${registry.getAll().length} types (${registry.getCoreTypes().length} core + ${registry.getAll().length - registry.getCoreTypes().length} domain)`,
	);

	// Full result to stdout
	const output = {
		comprehension: comprehendResult,
		extraction: {
			atoms: allAtoms,
			proposedFrameTypes: allProposedTypes,
			usage: {
				inputTokens: totalExtractInput,
				outputTokens: totalExtractOutput,
				callCount: totalExtractCalls,
			},
		},
	};
	console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
	console.error("Pipeline failed:", err);
	process.exit(1);
});
