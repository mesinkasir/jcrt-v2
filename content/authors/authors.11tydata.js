export default {
	layout: "authors.njk",
	eleventyComputed: {
		fileSlug: (data) => data.page.fileSlug,
		title: (data) => data.name || data.title || data.page.fileSlug,
		description: (data) =>
			data.affiliation || data.organization || data.description || "",
		image: (data) => (data.image && String(data.image).trim() ? data.image : "/images/jcrt-open-graph.webp"),
		key: (data) => data.key || data.page.fileSlug,
		permalink: (data) => `/authors/${data.page.fileSlug}/`,
		website: (data) => {
			if (!data.website) return [];
			return Array.isArray(data.website) ? data.website : [data.website];
		},
		social: (data) => {
			if (!data.social) return [];
			return Array.isArray(data.social) ? data.social : [data.social];
		}
	},
};
