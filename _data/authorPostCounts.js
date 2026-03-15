/**
 * Pre-compute post counts per author slug so that authors.11tydata.js
 * can skip rendering pages for authors with fewer than MIN_AUTHOR_POSTS.
 * Runs once during the data cascade (fast — just parses frontmatter).
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { authorSlug, splitAuthors } from "../_config/authorSlug.js";

const contentDirs = [
	path.resolve("content/archives"),
	path.resolve("content/religioustheory/posts"),
];

function walkMdFiles(dir) {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (entry.isFile() && entry.name.endsWith(".md")) {
			results.push(path.join(entry.parentPath || entry.path, entry.name));
		}
	}
	return results;
}

export default function () {
	const counts = new Map();
	for (const dir of contentDirs) {
		for (const file of walkMdFiles(dir)) {
			try {
				const raw = fs.readFileSync(file, "utf8");
				const { data } = matter(raw);
				if (!data.author) continue;
				for (const name of splitAuthors(data.author)) {
					const slug = authorSlug(name);
					if (!slug) continue;
					counts.set(slug, (counts.get(slug) || 0) + 1);
				}
			} catch {
				// skip unreadable files
			}
		}
	}
	return Object.fromEntries(counts);
}
