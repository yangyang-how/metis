// engine/src/apply/index.ts
/**
 * Apply pipeline orchestrator.
 *
 * Wires together: Understand -> Retrieve -> Rerank -> Traverse ->
 * DetectGaps -> Compose. Supports manual QueryPlan for when the
 * Understand stage isn't being used (manual CLI flags).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	Atom,
	EntityIndex,
	GraphIndex,
	KnowledgeGraph,
	VectorIndex,
} from "../integrate/types";
import type { LLMProvider } from "../llm/types";
import { retrieve } from "../retrieve/index";
import { compose, generateSummaries } from "./compose";
import { ApplyError } from "./errors";
import { detectGaps } from "./gaps";
import { buildInventory } from "./inventory";
import { rerank } from "./rerank";
import { traverse } from "./traverse";
import type { ContextPackage, QueryInput, QueryPlan } from "./types";
import { understand } from "./understand";

export interface ApplyPipelineInput {
	query: string;
	graphDir?: string;
	graph?: KnowledgeGraph;

	// Either manualPlan or understandProvider must be provided
	manualPlan?: QueryPlan;
	understandProvider?: LLMProvider;
	summaryProvider?: LLMProvider;

	options?: {
		topK?: number;
		maxDepth?: number;
		minConfidence?: number[];
		maxExpanded?: number;
		noTraverse?: boolean;
		noGaps?: boolean;
		noSummarize?: boolean;
		method?: "hybrid" | "bm25" | "vector";
		queryEmbedding?: number[];
	};
}

export async function applyPipeline(
	input: ApplyPipelineInput,
): Promise<ContextPackage> {
	const {
		query,
		manualPlan,
		understandProvider,
		summaryProvider,
		options = {},
	} = input;

	// Load graph
	const graph = input.graph ?? loadGraph(input.graphDir ?? "graph");

	// Stage 1: Understand (or use manual plan)
	let plan: QueryPlan;
	if (manualPlan) {
		plan = manualPlan;
	} else if (understandProvider) {
		const inventory = buildInventory(graph);
		plan = await understand({ query }, inventory, understandProvider);
	} else {
		throw new ApplyError(
			"understand",
			"Either manualPlan or understandProvider must be provided.",
		);
	}

	// Stage 2: Retrieve
	const topK = options.topK ?? 20;
	const retrieveResults = await retrieve({
		query,
		topK,
		method: options.method ?? "hybrid",
		atoms: graph.atoms,
		embeddings: graph.embeddings,
		queryEmbedding: options.queryEmbedding,
	});

	// Stage 2b: Rerank
	const rerankedResults = rerank({ results: retrieveResults, plan });

	// Get full atoms from graph (retrieve may return CandidateAtom)
	const seedAtoms = rerankedResults
		.map((r) => graph.atoms.find((a) => a.id === r.atom.id))
		.filter((a): a is Atom => a !== undefined);

	const atomMap = new Map(graph.atoms.map((a) => [a.id, a]));
	const retrieveCount = seedAtoms.length;

	// Stage 3: Traverse (optional)
	let traversalAtoms: Atom[];
	let contradictions: Array<{ atomA: string; atomB: string; topic: string }> =
		[];

	if (options.noTraverse) {
		traversalAtoms = seedAtoms;
	} else {
		const traversalResult = traverse(seedAtoms, graph.graph, atomMap, {
			maxDepth: options.maxDepth,
			minConfidence: options.minConfidence,
			maxExpanded: options.maxExpanded,
			plan,
		});
		traversalAtoms = traversalResult.atoms;
		contradictions = traversalResult.contradictions;
	}

	// Stage 4: Gap Detection (optional)
	const gaps = options.noGaps
		? []
		: detectGaps(plan, traversalAtoms, contradictions);

	// Stage 5: Compose
	const pkg = compose({
		query,
		plan,
		traversalResult: {
			atoms: traversalAtoms,
			paths: [], // paths not needed for compose
			contradictions,
		},
		gaps,
		entities: graph.entities,
		retrieveCount,
	});

	// Optional: Generate summaries
	if (!options.noSummarize && summaryProvider) {
		await generateSummaries(pkg, summaryProvider);
	}

	return pkg;
}

function loadGraph(graphDir: string): KnowledgeGraph {
	try {
		const atoms = loadJson<Atom[]>(graphDir, "atoms.json");
		const entities = loadJson<EntityIndex>(graphDir, "entities.json");
		const graphIndex = loadJson<GraphIndex>(graphDir, "graph.json");
		const embeddings =
			loadJsonSafe<VectorIndex>(graphDir, "embeddings.json") ?? [];

		return {
			atoms,
			entities,
			graph: graphIndex,
			embeddings,
			stats: {
				totalAtoms: atoms.length,
				totalEntities: Object.keys(entities).length,
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
	} catch (error) {
		throw new ApplyError(
			"retrieve",
			`Failed to load graph from ${graphDir}: ${error instanceof Error ? error.message : String(error)}`,
			error instanceof Error ? error : undefined,
		);
	}
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

// Re-export for consumers
export type { ContextPackage, QueryPlan, Gap, GraphInventory } from "./types";
export { exportToKX } from "../kx/export";
export { exportGaps } from "../kx/gaps-export";
