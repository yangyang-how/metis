/**
 * Embedding service — converts atoms to text, embeds them, caches results.
 *
 * The text representation varies by frame type to produce natural language
 * that captures the atom's meaning for embedding models.
 */
import type { CandidateAtom } from "../extract/types";
import type { EmbeddingProvider } from "../llm/embedding-types";
import type { VectorEntry, VectorIndex } from "./types";

// --- Frame-specific text templates ---

const FRAME_TEMPLATES: Record<
	string,
	(roles: Record<string, string>) => string
> = {
	definition: (r) => `${r.term} means ${r.meaning}`,
	has_property: (r) => `${r.entity} has the property: ${r.property}`,
	is_a: (r) => `${r.instance} is a type of ${r.category}`,
	consists_of: (r) => `${r.whole} consists of ${r.dimension}: ${r.description}`,
	example_of: (r) =>
		`${r.instance} is an example of ${r.concept}${r.detail ? `: ${r.detail}` : ""}`,
	taxonomy: (r) =>
		`${r.concept} is classified into ${r.categories} based on ${r.basis}`,
	causal: (r) => `${r.cause} causes ${r.effect}`,
	causal_chain: (r) =>
		`${r.trigger} leads to ${r.mechanism}, resulting in ${r.outcome}`,
	heuristic: (r) => `when ${r.situation}, ${r.action} because ${r.rationale}`,
	principle: (r) =>
		`${r.statement}${r.scope ? ` (in ${r.scope})` : ""}${r.implication ? `: ${r.implication}` : ""}`,
	procedure: (r) =>
		`to ${r.goal}: ${r.steps}${r.context ? ` (${r.context})` : ""}`,
	formula: (r) =>
		`${r.name}: ${r.expression}${r.terms ? ` where ${r.terms}` : ""}`,
	deviation: (r) =>
		`theory says ${r.theory}, but reality is ${r.reality}${r.implication ? `: ${r.implication}` : ""}`,
	threshold: (r) =>
		`${r.metric} at ${r.threshold_value} triggers ${r.transition}${r.direction ? ` (${r.direction})` : ""}`,
	method_comparison: (r) =>
		`${r.method_a} vs ${r.method_b}: ${r.difference}${r.when_to_use ? `. Use when: ${r.when_to_use}` : ""}`,
	sequence: (r) => `${r.name}: ${r.layers}${r.rule ? `. Rule: ${r.rule}` : ""}`,
	evaluation_matrix: (r) =>
		`${r.name} evaluates across ${r.dimensions}${r.quadrants ? `: ${r.quadrants}` : ""}${r.rule ? `. ${r.rule}` : ""}`,
};

/**
 * Convert an atom to a natural language sentence for embedding.
 * Uses frame-specific templates for known types, falls back to
 * concatenating role values for unknown types.
 */
export function atomToText(atom: CandidateAtom): string {
	const template = FRAME_TEMPLATES[atom.frame];
	if (template) {
		return template(atom.roles);
	}
	return Object.values(atom.roles).join(". ");
}

/**
 * Embed atoms, skipping those already in the cache.
 * Batches calls according to provider's maxBatchSize.
 */
export async function embedAtoms(
	atoms: CandidateAtom[],
	provider: EmbeddingProvider,
	existingCache: VectorIndex,
): Promise<VectorIndex> {
	const cacheMap = new Map(existingCache.map((e) => [e.atomId, e]));

	// Find atoms that need embedding
	const toEmbed: Array<{ atom: CandidateAtom; text: string }> = [];
	for (const atom of atoms) {
		if (!cacheMap.has(atom.id)) {
			toEmbed.push({ atom, text: atomToText(atom) });
		}
	}

	// Batch embed
	const newEntries: VectorEntry[] = [];
	for (let i = 0; i < toEmbed.length; i += provider.maxBatchSize) {
		const batch = toEmbed.slice(i, i + provider.maxBatchSize);
		const texts = batch.map((b) => b.text);
		const embeddings = await provider.embed(texts);

		for (let j = 0; j < batch.length; j++) {
			const item = batch[j];
			const embedding = embeddings[j];
			if (!item || !embedding) continue;
			newEntries.push({
				atomId: item.atom.id,
				text: item.text,
				embedding,
			});
		}
	}

	// Merge: cached + new for current atoms
	const result: VectorIndex = [];
	for (const atom of atoms) {
		const cached = cacheMap.get(atom.id);
		if (cached) {
			result.push(cached);
		} else {
			const newEntry = newEntries.find((e) => e.atomId === atom.id);
			if (newEntry) result.push(newEntry);
		}
	}

	// Include existing entries not in current atoms (from previous books)
	for (const entry of existingCache) {
		if (!result.find((e) => e.atomId === entry.atomId)) {
			result.push(entry);
		}
	}

	return result;
}

/**
 * Cosine similarity between two vectors.
 * Returns value in [-1, 1]. Higher = more similar.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		const ai = a[i] ?? 0;
		const bi = b[i] ?? 0;
		dot += ai * bi;
		magA += ai * ai;
		magB += bi * bi;
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	return denom === 0 ? 0 : dot / denom;
}
