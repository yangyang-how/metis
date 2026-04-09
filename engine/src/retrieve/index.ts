/**
 * Retrieval orchestrator — loads atoms, runs BM25 and/or vector search,
 * fuses results, and returns ranked atoms.
 *
 * Can be called programmatically with pre-loaded data (for tests) or
 * pointed at a graph directory (for CLI use).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateAtom } from "../extract/types";
import { atomToText } from "../integrate/embedding-service";
import type { Atom } from "../integrate/types";
import type { VectorIndex } from "../integrate/types";
import { buildBM25Index, queryBM25 } from "./bm25";
import { type FusedResult, fuseResults } from "./hybrid";
import { queryVectors } from "./vector-search";

export interface RetrievalResult {
	atom: CandidateAtom | Atom;
	score: number;
	ranks: Record<string, number | null>;
}

export interface RetrieveOptions {
	query: string;
	topK?: number;
	method?: "hybrid" | "bm25" | "vector";
	/** Pre-loaded atoms (skips file I/O) */
	atoms?: (CandidateAtom | Atom)[];
	/** Pre-loaded embeddings (skips file I/O) */
	embeddings?: VectorIndex;
	/** Pre-computed query embedding (skips API call) */
	queryEmbedding?: number[];
	/** Graph directory to load from (ignored if atoms/embeddings provided) */
	graphDir?: string;
}

/**
 * Retrieve the most relevant atoms for a query.
 */
export async function retrieve(
	options: RetrieveOptions,
): Promise<RetrievalResult[]> {
	const {
		query,
		topK = 10,
		method = "hybrid",
		queryEmbedding,
		graphDir,
	} = options;

	// Load data from files if not provided
	const atoms =
		options.atoms ??
		loadJson<CandidateAtom[]>(graphDir ?? "graph", "atoms.json");
	const atomMap = new Map(atoms.map((a) => [a.id, a]));

	// Candidate pool size — retrieve more than topK per method so fusion has
	// enough candidates to work with
	const poolSize = Math.min(topK * 3, atoms.length);

	const rankedLists: Array<{
		method: string;
		results: Array<{ id: string; score: number }>;
	}> = [];

	// BM25
	if (method === "bm25" || method === "hybrid") {
		const docs = atoms.map((a) => ({ id: a.id, text: atomToText(a) }));
		const index = buildBM25Index(docs);
		const bm25Results = queryBM25(index, query, poolSize);
		rankedLists.push({ method: "bm25", results: bm25Results });
	}

	// Vector
	if (method === "vector" || method === "hybrid") {
		const embeddings =
			options.embeddings ??
			loadJsonSafe<VectorIndex>(graphDir ?? "graph", "embeddings.json");

		if (embeddings && embeddings.length > 0 && queryEmbedding) {
			const vectorResults = queryVectors(queryEmbedding, embeddings, poolSize);
			rankedLists.push({ method: "vector", results: vectorResults });
		} else if (method === "vector") {
			// Vector-only mode but no embeddings — return empty
			return [];
		}
		// hybrid mode without embeddings: silently fall back to BM25-only
	}

	// Fuse
	const fused = fuseResults(rankedLists, topK);

	// Map back to atoms
	const results: RetrievalResult[] = [];
	for (const f of fused) {
		const atom = atomMap.get(f.id);
		if (!atom) continue;
		results.push({
			atom,
			score: f.score,
			ranks: {
				bm25: f.ranks.bm25 ?? null,
				vector: f.ranks.vector ?? null,
			},
		});
	}
	return results;
}

function loadJson<T>(dir: string, file: string): T {
	return JSON.parse(readFileSync(join(dir, file), "utf8")) as T;
}

function loadJsonSafe<T>(dir: string, file: string): T | null {
	try {
		return JSON.parse(readFileSync(join(dir, file), "utf8")) as T;
	} catch {
		return null;
	}
}
