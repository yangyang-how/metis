/**
 * Evaluation CLI — run quality checks on atom batches.
 *
 * Usage:
 *   bun run src/run-eval.ts <atoms.json>
 *   bun run src/run-eval.ts <output.json> --raw
 *   bun run src/run-eval.ts --compare <raw.json> <final.json>
 *
 * Options:
 *   --raw           input is a per-book output file (has .extraction.atoms)
 *   --compare       compare two files (before/after)
 *   --format table|json   output format (default: table)
 *   --verbose       show individual atom failures
 */
import { readFileSync } from "node:fs";
import { compareReports } from "./eval/comparison";
import { type EvalReport, runEval } from "./eval/runner";
import { createRegistry } from "./extract/frame-registry";
import type { CandidateAtom } from "./extract/types";

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	const files: string[] = [];
	let raw = false;
	let compare = false;
	let format: "table" | "json" = "table";
	let verbose = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--raw") raw = true;
		else if (arg === "--compare") compare = true;
		else if (arg === "--format")
			format = (args[++i] ?? "table") as typeof format;
		else if (arg === "--verbose") verbose = true;
		else if (arg && !arg.startsWith("--")) files.push(arg);
	}

	return { files, raw, compare, format, verbose };
}

function loadAtoms(path: string, raw: boolean): CandidateAtom[] {
	const data = JSON.parse(readFileSync(path, "utf8"));
	if (raw && data.extraction?.atoms) {
		return data.extraction.atoms;
	}
	if (Array.isArray(data)) {
		return data;
	}
	throw new Error(
		`Cannot parse atoms from ${path}. Use --raw for per-book output files.`,
	);
}

function printTable(report: EvalReport) {
	console.error(`Evaluation Report: ${report.source}`);
	console.error(`Atoms evaluated: ${report.atomCount}\n`);

	const header = `${"Layer".padEnd(14)}${"Check".padEnd(32)}${"Pass".padStart(6)}${"Fail".padStart(6)}${"Rate".padStart(8)}`;
	console.error(header);
	console.error("─".repeat(header.length));

	for (const c of report.checks) {
		const rate = `${(c.rate * 100).toFixed(1)}%`;
		console.error(
			`${c.layer.padEnd(14)}${c.check.replace(`${c.layer}:`, "").padEnd(32)}${String(c.pass).padStart(6)}${String(c.fail).padStart(6)}${rate.padStart(8)}`,
		);
	}

	console.error("─".repeat(header.length));
	console.error(
		`${"AGGREGATE".padEnd(14)}${"atoms with ≥1 issue".padEnd(32)}${String(report.atomCount - report.aggregate.atomsWithIssues).padStart(6)}${String(report.aggregate.atomsWithIssues).padStart(6)}${`${(report.aggregate.issueRate * 100).toFixed(1)}%`.padStart(8)}`,
	);
}

function printComparison(before: EvalReport, after: EvalReport) {
	const comparison = compareReports(before, after);
	console.error("Before/After Comparison");
	console.error(
		`  Raw extraction:  ${before.atomCount} atoms, ${before.aggregate.atomsWithIssues} issues (${(comparison.before.issueRate * 100).toFixed(1)}%)`,
	);
	console.error(
		`  Final graph:     ${after.atomCount} atoms, ${after.aggregate.atomsWithIssues} issues (${(comparison.after.issueRate * 100).toFixed(1)}%)`,
	);
	console.error(
		`  Reduction:       ${(comparison.before.issueRate * 100).toFixed(1)}% → ${(comparison.after.issueRate * 100).toFixed(1)}% (${comparison.reductionPct.toFixed(1)}% reduction)`,
	);

	if (comparison.perCheck.length > 0) {
		console.error("\n  Per-check breakdown:");
		for (const c of comparison.perCheck) {
			if (c.beforeRate > 0 || c.afterRate > 0) {
				console.error(
					`    ${c.check.padEnd(38)} ${(c.beforeRate * 100).toFixed(1)}% → ${(c.afterRate * 100).toFixed(1)}%`,
				);
			}
		}
	}
}

function main() {
	const config = parseArgs(process.argv);

	if (config.files.length === 0) {
		console.error("Usage:");
		console.error("  bun run src/run-eval.ts <atoms.json>");
		console.error("  bun run src/run-eval.ts <output.json> --raw");
		console.error(
			"  bun run src/run-eval.ts --compare <raw.json> <final.json>",
		);
		console.error("");
		console.error("Options:");
		console.error("  --raw           input is per-book output file");
		console.error("  --compare       compare two files (before/after)");
		console.error("  --format table|json");
		console.error("  --verbose       show atom-level failures");
		process.exit(1);
	}

	const registry = createRegistry();

	if (config.compare && config.files.length >= 2) {
		const beforePath = config.files[0] ?? "";
		const afterPath = config.files[1] ?? "";
		const beforeAtoms = loadAtoms(beforePath, true);
		const afterAtoms = loadAtoms(afterPath, false);
		const beforeReport = runEval(beforeAtoms, {
			registry,
			source: beforePath,
		});
		const afterReport = runEval(afterAtoms, {
			registry,
			source: afterPath,
		});

		if (config.format === "json") {
			console.log(
				JSON.stringify(compareReports(beforeReport, afterReport), null, 2),
			);
		} else {
			printComparison(beforeReport, afterReport);
		}
		return;
	}

	// Single file evaluation
	const filePath = config.files[0] ?? "";
	const atoms = loadAtoms(filePath, config.raw);
	const report = runEval(atoms, { registry, source: filePath });

	if (config.format === "json") {
		console.log(JSON.stringify(report, null, 2));
	} else {
		printTable(report);
		if (config.verbose) {
			console.error("\nFailed atoms:");
			for (const c of report.checks) {
				if (c.samples.length > 0) {
					console.error(`  ${c.check}: ${c.samples.join(", ")}`);
				}
			}
		}
	}
}

main();
