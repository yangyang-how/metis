import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Batch pipeline runner — process multiple EPUBs sequentially.
 *
 * Usage:
 *   KIMI_API_KEY=... OPENAI_API_KEY=... bun run src/run-batch.ts
 *
 * Processes each book through parse → comprehend → extract → integrate.
 * Per-book results saved as JSON in engine/output/.
 * Shared knowledge graph saved in engine/graph/.
 */
import { comprehend } from "./comprehend/index";
import { normalizeChapters } from "./comprehend/structure-inference";
import { createRegistry, extract } from "./extract/index";
import type { CandidateAtom } from "./extract/types";
import { integrate } from "./integrate/index";
import type { KnowledgeGraph } from "./integrate/types";
import { createOpenAIEmbeddingProvider } from "./llm/openai-embedding";
import { createProvider, withRetry } from "./llm/provider";
import { parse } from "./parse/index";

const BOOKS = [
	"/Users/shuang/bohr-vault/50-library/制度基因_中国制度与极权主义制度的起源.epub",
];

const OUTPUT_DIR = join(new URL(".", import.meta.url).pathname, "../output");
const GRAPH_DIR = join(new URL(".", import.meta.url).pathname, "../graph");
const INTER_CALL_DELAY = 2000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50);
}

function loadExistingGraph(): KnowledgeGraph | null {
	const atomsPath = join(GRAPH_DIR, "atoms.json");
	if (!existsSync(atomsPath)) return null;

	try {
		const readJson = (f: string) =>
			JSON.parse(readFileSync(join(GRAPH_DIR, f), "utf8"));
		return {
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
	} catch {
		console.error("[integrate] Could not load existing graph — starting fresh");
		return null;
	}
}

function saveGraph(graph: KnowledgeGraph): void {
	if (!existsSync(GRAPH_DIR)) mkdirSync(GRAPH_DIR, { recursive: true });
	writeFileSync(
		join(GRAPH_DIR, "atoms.json"),
		JSON.stringify(graph.atoms, null, 2),
	);
	writeFileSync(
		join(GRAPH_DIR, "entities.json"),
		JSON.stringify(graph.entities, null, 2),
	);
	writeFileSync(
		join(GRAPH_DIR, "graph.json"),
		JSON.stringify(graph.graph, null, 2),
	);
	writeFileSync(
		join(GRAPH_DIR, "embeddings.json"),
		JSON.stringify(graph.embeddings),
	);
}

async function processBook(
	epubPath: string,
	provider: ReturnType<typeof withRetry>,
	embeddingProvider: ReturnType<typeof createOpenAIEmbeddingProvider>,
) {
	const filename = epubPath.split("/").pop() ?? "unknown";
	console.error(`\n${"=".repeat(60)}`);
	console.error(`BOOK: ${filename}`);
	console.error("=".repeat(60));

	// Parse
	console.error("[parse] Starting...");
	const tree = await parse({
		filePath: epubPath,
		options: { extractImages: false },
	});
	console.error(
		`[parse] Done. ${tree.chapters.length} chapters, "${tree.metadata.title}"`,
	);

	// Comprehend
	console.error(`[comprehend] ${tree.chapters.length} chapters...`);
	const comprehendResult = await comprehend({
		documentTree: tree,
		provider,
	});
	console.error(
		`[comprehend] Done. ${comprehendResult.chapterMaps.length} maps, ${comprehendResult.usage.failedChapters.length} failed, ${comprehendResult.usage.totalInputTokens + comprehendResult.usage.totalOutputTokens} tokens`,
	);

	await sleep(INTER_CALL_DELAY);

	// Extract
	const registry = createRegistry();
	const normalizedChapters = normalizeChapters(tree);
	let totalAtoms = 0;
	let totalExtractTokens = 0;
	const allAtoms: CandidateAtom[] = [];
	const allProposed: unknown[] = [];

	for (const chapter of normalizedChapters) {
		const map = comprehendResult.chapterMaps.find(
			(m) => m.chapterId === chapter.id,
		);
		if (!map) continue;

		console.error(`[extract] ${chapter.title.slice(0, 40)}...`);
		const result = await extract({
			chapter,
			comprehensionMap: map,
			bookMetadata: tree.metadata,
			registry,
			provider,
		});

		totalAtoms += result.atoms.length;
		totalExtractTokens += result.usage.inputTokens + result.usage.outputTokens;
		allAtoms.push(...result.atoms);
		allProposed.push(...result.proposedFrameTypes);

		console.error(
			`  → ${result.atoms.length} atoms, ${result.skippedSections.length} skipped`,
		);
		await sleep(INTER_CALL_DELAY);
	}

	// Save per-book output
	const slug = slugify(tree.metadata.title);
	const outputPath = join(OUTPUT_DIR, `${slug}.json`);
	const output = {
		metadata: tree.metadata,
		comprehension: comprehendResult,
		extraction: {
			atoms: allAtoms,
			proposedFrameTypes: allProposed,
			totalAtoms,
		},
		registrySize: registry.getAll().length,
	};
	writeFileSync(outputPath, JSON.stringify(output, null, 2));
	console.error(`[save] Written to ${outputPath}`);

	// Integrate into shared graph
	console.error("[integrate] Integrating into knowledge graph...");
	const existingGraph = loadExistingGraph();
	const knowledgeGraph = await integrate({
		atoms: allAtoms,
		metadata: tree.metadata,
		existingGraph,
		llmProvider: provider,
		embeddingProvider,
	});
	saveGraph(knowledgeGraph);
	console.error(
		`[integrate] Graph saved. ${knowledgeGraph.stats.totalEntities} entities, ${knowledgeGraph.stats.reinforcements} reinforcements`,
	);

	console.error(
		`[summary] ${comprehendResult.chapterMaps.length} chapters, ${totalAtoms} atoms, ${comprehendResult.usage.totalInputTokens + comprehendResult.usage.totalOutputTokens + totalExtractTokens} total tokens`,
	);

	return {
		title: tree.metadata.title,
		chapters: tree.chapters.length,
		atoms: totalAtoms,
		tokens:
			comprehendResult.usage.totalInputTokens +
			comprehendResult.usage.totalOutputTokens +
			totalExtractTokens,
	};
}

async function main() {
	if (!process.env.KIMI_API_KEY) {
		console.error("Error: KIMI_API_KEY not set.");
		process.exit(1);
	}

	if (!existsSync(OUTPUT_DIR)) {
		mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	const provider = withRetry(
		createProvider({ provider: "kimi", model: "kimi-k2-0711-preview" }),
	);

	const embeddingProvider = createOpenAIEmbeddingProvider({
		provider: "openai",
		model: "text-embedding-3-large",
	});

	const results: Array<{
		title: string;
		chapters: number;
		atoms: number;
		tokens: number;
	}> = [];

	for (const book of BOOKS) {
		try {
			const result = await processBook(book, provider, embeddingProvider);
			results.push(result);
		} catch (e) {
			console.error(`FAILED: ${book}`);
			console.error(`  Error: ${(e as Error).message}`);
			results.push({
				title: book.split("/").pop() ?? "unknown",
				chapters: 0,
				atoms: 0,
				tokens: 0,
			});
		}
	}

	// Final summary
	console.error(`\n${"=".repeat(60)}`);
	console.error("BATCH COMPLETE");
	console.error("=".repeat(60));
	for (const r of results) {
		console.error(
			`  ${r.title.slice(0, 40).padEnd(42)} ${String(r.chapters).padStart(3)} ch  ${String(r.atoms).padStart(5)} atoms  ${String(r.tokens).padStart(8)} tok`,
		);
	}
	const totalAtoms = results.reduce((s, r) => s + r.atoms, 0);
	const totalTokens = results.reduce((s, r) => s + r.tokens, 0);
	console.error(
		`  ${"TOTAL".padEnd(42)} ${String(results.length).padStart(3)} bk  ${String(totalAtoms).padStart(5)} atoms  ${String(totalTokens).padStart(8)} tok`,
	);
}

main().catch((err) => {
	console.error("Batch failed:", err);
	process.exit(1);
});
