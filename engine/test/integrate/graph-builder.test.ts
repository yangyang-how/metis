import { describe, expect, test } from "bun:test";
import {
	buildAdjacencyList,
	finalizeAtoms,
} from "../../src/integrate/graph-builder";
import type { EntityIndex, Relation } from "../../src/integrate/types";
import { makeAtom } from "./fixtures/sample-atoms";

describe("finalizeAtoms", () => {
	test("promotes CandidateAtom to Atom with empty cross-references", () => {
		const atom = makeAtom({ id: "test-1" });
		const [finalized] = finalizeAtoms([atom], {}, []);
		expect(finalized?.entityRefs).toEqual([]);
		expect(finalized?.reinforcedBy).toEqual([]);
		expect(finalized?.contradictedBy).toEqual([]);
		expect(finalized?.extendedBy).toEqual([]);
	});

	test("populates entityRefs from entity index", () => {
		const atom = makeAtom({ id: "test-1" });
		const entities: EntityIndex = {
			"entity:foo": {
				id: "entity:foo",
				canonicalName: "foo",
				aliases: [],
				domain: "testing",
				atomIds: ["test-1"],
				crossDomainLinks: [],
			},
		};
		const [finalized] = finalizeAtoms([atom], entities, []);
		expect(finalized?.entityRefs).toEqual(["entity:foo"]);
	});

	test("populates reinforcedBy from relations", () => {
		const atomA = makeAtom({ id: "a", confidence: 0.8 });
		const atomB = makeAtom({ id: "b", confidence: 0.8 });
		const relations: Relation[] = [
			{
				type: "reinforces",
				atomA: "a",
				atomB: "b",
				confidence: 0.95,
				method: "algorithmic",
			},
		];

		const finalized = finalizeAtoms([atomA, atomB], {}, relations);
		const fA = finalized.find((a) => a.id === "a");
		const fB = finalized.find((a) => a.id === "b");
		expect(fA).toBeDefined();
		expect(fB).toBeDefined();
		expect(fA?.reinforcedBy).toContain("b");
		expect(fB?.reinforcedBy).toContain("a");
	});

	test("boosts confidence for reinforced atoms (capped at 1.0)", () => {
		const atom = makeAtom({ id: "a", confidence: 0.9 });
		const relations: Relation[] = [
			{
				type: "reinforces",
				atomA: "a",
				atomB: "b",
				confidence: 0.95,
				method: "algorithmic",
			},
			{
				type: "reinforces",
				atomA: "a",
				atomB: "c",
				confidence: 0.92,
				method: "algorithmic",
			},
			{
				type: "reinforces",
				atomA: "a",
				atomB: "d",
				confidence: 0.91,
				method: "algorithmic",
			},
		];
		const [finalized] = finalizeAtoms([atom], {}, relations);
		// 0.9 + 0.05 * 3 = 1.05 → capped at 1.0
		expect(finalized?.confidence).toBe(1.0);
	});

	test("populates contradictedBy from relations", () => {
		const atomA = makeAtom({ id: "a" });
		const atomB = makeAtom({ id: "b" });
		const relations: Relation[] = [
			{
				type: "contradicts",
				atomA: "a",
				atomB: "b",
				confidence: 0.85,
				method: "llm",
			},
		];
		const finalized = finalizeAtoms([atomA, atomB], {}, relations);
		expect(finalized.find((a) => a.id === "a")?.contradictedBy).toContain("b");
		expect(finalized.find((a) => a.id === "b")?.contradictedBy).toContain("a");
	});

	test("populates extendedBy from relations", () => {
		const atomA = makeAtom({ id: "a" });
		const atomB = makeAtom({ id: "b" });
		const relations: Relation[] = [
			{
				type: "extends",
				atomA: "a",
				atomB: "b",
				confidence: 0.8,
				method: "algorithmic",
			},
		];
		const finalized = finalizeAtoms([atomA, atomB], {}, relations);
		expect(finalized.find((a) => a.id === "a")?.extendedBy).toContain("b");
		expect(finalized.find((a) => a.id === "b")?.extendedBy).toContain("a");
	});
});

describe("buildAdjacencyList", () => {
	test("creates entity_link edges for atoms sharing an entity", () => {
		const entities: EntityIndex = {
			"entity:foo": {
				id: "entity:foo",
				canonicalName: "foo",
				aliases: [],
				domain: "testing",
				atomIds: ["a", "b"],
				crossDomainLinks: [],
			},
		};
		const graph = buildAdjacencyList(
			[makeAtom({ id: "a" }), makeAtom({ id: "b" })],
			entities,
			[],
		);
		expect(
			graph.a?.some((e) => e.target === "b" && e.type === "entity_link"),
		).toBe(true);
		expect(
			graph.b?.some((e) => e.target === "a" && e.type === "entity_link"),
		).toBe(true);
	});

	test("creates bidirectional reinforces edges", () => {
		const relations: Relation[] = [
			{
				type: "reinforces",
				atomA: "a",
				atomB: "b",
				confidence: 0.95,
				method: "algorithmic",
			},
		];
		const graph = buildAdjacencyList(
			[makeAtom({ id: "a" }), makeAtom({ id: "b" })],
			{},
			relations,
		);
		expect(
			graph.a?.some((e) => e.target === "b" && e.type === "reinforces"),
		).toBe(true);
		expect(
			graph.b?.some((e) => e.target === "a" && e.type === "reinforces"),
		).toBe(true);
	});

	test("creates cross_domain edges between linked entities", () => {
		const entities: EntityIndex = {
			"entity:foo-domainA": {
				id: "entity:foo-domainA",
				canonicalName: "foo",
				aliases: [],
				domain: "domainA",
				atomIds: ["a"],
				crossDomainLinks: ["entity:foo-domainB"],
			},
			"entity:foo-domainB": {
				id: "entity:foo-domainB",
				canonicalName: "foo",
				aliases: [],
				domain: "domainB",
				atomIds: ["b"],
				crossDomainLinks: ["entity:foo-domainA"],
			},
		};
		const graph = buildAdjacencyList(
			[makeAtom({ id: "a" }), makeAtom({ id: "b" })],
			entities,
			[],
		);
		expect(
			graph.a?.some((e) => e.target === "b" && e.type === "cross_domain"),
		).toBe(true);
	});
});
