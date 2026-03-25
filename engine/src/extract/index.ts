/**
 * Extract stage — public entry point.
 *
 * Facade: hides per-section extraction, validation, frame type registration,
 * and retry logic behind a single function call.
 *
 * Usage:
 *   import { extract } from "metis-engine/extract";
 *   const result = await extract({ chapter, comprehensionMap, ... });
 */
import type { NormalizedSection, SectionAnalysis } from "../comprehend/types";
import { validateAtoms } from "./atom-validator";
import { ExtractError } from "./errors";
import { extractSection } from "./section-extractor";
import type {
	CandidateAtom,
	ExtractInput,
	ExtractionResult,
	ProposedFrameType,
} from "./types";

export { createRegistry } from "./frame-registry";
export { ExtractError } from "./errors";
export type {
	CandidateAtom,
	ExtractionResult,
	ExtractInput,
	FrameType,
	FrameTypeRegistry,
	ProposedFrameType,
} from "./types";

const MIN_BLOCKS_THRESHOLD = 3;
const INTER_CALL_DELAY_MS = 100;

export async function extract(input: ExtractInput): Promise<ExtractionResult> {
	const { chapter, comprehensionMap, bookMetadata, registry, provider } = input;

	const allAtoms: CandidateAtom[] = [];
	const allProposed: ProposedFrameType[] = [];
	const skippedSections: string[] = [];
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let callCount = 0;

	// Collect all sections (recursive flatten)
	const sections = flattenSections(chapter.sections);

	for (let i = 0; i < sections.length; i++) {
		const section = sections[i];
		if (!section) continue;

		// Skip trivial sections
		if (countBlocks(section) < MIN_BLOCKS_THRESHOLD) {
			skippedSections.push(section.id);
			continue;
		}

		// Find matching SectionAnalysis
		const analysis =
			comprehensionMap.sectionAnalyses.find(
				(sa) => sa.sectionId === section.id,
			) ?? makeDefaultAnalysis(section);

		// Extract atoms from section
		const result = await extractSection(
			section,
			analysis,
			registry,
			bookMetadata,
			provider,
		);

		callCount++;
		totalInputTokens += result.usage.inputTokens;
		totalOutputTokens += result.usage.outputTokens;

		// Fill chapterId in source
		for (const atom of result.atoms) {
			atom.source.chapterId = chapter.id;
		}

		allAtoms.push(...result.atoms);

		// Register proposed types
		for (const proposed of result.proposedFrameTypes) {
			try {
				registry.register(proposed);
				allProposed.push(proposed);
			} catch {
				// Invalid proposal — skip
			}
		}

		// Rate limiting delay between calls
		if (i < sections.length - 1) {
			await sleep(INTER_CALL_DELAY_MS);
		}
	}

	// Validate all atoms
	const { valid, rejected } = validateAtoms(allAtoms, registry);
	if (rejected.length > 0) {
		console.warn(
			`Extract: ${rejected.length} atoms rejected from chapter "${chapter.title}"`,
		);
	}

	const flaggedAtoms = valid.filter((a) => a.flags.length > 0).map((a) => a.id);

	return {
		atoms: valid,
		proposedFrameTypes: allProposed,
		usage: {
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			callCount,
		},
		skippedSections,
		flaggedAtoms,
	};
}

function flattenSections(sections: NormalizedSection[]): NormalizedSection[] {
	const result: NormalizedSection[] = [];
	for (const s of sections) {
		result.push(s);
		result.push(...flattenSections(s.sections));
	}
	return result;
}

function countBlocks(section: NormalizedSection): number {
	return section.content.length;
}

function makeDefaultAnalysis(section: NormalizedSection): SectionAnalysis {
	return {
		sectionId: section.id,
		title: section.title,
		purpose: "",
		knowledgeTypes: [],
		conceptsIntroduced: [],
		conceptsReferenced: [],
		buildsOn: [],
		significance: "",
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
