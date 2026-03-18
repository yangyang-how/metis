---
title: "Foundations: what is the atom of knowledge?"
date: "2026-03-17"
description: "Starting from epistemology and linguistics to design the fundamental data unit for a knowledge learning engine."
---

Today was the first design session for Metis. No code was written. Instead, we started from first principles: what *is* knowledge, and how should it be represented for machines to reason with?

## The question

Before building anything, we need a **fundamental data unit** — the atom that everything else composes from. Get this wrong and the entire system inherits the mistake.

## Epistemological survey

We started with philosophy. Knowledge isn't one thing:

- **Propositional knowledge** (knowing-that): claims about the world.
- **Procedural knowledge** (knowing-how): how to do things, not reducible to propositions.
- **Knowledge by acquaintance** (knowing-of): direct experiential familiarity, mental models.

Cognitive science added structure: semantic networks (knowledge defined by relationships), schemas (structured templates with slots and defaults), chunks (expertise compresses complexity), and mental models (runnable internal simulations).

A system that only stores propositions is fundamentally incomplete.

## First attempt: the triple

We started with a knowledge graph triple — `(subject) --[relation]--> (object)` plus metadata (conditions, confidence, source, domain). Eleven relation types: `is-a`, `causes`, `enables`, `inhibits`, `precedes`, `part-of`, `example-of`, `contradicts`, `has-property`, `correlates-with`, `modulates`.

We stress-tested this against two dense chapters from an industry analysis textbook. Simple claims worked perfectly. Taxonomic relationships worked well. But we hit problems:

- **Multi-dimensional concepts** (a 2x2 matrix of frequency vs. elasticity) required cramming compound concepts into single fields.
- **Rich examples** didn't fit cleanly as first-class atoms.
- **Procedures with branching logic** needed more than simple `precedes` chains.

## The linguistic insight

Charles Fillmore's **Frame Semantics** provided the breakthrough. Fillmore argued that meaning is organized in *frames* — structured situations with defined *roles*. The word "buy" evokes a Commercial Transaction frame with roles: Buyer, Seller, Goods, Money.

Our triple was forcing everything into two roles (subject, object). Many knowledge structures naturally have three, four, or more roles.

## The atom: a micro-frame

The atom became:

```
Atom {
  id:          unique identifier
  frame:       frame type (from a taxonomy)
  roles:       { role_name: entity, ... }
  conditions:  [when this holds]
  confidence:  0.0 - 1.0
  source:      { title, author, location }
  domain:      [topic tags]
  examples:    [optional illustrations]
}
```

Simple binary relations are just frames with two roles — nothing is lost. But a demand evaluation matrix naturally becomes one atom with four roles instead of four awkward triples.

## Stress test results

We extracted 63 atoms across 2 chapters using 23 frame types (17 core + 6 domain-specific). The extraction was systematic and every atom was independently queryable.

Biggest win: the `deviation` frame type (roles: theory, reality, implication). The book's core value-add is "here's what textbooks say, here's why reality differs" — this frame captured it perfectly every time.

## Application test

We then asked: "Is it a good time to start working as a YouTube influencer?" — a question nowhere in the source material.

The atoms told the system *what to analyze* (lifecycle stage via penetration rate, demand feasibility via time/space benchmarking, profit feasibility via demand matrix and unit economics) and *how to interpret* what it found. The resulting answer had a structured reasoning chain that test users preferred over direct LLM responses.

Key finding: atoms are **reasoning templates**, not data warehouses. They tell the system what questions to ask and how to interpret answers, but current data must be fetched separately.

## What's next

- Define the core frame type taxonomy
- Design the learning pipeline architecture (raw content → atoms)
- Design the retrieval engine (query → relevant atoms → structured context)
- Test with a niche domain where LLMs are weak
