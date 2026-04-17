# Metis

## What This Is
A knowledge learning and retrieval engine. Transforms source material (books,
articles) into structured, retrievable expert knowledge (atoms + graph) that
any LLM can use to reason like a domain expert. NOT a chatbot or agent.

## Tech Stack
- Site: Astro 6, TypeScript strict, deployed to [TBD]
- Engine: TypeScript (Bun), multi-provider LLM (Anthropic, Kimi, future: OpenAI, Gemini, Ollama)
- Storage: JSON files on disk (atoms, graph index), ChromaDB for vectors
- Node >= 22.12.0

## Directory Structure
- `site/` — Marketing/docs site (Astro). Content in `site/src/content/`.
- `design/` — Design documents. Source of truth for architecture decisions.
  - `00`–`06`: Learn pipeline (vision, architecture, parse, comprehend, extract, resume/demo, implementation plan).
  - `07-knowledge-exchange.md`: KX contract — portable, verifiable interchange with profiles and content addressing.
  - `08-apply-pipeline.md`: Apply pipeline (query → retrieve → traverse → gap detect → compose).
  - `09-projects.md`: Project-oriented design — library layout, incremental learning, strictness profiles, auditability.
- `engine/` — Core pipeline code: parse, comprehend, extract, integrate, learn, apply, kx.
- `engine/src/cli.ts` — Unified CLI: `metis learn` and `metis apply` subcommands.
- `engine/src/learn/` — Project-oriented learn pipeline: config, manifest, scan, learn-source, learn-project.
- `engine/src/llm/` — Shared LLM provider interface. Adapters: Anthropic, Kimi (OpenAI-compatible).
- `engine/src/parse/` — Parse stage: EPUB + Markdown. Dispatcher in `index.ts`.
- `engine/src/comprehend/` — Comprehend stage: structure inference, chapter comprehension, book synthesis.
- `engine/src/extract/` — Extract stage: per-section atom extraction, frame type registry, atom validation, span verification.
- `engine/src/kx/` — KX contract: types, export, hash (content addressing), validate (profile-parameterized).
- `engine/src/retrieve/` — Retrieve stage: BM25 + vector + RRF hybrid fusion.
- `engine/src/eval/` — Evaluation framework: 9 checks across 3 layers.
- `engine/data/` — Static data files. `core-frames.json` has 17 core frame types.
- `engine/test/` — Tests mirroring engine structure. Fixtures in `engine/test/parse/fixtures/`.
- `seisei/` — Skill authoring engine (separate project). Turns knowledge into Claude Code skills.
  - `PRD.md` — Product requirements document.
  - `design/` — Technical design specs (architecture, ingest, merge, compose).

## Commands
- Site dev: `cd site && npm run dev`
- Site build: `cd site && npm run build`
- Engine test: `cd engine && bun test`
- Engine typecheck: `cd engine && bun run typecheck`
- Lint: `cd engine && bun run lint`
- Learn: `cd engine && bun run src/cli.ts learn <project-dir>`
- Apply: `cd engine && bun run src/cli.ts apply <project-dir> "<query>"`
- Dry run: `cd engine && bun run src/cli.ts learn <project-dir> --dry-run`

## Conventions
- Design docs are the spec. Read them before implementing engine features.
- Atoms use the micro-frame model (see design/00-vision-and-foundations.md).
- Frame types follow a registry pattern: core types are fixed, domain types are proposed by the extraction pipeline and reviewed.
- Each pipeline stage (parse, comprehend, extract, integrate) is its own module with its own tests.
- LLM calls are wrapped in a provider interface — never call Anthropic SDK directly from pipeline logic.
- Knowledge Exchange (KX) is a versioned, verifiable contract. See design/07-knowledge-exchange.md.
- KX has three strictness profiles: casual (default), standard, strict. Profile is per-project, set in `.metis/config.json`.
- KX documents are content-addressed (contentId + docId) and immutable once published.
- Metis produces KX via `metis apply --format kx`. Seisei consumes KX as its primary input.
- Seisei is a separate project with its own design docs. It shares the KX contract but not Metis internals.
- Projects are user-chosen directories with `sources/` and `.metis/`. Metis has no global library path.
- Source files live outside the repo. Tests use synthetic fixtures in `engine/test/parse/fixtures/`.
- Atom IDs are content-addressed: `sha256(jcs({ frame, roles, conditions, sourceRef }))`.
- Source IDs are manifest-assigned UUIDs, stable across file renames (detected by contentHash match).

## Gotchas
- The site/ and engine/ are separate packages with separate dependencies.
- Astro content collections use glob loaders, not file-system routing for content.
- `node-html-parser` does not parse child elements inside `<pre>` tags — it treats pre-formatted content as raw text. Use regex on `innerHTML` to extract `<code>` language classes.
- EPUB `mimetype` file must be first entry in the zip and stored uncompressed (level 0). The fixture builder in `engine/test/parse/fixtures/build-fixtures.ts` handles this.
- Bun is at `~/.bun/bin/bun` — may need PATH setup in shell scripts.
- Anthropic SDK requires `ANTHROPIC_API_KEY` env var (or explicit config). Tests use mock providers — no real API calls.
- Structure inference normalizes flat EPUBs before LLM calls — never assume the parse tree has sections.
- Prompts live in `engine/src/comprehend/prompts.ts` and `engine/src/extract/prompts.ts` — iterate on prompts without touching pipeline logic.
- Kimi adapter uses `openai` npm package with custom baseURL. Same pattern works for Ollama (`http://localhost:11434/v1`).
- LLMs often return snake_case despite camelCase instructions — always normalize field names in response parsers.
- Frame type registry: 17 core types are fixed in `core-frames.json`. Domain types proposed at runtime, first registration wins.
- Pipeline runner supports per-stage provider config: `--comprehend-provider anthropic --extract-provider kimi`.
- Default model is now `kimi-k2.5` (was `kimi-k2-0711-preview`).
- Incremental learn uses full-rebuild integration: atoms are incrementally managed, but entities/relations/embeddings are rebuilt from the full atom set after any source mutation.
- Span verification normalizes Unicode NFC, collapses whitespace, and normalizes smart quotes/em-dashes before substring check.
- `run-batch.ts` and `run-pipeline.ts` are legacy entry points. Use `src/cli.ts` for new work.
- Markdown parser: H1 = chapter, H2 = section, H3+ inlined. Frontmatter optional. No H1 = single chapter from filename.
