export default class StandardSiteDocumentsTemplate {
	data() {
		return {
			permalink: "/standard.site/documents.json",
			layout: false,
			eleventyExcludeFromCollections: true,
		};
	}

	render(data) {
		return `${JSON.stringify(data.standardSite.documents, null, 2)}\n`;
	}
}
