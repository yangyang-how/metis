/**
 * Knowledge Exchange (KX) format types.
 * Portable interchange between Metis, Seisei, and other tools.
 * See design/07-knowledge-exchange.md for the full spec.
 */

export interface KXDocument {
  version: "kx/1.0";
  meta: {
    domains: string[];
    sources: KXSource[];
    generatedBy?: string;
    generatedAt?: string;
  };
  units: KXUnit[];
  relations: KXRelation[];
}

export interface KXUnit {
  id: string;
  kind: KXKind;
  content: string;
  roles?: Record<string, string>;
  conditions: string[];
  confidence: number;
  source: {
    ref: string;
    location?: string;
  };
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
  type: "book" | "article" | "case-study" | "notes" | "guide" | "transcript" | "other";
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
