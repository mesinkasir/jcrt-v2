export default class StandardSitePublicationTemplate {
	data() {
		return {
			permalink: "/standard.site/publication.json",
			layout: false,
			eleventyExcludeFromCollections: true,
		};
	}

	render(data) {
		return `${JSON.stringify(data.standardSite.publication, null, 2)}\n`;
	}
}
