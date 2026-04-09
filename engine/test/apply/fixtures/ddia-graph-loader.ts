/**
 * Load the real DDIA knowledge graph for integration tests.
 * Requires engine/graph/ to contain processed output.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	Atom,
	EntityIndex,
	GraphIndex,
	KnowledgeGraph,
	VectorIndex,
} from "../../../src/integrate/types";

const GRAPH_DIR = join(import.meta.dir, "../../../graph");

export function hasDDIAGraph(): boolean {
	return existsSync(join(GRAPH_DIR, "atoms.json"));
}

export function loadDDIAGraph(): KnowledgeGraph {
	const atoms = JSON.parse(
		readFileSync(join(GRAPH_DIR, "atoms.json"), "utf8"),
	) as Atom[];
	const entities = JSON.parse(
		readFileSync(join(GRAPH_DIR, "entities.json"), "utf8"),
	) as EntityIndex;
	const graph = JSON.parse(
		readFileSync(join(GRAPH_DIR, "graph.json"), "utf8"),
	) as GraphIndex;
	let embeddings: VectorIndex = [];
	try {
		embeddings = JSON.parse(
			readFileSync(join(GRAPH_DIR, "embeddings.json"), "utf8"),
		) as VectorIndex;
	} catch {
		/* embeddings optional for non-vector tests */
	}

	return {
		atoms,
		entities,
		graph,
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
}
