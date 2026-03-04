import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "_site");

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

function minifyCss(css) {
	return String(css)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\s+/g, " ")
		.replace(/\s*([{}:;,>+~])\s*/g, "$1")
		.replace(/;}/g, "}")
		.trim();
}

const files = walk(root).filter((f) => f.endsWith(".css") && !f.includes(`${path.sep}pagefind${path.sep}`));
let optimized = 0;

for (const file of files) {
	const before = fs.readFileSync(file, "utf8");
	const after = minifyCss(before);
	if (after && after.length < before.length) {
		fs.writeFileSync(file, `${after}\n`, "utf8");
		optimized += 1;
	}
}

console.log(`[Minify] CSS files optimized: ${optimized}/${files.length}`);
