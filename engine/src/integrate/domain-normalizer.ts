/**
 * Domain normalizer — collapse 1000+ micro-domains into ~30-50 canonical domains.
 *
 * The Extract LLM produces hyper-specific domain tags like "减肥案例",
 * "减肥策略", "减肥速度" when they should all be "减肥". This module
 * embeds all unique domain names and clusters them by similarity.
 *
 * Runs once at the start of entity resolution, before any clustering.
 */
import type { EmbeddingProvider } from "../llm/embedding-types";
import { cosineSimilarity } from "./embedding-service";

const DOMAIN_MERGE_THRESHOLD = 0.82;
const MIN_DOMAIN_COUNT = 3;

export interface DomainMap {
	/** Maps raw domain string → canonical domain string */
	mapping: Map<string, string>;
	/** Canonical domains with their member count */
	canonicals: Map<string, number>;
}

/**
 * Build a domain normalization map by embedding and clustering domain names.
 *
 * Strategy:
 * 1. Collect all unique domain names with their atom counts
 * 2. Embed all domain names in one batch
 * 3. Greedy clustering: most frequent domain becomes cluster center,
 *    absorb all domains within threshold
 * 4. Return mapping from raw → canonical
 */
export async function buildDomainMap(
	domainCounts: Map<string, number>,
	provider: EmbeddingProvider,
): Promise<DomainMap> {
	const domains = [...domainCounts.entries()]
		.sort((a, b) => b[1] - a[1]); // most frequent first

	if (domains.length === 0) {
		return { mapping: new Map(), canonicals: new Map() };
	}

	// Embed all domain names
	const domainNames = domains.map(([name]) => name);
	const embeddings = await provider.embed(domainNames);

	const mapping = new Map<string, string>();
	const canonicals = new Map<string, number>();
	const assigned = new Set<number>();

	// Greedy clustering: pick most frequent unassigned domain as center
	for (let i = 0; i < domains.length; i++) {
		if (assigned.has(i)) continue;

		const [centerName, centerCount] = domains[i]!;
		const centerEmb = embeddings[i];
		if (!centerEmb) continue;

		assigned.add(i);
		mapping.set(centerName, centerName);
		let totalCount = centerCount;

		// Find all unassigned domains within threshold
		for (let j = i + 1; j < domains.length; j++) {
			if (assigned.has(j)) continue;

			const candidateEmb = embeddings[j];
			if (!candidateEmb) continue;

			const sim = cosineSimilarity(centerEmb, candidateEmb);
			if (sim >= DOMAIN_MERGE_THRESHOLD) {
				const [candidateName, candidateCount] = domains[j]!;
				assigned.add(j);
				mapping.set(candidateName, centerName);
				totalCount += candidateCount;
			}
		}

		canonicals.set(centerName, totalCount);
	}

	return { mapping, canonicals };
}

/**
 * Normalize a domain string using the domain map.
 * Returns the canonical domain, or the original if not in the map.
 */
export function normalizeDomain(
	domain: string,
	domainMap: DomainMap,
): string {
	return domainMap.mapping.get(domain) ?? domain;
}
