import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import archiveLegacyRedirects from "../netlify/edge-functions/archive-legacy-redirects.js";

const require = createRequire(import.meta.url);
const redirector = require("netlify-redirector");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const redirectsPath = path.join(repoRoot, "public", "_redirects");
const netlifyTomlPath = path.join(repoRoot, "netlify.toml");

function loadRedirectsText() {
	return fs.readFileSync(redirectsPath, "utf8");
}

function loadRuleLines(redirectsText) {
	return redirectsText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !line.startsWith("#"));
}

function parseRule(line) {
	const [from, to, status = ""] = line.split(/\s+/);
	return { from, to, status };
}

function findRuleIndex(ruleLines, from, to) {
	return ruleLines.findIndex((line) => {
		const rule = parseRule(line);
		return rule.from === from && rule.to === to;
	});
}

function assertPresent(failures, ruleLines, from, to) {
	if (findRuleIndex(ruleLines, from, to) === -1) {
		failures.push(`missing _redirects rule: ${from} -> ${to}`);
	}
}

function assertAbsent(failures, ruleLines, from, to) {
	if (findRuleIndex(ruleLines, from, to) !== -1) {
		failures.push(`stale _redirects rule still present: ${from} -> ${to}`);
	}
}

function assertOrderedBefore(failures, ruleLines, left, right) {
	const leftIndex = findRuleIndex(ruleLines, left[0], left[1]);
	const rightIndex = findRuleIndex(ruleLines, right[0], right[1]);
	if (leftIndex === -1 || rightIndex === -1) return;
	if (leftIndex >= rightIndex) {
		failures.push(
			`rule order incorrect: ${left[0]} -> ${left[1]} must appear before ${right[0]} -> ${right[1]}`
		);
	}
}

function assertNoArchivePlaceholderSuffixes(failures, ruleLines) {
	for (const line of ruleLines) {
		const rule = parseRule(line);
		if (!rule.from.startsWith("/archives/")) continue;

		const segments = rule.from.split("/").filter(Boolean);
		for (const segment of segments) {
			if (!segment.startsWith(":")) continue;
			if (/^:[A-Za-z0-9_]+$/.test(segment)) continue;
			failures.push(`invalid archive placeholder segment in _redirects "from": ${rule.from}`);
		}
	}
}

function toMatcherRequest(url) {
	let decodedPath = url.pathname;
	try {
		decodedPath = decodeURIComponent(url.pathname);
	} catch {
		decodedPath = url.pathname;
	}

	return {
		scheme: url.protocol.replace(/:$/, ""),
		host: url.hostname,
		path: decodedPath,
		query: url.search.slice(1),
		headers: {},
		cookieValues: {},
		getHeader: () => "",
		getCookie: () => "",
	};
}

function toRedirectTarget(rule, url) {
	const target = new URL(rule.to, `${url.origin}/`);
	if (target.search === "" && url.search !== "") target.search = url.search;
	return target.toString();
}

function buildRedirectsResponse(url, matcher) {
	const rule = matcher.match(toMatcherRequest(url));
	if (!rule) return new Response("Not found", { status: 404 });

	const status = Number(rule.status || 200);
	if (status >= 300 && status < 400) {
		return new Response(null, {
			status,
			headers: {
				location: toRedirectTarget(rule, url),
			},
		});
	}

	if (status === 200) {
		return new Response("Rewrite match", {
			status: 200,
			headers: {
				"x-rewrite-target": toRedirectTarget(rule, url),
			},
		});
	}

	return new Response("Rule match", { status });
}

async function simulateNetlifyRequest(matcher, pathAndQuery) {
	const url = new URL(pathAndQuery, "https://jcrt.org");
	const request = new Request(url.toString(), { method: "GET" });
	const response = await archiveLegacyRedirects(request, {
		next: async () => buildRedirectsResponse(url, matcher),
	});

	return {
		status: response.status,
		location: response.headers.get("location"),
		rewriteTarget: response.headers.get("x-rewrite-target"),
	};
}

function assertRedirectPath(failures, result, expectedPath, label) {
	if (!(result.status >= 300 && result.status < 400)) {
		failures.push(`${label}: expected redirect status, got ${result.status}`);
		return;
	}
	if (!result.location) {
		failures.push(`${label}: expected redirect location header`);
		return;
	}
	const locationUrl = new URL(result.location, "https://jcrt.org");
	if (locationUrl.pathname !== expectedPath) {
		failures.push(`${label}: expected redirect path ${expectedPath}, got ${locationUrl.pathname}`);
	}
	if (locationUrl.pathname.includes(":slug") || locationUrl.toString().includes(":slug")) {
		failures.push(`${label}: redirect leaked literal placeholder in location (${result.location})`);
	}
}

function assertRedirectHostPath(failures, result, expectedHost, expectedPath, label) {
	if (!(result.status >= 300 && result.status < 400)) {
		failures.push(`${label}: expected redirect status, got ${result.status}`);
		return;
	}
	if (!result.location) {
		failures.push(`${label}: expected redirect location header`);
		return;
	}
	const locationUrl = new URL(result.location, "https://jcrt.org");
	if (locationUrl.host !== expectedHost || locationUrl.pathname !== expectedPath) {
		failures.push(
			`${label}: expected redirect ${expectedHost}${expectedPath}, got ${locationUrl.host}${locationUrl.pathname}`
		);
	}
	if (locationUrl.pathname.includes(":slug") || locationUrl.toString().includes(":slug")) {
		failures.push(`${label}: redirect leaked literal placeholder in location (${result.location})`);
	}
}

const redirectsText = loadRedirectsText();
const ruleLines = loadRuleLines(redirectsText);
const failures = [];

const archiveExceptions = [
	["/archives/01.2/vahanian", "/archives/01.2/nvahanian/"],
	["/archives/01.2/vahanian/", "/archives/01.2/nvahanian/"],
	["/archives/01.2/wyschograd_raschke.shtml", "/archives/01.2/wyschogrod_raschke/"],
	["/archives/02.1/reinhard.shtml", "/archives/02.1/reinhard_lupton/"],
	["/archives/02.1/intro_reinhard_lupton.shtml", "/archives/02.1/lupton/"],
	["/archives/03.1/taylor.shtml", "/archives/03.1/"],
	["/archives/04.1/manolopoulos.shtml", "/archives/04.1/markmanolopoulos/"],
	["/archives/04.2/%20pecora.shtml", "/archives/04.2/pecora/"],
	["/archives/07.1/zizek-taylor.shtml", "/archives/07.1/taylor/"],
	["/archives/07.2/mdex.shtml", "/archives/07.2/"],
];

const archiveIndexRules = [
	["/archives/:issue/index2/:slug/", "/archives/:issue/:slug/"],
	["/archives/:issue/index.shtml", "/archives/:issue/"],
	["/archives/:issue/index.html", "/archives/:issue/"],
	["/archives/:issue/index", "/archives/:issue/"],
];

const removedArchiveRules = [
	["/archives/:issue/:slug.shtml", "/archives/:issue/:slug/"],
	["/archives/:issue/:slug.html", "/archives/:issue/:slug/"],
	["/archives/:issue/:slug.pdf", "https://files.jcrt.org/archives/:issue/:slug.pdf"],
];

const archiveRewriteRule = ["/archives/:issue/:slug/", "/archives/:issue/:slug/index.html"];

const nonArchiveRules = [
	["/religioustheory/abstracts/:file", "https://files.jcrt.org/docs/:file"],
	["/authors/carl-raschke%20copy/", "/authors/carl-raschke/"],
];

const malformedPdfRules = [
	["/archives/18.3/Roberts%20and%20Hayden.pdf", "/archives/18.3/robertsandhayden.pdf"],
	["/archives/17.2/Hagedorn%20and%20Staudigl.pdf", "/archives/17.2/Hagedorn-and-Staudigl.pdf"],
	["/archives/05%20.3/flato.pdf", "/archives/05.3/flato.pdf"],
	["/archives/13.1/lugones.pdf-", "/archives/13.1/lugones.pdf"],
	["/archives/17.2/Leclerq.pdf", "/archives/17.2/leclercq.pdf"],
	["/archives/17.3/Datan.pdf", "/archives/17.3/Datar.pdf"],
];

for (const rule of [...archiveExceptions, ...archiveIndexRules, archiveRewriteRule, ...nonArchiveRules, ...malformedPdfRules]) {
	assertPresent(failures, ruleLines, rule[0], rule[1]);
}

for (const rule of removedArchiveRules) {
	assertAbsent(failures, ruleLines, rule[0], rule[1]);
}

for (const exceptionRule of archiveExceptions) {
	assertOrderedBefore(failures, ruleLines, exceptionRule, archiveRewriteRule);
}

assertNoArchivePlaceholderSuffixes(failures, ruleLines);

assertAbsent(failures, ruleLines, "/archives/15.2/valente2", "/archives/15.2/valente/");

const netlifyToml = fs.readFileSync(netlifyTomlPath, "utf8");
if (netlifyToml.includes('function = "legacy-redirects"')) {
	failures.push('netlify.toml still references "legacy-redirects"');
}
if (!netlifyToml.includes('function = "archive-legacy-redirects"')) {
	failures.push('netlify.toml is missing edge function "archive-legacy-redirects"');
}

for (const deletedPath of [
	path.join(repoRoot, "netlify", "edge-functions", "legacy-redirects.js"),
	path.join(repoRoot, "netlify", "edge-functions", "archive-route-manifest.js"),
]) {
	if (fs.existsSync(deletedPath)) {
		failures.push(`deleted file still exists: ${path.relative(repoRoot, deletedPath)}`);
	}
}

const matcher = await redirector.parsePlain(redirectsText, {});

const deanShtml = await simulateNetlifyRequest(matcher, "/archives/03.1/dean.shtml");
assertRedirectPath(failures, deanShtml, "/archives/03.1/dean/", "runtime /archives/03.1/dean.shtml");

const deanHtml = await simulateNetlifyRequest(matcher, "/archives/03.1/dean.html");
assertRedirectPath(failures, deanHtml, "/archives/03.1/dean/", "runtime /archives/03.1/dean.html");

const deanPdf = await simulateNetlifyRequest(matcher, "/archives/03.1/dean.pdf");
assertRedirectHostPath(
	failures,
	deanPdf,
	"files.jcrt.org",
	"/archives/03.1/dean.pdf",
	"runtime /archives/03.1/dean.pdf"
);

const index2Dean = await simulateNetlifyRequest(matcher, "/archives/03.1/index2/dean/");
assertRedirectPath(failures, index2Dean, "/archives/03.1/dean/", "runtime /archives/03.1/index2/dean/");

const missingArticle = await simulateNetlifyRequest(matcher, "/archives/03.1/does-not-exist/");
if (missingArticle.status >= 300 && missingArticle.status < 400) {
	failures.push(
		`runtime /archives/03.1/does-not-exist/: unexpected redirect ${missingArticle.status} -> ${
			missingArticle.location || "<none>"
		}`
	);
}
if ((missingArticle.location || "").includes(":slug")) {
	failures.push(
		`runtime /archives/03.1/does-not-exist/: literal placeholder leaked (${missingArticle.location})`
	);
}

if (failures.length > 0) {
	console.error("Redirect validation failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log(
	`Validated ${archiveExceptions.length} archive exceptions, ${archiveIndexRules.length} archive index rules, runtime matcher behavior, and archive edge redirects.`
);
