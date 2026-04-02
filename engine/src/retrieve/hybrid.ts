/**
 * Reciprocal Rank Fusion (RRF) for combining multiple retrieval methods.
 *
 * RRF merges ranked lists without needing score normalization. Each method
 * contributes 1/(k + rank) per item, where k is a constant (default 60)
 * that prevents high-ranked items from dominating.
 *
 * Reference: Cormack, Clarke & Buettcher (2009)
 *   "Reciprocal Rank Fusion outperforms Condorcet and individual
 *    Rank Learning Methods"
 */

export interface RankedList {
	method: string;
	results: Array<{ id: string; score: number }>;
}

export interface FusedResult {
	id: string;
	score: number;
	ranks: Record<string, number | null>;
}

/**
 * Fuse multiple ranked lists into a single ranked result using RRF.
 *
 * @param ranked - Ranked lists from different retrieval methods
 * @param topK - Maximum number of results to return
 * @param k - RRF constant (default 60)
 */
export function fuseResults(
	ranked: RankedList[],
	topK: number,
	k = 60,
): FusedResult[] {
	if (ranked.length === 0) return [];

	// Accumulate RRF scores and track per-method ranks
	const scoreMap = new Map<
		string,
		{ score: number; ranks: Record<string, number | null> }
	>();

	// Initialize all method names for rank tracking
	const methodNames = ranked.map((r) => r.method);

	for (const list of ranked) {
		for (let rank = 0; rank < list.results.length; rank++) {
			const item = list.results[rank];
			if (!item) continue;
			const rrfScore = 1 / (k + rank + 1); // rank is 0-based, +1 to make 1-based

			let entry = scoreMap.get(item.id);
			if (!entry) {
				const ranks: Record<string, number | null> = {};
				for (const m of methodNames) ranks[m] = null;
				entry = { score: 0, ranks };
				scoreMap.set(item.id, entry);
			}

			entry.score += rrfScore;
			entry.ranks[list.method] = rank + 1; // 1-based rank
		}
	}

	// Sort by fused score descending
	const results: FusedResult[] = [];
	for (const [id, entry] of scoreMap) {
		results.push({ id, score: entry.score, ranks: entry.ranks });
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, topK);
}
