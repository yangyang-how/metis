#!/usr/bin/env bun
/**
 * metis — unified CLI entry point.
 *
 * Usage:
 *   metis learn <project-dir> [options]
 *   metis apply <project-dir> "<query>" [options]
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenAIEmbeddingProvider } from "./llm/openai-embedding";
import { createProvider, withRetry } from "./llm/provider";
import type { ProviderConfig } from "./llm/types";

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
	printUsage();
	process.exit(0);
}

if (command === "learn") {
	await runLearn(args.slice(1));
} else if (command === "apply") {
	await runApply(args.slice(1));
} else {
	console.error(`Unknown command: ${command}`);
	printUsage();
	process.exit(1);
}

async function runLearn(argv: string[]) {
	const { learnProject } = await import("./learn/learn-project");

	let projectDir = "";
	let rebuild = false;
	let yes = false;
	let dryRun = false;
	let comprehendProvider = "kimi";
	let comprehendModel = "kimi-for-coding";
	let extractProvider = "kimi";
	let extractModel = "kimi-for-coding";
	let integrateProvider = "kimi";
	let integrateModel = "kimi-for-coding";
	let embeddingModel = "text-embedding-3-large";

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] as string;
		if (arg === "--rebuild") {
			rebuild = true;
		} else if (arg === "--yes") {
			yes = true;
		} else if (arg === "--dry-run") {
			dryRun = true;
		} else if (arg === "--comprehend-provider") {
			comprehendProvider = (argv[++i] as string) ?? comprehendProvider;
		} else if (arg === "--comprehend-model") {
			comprehendModel = (argv[++i] as string) ?? comprehendModel;
		} else if (arg === "--extract-provider") {
			extractProvider = (argv[++i] as string) ?? extractProvider;
		} else if (arg === "--extract-model") {
			extractModel = (argv[++i] as string) ?? extractModel;
		} else if (arg === "--integrate-provider") {
			integrateProvider = (argv[++i] as string) ?? integrateProvider;
		} else if (arg === "--integrate-model") {
			integrateModel = (argv[++i] as string) ?? integrateModel;
		} else if (arg === "--embedding-model") {
			embeddingModel = (argv[++i] as string) ?? embeddingModel;
		} else if (!arg.startsWith("-")) {
			projectDir = arg;
		}
	}

	if (!projectDir) {
		console.error("Error: project directory required.");
		console.error("Usage: metis learn <project-dir> [options]");
		process.exit(1);
	}

	projectDir = resolve(projectDir);

	if (!existsSync(projectDir)) {
		console.error(`Error: directory not found: ${projectDir}`);
		process.exit(1);
	}

	if (rebuild && !yes) {
		console.error(
			"Warning: --rebuild will wipe the existing graph and re-learn everything.",
		);
		console.error("Pass --yes to skip this confirmation.");
		process.exit(1);
	}

	if (dryRun) {
		const { scanSources } = await import("./learn/scan-sources");
		const { loadManifest, emptyManifest, matchSources } = await import(
			"./learn/manifest"
		);
		const { loadProjectConfig } = await import("./learn/config");
		const config = loadProjectConfig(projectDir);
		const manifest =
			loadManifest(projectDir) ?? emptyManifest(config.profile);
		const { files, unsupported } = scanSources(projectDir);
		const result = matchSources(files, manifest);
		console.error(`Profile: ${config.profile}`);
		console.error(`Sources: ${files.length} supported, ${unsupported.length} unsupported`);
		console.error(`To learn: ${result.toLearn.length}`);
		console.error(`To archive: ${result.toArchive.length}`);
		console.error(`Unchanged: ${result.unchanged.length}`);
		if (result.toLearn.length > 0) {
			for (const item of result.toLearn) {
				console.error(`  ${item.kind}: ${item.relPath}`);
			}
		}
		return;
	}

	const mkProvider = (provider: string, model: string) =>
		withRetry(
			createProvider({
				provider: provider as ProviderConfig["provider"],
				model,
			}),
		);

	const result = await learnProject({
		projectDir,
		rebuild,
		comprehendProvider: mkProvider(comprehendProvider, comprehendModel),
		extractProvider: mkProvider(extractProvider, extractModel),
		integrateProvider: mkProvider(integrateProvider, integrateModel),
		embeddingProvider: createOpenAIEmbeddingProvider({
			provider: "openai",
			model: embeddingModel,
		}),
	});

	console.error("");
	console.error("=== Learn Complete ===");
	console.error(`Learned: ${result.learned} sources`);
	console.error(`Archived: ${result.archived} sources`);
	console.error(`Unchanged: ${result.unchanged} sources`);
	console.error(`Total atoms: ${result.totalAtoms}`);
}

async function runApply(argv: string[]) {
	// Delegate to existing run-apply logic with project-dir scoping
	let projectDir = "";
	let query = "";
	const passthrough: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] as string;
		if (!arg.startsWith("-") && !projectDir) {
			projectDir = arg;
		} else if (!arg.startsWith("-") && !query) {
			query = arg;
		} else {
			passthrough.push(arg);
			if (
				[
					"--format",
					"--output",
					"--top-k",
					"--max-depth",
					"--min-confidence",
					"--provider",
					"--model",
					"--domains",
					"--frame-types",
					"--entities",
				].includes(arg)
			) {
				i++;
				passthrough.push((argv[i] as string) ?? "");
			}
		}
	}

	if (!projectDir || !query) {
		console.error("Usage: metis apply <project-dir> \"<query>\" [options]");
		process.exit(1);
	}

	projectDir = resolve(projectDir);
	const graphDir = `${projectDir}/.metis`;

	if (!existsSync(graphDir)) {
		console.error(
			`Error: no .metis/ directory in ${projectDir}. Run 'metis learn' first.`,
		);
		process.exit(1);
	}

	// Rewrite args to pass to existing apply runner
	const applyArgs = [query, "--graph-dir", graphDir, ...passthrough];

	// Dynamically set process.argv for the apply runner
	const originalArgv = process.argv;
	process.argv = ["bun", "run-apply.ts", ...applyArgs];

	try {
		await import("./run-apply");
	} finally {
		process.argv = originalArgv;
	}
}

function printUsage() {
	console.error("metis — knowledge learning and retrieval engine");
	console.error("");
	console.error("Commands:");
	console.error("  learn <project-dir> [options]     Learn from sources in a project");
	console.error('  apply <project-dir> "<query>"     Query a project\'s knowledge graph');
	console.error("");
	console.error("Learn options:");
	console.error("  --rebuild                         Wipe and re-learn everything");
	console.error("  --yes                             Skip confirmation prompts");
	console.error("  --dry-run                         Show what would be learned");
	console.error("  --comprehend-provider <name>      (default: kimi)");
	console.error("  --comprehend-model <name>         (default: kimi-for-coding)");
	console.error("  --extract-provider <name>         (default: kimi)");
	console.error("  --extract-model <name>            (default: kimi-for-coding)");
	console.error("  --integrate-provider <name>       (default: kimi)");
	console.error("  --integrate-model <name>          (default: kimi-for-coding)");
	console.error("  --embedding-model <name>          (default: text-embedding-3-large)");
	console.error("");
	console.error("Apply options:");
	console.error("  --format native|kx                (default: native)");
	console.error("  --output <path>                   Write to file");
	console.error("  --top-k <n>                       (default: 20)");
	console.error("  --json                            Raw JSON output");
}
