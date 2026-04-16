/**
 * Knowledge Exchange (KX) format types — contract specification.
 * See design/07-knowledge-exchange.md for the full spec.
 */

export type StrictnessProfile = "casual" | "standard" | "strict";

export interface KXDocument {
	version: "kx/1.0";
	contentId: string;
	docId: string;
	profile: StrictnessProfile;
	meta: {
		domains: string[];
		sources: KXSource[];
		generatedBy?: string;
		generatedAt?: string;
	};
	units: KXUnit[];
	relations: KXRelation[];
}

export interface KXSpan {
	text: string;
	start?: number;
	end?: number;
}

export type KXExtractionMethod =
	| {
			method: "llm";
			provider: string;
			model: string;
			promptVersion: string;
			extractedAt: string;
	  }
	| { method: "human"; author: string; extractedAt: string }
	| {
			method: "algorithmic";
			tool: string;
			version: string;
			extractedAt: string;
	  };

export interface KXProvenance {
	quotedSpans: KXSpan[];
	roleSpans?: Record<string, KXSpan>;
	roleTypes?: Record<string, "verbatim" | "paraphrase">;
	extraction: KXExtractionMethod;
}

export interface KXUnit {
	id: string;
	kind: KXKind;
	content: string;
	roles?: Record<string, string>;
	provenance?: KXProvenance;
	conditions: string[];
	confidence: number;
	source: {
		ref: string;
		locations?: string[];
	};
	language?: string;
	domains: string[];
}

export type KXKind =
	| "definition"
	| "property"
	| "classification"
	| "causal"
	| "heuristic"
	| "principle"
	| "procedure"
	| "comparison"
	| "threshold"
	| "deviation"
	| "example"
	| "evaluation";

export interface KXRelation {
	from: string;
	to: string;
	type: KXRelationType;
	confidence: number;
	note?: string;
}

export type KXRelationType =
	| "reinforces"
	| "contradicts"
	| "extends"
	| "requires"
	| "exemplifies";

export interface KXSource {
	id: string;
	sourceId?: string;
	contentHash?: string;
	language?: string;
	type:
		| "book"
		| "article"
		| "case-study"
		| "notes"
		| "guide"
		| "transcript"
		| "other";
	title: string;
	authors?: string[];
	url?: string;
}

export interface GapsDocument {
	version: "gaps/1.0";
	query: string;
	gaps: Array<{
		type: string;
		description: string;
		severity: string;
		suggestion?: string;
	}>;
	stats: {
		totalAtomsRetrieved: number;
		contradictionsFound: number;
		gapsFound: number;
	};
}
