# Metis: Architecture (First Draft)

## Overview

Metis has two pipelines:

```
LEARN:   Content → Parse → Comprehend → Extract → Integrate → Knowledge Graph
APPLY:   Query → Understand → Retrieve → Traverse → Detect Gaps → Compose → Context Package
```

Both pipelines use LLMs as internal components — but the LLM is a tool *within* Metis, not the product.

---

## Learn Pipeline

### Stage 1: Parse

Convert raw content into clean, structured text.

- For books: chapter/section hierarchy
- For articles: sections
- For video: transcribe, then segment by topic

Output: a document tree with metadata (title, author, chapter/section structure, page/timestamp references).

**Model requirement: none.** Rule-based parsing. Regex, HTML/markdown parsers, existing transcription APIs. No LLM needed.

### Stage 2: Comprehend

Multi-pass comprehension using an LLM. This is the most intellectually demanding stage.

- **First pass (structure):** Identify the document's argument structure. What's the main thesis? What are the sub-arguments? What builds on what? What examples serve which points?
- Output: a **comprehension map** — not atoms yet, just a structured understanding of the document's logic.

The comprehension map ensures that an insight spanning three chapters gets captured as one atom, not missed because content was processed paragraph-by-paragraph.

**Model requirement: capable model (Sonnet/Opus tier).** This stage requires genuine reasoning — understanding argument structure, distinguishing main points from supporting detail, recognizing cross-cutting themes. A small model will miss the forest for the trees. However, this is **one call per chapter**, so cost is bounded.

### Stage 3: Extract

Walk through each section with the comprehension map as context. The LLM produces candidate atoms — micro-frames with typed roles.

The comprehension map acts as context that tells the extraction model: "this section is building toward the argument that X, and the author will use Y as evidence." With that guidance, even a small model can extract the right atoms.

Validation checks on each candidate atom:
- Does the frame type exist in the registry, or is a new one needed?
- Is each role carrying one fact (not a compound)?
- Is the confidence score reasonable?
- Is the source attribution precise (chapter, section, page)?

**Model requirement: cheap model (Haiku tier).** Extraction is a well-defined, constrained task — filling templates guided by a schema (the frame type registry) and context (the comprehension map). Many calls per chapter (one per section or paragraph), but each call is small and cheap.

### Stage 4: Integrate

Connect new atoms to the existing knowledge graph:

- **Entity resolution:** Is "penetration rate" in this book the same concept as "market penetration" in another? Merge entity nodes.
- **Reinforcement detection:** New atom asserts the same thing as an existing atom from a different source → increase confidence, add source attribution.
- **Contradiction detection:** New atom contradicts an existing one → flag, keep both, let the retrieval layer surface the tension.
- **Extension detection:** New atom adds nuance to an existing one → create edge linking them.

**Model requirement: cheap model + algorithmic.** Entity resolution may need a small LLM call for fuzzy matching. Reinforcement/contradiction/extension detection is largely algorithmic (compare frame types, roles, and semantic similarity of role values).

### Cost Profile

```
                     Model tier        Calls per chapter    Cost weight
Parser:              none              —                    free
Comprehender:        capable (Opus)    1                    $$
Extractor:           cheap (Haiku)     10-30                $ each
Integrator:          cheap + algo      few                  $

~80% of LLM calls are cheap, ~20% are expensive.
The expensive calls have the highest leverage.
```

### Model Configuration

The pipeline is model-agnostic. Each stage can be independently configured:

```
Pipeline Config {
  parser:       rule-based (no LLM)
  comprehender: model_id (capable tier, e.g., claude-sonnet)
  extractor:    model_id (cheap tier, e.g., claude-haiku)
  integrator:   model_id (cheap tier) + algorithmic
}
```

Users tune this based on budget and quality tolerance. A researcher processing a critical reference text might use Opus for comprehension. Someone bulk-processing 50 blog posts might use Sonnet for comprehension and Haiku for extraction.

---

## Apply Pipeline

### Stage 1: Query Understanding

Map the incoming question to:
- **Decision type:** What kind of question is this? (industry entry, comparison, how-to, prediction, evaluation)
- **Required analysis:** What frameworks/procedures apply? (lifecycle analysis, feasibility assessment, competitive analysis)
- **Relevant domains:** Which topic areas to search (industry-analysis, business-model, creator-economy)
- **Required frame types:** Which atom types are most relevant (threshold, stage_priority, evaluation_matrix, heuristic)

This is an LLM task, guided by a **meta-graph** — a graph of which frame types and domains are relevant to which types of questions. The meta-graph can be learned from the knowledge graph structure itself.

### Stage 2: Retrieve

Multiple retrieval paths fire in parallel:
- **Semantic search:** Vector similarity between the query and atom content
- **Domain filter:** Only atoms tagged with relevant domains
- **Frame type filter:** Prioritize frame types identified in Stage 1
- **Entity match:** Exact match on entities mentioned in the query

Results are merged and ranked by combined relevance score.

### Stage 3: Traverse

Starting from retrieved atoms, follow graph edges to pull connected knowledge:
- An atom about "growth stage" pulls connected atoms about growth-stage analysis priorities, valuation methods, characteristics
- A `part-of` edge pulls the full framework
- A `contradicts` edge pulls the opposing view
- A `deviation` atom pulls the practical correction to a theoretical claim

This is **spreading activation** — weighted by relevance to the original query. A depth limit prevents pulling the entire graph.

### Stage 4: Gap Detection

Compare what was retrieved against what the query understanding stage said was needed.

- If the query needs competitive landscape analysis but no such atoms exist → flag: "I have no knowledge about competitive dynamics in this domain."
- If contradictions were found → flag: "Sources disagree on X."
- If required frame types are absent → flag: "I have no procedural knowledge for this type of analysis."

**Gap detection is as valuable as retrieval.** It makes the system honest about what it doesn't know.

### Stage 5: Compose

Assemble retrieved atoms into a structured context package:

```
Context Package {
  query_interpretation: {
    decision_type: "industry entry decision",
    required_analysis: ["lifecycle stage", "feasibility", "competitive landscape"],
    domains: ["industry-analysis", "business-model"]
  },
  knowledge: [
    {
      section: "lifecycle_stage_analysis",
      atoms: [atom_18, atom_19, atom_12, ...],
      reasoning_chain: "First determine stage via penetration rate..."
    },
    {
      section: "feasibility_assessment",
      atoms: [atom_48, atom_52, atom_54, ...],
      reasoning_chain: "Then assess demand reality via benchmarking..."
    }
  ],
  gaps: [
    "No knowledge about competitive dynamics in creator economy",
    "No career-decision-making frameworks available"
  ],
  sources: [
    { title: "如何快速了解一个行业", chapters_used: [1, 2] }
  ]
}
```

This package is handed to whatever LLM the user is working with. The LLM generates the final answer. Metis's job is done.

---

## Storage Layer

Three stores, starting simple:

### Atom Store (source of truth)
Each atom as a JSON document. Atoms are **append-only** — new sources add new atoms; existing atoms are never modified (new evidence creates new atoms with edges to existing ones).

Starting implementation: flat JSON files on disk, one per knowledge base.

### Vector Index (for semantic retrieval)
Each atom gets embedded (full text of its roles concatenated into a natural language sentence). Used for semantic search in the Apply pipeline.

Starting implementation: local embeddings + a lightweight vector store (ChromaDB, or even a flat numpy array for prototyping).

### Graph Index (for traversal)
Maps entities → atoms, atoms → related atoms. Used for spreading activation in the Apply pipeline.

Starting implementation: in-memory adjacency list built from atom relationships, serialized as JSON. Upgrade to a proper graph database when scale demands it.

---

## Frame Type Registry

A versioned registry of frame types with their role schemas:

```
FrameType {
  name:        "causal"
  roles:       { cause: "entity", effect: "entity" }
  description: "A causes B"
  category:    "core" | "domain-specific"
  domain:      null | "industry-analysis"
  version:     1
}
```

- **Core frame types** ship with Metis (~17 universal types).
- **Domain-specific frame types** are proposed by the extraction LLM during the Learn pipeline and stored in the registry.
- The registry is **versioned** — if a frame type definition changes, existing atoms reference the version they were created with.

---

## System Diagram

```
                    ┌─────────────────────────┐
                    │   Frame Type Registry   │
                    └────────────┬────────────┘
                                 │
        LEARN                    │                    APPLY
                                 │
  ┌──────────┐          ┌────────┴─────────┐        ┌───────────┐
  │  Parser   │         │    Atom Store     │        │   Query    │
  │ (no LLM)  │         │   (JSON docs)    │        │ Understander│
  └────┬─────┘          └──┬─────┬──────┬──┘        └─────┬─────┘
       │                   │     │      │                  │
  ┌────┴──────┐        ┌───┴┐ ┌──┴──┐ ┌─┴──┐       ┌─────┴─────┐
  │Comprehender│       │Graph│ │ Vec │ │Meta│       │ Retriever  │
  │(capable $$)│       │Index│ │Index│ │Graph│      │           │
  └────┬──────┘        └────┘ └─────┘ └────┘       └─────┬─────┘
       │                                                  │
  ┌────┴─────┐                                     ┌─────┴─────┐
  │Extractor  │                                    │ Traverser  │
  │(cheap $)  │                                    │            │
  └────┬─────┘                                     └─────┬─────┘
       │                                                  │
  ┌────┴──────┐                                    ┌─────┴─────┐
  │Integrator │                                    │Gap Detector│
  │(cheap+algo)│                                   │            │
  └───────────┘                                    └─────┬─────┘
                                                         │
                                                   ┌─────┴─────┐
                                                   │  Composer  │
                                                   │            │
                                                   └────────────┘
                                                         │
                                                         ▼
                                                  Context Package
                                                   (for any LLM)
```

---

## Open Questions

1. **Comprehension map format:** What does the comprehension map look like concretely? How much structure vs. free-form?
2. **Frame type proposal flow:** When the extractor encounters knowledge that doesn't fit existing frames, what's the proposal → approval flow?
3. **Entity resolution strategy:** How aggressive should merging be? Conservative (only exact matches) vs. aggressive (semantic similarity above threshold)?
4. **Meta-graph construction:** How does the meta-graph (which maps query types to relevant frame types) get built? Manually seeded? Learned from usage?
5. **Multi-source conflict resolution:** When two books disagree, how does the system present this in the context package?
6. **Incremental learning:** When a new source is added, does the system re-process existing atoms in light of new knowledge, or only process the new source?
7. **Quality feedback loop:** Can users flag bad atoms? How does feedback improve future extraction?
