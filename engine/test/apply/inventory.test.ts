// engine/test/apply/inventory.test.ts
import { describe, expect, test } from "bun:test";
import { buildInventory } from "../../src/apply/inventory";
import { sampleGraph } from "./fixtures/sample-graph";

describe("buildInventory", () => {
  const inventory = buildInventory(sampleGraph);

  test("counts domains correctly", () => {
    const dsDomain = inventory.domains.find((d) => d.name === "distributed-systems");
    expect(dsDomain).toBeDefined();
    expect(dsDomain!.atomCount).toBeGreaterThan(0);
  });

  test("domains sorted by atom count descending", () => {
    for (let i = 1; i < inventory.domains.length; i++) {
      expect(inventory.domains[i]!.atomCount).toBeLessThanOrEqual(
        inventory.domains[i - 1]!.atomCount,
      );
    }
  });

  test("lists entities with aliases", () => {
    const repl = inventory.entities.find((e) => e.name === "replication");
    expect(repl).toBeDefined();
    expect(repl!.aliases.length).toBeGreaterThan(0);
  });

  test("counts frame types correctly", () => {
    const defType = inventory.frameTypes.find((f) => f.name === "definition");
    expect(defType).toBeDefined();
    expect(defType!.count).toBeGreaterThan(0);
  });

  test("extracts source list", () => {
    const ddia = inventory.sources.find((s) => s.title === "DDIA");
    expect(ddia).toBeDefined();
    expect(ddia!.atomCount).toBeGreaterThan(0);
  });
});
