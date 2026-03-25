import fs from "node:fs";
import { spawnSync } from "node:child_process";

const CONTEXT = String(process.env.CONTEXT || "").trim().toLowerCase();
const BRANCH = String(process.env.BRANCH || process.env.HEAD || "").trim();
const IS_PRODUCTION_CONTEXT = CONTEXT === "production" || BRANCH === "main" || BRANCH === "master";
const FORCE_FULL_BUILD = String(process.env.FORCE_FULL_NETLIFY_BUILD || "").trim() === "1";
const FORCE_FAST_BUILD = String(process.env.FORCE_FAST_NETLIFY_BUILD || "").trim() === "1";

function runCommand(command, args, env = process.env) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		env,
	});
	if (result.status !== 0) {
		process.exit(result.status || 1);
	}
}

function runNpmScript(scriptName, envOverrides = {}) {
	const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
	runCommand(npmCmd, ["run", scriptName], {
		...process.env,
		...envOverrides,
	});
}

function runGit(args) {
	const result = spawnSync("git", args, {
		encoding: "utf8",
	});
	if (result.status !== 0) return null;
	return String(result.stdout || "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function changedMarkdownFiles() {
	const commitRef = String(process.env.COMMIT_REF || "").trim();
	const cachedCommitRef = String(process.env.CACHED_COMMIT_REF || "").trim();

	if (commitRef && cachedCommitRef && commitRef !== cachedCommitRef) {
		const files = runGit(["diff", "--name-only", `${cachedCommitRef}...${commitRef}`, "--", "*.md"]);
		if (files) return files;
	}

	const previousCommitFiles = runGit(["show", "--pretty=", "--name-only", "HEAD", "--", "*.md"]);
	if (previousCommitFiles) return previousCommitFiles;

	return null;
}

function runFullBuild() {
	console.log("[build:netlify] Mode: full");
	runNpmScript("build:netlify:full");
}

function runFastBuild() {
	console.log("[build:netlify] Mode: fast");
	runNpmScript("build:netlify:fast");
}

function main() {
	fs.mkdirSync(".cache", { recursive: true });

	const mdFiles = changedMarkdownFiles();
	const canDetectMdChanges = Array.isArray(mdFiles);
	const hasMdChanges = canDetectMdChanges ? mdFiles.length > 0 : IS_PRODUCTION_CONTEXT;

	console.log(`[build:netlify] Context: ${CONTEXT || "unknown"} (branch: ${BRANCH || "unknown"})`);
	if (canDetectMdChanges) {
		console.log(`[build:netlify] Changed .md files: ${mdFiles.length}`);
		if (mdFiles.length > 0) {
			const preview = mdFiles.slice(0, 10);
			for (const file of preview) console.log(`[build:netlify] md: ${file}`);
			if (mdFiles.length > preview.length) {
				console.log(`[build:netlify] md: ...and ${mdFiles.length - preview.length} more`);
			}
		}
	} else {
		console.log("[build:netlify] Unable to detect changed .md files; defaulting to safe mode.");
	}

	const shouldRunFull = IS_PRODUCTION_CONTEXT && hasMdChanges;
	if (FORCE_FULL_BUILD && FORCE_FAST_BUILD) {
		console.error("[build:netlify] FORCE_FULL_NETLIFY_BUILD and FORCE_FAST_NETLIFY_BUILD cannot both be 1.");
		process.exit(1);
	}
	if (FORCE_FULL_BUILD) {
		console.log("[build:netlify] FORCE_FULL_NETLIFY_BUILD=1, running full production checks.");
		runFullBuild();
		return;
	}
	if (FORCE_FAST_BUILD) {
		console.log("[build:netlify] FORCE_FAST_NETLIFY_BUILD=1, running fast checks.");
		runFastBuild();
		return;
	}
	if (shouldRunFull) {
		console.log("[build:netlify] Running full production checks (markdown changed).");
		runFullBuild();
		return;
	}

	console.log("[build:netlify] Running fast checks (no markdown changes or non-production context).");
	runFastBuild();
}

main();
