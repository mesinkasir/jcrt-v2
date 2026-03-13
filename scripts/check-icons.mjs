import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const filesToCheck = [
	"_site/index.html",
	"_site/religioustheory/index.html",
	"_site/contact/index.html",
];

const requiredPatterns = [
	/(fa-solid-fa-bars|fas-fa-bars)/,
	/(fa-brands-fa-facebook|fab-fa-facebook)/,
	/(fa-brands-fa-instagram|fab-fa-instagram)/,
	/(fa-solid-fa-rss|fas-fa-rss)/,
];

for (const relativeFile of filesToCheck) {
	const filePath = path.join(root, relativeFile);
	if (!fs.existsSync(filePath)) {
		console.error(`[icons] Missing expected build file: ${relativeFile}`);
		process.exit(1);
	}

	const html = fs.readFileSync(filePath, "utf8");
	if (!html.includes("icon-svg")) {
		console.error(`[icons] No SVG icon output found in ${relativeFile}`);
		process.exit(1);
	}

	for (const pattern of requiredPatterns) {
		if (!pattern.test(html)) {
			console.error(`[icons] Missing icon pattern ${pattern} in ${relativeFile}`);
			process.exit(1);
		}
	}
}

console.log("[icons] OK: required social and menu icons are present in built HTML");
