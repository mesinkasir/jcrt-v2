// Ensure `globalThis.File` exists before any dependencies that expect it are evaluated.
// Some transitive deps (e.g. undici) assume a web-like runtime; Node <20 may not provide `File`.
if (typeof globalThis.File === "undefined") {
	globalThis.File = class File {};
}

// Backfill `os.availableParallelism()` for Node runtimes that don't expose it.
// `@11ty/eleventy-img` relies on this API in newer releases.
const osModule = await import("node:os");
if (typeof osModule.availableParallelism !== "function") {
	const cpuCount = () => {
		try {
			const cpus = osModule.cpus?.() || [];
			return Math.max(1, cpus.length || 1);
		} catch {
			return 1;
		}
	};
	try {
		Object.defineProperty(osModule, "availableParallelism", {
			value: cpuCount,
			configurable: true,
			writable: false,
		});
	} catch {
		// If the module namespace is locked, leave runtime fallback behavior in place.
	}
}
