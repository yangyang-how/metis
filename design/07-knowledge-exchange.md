# Knowledge Exchange Format (KX)

A portable interchange format for structured knowledge transfer between
tools. Not owned by Metis or Seisei — either can produce or consume it,
and so can any other tool.

## Why a Shared Format?

Metis extracts knowledge from books. Seisei turns knowledge into Claude
Code skills. A chatbot injects knowledge into conversations. A study
tool turns knowledge into flashcards. Each tool has its own internal
representation, but they all need to pass knowledge between each other.

KX is the common language. It's simple enough that a human could write
one by hand, rich enough to express cross-source conflicts and
conditions, and agnostic about what the consumer does with it.

**Design principles:**

- **Human-readable first.** Every unit has a natural language `content`
  field. Structured `roles` are optional enrichment, not required.
- **Source-agnostic.** A KX document can come from Metis's deep pipeline,
  Seisei's light extractor, a human writing JSON, or any other tool.
- **Consumer-agnostic.** No assumption about downstream use. Skills,
  chatbots, docs, flashcards — all valid consumers.
- **Conflicts are declared, not resolved.** KX records that two units
  contradict. How to handle it is the consumer's job.
- **Minimal viable structure.** Only fields that every knowledge source
  can reasonably provide. Rich metadata is optional.

---

## Document Structure

A KX document is a collection of knowledge units and their relations.

```typescript
interface KXDocument {
  version: "kx/1.0";

  meta: {
    domains: string[];            // topic areas covered
    sources: KXSource[];          // provenance
    generatedBy?: string;         // "metis/0.1" | "seisei/0.1" | "human"
    generatedAt?: string;         // ISO 8601 timestamp
  };

  units: KXUnit[];                // the knowledge itself
  relations: KXRelation[];        // how units relate to each other
}
```

---

## Knowledge Units

The core building block. One unit = one piece of knowledge.

```typescript
interface KXUnit {
  id: string;                     // unique within the document

  // What kind of knowledge this is
  kind: KXKind;

  // The knowledge in natural language — always present
  content: string;

  // Structured roles (optional — adds precision when available)
  // Metis fills these from its frame data; simpler sources may omit them
  roles?: Record<string, string>;

  // When this knowledge applies (and when it doesn't)
  conditions: string[];

  // How certain this is (0–1)
  confidence: number;

  // Where this came from
  source: {
    ref: string;                  // matches KXSource.id
    location?: string;            // "Ch.3, §2" | "page 47" | "14:30"
  };

  // Topic areas this belongs to
  domains: string[];
}
```

### Content vs Roles

Every unit must have `content` — a natural language statement any
consumer can read without understanding the schema. This is the
universal fallback.

`roles` is optional structured data that adds precision. A consumer
that understands roles can use them for richer processing (generating
checklists, building decision trees). A consumer that doesn't can
ignore them and work with `content` alone.

Example:

```json
{
  "id": "krug-simplicity-01",
  "kind": "heuristic",
  "content": "When users encounter a web page, they scan rather than read. Remove everything that competes for their attention unless it serves the current task.",
  "roles": {
    "situation": "users scanning a web page",
    "action": "remove everything not serving the current task",
    "rationale": "users scan rather than read — competing elements waste attention"
  },
  "conditions": ["consumer web", "casual or infrequent users"],
  "confidence": 0.91,
  "source": { "ref": "krug-dmmt", "location": "Ch.2" },
  "domains": ["usability", "web-design"]
}
```

---

## Knowledge Kinds

12 types covering the range of knowledge structures. These are
deliberately broader than Metis's 17 frame types — KX trades
specificity for portability.

| Kind | What it represents | Example |
|---|---|---|
| `definition` | What something means | "Affordance means the perceived action possibilities of an object" |
| `property` | An attribute of something | "Mature industries have penetration rates above 50%" |
| `classification` | Taxonomy, is-a, consists-of | "Design patterns are classified into creational, structural, and behavioral" |
| `causal` | A causes/leads to B | "Poor error messages increase user abandonment" |
| `heuristic` | In situation X, do Y | "When designing forms, put labels above inputs, not beside them" |
| `principle` | A general truth that guides reasoning | "Every piece of interface must earn its place on the screen" |
| `procedure` | Steps to achieve a goal | "To conduct a usability test: recruit 5 users, prepare tasks, observe, debrief" |
| `comparison` | A vs B, when to use which | "Modeless design reduces errors; modal design reduces complexity. Prefer modeless for frequent tasks." |
| `threshold` | Boundary that changes behavior | "Response time above 1 second breaks the user's flow of thought" |
| `deviation` | Theory vs reality gap | "The funnel model assumes linear progression, but real users jump between stages" |
| `example` | Concrete instance of an abstract concept | "Amazon's 1-Click ordering is an example of reducing friction to zero" |
| `evaluation` | Criteria or matrix for judgment | "Evaluate onboarding by: time-to-first-value, completion rate, and support ticket volume" |

### Mapping from Metis Frame Types

Metis's 17 core frame types map to KX kinds:

| Metis frame | KX kind |
|---|---|
| `definition` | `definition` |
| `has_property` | `property` |
| `is_a` | `classification` |
| `consists_of` | `classification` |
| `taxonomy` | `classification` |
| `example_of` | `example` |
| `causal` | `causal` |
| `causal_chain` | `causal` |
| `heuristic` | `heuristic` |
| `principle` | `principle` |
| `procedure` | `procedure` |
| `method_comparison` | `comparison` |
| `threshold` | `threshold` |
| `deviation` | `deviation` |
| `formula` | `evaluation` |
| `sequence` | `evaluation` |
| `evaluation_matrix` | `evaluation` |

Domain-specific frame types proposed at runtime also map to the
closest KX kind. The mapping is lossy — that's intentional. If a
consumer needs Metis's full frame specificity, it should use Metis's
native format, not KX.

---

## Relations

How units connect to each other.

```typescript
interface KXRelation {
  from: string;                   // unit ID
  to: string;                     // unit ID
  type: KXRelationType;
  confidence: number;             // 0–1
  note?: string;                  // human-readable explanation
}

type KXRelationType =
  | "reinforces"      // both units assert the same claim from different sources
  | "contradicts"     // units assert opposing claims
  | "extends"         // one unit adds nuance or detail to another
  | "requires"        // understanding one unit requires the other
  | "exemplifies";    // one unit is a concrete example of the other
```

### Conflict Representation

KX declares conflicts; it does not resolve them. A `contradicts`
relation between two units means the consumer must decide how to
handle the tension.

The `conditions` field on each unit provides scope information that
often resolves the contradiction. Two units may contradict in general
but not within their respective scopes.

```json
{
  "units": [
    {
      "id": "unit-a",
      "kind": "heuristic",
      "content": "Remove everything that isn't essential.",
      "conditions": ["consumer web", "casual users"],
      "confidence": 0.91,
      "source": { "ref": "krug-dmmt", "location": "Ch.3" },
      "domains": ["usability"]
    },
    {
      "id": "unit-b",
      "kind": "heuristic",
      "content": "Expert users need rich affordances, even at the cost of surface complexity.",
      "conditions": ["professional tools", "expert users"],
      "confidence": 0.89,
      "source": { "ref": "cooper-af", "location": "Ch.12" },
      "domains": ["interaction-design"]
    }
  ],
  "relations": [
    {
      "from": "unit-a",
      "to": "unit-b",
      "type": "contradicts",
      "confidence": 0.85,
      "note": "Scope-dependent: casual users vs expert users"
    }
  ]
}
```

A chatbot reading this might say: "Sources disagree — Krug recommends
simplicity for casual users, Cooper recommends richness for experts."

Seisei reading this might produce a conditional rule: "If target user
is novice → simplify. If expert → expose affordances."

Both are valid. KX doesn't prescribe.

---

## Sources

```typescript
interface KXSource {
  id: string;                     // referenced by unit.source.ref
  type: "book" | "article" | "case-study" | "notes"
      | "guide" | "transcript" | "other";
  title: string;
  authors?: string[];
  url?: string;
}
```

---

## Full Example

A small KX document about usability, drawn from two books:

```json
{
  "version": "kx/1.0",
  "meta": {
    "domains": ["usability", "interaction-design"],
    "sources": [
      {
        "id": "krug-dmmt",
        "type": "book",
        "title": "Don't Make Me Think",
        "authors": ["Steve Krug"]
      },
      {
        "id": "norman-doet",
        "type": "book",
        "title": "The Design of Everyday Things",
        "authors": ["Don Norman"]
      }
    ],
    "generatedBy": "metis/0.1",
    "generatedAt": "2026-04-09T10:00:00Z"
  },
  "units": [
    {
      "id": "affordance-def-01",
      "kind": "definition",
      "content": "An affordance is a relationship between the properties of an object and the capabilities of the agent that determines how the object could be used.",
      "roles": {
        "term": "affordance",
        "meaning": "relationship between object properties and agent capabilities that determines possible use"
      },
      "conditions": [],
      "confidence": 0.95,
      "source": { "ref": "norman-doet", "location": "Ch.1" },
      "domains": ["interaction-design"]
    },
    {
      "id": "signifier-def-01",
      "kind": "definition",
      "content": "A signifier is a perceivable cue that communicates what action is possible. Affordances determine what is possible; signifiers communicate where the action should take place.",
      "roles": {
        "term": "signifier",
        "meaning": "perceivable cue communicating possible action and its location"
      },
      "conditions": [],
      "confidence": 0.94,
      "source": { "ref": "norman-doet", "location": "Ch.1" },
      "domains": ["interaction-design"]
    },
    {
      "id": "scan-heuristic-01",
      "kind": "heuristic",
      "content": "Users scan web pages rather than reading them. Design for scanning: clear visual hierarchy, short text blocks, obvious clickable elements.",
      "roles": {
        "situation": "designing any web page",
        "action": "design for scanning with clear hierarchy, short blocks, obvious links",
        "rationale": "users scan rather than read"
      },
      "conditions": ["web pages", "screen-based reading"],
      "confidence": 0.92,
      "source": { "ref": "krug-dmmt", "location": "Ch.2" },
      "domains": ["usability", "web-design"]
    },
    {
      "id": "feedback-principle-01",
      "kind": "principle",
      "content": "Every action should produce an immediate, visible result. Without feedback, users cannot confirm their action worked and will retry or abandon the task.",
      "roles": {
        "statement": "every action must produce immediate visible feedback",
        "implication": "without feedback users retry or abandon"
      },
      "conditions": ["interactive systems"],
      "confidence": 0.96,
      "source": { "ref": "norman-doet", "location": "Ch.2" },
      "domains": ["interaction-design", "usability"]
    }
  ],
  "relations": [
    {
      "from": "affordance-def-01",
      "to": "signifier-def-01",
      "type": "requires",
      "confidence": 0.90,
      "note": "Signifiers are how affordances are communicated to users"
    },
    {
      "from": "scan-heuristic-01",
      "to": "feedback-principle-01",
      "type": "reinforces",
      "confidence": 0.70,
      "note": "Both emphasize making interface state immediately perceivable"
    }
  ]
}
```

---

## Versioning

The `version` field uses the format `kx/MAJOR.MINOR`. Consumers should
check the major version and reject documents with an unknown major.

- **Major bump:** Breaking structural changes (new required fields,
  removed fields, changed semantics of existing fields).
- **Minor bump:** Additive changes (new optional fields, new `kind`
  values, new relation types).

Consumers should tolerate unknown `kind` values and unknown relation
types gracefully — treat them as opaque and pass through the `content`
field.

---

## Implementation Notes

### Producing KX

Any tool that produces KX should:

1. Generate stable, unique `id` values within the document.
2. Always populate `content` with readable natural language.
3. Include `conditions` even if empty (empty array means "always applies").
4. Set `confidence` to 1.0 if confidence scoring isn't available.
5. Map internal knowledge types to the closest KX `kind`.

### Consuming KX

Any tool that consumes KX should:

1. Work with `content` alone if `roles` are absent.
2. Handle unknown `kind` values (don't crash — treat as generic knowledge).
3. Handle unknown relation types (log and skip).
4. Use `conditions` to scope knowledge before applying it.
5. Check `relations` for `contradicts` before presenting knowledge as
   settled fact.

### File Convention

KX documents are JSON files with the `.kx.json` extension. This
distinguishes them from other JSON files and enables tooling to
recognize them.
