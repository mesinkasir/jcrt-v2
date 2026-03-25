import { handleOaiRequest, renderStaticListRecordsResponse } from "../../scripts/lib/oai-pmh.mjs";

const PRIMARY_OAI_PATH = "/sitemaps/oai_dc.xml";
const ALIAS_OAI_PATH = "/oai";
const OAI_PATHS = new Set([PRIMARY_OAI_PATH, ALIAS_OAI_PATH]);
const OAI_RECORDS_PATH = "/sitemaps/oai-records.json";

function toPlainParams(searchParams) {
	const out = {};
	for (const [key, value] of searchParams.entries()) {
		if (!(key in out)) out[key] = value;
	}
	return out;
}

async function loadOaiIndex(origin) {
	const indexUrl = new URL(OAI_RECORDS_PATH, origin).toString();
	const response = await fetch(indexUrl, {
		headers: {
			accept: "application/json",
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to load OAI records index (${response.status})`);
	}
	return response.json();
}

export default async (request, context) => {
	const url = new URL(request.url);
	if (!OAI_PATHS.has(url.pathname)) return context.next();
	const isPrimaryPath = url.pathname === PRIMARY_OAI_PATH;

	const method = String(request.method || "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: {
				allow: "GET, HEAD",
			},
		});
	}

	const baseURL = `${url.origin}${url.pathname}`;
	try {
		const index = await loadOaiIndex(url.origin);
		if (!url.searchParams.has("verb")) {
			// Keep the existing static file path behavior for /sitemaps/oai_dc.xml.
			if (isPrimaryPath) return context.next();
			const xml = renderStaticListRecordsResponse({
				baseURL,
				records: index?.records || [],
			});
			const headers = new Headers({
				"content-type": "application/xml; charset=UTF-8",
				"cache-control": "public,max-age=0,must-revalidate",
			});
			if (method === "HEAD") {
				return new Response(null, {
					status: 200,
					headers,
				});
			}
			return new Response(xml, {
				status: 200,
				headers,
			});
		}

		const result = handleOaiRequest({
			baseURL,
			params: toPlainParams(url.searchParams),
			records: index?.records || [],
			identify: {
				repositoryName: index?.repositoryName,
				adminEmails: index?.adminEmails,
				earliestDatestamp: index?.earliestDatestamp,
				deletedRecord: index?.deletedRecord,
				granularity: index?.granularity,
				protocolVersion: index?.protocolVersion,
				compressions: index?.compressions,
			},
		});

		const headers = new Headers(result?.headers || {});
		headers.set("content-type", "application/xml; charset=UTF-8");
		headers.set("cache-control", "public,max-age=0,must-revalidate");

		if (method === "HEAD") {
			return new Response(null, {
				status: result?.status || 200,
				headers,
			});
		}

		return new Response(result?.xml || "", {
			status: result?.status || 200,
			headers,
		});
	} catch (error) {
		const body = `<?xml version="1.0" encoding="UTF-8"?>\n<error>OAI-PMH runtime error: ${String(error?.message || error)}</error>\n`;
		return new Response(body, {
			status: 500,
			headers: {
				"content-type": "application/xml; charset=UTF-8",
				"cache-control": "no-store",
			},
		});
	}
};
