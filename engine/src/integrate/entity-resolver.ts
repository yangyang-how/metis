/**
 * Entity resolver — extract mentions, cluster, disambiguate, link across domains.
 *
 * The most complex module in the Integrate stage. Entity resolution is
 * "layered": merge within domain, link across domains.
 */
import type { CandidateAtom } from "../extract/types";
import type { EmbeddingProvider } from "../llm/embedding-types";
import type { LLMProvider } from "../llm/types";
import { buildDomainMap, normalizeDomain } from "./domain-normalizer";
import type { DomainMap } from "./domain-normalizer";
import { cosineSimilarity } from "./embedding-service";
import { entityDisambiguationPrompt } from "./prompts";
import type { Entity, EntityIndex, EntityMention, VectorIndex } from "./types";

// --- Configuration ---

/** Which roles are "entity-bearing" per frame type */
const ENTITY_ROLES: Record<string, string[]> = {
	definition: ["term"],
	has_property: ["entity"],
	is_a: ["instance", "category"],
	causal: ["cause", "effect"],
	causal_chain: ["trigger", "outcome"],
	threshold: ["metric"],
	heuristic: ["situation"],
	principle: ["statement"],
	method_comparison: ["method_a", "method_b"],
	formula: ["name"],
	procedure: ["goal"],
	sequence: ["name"],
	evaluation_matrix: ["name"],
	taxonomy: ["concept"],
	consists_of: ["whole"],
	example_of: ["concept"],
	deviation: ["theory"],
};

const MAX_MENTION_LENGTH = 60;
const CLUSTER_MERGE_THRESHOLD = 0.85;
const CLUSTER_AMBIGUOUS_THRESHOLD = 0.7;
const CROSS_DOMAIN_THRESHOLD = 0.75;
const DISAMBIGUATION_BATCH_SIZE = 20;

// --- Public API ---

export interface ResolveResult {
	entities: EntityIndex;
	stats: {
		newEntities: number;
		mergedEntities: number;
		crossDomainLinks: number;
		llmCalls: number;
	};
}

export function extractMentions(
	atoms: CandidateAtom[],
	domainMap?: DomainMap,
): EntityMention[] {
	const mentions: EntityMention[] = [];

	for (const atom of atoms) {
		const entityRoles = ENTITY_ROLES[atom.frame];
		if (!entityRoles) continue;

		const rawDomain = atom.domain[0] ?? "untagged";
		const domain = domainMap
			? normalizeDomain(rawDomain, domainMap)
			: rawDomain;

		for (const role of entityRoles) {
			const value = atom.roles[role];
			if (!value) continue;

			const text =
				value.length > MAX_MENTION_LENGTH
					? value.slice(0, MAX_MENTION_LENGTH)
					: value;

			mentions.push({
				text,
				normalized: text.toLowerCase().trim(),
				atomId: atom.id,
				role,
				frame: atom.frame,
				domain,
			});
		}
	}

	return mentions;
}

export interface MentionCluster {
	mentions: EntityMention[];
	domain: string;
	centroidText: string;
}

export async function clusterMentions(
	mentions: EntityMention[],
	embeddings: VectorIndex,
	provider: EmbeddingProvider,
	existingEntities: EntityIndex,
): Promise<MentionCluster[]> {
	// Group mentions by domain
	const byDomain = new Map<string, EntityMention[]>();
	for (const m of mentions) {
		const list = byDomain.get(m.domain) ?? [];
		list.push(m);
		byDomain.set(m.domain, list);
	}

	const allClusters: MentionCluster[] = [];

	for (const [domain, domainMentions] of byDomain) {
		// Pass 1: exact normalized match
		const exactGroups = new Map<string, EntityMention[]>();
		for (const m of domainMentions) {
			const list = exactGroups.get(m.normalized) ?? [];
			list.push(m);
			exactGroups.set(m.normalized, list);
		}

		const clusters: MentionCluster[] = [...exactGroups.entries()].map(
			([text, ms]) => ({
				mentions: ms,
				domain,
				centroidText: text,
			}),
		);

		// Pass 2: check if any cluster should merge into an existing entity
		const existingInDomain = Object.values(existingEntities).filter(
			(e) => e.domain === domain,
		);
		for (const cluster of clusters) {
			for (const existing of existingInDomain) {
				if (
					existing.canonicalName.toLowerCase() === cluster.centroidText ||
					existing.aliases.some((a) => a.toLowerCase() === cluster.centroidText)
				) {
					cluster.centroidText = existing.canonicalName.toLowerCase();
					break;
				}
			}
		}

		// Pass 3: embedding-based merge within domain
		// Batch-embed all centroid texts once, then compare in memory
		if (clusters.length > 1) {
			const centroidTexts = clusters.map((c) => c.centroidText);
			const centroidEmbeddings = await provider.embed(centroidTexts);

			for (let i = 0; i < clusters.length; i++) {
				for (let j = i + 1; j < clusters.length; j++) {
					const a = clusters[i];
					const b = clusters[j];
					if (!a || !b) continue;
					if (a.mentions.length === 0 || b.mentions.length === 0) continue;

					const embA = centroidEmbeddings[i];
					const embB = centroidEmbeddings[j];
					if (!embA || !embB) continue;
					const sim = cosineSimilarity(embA, embB);

					if (sim >= CLUSTER_MERGE_THRESHOLD) {
						a.mentions.push(...b.mentions);
						b.mentions = [];
					}
				}
			}
		}

		allClusters.push(...clusters.filter((c) => c.mentions.length > 0));
	}

	return allClusters;
}

export async function resolveEntities(
	newAtoms: CandidateAtom[],
	existingEntities: EntityIndex,
	embeddings: VectorIndex,
	embeddingProvider: EmbeddingProvider,
	llmProvider: LLMProvider,
): Promise<ResolveResult> {
	let llmCalls = 0;
	let newEntityCount = 0;
	let mergedCount = 0;

	// Step 0: Build domain normalization map
	const domainCounts = new Map<string, number>();
	for (const atom of newAtoms) {
		const d = atom.domain[0] ?? "untagged";
		domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
	}
	// Include existing entity domains so new atoms can merge into them
	for (const entity of Object.values(existingEntities)) {
		domainCounts.set(entity.domain, (domainCounts.get(entity.domain) ?? 0) + 1);
	}

	console.error(`[integrate] Normalizing ${domainCounts.size} domains...`);
	const domainMap = await buildDomainMap(domainCounts, embeddingProvider);
	console.error(
		`[integrate] Collapsed to ${domainMap.canonicals.size} canonical domains`,
	);

	// Step 1: Extract mentions from new atoms (with normalized domains)
	const mentions = extractMentions(newAtoms, domainMap);

	// Step 2: Cluster mentions
	const clusters = await clusterMentions(
		mentions,
		embeddings,
		embeddingProvider,
		existingEntities,
	);

	// Step 3: LLM disambiguation for ambiguous cluster pairs
	// Reuse centroid embeddings from clustering (batch-embed all cluster centroids)
	const allCentroidTexts = clusters
		.filter((c) => c.mentions.length > 0)
		.map((c) => c.centroidText);
	const allCentroidEmbeddings =
		allCentroidTexts.length > 0
			? await embeddingProvider.embed(allCentroidTexts)
			: [];
	const centroidEmbMap = new Map<string, number[]>();
	for (let i = 0; i < allCentroidTexts.length; i++) {
		const text = allCentroidTexts[i];
		const emb = allCentroidEmbeddings[i];
		if (text && emb) centroidEmbMap.set(text, emb);
	}

	const disambiguationPairs: Array<{
		a: MentionCluster;
		b: MentionCluster;
	}> = [];
	for (let i = 0; i < clusters.length; i++) {
		for (let j = i + 1; j < clusters.length; j++) {
			const a = clusters[i];
			const b = clusters[j];
			if (!a || !b) continue;
			if (a.domain !== b.domain) continue;
			if (a.mentions.length === 0 || b.mentions.length === 0) continue;

			const tA = centroidEmbMap.get(a.centroidText);
			const tB = centroidEmbMap.get(b.centroidText);
			if (!tA || !tB) continue;
			const sim = cosineSimilarity(tA, tB);
			if (sim >= CLUSTER_AMBIGUOUS_THRESHOLD && sim < CLUSTER_MERGE_THRESHOLD) {
				disambiguationPairs.push({ a, b });
			}
		}
	}

	for (
		let i = 0;
		i < disambiguationPairs.length;
		i += DISAMBIGUATION_BATCH_SIZE
	) {
		const batch = disambiguationPairs.slice(i, i + DISAMBIGUATION_BATCH_SIZE);
		const promptPairs = batch.map((p) => ({
			a: p.a.centroidText,
			b: p.b.centroidText,
		}));
		const domain = batch[0]?.a.domain ?? "unknown";

		try {
			const response = await llmProvider.sendMessage({
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: entityDisambiguationPrompt(domain, promptPairs),
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
					decisions?: Array<{ pair: number; decision: string }>;
				};
				for (const d of parsed.decisions ?? []) {
					const pair = batch[d.pair - 1];
					if (!pair) continue;
					if (d.decision === "merge") {
						pair.a.mentions.push(...pair.b.mentions);
						pair.b.mentions = [];
					}
				}
			}
		} catch (err) {
			console.warn(
				`[integrate] Entity disambiguation LLM call failed — treating as separate: ${(err as Error).message?.slice(0, 100)}`,
			);
		}
	}

	// Filter out empty clusters after disambiguation
	const finalClusters = clusters.filter((c) => c.mentions.length > 0);

	// Step 4: Build/update entity index
	const entities: EntityIndex = { ...existingEntities };

	for (const cluster of finalClusters) {
		const canonicalName = cluster.centroidText;
		const domain = cluster.domain;
		const atomIds = [...new Set(cluster.mentions.map((m) => m.atomId))];
		const aliases = [...new Set(cluster.mentions.map((m) => m.text))].filter(
			(a) => a.toLowerCase() !== canonicalName,
		);

		// Check if this merges into an existing entity
		// Normalize existing entity domain for comparison
		const existingEntity = Object.values(entities).find((e) => {
			const eDomain = normalizeDomain(e.domain, domainMap);
			return (
				eDomain === domain &&
				(e.canonicalName.toLowerCase() === canonicalName ||
					e.aliases.some((a) => a.toLowerCase() === canonicalName))
			);
		});

		if (existingEntity) {
			existingEntity.atomIds = [
				...new Set([...existingEntity.atomIds, ...atomIds]),
			];
			existingEntity.aliases = [
				...new Set([...existingEntity.aliases, ...aliases]),
			];
			mergedCount++;
		} else {
			const slug = canonicalName
				.toLowerCase()
				.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 40);
			const id = `entity:${slug}-${domain.replace(/\s+/g, "-").slice(0, 20)}`;

			entities[id] = {
				id,
				canonicalName,
				aliases,
				domain,
				atomIds,
				crossDomainLinks: [],
			};
			newEntityCount++;
		}
	}

	// Step 5: Cross-domain linking
	let crossDomainLinkCount = 0;
	const entityList = Object.values(entities);
	const domains = [...new Set(entityList.map((e) => e.domain))];

	if (domains.length > 1) {
		const entityNames = entityList.map((e) => e.canonicalName);
		const nameEmbeddings = await embeddingProvider.embed(entityNames);

		for (let i = 0; i < entityList.length; i++) {
			for (let j = i + 1; j < entityList.length; j++) {
				const eA = entityList[i];
				const eB = entityList[j];
				if (!eA || !eB) continue;
				if (eA.domain === eB.domain) continue;

				const nA = nameEmbeddings[i];
				const nB = nameEmbeddings[j];
				if (!nA || !nB) continue;
				const sim = cosineSimilarity(nA, nB);
				if (sim >= CROSS_DOMAIN_THRESHOLD) {
					if (!eA.crossDomainLinks.includes(eB.id)) {
						eA.crossDomainLinks.push(eB.id);
					}
					if (!eB.crossDomainLinks.includes(eA.id)) {
						eB.crossDomainLinks.push(eA.id);
					}
					crossDomainLinkCount++;
				}
			}
		}
	}

	return {
		entities,
		stats: {
			newEntities: newEntityCount,
			mergedEntities: mergedCount,
			crossDomainLinks: crossDomainLinkCount,
			llmCalls,
		},
	};
}
