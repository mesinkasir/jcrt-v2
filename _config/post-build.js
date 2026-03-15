import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(script) {
	return new Promise((resolve, reject) => {
		const child = fork(path.join(__dirname, script), {
			stdio: "inherit",
			env: { ...process.env },
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${script} exited with code ${code}`));
		});
	});
}

async function main() {
	console.log("[post-build] Running pagefind…");
	const start = Date.now();
	await run("run-pagefind.js");
	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`[post-build] Done in ${elapsed}s`);
}

main().catch((err) => {
	console.error("[post-build] Failed:", err);
	process.exit(1);
});
