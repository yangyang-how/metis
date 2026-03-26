/**
 * Chapter comprehender — one LLM call per chapter (or split if too large).
 *
 * Takes a NormalizedChapter, builds the prompt, calls the LLM, parses
 * the response, and returns a ComprehensionMap.
 *
 * For large chapters that exceed the token budget, splits at section
 * boundaries into sub-chapters, comprehends each separately, then
 * merges the results.
 *
 * Two layers of error handling:
 * - Provider-level: network errors, rate limits (handled by withRetry)
 * - Response-level: malformed JSON (handled by inner retry loop here)
 */
import type { LLMProvider } from "../llm/types";
import type { DocumentMetadata } from "../parse/types";
import { buildChapterPrompt, getComprehensionMapSchema } from "./prompts";
import { serializeBlocks } from "./serialize";
import { estimateTokens } from "./token-estimator";
import type {
	ComprehensionMap,
	KnowledgeStructure,
	NormalizedChapter,
	NormalizedSection,
	SectionAnalysis,
} from "./types";

const MAX_PARSE_RETRIES = 2;
// Token budget: leave room for prompt overhead (~2k) + reasoning (~8k) + output (~4k)
const MAX_CONTENT_TOKENS = 6000;

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
	// Check if chapter is too large and needs splitting
	if (chapter.metadata.estimatedTokens > MAX_CONTENT_TOKENS) {
		return comprehendLargeChapter(chapter, bookMetadata, provider);
	}

	return comprehendSingleChapter(chapter, bookMetadata, provider);
}

/**
 * Split a large chapter into sub-chapters at section boundaries,
 * comprehend each separately, then merge results.
 */
async function comprehendLargeChapter(
	chapter: NormalizedChapter,
	bookMetadata: DocumentMetadata,
	provider: LLMProvider,
): Promise<ChapterComprehendResult> {
	const subChapters = splitChapter(chapter);
	console.error(
		`    [split] Chapter "${chapter.title.slice(0, 40)}" too large (${chapter.metadata.estimatedTokens} tokens), split into ${subChapters.length} parts`,
	);

	const subMaps: ComprehensionMap[] = [];
	let totalInput = 0;
	let totalOutput = 0;
	let anySucceeded = false;

	for (const sub of subChapters) {
		const result = await comprehendSingleChapter(sub, bookMetadata, provider);
		totalInput += result.usage.inputTokens;
		totalOutput += result.usage.outputTokens;
		if (!result.failed) {
			subMaps.push(result.map);
			anySucceeded = true;
		}
	}

	if (!anySucceeded) {
		return {
			map: buildMinimalMap(chapter),
			usage: { inputTokens: totalInput, outputTokens: totalOutput },
			failed: true,
		};
	}

	// Merge sub-maps into one
	const merged = mergeMaps(chapter.id, subMaps);

	return {
		map: merged,
		usage: { inputTokens: totalInput, outputTokens: totalOutput },
		failed: false,
	};
}

/**
 * Split a chapter into sub-chapters, each under the token budget.
 * Groups consecutive sections until the token limit is reached.
 */
function splitChapter(chapter: NormalizedChapter): NormalizedChapter[] {
	const subChapters: NormalizedChapter[] = [];
	let currentSections: NormalizedSection[] = [];
	let currentTokens = 0;
	let partIndex = 0;

	for (const section of chapter.sections) {
		const sectionText = serializeBlocks(section.content)
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join("");
		const sectionTokens = estimateTokens(sectionText);

		// If adding this section would exceed budget, flush current group
		if (
			currentTokens + sectionTokens > MAX_CONTENT_TOKENS &&
			currentSections.length > 0
		) {
			subChapters.push(makeSubChapter(chapter, currentSections, partIndex));
			partIndex++;
			currentSections = [];
			currentTokens = 0;
		}

		currentSections.push(section);
		currentTokens += sectionTokens;

		// If a single section exceeds the budget, flush it alone
		if (sectionTokens > MAX_CONTENT_TOKENS) {
			subChapters.push(makeSubChapter(chapter, currentSections, partIndex));
			partIndex++;
			currentSections = [];
			currentTokens = 0;
		}
	}

	// Flush remaining
	if (currentSections.length > 0) {
		subChapters.push(makeSubChapter(chapter, currentSections, partIndex));
	}

	return subChapters;
}

function makeSubChapter(
	parent: NormalizedChapter,
	sections: NormalizedSection[],
	partIndex: number,
): NormalizedChapter {
	let totalBlocks = 0;
	let hasImages = false;
	let allText = "";

	for (const s of sections) {
		totalBlocks += s.content.length;
		for (const b of s.content) {
			if (b.type === "image") hasImages = true;
			if ("text" in b && typeof b.text === "string") allText += b.text;
		}
	}

	return {
		id: parent.id,
		title: `${parent.title} (part ${partIndex + 1})`,
		order: parent.order,
		sections,
		metadata: {
			totalBlockCount: totalBlocks,
			hasImages,
			estimatedTokens: estimateTokens(allText),
		},
	};
}

/**
 * Merge multiple ComprehensionMaps from sub-chapters into one.
 */
function mergeMaps(
	chapterId: string,
	maps: ComprehensionMap[],
): ComprehensionMap {
	const first = maps[0];
	if (!first) return buildMinimalMapFromId(chapterId);

	// chapterType: use the most common non-unknown type
	const typeCounts: Record<string, number> = {};
	for (const m of maps) {
		if (m.chapterType !== "unknown") {
			typeCounts[m.chapterType] = (typeCounts[m.chapterType] || 0) + 1;
		}
	}
	const chapterType =
		(Object.entries(typeCounts).sort(
			(a, b) => b[1] - a[1],
		)[0]?.[0] as ComprehensionMap["chapterType"]) ?? first.chapterType;

	// summary: use the first sub-map's summary (it has the chapter intro)
	const summary = first.summary;

	// structures: concatenate, deduplicate by name
	const seenStructures = new Set<string>();
	const structures: KnowledgeStructure[] = [];
	for (const m of maps) {
		for (const s of m.structures) {
			if (!seenStructures.has(s.name)) {
				seenStructures.add(s.name);
				structures.push(s);
			}
		}
	}

	// sectionAnalyses: concatenate all
	const sectionAnalyses: SectionAnalysis[] = [];
	for (const m of maps) {
		sectionAnalyses.push(...m.sectionAnalyses);
	}

	return {
		chapterId,
		chapterType,
		summary,
		structures,
		sectionAnalyses,
	};
}

async function comprehendSingleChapter(
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
			const response = await withTimeout(
				provider.sendMessage({
					messages,
					responseSchema: getComprehensionMapSchema(),
					temperature: 0.2,
					maxTokens: 16384,
				}),
				180_000,
			);

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
		} catch {
			break;
		}
	}

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
		let cleaned = content.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}

		const raw = JSON.parse(cleaned);

		const parsed = {
			chapterType: raw.chapterType ?? raw.chapter_type,
			summary: raw.summary ?? raw.chapter_purpose ?? "",
			structures: raw.structures ?? raw.knowledge_structures,
			sectionAnalyses:
				raw.sectionAnalyses ?? raw.section_analyses ?? raw.sections,
		};

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

function buildMinimalMapFromId(chapterId: string): ComprehensionMap {
	return {
		chapterId,
		chapterType: "unknown",
		summary: "",
		structures: [],
		sectionAnalyses: [],
	};
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
		),
	]);
}
