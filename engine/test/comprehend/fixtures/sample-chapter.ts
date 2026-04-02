import type {
	ComprehensionMap,
	NormalizedChapter,
} from "../../../src/comprehend/types";
/**
 * Sample NormalizedChapter for testing.
 * Resembles a real chapter from a framework/methodology book.
 */
import type { DocumentMetadata } from "../../../src/parse/types";

export const sampleMetadata: DocumentMetadata = {
	title: "Test Book: Understanding Systems",
	authors: ["Test Author"],
	language: "en",
};

export const sampleChapter: NormalizedChapter = {
	id: "ch1",
	title: "Chapter 1: Foundations",
	order: 0,
	sections: [
		{
			id: "s1",
			title: "What Is a System?",
			level: 1,
			content: [
				{
					type: "paragraph",
					text: "A system is a set of interconnected components that work together.",
				},
				{
					type: "paragraph",
					text: "Systems can be classified by their complexity and behavior.",
				},
			],
			sections: [],
		},
		{
			id: "s2",
			title: "Types of Systems",
			level: 1,
			content: [
				{
					type: "paragraph",
					text: "There are three main types: simple, complicated, and complex.",
				},
				{
					type: "list",
					ordered: false,
					items: [
						{ text: "Simple: predictable, few parts" },
						{ text: "Complicated: many parts, but predictable" },
						{ text: "Complex: emergent behavior, unpredictable" },
					],
				},
			],
			sections: [],
		},
		{
			id: "s3",
			title: "Why This Matters",
			level: 1,
			content: [
				{
					type: "paragraph",
					text: "Understanding system types helps you choose the right analysis approach.",
				},
			],
			sections: [],
		},
	],
	metadata: {
		totalBlockCount: 6,
		hasImages: false,
		estimatedTokens: 500,
	},
};

/** A valid ComprehensionMap response for the sample chapter */
export const sampleComprehensionMap: ComprehensionMap = {
	chapterId: "ch1",
	chapterType: "framework",
	summary:
		"Introduces systems thinking with a three-part taxonomy of system types.",
	structures: [
		{
			name: "System type taxonomy",
			type: "taxonomy",
			components: ["Simple", "Complicated", "Complex"],
			sectionIds: ["s2"],
		},
	],
	sectionAnalyses: [
		{
			sectionId: "s1",
			title: "What Is a System?",
			purpose: "Defines the concept of a system",
			knowledgeTypes: ["definition"],
			conceptsIntroduced: ["system", "interconnected components"],
			conceptsReferenced: [],
			buildsOn: [],
			significance: "Foundation for the chapter's taxonomy",
		},
		{
			sectionId: "s2",
			title: "Types of Systems",
			purpose: "Introduces three-part taxonomy",
			knowledgeTypes: ["taxonomy", "definition", "comparison"],
			conceptsIntroduced: [
				"simple system",
				"complicated system",
				"complex system",
			],
			conceptsReferenced: ["system"],
			buildsOn: ["s1"],
			significance: "Core framework of the chapter",
		},
		{
			sectionId: "s3",
			title: "Why This Matters",
			purpose: "Motivates the taxonomy",
			knowledgeTypes: ["heuristic"],
			conceptsIntroduced: [],
			conceptsReferenced: ["system types", "analysis approach"],
			buildsOn: ["s2"],
			significance: "Connects theory to practice",
		},
	],
};
