import fs from "node:fs";
import path from "node:path";

function walkMarkdownFiles(dir) {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkMarkdownFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".md")) {
			results.push(fullPath);
		}
	}
	return results;
}

function collectImageRefsFromLine(line) {
	if (!line || !line.includes("/images/")) return [];
	const matches = line.match(/\/images\/[A-Za-z0-9_./%+\-]+/g);
	if (!matches) return [];
	return matches.map((value) => value.replace(/[)\],.;:!?]+$/g, ""));
}

function toPublicPath(rootDir, imageUrl) {
	const normalized = String(imageUrl || "").trim();
	if (!normalized.startsWith("/images/")) return null;
	const decoded = (() => {
		try {
			return decodeURIComponent(normalized);
		} catch {
			return normalized;
		}
	})();
	return path.join(rootDir, "public", decoded.replace(/^\//, ""));
}

export default function validateReligiousTheoryImages({
	rootDir = process.cwd(),
	failOnMissing = false,
} = {}) {
	const postsDir = path.join(rootDir, "content", "religioustheory", "posts");
	const reportPath = path.join(rootDir, ".cache", "religioustheory-missing-images.json");
	const files = walkMarkdownFiles(postsDir);
	const allRefs = [];
	const missingRefs = [];

	for (const filePath of files) {
		const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/");
		const raw = fs.readFileSync(filePath, "utf8");
		const lines = raw.split(/\r?\n/);
		for (let i = 0; i < lines.length; i += 1) {
			const lineNumber = i + 1;
			const refs = collectImageRefsFromLine(lines[i]);
			for (const imageUrl of refs) {
				allRefs.push({ file: relPath, line: lineNumber, url: imageUrl });
				const publicPath = toPublicPath(rootDir, imageUrl);
				if (!publicPath || fs.existsSync(publicPath)) continue;
				missingRefs.push({
					file: relPath,
					line: lineNumber,
					url: imageUrl,
					expectedPath: path.relative(rootDir, publicPath).replace(/\\/g, "/"),
				});
			}
		}
	}

	const dedupeKey = (item) => `${item.file}:${item.line}:${item.url}`;
	const uniqMissingMap = new Map();
	for (const item of missingRefs) {
		const key = dedupeKey(item);
		if (!uniqMissingMap.has(key)) uniqMissingMap.set(key, item);
	}
	const uniqueMissing = [...uniqMissingMap.values()];

	const report = {
		generatedAt: new Date().toISOString(),
		scannedFiles: files.length,
		totalImageRefs: allRefs.length,
		missingCount: uniqueMissing.length,
		missing: uniqueMissing,
	};

	fs.mkdirSync(path.dirname(reportPath), { recursive: true });
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

	const summary = `[ReligiousTheory images] scanned=${report.scannedFiles} refs=${report.totalImageRefs} missing=${report.missingCount}`;
	if (uniqueMissing.length === 0) {
		console.log(`${summary} report=.cache/religioustheory-missing-images.json`);
		return report;
	}

	const sample = uniqueMissing.slice(0, 5).map((item) => `${item.file}:${item.line} -> ${item.url}`);
	console.warn(`${summary} report=.cache/religioustheory-missing-images.json`);
	for (const line of sample) console.warn(`[ReligiousTheory images] missing ${line}`);

	if (failOnMissing) {
		throw new Error(
			`Missing ${uniqueMissing.length} /images references in Religious Theory posts. See .cache/religioustheory-missing-images.json`
		);
	}

	return report;
}
