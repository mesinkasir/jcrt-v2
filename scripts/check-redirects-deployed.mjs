const BASE_URL = String(process.env.REDIRECT_CHECK_BASE_URL || "https://jcrt.org").replace(/\/+$/, "");
const MAX_HOPS = Number.parseInt(process.env.REDIRECT_CHECK_MAX_HOPS || "8", 10);

const CASES = [
	{
		name: "archive shtml -> canonical article",
		path: "/archives/03.1/dean.shtml",
		minRedirects: 1,
		firstLocationPath: "/archives/03.1/dean/",
		expectFinalHost: "jcrt.org",
		expectFinalPath: "/archives/03.1/dean/",
		expectFinalStatus: 200,
	},
	{
		name: "archive html -> canonical article",
		path: "/archives/03.1/dean.html",
		minRedirects: 1,
		firstLocationPath: "/archives/03.1/dean/",
		expectFinalHost: "jcrt.org",
		expectFinalPath: "/archives/03.1/dean/",
		expectFinalStatus: 200,
	},
	{
		name: "archive pdf -> files domain",
		path: "/archives/03.1/dean.pdf",
		minRedirects: 1,
		expectFinalHost: "files.jcrt.org",
		expectFinalPath: "/archives/03.1/dean.pdf",
	},
	{
		name: "archive index2 variant",
		path: "/archives/03.1/index2/dean/",
		minRedirects: 1,
		firstLocationPath: "/archives/03.1/dean/",
		expectFinalHost: "jcrt.org",
		expectFinalPath: "/archives/03.1/dean/",
		expectFinalStatus: 200,
	},
	{
		name: "malformed legacy archive pdf typo",
		path: "/archives/18.3/Roberts%20and%20Hayden.pdf",
		minRedirects: 1,
		expectFinalHost: "files.jcrt.org",
		expectFinalPath: "/archives/18.3/robertsandhayden.pdf",
	},
	{
		name: "canonical archive article stays stable",
		path: "/archives/25.1/derrico/",
		expectNoRedirect: true,
		expectFinalHost: "jcrt.org",
		expectFinalPath: "/archives/25.1/derrico/",
		expectFinalStatus: 200,
	},
	{
		name: "placeholder URL must not loop",
		path: "/archives/25.1/:slug/",
		maxRedirects: 1,
	},
	{
		name: "non-archive image alias",
		path: "/img/test.png",
		minRedirects: 1,
		firstLocationPath: "/images/test.png",
	},
	{
		name: "non-archive feed alias",
		path: "/religioustheory/feed",
		minRedirects: 1,
		firstLocationPath: "/feed/religioustheory/feed.xml",
	},
];

function isRedirect(status) {
	return status >= 300 && status < 400;
}

function toStartURL(pathOrUrl) {
	if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
	return new URL(pathOrUrl, `${BASE_URL}/`).toString();
}

async function fetchStep(url) {
	let response = await fetch(url, { method: "HEAD", redirect: "manual" });
	if (response.status === 405) {
		response = await fetch(url, { method: "GET", redirect: "manual" });
	}
	return response;
}

async function traceRedirects(startUrl) {
	const seen = new Set([startUrl]);
	const hops = [];
	let currentUrl = startUrl;

	for (let i = 0; i < MAX_HOPS; i += 1) {
		const response = await fetchStep(currentUrl);
		const location = response.headers.get("location");
		hops.push({
			url: currentUrl,
			status: response.status,
			location,
		});

		if (!(location && isRedirect(response.status))) {
			return {
				hops,
				loop: false,
				finalUrl: currentUrl,
				finalStatus: response.status,
			};
		}

		const nextUrl = new URL(location, currentUrl).toString();
		if (seen.has(nextUrl)) {
			return {
				hops,
				loop: true,
				finalUrl: nextUrl,
				finalStatus: response.status,
			};
		}

		seen.add(nextUrl);
		currentUrl = nextUrl;
	}

	return {
		hops,
		loop: true,
		finalUrl: currentUrl,
		finalStatus: 0,
	};
}

function summarizeHop(hop) {
	if (!hop.location) return `${hop.status} ${hop.url}`;
	return `${hop.status} ${hop.url} -> ${hop.location}`;
}

const failures = [];
let checkedCount = 0;

for (const redirectCase of CASES) {
	const startUrl = toStartURL(redirectCase.path || redirectCase.url);
	const trace = await traceRedirects(startUrl);
	checkedCount += 1;

	const redirectHops = trace.hops.filter((hop) => hop.location && isRedirect(hop.status));
	const finalUrl = new URL(trace.finalUrl);

	if (trace.loop) {
		failures.push(`${redirectCase.name}: redirect loop detected (${trace.hops.map(summarizeHop).join(" | ")})`);
		continue;
	}

	for (const hop of redirectHops) {
		if ((hop.location || "").includes(":slug")) {
			failures.push(`${redirectCase.name}: redirect location leaked literal ':slug' (${hop.location})`);
		}
	}

	if (redirectCase.expectNoRedirect && redirectHops.length !== 0) {
		failures.push(`${redirectCase.name}: expected no redirects, saw ${redirectHops.length}`);
	}

	if (typeof redirectCase.minRedirects === "number" && redirectHops.length < redirectCase.minRedirects) {
		failures.push(
			`${redirectCase.name}: expected at least ${redirectCase.minRedirects} redirects, saw ${redirectHops.length}`
		);
	}

	if (typeof redirectCase.maxRedirects === "number" && redirectHops.length > redirectCase.maxRedirects) {
		failures.push(
			`${redirectCase.name}: expected at most ${redirectCase.maxRedirects} redirects, saw ${redirectHops.length}`
		);
	}

	if (redirectCase.firstLocationPath) {
		const firstRedirect = redirectHops[0];
		if (!firstRedirect) {
			failures.push(`${redirectCase.name}: expected first redirect to ${redirectCase.firstLocationPath}, saw none`);
		} else {
			const firstLocationUrl = new URL(firstRedirect.location, firstRedirect.url);
			if (firstLocationUrl.pathname !== redirectCase.firstLocationPath) {
				failures.push(
					`${redirectCase.name}: expected first redirect path ${redirectCase.firstLocationPath}, got ${firstLocationUrl.pathname}`
				);
			}
		}
	}

	if (redirectCase.expectFinalHost && finalUrl.host !== redirectCase.expectFinalHost) {
		failures.push(`${redirectCase.name}: expected final host ${redirectCase.expectFinalHost}, got ${finalUrl.host}`);
	}

	if (redirectCase.expectFinalPath && finalUrl.pathname !== redirectCase.expectFinalPath) {
		failures.push(`${redirectCase.name}: expected final path ${redirectCase.expectFinalPath}, got ${finalUrl.pathname}`);
	}

	if (typeof redirectCase.expectFinalStatus === "number" && trace.finalStatus !== redirectCase.expectFinalStatus) {
		failures.push(
			`${redirectCase.name}: expected final status ${redirectCase.expectFinalStatus}, got ${trace.finalStatus}`
		);
	}
}

if (failures.length > 0) {
	console.error("Deployed redirect verification failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log(`Verified ${checkedCount} deployed redirect scenarios against ${BASE_URL} (max hops: ${MAX_HOPS}).`);
