# Metis

## What This Is
A knowledge learning and retrieval engine. Transforms source material (books,
articles) into structured, retrievable expert knowledge (atoms + graph) that
any LLM can use to reason like a domain expert. NOT a chatbot or agent.

## Tech Stack
- Site: Astro 6, TypeScript strict, deployed to [TBD]
- Engine: TypeScript (Bun), Anthropic API for LLM calls
- Storage: JSON files on disk (atoms, graph index), ChromaDB for vectors
- Node >= 22.12.0

## Directory Structure
- `site/` — Marketing/docs site (Astro). Content in `site/src/content/`.
- `design/` — Design documents. Source of truth for architecture decisions.
- `engine/` — Core pipeline code: parse, comprehend, extract, integrate.
- `engine/src/llm/` — Shared LLM provider interface. Multi-provider (Anthropic adapter in v1).
- `engine/src/comprehend/` — Comprehend stage: structure inference, chapter comprehension, book synthesis.
- `engine/test/` — Tests mirroring engine structure. Fixtures in `engine/test/parse/fixtures/`.

## Commands
- Site dev: `cd site && npm run dev`
- Site build: `cd site && npm run build`
- Engine test: `cd engine && bun test`
- Engine typecheck: `cd engine && bun run typecheck`
- Lint: `cd engine && bun run lint`

## Conventions
- Design docs are the spec. Read them before implementing engine features.
- Atoms use the micro-frame model (see design/00-vision-and-foundations.md).
- Frame types follow a registry pattern: core types are fixed, domain types are proposed by the extraction pipeline and reviewed.
- Each pipeline stage (parse, comprehend, extract, integrate) is its own module with its own tests.
- LLM calls are wrapped in a provider interface — never call Anthropic SDK directly from pipeline logic.

## Gotchas
- The site/ and engine/ are separate packages with separate dependencies.
- Astro content collections use glob loaders, not file-system routing for content.
- `node-html-parser` does not parse child elements inside `<pre>` tags — it treats pre-formatted content as raw text. Use regex on `innerHTML` to extract `<code>` language classes.
- EPUB `mimetype` file must be first entry in the zip and stored uncompressed (level 0). The fixture builder in `engine/test/parse/fixtures/build-fixtures.ts` handles this.
- Bun is at `~/.bun/bin/bun` — may need PATH setup in shell scripts.
- Anthropic SDK requires `ANTHROPIC_API_KEY` env var (or explicit config). Tests use mock providers — no real API calls.
- Structure inference normalizes flat EPUBs before LLM calls — never assume the parse tree has sections.
- Prompts live in `engine/src/comprehend/prompts.ts` — iterate on prompts without touching pipeline logic.
