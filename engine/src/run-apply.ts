/**
 * CLI entry point for the Apply pipeline.
 *
 * Usage:
 *   bun run src/run-apply.ts "query" [options]
 *
 * See docs/superpowers/specs/2026-04-09-apply-pipeline-design.md for full spec.
 */
import { writeFileSync } from "node:fs";
import { applyPipeline, exportGaps, exportToKX } from "./apply/index";
import type { GroupingStrategy, QueryPlan } from "./apply/types";
import type { GraphIndex } from "./integrate/types";
import { createProvider, withRetry } from "./llm/provider";
import type { ProviderConfig } from "./llm/types";

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	let query = "";
	let graphDir = "graph";
	let format: "native" | "kx" = "native";
	let topK = 20;
	let maxDepth = 2;
	let minConfidence = 0.5;
	let maxExpanded = 50;
	let groupBy: GroupingStrategy | undefined;
	let noTraverse = false;
	let noGaps = false;
	let noSummarize = false;
	let providerName = "kimi";
	let modelName = "";
	let domains: string[] = [];
	let frameTypes: string[] = [];
	let entities: string[] = [];
	let jsonOutput = false;
	let outputPath = "";

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--graph-dir") {
			graphDir = args[++i] ?? graphDir;
		} else if (arg === "--format") {
			format = (args[++i] as "native" | "kx") ?? format;
		} else if (arg === "--top-k") {
			topK = Number.parseInt(args[++i] ?? "20", 10);
		} else if (arg === "--max-depth") {
			maxDepth = Number.parseInt(args[++i] ?? "2", 10);
		} else if (arg === "--min-confidence") {
			minConfidence = Number.parseFloat(args[++i] ?? "0.5");
		} else if (arg === "--max-expanded") {
			maxExpanded = Number.parseInt(args[++i] ?? "50", 10);
		} else if (arg === "--group-by") {
			groupBy = args[++i] as GroupingStrategy;
		} else if (arg === "--no-traverse") {
			noTraverse = true;
		} else if (arg === "--no-gaps") {
			noGaps = true;
		} else if (arg === "--no-summarize") {
			noSummarize = true;
		} else if (arg === "--provider") {
			providerName = args[++i] ?? providerName;
		} else if (arg === "--model") {
			modelName = args[++i] ?? modelName;
		} else if (arg === "--domains") {
			domains = (args[++i] ?? "").split(",").filter(Boolean);
		} else if (arg === "--frame-types") {
			frameTypes = (args[++i] ?? "").split(",").filter(Boolean);
		} else if (arg === "--entities") {
			entities = (args[++i] ?? "").split(",").filter(Boolean);
		} else if (arg === "--json") {
			jsonOutput = true;
		} else if (arg === "--output") {
			outputPath = args[++i] ?? "";
		} else if (arg && !arg.startsWith("--")) {
			query = arg;
		}
	}

	return {
		query,
		graphDir,
		format,
		topK,
		maxDepth,
		minConfidence,
		maxExpanded,
		groupBy,
		noTraverse,
		noGaps,
		noSummarize,
		providerName,
		modelName,
		domains,
		frameTypes,
		entities,
		jsonOutput,
		outputPath,
	};
}

async function main() {
	const config = parseArgs(process.argv);

	if (!config.query) {
		console.error("Usage: bun run src/run-apply.ts <query> [options]");
		console.error(
			'Try: bun run src/run-apply.ts "How does replication work?" --graph-dir graph/',
		);
		process.exit(1);
	}

	console.log(`Query: "${config.query}"`);
	console.log(`Graph: ${config.graphDir}`);
	console.log(`Format: ${config.format}`);

	// Build manual plan from CLI flags, or use LLM
	let manualPlan: QueryPlan | undefined;
	if (
		config.domains.length > 0 ||
		config.frameTypes.length > 0 ||
		config.entities.length > 0
	) {
		manualPlan = {
			intent: config.query,
			analysisType: "manual",
			targetDomains: config.domains,
			targetFrameTypes: config.frameTypes,
			targetEntities: config.entities,
			weights: { domainMatch: 0.5, frameTypeMatch: 0.5, entityMatch: 0.5 },
			groupingStrategy: config.groupBy ?? "entity",
		};
		console.log("Using manual QueryPlan from CLI flags.");
	}

	// Set up LLM provider if not using manual plan
	const defaultModel =
		config.providerName === "kimi"
			? "kimi-k2-0711-preview"
			: "claude-haiku-4-5-20251001";
	const providerConfig: ProviderConfig = {
		provider: config.providerName as ProviderConfig["provider"],
		model: config.modelName || defaultModel,
	};

	const understandProvider = manualPlan
		? undefined
		: withRetry(createProvider(providerConfig));
	const summaryProvider = config.noSummarize
		? undefined
		: withRetry(createProvider(providerConfig));

	// Build confidence thresholds array from base value
	const minConfidence: number[] = [];
	for (let d = 1; d <= config.maxDepth; d++) {
		minConfidence.push(Math.min(config.minConfidence + (d - 1) * 0.2, 0.95));
	}

	console.log("Running Apply pipeline...\n");

	const pkg = await applyPipeline({
		query: config.query,
		graphDir: config.graphDir,
		manualPlan,
		understandProvider,
		summaryProvider,
		options: {
			topK: config.topK,
			maxDepth: config.maxDepth,
			minConfidence,
			maxExpanded: config.maxExpanded,
			noTraverse: config.noTraverse,
			noGaps: config.noGaps,
			noSummarize: config.noSummarize,
		},
	});

	// Output
	if (config.format === "kx") {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		// Load graph index for KX relation mapping
		let graphIndex: GraphIndex = {};
		try {
			graphIndex = JSON.parse(
				readFileSync(join(config.graphDir, "graph.json"), "utf8"),
			) as GraphIndex;
		} catch {
			// No graph index available — relations will be empty
		}

		const kxDoc = exportToKX(pkg, graphIndex);
		const gapsDoc = exportGaps(config.query, pkg.gaps, pkg.stats);
		const output = JSON.stringify(kxDoc, null, 2);

		if (config.outputPath) {
			writeFileSync(config.outputPath, output);
			writeFileSync(
				config.outputPath.replace(".kx.json", ".gaps.json"),
				JSON.stringify(gapsDoc, null, 2),
			);
			console.log(`KX document written to ${config.outputPath}`);
		} else if (config.jsonOutput) {
			process.stdout.write(output);
		} else {
			console.log(output);
			console.log("\n--- Gaps ---");
			console.log(JSON.stringify(gapsDoc, null, 2));
		}
	} else {
		const output = JSON.stringify(pkg, null, 2);
		if (config.outputPath) {
			writeFileSync(config.outputPath, output);
			console.log(`ContextPackage written to ${config.outputPath}`);
		} else if (config.jsonOutput) {
			process.stdout.write(output);
		} else {
			// Human-readable summary
			console.log("=== Results ===\n");
			console.log(`Intent: ${pkg.plan.intent}`);
			console.log(`Sections: ${pkg.sections.length}`);
			console.log(`Atoms retrieved: ${pkg.stats.totalAtomsRetrieved}`);
			console.log(
				`Atoms after traversal: ${pkg.stats.totalAtomsAfterTraversal}`,
			);
			console.log(`Contradictions: ${pkg.stats.contradictionsFound}`);
			console.log(`Gaps: ${pkg.stats.gapsFound}\n`);

			for (const section of pkg.sections) {
				console.log(
					`--- ${section.topic} (${section.atoms.length} atoms) ---`,
				);
				if (section.summary) {
					console.log(`  ${section.summary}\n`);
				}
				for (const atom of section.atoms) {
					console.log(
						`  [${atom.frame}] ${Object.values(atom.roles).join(" — ")}`,
					);
				}
				console.log();
			}

			if (pkg.contradictions.length > 0) {
				console.log("=== Contradictions ===\n");
				for (const c of pkg.contradictions) {
					console.log(`  Topic: ${c.topic}`);
					for (const side of c.sides) {
						console.log(`    - ${side.claim} (${side.sources.join(", ")})`);
					}
					console.log(`    Note: ${c.note}\n`);
				}
			}

			if (pkg.gaps.length > 0) {
				console.log("=== Gaps ===\n");
				for (const gap of pkg.gaps) {
					console.log(`  [${gap.severity}] ${gap.description}`);
					if (gap.suggestion) console.log(`    → ${gap.suggestion}`);
				}
			}
		}
	}
}

main().catch((error) => {
	console.error("Apply pipeline failed:", error);
	process.exit(1);
});
