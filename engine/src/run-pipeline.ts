/**
 * Pipeline runner — parse, comprehend, extract, and integrate from an EPUB.
 *
 * Usage:
 *   bun run src/run-pipeline.ts <path-to-epub> [options]
 *
 * Options:
 *   --comprehend-provider anthropic|kimi  (default: kimi)
 *   --comprehend-model <model>            (default: kimi-k2-0711-preview)
 *   --extract-provider anthropic|kimi     (default: kimi)
 *   --extract-model <model>               (default: kimi-k2-0711-preview)
 *   --integrate-provider anthropic|kimi   (default: kimi)
 *   --integrate-model <model>             (default: kimi-k2-0711-preview)
 *   --embedding-model <model>             (default: text-embedding-3-large)
 *   --graph-dir <path>                    (default: engine/graph)
 *   --skip-extract                        skip extraction stage
 *   --skip-integrate                      skip integration stage
 *   --rebuild-graph                       wipe graph and rebuild
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — for Anthropic provider
 *   KIMI_API_KEY       — for Kimi provider
 *   OPENAI_API_KEY     — for OpenAI embeddings
 *
 * Progress to stderr, full JSON to stdout.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCheckpointManager, formatCheckpointStatus } from "./checkpoint";
import { comprehend } from "./comprehend/index";
import { normalizeChapters } from "./comprehend/structure-inference";
import { createRegistry, extract } from "./extract/index";
import type { CandidateAtom } from "./extract/types";
import { integrate } from "./integrate/index";
import type { KnowledgeGraph } from "./integrate/types";
import { createOpenAIEmbeddingProvider } from "./llm/openai-embedding";
import { createProvider, withRetry } from "./llm/provider";
import type { ProviderConfig } from "./llm/types";
import { parse } from "./parse/index";

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	let epubPath = "";
	let comprehendProvider = "kimi";
	let comprehendModel = "kimi-k2-0711-preview";
	let extractProvider = "kimi";
	let extractModel = "kimi-k2-0711-preview";
	let integrateProvider = "kimi";
	let integrateModel = "kimi-k2-0711-preview";
	let embeddingModel = "text-embedding-3-large";
	let graphDir = join(new URL(".", import.meta.url).pathname, "../graph");
	let skipExtract = false;
	let skipIntegrate = false;
	let rebuildGraph = false;
	let resume = false;
	let checkpointStatus = false;

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
		} else if (arg === "--integrate-provider") {
			integrateProvider = args[++i] ?? integrateProvider;
		} else if (arg === "--integrate-model") {
			integrateModel = args[++i] ?? integrateModel;
		} else if (arg === "--embedding-model") {
			embeddingModel = args[++i] ?? embeddingModel;
		} else if (arg === "--graph-dir") {
			graphDir = args[++i] ?? graphDir;
		} else if (arg === "--skip-extract") {
			skipExtract = true;
		} else if (arg === "--skip-integrate") {
			skipIntegrate = true;
		} else if (arg === "--rebuild-graph") {
			rebuildGraph = true;
		} else if (arg === "--resume") {
			resume = true;
		} else if (arg === "--checkpoint-status") {
			checkpointStatus = true;
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
		integrateProvider,
		integrateModel,
		embeddingModel,
		graphDir,
		skipExtract,
		skipIntegrate,
		rebuildGraph,
		resume,
		checkpointStatus,
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
		console.error("  --comprehend-provider anthropic|kimi  (default: kimi)");
		console.error("  --extract-provider anthropic|kimi     (default: kimi)");
		console.error("  --integrate-provider anthropic|kimi   (default: kimi)");
		console.error(
			"  --embedding-model <model>             (default: text-embedding-3-large)",
		);
		console.error(
			"  --graph-dir <path>                    (default: engine/graph)",
		);
		console.error("  --skip-extract                        skip extraction");
		console.error("  --skip-integrate                      skip integration");
		console.error(
			"  --rebuild-graph                       wipe and rebuild graph",
		);
		console.error(
			"  --resume                              resume from last checkpoint",
		);
		console.error(
			"  --checkpoint-status                   show checkpoint status",
		);
		console.error("");
		console.error(
			"Environment: ANTHROPIC_API_KEY, KIMI_API_KEY, OPENAI_API_KEY",
		);
		process.exit(1);
	}

	// --- Checkpoint setup ---
	const bookSlug = config.epubPath
		.replace(/^.*[\\/]/, "")
		.replace(/\.epub$/i, "")
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-");
	const checkpointDir = join(config.graphDir, ".checkpoints");
	const checkpoint = createCheckpointManager(bookSlug, checkpointDir);

	if (config.rebuildGraph) {
		checkpoint.clear();
	}

	// --- Checkpoint status ---
	if (config.checkpointStatus) {
		const meta = checkpoint.getMeta();
		if (meta) {
			console.error(formatCheckpointStatus(meta));
		} else {
			console.error(`No checkpoint found for "${bookSlug}"`);
		}
		return;
	}

	checkpoint.setConfig({
		comprehendProvider: config.comprehendProvider,
		comprehendModel: config.comprehendModel,
		extractProvider: config.extractProvider,
		extractModel: config.extractModel,
	});

	const resumePoint = config.resume ? checkpoint.getResumePoint() : null;
	if (config.resume && resumePoint) {
		console.error(`[checkpoint] Resuming "${bookSlug}" from ${resumePoint}`);
	}

	// === Phase 1: Parse ===
	let tree: Awaited<ReturnType<typeof parse>>;

	if (config.resume && resumePoint !== "parse" && checkpoint.load("parse")) {
		tree = checkpoint.load("parse") as typeof tree;
		console.error(
			`[parse] Loaded from checkpoint (${tree.chapters.length} chapters)`,
		);
	} else {
		const parseStart = Date.now();
		console.error(`[parse] Parsing ${config.epubPath}...`);
		tree = await parse({
			filePath: config.epubPath,
			options: { extractImages: false },
		});
		console.error(
			`[parse] Done. ${tree.chapters.length} chapters, "${tree.metadata.title}"`,
		);
		checkpoint.save("parse", tree);
		checkpoint.updateStage("parse", {
			status: "completed",
			completedAt: new Date().toISOString(),
			durationMs: Date.now() - parseStart,
		});
	}

	// === Phase 2: Comprehend ===
	const shouldSkipComprehend =
		config.resume &&
		resumePoint !== "parse" &&
		resumePoint !== "comprehend" &&
		checkpoint.load("comprehend");

	let comprehendResult: Awaited<ReturnType<typeof comprehend>>;

	if (shouldSkipComprehend) {
		comprehendResult = checkpoint.load("comprehend") as typeof comprehendResult;
		console.error(
			`[comprehend] Loaded from checkpoint (${comprehendResult.chapterMaps.length} maps)`,
		);
	} else {
		const comprehendStart = Date.now();
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

		try {
			comprehendResult = await comprehend({
				documentTree: tree,
				provider: comprehendLLM,
			});
		} catch (err) {
			checkpoint.updateStage("comprehend", {
				status: "failed",
				error: String(err),
				failedAt: new Date().toISOString(),
			});
			throw err;
		}

		console.error(
			`[comprehend] Done. ${comprehendResult.chapterMaps.length} maps, ${comprehendResult.usage.failedChapters.length} failed`,
		);
		checkpoint.save("comprehend", comprehendResult);
		checkpoint.updateStage("comprehend", {
			status: "completed",
			completedAt: new Date().toISOString(),
			durationMs: Date.now() - comprehendStart,
		});
	}

	if (config.skipExtract) {
		console.error("[extract] Skipped (--skip-extract)");
		console.log(JSON.stringify(comprehendResult, null, 2));
		return;
	}

	// === Phase 3: Extract ===
	const shouldSkipExtract =
		config.resume &&
		resumePoint !== "parse" &&
		resumePoint !== "comprehend" &&
		resumePoint !== "extract" &&
		checkpoint.load("extract");

	let allAtoms: CandidateAtom[];
	let allProposedTypes: unknown[];

	if (shouldSkipExtract) {
		const cached = checkpoint.load<{
			atoms: CandidateAtom[];
			proposedTypes: unknown[];
		}>("extract");
		allAtoms = cached?.atoms ?? [];
		allProposedTypes = cached?.proposedTypes ?? [];
		console.error(
			`[extract] Loaded from checkpoint (${allAtoms.length} atoms)`,
		);
	} else {
		const extractStart = Date.now();
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

		let totalAtomCount = 0;
		let totalExtractCalls = 0;
		let totalExtractInput = 0;
		let totalExtractOutput = 0;
		allAtoms = [];
		allProposedTypes = [];

		try {
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

				totalAtomCount += extractResult.atoms.length;
				totalExtractCalls += extractResult.usage.callCount;
				totalExtractInput += extractResult.usage.inputTokens;
				totalExtractOutput += extractResult.usage.outputTokens;
				allAtoms.push(...extractResult.atoms);
				allProposedTypes.push(...extractResult.proposedFrameTypes);

				console.error(
					`  → ${extractResult.atoms.length} atoms, ${extractResult.skippedSections.length} skipped, ${extractResult.flaggedAtoms.length} flagged`,
				);
			}
		} catch (err) {
			// Save partial progress before failing
			checkpoint.save("extract", {
				atoms: allAtoms,
				proposedTypes: allProposedTypes,
			});
			checkpoint.updateStage("extract", {
				status: "failed",
				error: String(err),
				failedAt: new Date().toISOString(),
			});
			throw err;
		}

		checkpoint.save("extract", {
			atoms: allAtoms,
			proposedTypes: allProposedTypes,
		});
		checkpoint.updateStage("extract", {
			status: "completed",
			completedAt: new Date().toISOString(),
			durationMs: Date.now() - extractStart,
		});

		// === Report ===
		console.error("");
		console.error("=== Results ===");
		console.error(
			`Comprehend: ${comprehendResult.chapterMaps.length} chapters, ${comprehendResult.usage.callCount} calls, ${comprehendResult.usage.totalInputTokens} in / ${comprehendResult.usage.totalOutputTokens} out`,
		);
		console.error(
			`Extract: ${totalAtomCount} atoms, ${totalExtractCalls} calls, ${totalExtractInput} in / ${totalExtractOutput} out`,
		);
		console.error(`Domain types proposed: ${allProposedTypes.length}`);
		console.error(
			`Registry: ${registry.getAll().length} types (${registry.getCoreTypes().length} core + ${registry.getAll().length - registry.getCoreTypes().length} domain)`,
		);
	}

	// === Phase 4: Integrate ===
	if (!config.skipIntegrate) {
		const integrateStart = Date.now();
		const embeddingProvider = createOpenAIEmbeddingProvider({
			provider: "openai",
			model: config.embeddingModel,
		});

		const integrateProviderConfig: ProviderConfig = {
			provider: config.integrateProvider as ProviderConfig["provider"],
			model: config.integrateModel,
		};
		const integrateLLM = withRetry(createProvider(integrateProviderConfig));

		let existingGraph: KnowledgeGraph | null = null;
		const { graphDir } = config;
		const atomsPath = join(graphDir, "atoms.json");

		if (!config.rebuildGraph && existsSync(atomsPath)) {
			try {
				const readJson = (f: string) =>
					JSON.parse(readFileSync(join(graphDir, f), "utf8"));
				existingGraph = {
					atoms: readJson("atoms.json"),
					entities: readJson("entities.json"),
					graph: readJson("graph.json"),
					embeddings: readJson("embeddings.json"),
					stats: {
						totalAtoms: 0,
						totalEntities: 0,
						newEntities: 0,
						mergedEntities: 0,
						reinforcements: 0,
						contradictions: 0,
						extensions: 0,
						crossDomainLinks: 0,
						llmCalls: 0,
						embeddingTokens: 0,
					},
				};
				console.error(`[integrate] Loaded existing graph from ${graphDir}`);
			} catch {
				console.error(
					"[integrate] Could not load existing graph — starting fresh",
				);
			}
		}

		try {
			const knowledgeGraph = await integrate({
				atoms: allAtoms,
				metadata: tree.metadata,
				existingGraph,
				llmProvider: integrateLLM,
				embeddingProvider,
			});

			if (!existsSync(graphDir)) mkdirSync(graphDir, { recursive: true });
			writeFileSync(
				join(graphDir, "atoms.json"),
				JSON.stringify(knowledgeGraph.atoms, null, 2),
			);
			writeFileSync(
				join(graphDir, "entities.json"),
				JSON.stringify(knowledgeGraph.entities, null, 2),
			);
			writeFileSync(
				join(graphDir, "graph.json"),
				JSON.stringify(knowledgeGraph.graph, null, 2),
			);
			writeFileSync(
				join(graphDir, "embeddings.json"),
				JSON.stringify(knowledgeGraph.embeddings),
			);
			console.error(`[integrate] Graph saved to ${graphDir}`);
			checkpoint.updateStage("integrate", {
				status: "completed",
				completedAt: new Date().toISOString(),
				durationMs: Date.now() - integrateStart,
			});
		} catch (err) {
			checkpoint.updateStage("integrate", {
				status: "failed",
				error: String(err),
				failedAt: new Date().toISOString(),
			});
			throw err;
		}
	} else {
		console.error("[integrate] Skipped (--skip-integrate)");
	}

	// Full result to stdout
	const output = {
		comprehension: comprehendResult,
		extraction: {
			atoms: allAtoms,
			proposedFrameTypes: allProposedTypes,
		},
	};
	console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
	console.error("Pipeline failed:", err);
	process.exit(1);
});
