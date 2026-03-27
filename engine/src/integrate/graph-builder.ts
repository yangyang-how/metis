/**
 * Graph builder — finalize atoms and construct the adjacency list.
 *
 * Pure data transformation. No LLM calls. Takes resolved entities
 * and detected relations and produces the final KnowledgeGraph artifacts.
 */
import type { CandidateAtom } from "../extract/types";
import type {
	Atom,
	EntityIndex,
	GraphEdge,
	GraphIndex,
	Relation,
} from "./types";

const CONFIDENCE_BOOST_PER_REINFORCEMENT = 0.05;

/**
 * Promote CandidateAtom[] to Atom[] by populating cross-reference fields
 * and updating confidence based on relations.
 */
export function finalizeAtoms(
	candidates: CandidateAtom[],
	entities: EntityIndex,
	relations: Relation[],
): Atom[] {
	// Build lookup: atomId → entity IDs
	const atomEntityMap = new Map<string, string[]>();
	for (const [entityId, entity] of Object.entries(entities)) {
		for (const atomId of entity.atomIds) {
			const list = atomEntityMap.get(atomId) ?? [];
			list.push(entityId);
			atomEntityMap.set(atomId, list);
		}
	}

	// Build relation lookups
	const reinforcedByMap = new Map<string, string[]>();
	const contradictedByMap = new Map<string, string[]>();
	const extendedByMap = new Map<string, string[]>();

	for (const rel of relations) {
		if (rel.type === "reinforces") {
			addToMap(reinforcedByMap, rel.atomA, rel.atomB);
			addToMap(reinforcedByMap, rel.atomB, rel.atomA);
		} else if (rel.type === "contradicts") {
			addToMap(contradictedByMap, rel.atomA, rel.atomB);
			addToMap(contradictedByMap, rel.atomB, rel.atomA);
		} else if (rel.type === "extends") {
			addToMap(extendedByMap, rel.atomA, rel.atomB);
			addToMap(extendedByMap, rel.atomB, rel.atomA);
		}
	}

	return candidates.map((c) => {
		const reinforcedBy = reinforcedByMap.get(c.id) ?? [];
		const boost = reinforcedBy.length * CONFIDENCE_BOOST_PER_REINFORCEMENT;
		const confidence = Math.min(1.0, c.confidence + boost);

		return {
			...c,
			confidence,
			entityRefs: atomEntityMap.get(c.id) ?? [],
			reinforcedBy,
			contradictedBy: contradictedByMap.get(c.id) ?? [],
			extendedBy: extendedByMap.get(c.id) ?? [],
		} satisfies Atom;
	});
}

/**
 * Build the adjacency list from entities, relations, and cross-domain links.
 * All edges are bidirectional.
 */
export function buildAdjacencyList(
	atoms: CandidateAtom[],
	entities: EntityIndex,
	relations: Relation[],
): GraphIndex {
	const graph: GraphIndex = {};
	const atomIds = new Set(atoms.map((a) => a.id));

	const addEdge = (from: string, edge: GraphEdge) => {
		if (!graph[from]) graph[from] = [];
		const existing = graph[from].find(
			(e) => e.target === edge.target && e.type === edge.type,
		);
		if (!existing) {
			graph[from].push(edge);
		}
	};

	// Entity-link edges: atoms sharing an entity
	for (const entity of Object.values(entities)) {
		const entityAtomIds = entity.atomIds.filter((id) => atomIds.has(id));
		for (let i = 0; i < entityAtomIds.length; i++) {
			for (let j = i + 1; j < entityAtomIds.length; j++) {
				const a = entityAtomIds[i]!;
				const b = entityAtomIds[j]!;
				addEdge(a, { target: b, type: "entity_link", confidence: 1.0 });
				addEdge(b, { target: a, type: "entity_link", confidence: 1.0 });
			}
		}
	}

	// Relation edges
	for (const rel of relations) {
		addEdge(rel.atomA, {
			target: rel.atomB,
			type: rel.type,
			confidence: rel.confidence,
		});
		addEdge(rel.atomB, {
			target: rel.atomA,
			type: rel.type,
			confidence: rel.confidence,
		});
	}

	// Cross-domain edges
	for (const entity of Object.values(entities)) {
		for (const linkedEntityId of entity.crossDomainLinks) {
			const linkedEntity = entities[linkedEntityId];
			if (!linkedEntity) continue;

			for (const atomA of entity.atomIds.filter((id) =>
				atomIds.has(id),
			)) {
				for (const atomB of linkedEntity.atomIds.filter((id) =>
					atomIds.has(id),
				)) {
					addEdge(atomA, {
						target: atomB,
						type: "cross_domain",
						confidence: 0.75,
					});
					addEdge(atomB, {
						target: atomA,
						type: "cross_domain",
						confidence: 0.75,
					});
				}
			}
		}
	}

	return graph;
}

function addToMap(
	map: Map<string, string[]>,
	key: string,
	value: string,
): void {
	const list = map.get(key) ?? [];
	if (!list.includes(value)) list.push(value);
	map.set(key, list);
}
