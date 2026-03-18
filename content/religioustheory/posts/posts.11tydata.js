export default {
	tags: [
		"theoryPosts"
	],
	"layout": "archive-post.njk",
	eleventyComputed: {
		risCitationUrl: (data) => {
			const slug = data?.page?.fileSlug;
			if (!slug) return null;
			return `https://files.jcrt.org/citations/religioustheory/${slug}.ris`;
		},
		jsonCitationUrl: (data) => {
			const slug = data?.page?.fileSlug;
			if (!slug) return null;
			return `https://files.jcrt.org/citations/religioustheory/${slug}.csl.json`;
		},
	},
};
