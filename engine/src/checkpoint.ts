/**
 * Checkpoint manager — save and resume pipeline state between stages.
 *
 * Each book gets its own checkpoint directory under {graphDir}/.checkpoints/{slug}/.
 * Stage outputs are saved as JSON. A meta.json tracks stage statuses, timing,
 * and pipeline config so --resume knows where to pick up.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const STAGE_ORDER = ["parse", "comprehend", "extract", "integrate"] as const;
type StageName = (typeof STAGE_ORDER)[number];

export type StageStatus =
	| { status: "pending" }
	| { status: "completed"; completedAt: string; durationMs: number }
	| { status: "failed"; error: string; failedAt: string };

export interface CheckpointMeta {
	bookSlug: string;
	startedAt: string;
	stages: Record<string, StageStatus>;
	config: Record<string, string>;
}

export interface CheckpointManager {
	save(stage: string, data: unknown): void;
	load<T>(stage: string): T | null;
	getMeta(): CheckpointMeta | null;
	updateStage(stage: string, status: StageStatus): void;
	setConfig(config: Record<string, string>): void;
	getResumePoint(): string | null;
	clear(): void;
}

function ensureDir(dir: string) {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

export function createCheckpointManager(
	bookSlug: string,
	graphDir: string,
): CheckpointManager {
	const checkpointDir = join(graphDir, bookSlug);
	const metaPath = join(checkpointDir, "meta.json");

	function readMeta(): CheckpointMeta | null {
		if (!existsSync(metaPath)) return null;
		try {
			return JSON.parse(readFileSync(metaPath, "utf8")) as CheckpointMeta;
		} catch {
			return null;
		}
	}

	function writeMeta(meta: CheckpointMeta) {
		ensureDir(checkpointDir);
		writeFileSync(metaPath, JSON.stringify(meta, null, 2));
	}

	function getOrCreateMeta(): CheckpointMeta {
		const existing = readMeta();
		if (existing) return existing;
		const fresh: CheckpointMeta = {
			bookSlug,
			startedAt: new Date().toISOString(),
			stages: {},
			config: {},
		};
		for (const stage of STAGE_ORDER) {
			fresh.stages[stage] = { status: "pending" };
		}
		return fresh;
	}

	return {
		save(stage: string, data: unknown) {
			ensureDir(checkpointDir);
			const filePath = join(checkpointDir, `${stage}.json`);
			writeFileSync(filePath, JSON.stringify(data));
		},

		load<T>(stage: string): T | null {
			const filePath = join(checkpointDir, `${stage}.json`);
			if (!existsSync(filePath)) return null;
			try {
				return JSON.parse(readFileSync(filePath, "utf8")) as T;
			} catch {
				return null;
			}
		},

		getMeta(): CheckpointMeta | null {
			return readMeta();
		},

		updateStage(stage: string, status: StageStatus) {
			const meta = getOrCreateMeta();
			meta.stages[stage] = status;
			writeMeta(meta);
		},

		setConfig(config: Record<string, string>) {
			const meta = getOrCreateMeta();
			meta.config = { ...meta.config, ...config };
			writeMeta(meta);
		},

		getResumePoint(): string | null {
			const meta = readMeta();
			if (!meta) return null;
			for (const stage of STAGE_ORDER) {
				const status = meta.stages[stage];
				if (!status || status.status !== "completed") {
					return stage;
				}
			}
			return null; // all completed
		},

		clear() {
			if (existsSync(checkpointDir)) {
				rmSync(checkpointDir, { recursive: true });
			}
		},
	};
}

/**
 * Format checkpoint status for display.
 */
export function formatCheckpointStatus(meta: CheckpointMeta): string {
	const lines: string[] = [];
	lines.push(`Checkpoint: ${meta.bookSlug}`);
	lines.push(`Started: ${meta.startedAt}`);

	if (Object.keys(meta.config).length > 0) {
		const provider = meta.config.comprehendProvider ?? "unknown";
		const model = meta.config.comprehendModel ?? "unknown";
		lines.push(`Config: ${provider}/${model}`);
	}

	lines.push("");

	for (const stage of STAGE_ORDER) {
		const status = meta.stages[stage];
		if (!status || status.status === "pending") {
			lines.push(`  ${stage.padEnd(14)} · pending`);
		} else if (status.status === "completed") {
			const duration = formatDuration(status.durationMs);
			lines.push(`  ${stage.padEnd(14)} ✓ completed (${duration})`);
		} else if (status.status === "failed") {
			lines.push(`  ${stage.padEnd(14)} ✗ failed — "${status.error}"`);
		}
	}

	return lines.join("\n");
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.round((ms % 60000) / 1000);
	return `${minutes}m ${seconds}s`;
}
