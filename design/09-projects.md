# 09 — Projects: Library Layout, Incremental Learning, and CLI Reshape

**Status:** Draft for review
**Date:** 2026-04-15
**Supersedes parts of:** `06-implementation-plan.md` (CLI surface), informal conventions around `engine/graph/` and `engine/output/`.

## 1. Motivation

Today Metis is **graph-oriented**: you run `run-pipeline.ts` on a single EPUB,
atoms accumulate in a global `engine/graph/`, and `run-batch.ts` has a
hardcoded BOOKS array. There is no notion of "a body of knowledge about X."
Source material has no home outside the repo, which creates copyright, bloat,
and data/code-mixing risks.

This document redefines Metis as **project-oriented**: the unit of work is a
directory on disk containing source material and the knowledge graph derived
from it. One project, one graph, one command to learn, one command to query.

## 2. Non-goals

- **PDF ingest.** Deferred — layout parsing and OCR are a separate problem.
- **Cross-project queries.** Each project is self-contained. If we ever need
  federation, that's a later design doc.
- **Skill export.** Claude Code skill authoring is Seisei's job. Metis's
  output contract ends at KX.
- **Migration of existing graphs.** No production graphs exist. The schema
  change in §6 is breaking, and we accept that.
- **Regulatory compliance infrastructure.** Metis provides liability-grade
  provenance, not regulatory compliance (HIPAA, FDA, etc.). The distinction
  is explained in §12.

## 3. Library layout

Source material and derived graphs live **outside the repo**, at whatever
path the user chooses. Metis has no concept of "the library" as a global
location — it only knows about individual **project directories** the user
points it at. A project directory can live anywhere on disk.

The examples below use `~/garage/metis-library/` because that's where Sam
happens to keep his projects today, but nothing in the engine hardcodes or
defaults to that path.

```
~/garage/metis-library/   (or wherever the user prefers)
├── industry-research/
│   ├── sources/
│   │   ├── porter-competitive-strategy.epub
│   │   └── saas-pricing-notes.md
│   ├── .metis/
│   │   ├── config.json
│   │   ├── manifest.json
│   │   ├── atoms.json
│   │   ├── entities.json
│   │   ├── graph.json
│   │   ├── embeddings.json
│   │   ├── history/
│   │   │   └── <sourceId>/<contentHash>/atoms.json
│   │   └── .checkpoints/
│   │       └── <sourceId>/
│   └── kx-exports/
│       └── <timestamp>.kx.json
├── child-safety/
│   ├── sources/
│   ├── .metis/
│   │   ├── config.json          ← {"profile": "strict"}
│   │   └── ...
│   └── kx-exports/
└── …
```

**Conventions:**

- A project is any directory containing a `sources/` subdirectory.
- `.metis/` is created by the engine on first `learn`. Users do not hand-edit
  it (except `config.json`).
- Source files with unsupported extensions (anything other than `.epub` or
  `.md` in v1) are ignored with a warning.
- Metis never walks up or out of a project directory. Whatever sits above it
  (a "library" folder, a home directory, a Dropbox — doesn't matter) is the
  user's concern, not the engine's.

**Why project-as-directory:** the filesystem is the index. No central
registry, no project IDs, no database. `rm -rf` is a legitimate way to delete
a project. `zip` is a legitimate way to share one. Composes well with git,
Dropbox, and backups.

## 4. CLI contract

Two primary commands. Both take a project directory as the first positional arg.

### 4.1 `metis learn`

```
metis learn <project-dir> [options]

Options:
  --rebuild                        Wipe .metis/ and re-learn all sources
  --yes                            Skip confirmation prompts
  --comprehend-provider <name>     (default: kimi)
  --comprehend-model <name>        (default: kimi-k2-0711-preview)
  --extract-provider <name>        (default: kimi)
  --extract-model <name>           (default: kimi-k2-0711-preview)
  --integrate-provider <name>      (default: kimi)
  --integrate-model <name>         (default: kimi-k2-0711-preview)
  --embedding-model <name>         (default: text-embedding-3-large)
  --dry-run                        Show what would be learned, touch nothing
```

**Behavior (default / incremental):**

1. Load `<project-dir>/.metis/config.json` to determine the project's
   strictness profile (default: `standard`).
2. Scan `<project-dir>/sources/` recursively.
3. For each file, compute `sourceId = sha1(relPath)[:12]` and
   `contentHash = sha256(bytes)`.
4. Load `<project-dir>/.metis/manifest.json` (create empty if absent).
5. Diff:
   - **new** = in sources, not in manifest → learn
   - **changed** = in both, `contentHash` differs → archive old atoms,
     then learn
   - **unchanged** = in both, hashes match → skip
   - **removed** = in manifest, not in sources → archive atoms,
     remove from manifest (warn the user, don't error)
6. For each file to learn: run parse → comprehend → extract (with
   profile-appropriate validation) → integrate, merging into the
   existing graph.
7. Update `manifest.json` atomically on completion.

**Behavior (`--rebuild`):**

1. Archive entire `.metis/` state to `.metis/history/rebuild-<timestamp>/`
   (unless `--yes` is passed, prompt for confirmation first).
2. Create fresh `.metis/` with only `config.json` preserved.
3. Run incremental learn against an empty graph. Every source is "new."
4. This is the "surface contradictions symmetrically" mode — useful when a
   new source is expected to challenge settled knowledge and you want the
   integrate stage to see everything fresh.

### 4.2 `metis apply`

```
metis apply <project-dir> "<query>" [options]

Options:
  --format native|kx               (default: native)
  --output <path>                  Write result to file instead of stdout
  --top-k <n>                      (default: 20)
  --max-depth <n>                  (default: 2)
  --min-confidence <0-1>           (default: per profile)
  --provider <name>                (default: kimi)
  --model <name>                   (default: kimi-k2-0711-preview)
  --domains <csv>                  Manual plan: restrict to domains
  --frame-types <csv>              Manual plan: restrict to frame types
  --entities <csv>                 Manual plan: restrict to entities
  --json                           Raw JSON to stdout (debug)
```

Reads graph from `<project-dir>/.metis/`. No `--graph-dir` flag — the project
directory is the graph location.

**Output:**

- **native** → `ContextPackage` JSON (existing shape, enriched with provenance).
- **kx** → `KXDocument` written to `--output` path or to
  `<project-dir>/kx-exports/<timestamp>.kx.json`. The document carries the
  project's profile and is validated before writing.

### 4.3 Removed / changed surfaces

- **`run-batch.ts` is deleted.** Its purpose — learn multiple books into one
  graph — is subsumed by `metis learn` over a project directory.
- **`run-pipeline.ts` is deleted** as a user-facing entry point. Its logic
  moves into `src/learn/learn-source.ts` as a library function called by the
  project runner. (Keeping it as an internal module is fine; it just no longer
  owns a CLI.)
- **`--graph-dir` flag is removed** from apply and retrieve. Project root is
  the only location contract.
- **`run-retrieve.ts` and `run-eval.ts`** keep their debug-tool status but
  gain a project-dir positional arg in place of `--graph-dir`.

## 5. Markdown parse adapter

New file: `engine/src/parse/md-reader.ts`. Produces the same
`ParsedBook` shape that `epub-reader.ts` produces today, so comprehend,
extract, and integrate are untouched.

**Rules:**

1. **Frontmatter optional.** If present (YAML between `---` fences at top of
   file), fields override inferred metadata:
   ```yaml
   ---
   title: Notes on SaaS Pricing
   authors: [Sam Wu]
   language: en
   ---
   ```
2. **Heading hierarchy maps to structure:**
   - `H1` → chapter
   - `H2` → section
   - `H3+` → subsection content, inlined into the nearest section
3. **If no H1 exists**, the whole document becomes a single chapter with the
   file's stem as title, single section "Body."
4. **Code blocks, lists, tables, blockquotes** pass through as plain text for
   the extract stage. No special handling in v1.
5. **Content hash** is computed over the raw file bytes, before parsing.
6. **Section text canonicalization** for span verification: the stripped
   plain text of each section (after markdown parsing, before any
   normalization) is stored alongside the parsed structure. This is the
   reference text against which `quotedSpan` and `roleSpan` values are
   verified.

**Testing:** mirror the EPUB fixture strategy — hand-written markdown files
under `engine/test/parse/fixtures/md/` covering frontmatter / no-frontmatter,
deep nesting, no-H1, edge cases.

## 6. Atom provenance schema change (breaking)

Current `CandidateAtom` (from `engine/src/extract/types.ts`):

```ts
interface CandidateAtom {
  id: string;
  frame: string;
  roles: Record<string, string>;
  conditions: string[];
  confidence: number;
  source: {
    title: string;
    authors: string[];
    chapterId: string;
    sectionId: string;
  };
  domain: string[];
  examples: string[];
  flags: string[];
}
```

New shape:

```ts
interface CandidateAtom {
  id: string;                           // content-addressed (see below)
  frame: string;
  roles: Record<string, string>;        // canonical/display form

  // Provenance — populated based on project profile
  provenance: {
    quotedSpans: SourceSpan[];          // verbatim source quotes
    roleSpans?: Record<string, SourceSpan>;  // per-role verbatim spans
    roleTypes?: Record<string, "verbatim" | "paraphrase">;
    extraction: {
      extractedAt: string;              // ISO 8601
      provider: string;
      model: string;
      promptVersion: string;            // sha256 of the extract prompt
    };
  };

  conditions: string[];
  confidence: number;

  source: {
    sourceId: string;                   // sha1(relPath within sources/)[:12]
    contentHash: string;                // sha256 of source file bytes
    title: string;
    authors: string[];
    chapterId: string;
    sectionId: string;
    sectionText: string;               // canonical section text for span verification
  };

  domain: string[];
  examples: string[];
  flags: string[];
}

interface SourceSpan {
  text: string;                         // verbatim text from the source
  start?: number;                       // character offset into sectionText
  end?: number;
}
```

### Content-addressed atom IDs

```
atom.id = sha256(jcs({ frame, roles, quotedSpans[].text, source.sourceId }))
```

This means:
- Same source + same extraction → same atom ID. Durable across re-learns.
- Different model producing different roles → different ID (correct).
- The `content` display text is excluded — rewording doesn't change identity.
- The `roles` values are included because under strict profile, roles are
  verbatim spans and contribute to identity.

### Profile-aware validation during extraction

After the LLM returns atoms, a validation step runs before integration:

- **`casual`:** schema check only. Roles accepted as-is.
- **`standard`:** `quotedSpans` required. Every span verified as a substring
  of `sectionText` (after Unicode NFC normalization + whitespace collapse).
  `roleTypes` required. Paraphrased roles allowed.
- **`strict`:** all `standard` checks, plus: `roleSpans` required for every
  role. Every `roleSpan.text` verified as substring of `sectionText`. All
  `roleTypes` must be `"verbatim"`. Atoms with any paraphrased role are
  rejected. Cross-language atoms rejected (source language must match atom
  language).

Atoms that fail validation are logged to stderr with the reason and dropped.
Under `strict`, this may result in fewer atoms per source — that's the
tradeoff. The extract prompt should be tuned per profile to maximize
extractive fidelity.

### Span verification procedure

For `standard` and `strict` profiles, after extraction:

1. Take `sectionText` from the source (the canonical section text stored
   during parsing).
2. Normalize both the section text and each span text:
   - Unicode NFC normalization
   - Collapse whitespace (runs of whitespace → single space)
   - Trim leading/trailing whitespace
   - Normalize quote characters (smart quotes → straight quotes)
   - Normalize dashes (em-dash → hyphen-minus)
3. For each span: check that `normalize(span.text)` is a substring of
   `normalize(sectionText)`.
4. If the span has `start`/`end` offsets, verify that the text at those
   offsets in the **unnormalized** section text matches (within normalization
   tolerance). If offsets don't match, recompute them via substring search
   and update.
5. If the span text is not found after normalization: **reject the atom**
   (under `standard` and `strict`). Log the near-miss for debugging.

### Breaking change

This is a breaking change to `atoms.json` on disk. No migration code: no
production graphs exist. Existing `engine/output/*.json` files from batch runs
are regenerated under the new project structure.

**Propagation:** ~20 touch points across extract, integrate, KX export, apply,
retrieve, eval, and tests.

## 7. Manifest format

`<project-dir>/.metis/manifest.json`:

```json
{
  "schemaVersion": 1,
  "profile": "standard",
  "lastLearnedAt": "2026-04-15T11:42:00Z",
  "sources": [
    {
      "sourceId": "a1b2c3d4e5f6",
      "relPath": "sources/porter-competitive-strategy.epub",
      "contentHash": "sha256:...",
      "format": "epub",
      "title": "Competitive Strategy",
      "authors": ["Michael Porter"],
      "atomCount": 342,
      "learnedAt": "2026-04-15T11:30:00Z"
    }
  ]
}
```

**Writes:** atomic — write to `manifest.json.tmp`, then `rename`. Never leave
a partial manifest on disk.

**Reads:** fail loud if the file is corrupt. Do not silently rebuild.

## 8. Incremental learn algorithm (detail)

```
def learn(project_dir, rebuild=False):
    config = load_config(project_dir)  # profile, overrides
    profile = config.profile or "standard"

    if rebuild:
        archive_full_state(project_dir / ".metis", timestamp=now())
        # preserves config.json, archives everything else

    mkdir_p(project_dir / ".metis")
    manifest = load_manifest(project_dir) or empty_manifest()
    scanned = scan_sources(project_dir / "sources")

    to_learn = []
    to_archive = []

    for relPath, (sid, hash, fmt) in scanned.items():
        existing = manifest.find(sid)
        if existing is None:
            to_learn.append(("new", relPath, sid, hash, fmt))
        elif existing.contentHash != hash:
            to_learn.append(("changed", relPath, sid, hash, fmt))
            to_archive.append(sid)

    for entry in manifest.sources:
        if entry.sourceId not in scanned_ids:
            to_archive.append(entry.sourceId)

    if not to_learn and not to_archive:
        print("Up to date.")
        return

    graph = load_graph(project_dir / ".metis") or empty_graph()

    # Archive before removal — never silently lose atoms
    for sid in to_archive:
        old_atoms = graph.atoms_by_source(sid)
        old_hash = manifest.find(sid).contentHash
        save_to_history(project_dir / ".metis" / "history" / sid / old_hash,
                        old_atoms)
        graph = remove_atoms_by_source(graph, sid)
        manifest.remove(sid)

    for kind, relPath, sid, hash, fmt in to_learn:
        parsed = parse_file(relPath, format=fmt)
        comprehension = comprehend(parsed)
        atoms = extract(parsed, comprehension,
                        sourceId=sid, contentHash=hash,
                        profile=profile)
        # Profile-aware validation: rejects atoms that don't meet the bar
        atoms = validate_atoms(atoms, profile, parsed.sectionTexts)
        graph = integrate(graph, atoms)
        manifest.upsert(entry_for(relPath, sid, hash, fmt, parsed, atoms))

    save_graph(project_dir / ".metis", graph)
    save_manifest_atomically(project_dir / ".metis" / "manifest.json", manifest)
```

**Edge cases:**

- **Partial failure mid-run.** Checkpoints live under
  `.metis/.checkpoints/<sourceId>/` (reusing the existing checkpoint manager
  keyed by `sourceId` instead of `bookSlug`). A crashed run leaves the graph
  and manifest unchanged; resuming picks up per-source.
- **Empty `sources/`.** Legal. Engine prints a warning and exits 0.
- **Unsupported file extensions.** Logged to stderr, counted in a summary,
  not an error.
- **`contentHash` collision across two files.** Vanishingly unlikely with
  sha256; treat as an error and refuse to proceed.
- **Atom rejection rate.** Under `strict` profile, the extract stage may
  reject a high percentage of atoms (span verification failure). The summary
  report includes a per-source acceptance rate. If below 50%, warn the user
  that the extract prompt may need tuning for this profile.

### History (append-only atom archive)

`.metis/history/<sourceId>/<contentHash>/atoms.json` stores atoms that were
removed from the live graph. The structure:

```json
{
  "sourceId": "a1b2c3d4e5f6",
  "contentHash": "sha256:...",
  "archivedAt": "2026-04-15T14:00:00Z",
  "reason": "source-changed",
  "atoms": [ ... ]
}
```

Under `strict` profile, history is never deleted — it's the complete
provenance trail of what Metis has ever believed. Under `casual` and
`standard`, history is best-effort (preserved on clean runs, may be
lost on crashes).

The history is **not** part of the live graph. Retrieve and apply never
read from it. It exists solely for audit: "show me what Metis extracted
from this source version."

## 9. Rebuild semantics

`--rebuild` is **not a debug flag.** It's a first-class operation with a
specific meaning: *forget the existing graph and re-learn every source from
scratch, so contradictions between sources surface symmetrically rather than
being resolved against the settled state of the old graph.*

This matters because incremental learning is biased toward coherence — each
new source gets integrated against a mostly-settled worldview, and the
integrate stage's contradiction detection runs with that bias. Rebuild
removes the bias.

**Use when:** you've added a source that's expected to challenge settled
knowledge, or you've changed prompts / models and want a clean result.

**UX:** prompt the user for confirmation unless `--yes` is passed. Print a
summary of what will be rebuilt before touching anything.

**Future (not in v1):** a `metis diff-rebuild` mode that runs both incremental
and rebuild, then reports which contradictions only appear under rebuild. A
signal of knowledge drift. Interesting. Not now.

## 10. Implementation plan

Ordered, each step independently shippable and testable.

**Phase 0: Spec work (no code)**

0a. Revise `design/07-knowledge-exchange.md` — formalize KX contract with
    versioning, content addressing, profiles, scope-of-contract, conformance
    direction. *(Done — this document and the revised 07 doc.)*

**Phase 1: Schema and foundations**

1. **Schema change to `CandidateAtom`.** Full provenance model: `sourceId`,
   `contentHash`, `provenance` (quotedSpans, roleSpans, roleTypes,
   extraction), `sectionText`, content-addressed `id`. Update all producers
   and consumers. Span verification module. Tests pass.
2. **Markdown parse adapter.** New `src/parse/md-reader.ts` + fixtures +
   tests. Parse module exports a dispatcher by extension. Section text
   canonicalization for span verification.
3. **Project config module.** `src/learn/config.ts` — load, validate,
   default to `standard`. Per-profile validation rules.
4. **Manifest module.** `src/learn/manifest.ts` — load, diff, upsert, atomic
   write. Unit tests against tmpdir.

**Phase 2: Learn pipeline**

5. **`src/learn/learn-source.ts`.** Single-source learn function extracted
   from `run-pipeline.ts`. Takes parsed book + sourceId + hash + profile,
   returns validated atoms ready for integration.
6. **`src/learn/learn-project.ts`.** Project-level orchestrator implementing
   the algorithm in §8. Includes history archive on atom removal.
7. **`metis` CLI entry point.** `src/cli.ts` with `learn` and `apply`
   subcommands. Replaces individual `run-*.ts` user-facing entry points.

**Phase 3: Apply pipeline reshape**

8. **Update apply / retrieve / eval runners** to take project dir positional
   arg instead of `--graph-dir`. Apply reads profile from config and sets
   it on KX output.
9. **KX export update.** Emit `sourceId`, `contentHash`, `provenance`
   (quotedSpans, roleSpans, roleTypes, extraction). Compute `contentId` and
   `docId` via JCS canonicalization. Run `validateKX` before writing.
10. **KX validator.** `src/kx/validate.ts` — profile-parameterized validation.
    `src/kx/hash.ts` — JCS canonicalization + sha256. Tests against fixtures
    at each profile level.

**Phase 4: Cleanup and docs**

11. **Delete `run-batch.ts` and `run-pipeline.ts`** from the user-facing CLI
    surface. Keep internals if reused.
12. **Docs:** update `CLAUDE.md` commands section; add a short
    `docs/projects.md` user guide covering profiles.

## 11. Decisions (resolved 2026-04-15)

- **CLI shape:** single `metis` binary with `learn` / `apply` subcommands.
  The existing `run-*.ts` files become internal modules or get deleted.
- **Manifest schema version:** starts at 1. Upgrade story is "re-learn from
  sources" — we will not write migration code for manifest bumps until there
  is a real reason to preserve graphs across versions.
- **Checkpoint keying:** switches from `bookSlug` to `sourceId`. Callers that
  reference `bookSlug` in the checkpoint manager are updated as part of
  step 1 of the implementation plan.
- **Strictness is per-project, not global.** Three profiles: `casual`,
  `standard`, `strict`. Default is `standard`. Config lives in
  `<project-dir>/.metis/config.json`.
- **Extractive faithfulness:** roles are a union type — verbatim span or
  flagged paraphrase. Under `strict` profile, all roles must be verbatim.
  Under `standard`, paraphrases are allowed but flagged. Under `casual`,
  flagging is optional.
- **Consumer responsibility:** the KX contract guarantees provenance, not
  faithfulness. How extracted knowledge is used is always the consumer's
  responsibility, even under `strict`. See §12 and `07-knowledge-exchange.md`
  §3.

## 12. Auditability and source traceability

### Why this matters

Metis is intended to serve as a research foundation for projects that
publish knowledge-backed content — articles, guides, tools, skills. Some
of those projects operate in domains where claims must be traceable to
sources: healthcare (parentguidebook), legal research, financial analysis.

**Provenance is cheap at creation and expensive in retrofit.** Building it
into the schema before any real graphs exist costs a few extra fields per
atom. Retrofitting it later — after consumers depend on the schema — is
a multi-week project touching every extractor, integrator, and consumer.

### What Metis provides

**Liability-grade provenance, not regulatory compliance.** Metis can answer:
"for every claim in this article, show me the source file, the exact bytes
of that file at extraction time, the verbatim quote, the model and prompt
that extracted it, and the timestamp." That's sufficient for liability
defense: "we had reasonable basis for this claim, here's the evidence."

Metis does **not** provide:
- Cryptographic signing or non-repudiation
- Access control or audit logs
- Retention policies or legal hold
- HIPAA, FDA, or other regulatory-specific compliance features

These are important for some use cases but are infrastructure concerns,
not knowledge-pipeline concerns. They belong in the consumer's stack, not
in Metis.

### The provenance chain

```
Source file (content-hashed)
  → Parse (section text preserved)
    → Extract (verbatim spans + role provenance + model/prompt ID)
      → Integrate (atom ID = content hash, stable across re-learns)
        → Apply (KX document, content-addressed, immutable)
          → Consumer (responsible for faithful use)
```

Every link in this chain is verifiable:
- Source file bytes → `contentHash` on the atom and KX source
- Section text → stored in `source.sectionText` on the atom
- Verbatim spans → verified as substrings of section text
- Extraction method → `provenance.extraction` on the atom
- Atom identity → content-addressed ID, stable across re-learns
- KX document → `contentId` + `docId`, immutable once published
- Consumer use → **the consumer's responsibility, not Metis's**

### History as provenance trail

Under `standard` and `strict` profiles, the `.metis/history/` directory
preserves every atom that was ever extracted and later superseded. This
means:

- If a source file changes and atoms are re-extracted, the old atoms are
  archived with their content hash and timestamp.
- If a prompt or model changes and produces different atoms from the same
  source, the previous extraction is preserved.
- A complete audit trail exists: "what did Metis believe at time T, based
  on what source version, extracted by what model?"

The history is not indexed or searchable in v1. It's a flat archive. Future
versions may add tooling to diff between extractions or surface knowledge
drift.

## 13. Strictness profiles (detail)

### Project configuration

`<project-dir>/.metis/config.json`:

```json
{
  "profile": "strict",
  "overrides": {
    "minConfidence": 0.8
  }
}
```

The file is optional. If absent, the project uses `standard` defaults.
If present, `profile` is required and `overrides` is optional.

### Available override fields

| Field | Type | Profiles | Default (by profile) |
|---|---|---|---|
| `minConfidence` | number (0-1) | all | casual: none, standard: 0.6, strict: 0.7 |
| `crossLanguageAllowed` | boolean | all | casual: true, standard: true, strict: false |
| `requireQuotedSpans` | boolean | casual only | casual: false (overridable to true) |

Overrides can tighten a profile's rules but not loosen them. Setting
`crossLanguageAllowed: true` under `strict` is an error. Setting
`minConfidence: 0.9` under `casual` is fine.

### Profile promotion and demotion

**Promotion** (casual → standard, or standard → strict): requires
`metis learn --rebuild`. Existing atoms may not meet the new bar and
will be re-extracted under stricter validation. Old atoms are archived.

**Demotion** (strict → standard, or standard → casual): takes effect
on the next `metis learn`. Existing atoms already exceed the looser bar.
No rebuild required.

### Profile in KX output

When `metis apply --format kx` exports a KX document, the document's
`profile` field is set to the project's configured profile. The KX
validator enforces the profile's rules on the exported document. A
consumer calling `validateKX(doc, { minProfile: "strict" })` will
reject any document from a non-strict project.
