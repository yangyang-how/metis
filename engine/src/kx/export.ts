/**
 * Export a ContextPackage to KX format.
 *
 * Maps Metis atoms -> KXUnits, graph edges -> KXRelations,
 * and assembles a KXDocument. Structural edges (entity_link,
 * cross_domain) are skipped -- KX only carries semantic relations.
 */
import type { Atom, GraphIndex } from "../integrate/types";
import type { ContextPackage } from "../apply/types";
import { buildContent, frameToKXKind } from "./content";
import type { KXDocument, KXRelation, KXRelationType, KXSource, KXUnit } from "./types";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatLocation(source: Atom["source"]): string | undefined {
  const parts: string[] = [];
  if (source.chapterId) parts.push(`Ch.${source.chapterId}`);
  if (source.sectionId) parts.push(`§${source.sectionId}`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function atomToKXUnit(atom: Atom, sourceRef: string): KXUnit {
  return {
    id: atom.id,
    kind: frameToKXKind(atom.frame),
    content: buildContent(atom.frame, atom.roles),
    roles: atom.roles,
    conditions: atom.conditions,
    confidence: atom.confidence,
    source: {
      ref: sourceRef,
      location: formatLocation(atom.source),
    },
    domains: atom.domain,
  };
}

function atomSourcesToKXSources(atoms: Atom[]): KXSource[] {
  const seen = new Map<string, KXSource>();

  for (const atom of atoms) {
    const key = atom.source.title;
    if (!seen.has(key)) {
      seen.set(key, {
        id: slugify(key),
        type: "book",
        title: atom.source.title,
        authors: atom.source.authors,
      });
    }
  }

  return [...seen.values()];
}

const EDGE_TYPE_MAP: Record<string, KXRelationType | null> = {
  reinforces: "reinforces",
  contradicts: "contradicts",
  extends: "extends",
  entity_link: null,
  cross_domain: null,
};

function buildKXRelations(
  atoms: Atom[],
  graphIndex: GraphIndex,
): KXRelation[] {
  const atomIdSet = new Set(atoms.map((a) => a.id));
  const relations: KXRelation[] = [];

  for (const atom of atoms) {
    const edges = graphIndex[atom.id];
    if (!edges) continue;

    for (const edge of edges) {
      // Only include relations between atoms in the package
      if (!atomIdSet.has(edge.target)) continue;

      const kxType = EDGE_TYPE_MAP[edge.type];
      if (!kxType) continue; // skip structural edges

      relations.push({
        from: atom.id,
        to: edge.target,
        type: kxType,
        confidence: edge.confidence,
      });
    }
  }

  return relations;
}

export function exportToKX(
  pkg: ContextPackage,
  graphIndex: GraphIndex,
): KXDocument {
  const allAtoms = pkg.sections.flatMap((s) => s.atoms);
  const sources = atomSourcesToKXSources(allAtoms);
  const sourceRefMap = new Map(sources.map((s) => [s.title, s.id]));

  const units = allAtoms.map((atom) =>
    atomToKXUnit(atom, sourceRefMap.get(atom.source.title) ?? "unknown"),
  );

  const relations = buildKXRelations(allAtoms, graphIndex);

  return {
    version: "kx/1.0",
    meta: {
      domains: [...new Set(units.flatMap((u) => u.domains))],
      sources,
      generatedBy: "metis/0.1",
      generatedAt: new Date().toISOString(),
    },
    units,
    relations,
  };
}
