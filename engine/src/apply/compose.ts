// engine/src/apply/compose.ts
/**
 * Stage 5: Compose — assemble atoms, traversal, and gaps into a
 * ContextPackage. Groups atoms into sections by the plan's grouping
 * strategy, builds source summaries, and formats contradictions.
 *
 * Section summaries (LLM) are handled separately via generateSummaries().
 */
import type { Atom, EntityIndex } from "../integrate/types";
import type { LLMProvider } from "../llm/types";
import { buildContent } from "../kx/content";
import { buildSummaryPrompt } from "./prompts";
import type {
  ContextPackage,
  ContextSection,
  Contradiction,
  ContradictionSide,
  Gap,
  GroupingStrategy,
  QueryPlan,
  SourceSummary,
  TraversalResult,
} from "./types";

export interface ComposeInput {
  query: string;
  plan: QueryPlan;
  traversalResult: TraversalResult;
  gaps: Gap[];
  entities: EntityIndex;
  retrieveCount: number;
}

export function groupAtoms(
  atoms: Atom[],
  strategy: GroupingStrategy,
  entities: EntityIndex,
): ContextSection[] {
  const groups = new Map<string, Atom[]>();

  for (const atom of atoms) {
    const key = getGroupKey(atom, strategy, entities);
    const list = groups.get(key) ?? [];
    list.push(atom);
    groups.set(key, list);
  }

  const sections: ContextSection[] = [...groups.entries()].map(
    ([topic, atoms]) => ({ topic, atoms }),
  );

  // Sort by atom count descending (richest sections first)
  sections.sort((a, b) => b.atoms.length - a.atoms.length);

  return sections;
}

function getGroupKey(
  atom: Atom,
  strategy: GroupingStrategy,
  entities: EntityIndex,
): string {
  switch (strategy) {
    case "entity": {
      // Use the first entityRef's canonical name
      if (atom.entityRefs.length > 0) {
        const entity = entities[atom.entityRefs[0]!];
        if (entity) return entity.canonicalName;
      }
      // Fallback to first domain
      return atom.domain[0] ?? "uncategorized";
    }
    case "domain":
      return atom.domain[0] ?? "uncategorized";
    case "frame-type":
      return atom.frame;
  }
}

function buildSourceSummaries(atoms: Atom[]): SourceSummary[] {
  const bySource = new Map<
    string,
    { authors: string[]; chapters: Set<string>; count: number }
  >();

  for (const atom of atoms) {
    const key = atom.source.title;
    const entry = bySource.get(key) ?? {
      authors: atom.source.authors,
      chapters: new Set(),
      count: 0,
    };
    entry.count++;
    if (atom.source.chapterId) entry.chapters.add(atom.source.chapterId);
    bySource.set(key, entry);
  }

  return [...bySource.entries()].map(([title, data]) => ({
    title,
    authors: data.authors,
    atomsUsed: data.count,
    chaptersReferenced: [...data.chapters].sort(),
  }));
}

function buildContradictions(
  traversalContradictions: TraversalResult["contradictions"],
  atoms: Atom[],
): Contradiction[] {
  const atomMap = new Map(atoms.map((a) => [a.id, a]));

  return traversalContradictions.map((c) => {
    const atomA = atomMap.get(c.atomA);
    const atomB = atomMap.get(c.atomB);

    const sides: ContradictionSide[] = [];
    if (atomA) {
      sides.push({
        atomIds: [atomA.id],
        claim: Object.values(atomA.roles).join(" "),
        sources: [atomA.source.title],
        conditions: atomA.conditions,
      });
    }
    if (atomB) {
      sides.push({
        atomIds: [atomB.id],
        claim: Object.values(atomB.roles).join(" "),
        sources: [atomB.source.title],
        conditions: atomB.conditions,
      });
    }

    const scopeNote =
      atomA?.conditions.length && atomB?.conditions.length
        ? `Scope-dependent: "${atomA.conditions.join(", ")}" vs "${atomB.conditions.join(", ")}"`
        : "No differentiating conditions found.";

    return {
      topic: c.topic,
      sides,
      note: scopeNote,
    };
  });
}

export function compose(input: ComposeInput): ContextPackage {
  const { query, plan, traversalResult, gaps, entities, retrieveCount } = input;

  const sections = groupAtoms(
    traversalResult.atoms,
    plan.groupingStrategy,
    entities,
  );

  const contradictions = buildContradictions(
    traversalResult.contradictions,
    traversalResult.atoms,
  );

  const sources = buildSourceSummaries(traversalResult.atoms);

  return {
    query,
    plan,
    sections,
    contradictions,
    gaps,
    sources,
    stats: {
      totalAtomsRetrieved: retrieveCount,
      totalAtomsAfterTraversal: traversalResult.atoms.length,
      contradictionsFound: contradictions.length,
      gapsFound: gaps.length,
    },
  };
}

/**
 * Generate LLM summaries for each section in a ContextPackage.
 * Mutates the sections in place (adds .summary field).
 */
export async function generateSummaries(
  pkg: ContextPackage,
  provider: LLMProvider,
): Promise<void> {
  for (const section of pkg.sections) {
    try {
      const atomContents = section.atoms.map((a) =>
        buildContent(a.frame, a.roles),
      );
      const messages = buildSummaryPrompt(
        section.topic,
        pkg.query,
        atomContents,
      );
      const response = await provider.sendMessage({
        messages,
        maxTokens: 256,
        temperature: 0.3,
      });
      section.summary = response.content.trim();
    } catch {
      // Non-fatal: section.summary remains undefined
    }
  }
}
