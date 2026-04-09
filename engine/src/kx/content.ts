/**
 * Frame-type → KX kind mapping and natural language content templates.
 *
 * Each Metis frame type maps to a broader KX kind. Content templates
 * convert structured roles into readable natural language sentences.
 *
 * These templates are similar to the ones in integrate/embedding-service.ts
 * but produce period-terminated sentences suitable for human reading
 * (the embedding templates optimize for vector similarity instead).
 */
import type { KXKind } from "./types";

export const FRAME_TO_KX_KIND: Record<string, KXKind> = {
  definition: "definition",
  has_property: "property",
  is_a: "classification",
  consists_of: "classification",
  taxonomy: "classification",
  example_of: "example",
  causal: "causal",
  causal_chain: "causal",
  heuristic: "heuristic",
  principle: "principle",
  procedure: "procedure",
  method_comparison: "comparison",
  threshold: "threshold",
  deviation: "deviation",
  formula: "evaluation",
  sequence: "evaluation",
  evaluation_matrix: "evaluation",
};

export function frameToKXKind(frameType: string): KXKind {
  return FRAME_TO_KX_KIND[frameType] ?? "property";
}

const CONTENT_TEMPLATES: Record<string, (roles: Record<string, string>) => string> = {
  definition: (r) =>
    `${r.term} means ${r.meaning}.`,
  has_property: (r) =>
    `${r.entity} has the property: ${r.property}.`,
  is_a: (r) =>
    `${r.instance} is a type of ${r.category}.`,
  consists_of: (r) =>
    `${r.whole} consists of ${r.dimension}${r.description ? `: ${r.description}` : ""}.`,
  example_of: (r) =>
    `${r.instance} is an example of ${r.concept}${r.detail ? ` — ${r.detail}` : ""}.`,
  taxonomy: (r) =>
    `${r.concept} is classified into: ${r.categories}${r.basis ? ` (by ${r.basis})` : ""}.`,
  causal: (r) =>
    `${r.cause} causes ${r.effect}.`,
  causal_chain: (r) =>
    `${r.trigger} leads to ${r.outcome}${r.mechanism ? ` via ${r.mechanism}` : ""}.`,
  heuristic: (r) =>
    `When ${r.situation}, ${r.action}${r.rationale ? ` because ${r.rationale}` : ""}.`,
  principle: (r) =>
    `${r.statement}${r.implication ? ` This implies: ${r.implication}` : ""}.`,
  procedure: (r) =>
    `To ${r.goal}: ${r.steps}.`,
  method_comparison: (r) =>
    `${r.method_a} vs ${r.method_b}: ${r.difference}${r.when_to_use ? `. ${r.when_to_use}` : ""}.`,
  formula: (r) =>
    `${r.name}: ${r.expression}${r.terms ? ` where ${r.terms}` : ""}.`,
  threshold: (r) =>
    `${r.metric} at ${r.threshold_value}: ${r.transition ?? "behavior changes"}${r.direction ? ` (${r.direction})` : ""}.`,
  deviation: (r) =>
    `Theory says ${r.theory}, but reality is ${r.reality}${r.implication ? `. ${r.implication}` : ""}.`,
  sequence: (r) =>
    `${r.name}: ${r.layers}${r.rule ? ` (${r.rule})` : ""}.`,
  evaluation_matrix: (r) =>
    `${r.name} evaluates along ${r.dimensions}${r.quadrants ? `: ${r.quadrants}` : ""}${r.rule ? `. ${r.rule}` : ""}.`,
};

export function buildContent(frame: string, roles: Record<string, string>): string {
  const template = CONTENT_TEMPLATES[frame];
  if (template) {
    return template(roles);
  }
  // Fallback for domain-specific frames
  return Object.values(roles).join(". ");
}
