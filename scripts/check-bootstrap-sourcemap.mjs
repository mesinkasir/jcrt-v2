import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const jsFile = path.join(root, "public", "js", "bs.js");

if (!fs.existsSync(jsFile)) {
	console.error(`[bootstrap-sourcemap] Missing file: ${jsFile}`);
	process.exit(1);
}

const jsContent = fs.readFileSync(jsFile, "utf8");
const match = jsContent.match(/sourceMappingURL=([^\s]+)/);

if (!match) {
	console.error("[bootstrap-sourcemap] Missing sourceMappingURL in public/js/bs.js");
	process.exit(1);
}

const mapFileName = match[1].trim();
const mapFile = path.join(path.dirname(jsFile), mapFileName);

if (!fs.existsSync(mapFile)) {
	console.error(`[bootstrap-sourcemap] Missing sourcemap file referenced by bs.js: ${mapFile}`);
	process.exit(1);
}

const stat = fs.statSync(mapFile);
if (!stat.isFile() || stat.size === 0) {
	console.error(`[bootstrap-sourcemap] Invalid sourcemap file: ${mapFile}`);
	process.exit(1);
}

console.log(`[bootstrap-sourcemap] OK: ${path.relative(root, mapFile)}`);
