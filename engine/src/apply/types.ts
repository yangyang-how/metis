// engine/src/apply/types.ts
/**
 * Apply pipeline types — all interfaces for the 5-stage query pipeline.
 *
 * Stages: Understand → Retrieve+Rerank → Traverse → DetectGaps → Compose
 */
import type { Atom, EdgeType, EntityIndex, GraphIndex, VectorIndex } from "../integrate/types";
import type { RetrievalResult } from "../retrieve/index";

// --- Stage 1: Understand ---

export interface QueryInput {
  query: string;
  scope?: {
    domains?: string[];
    sources?: string[];
    frameTypes?: string[];
  };
}

export interface QueryPlan {
  intent: string;
  analysisType: string;
  targetDomains: string[];
  targetFrameTypes: string[];
  targetEntities: string[];
  weights: {
    domainMatch: number;
    frameTypeMatch: number;
    entityMatch: number;
  };
  groupingStrategy: GroupingStrategy;
}

export type GroupingStrategy = "entity" | "domain" | "frame-type";

export interface RerankOptions {
  results: RetrievalResult[];
  plan: QueryPlan;
}

export interface GraphInventory {
  domains: Array<{ name: string; atomCount: number }>;
  entities: Array<{ name: string; aliases: string[]; domain: string }>;
  frameTypes: Array<{ name: string; count: number }>;
  sources: Array<{ title: string; atomCount: number }>;
}

// --- Stage 3: Traverse ---

export interface TraversalResult {
  atoms: Atom[];
  paths: TraversalPath[];
  contradictions: Array<{
    atomA: string;
    atomB: string;
    topic: string;
  }>;
}

export interface TraversalPath {
  atomId: string;
  reachedVia: "direct_retrieval" | "graph_traversal";
  depth: number;
  edgeType?: EdgeType;
  score: number;
}

export interface TraversalOptions {
  maxDepth?: number;
  minConfidence?: number[];
  maxExpanded?: number;
  plan?: QueryPlan;
}

// --- Stage 4: Gap Detection ---

export type GapType =
  | "missing_domain"
  | "missing_frame_type"
  | "missing_entity"
  | "thin_coverage"
  | "unresolved_contradiction";

export type GapSeverity = "critical" | "notable" | "minor";

export interface Gap {
  type: GapType;
  description: string;
  severity: GapSeverity;
  suggestion?: string;
}

// --- Stage 5: Compose ---

export interface ContradictionSide {
  atomIds: string[];
  claim: string;
  sources: string[];
  conditions: string[];
}

export interface Contradiction {
  topic: string;
  sides: ContradictionSide[];
  note: string;
}

export interface SourceSummary {
  title: string;
  authors: string[];
  atomsUsed: number;
  chaptersReferenced: string[];
}

export interface ApplyStats {
  totalAtomsRetrieved: number;
  totalAtomsAfterTraversal: number;
  contradictionsFound: number;
  gapsFound: number;
}

export interface ContextSection {
  topic: string;
  atoms: Atom[];
  summary?: string;
}

export interface ContextPackage {
  query: string;
  plan: QueryPlan;
  sections: ContextSection[];
  contradictions: Contradiction[];
  gaps: Gap[];
  sources: SourceSummary[];
  stats: ApplyStats;
}
