const ARCHIVE_PAGE_RE = /^\/archives\/([^/]+)\/(?:index\.(?:html|shtml))?\/?$/i;
const ARCHIVE_INDEX_RE = /^\/archives\/([^/]+)\/index(?:\.(?:html|shtml))?\/?$/i;
const ARCHIVE_PDF_RE = /^\/archives\/([^/]+)\/([^/]+\.pdf)$/i;
const ROOT_INDEX_RE = /^\/index\.(?:html|shtml)$/i;
const JUNK_QUERY_KEYS = new Set(["preview", "_thumbnail_id", "p", "pagewanted"]);
const ARCHIVE_PDF_CANONICAL_TARGETS = new Map([
	["/archives/07.2/marion-taylor-intro.pdf", "https://jcrt.org/archives/07.2/taylor/"],
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
		.replace(/&amp;/gi, "&")
		.replace(/&apos;/gi, "'")
		.replace(/&#39;/g, "'")
		.replace(/\u00A0/g, " ")
		.replace(/\/{2,}/g, "/")
		.trim();
}

function toPathSegment(value) {
	return encodeURIComponent(value).replace(/%2F/gi, "");
}

function gone() {
	return new Response("Gone", {
		status: 410,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"x-robots-tag": "noindex",
		},
	});
}

function redirectClean(requestUrl, target) {
	const out = new URL(target, "https://jcrt.org");
	out.search = "";
	return Response.redirect(out, 301);
}

function hasJunkQuery(searchParams) {
	for (const key of searchParams.keys()) {
		const lowerKey = key.toLowerCase();
		if (lowerKey.startsWith("utm_") || JUNK_QUERY_KEYS.has(lowerKey)) return true;
	}
	return searchParams.get("q") === "{search_term_string}";
}

function articleSlugFromPageParam(searchParams) {
	if (!searchParams.has("page")) return "";
	const rawPage = String(searchParams.get("page") || "").trim();
	if (!rawPage) return "";
	const match = rawPage.match(/^([^/?#]+)\.(?:shtml|html)$/i);
	return match ? match[1] : "";
}

export default async (request, context) => {
	const method = String(request.method || "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") return context.next();

	const requestUrl = new URL(request.url);
	const pathname = normalizePathname(requestUrl.pathname);

	if (pathname === "/weblog" || pathname === "/weblog/" || pathname.startsWith("/weblog/")) {
		return gone();
	}

	if (ROOT_INDEX_RE.test(pathname)) {
		return redirectClean(requestUrl, "/");
	}

	const archivePageMatch = pathname.match(ARCHIVE_PAGE_RE);
	if (archivePageMatch) {
		const slug = articleSlugFromPageParam(requestUrl.searchParams);
		if (slug) {
			return redirectClean(
				requestUrl,
				`/archives/${toPathSegment(archivePageMatch[1])}/${toPathSegment(slug)}/`,
			);
		}
	}

	const archiveIndexMatch = pathname.match(ARCHIVE_INDEX_RE);
	if (archiveIndexMatch) {
		return redirectClean(requestUrl, `/archives/${toPathSegment(archiveIndexMatch[1])}/`);
	}

	const archivePdfMatch = pathname.match(ARCHIVE_PDF_RE);
	if (archivePdfMatch && requestUrl.search) {
		const canonicalTarget = ARCHIVE_PDF_CANONICAL_TARGETS.get(pathname);
		if (canonicalTarget) {
			return redirectClean(requestUrl, canonicalTarget);
		}

		return redirectClean(
			requestUrl,
			`https://files.jcrt.org/archives/${toPathSegment(archivePdfMatch[1])}/${toPathSegment(archivePdfMatch[2])}`,
		);
	}

	if (requestUrl.search && hasJunkQuery(requestUrl.searchParams)) {
		return redirectClean(requestUrl, pathname || "/");
	}

	return context.next();
};
