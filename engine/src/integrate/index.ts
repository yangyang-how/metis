/**
 * Integrate stage — public entry point.
 *
 * Orchestrates the four sub-steps: embed → resolve entities →
 * detect relations → build graph. No business logic lives here.
 *
 * Usage:
 *   import { integrate } from "metis-engine/integrate";
 *   const graph = await integrate({ atoms, metadata, existingGraph, ... });
 */
import type { CandidateAtom } from "../extract/types";
import { embedAtoms } from "./embedding-service";
import { resolveEntities } from "./entity-resolver";
import { buildAdjacencyList, finalizeAtoms } from "./graph-builder";
import { detectRelations } from "./relation-detector";
import type { IntegrateInput, KnowledgeGraph } from "./types";

export { IntegrateError } from "./errors";
export type {
	Atom,
	Entity,
	EntityIndex,
	GraphEdge,
	GraphIndex,
	IntegrateInput,
	IntegrationStats,
	KnowledgeGraph,
	VectorEntry,
	VectorIndex,
} from "./types";

export async function integrate(
	input: IntegrateInput,
): Promise<KnowledgeGraph> {
	const { atoms, metadata, existingGraph, llmProvider, embeddingProvider } =
		input;

	const existingAtoms: CandidateAtom[] = existingGraph?.atoms ?? [];
	const existingEntities = existingGraph?.entities ?? {};
	const existingEmbeddings = existingGraph?.embeddings ?? [];

	console.error(
		`[integrate] ${atoms.length} new atoms from "${metadata.title}"`,
	);

	// Step 1: Embed new atoms
	console.error("[integrate] Step 1/4: Embedding atoms...");
	const allEmbeddings = await embedAtoms(
		atoms,
		embeddingProvider,
		existingEmbeddings,
	);

	// Step 2: Resolve entities
	console.error("[integrate] Step 2/4: Resolving entities...");
	const { entities, stats: entityStats } = await resolveEntities(
		atoms,
		existingEntities,
		allEmbeddings,
		embeddingProvider,
		llmProvider,
	);

	// Step 3: Detect relations
	console.error("[integrate] Step 3/4: Detecting relations...");
	const { relations, stats: relationStats } = await detectRelations(
		atoms,
		existingAtoms,
		entities,
		allEmbeddings,
		llmProvider,
	);

	// Step 4: Build graph
	console.error("[integrate] Step 4/4: Building graph...");
	const allCandidates = [...existingAtoms, ...atoms];
	const finalizedAtoms = finalizeAtoms(allCandidates, entities, relations);
	const graph = buildAdjacencyList(finalizedAtoms, entities, relations);

	const result: KnowledgeGraph = {
		atoms: finalizedAtoms,
		entities,
		graph,
		embeddings: allEmbeddings,
		stats: {
			totalAtoms: finalizedAtoms.length,
			totalEntities: Object.keys(entities).length,
			newEntities: entityStats.newEntities,
			mergedEntities: entityStats.mergedEntities,
			reinforcements: relationStats.reinforcements,
			contradictions: relationStats.contradictions,
			extensions: relationStats.extensions,
			crossDomainLinks: entityStats.crossDomainLinks,
			llmCalls: entityStats.llmCalls + relationStats.llmCalls,
			embeddingTokens: 0,
		},
	};

	console.error(
		`[integrate] Done. ${result.stats.totalEntities} entities (${entityStats.newEntities} new, ${entityStats.mergedEntities} merged), ` +
			`${relationStats.reinforcements} reinforcements, ${relationStats.contradictions} contradictions, ${relationStats.extensions} extensions`,
	);

	return result;
}
