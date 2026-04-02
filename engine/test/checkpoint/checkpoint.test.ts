import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	type CheckpointMeta,
	createCheckpointManager,
} from "../../src/checkpoint";

const TEST_DIR = join(import.meta.dir, ".tmp-checkpoints");

afterEach(() => {
	if (existsSync(TEST_DIR)) {
		rmSync(TEST_DIR, { recursive: true });
	}
});

describe("CheckpointManager", () => {
	test("saves stage data to disk as JSON", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		const data = { chapters: [{ id: "ch1", title: "Introduction" }] };
		mgr.save("parse", data);

		const filePath = join(TEST_DIR, "test-book", "parse.json");
		expect(existsSync(filePath)).toBe(true);
	});

	test("loads stage data back with correct shape", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		const data = { chapters: [{ id: "ch1", title: "Introduction" }] };
		mgr.save("parse", data);

		const loaded = mgr.load<typeof data>("parse");
		expect(loaded).toEqual(data);
	});

	test("returns null for stage that has not been saved", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		expect(mgr.load("parse")).toBeNull();
	});

	test("saves and loads metadata", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		mgr.updateStage("parse", {
			status: "completed",
			completedAt: "2026-03-28T10:00:00Z",
			durationMs: 1200,
		});

		const meta = mgr.getMeta();
		expect(meta).not.toBeNull();
		expect(meta?.stages.parse?.status).toBe("completed");
	});

	test("clear() removes all checkpoint files for a book", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		mgr.save("parse", { data: true });
		mgr.updateStage("parse", {
			status: "completed",
			completedAt: "now",
			durationMs: 100,
		});

		mgr.clear();
		expect(mgr.load("parse")).toBeNull();
		expect(mgr.getMeta()).toBeNull();
	});

	test("handles missing checkpoint directory gracefully", () => {
		// Directory doesn't exist yet — should create it on save
		const mgr = createCheckpointManager("new-book", TEST_DIR);
		mgr.save("parse", { test: true });
		expect(mgr.load<{ test: boolean }>("parse")).toEqual({ test: true });
	});

	test("different books have isolated checkpoints", () => {
		const mgr1 = createCheckpointManager("book-a", TEST_DIR);
		const mgr2 = createCheckpointManager("book-b", TEST_DIR);

		mgr1.save("parse", { book: "a" });
		mgr2.save("parse", { book: "b" });

		expect(mgr1.load<{ book: string }>("parse")).toEqual({ book: "a" });
		expect(mgr2.load<{ book: string }>("parse")).toEqual({ book: "b" });
	});

	test("getResumePoint() returns first non-completed stage", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		mgr.updateStage("parse", {
			status: "completed",
			completedAt: "now",
			durationMs: 100,
		});
		mgr.updateStage("comprehend", {
			status: "completed",
			completedAt: "now",
			durationMs: 5000,
		});

		expect(mgr.getResumePoint()).toBe("extract");
	});

	test("getResumePoint() returns null when all stages completed", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		for (const stage of ["parse", "comprehend", "extract", "integrate"]) {
			mgr.updateStage(stage, {
				status: "completed",
				completedAt: "now",
				durationMs: 100,
			});
		}

		expect(mgr.getResumePoint()).toBeNull();
	});

	test("getResumePoint() returns the failed stage", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		mgr.updateStage("parse", {
			status: "completed",
			completedAt: "now",
			durationMs: 100,
		});
		mgr.updateStage("comprehend", {
			status: "failed",
			error: "Rate limit exceeded",
			failedAt: "now",
		});

		expect(mgr.getResumePoint()).toBe("comprehend");
	});

	test("records config in metadata", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		mgr.setConfig({
			comprehendProvider: "kimi",
			comprehendModel: "kimi-k2-0711-preview",
		});

		const meta = mgr.getMeta();
		expect(meta?.config.comprehendProvider).toBe("kimi");
	});
});
