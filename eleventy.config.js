import "./_config/polyfills.js";

import { feedPlugin } from "@11ty/eleventy-plugin-rss";
import pluginSyntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import pluginNavigation from "@11ty/eleventy-navigation";
import yaml from "js-yaml";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import markdownItFootnote from "markdown-it-footnote";
import markdownItAttrs from "markdown-it-attrs";
import markdownItTableOfContents from "markdown-it-table-of-contents";
import pluginTOC from "eleventy-plugin-toc";
import pluginFilters from "./_config/filters.js";
import { authorSlug, splitAuthors } from "./_config/authorSlug.js";
import generateArchiveCitations from "./_config/generate-archive-citations.js";
import generateReligiousTheoryCitations from "./_config/generate-religioustheory-citations.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { DateTime } from "luxon";

const imageDimensionCache = new Map();
const resolveImagePathCache = new Map();
const metadataYamlPath = path.join(process.cwd(), "_data", "metadata.yaml");
const cacheDirPath = path.join(process.cwd(), ".cache");
const citationSignaturePath = path.join(cacheDirPath, "citations-input-signatures.json");
const TIME_ZONE = "America/New_York";

function getSiteUrlFromMetadata() {
	const raw = fs.readFileSync(metadataYamlPath, "utf8");
	const parsed = yaml.load(raw);
	const url = String(parsed?.url || "").trim();
	if (!url) {
		throw new Error("Missing `url` in _data/metadata.yaml");
	}
	return url;
}

function readJpegSize(buffer) {
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 9 < buffer.length) {
		if (buffer[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		const marker = buffer[offset + 1];
		offset += 2;
		if (marker === 0xd8 || marker === 0xd9) continue;
		if (offset + 1 >= buffer.length) break;
		const segmentLength = buffer.readUInt16BE(offset);
		if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
		const isSof =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf);
		if (isSof && offset + 7 < buffer.length) {
			const height = buffer.readUInt16BE(offset + 3);
			const width = buffer.readUInt16BE(offset + 5);
			if (width > 0 && height > 0) return { width, height };
		}
		offset += segmentLength;
	}
	return null;
}

function readSvgSize(filePath) {
	const raw = fs.readFileSync(filePath, "utf8");
	const widthMatch = raw.match(/\bwidth=["']?([0-9.]+)(px)?["']?/i);
	const heightMatch = raw.match(/\bheight=["']?([0-9.]+)(px)?["']?/i);
	if (widthMatch && heightMatch) {
		const width = Math.round(Number.parseFloat(widthMatch[1]));
		const height = Math.round(Number.parseFloat(heightMatch[1]));
		if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
			return { width, height };
		}
	}
	const viewBoxMatch = raw.match(/\bviewBox=["']\s*([0-9.+-]+)[,\s]+([0-9.+-]+)[,\s]+([0-9.+-]+)[,\s]+([0-9.+-]+)\s*["']/i);
	if (viewBoxMatch) {
		const width = Math.round(Number.parseFloat(viewBoxMatch[3]));
		const height = Math.round(Number.parseFloat(viewBoxMatch[4]));
		if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
			return { width, height };
		}
	}
	return null;
}

function getImageDimensionsFromPath(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".svg") return readSvgSize(filePath);

	const buffer = fs.readFileSync(filePath);
	if (ext === ".png" && buffer.length > 24) {
		const width = buffer.readUInt32BE(16);
		const height = buffer.readUInt32BE(20);
		if (width > 0 && height > 0) return { width, height };
	}
	if (ext === ".gif" && buffer.length > 10) {
		const width = buffer.readUInt16LE(6);
		const height = buffer.readUInt16LE(8);
		if (width > 0 && height > 0) return { width, height };
	}
	if (ext === ".jpg" || ext === ".jpeg") {
		return readJpegSize(buffer);
	}
	return null;
}

function resolveImagePath(src) {
	if (!src || typeof src !== "string") return null;
	const normalized = src.split("?")[0].split("#")[0].trim();
	if (resolveImagePathCache.has(normalized)) {
		return resolveImagePathCache.get(normalized);
	}
	if (!normalized || /^https?:\/\//i.test(normalized) || normalized.startsWith("data:")) return null;
	const withoutLeadingSlash = normalized.startsWith("/") ? normalized.slice(1) : normalized;
	const publicPath = path.join(process.cwd(), "public", withoutLeadingSlash);
	if (fs.existsSync(publicPath)) {
		resolveImagePathCache.set(normalized, publicPath);
		return publicPath;
	}
	const rootPath = path.join(process.cwd(), withoutLeadingSlash);
	if (fs.existsSync(rootPath)) {
		resolveImagePathCache.set(normalized, rootPath);
		return rootPath;
	}
	resolveImagePathCache.set(normalized, null);
	return null;
}

function createMemoizedRenderer(renderFn, maxEntries = 2000) {
	const cache = new Map();
	return (input) => {
		const key = String(input || "");
		if (cache.has(key)) return cache.get(key);
		const rendered = renderFn(key);
		cache.set(key, rendered);
		if (cache.size > maxEntries) cache.clear();
		return rendered;
	};
}

function loadJson(filePath, fallback = {}) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return fallback;
	}
}

function saveJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashForFiles(rootDir, extensions = [".md"]) {
	if (!fs.existsSync(rootDir)) return "missing";
	const exts = new Set(extensions.map((ext) => String(ext).toLowerCase()));
	const files = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;
			const ext = path.extname(entry.name).toLowerCase();
			if (!exts.has(ext)) continue;
			const stat = fs.statSync(fullPath);
			const rel = path.relative(rootDir, fullPath).replace(/\\/g, "/");
			files.push(`${rel}|${stat.size}|${Math.trunc(stat.mtimeMs)}`);
		}
	};
	walk(rootDir);
	files.sort((a, b) => a.localeCompare(b));
	return crypto.createHash("sha256").update(files.join("\n")).digest("hex");
}

function archiveIssueSortKey(inputPath, url) {
	// Prefer the directory segment under `content/archives/`.
	// Examples:
	// - content/archives/08.3/index.njk  => major=8, minor=3
	// - content/archives/15/index.njk    => major=15, minor=0
	const raw =
		typeof inputPath === "string" && inputPath.includes("content/archives/")
			? inputPath.split("content/archives/")[1]?.split("/")[0]
			: null;
	const issue = (raw || "").trim().replace(/[^0-9.]/g, "");
	if (!issue) return { major: 0, minor: 0, issue: "", url: url || "" };
	const parts = issue.split(".");
	const major = Number.parseInt(parts[0] || "0", 10) || 0;
	const minor = Number.parseInt(parts[1] || "0", 10) || 0;
	return { major, minor, issue, url: url || "" };
}

async function ensureFavicons() {
	// `@11ty/eleventy-img` requires Node versions that implement `os.availableParallelism()`.
	// If you run the build on an older Node (e.g. v18.12.x), skip generation.
	if (typeof os.availableParallelism !== "function") return;

	const sourceSvg = path.join(process.cwd(), "public/img/logos/JCRT.svg");
	const outputDir = path.join(process.cwd(), "public/img/logos");

	const sizesToName = new Map([
		[16, "favicon-16x16"],
		[32, "favicon-32x32"],
		[48, "favicon-48x48"],
		[96, "favicon-96x96"],
		[180, "apple-touch-icon"],
		[192, "android-chrome-192x192"],
		[512, "android-chrome-512x512"],
	]);

	try {
		const srcStat = fs.statSync(sourceSvg);
		const outputs = [...sizesToName.values()].map((base) =>
			path.join(outputDir, `${base}.png`)
		);
		const allFresh = outputs.every((p) => {
			try {
				return fs.statSync(p).mtimeMs >= srcStat.mtimeMs;
			} catch {
				return false;
			}
		});
		if (allFresh) return;
	} catch {
		// If the source icon doesn't exist, do nothing.
		return;
	}

	const { default: Image } = await import("@11ty/eleventy-img");
	await Image(sourceSvg, {
		widths: [...sizesToName.keys()],
		formats: ["png"],
		outputDir,
		urlPath: "/img/logos",
		filenameFormat: function (_id, _src, width, format) {
			const base = sizesToName.get(width) || `favicon-${width}x${width}`;
			return `${base}.${format}`;
		},
	});
}

function isPublishedItem(data = {}, runMode = process.env.ELEVENTY_RUN_MODE) {
	// Explicit publish flag has highest priority.
	if (data.published === false) return false;
	if (data.published === true) return true;
	// Keep existing draft behavior for build mode.
	if (data.draft === true && runMode === "build") return false;
	return true;
}

/** @param {import("@11ty/eleventy").UserConfig} eleventyConfig */
export default async function (eleventyConfig) {
	eleventyConfig.addDateParsing(function (dateValue) {
		let localDate;
		if (dateValue instanceof Date) {
			localDate = DateTime.fromJSDate(dateValue, { zone: "utc" }).setZone(TIME_ZONE, { keepLocalTime: true });
		} else if (typeof dateValue === "string") {
			const trimmedDate = dateValue.trim();
			const isIsoLike = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(trimmedDate);
			if (!isIsoLike) return undefined;
			localDate = DateTime.fromISO(trimmedDate, { zone: TIME_ZONE });
		}
		if (localDate?.isValid === false) {
			throw new Error(
				`Invalid \`date\` value (${dateValue}) is invalid for ${this.page.inputPath}: ${localDate.invalidReason}`
			);
		}
		return localDate;
	});

	eleventyConfig.addPlugin(pluginFilters);
	const isFastBuild = Boolean(process.env.FAST_BUILD);
	const isLeanBuild = Boolean(process.env.LEAN_BUILD);
	const isBuildMode = process.env.ELEVENTY_RUN_MODE === "build";
	const isBenchMode = process.env.BENCH_11TY === "1";
	const benchIssue = String(process.env.BENCH_ISSUE || "24.2").trim();
	const siteBaseUrl = getSiteUrlFromMetadata();
	eleventyConfig.addGlobalData("isFastBuild", isFastBuild);
	eleventyConfig.addGlobalData("isLeanBuild", isLeanBuild);
	eleventyConfig.addGlobalData("isBenchMode", isBenchMode);
	eleventyConfig.addGlobalData("benchIssue", benchIssue);

	if (isBenchMode) {
		const archivesRoot = path.join(process.cwd(), "content", "archives");
		try {
			const issueDirs = fs
				.readdirSync(archivesRoot, { withFileTypes: true })
				.filter((d) => d.isDirectory())
				.map((d) => d.name);
			for (const issue of issueDirs) {
				if (issue !== benchIssue) {
					eleventyConfig.ignores.add(`archives/${issue}/**`);
				}
			}
		} catch {
			// Ignore if archives root is not readable.
		}
		eleventyConfig.ignores.add("blog/**");
		eleventyConfig.ignores.add("religioustheory/**");
		eleventyConfig.ignores.add("feed/**");
	}
	if (isBuildMode) {
		eleventyConfig.addTransform("minifyHtmlOutput", function (content, outputPath) {
			if (!outputPath || !outputPath.endsWith(".html")) return content;
			return String(content)
				.replace(/<!--(?!\[if).*?-->/gs, "")
				.replace(/>\s+</g, "><")
				.trim();
		});
	}

	eleventyConfig.on("eleventy.before", async () => {
		const runMode = process.env.ELEVENTY_RUN_MODE;
		// In serve mode, skip heavyweight pre-build generation to prevent
		// repeated high-memory rebuild cycles.
		if (runMode !== "serve" && !isBenchMode) {
			const nextSignatures = {
				baseUrl: siteBaseUrl,
				archives: hashForFiles(path.join(process.cwd(), "content", "archives"), [".md"]),
				religioustheory: hashForFiles(path.join(process.cwd(), "content", "religioustheory", "posts"), [".md"]),
			};
			const prevSignatures = loadJson(citationSignaturePath, {});
			const citationsChanged =
				prevSignatures.baseUrl !== nextSignatures.baseUrl ||
				prevSignatures.archives !== nextSignatures.archives ||
				prevSignatures.religioustheory !== nextSignatures.religioustheory;

			if (citationsChanged) {
				await generateArchiveCitations(siteBaseUrl);
				await generateReligiousTheoryCitations(siteBaseUrl);
				saveJson(citationSignaturePath, nextSignatures);
			} else {
				console.log(
					"[Citations] Skipped generation: no content changes detected in /archives or /religioustheory/posts"
				);
			}
			await ensureFavicons();
		}
	});

	// Removed manual authors.json loading. Eleventy will auto-load _data/authors.yaml and _data/authors.json as global data.
	eleventyConfig.addPreprocessor("drafts", "*", (data) => {
		if (!isPublishedItem(data)) return false;
	});
	if (isBenchMode) {
		eleventyConfig.addPreprocessor("bench-scope", "*", (data) => {
			const inputPath = String(data?.page?.inputPath || "").replaceAll("\\", "/");
			const marker = "/content/";
			const idx = inputPath.indexOf(marker);
			const rel = idx >= 0 ? inputPath.slice(idx + marker.length) : "";
			if (!rel) return;

			if (rel.startsWith("blog/")) return false;
			if (rel.startsWith("religioustheory/")) return false;
			if (rel.startsWith("authors/")) return false;
			if (rel.startsWith("feed/")) return false;

			if (rel.startsWith("archives/")) {
				const keepExact = new Set([
					"archives/index.njk",
					"archives/keywords/index.njk",
					"archives/keywords/tag-pages.njk",
				]);
				if (keepExact.has(rel)) return;
				if (rel.startsWith(`archives/${benchIssue}/`)) return;
				return false;
			}
		});
	}
	if (isLeanBuild) {
		const leanSkippedInputs = new Set([
			"religioustheory/legacy-date-redirects.11ty.js",
		]);
		eleventyConfig.addPreprocessor("lean-build-scope", "*", (data) => {
			const inputPath = String(data?.page?.inputPath || "").replaceAll("\\", "/");
			const marker = "/content/";
			const idx = inputPath.indexOf(marker);
			const rel = idx >= 0 ? inputPath.slice(idx + marker.length) : "";
			if (leanSkippedInputs.has(rel)) return false;
		});
	}
	
	// dev mode
	if (process.env.QUICK_DEV) {
		eleventyConfig.addPreprocessor("collections", "limit-dev", (collections) => {
			const folders = ["archives", "blog", "religioustheory"];
			folders.forEach((name) => {
				if (collections[name]) collections[name] = collections[name].slice(0, 5);
			});

			if (collections.all) {
				Object.keys(collections).forEach((tagName) => {
					if (Array.isArray(collections[tagName])) {
						collections[tagName] = collections[tagName].slice(0, 5);
					}
				});
			}
		});
		console.log("🚀 QUICK_DEV MODE: Active (Everything limited to 5)");
		console.log("🔗 Open: http://localhost:4000");
	}

	// Pagefind runs once in `npm run build` (after `_site` is built).
	// Keep passthrough mappings non-overlapping to avoid copy/watch race conditions.
	eleventyConfig.addDataExtension("yaml", (contents) => yaml.load(contents));
	eleventyConfig
		.addPassthroughCopy({ "public/css": "css" })
		.addPassthroughCopy({ "public/js": "js" })
		.addPassthroughCopy({ "public/img": "img" })
		.addPassthroughCopy({ "public/admin": "admin" })
		.addPassthroughCopy({ "public/docs": "docs" })
		.addPassthroughCopy({ "public/_redirects": "_redirects" })
		.addPassthroughCopy({ "css/bs.css": "css/bs.css" })
		.addPassthroughCopy("./content/feed/pretty-atom-feed.xsl");
	if (!isBenchMode) {
		eleventyConfig.addPassthroughCopy({ "public/citations": "citations" });
	}

	eleventyConfig.addWatchTarget("css/**/*.css");
	eleventyConfig.addWatchTarget("content/**/*.{svg,webp,png,jpg,jpeg,gif}");

	if (!isFastBuild) {
		eleventyConfig.addBundle("css", {
			toFileDirectory: "dist",
			bundleHtmlContentFromSelector: "style",
		});
		eleventyConfig.addBundle("js", {
			toFileDirectory: "dist",
			bundleHtmlContentFromSelector: 'script[type="module"]',
		});
	} else {
		// Templates reference `{% getBundle "css" %}` / `{% getBundle "js" %}`.
		// In fast builds we skip bundling entirely for speed, so provide a no-op.
		eleventyConfig.addShortcode("getBundle", () => "");
	}

	eleventyConfig.addPlugin(pluginSyntaxHighlight, {
		preAttributes: { tabindex: 0 },
	});
	eleventyConfig.addPlugin(pluginNavigation);
	// HTML transforms are expensive; CI sets `FAST_BUILD=1` to skip these.
	// NOTE: HtmlBasePlugin and InputPathToUrlTransformPlugin are Eleventy 3.x features
	// if (!isFastBuild) {
	// 	eleventyConfig.addPlugin(HtmlBasePlugin);
	// 	eleventyConfig.addPlugin(InputPathToUrlTransformPlugin);
	// }
	const md = new markdownIt({
		html: true,
		breaks: true,
		linkify: true,
	});

	let options = {
		html: true,
		breaks: true,
		linkify: true,
		permalink: true,
		typographer: true,
		permalinkClass: "direct-link",
		permalinkSymbol: "#",
	};

	let markdownLib = markdownIt(options)
		.use(markdownItAttrs)
		.use(markdownItFootnote)
		.use(markdownItTableOfContents);
	eleventyConfig.setLibrary("md", markdownLib);
	eleventyConfig.amendLibrary("md", (mdLib) => {
		const slugifyFilter = eleventyConfig.getFilter("slugify");
		const slugifyCache = new Map();
		const cachedSlugify = (text) => {
			const key = String(text || "");
			if (slugifyCache.has(key)) return slugifyCache.get(key);
			const value = slugifyFilter(key);
			slugifyCache.set(key, value);
			if (slugifyCache.size > 10000) slugifyCache.clear();
			return value;
		};
		mdLib.use(markdownItAnchor, {
			permalink: markdownItAnchor.permalink.ariaHidden({
				placement: "after",
				class: "header-anchor",
				symbol: "",
				ariaHidden: false,
			}),
			level: [1, 2, 3, 4],
			slugify: cachedSlugify,
		});

		const setTokenAttrIfMissing = (token, name, value) => {
			if (!token || !name) return;
			const current = token.attrGet(name);
			if (current !== null && current !== undefined && String(current).trim() !== "") return;
			token.attrSet(name, value);
		};

		const defaultImageRule =
			mdLib.renderer.rules.image ||
			((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

		mdLib.renderer.rules.image = (tokens, idx, options, env, self) => {
			const token = tokens[idx];
			setTokenAttrIfMissing(token, "loading", "lazy");
			setTokenAttrIfMissing(token, "decoding", "async");
			return defaultImageRule(tokens, idx, options, env, self);
		};
	});
	eleventyConfig.addPlugin(pluginTOC, {
		tags: ["h2", "h3", "h4", "h5"],
		id: "toci",
		class: "list-group",
		ul: true,
		flat: true,
		wrapper: "div",
	});

	// NOTE: IdAttributePlugin is an Eleventy 3.x feature
	// if (!isFastBuild) {
	// 	eleventyConfig.addPlugin(IdAttributePlugin, {
	// 		slugify: (text) => {
	// 			const slug = eleventyConfig.getFilter("slugify")(text);
	// 			return `print-${slug}`;
	// 		},
	// 	});
	// }

	eleventyConfig.addFilter("authorSlug", authorSlug);
	eleventyConfig.addFilter("splitAuthors", splitAuthors);
	eleventyConfig.addFilter("xmlEscape", function (value) {
		if (value === null || value === undefined) return "";
		return String(value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	});
	eleventyConfig.addFilter("preferWebp", function (value) {
		if (!value) return value;
		const src = String(value);
		const m = src.match(/^([^?#]+)([?#].*)?$/);
		if (!m) return src;
		const pathname = m[1];
		const suffix = m[2] || "";
		if (!/\.(jpe?g|png)$/i.test(pathname)) return src;
		return pathname.replace(/\.(jpe?g|png)$/i, ".webp") + suffix;
	});
	eleventyConfig.addFilter("ensureImage", function (value, fallback = "/img/jcrt-open-graph.webp") {
		const defaultImage = String(fallback || "/img/jcrt-open-graph.webp");
		if (!value) return defaultImage;

		const src = String(value).trim();
		if (!src || src === "null" || src === "undefined") return defaultImage;
		if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return src;

		return resolveImagePath(src) ? src : defaultImage;
	});
	eleventyConfig.addShortcode("imageAttrs", function (src, fallbackWidth = 1200, fallbackHeight = 630) {
		const fallback = {
			width: Number.parseInt(fallbackWidth, 10) || 1200,
			height: Number.parseInt(fallbackHeight, 10) || 630,
		};
		const cacheKey = `${src || ""}|${fallback.width}|${fallback.height}`;
		if (imageDimensionCache.has(cacheKey)) return imageDimensionCache.get(cacheKey);

		const filePath = resolveImagePath(src);
		const dims = filePath ? getImageDimensionsFromPath(filePath) : null;
		const width = dims?.width || fallback.width;
		const height = dims?.height || fallback.height;
		const attrs = `width="${width}" height="${height}"`;
		imageDimensionCache.set(cacheKey, attrs);
		return attrs;
	});
	eleventyConfig.addFilter("htmlEntityDecode", function (value) {
		if (value === null || value === undefined) return "";
		let s = String(value);

		// Fast path for the common entities we see in URLs.
		s = s
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&#39;/g, "'");

		// Decode numeric entities.
		s = s
			.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
				try {
					return String.fromCodePoint(parseInt(hex, 16));
				} catch {
					return _;
				}
			})
			.replace(/&#([0-9]+);/g, (_, num) => {
				try {
					return String.fromCodePoint(parseInt(num, 10));
				} catch {
					return _;
				}
		});
		return s;
	});
	eleventyConfig.addFilter("stripQueryAndHash", function (value) {
		if (value === null || value === undefined) return "";
		const s = String(value).trim();
		if (!s) return s;
		return s.split("#")[0].split("?")[0];
	});

	eleventyConfig.addGlobalData("sitemapBaseUrl", () => siteBaseUrl);

	const authorLookupCache = new WeakMap();
	function getAuthorLookupMap(authorsCollection) {
		if (!Array.isArray(authorsCollection)) return null;

		let lookup = authorLookupCache.get(authorsCollection);
		if (lookup) return lookup;

		lookup = new Map();
		for (const author of authorsCollection) {
			if (!author) continue;
			const directKey = (author.data?.key || author.fileSlug || "").trim();
			if (directKey) lookup.set(directKey, author);

			const fileSlug = (author.fileSlug || "").trim();
			if (fileSlug) lookup.set(fileSlug, author);

			const name = (author.data?.name || author.data?.title || "").trim();
			const nameSlug = authorSlug(name);
			if (nameSlug) lookup.set(nameSlug, author);

			const keySlug = authorSlug(directKey);
			if (keySlug) lookup.set(keySlug, author);
		}

		authorLookupCache.set(authorsCollection, lookup);
		return lookup;
	}

	eleventyConfig.addFilter("getAuthorObj", (authorsCollection, authorKey) => {
		if (!authorKey || !authorsCollection) return null;
		const lookup = getAuthorLookupMap(authorsCollection);
		if (!lookup) return null;

		const rawKey = String(authorKey).trim();
		if (!rawKey) return null;

		return lookup.get(rawKey) || lookup.get(authorSlug(rawKey)) || null;
	});
	const postsByAuthorCache = new WeakMap();
	function buildPostsByAuthorMap(allPosts) {
		const cached = postsByAuthorCache.get(allPosts);
		if (cached) return cached;

		const byAuthor = new Map();
		for (const post of allPosts) {
			if (!isPublishedItem(post?.data)) continue;
			const authorField = post?.data?.author;
			if (!authorField) continue;

			const parts = splitAuthors(authorField);
			for (const part of parts) {
				const rawName = String(part).trim();
				if (!rawName) continue;
				const keys = new Set([
					rawName.toLowerCase(),
					authorSlug(rawName),
				].filter(Boolean));
				for (const key of keys) {
					if (!byAuthor.has(key)) byAuthor.set(key, []);
					byAuthor.get(key).push(post);
				}
			}
		}

		const sortByDateDesc = (a, b) => {
			const aTime = a?.date instanceof Date ? a.date.getTime() : 0;
			const bTime = b?.date instanceof Date ? b.date.getTime() : 0;
			return bTime - aTime;
		};

		for (const posts of byAuthor.values()) {
			const groups = {
				archives: [],
				religioustheory: [],
				blog: [],
				other: [],
			};
			for (const post of posts) {
				const url = post?.url || "";
				const inputPath = post?.inputPath || "";

				if (url.startsWith("/archives/") || inputPath.includes("/content/archives/")) {
					groups.archives.push(post);
				} else if (
					url.startsWith("/religioustheory/") ||
					inputPath.includes("/content/religioustheory/")
				) {
					groups.religioustheory.push(post);
				} else if (url.startsWith("/blog/") || inputPath.includes("/content/blog/")) {
					groups.blog.push(post);
				} else {
					groups.other.push(post);
				}
			}

			groups.archives.sort(sortByDateDesc);
			groups.religioustheory.sort(sortByDateDesc);
			groups.blog.sort(sortByDateDesc);
			groups.other.sort(sortByDateDesc);

			const ordered = [
				...groups.archives,
				...groups.religioustheory,
				...groups.blog,
				...groups.other,
			];
			posts.length = 0;
			posts.push(...ordered);
		}

		postsByAuthorCache.set(allPosts, byAuthor);
		return byAuthor;
	}
	eleventyConfig.addFilter("getPostsByAuthor", (allPosts, authorKey) => {
		if (!Array.isArray(allPosts) || !authorKey) return [];

		const rawKey = String(authorKey).trim();
		if (!rawKey) return [];
		const cacheKey = authorSlug(rawKey) || rawKey.toLowerCase();
		const byAuthor = buildPostsByAuthorMap(allPosts);
		return byAuthor.get(cacheKey) || [];
	});
	eleventyConfig.addCollection("authors", function (collectionApi) {
		return collectionApi
			.getFilteredByGlob("content/authors/*.md")
			.filter((item) => isPublishedItem(item?.data))
			.sort((a, b) => {
				const nameA = (a.data.name || a.data.title || "").toLowerCase();
				const nameB = (b.data.name || b.data.title || "").toLowerCase();
				return nameA.localeCompare(nameB);
			});
	});
	eleventyConfig.addCollection("theoryPosts", function(collectionApi) {
	  return collectionApi.getFilteredByGlob("content/religioustheory/**/*")
	    .filter(item => {
	      if (!isPublishedItem(item?.data)) return false;
	      const isRootIndex = item.inputPath.endsWith("religioustheory/index.html") || 
	                          item.inputPath.endsWith("religioustheory/index.njk") ||
	                          item.inputPath.endsWith("religioustheory/index.md");     
	      const validExtensions = [".md", ".njk", ".html"];
	      const isFile = validExtensions.some(ext => item.inputPath.endsWith(ext));
	      const hasTag = item.data.tags && item.data.tags.includes("theoryPosts");
	      return !isRootIndex && isFile && hasTag;
	    });
	});
		// Archives contain PDFs/scans that need to be copied, but the markdown is built into HTML.
		// CI can pre-copy these via scripts/pre-copy-assets.sh (hardlinks), so allow skipping passthrough copy.
		if (!process.env.PRECOPY_ARCHIVES && !isBenchMode) {
			eleventyConfig.addPassthroughCopy("content/archives/**/*.pdf");
		eleventyConfig.addPassthroughCopy("content/archives/**/*.jpg");
		eleventyConfig.addPassthroughCopy("content/archives/**/*.jpeg");
		eleventyConfig.addPassthroughCopy("content/archives/**/*.tif");
		// change folder 
		eleventyConfig.addPassthroughCopy("content/religioustheory/posts/*.{pdf,docx,png,jpg}");
		eleventyConfig.addPassthroughCopy("content/archives/**/*.tiff");
	}
	eleventyConfig.addCollection("archives", function (collectionApi) {
		if (isBenchMode) {
			return collectionApi
				.getFilteredByGlob(`content/archives/${benchIssue}/**/*.md`)
				.filter((item) => isPublishedItem(item?.data));
		}
		return collectionApi
			.getFilteredByGlob("content/archives/**/*.md")
			.filter((item) => isPublishedItem(item?.data));
	});

	eleventyConfig.addCollection("archivesToc", function (collectionApi) {
		const items = collectionApi
			.getAll()
			.filter((p) => {
				if (!isPublishedItem(p?.data)) return false;
				const ip = String(p?.inputPath || "");
				return /^\.\/content\/archives\/[^/]+\/index\.njk$/.test(ip) && p?.url;
			})
			.map((p) => {
				const key = archiveIssueSortKey(p.inputPath, p.url);
				return { p, key };
			});

		items.sort((a, b) => {
			if (a.key.major !== b.key.major) return a.key.major - b.key.major;
			if (a.key.minor !== b.key.minor) return a.key.minor - b.key.minor;
			return String(a.key.url).localeCompare(String(b.key.url));
		});

		return items.map((x) => x.p);
	});

	eleventyConfig.addCollection("feed", function (collectionApi) {
		const getDataDateMs = (item) => {
			const raw = item?.data?.date;
			if (!raw) return 0;
			const d = raw instanceof Date ? raw : new Date(raw);
			const ms = d.getTime();
			return Number.isFinite(ms) ? ms : 0;
		};
		const getSortTime = (item) => {
			const url = String(item?.url || "");
			const dataDateMs = getDataDateMs(item);
			if (url.startsWith("/archives/")) {
				if (dataDateMs > 0) return dataDateMs;
				const year = Number.parseInt(item?.data?.year, 10);
				if (Number.isFinite(year) && year > 0) return Date.UTC(year, 0, 1);
				return 0;
			}
			if (dataDateMs > 0) return dataDateMs;
			const d = item?.date;
			if (!(d instanceof Date)) return 0;
			const ms = d.getTime();
			return Number.isFinite(ms) ? ms : 0;
		};

		const getSourcePriority = (item) => {
			const url = String(item?.url || "");
			if (url.startsWith("/archives/")) return 0;
			if (url.startsWith("/blog/")) return 1;
			if (url.startsWith("/religioustheory/")) return 2;
			return 3;
		};

		const normalizeFeedItem = (item, fallbackTitle) => {
			const title = item?.data?.title ? String(item.data.title) : "";
			const sortMs = getSortTime(item);
			const normalizedDate =
				sortMs > 0
					? new Date(sortMs)
					: item?.date instanceof Date
						? item.date
						: new Date(0);
			if (title.trim()) {
				item.date = normalizedDate;
				return item;
			}
			return {
				url: item?.url,
				date: normalizedDate,
				data: { ...(item?.data || {}), title: fallbackTitle },
				inputPath: item?.inputPath,
				fileSlug: item?.fileSlug,
			};
		};

		const archives = collectionApi
			.getFilteredByGlob("content/archives/**/*.md")
			.filter((p) => isPublishedItem(p?.data))
			.filter((p) => p?.url && p.url.startsWith("/archives/"));

		const blog = collectionApi
			.getFilteredByGlob("content/blog/*.md")
			.filter((p) => isPublishedItem(p?.data))
			.map((p) => {
				if (p?.url) return p;
				const slug =
					p?.fileSlug || path.basename(String(p?.inputPath || ""), path.extname(String(p?.inputPath || "")));
				return { ...p, url: `/blog/${slug}/` };
			});

		const religioustheory = collectionApi
			.getFilteredByGlob("content/religioustheory/posts/*.md")
			.filter((p) => isPublishedItem(p?.data))
			.filter((p) => p?.url && p.url.startsWith("/religioustheory/"));

		const byKey = new Map();
		for (const item of [...archives, ...blog, ...religioustheory]) {
			const key = item?.url || item?.inputPath;
			if (!key || byKey.has(key)) continue;
			byKey.set(key, item);
		}

		const newestFirst = [...byKey.values()]
			.sort((a, b) => {
				const timeDiff = getSortTime(b) - getSortTime(a);
				if (timeDiff !== 0) return timeDiff;
				const priorityDiff = getSourcePriority(a) - getSourcePriority(b);
				if (priorityDiff !== 0) return priorityDiff;
				return String(a?.url || "").localeCompare(String(b?.url || ""));
			})
			.map((item) => normalizeFeedItem(item, item?.fileSlug || item?.url || "Untitled"));

		// Feed plugin template reverses the collection before rendering entries.
		return [...newestFirst].reverse();
	});
	const mdLib = markdownIt({
		html: true,
		breaks: true,
		linkify: true,
	});
	const renderMd = createMemoizedRenderer((content) => mdLib.render(content || ""));
	const renderMarkdownify = createMemoizedRenderer((content) => md.render(content));
	eleventyConfig.addFilter("md", (content) => renderMd(content || ""));
	eleventyConfig.addFilter("markdownify", (content) => {
		if (!content) return "";
		return renderMarkdownify(content);
	});

	// creativitas code

	if (!isBenchMode) {
		eleventyConfig.addPlugin(feedPlugin, {
			type: "atom",
			outputPath: "/feed/feed.xml",
			stylesheet: "/feed/pretty-atom-feed.xsl",
			templateData: {
				eleventyNavigation: {
					key: "Feed",
					order: 10,
				},
			},
			collection: {
				name: "feed",
				limit: 50,
			},
			metadata: {
				language: "en",
				title: "Editorial",
				subtitle: "Editorial 11ty.",
				base: siteBaseUrl,
				author: {
					name: "Editorial Board of JCRT",
				},
			},
		});

		eleventyConfig.addPlugin(feedPlugin, {
			type: "rss",
			outputPath: "/feed/feed.rss",
			templateData: {
				eleventyNavigation: {
					key: "Feed (RSS)",
					order: 11,
				},
			},
			collection: {
				name: "feed",
				limit: 50,
			},
			metadata: {
				language: "en",
				title: "Editorial",
				subtitle: "Editorial 11ty.",
				base: siteBaseUrl,
				author: {
					name: "Editorial Board of JCRT",
				},
			},
		});
	}
	eleventyConfig.watchIgnores.add("errors.txt");
	eleventyConfig.ignores.add("_drafts/**");
	eleventyConfig.ignores.add("submissions/**");
	eleventyConfig.ignores.add("**/* copy.md");

	eleventyConfig.addShortcode("currentBuildDate", () => {
		return new Date().toISOString();
	});
}

export const config = {
	templateFormats: ["md", "njk", "html", "liquid", "css", "11ty.js"],

	markdownTemplateEngine: "njk",

	htmlTemplateEngine: "njk",

	dir: {
		input: "content", // default: "."
		includes: "../_includes", // default: "_includes" (`input` relative)
		data: "../_data", // default: "_data" (`input` relative)
		output: "_site",
	},
};
