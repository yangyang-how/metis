// engine/test/apply/fixtures/sample-graph.ts
/**
 * Synthetic KnowledgeGraph for Apply pipeline unit tests.
 *
 * Two domains: "distributed-systems" and "databases".
 * ~20 atoms with known relationships.
 * Designed so tests can assert exact traversal/gap behavior.
 */
import type {
  Atom,
  Entity,
  EntityIndex,
  GraphIndex,
  KnowledgeGraph,
  VectorIndex,
} from "../../../src/integrate/types";

function makeAtom(overrides: Partial<Atom>): Atom {
  return {
    id: "test-0",
    frame: "definition",
    roles: { term: "test", meaning: "a test atom" },
    conditions: [],
    confidence: 0.85,
    source: {
      title: "Test Book",
      authors: ["Author"],
      chapterId: "ch1",
      sectionId: "s1",
    },
    domain: ["testing"],
    examples: [],
    flags: [],
    entityRefs: [],
    reinforcedBy: [],
    contradictedBy: [],
    extendedBy: [],
    ...overrides,
  };
}

// --- Atoms: distributed-systems domain ---

export const atomReplication = makeAtom({
  id: "ds-replication-def",
  frame: "definition",
  roles: { term: "replication", meaning: "copying data across multiple nodes for fault tolerance" },
  domain: ["distributed-systems"],
  entityRefs: ["entity-replication"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch5", sectionId: "s1" },
});

export const atomLeaderFollower = makeAtom({
  id: "ds-leader-follower",
  frame: "procedure",
  roles: { goal: "replicate data", steps: "one leader accepts writes, followers replicate asynchronously" },
  domain: ["distributed-systems"],
  entityRefs: ["entity-replication"],
  confidence: 0.9,
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch5", sectionId: "s2" },
});

export const atomReplicationLag = makeAtom({
  id: "ds-replication-lag",
  frame: "deviation",
  roles: { theory: "followers are always up to date", reality: "replication lag causes stale reads", implication: "need read-after-write consistency" },
  domain: ["distributed-systems"],
  entityRefs: ["entity-replication", "entity-consistency"],
  contradictedBy: ["ds-eventual-ok"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch5", sectionId: "s3" },
});

export const atomEventualOk = makeAtom({
  id: "ds-eventual-ok",
  frame: "heuristic",
  roles: { situation: "low-stakes reads", action: "accept eventual consistency", rationale: "simpler architecture, lower latency" },
  domain: ["distributed-systems"],
  conditions: ["non-critical reads", "high availability needed"],
  entityRefs: ["entity-consistency"],
  contradictedBy: ["ds-replication-lag"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch5", sectionId: "s4" },
});

export const atomPartitioning = makeAtom({
  id: "ds-partitioning-def",
  frame: "definition",
  roles: { term: "partitioning", meaning: "splitting data across nodes so each holds a subset" },
  domain: ["distributed-systems"],
  entityRefs: ["entity-partitioning"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch6", sectionId: "s1" },
});

export const atomConsensus = makeAtom({
  id: "ds-consensus-def",
  frame: "definition",
  roles: { term: "consensus", meaning: "getting multiple nodes to agree on a value" },
  domain: ["distributed-systems"],
  entityRefs: ["entity-consensus"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch9", sectionId: "s1" },
});

export const atomPaxos = makeAtom({
  id: "ds-paxos",
  frame: "procedure",
  roles: { goal: "achieve consensus", steps: "propose, promise, accept phases" },
  domain: ["distributed-systems"],
  entityRefs: ["entity-consensus"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch9", sectionId: "s2" },
});

export const atomRaft = makeAtom({
  id: "ds-raft",
  frame: "method_comparison",
  roles: { method_a: "Paxos", method_b: "Raft", difference: "Raft is easier to understand", when_to_use: "prefer Raft for new systems" },
  domain: ["distributed-systems"],
  entityRefs: ["entity-consensus"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch9", sectionId: "s3" },
});

export const atomCAPTheorem = makeAtom({
  id: "ds-cap-theorem",
  frame: "principle",
  roles: { statement: "in a network partition you must choose consistency or availability", implication: "design systems knowing which you sacrifice" },
  domain: ["distributed-systems"],
  entityRefs: ["entity-consistency", "entity-partitioning"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch9", sectionId: "s4" },
});

// --- Atoms: databases domain ---

export const atomBTree = makeAtom({
  id: "db-btree-def",
  frame: "definition",
  roles: { term: "B-tree", meaning: "balanced tree index for sorted key lookups" },
  domain: ["databases"],
  entityRefs: ["entity-btree"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch3", sectionId: "s1" },
});

export const atomLSMTree = makeAtom({
  id: "db-lsm-def",
  frame: "definition",
  roles: { term: "LSM-tree", meaning: "log-structured merge tree for write-heavy workloads" },
  domain: ["databases"],
  entityRefs: ["entity-lsm"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch3", sectionId: "s2" },
});

export const atomBTreeVsLSM = makeAtom({
  id: "db-btree-vs-lsm",
  frame: "method_comparison",
  roles: { method_a: "B-tree", method_b: "LSM-tree", difference: "B-tree faster reads, LSM faster writes", when_to_use: "LSM for write-heavy, B-tree for read-heavy" },
  domain: ["databases"],
  entityRefs: ["entity-btree", "entity-lsm"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch3", sectionId: "s3" },
});

export const atomACID = makeAtom({
  id: "db-acid-def",
  frame: "definition",
  roles: { term: "ACID", meaning: "atomicity, consistency, isolation, durability — transaction safety guarantees" },
  domain: ["databases"],
  entityRefs: ["entity-transactions"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch7", sectionId: "s1" },
});

export const atomIsolationLevels = makeAtom({
  id: "db-isolation-levels",
  frame: "taxonomy",
  roles: { concept: "isolation levels", categories: "read uncommitted, read committed, repeatable read, serializable", basis: "strictness of concurrency control" },
  domain: ["databases"],
  entityRefs: ["entity-transactions"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch7", sectionId: "s2" },
});

export const atomSerializable = makeAtom({
  id: "db-serializable",
  frame: "heuristic",
  roles: { situation: "need strict correctness", action: "use serializable isolation", rationale: "prevents all anomalies but reduces throughput" },
  domain: ["databases"],
  conditions: ["correctness over throughput"],
  entityRefs: ["entity-transactions"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch7", sectionId: "s3" },
});

// --- Cross-domain atoms ---

export const atomDistributedTx = makeAtom({
  id: "cross-dist-tx",
  frame: "causal",
  roles: { cause: "distributed systems need transactions across partitions", effect: "two-phase commit required but reduces availability" },
  domain: ["distributed-systems", "databases"],
  entityRefs: ["entity-transactions", "entity-consensus"],
  source: { title: "DDIA", authors: ["Martin Kleppmann"], chapterId: "ch9", sectionId: "s5" },
});

// --- Second source atoms (for multi-source testing) ---

export const atomReplicationAlt = makeAtom({
  id: "alt-replication",
  frame: "principle",
  roles: { statement: "replication is the foundation of fault tolerance in distributed systems" },
  domain: ["distributed-systems"],
  entityRefs: ["entity-replication"],
  reinforcedBy: ["ds-replication-def"],
  source: { title: "Distributed Systems Handbook", authors: ["Alt Author"], chapterId: "ch1", sectionId: "s1" },
});

// --- All atoms ---

export const allAtoms: Atom[] = [
  atomReplication,
  atomLeaderFollower,
  atomReplicationLag,
  atomEventualOk,
  atomPartitioning,
  atomConsensus,
  atomPaxos,
  atomRaft,
  atomCAPTheorem,
  atomBTree,
  atomLSMTree,
  atomBTreeVsLSM,
  atomACID,
  atomIsolationLevels,
  atomSerializable,
  atomDistributedTx,
  atomReplicationAlt,
];

// --- Entities ---

export const entities: EntityIndex = {
  "entity-replication": {
    id: "entity-replication",
    canonicalName: "replication",
    aliases: ["data replication", "replica"],
    domain: "distributed-systems",
    atomIds: ["ds-replication-def", "ds-leader-follower", "ds-replication-lag", "alt-replication"],
    crossDomainLinks: [],
  },
  "entity-consistency": {
    id: "entity-consistency",
    canonicalName: "consistency",
    aliases: ["data consistency", "read consistency"],
    domain: "distributed-systems",
    atomIds: ["ds-replication-lag", "ds-eventual-ok", "ds-cap-theorem"],
    crossDomainLinks: [],
  },
  "entity-partitioning": {
    id: "entity-partitioning",
    canonicalName: "partitioning",
    aliases: ["sharding", "data partitioning"],
    domain: "distributed-systems",
    atomIds: ["ds-partitioning-def", "ds-cap-theorem"],
    crossDomainLinks: [],
  },
  "entity-consensus": {
    id: "entity-consensus",
    canonicalName: "consensus",
    aliases: ["distributed consensus", "agreement"],
    domain: "distributed-systems",
    atomIds: ["ds-consensus-def", "ds-paxos", "ds-raft", "cross-dist-tx"],
    crossDomainLinks: ["entity-transactions"],
  },
  "entity-btree": {
    id: "entity-btree",
    canonicalName: "B-tree",
    aliases: ["b-tree index"],
    domain: "databases",
    atomIds: ["db-btree-def", "db-btree-vs-lsm"],
    crossDomainLinks: [],
  },
  "entity-lsm": {
    id: "entity-lsm",
    canonicalName: "LSM-tree",
    aliases: ["log-structured merge tree"],
    domain: "databases",
    atomIds: ["db-lsm-def", "db-btree-vs-lsm"],
    crossDomainLinks: [],
  },
  "entity-transactions": {
    id: "entity-transactions",
    canonicalName: "transactions",
    aliases: ["database transactions", "ACID transactions"],
    domain: "databases",
    atomIds: ["db-acid-def", "db-isolation-levels", "db-serializable", "cross-dist-tx"],
    crossDomainLinks: ["entity-consensus"],
  },
};

// --- Graph edges ---
// Key: source atomId, Value: array of edges to targets

export const graphIndex: GraphIndex = {
  // Replication cluster
  "ds-replication-def": [
    { target: "ds-leader-follower", type: "extends", confidence: 0.85 },
    { target: "alt-replication", type: "reinforces", confidence: 0.9 },
    { target: "ds-replication-lag", type: "extends", confidence: 0.8 },
  ],
  "ds-leader-follower": [
    { target: "ds-replication-def", type: "extends", confidence: 0.85 },
  ],
  "ds-replication-lag": [
    { target: "ds-eventual-ok", type: "contradicts", confidence: 0.75 },
    { target: "ds-replication-def", type: "extends", confidence: 0.8 },
  ],
  "ds-eventual-ok": [
    { target: "ds-replication-lag", type: "contradicts", confidence: 0.75 },
  ],
  "alt-replication": [
    { target: "ds-replication-def", type: "reinforces", confidence: 0.9 },
  ],

  // Consensus cluster
  "ds-consensus-def": [
    { target: "ds-paxos", type: "extends", confidence: 0.9 },
    { target: "ds-raft", type: "extends", confidence: 0.85 },
    { target: "cross-dist-tx", type: "entity_link", confidence: 0.7 },
  ],
  "ds-paxos": [
    { target: "ds-raft", type: "reinforces", confidence: 0.6 },
  ],
  "ds-raft": [
    { target: "ds-paxos", type: "reinforces", confidence: 0.6 },
  ],

  // CAP connects replication and partitioning
  "ds-cap-theorem": [
    { target: "ds-replication-def", type: "entity_link", confidence: 0.7 },
    { target: "ds-partitioning-def", type: "entity_link", confidence: 0.7 },
    { target: "ds-eventual-ok", type: "extends", confidence: 0.65 },
  ],

  // Database cluster
  "db-btree-def": [
    { target: "db-btree-vs-lsm", type: "extends", confidence: 0.85 },
  ],
  "db-lsm-def": [
    { target: "db-btree-vs-lsm", type: "extends", confidence: 0.85 },
  ],
  "db-acid-def": [
    { target: "db-isolation-levels", type: "extends", confidence: 0.9 },
    { target: "db-serializable", type: "extends", confidence: 0.8 },
  ],
  "db-isolation-levels": [
    { target: "db-serializable", type: "extends", confidence: 0.85 },
  ],

  // Cross-domain
  "cross-dist-tx": [
    { target: "ds-consensus-def", type: "entity_link", confidence: 0.7 },
    { target: "db-acid-def", type: "cross_domain", confidence: 0.75 },
  ],
};

// --- Embeddings (minimal — just enough for vector search tests) ---
// In real tests, use mock embeddings. These are placeholder zeros.

export const embeddings: VectorIndex = allAtoms.map((a) => ({
  atomId: a.id,
  text: Object.values(a.roles).join(" "),
  embedding: new Array(3072).fill(0), // placeholder
}));

// --- Assembled graph ---

export const sampleGraph: KnowledgeGraph = {
  atoms: allAtoms,
  entities,
  graph: graphIndex,
  embeddings,
  stats: {
    totalAtoms: allAtoms.length,
    totalEntities: Object.keys(entities).length,
    newEntities: 0,
    mergedEntities: 0,
    reinforcements: 2,
    contradictions: 1,
    extensions: 8,
    crossDomainLinks: 2,
    llmCalls: 0,
    embeddingTokens: 0,
  },
};
