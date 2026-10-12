---
name: knowledge-engineering
description: >
  Metis knowledge model and pipeline design. Use when working on atom
  extraction, frame types, knowledge graph integration, the learn pipeline,
  or the apply pipeline. Also use when discussing design decisions about
  knowledge representation.
allowed-tools: Read, Grep, Glob
---

# Metis Knowledge Engineering

Reference: `design/00-vision-and-foundations.md` and `design/01-architecture.md`

## The Atom (Micro-Frame)

The fundamental data unit. Inspired by Fillmore's Frame Semantics.

```
Atom {
  id:          unique identifier
  frame:       frame type from the registry
  roles:       { role_name: entity, ... }   // variable named roles
  conditions:  [when this atom applies]
  confidence:  0.0 - 1.0
  source:      { title, author, location }
  domain:      [topic tags]
  examples:    [optional illustrations]
}
```

Key constraints:
- Each role carries ONE fact (never compound values)
- Each role is independently queryable
- Examples are attachments, not first-class knowledge
- Simple binary relations are just frames with two roles

## Core Frame Types (17)

definition, has_property, is_a, consists_of, example_of, taxonomy,
causal, causal_chain, heuristic, principle, procedure, formula,
deviation, threshold, method_comparison, sequence, evaluation_matrix

Domain-specific types are proposed during extraction and stored in the registry.

## Learn Pipeline Stages

1. **Parse** (no LLM) — raw content → document tree with metadata
2. **Comprehend** (capable model, 1 call/chapter) — document → comprehension map (argument structure, not atoms)
3. **Extract** (cheap model, many calls) — sections + comprehension map → candidate atoms
4. **Integrate** (cheap + algorithmic) — new atoms → entity resolution, reinforcement/contradiction/extension detection → graph

The comprehension map is the key insight: it prevents paragraph-by-paragraph extraction from missing cross-chapter insights.

## Apply Pipeline Stages

1. Query Understanding → decision type + required frameworks + relevant domains
2. Retrieve → semantic search + domain filter + frame type filter + entity match
3. Traverse → spreading activation from retrieved atoms along graph edges
4. Gap Detection → compare retrieved vs. required, flag missing knowledge
5. Compose → structured context package (NOT a final answer)

Metis delivers the context package. The downstream LLM generates the answer.

## Known Design Tensions

- Frame type proliferation: stress test showed 23 types for 2 chapters. Hypothesis: stabilizes at 30-40 per domain.
- One fact per role: compound roles should be split into multiple atoms.
- Long procedures (10+ steps): may be better as linked atoms than a single steps list.
