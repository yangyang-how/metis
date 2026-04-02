/**
 * Tests for checkpoint integration with the pipeline.
 *
 * These test the CheckpointManager behavior in pipeline-like scenarios,
 * not the full pipeline itself (which requires LLM calls).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	type CheckpointMeta,
	createCheckpointManager,
	formatCheckpointStatus,
} from "../../src/checkpoint";

const TEST_DIR = join(import.meta.dir, ".tmp-pipeline-checkpoints");

afterEach(() => {
	if (existsSync(TEST_DIR)) {
		rmSync(TEST_DIR, { recursive: true });
	}
});

describe("checkpoint pipeline integration", () => {
	test("saves checkpoint after parse stage completes", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		const parseResult = {
			metadata: { title: "Test Book" },
			chapters: [{ id: "ch1", title: "Chapter 1" }],
		};

		mgr.save("parse", parseResult);
		mgr.updateStage("parse", {
			status: "completed",
			completedAt: new Date().toISOString(),
			durationMs: 1200,
		});

		expect(mgr.load<typeof parseResult>("parse")).toEqual(parseResult);
		expect(mgr.getMeta()?.stages.parse?.status).toBe("completed");
	});

	test("saves checkpoint after comprehend stage completes", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		const comprehendResult = {
			chapterMaps: [{ chapterId: "ch1", summary: "about testing" }],
		};

		mgr.save("comprehend", comprehendResult);
		mgr.updateStage("comprehend", {
			status: "completed",
			completedAt: new Date().toISOString(),
			durationMs: 180000,
		});

		expect(mgr.load<typeof comprehendResult>("comprehend")).toEqual(
			comprehendResult,
		);
	});

	test("on resume, skips parse when parse checkpoint exists", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		mgr.save("parse", { data: "parse-output" });
		mgr.updateStage("parse", {
			status: "completed",
			completedAt: "now",
			durationMs: 100,
		});

		// Simulate resume: check what to skip
		const resumePoint = mgr.getResumePoint();
		expect(resumePoint).toBe("comprehend"); // parse done, start from comprehend

		// Load parse output instead of re-running
		const cached = mgr.load("parse");
		expect(cached).toEqual({ data: "parse-output" });
	});

	test("on resume, skips parse+comprehend when both checkpoints exist", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		mgr.save("parse", { data: "parse" });
		mgr.updateStage("parse", {
			status: "completed",
			completedAt: "now",
			durationMs: 100,
		});
		mgr.save("comprehend", { data: "comprehend" });
		mgr.updateStage("comprehend", {
			status: "completed",
			completedAt: "now",
			durationMs: 5000,
		});

		expect(mgr.getResumePoint()).toBe("extract");
	});

	test("on resume with no checkpoints, runs from beginning", () => {
		const mgr = createCheckpointManager("fresh-book", TEST_DIR);
		// No checkpoints saved
		expect(mgr.getResumePoint()).toBeNull(); // no meta = no resume point
		expect(mgr.getMeta()).toBeNull();
	});

	test("rebuild clears checkpoints", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		mgr.save("parse", { data: true });
		mgr.updateStage("parse", {
			status: "completed",
			completedAt: "now",
			durationMs: 100,
		});

		// Simulate --rebuild-graph
		mgr.clear();
		expect(mgr.load("parse")).toBeNull();
		expect(mgr.getMeta()).toBeNull();
	});

	test("checkpoint-status formats stage summary", () => {
		const meta: CheckpointMeta = {
			bookSlug: "designing-data-intensive-applications",
			startedAt: "2026-03-28T10:00:00Z",
			stages: {
				parse: {
					status: "completed",
					completedAt: "2026-03-28T10:00:01Z",
					durationMs: 1200,
				},
				comprehend: {
					status: "completed",
					completedAt: "2026-03-28T10:03:12Z",
					durationMs: 192000,
				},
				extract: {
					status: "failed",
					error: "Rate limit exceeded",
					failedAt: "2026-03-28T10:05:00Z",
				},
				integrate: { status: "pending" },
			},
			config: {
				comprehendProvider: "kimi",
				comprehendModel: "kimi-k2-0711-preview",
			},
		};

		const output = formatCheckpointStatus(meta);
		expect(output).toContain("designing-data-intensive-applications");
		expect(output).toContain("✓ completed");
		expect(output).toContain("✗ failed");
		expect(output).toContain("Rate limit exceeded");
		expect(output).toContain("· pending");
	});

	test("checkpoint config mismatch is detectable", () => {
		const mgr = createCheckpointManager("test-book", TEST_DIR);
		mgr.setConfig({
			comprehendProvider: "kimi",
			comprehendModel: "kimi-k2-0711-preview",
		});
		mgr.updateStage("parse", {
			status: "completed",
			completedAt: "now",
			durationMs: 100,
		});

		const meta = mgr.getMeta();
		// Pipeline can compare current config vs checkpoint config
		const currentConfig = {
			comprehendProvider: "anthropic",
			comprehendModel: "claude-sonnet",
		};

		const mismatch =
			meta?.config.comprehendProvider !== currentConfig.comprehendProvider ||
			meta?.config.comprehendModel !== currentConfig.comprehendModel;
		expect(mismatch).toBe(true);
	});
});
