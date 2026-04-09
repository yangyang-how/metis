/**
 * Build a compact GraphInventory from a KnowledgeGraph.
 * Used by the Understand stage to constrain LLM output to
 * domains, entities, and frame types that actually exist.
 */
import type { KnowledgeGraph } from "../integrate/types";
import type { GraphInventory } from "./types";

export function buildInventory(graph: KnowledgeGraph): GraphInventory {
  const domainCounts = new Map<string, number>();
  const frameTypeCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();

  for (const atom of graph.atoms) {
    for (const d of atom.domain) {
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    }
    frameTypeCounts.set(
      atom.frame,
      (frameTypeCounts.get(atom.frame) ?? 0) + 1,
    );
    const title = atom.source.title;
    sourceCounts.set(title, (sourceCounts.get(title) ?? 0) + 1);
  }

  return {
    domains: [...domainCounts.entries()]
      .map(([name, atomCount]) => ({ name, atomCount }))
      .sort((a, b) => b.atomCount - a.atomCount),
    entities: Object.values(graph.entities).map((e) => ({
      name: e.canonicalName,
      aliases: e.aliases,
      domain: e.domain,
    })),
    frameTypes: [...frameTypeCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    sources: [...sourceCounts.entries()]
      .map(([title, atomCount]) => ({ title, atomCount }))
      .sort((a, b) => b.atomCount - a.atomCount),
  };
}
