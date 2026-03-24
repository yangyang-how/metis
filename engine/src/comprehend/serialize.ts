/**
 * Content serializer — converts ContentBlock[] into LLM message parts.
 *
 * Bridge between our typed data model and the LLM's text world.
 * Each ContentBlock type gets a deterministic markdown representation.
 * Images become separate MessageContent parts when vision is available.
 */
import type { MessageContent } from "../llm/types";
import type { ContentBlock, ListItem } from "../parse/types";
import type { NormalizedSection } from "./types";

export interface SerializeOptions {
	vision?: boolean;
}

export function serializeBlocks(
	blocks: ContentBlock[],
	options?: SerializeOptions,
): MessageContent[] {
	const parts: MessageContent[] = [];

	for (const block of blocks) {
		const result = serializeBlock(block, options);
		parts.push(...result);
	}

	return parts;
}

export function serializeSection(
	section: NormalizedSection,
	options?: SerializeOptions,
): MessageContent[] {
	const parts: MessageContent[] = [];

	parts.push({
		type: "text",
		text: `\n=== Section: ${section.title} (id: ${section.id}) ===\n\n`,
	});

	parts.push(...serializeBlocks(section.content, options));

	for (const child of section.sections) {
		parts.push(...serializeSection(child, options));
	}

	return parts;
}

function serializeBlock(
	block: ContentBlock,
	options?: SerializeOptions,
): MessageContent[] {
	switch (block.type) {
		case "paragraph":
			return [{ type: "text", text: `${block.text}\n\n` }];

		case "heading":
			return [
				{
					type: "text",
					text: `${"#".repeat(block.level)} ${block.text}\n\n`,
				},
			];

		case "table":
			return [{ type: "text", text: serializeTable(block) }];

		case "list":
			return [
				{
					type: "text",
					text: `${serializeList(block.items, block.ordered, 0)}\n`,
				},
			];

		case "code":
			return [
				{
					type: "text",
					text: `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\`\n\n`,
				},
			];

		case "blockquote":
			return [{ type: "text", text: `> ${block.text}\n\n` }];

		case "footnote":
			return [
				{ type: "text", text: `[Footnote ${block.id}]: ${block.text}\n\n` },
			];

		case "image":
			return serializeImage(block, options);
	}
}

function serializeTable(block: {
	rows: string[][];
	caption?: string;
}): string {
	const lines: string[] = [];

	if (block.caption) {
		lines.push(`*${block.caption}*\n`);
	}

	for (let i = 0; i < block.rows.length; i++) {
		const row = block.rows[i];
		if (!row) continue;
		lines.push(`| ${row.join(" | ")} |`);
		if (i === 0) {
			lines.push(`| ${row.map(() => "---").join(" | ")} |`);
		}
	}

	return `${lines.join("\n")}\n\n`;
}

function serializeList(
	items: ListItem[],
	ordered: boolean,
	indent: number,
): string {
	const lines: string[] = [];
	const prefix = " ".repeat(indent * 2);

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (!item) continue;
		const bullet = ordered ? `${i + 1}.` : "-";
		lines.push(`${prefix}${bullet} ${item.text}`);
		if (item.children && item.children.length > 0) {
			lines.push(serializeList(item.children, false, indent + 1));
		}
	}

	return `${lines.join("\n")}\n`;
}

function serializeImage(
	block: {
		originalPath: string;
		alt?: string;
		data: Uint8Array;
	},
	options?: SerializeOptions,
): MessageContent[] {
	const label = block.alt || block.originalPath;

	if (options?.vision && block.data.length > 0) {
		const mediaType = inferMediaType(block.originalPath);
		return [
			{ type: "text", text: `[Image: ${label}]\n\n` },
			{
				type: "image",
				data: new Uint8Array(block.data),
				mediaType,
			},
		];
	}

	return [{ type: "text", text: `[Image: ${label}]\n\n` }];
}

function inferMediaType(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "svg":
			return "image/svg+xml";
		default:
			return "image/png";
	}
}
