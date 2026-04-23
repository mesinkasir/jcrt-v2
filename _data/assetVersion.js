import fs from "node:fs";
import path from "node:path";

const VERSIONED_FILES = ["css/bs.css", "public/css/index.css", "public/css/font.css"];

function getLatestAssetMtime() {
	return VERSIONED_FILES.reduce((latest, relativePath) => {
		try {
			const absolutePath = path.join(process.cwd(), relativePath);
			const stat = fs.statSync(absolutePath);
			return Math.max(latest, Math.trunc(stat.mtimeMs));
		} catch {
			return latest;
		}
	}, 0);
}

export default function () {
	const commitRef =
		String(process.env.COMMIT_REF || "").trim() ||
		String(process.env.CACHED_COMMIT_REF || "").trim();
	if (commitRef) {
		return commitRef.slice(0, 12);
	}

	const latestAssetMtime = getLatestAssetMtime();
	if (latestAssetMtime > 0) {
		return latestAssetMtime.toString(36);
	}

	return String(Date.now()).slice(0, 12);
}
