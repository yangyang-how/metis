/**
 * Prompt templates for the Comprehend stage.
 *
 * Separated from pipeline logic because prompt engineering is its own
 * iteration cycle. This file changes frequently; the pipeline doesn't.
 */
import type { Message, MessageContent } from "../llm/types";
import type { DocumentMetadata } from "../parse/types";
import { serializeSection } from "./serialize";
import type { ComprehensionMap, NormalizedChapter } from "./types";

export function buildChapterPrompt(
	chapter: NormalizedChapter,
	bookMetadata: DocumentMetadata,
	options?: { vision?: boolean },
): Message[] {
	const systemMessage: Message = {
		role: "system",
		content: [
			{
				type: "text",
				text: `You are an expert reader analyzing a book chapter. Your job is to produce a structured comprehension map that will guide a downstream system in extracting atomic knowledge from each section.

You will receive:
- The chapter's title, position in the book, and metadata
- The chapter's sections with their content

Produce a JSON object matching the provided schema. Focus on:
1. What TYPE of chapter is this? (framework, survey, argumentative, narrative, practical)
2. What KNOWLEDGE STRUCTURES does it contain? (models, comparisons, taxonomies, progressions, processes, debates)
3. For EACH SECTION: what is its purpose, what kinds of knowledge should be extracted, and what concepts does it introduce or reference?

Think about what an extractor needs to know to pull the right atoms from each section. Do not extract atoms yourself — describe what's there so the extractor knows what to look for.

Respond with valid JSON only. No markdown code fences. No explanation outside the JSON.`,
			},
		],
	};

	// Build user message with chapter content
	const userContent: MessageContent[] = [
		{
			type: "text",
			text: `Book: "${bookMetadata.title}" by ${bookMetadata.authors.join(", ")}
Chapter ${chapter.order + 1}: "${chapter.title}"
Sections: ${chapter.sections.length}

---

`,
		},
	];

	// Serialize each section's content
	for (const section of chapter.sections) {
		const sectionParts = serializeSection(section, options);
		userContent.push(...sectionParts);
	}

	const userMessage: Message = {
		role: "user",
		content: userContent,
	};

	return [systemMessage, userMessage];
}

export function buildSynthesisPrompt(
	chapterMaps: ComprehensionMap[],
	bookMetadata: DocumentMetadata,
): Message[] {
	const systemMessage: Message = {
		role: "system",
		content: [
			{
				type: "text",
				text: `You have read comprehension maps for every chapter of a book. Identify cross-cutting themes that span multiple chapters and build an entity index of key concepts with their aliases.

You do NOT have the raw chapter content — only the chapter maps. Work from those.

Respond with valid JSON only. No markdown code fences. No explanation outside the JSON.`,
			},
		],
	};

	const mapsText = chapterMaps
		.map(
			(m) =>
				`Chapter "${m.chapterId}" (${m.chapterType}): ${m.summary}\nStructures: ${m.structures.map((s) => s.name).join(", ")}\nConcepts: ${[...new Set(m.sectionAnalyses.flatMap((sa) => sa.conceptsIntroduced))].join(", ")}`,
		)
		.join("\n\n");

	const userMessage: Message = {
		role: "user",
		content: [
			{
				type: "text",
				text: `Book: "${bookMetadata.title}" by ${bookMetadata.authors.join(", ")}
Chapters analyzed: ${chapterMaps.length}

--- Chapter Maps ---

${mapsText}`,
			},
		],
	};

	return [systemMessage, userMessage];
}

export function getComprehensionMapSchema(): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			chapterId: { type: "string" },
			chapterType: {
				type: "string",
				enum: [
					"framework",
					"survey",
					"argumentative",
					"narrative",
					"practical",
				],
			},
			summary: { type: "string" },
			structures: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						type: {
							type: "string",
							enum: [
								"model",
								"comparison",
								"taxonomy",
								"progression",
								"process",
								"debate",
							],
						},
						components: { type: "array", items: { type: "string" } },
						sectionIds: { type: "array", items: { type: "string" } },
					},
					required: ["name", "type", "components", "sectionIds"],
				},
			},
			sectionAnalyses: {
				type: "array",
				items: {
					type: "object",
					properties: {
						sectionId: { type: "string" },
						title: { type: "string" },
						purpose: { type: "string" },
						knowledgeTypes: {
							type: "array",
							items: { type: "string" },
						},
						conceptsIntroduced: {
							type: "array",
							items: { type: "string" },
						},
						conceptsReferenced: {
							type: "array",
							items: { type: "string" },
						},
						buildsOn: { type: "array", items: { type: "string" } },
						significance: { type: "string" },
					},
					required: [
						"sectionId",
						"title",
						"purpose",
						"knowledgeTypes",
						"conceptsIntroduced",
						"conceptsReferenced",
						"buildsOn",
						"significance",
					],
				},
			},
		},
		required: [
			"chapterId",
			"chapterType",
			"summary",
			"structures",
			"sectionAnalyses",
		],
	};
}

export function getBookSynthesisSchema(): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			crossCuttingThemes: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						description: { type: "string" },
						chapterIds: { type: "array", items: { type: "string" } },
					},
					required: ["name", "description", "chapterIds"],
				},
			},
			entityIndex: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						aliases: { type: "array", items: { type: "string" } },
						chapterIds: { type: "array", items: { type: "string" } },
					},
					required: ["name", "aliases", "chapterIds"],
				},
			},
			bookType: { type: "string" },
		},
		required: ["crossCuttingThemes", "entityIndex", "bookType"],
	};
}
