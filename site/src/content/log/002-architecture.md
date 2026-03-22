---
title: "Architecture: two pipelines, one graph"
date: "2026-03-18"
description: "First draft of the Learn and Apply pipelines, and a key insight about cost — comprehension is expensive, extraction is cheap."
---

Second design session. We moved from "what is the atom" to "how does the system actually work."

## Two pipelines

![Learn and Apply — two pipelines sharing one knowledge graph](/images/log/two-pipelines.svg)

Metis has two sides, and each is a pipeline:

**Learn:** Content → Parse → Comprehend → Extract → Integrate → Knowledge Graph

**Apply:** Query → Understand → Retrieve → Traverse → Detect Gaps → Compose → Context Package

Both use LLMs as internal components. But the LLM is a tool *within* Metis, not the product. The product is the structured knowledge and the context packages it produces.

![Cost split — 1 expensive comprehension call guides N cheap extraction calls](/images/log/cost-split.svg)

## The cost question

A full book might contain thousands of paragraphs. If every one requires a capable LLM call, ingestion becomes prohibitively expensive. So we asked: which stages actually need a smart model?

The answer split the pipeline cleanly:

- **Parsing** needs no LLM at all — it's structural, rule-based.
- **Extraction** is a constrained task — filling typed templates guided by a schema. A cheap, fast model handles it well.
- **Comprehension** is the one that genuinely requires reasoning. Understanding that an argument builds across 10 pages, distinguishing the main point from supporting detail, recognizing cross-cutting themes — a small model misses the forest for the trees.

But comprehension is **one call per chapter**. Extraction is **many calls per section**. So the architecture naturally separates them:

```
Comprehension (1 call, capable model) → comprehension map
Extraction (N calls, cheap model, guided by comprehension map) → atoms
```

The comprehension map is the key lever. It's a few hundred tokens of structured context that tells the cheap extraction model what the author is building toward. With that context, even a small model extracts the right atoms.

Roughly 80% of LLM calls are cheap, 20% are expensive. The expensive calls have the highest leverage.

## Storage: start simple

Three stores, all starting as flat files:

1. **Atom Store** — JSON documents, append-only
2. **Vector Index** — embeddings for semantic search
3. **Graph Index** — adjacency lists for traversal

No need for a graph database or vector database on day one. Files and in-memory structures are enough to validate the design. Upgrade when scale demands it.

## Gap detection matters

One design decision worth highlighting: the Apply pipeline explicitly detects and reports gaps. If the knowledge graph has industry analysis frameworks but no career-decision-making frameworks, and someone asks a career question, the system says so.

This is as important as retrieval. An expert who says "I don't know about that aspect" is more trustworthy than one who confidently makes things up.

## What's next

- Define the comprehension map format
- Design the frame type proposal flow (when extraction encounters new knowledge shapes)
- Build a prototype of the Learn pipeline against a real book chapter
