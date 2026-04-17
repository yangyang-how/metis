import { comprehend } from "../comprehend/index";
import { normalizeChapters } from "../comprehend/structure-inference";
import { assignContentIds } from "../extract/atom-id";
import { createRegistry, extract } from "../extract/index";
import type { CandidateAtom } from "../extract/types";
import type { LLMProvider } from "../llm/types";
import type { DocumentTree } from "../parse/types";
import type { StrictnessProfile } from "./config";

export interface LearnSourceInput {
	tree: DocumentTree;
	sourceId: string;
	contentHash: string;
	profile: StrictnessProfile;
	comprehendProvider: LLMProvider;
	extractProvider: LLMProvider;
}

export interface LearnSourceResult {
	atoms: CandidateAtom[];
	usage: {
		comprehendCalls: number;
		extractCalls: number;
		inputTokens: number;
		outputTokens: number;
	};
	skippedSections: string[];
	rejectedAtoms: number;
}

/**
 * Learn a single source: comprehend → extract → validate → assign IDs.
 *
 * Extracted from run-pipeline.ts for reuse by the project-level orchestrator.
 * Does NOT integrate into the graph — that's the caller's job after all
 * sources are processed (full-rebuild integration).
 */
export async function learnSource(
	input: LearnSourceInput,
): Promise<LearnSourceResult> {
	const {
		tree,
		sourceId,
		contentHash,
		profile,
		comprehendProvider,
		extractProvider,
	} = input;

	// Phase 1: Comprehend
	const comprehendResult = await comprehend({
		documentTree: tree,
		provider: comprehendProvider,
	});

	// Phase 2: Extract
	const registry = createRegistry();
	const normalizedChapters = normalizeChapters(tree);

	let allAtoms: CandidateAtom[] = [];
	let totalExtractCalls = 0;
	let totalInput =
		comprehendResult.usage.totalInputTokens;
	let totalOutput =
		comprehendResult.usage.totalOutputTokens;
	const skippedSections: string[] = [];

	for (const chapter of normalizedChapters) {
		const map = comprehendResult.chapterMaps.find(
			(m) => m.chapterId === chapter.id,
		);
		if (!map) continue;

		const result = await extract({
			chapter,
			comprehensionMap: map,
			bookMetadata: tree.metadata,
			registry,
			provider: extractProvider,
		});

		totalExtractCalls += result.usage.callCount;
		totalInput += result.usage.inputTokens;
		totalOutput += result.usage.outputTokens;
		skippedSections.push(...result.skippedSections);

		// Stamp source provenance onto each atom
		const stamped = result.atoms.map((atom) => ({
			...atom,
			source: {
				...atom.source,
				sourceId,
				contentHash,
			},
		}));

		allAtoms.push(...stamped);
	}

	// Phase 3: Filter by confidence
	const minConfidence =
		profile === "strict" ? 0.7 : profile === "standard" ? 0.6 : 0;
	const beforeCount = allAtoms.length;
	if (minConfidence > 0) {
		allAtoms = allAtoms.filter((a) => a.confidence >= minConfidence);
	}

	// Phase 4: Assign content-addressed IDs
	allAtoms = assignContentIds(allAtoms);

	return {
		atoms: allAtoms,
		usage: {
			comprehendCalls: comprehendResult.usage.callCount,
			extractCalls: totalExtractCalls,
			inputTokens: totalInput,
			outputTokens: totalOutput,
		},
		skippedSections,
		rejectedAtoms: beforeCount - allAtoms.length,
	};
}
