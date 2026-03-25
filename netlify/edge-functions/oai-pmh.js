import { handleOaiRequest } from "../../scripts/lib/oai-pmh.mjs";

const OAI_PATH = "/sitemaps/oai_dc.xml";
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
	if (url.pathname !== OAI_PATH) return context.next();

	const method = String(request.method || "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: {
				allow: "GET, HEAD",
			},
		});
	}

	// Preserve existing static feed behavior unless a verb query is provided.
	if (!url.searchParams.has("verb")) return context.next();

	const baseURL = `${url.origin}${OAI_PATH}`;
	try {
		const index = await loadOaiIndex(url.origin);
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
