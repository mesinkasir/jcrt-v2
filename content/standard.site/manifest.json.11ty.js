export default class StandardSiteManifestTemplate {
	data() {
		return {
			permalink: "/standard.site/manifest.json",
			layout: false,
			eleventyExcludeFromCollections: true,
		};
	}

	render(data) {
		return `${JSON.stringify(data.standardSite.manifest, null, 2)}\n`;
	}
}
