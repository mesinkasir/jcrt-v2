const ARCHIVE_ROOT_RE = /^\/archives\/([^/]+)\/(.+)$/i;
const ARCHIVE_INDEX_RE = /^index(?:\.(?:shtml|html))?\/?$/i;
const ARCHIVE_ARTICLE_EXT_RE = /^([^/]+)\.(shtml|html)$/i;
const ARCHIVE_PDF_RE = /^([^/]+)\.pdf$/i;
const LEGACY_ARCHIVE_PDF_REDIRECTS = new Map([
	["/archives/18.3/Roberts and Hayden.pdf", "/archives/18.3/robertsandhayden.pdf"],
	["/archives/17.2/Hagedorn and Staudigl.pdf", "/archives/17.2/Hagedorn-and-Staudigl.pdf"],
	["/archives/05 .3/flato.pdf", "/archives/05.3/flato.pdf"],
	["/archives/13.1/lugones.pdf-", "/archives/13.1/lugones.pdf"],
	["/archives/17.2/Leclerq.pdf", "/archives/17.2/leclercq.pdf"],
	["/archives/17.3/Datan.pdf", "/archives/17.3/Datar.pdf"],
	["/archives/06.3/blanton.pdf", "/archives/06.1/blanton.pdf"],
	["/archives/09.1/Malabou.pdf.", "/archives/09.1/Malabou.pdf"],
	["/archives/18.3/Ruetenik.pdf · PDF file", "/archives/18.3/Ruetenik.pdf"],
	["/archives/24.2/trinkauskaitė.pdf", "/archives/24.2/trinkauskaite/"],
	["/archives/06.3/kotsko8000.pdf", "/archives/06.3/kotsko.pdf"],
]);

function safeDecodePath(pathname) {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return pathname;
	}
}

function normalizePathname(pathname) {
	return safeDecodePath(pathname)
		.replace(/\u00A0/g, " ")
		.replace(/\/{2,}/g, "/")
		.trim();
}

function buildRedirectURL(requestUrl, target) {
	const out = new URL(target, requestUrl.origin);
	out.search = requestUrl.search;
	return out;
}

function toPathSegment(value) {
	return encodeURIComponent(value).replace(/%2F/gi, "");
}

export default async (request, context) => {
	const method = String(request.method || "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") return context.next();

	const requestUrl = new URL(request.url);
	const pathname = normalizePathname(requestUrl.pathname);
	const archiveMatch = pathname.match(ARCHIVE_ROOT_RE);
	if (!archiveMatch) return context.next();

	const legacyPdfTarget = LEGACY_ARCHIVE_PDF_REDIRECTS.get(pathname);
	if (legacyPdfTarget) {
		return Response.redirect(buildRedirectURL(requestUrl, legacyPdfTarget), 301);
	}

	const issue = archiveMatch[1];
	const tail = archiveMatch[2];

	if (ARCHIVE_INDEX_RE.test(tail)) {
		const canonical = `/archives/${toPathSegment(issue)}/`;
		return Response.redirect(buildRedirectURL(requestUrl, canonical), 301);
	}

	const articleMatch = tail.match(ARCHIVE_ARTICLE_EXT_RE);
	if (articleMatch) {
		const slug = articleMatch[1];
		const canonical = `/archives/${toPathSegment(issue)}/${toPathSegment(slug)}/`;
		return Response.redirect(buildRedirectURL(requestUrl, canonical), 301);
	}

	const pdfMatch = tail.match(ARCHIVE_PDF_RE);
	if (pdfMatch) {
		const slug = pdfMatch[1];
		const canonical = `https://files.jcrt.org/archives/${toPathSegment(issue)}/${toPathSegment(slug)}.pdf`;
		return Response.redirect(buildRedirectURL(requestUrl, canonical), 301);
	}

	return context.next();
};
