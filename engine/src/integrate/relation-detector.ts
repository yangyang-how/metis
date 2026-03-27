/**
 * Relation detector — find reinforcement, contradiction, and extension
 * relationships between atoms that share resolved entities.
 *
 * The entity index does the heavy filtering: we only compare atoms that
 * share at least one entity. This cuts O(n²) down to a manageable set.
 */
import type { CandidateAtom } from "../extract/types";
import type { LLMProvider } from "../llm/types";
import { cosineSimilarity } from "./embedding-service";
import { relationClassificationPrompt } from "./prompts";
import type { EntityIndex, Relation, VectorIndex } from "./types";

// --- Configuration ---

const REINFORCE_THRESHOLD = 0.9;
const AMBIGUOUS_THRESHOLD = 0.75;
const RELATION_BATCH_SIZE = 10;

// --- Public API ---

export interface DetectResult {
	relations: Relation[];
	stats: {
		reinforcements: number;
		contradictions: number;
		extensions: number;
		llmCalls: number;
	};
}

export interface AtomPair {
	atomA: CandidateAtom;
	atomB: CandidateAtom;
	sharedEntityIds: string[];
}

export function findCandidatePairs(
	newAtoms: CandidateAtom[],
	existingAtoms: CandidateAtom[],
	entities: EntityIndex,
): AtomPair[] {
	// Build atom → entity mapping
	const atomToEntities = new Map<string, string[]>();
	for (const [entityId, entity] of Object.entries(entities)) {
		for (const atomId of entity.atomIds) {
			const list = atomToEntities.get(atomId) ?? [];
			list.push(entityId);
			atomToEntities.set(atomId, list);
		}
	}

	const pairs: AtomPair[] = [];
	const seen = new Set<string>();

	for (const newAtom of newAtoms) {
		const newEntityIds = atomToEntities.get(newAtom.id) ?? [];
		if (newEntityIds.length === 0) continue;

		for (const existingAtom of existingAtoms) {
			// Skip same-book pairs
			if (newAtom.source.title === existingAtom.source.title) continue;

			const existingEntityIds =
				atomToEntities.get(existingAtom.id) ?? [];
			const shared = newEntityIds.filter((id) =>
				existingEntityIds.includes(id),
			);
			if (shared.length === 0) continue;

			const key = [newAtom.id, existingAtom.id].sort().join(":");
			if (seen.has(key)) continue;
			seen.add(key);

			pairs.push({
				atomA: newAtom,
				atomB: existingAtom,
				sharedEntityIds: shared,
			});
		}
	}

	return pairs;
}

export function scoreAndClassify(
	pairs: AtomPair[],
	embeddings: VectorIndex,
): { algorithmic: Relation[]; ambiguous: AtomPair[] } {
	const embeddingMap = new Map(
		embeddings.map((e) => [e.atomId, e.embedding]),
	);
	const algorithmic: Relation[] = [];
	const ambiguous: AtomPair[] = [];

	for (const pair of pairs) {
		const embA = embeddingMap.get(pair.atomA.id);
		const embB = embeddingMap.get(pair.atomB.id);
		if (!embA || !embB) continue;

		const similarity = cosineSimilarity(embA, embB);

		if (pair.atomA.frame === pair.atomB.frame) {
			if (similarity >= REINFORCE_THRESHOLD) {
				algorithmic.push({
					type: "reinforces",
					atomA: pair.atomA.id,
					atomB: pair.atomB.id,
					confidence: similarity,
					method: "algorithmic",
				});
			} else if (similarity >= AMBIGUOUS_THRESHOLD) {
				ambiguous.push(pair);
			}
		} else {
			// Different frame types on same entity = extension
			if (similarity >= AMBIGUOUS_THRESHOLD) {
				algorithmic.push({
					type: "extends",
					atomA: pair.atomA.id,
					atomB: pair.atomB.id,
					confidence: similarity,
					method: "algorithmic",
				});
			}
		}
	}

	return { algorithmic, ambiguous };
}

export async function detectRelations(
	newAtoms: CandidateAtom[],
	existingAtoms: CandidateAtom[],
	entities: EntityIndex,
	embeddings: VectorIndex,
	llmProvider: LLMProvider,
): Promise<DetectResult> {
	let llmCalls = 0;

	const pairs = findCandidatePairs(newAtoms, existingAtoms, entities);
	const { algorithmic, ambiguous } = scoreAndClassify(pairs, embeddings);

	// LLM tiebreaker for ambiguous pairs
	const llmRelations: Relation[] = [];

	for (let i = 0; i < ambiguous.length; i += RELATION_BATCH_SIZE) {
		const batch = ambiguous.slice(i, i + RELATION_BATCH_SIZE);
		const promptPairs = batch.map((pair) => ({
			atomA: {
				frame: pair.atomA.frame,
				roles: pair.atomA.roles,
				source: pair.atomA.source.title,
			},
			atomB: {
				frame: pair.atomB.frame,
				roles: pair.atomB.roles,
				source: pair.atomB.source.title,
			},
			sharedEntity: pair.sharedEntityIds[0] ?? "unknown",
		}));

		try {
			const response = await llmProvider.sendMessage({
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: relationClassificationPrompt(promptPairs),
							},
						],
					},
				],
				temperature: 0.1,
				maxTokens: 4096,
			});

			llmCalls++;

			const jsonMatch = response.content.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as {
					classifications?: Array<{
						pair: number;
						relation: string;
					}>;
				};

				for (const c of parsed.classifications ?? []) {
					const pairIdx = c.pair - 1;
					const pair = batch[pairIdx];
					if (!pair) continue;

					if (
						c.relation === "reinforces" ||
						c.relation === "contradicts" ||
						c.relation === "extends"
					) {
						llmRelations.push({
							type: c.relation,
							atomA: pair.atomA.id,
							atomB: pair.atomB.id,
							confidence: 0.8,
							method: "llm",
						});
					}
				}
			}
		} catch {
			console.warn(
				`[integrate] Relation classification LLM call failed for batch starting at ${i}`,
			);
		}
	}

	const allRelations = [...algorithmic, ...llmRelations];

	return {
		relations: allRelations,
		stats: {
			reinforcements: allRelations.filter((r) => r.type === "reinforces")
				.length,
			contradictions: allRelations.filter((r) => r.type === "contradicts")
				.length,
			extensions: allRelations.filter((r) => r.type === "extends").length,
			llmCalls,
		},
	};
}
