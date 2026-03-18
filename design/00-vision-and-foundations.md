# Metis: Vision and Foundations

## What Is Metis?

Metis is a **knowledge learning and retrieval engine** — a tool that transforms source material (books, articles, videos) into structured, retrievable expert knowledge that any LLM can use to reason like a domain expert.

Metis is **not** an agent, a chatbot, or a domain-specific expert system. It is the tool that makes building such systems possible. Feed in source material, wait for it to be processed, and the output is a structured knowledge base that any downstream AI application can query.

**Analogy:** Metis is to expert AI systems what a compiler is to software. It takes human-readable knowledge and transforms it into a structured, machine-usable form.

## The Two Sides of Metis

### Learn
Content → structured knowledge (atoms + graph)

The learning pipeline ingests raw content (books, articles, videos), comprehends it, extracts structured knowledge atoms, and integrates them into a growing knowledge graph.

### Apply
Query → relevant atoms → structured context package → ready for any LLM

The retrieval engine takes a question, identifies which atoms are relevant, traverses the graph to pull connected knowledge, detects gaps, and composes a structured context package. The downstream LLM then uses this package to generate expert-level answers.

Metis does NOT generate final answers. It delivers the expert knowledge that makes answers good.

---

## Epistemological Foundations

Before designing data structures, we explored how knowledge works — drawing from philosophy, cognitive science, and linguistics.

### Types of Knowledge (Philosophy)

- **Propositional knowledge (knowing-that):** Claims about the world. "Penetration rate above 35% indicates industry maturity."
- **Procedural knowledge (knowing-how):** How to do things. Can't be fully reduced to propositions. "How to build a unit economics model."
- **Knowledge by acquaintance (knowing-of):** Direct experiential familiarity. Mental models that let you recognize patterns and run simulations.

A system that only stores propositions is fundamentally incomplete.

### How Humans Organize Knowledge (Cognitive Science)

- **Semantic networks** (Collins & Loftus): Concepts are nodes in a graph, defined by their relationships. Activating one node spreads activation to neighbors.
- **Schemas and frames** (Bartlett, Minsky): Knowledge organizes into structured templates with slots, defaults, and expectations. Schemas are generative — they let you predict and fill gaps.
- **Prototypes** (Rosch): Concepts are organized around central examples, not strict definitions.
- **Chunks** (Simon & Chase): Expertise compresses complex patterns into single units. The grain size of knowledge is a function of expertise.
- **Mental models** (Johnson-Laird): Internal simulations of how things work, enabling counterfactual reasoning.

### Mindset as a Knowledge Type

Mindsets are not knowledge *about* anything — they are meta-cognitive orientations:
- **Assumptions** — what you take as given
- **Attention patterns** — what you notice
- **Evaluation criteria** — how you judge success/failure
- **Default strategies** — what you try first

Closest philosophical analog: Kuhn's paradigm.

### Key Insight from Linguistics: Frame Semantics

Charles Fillmore's Frame Semantics (1970s-80s) argued that meaning is organized in **frames** — structured situations with defined **roles**.

The word "buy" evokes a Commercial Transaction frame with roles: Buyer, Seller, Goods, Money. You can't understand the word without the frame.

This directly informed our atom design. Simple subject-verb-object triples can't represent knowledge that is inherently multi-dimensional (e.g., a 2x2 evaluation matrix). Frames with named roles can.

Additional linguistic support:
- **Thematic roles** validate that named roles (not positional subject/object) are the right design
- **Rhetorical Structure Theory (RST)** discourse relations (Cause, Contrast, Elaboration, Condition, Sequence) independently mirror our relation taxonomy
- **Predicate decomposition** confirms that complex meanings always decompose into simpler primitives

---

## The Atom: Metis's Fundamental Data Unit

### Design Evolution

**First attempt: the triple**
```
(subject) --[relation]--> (object)
  + conditions, confidence, source, domain
```
Worked well for simple claims. Failed on multi-dimensional knowledge (e.g., frequency × elasticity matrix) — had to cram compound concepts into single fields.

**Final design: the micro-frame**

Informed by Fillmore's Frame Semantics, the atom became a frame with named roles:

```
Atom {
  id:          unique identifier
  frame:       frame type (from a taxonomy)
  roles:       { role_name: entity, ... }   // variable number of named roles
  conditions:  [when this atom applies]
  confidence:  0.0 - 1.0
  source:      { title, author, location }
  domain:      [topic tags]
  examples:    [optional supporting illustrations]
}
```

Key properties:
- Each role carries one fact (not compounds)
- Each role is independently queryable
- Simple binary relations are just frames with two roles — nothing is lost
- Multi-dimensional knowledge (matrices, models) fits naturally
- Examples are optional attachments, not first-class knowledge units

### Frame Type Taxonomy

The taxonomy is **core + extensible**: a fixed set of universal frame types plus domain-specific types that the learning pipeline discovers and proposes.

#### Core Frame Types (universal)

| Frame Type | Roles | Purpose |
|---|---|---|
| `definition` | term, meaning | What something means |
| `has_property` | entity, property | Attributes of an entity |
| `is_a` | instance, category | Classification |
| `consists_of` | whole, dimension, description | Composition/structure |
| `example_of` | instance, concept, detail | Instantiation |
| `taxonomy` | concept, categories, basis | Ordered classifications |
| `causal` | cause, effect | Simple causation |
| `causal_chain` | trigger, mechanism, outcome | Multi-step causation |
| `heuristic` | situation, action, rationale | Actionable guidance |
| `principle` | statement, implication, scope | Deep truths that guide reasoning |
| `procedure` | goal, steps, context | Ordered action steps |
| `formula` | name, expression, terms | Mathematical/logical relationships |
| `deviation` | theory, reality, implication | Theory vs. reality gaps |
| `threshold` | metric, threshold_value, transition, direction | Numeric boundary conditions |
| `method_comparison` | method_a, method_b, difference, when_to_use | Comparing approaches |
| `sequence` | name, layers, rule | Ordered layers/stages |
| `evaluation_matrix` | name, dimensions, quadrants, rule | Multi-dimensional assessment tools |

#### Domain-Specific Frame Types (extensible)

Discovered during extraction. Examples from industry analysis domain:

| Frame Type | Roles | Domain |
|---|---|---|
| `stage_characteristics` | stage, users, supply_demand, competition, product, typical_phenomena | Industry lifecycle |
| `stage_priority` | stage, primary_focus, key_question, secondary_concerns | Industry lifecycle |
| `stage_valuation` | stage, valuation_approach, rationale | Industry lifecycle |
| `timeline` | event, date, metric_value, stage_implication | Industry lifecycle |
| `strategy` | name, logic, practitioner, mechanism | Investment |
| `model_structure` | model, revenue_drivers, cost_drivers, key_metric, benchmark | Business analysis |

---

## Stress Test: Industry Analysis Chapters

We tested the atom design against two dense chapters from "如何快速了解一个行业" (How to Quickly Understand an Industry):
- Chapter 1: Industry lifecycle framework
- Chapter 2: Business model feasibility

### Results

- **63 atoms** extracted across 2 chapters
- **23 frame types** needed (17 core + 6 domain-specific)
- Extraction was systematic and the output was independently queryable

### What Worked Well

1. Simple claims (penetration rate thresholds) → perfect fit
2. Taxonomic relationships (part-of, is-a) → perfect fit
3. The `deviation` frame was the biggest win — the book's core value-add is "theory vs. reality," and this frame captured it every time
4. `heuristic` (situation/action/rationale) captured practical wisdom cleanly
5. Frameworks emerged as molecular structures from `part-of` and `precedes` edges
6. The demand matrix (previously awkward as a triple) fit naturally as an `evaluation_matrix` frame
7. Examples as optional attachments (not separate atoms) worked well

### What Needs Attention

1. **Frame type proliferation:** 23 types for 2 chapters. Hypothesis: stabilizes around 30-40 per domain as patterns recur. Needs validation across more source material.
2. **One fact per role value:** When a role contains compound information, it should be split into multiple atoms.
3. **Long procedures:** For 10+ step procedures, individual atoms linked by `precedes` may be better than a single atom with a `steps` list.

---

## Application Test: "Is it a good time to start working as a YouTube influencer?"

We simulated the full learn → apply pipeline against a real question that was NOT covered in the source material.

### How Retrieval Worked

1. **Query understanding:** System mapped "should I enter this industry" to lifecycle stage analysis + business model feasibility assessment
2. **Atom retrieval:** Relevant atoms fired in sequence — lifecycle taxonomy, penetration rate thresholds, stage priorities, demand matrix, UE model framework, innovation hierarchy, deviation atoms
3. **External data fetch:** Atoms told the system WHAT to look for (penetration rate, competitive landscape data) but the system needed to fetch current data from the internet to fill in the values
4. **Gap detection:** System identified missing knowledge domains (career decision-making, personal fit assessment) and flagged them explicitly
5. **Composition:** Retrieved atoms were assembled into a structured analytical brief following the framework's own logic (determine stage → apply stage-appropriate analysis → assess feasibility → conclude)

### Key Findings

- **Atoms are reasoning templates, not data warehouses.** They tell the system what questions to ask and how to interpret answers, but current data must be fetched separately.
- **Atoms compose well.** They layered into a coherent argument without manual orchestration.
- **The system correctly applied frameworks to a domain it had never seen.** Industry lifecycle analysis designed for sectors like semiconductors and restaurants was successfully applied to the YouTube creator economy.
- **Gap detection is as valuable as retrieval.** The system explicitly flagged: "I have industry analysis knowledge but no career-decision-making knowledge."

### Comparative Test

The Metis-informed answer was compared against direct LLM answers in a test group. The Metis-informed answer was preferred — primarily due to its systematic reasoning chain (lifecycle stage → demand matrix → UE model → competitive landscape) rather than the generic "on one hand / on the other hand" structure of direct LLM responses.

---

## Value Proposition

### Where Metis Adds Most Value (vs. General LLMs)

1. **Niche domains where LLM training data is thin.** Language acquisition for immigrant children, specialized regulatory compliance, obscure engineering disciplines — areas where general LLMs give generic advice but domain experts know specific frameworks.
2. **Consistency.** Same frameworks applied the same way every time, across all queries.
3. **Provenance.** Every atom traces back to a specific source, chapter, and section.
4. **Compounding.** Each new source connects to the existing graph — reinforcements, contradictions, extensions. The whole becomes greater than the sum of its parts.

### Product Positioning

Metis is a **tool for building expert systems**, not an expert system itself. Users feed in domain-specific content, Metis processes it into structured knowledge, and any downstream AI application can query that knowledge to reason at an expert level.

---

## Open Design Questions

1. **Frame type management:** How does the system propose new frame types during extraction? What's the approval/review process?
2. **Integration across sources:** When a second book is ingested, how are reinforcements, contradictions, and extensions detected and resolved?
3. **Retrieval architecture:** How does the apply layer decide which atoms are relevant to a given query? Semantic similarity alone is insufficient — the system needs to understand query type → applicable framework → relevant atoms.
4. **Confidence calibration:** How are confidence scores assigned and updated as more sources are ingested?
5. **Pipeline architecture:** What are the concrete steps from "raw chapter" to "validated atom graph"?

---

*Domain: metis.how*
*Repository: github.com/yangyang-how/metis*
