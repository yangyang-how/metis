export interface ParseInput {
	filePath: string;
	options?: {
		extractImages?: boolean;
	};
}

export interface DocumentMetadata {
	title: string;
	authors: string[];
	language?: string;
	publisher?: string;
	publishDate?: string;
	isbn?: string;
}

export interface DocumentTree {
	metadata: DocumentMetadata;
	chapters: Chapter[];
}

export interface Chapter {
	id: string;
	title: string;
	order: number;
	sections: Section[];
	content: ContentBlock[];
}

export interface Section {
	id: string;
	title: string;
	level: number;
	content: ContentBlock[];
	sections: Section[];
}

export interface ListItem {
	text: string;
	children?: ListItem[];
}

export type ContentBlock =
	| { type: "paragraph"; text: string }
	| { type: "heading"; text: string; level: number }
	| { type: "table"; rows: string[][]; caption?: string }
	| {
			type: "image";
			originalPath: string;
			alt?: string;
			caption?: string;
			data: Uint8Array;
	  }
	| { type: "footnote"; id: string; text: string }
	| { type: "blockquote"; text: string }
	| { type: "list"; ordered: boolean; items: ListItem[] }
	| { type: "code"; text: string; language?: string };

/**
 * Intermediate type produced by ToC parsing (Pass 1).
 * Both EPUB2 NCX and EPUB3 Nav parsers output this same shape —
 * the strategy pattern's common interface.
 */
export interface ChapterSkeleton {
	id: string;
	title: string;
	order: number;
	spineFileRef: string;
	fragmentId?: string;
	children: ChapterSkeleton[];
}

/**
 * Maps a spine file position to the tree nodes whose content lives in that file.
 * Array because one file can contain multiple chapters (fragment-based splitting).
 */
export interface SpineMapping {
	node: Chapter | Section;
	startFragmentId?: string;
	endFragmentId?: string;
}
