import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../src/extract/frame-registry";

describe("createRegistry", () => {
	test("loads all 17 core types", () => {
		const registry = createRegistry();
		expect(registry.getAll()).toHaveLength(17);
	});

	test("getCoreTypes returns only core types", () => {
		const registry = createRegistry();
		const core = registry.getCoreTypes();
		expect(core).toHaveLength(17);
		for (const ft of core) {
			expect(ft.category).toBe("core");
		}
	});
});

describe("registry.get", () => {
	test("returns definition frame type", () => {
		const registry = createRegistry();
		const def = registry.get("definition");
		expect(def).toBeDefined();
		expect(def?.roles).toHaveProperty("term");
		expect(def?.roles).toHaveProperty("meaning");
		expect(def?.requiredRoles).toContain("term");
		expect(def?.requiredRoles).toContain("meaning");
	});

	test("returns undefined for nonexistent type", () => {
		const registry = createRegistry();
		expect(registry.get("nonexistent")).toBeUndefined();
	});
});

describe("registry.has", () => {
	test("returns true for existing types", () => {
		const registry = createRegistry();
		expect(registry.has("definition")).toBe(true);
		expect(registry.has("causal")).toBe(true);
		expect(registry.has("deviation")).toBe(true);
	});

	test("returns false for nonexistent types", () => {
		const registry = createRegistry();
		expect(registry.has("made_up_type")).toBe(false);
	});
});

describe("registry.register", () => {
	test("registers a new domain type", () => {
		const registry = createRegistry();
		const ft = registry.register({
			name: "stage_characteristics",
			roles: {
				stage: "lifecycle stage",
				competition: "competitive dynamics",
			},
			description: "Characteristics of an industry lifecycle stage",
			proposedBy: "s5",
		});

		expect(ft.name).toBe("stage_characteristics");
		expect(ft.category).toBe("domain-specific");
		expect(ft.version).toBe(1);
		expect(registry.has("stage_characteristics")).toBe(true);
		expect(registry.getAll()).toHaveLength(18);
	});

	test("returns existing type when duplicate name proposed", () => {
		const registry = createRegistry();
		registry.register({
			name: "my_type",
			roles: { a: "first", b: "second" },
			description: "First version",
			proposedBy: "s1",
		});

		const duplicate = registry.register({
			name: "my_type",
			roles: { x: "different", y: "roles" },
			description: "Second version",
			proposedBy: "s2",
		});

		// First registration wins
		expect(duplicate.roles).toHaveProperty("a");
		expect(duplicate.roles).not.toHaveProperty("x");
		expect(registry.getAll()).toHaveLength(18); // 17 core + 1 domain
	});

	test("rejects proposed type with fewer than 2 roles", () => {
		const registry = createRegistry();
		expect(() =>
			registry.register({
				name: "bad_type",
				roles: { only_one: "role" },
				description: "Not enough roles",
				proposedBy: "s1",
			}),
		).toThrow();
	});

	test("rejects proposed type with empty description", () => {
		const registry = createRegistry();
		expect(() =>
			registry.register({
				name: "no_desc",
				roles: { a: "first", b: "second" },
				description: "",
				proposedBy: "s1",
			}),
		).toThrow();
	});
});
