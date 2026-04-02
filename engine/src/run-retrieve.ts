/**
 * Retrieval CLI — query the knowledge graph from the terminal.
 *
 * Usage:
 *   bun run src/run-retrieve.ts "query" [options]
 *
 * Options:
 *   --top-k <n>                 number of results (default: 10)
 *   --method hybrid|bm25|vector retrieval method (default: hybrid)
 *   --graph-dir <path>          data directory (default: engine/graph)
 *   --verbose                   show per-method ranks and scores
 *   --json                      output raw JSON to stdout
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomToText } from "./integrate/embedding-service";
import { type RetrievalResult, retrieve } from "./retrieve/index";

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	let query = "";
	let topK = 10;
	let method = "hybrid" as string;
	let graphDir = join(new URL(".", import.meta.url).pathname, "../graph");
	let verbose = false;
	let json = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--top-k") {
			topK = Number.parseInt(args[++i] ?? "10", 10);
		} else if (arg === "--method") {
			method = args[++i] ?? "hybrid";
		} else if (arg === "--graph-dir") {
			graphDir = args[++i] ?? graphDir;
		} else if (arg === "--verbose") {
			verbose = true;
		} else if (arg === "--json") {
			json = true;
		} else if (!arg?.startsWith("--")) {
			query = arg ?? "";
		}
	}

	return { query, topK, method, graphDir, verbose, json };
}

function truncate(text: string, maxLen: number): string {
	return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function formatResult(
	r: RetrievalResult,
	rank: number,
	verbose: boolean,
): string {
	const text = truncate(atomToText(r.atom), 80);
	const source = r.atom.source;
	const sourceStr = `${source.title}, ${source.chapterId} §${source.sectionId}`;

	let line = ` #${String(rank).padStart(2)}  [${r.score.toFixed(4)}] ${r.atom.frame} — ${text}\n`;
	line += `      Source: ${truncate(sourceStr, 70)}\n`;

	if (verbose) {
		const bm25Rank = r.ranks.bm25 !== null ? `#${r.ranks.bm25}` : "—";
		const vecRank = r.ranks.vector !== null ? `#${r.ranks.vector}` : "—";
		line += `      BM25: ${bm25Rank}  Vector: ${vecRank}\n`;
	}

	return line;
}

async function main() {
	const config = parseArgs(process.argv);

	if (!config.query) {
		console.error('Usage: bun run src/run-retrieve.ts "query" [options]');
		console.error("");
		console.error("Options:");
		console.error(
			"  --top-k <n>                 results to return (default: 10)",
		);
		console.error(
			"  --method hybrid|bm25|vector retrieval method (default: hybrid)",
		);
		console.error(
			"  --graph-dir <path>          data directory (default: engine/graph)",
		);
		console.error("  --verbose                   show per-method ranks");
		console.error("  --json                      output raw JSON");
		process.exit(1);
	}

	// Load data
	const atomsPath = join(config.graphDir, "atoms.json");
	const embeddingsPath = join(config.graphDir, "embeddings.json");

	let atoms: import("./extract/types").CandidateAtom[];
	try {
		atoms = JSON.parse(readFileSync(atomsPath, "utf8"));
	} catch {
		console.error(`Error: Could not read ${atomsPath}`);
		process.exit(1);
	}

	let embeddings: import("./integrate/types").VectorIndex | undefined;
	try {
		const raw = JSON.parse(readFileSync(embeddingsPath, "utf8"));
		if (Array.isArray(raw) && raw.length > 0) {
			embeddings = raw;
		}
	} catch {
		if (config.method === "vector") {
			console.error(`Error: Vector search requires ${embeddingsPath}`);
			process.exit(1);
		}
		// hybrid/bm25 can proceed without embeddings
	}

	// For vector search, we need a query embedding.
	// Without an API key, fall back to BM25-only with a message.
	let queryEmbedding: number[] | undefined;
	const needsVector = config.method === "vector" || config.method === "hybrid";

	if (needsVector && embeddings && embeddings.length > 0) {
		const apiKey = process.env.OPENAI_API_KEY;
		if (apiKey) {
			try {
				const { createOpenAIEmbeddingProvider } = await import(
					"./llm/openai-embedding"
				);
				const provider = createOpenAIEmbeddingProvider({
					provider: "openai",
					model: "text-embedding-3-large",
				});
				const [embedding] = await provider.embed([config.query]);
				queryEmbedding = embedding;
			} catch (err) {
				console.error(`[warn] Embedding API call failed: ${err}`);
			}
		}

		if (!queryEmbedding && config.method === "hybrid") {
			console.error(
				"[info] No OPENAI_API_KEY or embedding failed — falling back to BM25-only",
			);
		}
	}

	const results = await retrieve({
		query: config.query,
		atoms,
		embeddings,
		queryEmbedding,
		topK: config.topK,
		method: config.method as "hybrid" | "bm25" | "vector",
	});

	if (config.json) {
		console.log(JSON.stringify(results, null, 2));
		return;
	}

	// Display
	const methodLabel = queryEmbedding
		? config.method
		: config.method === "hybrid"
			? "bm25 (vector unavailable)"
			: config.method;

	console.error(`Query: "${config.query}"`);
	console.error(`Method: ${methodLabel}`);
	console.error(`Results: ${results.length} of ${atoms.length} atoms\n`);

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (result) console.error(formatResult(result, i + 1, config.verbose));
	}
}

main().catch((err) => {
	console.error("Retrieval failed:", err);
	process.exit(1);
});
