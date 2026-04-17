# Metis

A knowledge engine that transforms books, articles, and research into structured, searchable knowledge with full provenance. Every claim traces back to a verbatim quote in a specific source.

Metis is not a chatbot. It's the research layer that sits behind chatbots, giving them something better than training data to work with.

## What it does

```
Source files (EPUB, Markdown)
  → metis learn    (comprehend → extract → integrate)
  → Knowledge graph (atoms + entities + relations + embeddings)
  → metis apply "your question"
  → Structured, cited research output
```

**Learn** reads source material and extracts atoms — structured claims with frame types, confidence scores, verbatim source quotes, and full provenance chains.

**Apply** takes a question, searches the knowledge graph, and returns relevant atoms grouped by topic with contradictions flagged and gaps identified.

## Why not just use RAG?

RAG retrieves chunks of text. Metis retrieves *structured knowledge* — claims that have been decomposed, validated, cross-referenced across sources, and stamped with provenance.

- **RAG**: "In Chapter 5, Hoffeld discusses various questioning techniques..."
- **Metis**: `{ frame: "definition", term: "thought redirect", meaning: "using a question to interrupt a buyer's thought process...", quotedSpan: "Deploy what I refer to as a thought redirect...", source: "The Science of Selling, Ch.5, offset 8630" }`

Every atom carries the exact verbatim quote from the source, verified by substring matching with character offsets.

## Quick start

```bash
# Prerequisites: Bun, a Kimi or Anthropic API key, an OpenAI key (for embeddings)
cd engine
export MOONSHOT_API_KEY=your-kimi-key
export OPENAI_API_KEY=your-openai-key

# Create a project
mkdir -p ~/my-project/sources
# Add .epub or .md files to sources/

# Learn
bun run src/cli.ts learn ~/my-project

# Query
bun run src/cli.ts apply ~/my-project "your question here"

# Dry run (no API calls)
bun run src/cli.ts learn ~/my-project --dry-run
```

## Project structure

Each body of knowledge is a project — a directory with source files and a derived knowledge graph:

```
~/my-project/
  sources/
    book.epub
    article.md
  .metis/
    config.json      # strictness profile
    manifest.json    # what's been learned
    atoms.json       # structured claims with provenance
    entities.json    # named concepts, cross-linked
    graph.json       # relationships between atoms
    embeddings.json  # vectors for semantic search
```

## Strictness profiles

Each project declares how strict its provenance must be:

- **casual** — minimal provenance. For personal notes, hobby research.
- **standard** (default) — verbatim quotes required, paraphrases flagged. For industry research, education.
- **strict** — fully extractive, all roles verbatim, append-only history. For healthcare, legal, compliance.

Set in `.metis/config.json`:
```json
{ "profile": "strict" }
```

## Who is this for

Ask: *"What happens if one of your published claims turns out to be wrong?"*

- "We'd correct it" → you probably don't need Metis
- "We'd get sued" → you do
- "Someone could get hurt" → you needed it yesterday

Healthcare publishers, academic researchers, compliance writers, investigative journalists — anyone whose audience pays for rigor.

## LLM providers

Metis supports per-stage model selection:

```bash
bun run src/cli.ts learn ~/my-project \
  --comprehend-provider kimi \
  --extract-provider anthropic --extract-model claude-sonnet-4-6
```

| Provider | Status | Use case |
|---|---|---|
| Kimi (K2.6) | Default | Cheapest, good for most work |
| Anthropic | Supported | Higher quality extraction |
| Ollama | Planned | Free, local models |

## KX output format

Metis outputs **KX documents** — a portable, content-addressed interchange format. Any downstream tool can read, validate, and trace every claim back to its source.

```bash
bun run src/cli.ts apply ~/my-project "your question" --format kx --output result.kx.json
```

See [design/07-knowledge-exchange.md](design/07-knowledge-exchange.md) for the full contract specification.

## Development

```bash
cd engine
bun install
bun test              # 470 tests
bun run typecheck     # TypeScript strict
bun run lint          # Biome
```

## Design documents

- [00 — Vision and Foundations](design/00-vision-and-foundations.md)
- [07 — KX Contract Specification](design/07-knowledge-exchange.md)
- [08 — Apply Pipeline](design/08-apply-pipeline.md)
- [09 — Project Architecture](design/09-projects.md)

## License

[Apache 2.0](LICENSE)
