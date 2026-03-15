import fs from "node:fs";
import path from "node:path";

const src = path.resolve("public/citations");
const dest = path.resolve("_site/citations");

if (fs.existsSync(src)) {
	fs.cpSync(src, dest, { recursive: true });
	const count = fs.readdirSync(dest, { recursive: true }).filter(f => !fs.statSync(path.join(dest, f)).isDirectory()).length;
	console.log(`[copy-citations] Copied ${count} citation files`);
} else {
	console.log("[copy-citations] No citations to copy");
}
