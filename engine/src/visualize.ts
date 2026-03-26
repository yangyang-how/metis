/**
 * Generate HTML visualization reports for all processed books.
 *
 * Usage: bun run src/visualize.ts
 *
 * Reads JSON output files from engine/output/ and generates:
 * - engine/output/index.html  — overview of all books
 * - engine/output/{slug}.html — per-book detail report
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = join(new URL(".", import.meta.url).pathname, "../output");

interface BookData {
	metadata: { title: string; authors: string[] };
	comprehension: {
		chapterMaps: Array<{
			chapterId: string;
			chapterType: string;
			summary: string;
			structures: Array<{
				name: string;
				type: string;
				components: string[];
			}>;
			sectionAnalyses: Array<{
				sectionId: string;
				title: string;
				purpose: string;
				knowledgeTypes: string[];
				conceptsIntroduced: string[];
			}>;
		}>;
		bookSynthesis: {
			crossCuttingThemes: Array<{
				name: string;
				description: string;
				chapterIds: string[];
			}>;
			entityIndex: Array<{
				name: string;
				aliases: string[];
				chapterIds: string[];
			}>;
		};
		usage: {
			totalInputTokens: number;
			totalOutputTokens: number;
			failedChapters: string[];
		};
	};
	extraction: {
		atoms: Array<{
			id: string;
			frame: string;
			roles: Record<string, string>;
			conditions: string[];
			confidence: number;
			source: {
				chapterId: string;
				sectionId: string;
			};
			domain: string[];
			examples: string[];
			flags: string[];
		}>;
		totalAtoms: number;
	};
	registrySize: number;
}

function esc(s: string): string {
	if (!s) return "";
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function css(): string {
	return `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, 'Helvetica Neue', sans-serif; max-width: 1100px; margin: 0 auto; padding: 2rem; background: #fafafa; color: #222; line-height: 1.6; }
h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
h2 { font-size: 1.4rem; margin: 1.5rem 0 0.75rem; border-bottom: 2px solid #2563eb; padding-bottom: 0.3rem; }
h3 { font-size: 1.1rem; margin: 1rem 0 0.5rem; }
.subtitle { color: #666; margin-bottom: 1.5rem; }
.stats { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
.stat { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 0.75rem 1.25rem; }
.stat-value { font-size: 1.4rem; font-weight: 700; color: #2563eb; }
.stat-label { font-size: 0.8rem; color: #666; }
.card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
.card:hover { border-color: #2563eb; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
.tag { display: inline-block; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 3px; padding: 1px 6px; margin: 2px; font-size: 0.78rem; }
.tag.frame { background: #ede9fe; border-color: #c4b5fd; color: #5b21b6; }
.tag.domain { background: #dbeafe; border-color: #93c5fd; color: #1e40af; }
.tag.concept { background: #dcfce7; border-color: #86efac; color: #166534; }
.tag.flag { background: #fef3c7; border-color: #fde047; color: #854d0e; }
.type-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.78rem; font-weight: 600; }
.type-badge.framework { background: #dbeafe; color: #1e40af; }
.type-badge.narrative { background: #fef3c7; color: #92400e; }
.type-badge.practical { background: #d1fae5; color: #065f46; }
.type-badge.argumentative { background: #fce7f3; color: #9d174d; }
.type-badge.survey { background: #e0e7ff; color: #3730a3; }
.type-badge.unknown { background: #f3f4f6; color: #6b7280; }
.atom { border-left: 3px solid #c4b5fd; padding: 0.75rem; margin: 0.5rem 0; background: #fafafa; border-radius: 0 4px 4px 0; }
.atom-header { display: flex; justify-content: space-between; align-items: center; }
.atom-frame { font-weight: 600; color: #5b21b6; }
.atom-confidence { font-size: 0.8rem; color: #666; }
.roles { margin: 0.5rem 0; font-size: 0.9rem; }
.role-name { color: #888; font-weight: 500; }
.bar { height: 20px; border-radius: 3px; display: inline-block; }
.chart { margin: 0.5rem 0; }
details summary { cursor: pointer; color: #2563eb; font-weight: 500; padding: 0.25rem 0; }
table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
th, td { text-align: left; padding: 0.4rem 0.75rem; border-bottom: 1px solid #eee; font-size: 0.9rem; }
th { background: #f8fafc; font-weight: 600; }
`;
}

function generateIndex(books: Array<{ slug: string; data: BookData }>): string {
	const totalAtoms = books.reduce(
		(s, b) => s + b.data.extraction.atoms.length,
		0,
	);
	const totalChapters = books.reduce(
		(s, b) => s + b.data.comprehension.chapterMaps.length,
		0,
	);

	const rows = books
		.map((b) => {
			const atoms = b.data.extraction.atoms.length;
			const chapters = b.data.comprehension.chapterMaps.length;
			const failed = b.data.comprehension.usage.failedChapters.length;
			const title = esc(b.data.metadata.title);
			const authors = esc(b.data.metadata.authors.join(", "));
			return `<tr>
	<td><a href="${b.slug}.html"><strong>${title}</strong></a><br><span style="color:#888;font-size:0.8rem">${authors}</span></td>
	<td>${chapters}</td>
	<td>${failed}</td>
	<td><strong>${atoms}</strong></td>
	<td>${b.data.registrySize}</td>
</tr>`;
		})
		.join("\n");

	return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Metis — Extraction Results</title>
<style>${css()}</style></head><body>
<h1>Metis Extraction Results</h1>
<p class="subtitle">8 books processed through Parse → Comprehend → Extract</p>
<div class="stats">
<div class="stat"><div class="stat-value">${books.length}</div><div class="stat-label">Books</div></div>
<div class="stat"><div class="stat-value">${totalChapters}</div><div class="stat-label">Chapters</div></div>
<div class="stat"><div class="stat-value">${totalAtoms.toLocaleString()}</div><div class="stat-label">Atoms</div></div>
</div>
<table>
<thead><tr><th>Book</th><th>Chapters</th><th>Failed</th><th>Atoms</th><th>Frame Types</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body></html>`;
}

function generateBookReport(slug: string, data: BookData): string {
	const atoms = data.extraction.atoms;
	const maps = data.comprehension.chapterMaps;

	// Frame type distribution
	const frameCounts: Record<string, number> = {};
	for (const a of atoms) {
		frameCounts[a.frame] = (frameCounts[a.frame] || 0) + 1;
	}
	const sortedFrames = Object.entries(frameCounts).sort((a, b) => b[1] - a[1]);
	const maxCount = sortedFrames[0]?.[1] ?? 1;

	const frameChart = sortedFrames
		.map(
			([frame, count]) =>
				`<div style="display:flex;align-items:center;gap:0.5rem;margin:2px 0">
		<span style="width:140px;font-size:0.85rem;text-align:right">${frame}</span>
		<div class="bar" style="width:${(count / maxCount) * 300}px;background:#8b5cf6">&nbsp;</div>
		<span style="font-size:0.8rem;color:#666">${count}</span>
	</div>`,
		)
		.join("\n");

	// Chapter summaries
	const chapterCards = maps
		.filter((m) => m.summary)
		.map(
			(m) => `<div class="card">
	<div style="display:flex;justify-content:space-between;align-items:center">
		<strong>${esc(m.chapterId)}</strong>
		<span class="type-badge ${m.chapterType}">${m.chapterType}</span>
	</div>
	<p style="color:#555;margin:0.25rem 0;font-size:0.9rem">${esc(m.summary.slice(0, 200))}</p>
	${m.structures.length > 0 ? `<div>${m.structures.map((s) => `<span class="tag frame">${esc(s.name)} (${s.type})</span>`).join(" ")}</div>` : ""}
</div>`,
		)
		.join("\n");

	// Sample atoms (first 50)
	const atomCards = atoms
		.slice(0, 50)
		.map((a) => {
			const roleRows = Object.entries(a.roles)
				.map(
					([k, v]) =>
						`<span class="role-name">${esc(k)}:</span> ${esc(String(v).slice(0, 200))}`,
				)
				.join("<br>");
			const flags = a.flags.length
				? a.flags
						.map((f) => `<span class="tag flag">${esc(f)}</span>`)
						.join(" ")
				: "";
			return `<div class="atom">
	<div class="atom-header">
		<span class="atom-frame">${esc(a.frame)}</span>
		<span class="atom-confidence">${(a.confidence * 100).toFixed(0)}%</span>
	</div>
	<div class="roles">${roleRows}</div>
	${a.conditions.length ? `<div style="font-size:0.8rem;color:#888">When: ${esc(a.conditions.join(", "))}</div>` : ""}
	${a.domain.length ? `<div>${a.domain.map((d) => `<span class="tag domain">${esc(d)}</span>`).join(" ")}</div>` : ""}
	${flags}
</div>`;
		})
		.join("\n");

	// Themes
	const themes = data.comprehension.bookSynthesis?.crossCuttingThemes ?? [];
	const themeSection = themes.length
		? `<h2>Cross-Cutting Themes</h2>${themes.map((t) => `<div class="card"><strong>${esc(t.name)}</strong><p style="color:#555;font-size:0.9rem">${esc(t.description)}</p></div>`).join("\n")}`
		: "";

	return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(data.metadata.title)} — Metis</title>
<style>${css()}</style></head><body>
<p><a href="index.html">← All Books</a></p>
<h1>${esc(data.metadata.title)}</h1>
<p class="subtitle">${esc(data.metadata.authors.join(", "))}</p>
<div class="stats">
<div class="stat"><div class="stat-value">${maps.length}</div><div class="stat-label">Chapters</div></div>
<div class="stat"><div class="stat-value">${atoms.length}</div><div class="stat-label">Atoms</div></div>
<div class="stat"><div class="stat-value">${sortedFrames.length}</div><div class="stat-label">Frame Types</div></div>
<div class="stat"><div class="stat-value">${data.comprehension.usage.failedChapters.length}</div><div class="stat-label">Failed Chapters</div></div>
</div>

<h2>Frame Type Distribution</h2>
<div class="chart">${frameChart}</div>

${themeSection}

<h2>Chapters</h2>
${chapterCards}

<h2>Atoms (first 50 of ${atoms.length})</h2>
${atomCards}
${atoms.length > 50 ? `<p style="color:#888;font-style:italic">...and ${atoms.length - 50} more atoms in the JSON file.</p>` : ""}
</body></html>`;
}

// Main
const files = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".json"));
const books: Array<{ slug: string; data: BookData }> = [];

for (const file of files) {
	const data = JSON.parse(
		readFileSync(join(OUTPUT_DIR, file), "utf-8"),
	) as BookData;
	const slug = file.replace(".json", "");
	books.push({ slug, data });

	const reportPath = join(OUTPUT_DIR, `${slug}.html`);
	writeFileSync(reportPath, generateBookReport(slug, data));
	console.log(
		`Generated: ${slug}.html (${data.extraction.atoms.length} atoms)`,
	);
}

writeFileSync(join(OUTPUT_DIR, "index.html"), generateIndex(books));
console.log(`\nGenerated index.html with ${books.length} books`);
console.log(`Open: file://${join(OUTPUT_DIR, "index.html")}`);
