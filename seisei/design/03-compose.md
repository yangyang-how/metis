# Plan & Compose Stage Design

Stages 3 and 4 of the Seisei pipeline. Takes MergedKnowledge (from
Merge) and produces a complete skill folder.

Documented together because Plan produces the blueprint and Compose
executes it — they share data structures and are tightly coupled.

---

## Stage 3: Plan

Decide the skill's structure before generating any content. This
prevents the compose model from making ad-hoc structural decisions
mid-generation.

### Input

```typescript
interface PlanInput {
  merged: MergedKnowledge;       // from Merge
  intent: SkillIntent;           // from the user
  provider: LLMProvider;         // capable model (Sonnet tier)
}

interface SkillIntent {
  name: string;                  // skill folder name
  description: string;           // what the skill does (user-provided)
  domain?: string;               // primary domain hint
  format?: "full" | "minimal";   // output detail level
}
```

### Output

```typescript
interface SkillPlan {
  /** Skill identity */
  name: string;
  title: string;                 // human-readable title for SKILL.md
  triggerDescription: string;    // frontmatter description for activation

  /** SKILL.md sections */
  sections: PlannedSection[];

  /** Reference files to generate */
  references: PlannedReference[];

  /** Knowledge assignment: which units go where */
  assignments: UnitAssignment[];

  /** Presentation decisions */
  decisions: PlanDecision[];
}

interface PlannedSection {
  id: string;
  heading: string;               // "## Instructions", "## Checklist", etc.
  type: SectionType;
  unitIds: string[];             // which merged units belong here
  order: number;
}

type SectionType =
  | "instructions"     // numbered workflow steps (from procedures)
  | "checklist"        // quality criteria (from heuristics, principles)
  | "decision"         // conditional rules (from resolved conflicts)
  | "pitfalls"         // anti-patterns (from deviations)
  | "limitations"      // coverage gaps
  | "sources";         // attribution

interface PlannedReference {
  filename: string;              // "frameworks.md", "examples.md", etc.
  type: ReferenceType;
  unitIds: string[];
}

type ReferenceType =
  | "frameworks"       // definitions, classifications, taxonomies
  | "examples"         // concrete examples and case studies
  | "tradeoffs"        // conflict details, condition-scoped rules
  | "deep-dive";       // extended content that doesn't fit above

interface UnitAssignment {
  unitId: string;
  target: "skill" | "reference";
  section: string;               // section ID or reference filename
  role: string;                  // how this unit will be used
}

interface PlanDecision {
  question: string;              // what the planner decided
  answer: string;                // the decision
  rationale: string;             // why
}
```

### Planning Logic

The planner (one capable LLM call) receives:

1. **MergedKnowledge summary:** cluster topics, unit counts per kind,
   conflict count, source list.
2. **Skill intent:** name, description, domain.
3. **Section type menu:** the available section types with descriptions.
4. **Progressive disclosure rules:** what goes in SKILL.md vs
   references.

The planner decides:

1. **Which sections to include.** Not every skill needs every section
   type. A pure procedural skill might have only Instructions +
   Sources. A review skill needs Checklist + Decision Criteria.

2. **Which units go where.** The mapping rules:

   | Unit kind | Default section | Goes to reference if... |
   |---|---|---|
   | `heuristic`, `principle` | Checklist | >10 items (overflow to references) |
   | `procedure` | Instructions | Multiple competing procedures |
   | `comparison` | Decision Criteria | n/a |
   | `definition`, `classification` | references/frameworks.md | Always (too detailed for SKILL.md) |
   | `example` | references/examples.md | Always |
   | `deviation` | Pitfalls | n/a |
   | `evaluation` | Checklist or Instructions | Long rubrics → reference |
   | `causal` | Instructions (as rationale) | n/a |
   | `threshold` | Checklist (as criteria) | n/a |
   | `property` | references/frameworks.md | Always |

3. **Section order.** Workflow-oriented skills: Instructions first.
   Review-oriented skills: Checklist first. The planner infers from
   the skill intent.

4. **Trigger description.** 1-2 sentences that describe when Claude
   should activate this skill. Derived from the intent and the
   knowledge domains.

### Dry Run

When `--dry-run` is used, the pipeline stops after Plan and prints
the SkillPlan as formatted output:

```
Skill: ux-heuristic-review
Title: UX Heuristic Review
Trigger: "Use when reviewing a product's UX, evaluating usability,
          or conducting a heuristic evaluation of an interface."

Sections:
  1. Instructions (8 units — 3 procedures, 5 causal)
  2. Checklist (12 units — 7 heuristics, 5 principles)
  3. Decision Criteria (3 resolved conflicts)
  4. Common Pitfalls (4 deviations)
  5. Limitations (2 gaps)
  6. Sources (3 books)

References:
  - frameworks.md (6 definitions, 3 classifications)
  - examples.md (5 examples)
  - tradeoffs.md (2 unresolved conflicts)

Decisions:
  - "Checklist before Instructions?" → Yes, this is a review skill.
  - "Include examples inline?" → No, too many. Reference file.
```

---

## Stage 4: Compose

Execute the SkillPlan to generate actual markdown files.

### Input

```typescript
interface ComposeInput {
  plan: SkillPlan;
  merged: MergedKnowledge;
  intent: SkillIntent;
  provider: LLMProvider;         // capable model (Sonnet tier)
  existingSkill?: ExistingSkill; // for --refine mode
}

interface ExistingSkill {
  skillMd: string;               // current SKILL.md content
  references: Record<string, string>;  // filename → content
  manifest: SkillManifest;
}
```

### Output

```typescript
interface ComposeResult {
  files: GeneratedFile[];
  manifest: SkillManifest;
  stats: ComposeStats;
}

interface GeneratedFile {
  path: string;                  // relative to skill folder
  content: string;
}

interface SkillManifest {
  generatedAt: string;           // ISO 8601
  generatedBy: string;           // "seisei/0.1"
  intent: SkillIntent;
  sources: KXSource[];
  unitCount: number;
  conflictCount: number;
  sections: string[];            // section headings
  references: string[];          // reference filenames
}

interface ComposeStats {
  filesGenerated: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  llmCalls: number;
}
```

### Generation Strategy

Compose uses 1-3 capable LLM calls:

**Call 1: SKILL.md**

The model receives:
- The SkillPlan (structure and unit assignments).
- The actual MergedUnit content for units assigned to SKILL.md.
- Conflicts that should appear as Decision Criteria.
- Gaps that should appear as Limitations.
- The SKILL.md template (frontmatter + section structure).

The model generates the complete SKILL.md content, following these
rules:

- **Instructions:** Numbered steps. Each step is actionable. Derived
  from procedure units, with causal units providing rationale
  (parenthetical or sub-bullets).
- **Checklist:** Bullet points with checkboxes. Each item is a
  testable criterion. Derived from heuristic and principle units.
- **Decision Criteria:** "If X, then A. If Y, then B." Derived from
  scope-dependent conflicts. Always cite both sources.
- **Common Pitfalls:** "Avoid X because Y." Derived from deviation
  units.
- **Limitations:** "This skill does not cover X." Derived from gap
  analysis.
- **Sources:** List of source titles and authors.

**Call 2: Reference files** (if any)

One call generates all reference files. The model receives:
- Units assigned to each reference file.
- The reference file type (frameworks, examples, tradeoffs).
- Formatting guidelines per type.

Reference file guidelines:

| File | Format |
|---|---|
| `frameworks.md` | Definitions as `### Term` + explanation. Classifications as hierarchical lists or tables. |
| `examples.md` | Each example as `### Example: Title` + description + what it illustrates. |
| `tradeoffs.md` | Each conflict as `### Tradeoff: Topic` + both positions + conditions + resolution (if scope-dependent). |

**Call 3: Trigger refinement** (optional)

If the initial trigger description is too generic or too narrow
(detected by heuristics: <10 words = too vague, mentions specific
tool names = too narrow), one cheap LLM call refines it.

### SKILL.md Template

```markdown
---
name: {{name}}
description: {{triggerDescription}}
---

# {{title}}

{{#if instructions}}
## Instructions
{{#each instructions}}
{{step}}. {{content}}
{{/each}}
{{/if}}

{{#if checklist}}
## Checklist
{{#each checklist}}
- [ ] {{content}}
{{/each}}
{{/if}}

{{#if decisions}}
## Decision Criteria
{{#each decisions}}
### {{topic}}
{{content}}
{{/each}}
{{/if}}

{{#if pitfalls}}
## Common Pitfalls
{{#each pitfalls}}
- **{{title}}:** {{content}}
{{/each}}
{{/if}}

{{#if limitations}}
## Limitations
{{#each limitations}}
- {{content}}
{{/each}}
{{/if}}

## Sources
{{#each sources}}
- *{{title}}* by {{authors}}
{{/each}}
```

The template is guidance, not rigid. The LLM adapts: if there's only
one instruction and many checklist items, it may restructure. But
the section types and their ordering from the Plan are preserved.

---

## Refine Mode (`--refine`)

When `--refine <path>` is provided, Compose takes the existing skill
as an additional input and preserves manual edits.

### Strategy

1. **Diff detection.** Compare the existing SKILL.md against what
   Seisei would generate from the manifest. Sections that differ
   from the last generation are marked as "manually edited."
2. **Selective regeneration.** Only regenerate sections that:
   - Have new knowledge (new units assigned in the Plan).
   - Were not manually edited.
3. **Merge prompt.** For sections with both new knowledge AND manual
   edits, include the existing text in the compose prompt with
   instructions: "Integrate the new knowledge while preserving the
   existing structure and any manual additions."

### Manifest Role

The `.seisei/manifest.json` file stores what was generated and when.
This is how refine mode knows what's "manual" vs "generated":

```typescript
interface SkillManifest {
  generatedAt: string;
  generatedBy: string;
  intent: SkillIntent;
  sources: KXSource[];
  unitCount: number;
  conflictCount: number;
  sections: string[];
  references: string[];
  // Checksums for change detection
  checksums: Record<string, string>;  // filename → SHA-256
}
```

If a file's current SHA-256 matches its manifest checksum, it hasn't
been manually edited and can be safely regenerated.

---

## File Output

Compose writes files atomically — generate all content in memory,
then write all files at once. No partial output on failure.

```
skill-name/
  SKILL.md                    # main skill file
  references/
    frameworks.md             # definitions, classifications, taxonomies
    examples.md               # concrete examples (if any)
    tradeoffs.md              # conflicts and conditional rules (if any)
  .seisei/
    manifest.json             # generation metadata + checksums
    sources.json              # full source attribution index
```

Files are only created if they have content. An empty `examples.md`
is not generated.

`.seisei/` is a dotfile directory — visible to Seisei for refine
mode, invisible to casual browsing. Not part of the skill's public
interface.

---

## Quality Heuristics

Post-generation checks (no LLM — rule-based):

1. **Frontmatter valid.** `name` and `description` fields present.
2. **No empty sections.** Every `##` heading has content below it.
3. **Source attribution.** Sources section has at least one entry.
4. **Reasonable length.** SKILL.md is 50-500 lines. Flag if outside
   this range (too short = too thin, too long = needs more in
   references).
5. **Trigger description quality.** 10-50 words, no jargon, no
   tool-specific terms.
6. **Checklist item quality.** Each item is a testable statement
   (contains a verb, not just a noun phrase).

Failures are warnings, not errors. The skill is still generated.

---

## Cost Profile

```
Plan:              1 capable call      ~5K tokens    $$
Compose SKILL.md:  1 capable call      ~10K tokens   $$
Compose refs:      1 capable call      ~8K tokens    $$
Trigger refine:    0-1 cheap call      ~1K tokens    $

Typical total: 2-3 capable + 0-1 cheap calls.
Wall time: 15-30 seconds for generation.
```

---

## Open Questions

1. **Multi-skill generation.** When knowledge is broad enough to
   warrant splitting into two skills, should Plan detect this and
   suggest it? Or is that the user's job?
2. **Skill size limits.** What's the maximum useful SKILL.md size
   before Claude Code performance degrades? Need to benchmark.
3. **Reference file granularity.** Three reference files (frameworks,
   examples, tradeoffs) or one per topic cluster? Fewer files =
   simpler, more files = Claude reads only what it needs.
4. **Template customization.** Should users be able to provide a
   custom SKILL.md template? Adds flexibility but complicates the
   compose prompt.
5. **Compose determinism.** LLMs are not deterministic. Should
   Seisei use temperature=0 for compose, or allow some variation?
   Temperature=0 for reproducibility, but slightly higher might
   produce more natural prose.
