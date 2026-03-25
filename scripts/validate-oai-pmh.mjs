import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { handleOaiRequest, OAI_METADATA_PREFIX } from "./lib/oai-pmh.mjs";

const ROOT = process.cwd();
const SITE_DIR = path.join(ROOT, "_site");
const OAI_XML_PATH = path.join(SITE_DIR, "sitemaps", "oai_dc.xml");
const OAI_INDEX_PATH = path.join(SITE_DIR, "sitemaps", "oai-records.json");
const SCHEMA_DIR = path.join(ROOT, "scripts", "schemas", "oai");
const OAI_PMH_SCHEMA = path.join(SCHEMA_DIR, "OAI-PMH.xsd");
const OAI_DC_SCHEMA = path.join(SCHEMA_DIR, "oai_dc.xsd");
const VALIDATE_LEVEL = String(process.env.OAI_VALIDATE_LEVEL || "full").trim().toLowerCase();
const IS_QUICK_VALIDATE = VALIDATE_LEVEL === "quick";

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function mustExist(filePath) {
	assert(fs.existsSync(filePath), `Missing required file: ${filePath}`);
}

function runXmllint(args, label) {
	const result = spawnSync("xmllint", args, {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
		throw new Error(`[oai:validate] xmllint failed for ${label}\n${detail}`);
	}
}

function ensureXmllintAvailable() {
	const result = spawnSync("xmllint", ["--version"], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error("[oai:validate] xmllint is required for XSD validation but was not found in PATH.");
	}
}

function patchOaiDcSchemaLocation(xml) {
	return String(xml).replaceAll(
		"http://www.openarchives.org/OAI/2.0/oai_dc.xsd",
		OAI_DC_SCHEMA,
	);
}

function stripMetadataBlocks(xml) {
	return String(xml).replace(/<metadata>[\s\S]*?<\/metadata>/g, "");
}

function extractOaiDcBlocks(xml) {
	return String(xml).match(/<oai_dc:dc\b[\s\S]*?<\/oai_dc:dc>/g) || [];
}

function writeTempXml(dir, name, xml) {
	const filePath = path.join(dir, name);
	fs.writeFileSync(filePath, patchOaiDcSchemaLocation(xml), "utf8");
	return filePath;
}

function validateAgainstOaiSchema(tempDir, label, xml) {
	const filePath = writeTempXml(tempDir, `${label}.xml`, stripMetadataBlocks(xml));
	runXmllint(["--noout", filePath], `${label} (well-formed)`);
	runXmllint(["--noout", "--schema", OAI_PMH_SCHEMA, filePath], `${label} (schema)`);
}

function validateOaiDcBlocks(tempDir, label, xml) {
	const blocks = extractOaiDcBlocks(xml);
	assert(blocks.length > 0, `No oai_dc:dc blocks found for ${label}`);
	for (let i = 0; i < blocks.length; i += 1) {
		const filePath = writeTempXml(tempDir, `${label}-oai-dc-${i + 1}.xml`, blocks[i]);
		runXmllint(["--noout", filePath], `${label} oai_dc block #${i + 1} (well-formed)`);
		runXmllint(["--noout", "--schema", OAI_DC_SCHEMA, filePath], `${label} oai_dc block #${i + 1} (schema)`);
	}
}

function runProtocolChecks({ baseURL, records, identify }) {
	const firstId = String(records?.[0]?.identifier || "").trim();
	assert(firstId, "No OAI records found in oai-records.json.");

	const cases = [
		{
			name: "Identify",
			params: { verb: "Identify" },
			contains: ["<Identify>", `<baseURL>${baseURL}</baseURL>`],
		},
		{
			name: "ListMetadataFormats",
			params: { verb: "ListMetadataFormats" },
			contains: ["<ListMetadataFormats>", `<metadataPrefix>${OAI_METADATA_PREFIX}</metadataPrefix>`],
		},
		{
			name: "ListSets noSetHierarchy",
			params: { verb: "ListSets" },
			contains: ['<error code="noSetHierarchy">'],
		},
		{
			name: "ListIdentifiers",
			params: { verb: "ListIdentifiers", metadataPrefix: OAI_METADATA_PREFIX },
			contains: ["<ListIdentifiers>", "<header>"],
		},
		{
			name: "ListRecords",
			params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX },
			contains: ["<ListRecords>", "<oai_dc:dc"],
		},
		{
			name: "GetRecord",
			params: { verb: "GetRecord", identifier: firstId, metadataPrefix: OAI_METADATA_PREFIX },
			contains: ["<GetRecord>", firstId],
		},
		{
			name: "Unknown Verb",
			params: { verb: "Nope" },
			contains: ['<error code="badVerb">'],
		},
		{
			name: "Unsupported Metadata Prefix",
			params: { verb: "ListRecords", metadataPrefix: "mods" },
			contains: ['<error code="cannotDisseminateFormat">'],
		},
		{
			name: "Unknown Identifier",
			params: { verb: "GetRecord", identifier: "oai:jcrt.org:missing", metadataPrefix: OAI_METADATA_PREFIX },
			contains: ['<error code="idDoesNotExist">'],
		},
		{
			name: "No Records Match",
			params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX, from: "2100-01-01" },
			contains: ['<error code="noRecordsMatch">'],
		},
	];

	const outputs = [];
	for (const testCase of cases) {
		const result = handleOaiRequest({
			baseURL,
			params: testCase.params,
			records,
			identify,
		});
		for (const expected of testCase.contains) {
			assert(
				String(result.xml || "").includes(expected),
				`Protocol check failed: ${testCase.name} missing '${expected}'`,
			);
		}
		outputs.push({ name: testCase.name, xml: result.xml });
	}
	return outputs;
}

function run() {
	mustExist(OAI_XML_PATH);
	mustExist(OAI_INDEX_PATH);

	const index = JSON.parse(fs.readFileSync(OAI_INDEX_PATH, "utf8"));
	const records = Array.isArray(index.records) ? index.records : [];
	assert(records.length > 0, "oai-records.json is empty.");

	const baseURL = String(index.baseURL || "https://jcrt.org/sitemaps/oai_dc.xml").trim();
	const identify = {
		repositoryName: index.repositoryName,
		adminEmails: index.adminEmails,
		earliestDatestamp: index.earliestDatestamp,
		deletedRecord: index.deletedRecord,
		granularity: index.granularity,
		protocolVersion: index.protocolVersion,
		compressions: index.compressions,
	};

	if (IS_QUICK_VALIDATE) {
		const staticXml = fs.readFileSync(OAI_XML_PATH, "utf8");
		assert(staticXml.includes("<OAI-PMH"), "Static OAI XML is missing OAI-PMH root.");
		assert(staticXml.includes("<ListRecords>"), "Static OAI XML is missing ListRecords.");
		assert(staticXml.includes("<oai_dc:dc"), "Static OAI XML is missing oai_dc metadata.");
		runProtocolChecks({ baseURL, records, identify });
		console.log(`[oai:validate] Quick protocol checks passed (${records.length} record(s)).`);
		return;
	}

	mustExist(OAI_PMH_SCHEMA);
	mustExist(OAI_DC_SCHEMA);
	ensureXmllintAvailable();

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jcrt-oai-validate-"));
	try {
		const staticXml = fs.readFileSync(OAI_XML_PATH, "utf8");
		validateAgainstOaiSchema(tempDir, "static-listrecords", staticXml);
		validateOaiDcBlocks(tempDir, "static-listrecords", staticXml);

		const protocolOutputs = runProtocolChecks({ baseURL, records, identify });
		for (const output of protocolOutputs) {
			const safeName = output.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			validateAgainstOaiSchema(tempDir, `protocol-${safeName}`, output.xml);
			if (output.xml.includes("<oai_dc:dc")) {
				validateOaiDcBlocks(tempDir, `protocol-${safeName}`, output.xml);
			}
		}
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}

	console.log(`[oai:validate] Protocol and XSD checks passed (${records.length} record(s)).`);
}

try {
	run();
} catch (error) {
	console.error(String(error?.message || error));
	process.exitCode = 1;
}
