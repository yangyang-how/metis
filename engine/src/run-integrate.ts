/**
 * Integration-only runner — build knowledge graph from existing extraction output.
 *
 * Usage:
 *   OPENAI_API_KEY=... KIMI_API_KEY=... bun run src/run-integrate.ts
 *
 * Reads all engine/output/*.json files and runs Integrate on each book
 * incrementally. No Parse/Comprehend/Extract — just the graph construction.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { CandidateAtom } from "./extract/types";
import { integrate } from "./integrate/index";
import type { KnowledgeGraph } from "./integrate/types";
import { createOpenAIEmbeddingProvider } from "./llm/openai-embedding";
import { createProvider, withRetry } from "./llm/provider";

const OUTPUT_DIR = join(new URL(".", import.meta.url).pathname, "../output");
const GRAPH_DIR = join(new URL(".", import.meta.url).pathname, "../graph");

async function main() {
	if (!process.env.OPENAI_API_KEY) {
		console.error("Error: OPENAI_API_KEY not set.");
		process.exit(1);
	}

	const embeddingProvider = createOpenAIEmbeddingProvider({
		provider: "openai",
		model: "text-embedding-3-large",
	});

	const llmProvider = withRetry(
		createProvider({ provider: "kimi", model: "kimi-k2-0711-preview" }),
	);

	// Find all output JSON files
	const files = readdirSync(OUTPUT_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort();

	console.error(`Found ${files.length} books in ${OUTPUT_DIR}`);

	if (!existsSync(GRAPH_DIR)) mkdirSync(GRAPH_DIR, { recursive: true });

	// Wipe existing graph — full rebuild
	let graph: KnowledgeGraph | null = null;

	for (const file of files) {
		const path = join(OUTPUT_DIR, file);
		const data = JSON.parse(readFileSync(path, "utf8")) as {
			metadata: { title: string; authors: string[] };
			extraction: { atoms: CandidateAtom[] };
		};

		const atoms = data.extraction.atoms;
		const title = data.metadata.title;
		console.error(`\n${"─".repeat(60)}`);
		console.error(`${title} (${atoms.length} atoms)`);

		const start = Date.now();
		graph = await integrate({
			atoms,
			metadata: data.metadata,
			existingGraph: graph,
			llmProvider,
			embeddingProvider,
		});
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);

		console.error(
			`  ${elapsed}s — ${graph.stats.totalEntities} entities, ${graph.stats.reinforcements} reinforcements, ${graph.stats.contradictions} contradictions`,
		);

		// Save after each book (crash recovery)
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

	if (!graph) {
		console.error("No books found.");
		return;
	}

	// Summary
	console.error(`\n${"═".repeat(60)}`);
	console.error("INTEGRATION COMPLETE");
	console.error(`${"═".repeat(60)}`);
	console.error(`  Atoms:          ${graph.stats.totalAtoms}`);
	console.error(
		`  Entities:       ${graph.stats.totalEntities} (${graph.stats.newEntities} new, ${graph.stats.mergedEntities} merged)`,
	);
	console.error(`  Reinforcements: ${graph.stats.reinforcements}`);
	console.error(`  Contradictions: ${graph.stats.contradictions}`);
	console.error(`  Extensions:     ${graph.stats.extensions}`);
	console.error(`  Cross-domain:   ${graph.stats.crossDomainLinks}`);
	console.error(`  LLM calls:      ${graph.stats.llmCalls}`);
	console.error(`  Graph saved to: ${GRAPH_DIR}`);
}

main().catch((err) => {
	console.error("Integration failed:", err);
	process.exit(1);
});
