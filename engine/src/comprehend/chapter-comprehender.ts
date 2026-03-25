/**
 * Chapter comprehender — one LLM call per chapter.
 *
 * Takes a NormalizedChapter, builds the prompt, calls the LLM, parses
 * the response, and returns a ComprehensionMap.
 *
 * Two layers of error handling:
 * - Provider-level: network errors, rate limits (handled by withRetry)
 * - Response-level: malformed JSON (handled by inner retry loop here)
 */
import type { LLMProvider } from "../llm/types";
import type { DocumentMetadata } from "../parse/types";
import { buildChapterPrompt, getComprehensionMapSchema } from "./prompts";
import type {
	ComprehensionMap,
	KnowledgeStructure,
	NormalizedChapter,
	SectionAnalysis,
} from "./types";

const MAX_PARSE_RETRIES = 2;

export interface ChapterComprehendResult {
	map: ComprehensionMap;
	usage: { inputTokens: number; outputTokens: number };
	failed: boolean;
}

export async function comprehendChapter(
	chapter: NormalizedChapter,
	bookMetadata: DocumentMetadata,
	provider: LLMProvider,
): Promise<ChapterComprehendResult> {
	const messages = buildChapterPrompt(chapter, bookMetadata, {
		vision: provider.capabilities.vision,
	});

	let totalInput = 0;
	let totalOutput = 0;

	// Inner retry loop for JSON parsing failures
	for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
		try {
			const response = await provider.sendMessage({
				messages,
				responseSchema: getComprehensionMapSchema(),
				temperature: 0.2,
				maxTokens: 8192,
			});

			totalInput += response.usage.inputTokens;
			totalOutput += response.usage.outputTokens;

			const parsed = parseResponse(response.content, chapter);
			if (parsed) {
				runQualityChecks(parsed, chapter);
				return {
					map: parsed,
					usage: { inputTokens: totalInput, outputTokens: totalOutput },
					failed: false,
				};
			}
			// JSON was invalid — retry
		} catch {
			// Provider error (network, etc.) — fall through to minimal map
			break;
		}
	}

	// All retries exhausted or provider error — return minimal map
	return {
		map: buildMinimalMap(chapter),
		usage: { inputTokens: totalInput, outputTokens: totalOutput },
		failed: true,
	};
}

function parseResponse(
	content: string,
	chapter: NormalizedChapter,
): ComprehensionMap | null {
	try {
		// Strip markdown code fences if the model wrapped the JSON
		let cleaned = content.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}

		const raw = JSON.parse(cleaned);

		// Normalize field names — models sometimes use snake_case despite instructions
		const parsed = {
			chapterType: raw.chapterType ?? raw.chapter_type,
			summary: raw.summary ?? raw.chapter_purpose ?? "",
			structures: raw.structures ?? raw.knowledge_structures,
			sectionAnalyses:
				raw.sectionAnalyses ?? raw.section_analyses ?? raw.sections,
		};

		// Structural validation: must have required fields
		const chapterType = parsed.chapterType;
		const structures = Array.isArray(parsed.structures)
			? parsed.structures
			: [];
		const sectionAnalyses = Array.isArray(parsed.sectionAnalyses)
			? parsed.sectionAnalyses
			: [];

		if (!chapterType) {
			return null;
		}

		// Normalize section analyses field names too
		const normalizedAnalyses: SectionAnalysis[] = sectionAnalyses.map(
			(sa: Record<string, unknown>) => ({
				sectionId: String(sa.sectionId ?? sa.section_id ?? sa.id ?? ""),
				title: String(sa.title ?? ""),
				purpose: String(sa.purpose ?? ""),
				knowledgeTypes: (sa.knowledgeTypes ??
					sa.knowledge_types ??
					sa.types ??
					[]) as string[],
				conceptsIntroduced: (sa.conceptsIntroduced ??
					sa.concepts_introduced ??
					sa.new_concepts ??
					[]) as string[],
				conceptsReferenced: (sa.conceptsReferenced ??
					sa.concepts_referenced ??
					sa.referenced_concepts ??
					[]) as string[],
				buildsOn: (sa.buildsOn ??
					sa.builds_on ??
					sa.dependencies ??
					[]) as string[],
				significance: String(sa.significance ?? ""),
			}),
		);

		// Normalize structures field names
		const normalizedStructures: KnowledgeStructure[] = structures.map(
			(s: unknown) => {
				if (typeof s === "string") {
					return {
						name: s,
						type: "model" as const,
						components: [],
						sectionIds: [],
					};
				}
				const obj = s as Record<string, unknown>;
				return {
					name: String(obj.name ?? ""),
					type: String(obj.type ?? "model") as KnowledgeStructure["type"],
					components: (obj.components ?? []) as string[],
					sectionIds: (obj.sectionIds ?? obj.section_ids ?? []) as string[],
				};
			},
		);

		return {
			chapterId: chapter.id,
			chapterType: chapterType as ComprehensionMap["chapterType"],
			summary: parsed.summary,
			structures: normalizedStructures,
			sectionAnalyses: normalizedAnalyses,
		};
	} catch {
		return null;
	}
}

function runQualityChecks(
	map: ComprehensionMap,
	chapter: NormalizedChapter,
): void {
	const expectedSections = countSections(chapter);
	const actualSections = map.sectionAnalyses.length;

	if (actualSections < expectedSections * 0.5) {
		console.warn(
			`Quality warning: chapter "${chapter.title}" has ${expectedSections} sections but map only has ${actualSections} analyses`,
		);
	}

	if (map.structures.length === 0) {
		console.warn(
			`Quality warning: chapter "${chapter.title}" has no knowledge structures`,
		);
	}
}

function countSections(chapter: NormalizedChapter): number {
	let count = 0;
	function walk(sections: NormalizedChapter["sections"]): void {
		for (const s of sections) {
			count++;
			walk(s.sections);
		}
	}
	walk(chapter.sections);
	return count;
}

function buildMinimalMap(chapter: NormalizedChapter): ComprehensionMap {
	const sectionAnalyses: SectionAnalysis[] = [];

	function walkSections(sections: NormalizedChapter["sections"]): void {
		for (const s of sections) {
			sectionAnalyses.push({
				sectionId: s.id,
				title: s.title,
				purpose: "",
				knowledgeTypes: [],
				conceptsIntroduced: [],
				conceptsReferenced: [],
				buildsOn: [],
				significance: "",
			});
			walkSections(s.sections);
		}
	}

	walkSections(chapter.sections);

	return {
		chapterId: chapter.id,
		chapterType: "unknown",
		summary: "",
		structures: [],
		sectionAnalyses,
	};
}
