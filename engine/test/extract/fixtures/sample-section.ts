import type {
	NormalizedSection,
	SectionAnalysis,
} from "../../../src/comprehend/types";
import type { CandidateAtom } from "../../../src/extract/types";

export const sampleSection: NormalizedSection = {
	id: "s2",
	title: "Types of Systems",
	level: 1,
	content: [
		{
			type: "paragraph",
			text: "There are three main types of systems: simple, complicated, and complex.",
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
		{
			type: "paragraph",
			text: "Understanding which type you're dealing with determines your analysis approach.",
		},
	],
	sections: [],
};

export const sampleAnalysis: SectionAnalysis = {
	sectionId: "s2",
	title: "Types of Systems",
	purpose: "Introduces three-part taxonomy of system types",
	knowledgeTypes: ["taxonomy", "definition"],
	conceptsIntroduced: ["simple system", "complicated system", "complex system"],
	conceptsReferenced: ["system"],
	buildsOn: ["s1"],
	significance: "Core framework of the chapter",
};

/** A valid extraction response the mock provider would return */
export const sampleExtractionResponse = JSON.stringify({
	atoms: [
		{
			frame: "taxonomy",
			roles: {
				concept: "system types",
				categories: "simple, complicated, complex",
				basis: "predictability and emergent behavior",
			},
			conditions: ["when analyzing engineered systems"],
			confidence: 0.9,
			domain: ["systems-thinking"],
			examples: [
				"car engine (simple), airplane (complicated), ecosystem (complex)",
			],
		},
		{
			frame: "definition",
			roles: {
				term: "complex system",
				meaning: "a system with emergent behavior that is unpredictable",
			},
			conditions: [],
			confidence: 0.85,
			domain: ["systems-thinking"],
			examples: [],
		},
	],
	proposedFrameTypes: [],
});
