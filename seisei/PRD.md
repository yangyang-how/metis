# Seisei — Product Requirements Document

**Seisei** (生成, "to generate/create") is a skill authoring engine that
turns structured knowledge into Claude Code skills. It takes knowledge
from any source — Metis graphs, case studies, notes, style guides — and
produces production-ready skills with workflows, checklists, rubrics,
and conditional rules.

## Problem

Claude Code skills are powerful but manual to write. Creating a good
skill requires:

1. **Extracting** actionable knowledge from source material (books,
   case studies, guides, experience).
2. **Organizing** that knowledge into a workflow structure (steps,
   checklists, decision criteria).
3. **Resolving conflicts** when sources disagree (different books,
   different contexts, different assumptions).
4. **Formatting** the result as a SKILL.md with proper frontmatter,
   trigger descriptions, and references.

Today this is a fully manual process: read the material, internalize
it, hand-write the skill. It works for 3–5 sources you know well. It
breaks down at scale, loses nuance, and misses cross-source conflicts.

## Vision

Seisei makes skill authoring as easy as describing the job the skill
should do. Point it at your knowledge sources, describe the task, and
it produces a skill that captures expert judgment — including the
conditional rules and tradeoffs that make expertise valuable.

**Not a generic AI writer.** Seisei doesn't hallucinate skill content.
Every claim in a generated skill traces back to a source. If sources
conflict, the skill says so explicitly. If coverage is thin, the skill
declares its limitations.

## Target Users

1. **Claude Code power users** who want to encode their domain
   expertise into reusable skills.
2. **Teams** that want to standardize practices across members by
   turning institutional knowledge into shared skills.
3. **Metis users** who have built knowledge graphs and want to turn
   them into actionable tools.

## Use Cases

### UC-1: Book knowledge → Skill

A designer has read "Don't Make Me Think" and "The Design of Everyday
Things." They want a `ux-heuristic-review` skill that applies both
books' frameworks when reviewing a product.

**Flow:**
1. Run Metis on both EPUBs → knowledge graph.
2. Run Metis Apply pipeline → KX document scoped to usability heuristics.
3. Run Seisei with the KX document + skill intent → `ux-heuristic-review/` skill folder.

### UC-2: Case study → Skill

A product manager has a collection of internal case studies (post-mortems,
launch retrospectives). They want a `launch-readiness-review` skill.

**Flow:**
1. Point Seisei at the case study documents (PDF, markdown, text).
2. Seisei's light extractor pulls out heuristics, checklists, failure modes.
3. Seisei merges, resolves conflicts, composes → `launch-readiness-review/` skill folder.

No Metis required. Seisei handles extraction itself for simpler sources.

### UC-3: Mixed sources → Skill

An engineer wants a `code-review` skill combining knowledge from:
- A Metis graph built from "A Philosophy of Software Design" (book)
- Their team's internal code review guidelines (markdown)
- Notes from a tech talk on code review best practices (text)

**Flow:**
1. Metis provides a KX document from the book graph.
2. Seisei's text extractor processes the guidelines and notes.
3. All sources become KX internally.
4. Seisei merges → skill with sections from all three sources, conflicts
   flagged where the book and team guidelines disagree.

### UC-4: Iterative refinement

A user generates a skill, tests it on real tasks, and finds that
one checklist item is too vague and another triggers incorrectly.

**Flow:**
1. User edits the skill manually (it's just markdown).
2. User re-runs Seisei with `--refine` to regenerate only specific
   sections while preserving manual edits.
3. Or: user provides feedback that Seisei incorporates into the next
   generation.

### UC-5: Skill from experience (no source material)

A senior developer wants to encode their debugging methodology as a
skill. They don't have a book — they have experience.

**Flow:**
1. User writes rough notes or has a conversation with Seisei
   describing their process.
2. Seisei structures the notes into a KX document.
3. Seisei composes → `debugging-methodology/` skill folder.
4. User iterates on the output.

---

## Core Features

### F-1: Multi-source Ingestion

Seisei accepts knowledge from multiple source types:

| Source type | Adapter | Extraction depth |
|---|---|---|
| KX document (from Metis or any tool) | KX reader | Full — structured units + relations |
| Markdown/text files | Text extractor | Medium — heuristics, checklists, procedures |
| PDF documents | PDF extractor | Medium — same as text after content extraction |
| Raw notes / pasted text | Notes parser | Light — structured by user's formatting |
| Conversation transcript | Transcript extractor | Light — key decisions and rationale |

Every source is normalized to KX internally. The core pipeline works
on KX only and never knows the original source format.

### F-2: Conflict-Aware Merging

When units from different sources cover the same topic:

1. **Reinforcement:** Multiple sources agree → higher confidence,
   combined attribution.
2. **Scope-dependent conflict:** Sources disagree but have different
   `conditions` → generate conditional rule ("if X, do A; if Y, do B").
3. **Unresolved conflict:** Sources disagree with overlapping conditions
   → flag in the skill as "Known debate" with both positions stated.

### F-3: Skill Composition

Turn merged knowledge into a structured skill:

| Knowledge type | Skill output |
|---|---|
| Heuristics, principles | Checklist items in workflow |
| Procedures | Numbered steps |
| Comparisons, tradeoffs | Decision criteria ("if X then A, else B") |
| Definitions, classifications | `references/` files |
| Examples | Inline examples or `references/examples.md` |
| Evaluations | Rubric tables |
| Deviations | "Common pitfalls" section |
| Gaps (from Metis) | "Limitations" section |

### F-4: Skill Output Format

```
skill-name/
  SKILL.md              # main skill file
  references/           # detailed reference material
    frameworks.md       # mental models, taxonomies
    examples.md         # concrete examples
    tradeoffs.md        # conflict resolution, conditional rules
  scripts/              # optional automation
  assets/               # optional supporting files
```

SKILL.md structure:

```markdown
---
name: skill-name
description: What this skill does and when to use it.
---

# Skill Title

## Instructions
[Numbered workflow steps]

## Checklist
[Quality criteria derived from heuristics and principles]

## Decision Criteria
[Conditional rules from resolved conflicts]

## Common Pitfalls
[Anti-patterns and deviation knowledge]

## Limitations
[What this skill doesn't cover — from gap analysis]

## Sources
[Attribution to original material]
```

### F-5: Trigger Design

Each skill needs a `description` in its frontmatter that helps Claude
decide when to activate it. Seisei generates trigger descriptions by:

1. Analyzing the skill's domain and key concepts.
2. Generating 3–5 natural language phrasings a user might say.
3. Composing a description that covers those phrasings without
   over-triggering on unrelated requests.

### F-6: Progressive Disclosure

Large knowledge bases produce too much content for a single SKILL.md.
Seisei follows a progressive disclosure pattern:

- **SKILL.md:** Concise workflow and checklist. Enough for Claude to
  execute the skill.
- **references/:** Detailed frameworks, examples, and rationale.
  Claude reads these when it needs deeper context on a specific step.

This keeps the primary context small while preserving depth.

---

## Non-Goals

1. **Not a knowledge extraction engine.** Seisei's text extractor is
   intentionally lightweight — good enough for case studies, notes,
   and guides. For deep book extraction with entity resolution, graph
   building, and cross-source integration, use Metis.

2. **Not a chatbot or agent.** Seisei produces skill artifacts. It
   does not answer questions, have conversations, or execute tasks.

3. **Not a Metis dependency.** Seisei works without Metis. KX is
   one input format among many.

4. **Not a runtime system.** Seisei generates skills at authoring
   time. The skills run independently in Claude Code.

5. **Not a skill marketplace.** Seisei helps create skills, not
   distribute them.

---

## Dependencies

| Dependency | Required? | Purpose |
|---|---|---|
| KX format spec | Yes | Shared interchange format for structured knowledge |
| LLM provider | Yes | For text extraction, conflict resolution, composition |
| Metis | No | Optional source of deep knowledge via KX export |
| Claude Code | No | Target platform for skills, but Seisei produces standard markdown |

---

## Success Metrics

1. **Skill quality:** A Seisei-generated skill performs comparably to
   a hand-written skill by a domain expert, as measured by output
   quality on 5 benchmark tasks.
2. **Source fidelity:** Every claim in a generated skill traces to a
   source. Zero hallucinated content.
3. **Conflict coverage:** When sources disagree, the skill surfaces
   the disagreement 100% of the time (no silent resolution).
4. **Time savings:** Generating a skill from existing KX takes under
   60 seconds. From raw text sources, under 5 minutes.
5. **Iteration speed:** Refining a skill after testing takes one
   command, not a full regeneration.

---

## Open Questions

1. **Skill versioning.** When sources update (new edition of a book,
   updated guidelines), how does Seisei update the skill? Full
   regeneration or incremental merge?
2. **User feedback loop.** How does Seisei learn from a user's manual
   edits to improve future generations?
3. **Skill testing.** Can Seisei auto-generate test cases for a skill
   (sample inputs → expected behavior)?
4. **Multi-language.** Skills for non-English domains (e.g., Chinese
   business books) — does the skill output in the source language or
   translate?
5. **Skill decomposition.** When should Seisei recommend splitting a
   skill into two? ("This covers both UX review and information
   architecture — consider splitting.")
