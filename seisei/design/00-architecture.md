# Seisei: Architecture

## Overview

Seisei has one pipeline with four stages:

```
Sources (KX, text, PDF, notes, transcript)
  │
  ▼
Stage 1: Ingest ──→ KXDocument[]
  │                   (normalize every source to KX)
  ▼
Stage 2: Merge ──→ MergedKnowledge
  │                 (cluster, deduplicate, detect conflicts)
  ▼
Stage 3: Plan ──→ SkillPlan
  │                (decide structure, sections, progressive disclosure)
  ▼
Stage 4: Compose ──→ skill folder
                      (SKILL.md + references/ + metadata)
```

The pipeline is linear — each stage depends on the previous one's
output. No parallelism between stages, but stages 1 and 4 parallelize
internally (multiple sources, multiple files).

---

## Design Principles

1. **KX is the internal lingua franca.** Stage 1 converts everything
   to KX. Stages 2–4 never see the original format.

2. **Source fidelity over elegance.** Every claim in the output traces
   to a source. If a unit can't be attributed, it's dropped.

3. **Conflicts are features.** When sources disagree, the skill says
   so. Silent conflict resolution is a bug.

4. **Progressive disclosure.** SKILL.md is concise. references/ has
   depth. Claude reads references when it needs them.

5. **Idempotent generation.** Same inputs → same outputs. No hidden
   state between runs (except the `--refine` flow, which takes
   prior output as an explicit input).

---

## Pipeline Detail

### Stage 1: Ingest

Convert each source into a KXDocument. Multiple adapters, one
output format.

| Source type | Adapter | LLM needed? |
|---|---|---|
| KX document | `kx-reader` | No — passthrough with validation |
| Markdown / text | `text-extractor` | Yes — cheap model |
| PDF | `pdf-extractor` | Yes — cheap model (after text extraction) |
| Raw notes | `notes-parser` | Yes — cheap model |
| Transcript | `transcript-extractor` | Yes — cheap model |

Each adapter produces a standalone KXDocument. The documents are
independent — merging happens in Stage 2.

**Detail:** `seisei/design/01-ingest.md`

### Stage 2: Merge

Take N KXDocuments and produce a single MergedKnowledge structure.

1. **Cluster** units by topic (semantic similarity + domain overlap).
2. **Deduplicate** units that say the same thing from different sources
   (→ increase confidence, combine attributions).
3. **Detect conflicts** where units in the same cluster assert
   opposing claims.
4. **Resolve conflicts** where possible (scope-dependent → conditional
   rule) or flag as unresolved.

**Detail:** `seisei/design/02-merge.md`

### Stage 3: Plan

Decide the skill's structure before generating content. The plan
determines what goes in SKILL.md vs references/, how to order
sections, and where conditional rules go.

Input: MergedKnowledge + user intent (skill name, description, domain).

Output: SkillPlan — a structural blueprint.

**Detail:** `seisei/design/03-compose.md` (plan + compose are one doc
since compose directly executes the plan)

### Stage 4: Compose

Execute the SkillPlan. Generate markdown files.

Output:
```
skill-name/
  SKILL.md
  references/
    frameworks.md
    examples.md
    tradeoffs.md
  .seisei/
    manifest.json       # generation metadata
    sources.json        # source attribution index
```

**Detail:** `seisei/design/03-compose.md`

---

## Cost Profile

```
                   Model tier        Calls per skill    Cost
Ingest (KX):       none              —                  free
Ingest (text):     cheap (Haiku)     1 per source       $
Merge:             cheap (Haiku)     1 clustering call   $
                   + optional cheap   1 conflict check    $
Plan:              capable (Sonnet)  1                  $$
Compose:           capable (Sonnet)  1-3                $$

Typical: 2-4 cheap calls + 2-4 capable calls.
Fast enough for interactive use (<60s for KX input).
```

The capable model is used for Plan and Compose because these require
genuine judgment: deciding skill structure, writing concise
instructions, and resolving how to present conflicts.

---

## Model Configuration

```typescript
interface SeiseiConfig {
  ingest: {
    provider: string;       // "anthropic" | "kimi" | "ollama"
    model: string;          // cheap tier: "claude-haiku-4-5-20251001"
  };
  merge: {
    provider: string;
    model: string;          // cheap tier
  };
  compose: {
    provider: string;
    model: string;          // capable tier: "claude-sonnet-4-6"
  };
  embedding: {
    provider: string;       // for semantic clustering in merge
    model: string;
  };
}
```

Each stage can use a different provider/model. Same pattern as Metis.

---

## CLI Interface

```
seisei generate <intent> [options]

Arguments:
  intent                    What the skill should do ("review UX designs
                            using heuristic evaluation principles")

Options:
  --source <path...>        Source files (KX, markdown, PDF, text)
  --name <name>             Skill folder name (default: derived from intent)
  --output <dir>            Output directory (default: ./)
  --provider <name>         Default LLM provider
  --ingest-model <model>    Model for ingestion (cheap tier)
  --compose-model <model>   Model for plan + compose (capable tier)
  --format full|minimal     Output detail level (default: full)
  --refine <path>           Path to existing skill folder to refine
  --dry-run                 Show plan without generating files
  --json                    Machine-readable output to stdout
```

### Examples

```bash
# From Metis KX export
seisei generate "review UX designs using heuristic evaluation" \
  --source usability.kx.json \
  --name ux-heuristic-review

# From mixed sources
seisei generate "review code for design quality" \
  --source philosophy-of-sd.kx.json \
  --source team-guidelines.md \
  --source tech-talk-notes.txt \
  --name code-review

# Refine existing skill
seisei generate "review code for design quality" \
  --source philosophy-of-sd.kx.json \
  --refine ./code-review/

# Dry run — see the plan
seisei generate "debug production issues systematically" \
  --source debugging-notes.md \
  --dry-run
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Bun (TypeScript) |
| LLM interface | Shared with Metis (`engine/src/llm/`) or own copy |
| PDF extraction | `pdf-parse` or similar |
| Embeddings | OpenAI embedding API (for merge clustering) |
| Output | Filesystem (markdown files) |

Seisei is a separate package from Metis. It depends on the KX format
spec but not on Metis internals. The LLM provider interface may be
shared (extracted to a common package) or duplicated initially.

---

## Directory Structure

```
seisei/
  src/
    ingest/           # Stage 1: source → KX adapters
    merge/            # Stage 2: clustering, dedup, conflict detection
    compose/          # Stage 3+4: planning and generation
    llm/              # LLM provider interface (shared or own)
    kx/               # KX reader, validator, utilities
    cli.ts            # CLI entry point
  test/               # Tests mirroring src structure
  design/             # Design documents (this directory)
  PRD.md              # Product requirements
```

---

## Open Questions

1. **Shared LLM interface.** Extract Metis's `engine/src/llm/` into a
   shared package, or duplicate for now and extract later?
2. **Embedding provider.** Metis uses OpenAI embeddings via ChromaDB.
   Seisei needs embeddings for merge clustering — same provider or
   independent?
3. **Streaming output.** Should compose stream files as they're ready,
   or buffer and write atomically?
4. **Skill validation.** Should Seisei validate generated skills
   against Claude Code's skill format? (Check frontmatter, file
   structure, description quality.)
5. **Refine semantics.** When `--refine` is used, what's preserved?
   All manual edits? Only sections marked with a comment? Need a
   merge strategy.
