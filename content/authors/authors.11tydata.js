import { authorSlug } from "../../_config/authorSlug.js";

const MIN_AUTHOR_POSTS = parseInt(process.env.MIN_AUTHOR_POSTS || "2", 10);

export default {
	layout: "authors.njk",
	eleventyComputed: {
		fileSlug: (data) => data.page.fileSlug,
		title: (data) => data.name || data.title || data.page.fileSlug,
		description: (data) =>
			data.affiliation || data.organization || data.description || "",
		image: (data) => (data.image && String(data.image).trim() ? data.image : "/images/jcrt-open-graph.webp"),
		key: (data) => data.key || data.page.fileSlug,
		permalink: (data) => {
			const slug = authorSlug(data.name || data.title || data.page.fileSlug);
			const postCount = (data.authorPostCounts && data.authorPostCounts[slug]) || 0;
			if (postCount < MIN_AUTHOR_POSTS) return false;
			return `/authors/${data.page.fileSlug}/`;
		},
	},
};
