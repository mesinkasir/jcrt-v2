import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const IMAGE_EXTS = new Set([
	".avif",
	".gif",
	".ico",
	".jpeg",
	".jpg",
	".png",
	".svg",
	".webp",
]);

const PDF_EXTS = new Set([".pdf"]);
const CACHE_PATH = path.join(process.cwd(), ".cache", "assets-index.json");

let serveCache = null;

function normalizeSlashes(p) {
	return p.replace(/\\/g, "/");
}

async function walkFiles(dirAbs) {
	const out = [];
	const entries = await fs.readdir(dirAbs, { withFileTypes: true });
	for (const ent of entries) {
		if (ent.name.startsWith(".")) continue;
		const full = path.join(dirAbs, ent.name);
		if (ent.isDirectory()) {
			out.push(...(await walkFiles(full)));
		} else if (ent.isFile()) {
			out.push(full);
		}
	}
	return out;
}

async function readJsonIfExists(filePath) {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function writeJson(filePath, value) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fingerprintDirectoryTree(dirAbs) {
	try {
		const chunks = [];
		const walk = async (currentDir) => {
			const entries = await fs.readdir(currentDir, { withFileTypes: true });
			entries.sort((a, b) => a.name.localeCompare(b.name));
			for (const entry of entries) {
				if (entry.name.startsWith(".")) continue;
				const full = path.join(currentDir, entry.name);
				const rel = normalizeSlashes(path.relative(dirAbs, full));
				const stat = await fs.stat(full);
				chunks.push(`${entry.isDirectory() ? "d" : "f"}|${rel}|${Math.trunc(stat.mtimeMs)}|${stat.size}`);
				if (entry.isDirectory()) {
					await walk(full);
				}
			}
		};
		await walk(dirAbs);
		return crypto.createHash("sha256").update(chunks.join("\n")).digest("hex");
	} catch {
		return "missing";
	}
}

function toAssetList({ baseDir, urlPrefix }, filesAbs) {
	const baseAbs = path.join(process.cwd(), baseDir);
	return filesAbs
		.map((absPath) => {
			const relInside = path.relative(baseAbs, absPath);
			const relFromRoot = path.join(baseDir, relInside);
			const ext = path.extname(absPath).toLowerCase();
			return {
				ext,
				path: normalizeSlashes(relFromRoot),
				url: normalizeSlashes(path.posix.join(urlPrefix, relInside)),
			};
		})
		.filter((item) => item.url && !item.url.includes("/._"));
}

export default async function () {
	const isServeLike =
		process.env.ELEVENTY_RUN_MODE === "serve" || Boolean(process.env.FAST_BUILD);
	if (isServeLike && serveCache) {
		return serveCache;
	}

	// Images, docs, and citations are served from files.jcrt.org — only scan
	// content/archives for PDFs/sitemaps.
	const roots = [
		{ baseDir: "content/archives", urlPrefix: "/archives/" },
	];
	const fingerprintPieces = await Promise.all(
		roots.map(async (root) => {
			const dirAbs = path.join(process.cwd(), root.baseDir);
			const fp = await fingerprintDirectoryTree(dirAbs);
			return `${root.baseDir}:${fp}`;
		})
	);
	const fingerprint = crypto
		.createHash("sha256")
		.update(fingerprintPieces.join("|"))
		.digest("hex");

	const cached = await readJsonIfExists(CACHE_PATH);
	if (cached?.fingerprint === fingerprint && cached?.result) {
		if (isServeLike) serveCache = cached.result;
		return cached.result;
	}

	let images = [];
	let pdfs = [];

	for (const root of roots) {
		const dirAbs = path.join(process.cwd(), root.baseDir);
		try {
			const filesAbs = await walkFiles(dirAbs);
			const items = toAssetList(root, filesAbs);

			images.push(...items.filter((i) => IMAGE_EXTS.has(i.ext)));
			pdfs.push(...items.filter((i) => PDF_EXTS.has(i.ext)));
		} catch {
			// ignore missing directories
		}
	}

	// Deduplicate by URL (same asset can exist in multiple roots theoretically).
	const dedupeByUrl = (list) => {
		const seen = new Set();
		return list.filter((item) => {
			if (seen.has(item.url)) return false;
			seen.add(item.url);
			return true;
		});
	};

	images = dedupeByUrl(images).sort((a, b) => a.url.localeCompare(b.url));
	pdfs = dedupeByUrl(pdfs).sort((a, b) => a.url.localeCompare(b.url));

	// Citations (RIS/CSL-JSON) are served from files.jcrt.org — return empty arrays.
	const result = { images, pdfs, ris: [], csljson: [] };
	await writeJson(CACHE_PATH, { fingerprint, result });
	if (isServeLike) {
		serveCache = result;
	}
	return result;
}
