#!/usr/bin/env node
/**
 * Internal link checker for _site/religioustheory/.
 * Scans every HTML file for <a href="..."> links that point within the site
 * and verifies the target exists on disk. Outputs a report of broken links.
 */
import fs from "node:fs";
import path from "node:path";

const SITE_DIR = path.resolve(process.cwd(), "_site");
const SCAN_DIR = path.resolve(SITE_DIR, "religioustheory");

// Collect all HTML files under a directory
function collectHtmlFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectHtmlFiles(full));
    } else if (entry.name.endsWith(".html")) {
      results.push(full);
    }
  }
  return results;
}

// Extract all href values from anchor tags
function extractHrefs(html) {
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const hrefs = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    hrefs.push(m[1]);
  }
  return hrefs;
}

// Build a set of all known paths in _site (normalised)
function buildSiteIndex() {
  const index = new Set();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = "/" + path.relative(SITE_DIR, full);
      if (entry.isDirectory()) {
        index.add(rel);
        index.add(rel + "/");
        walk(full);
      } else {
        index.add(rel);
      }
    }
  }
  walk(SITE_DIR);
  return index;
}

function resolveLink(href, pageRelPath) {
  // Skip external, mailto, tel, javascript, anchors-only, data URIs
  if (/^(https?:|mailto:|tel:|javascript:|data:|#)/i.test(href)) return null;

  // Strip fragment and query
  const clean = href.split("#")[0].split("?")[0];
  if (!clean) return null;

  let target;
  if (clean.startsWith("/")) {
    target = clean;
  } else {
    // Relative link — resolve against the page's directory
    const pageDir = path.dirname(pageRelPath);
    target = path.posix.normalize(path.posix.join(pageDir, clean));
    if (!target.startsWith("/")) target = "/" + target;
  }

  return target;
}

function linkExists(target, siteIndex) {
  // Exact match
  if (siteIndex.has(target)) return true;
  // With trailing slash (directory)
  if (siteIndex.has(target + "/")) return true;
  // As directory with index.html
  if (siteIndex.has(target + "/index.html")) return true;
  if (siteIndex.has(target + "index.html")) return true;
  // Without trailing slash
  if (target.endsWith("/") && siteIndex.has(target.slice(0, -1))) return true;
  // .html extension
  if (!target.endsWith(".html") && siteIndex.has(target + ".html")) return true;
  return false;
}

function main() {
  if (!fs.existsSync(SCAN_DIR)) {
    console.error(`Directory not found: ${SCAN_DIR}`);
    console.error("Run the site build first.");
    process.exit(1);
  }

  console.log("Building site file index...");
  const siteIndex = buildSiteIndex();
  console.log(`Indexed ${siteIndex.size} paths in _site/`);

  const htmlFiles = collectHtmlFiles(SCAN_DIR);
  console.log(`Scanning ${htmlFiles.length} HTML files in religioustheory/...\n`);

  const brokenByPage = new Map();
  let totalChecked = 0;
  let totalBroken = 0;

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    const hrefs = extractHrefs(html);
    const pageRel = "/" + path.relative(SITE_DIR, file);

    for (const href of hrefs) {
      const target = resolveLink(href, pageRel);
      if (target === null) continue; // external or anchor-only
      totalChecked++;

      if (!linkExists(target, siteIndex)) {
        totalBroken++;
        if (!brokenByPage.has(pageRel)) {
          brokenByPage.set(pageRel, []);
        }
        brokenByPage.get(pageRel).push({ href, resolvedTo: target });
      }
    }
  }

  // Print summary
  console.log("=".repeat(70));
  console.log(`INTERNAL LINK CHECK — /religioustheory/`);
  console.log(`Files scanned:   ${htmlFiles.length}`);
  console.log(`Links checked:   ${totalChecked}`);
  console.log(`Broken links:    ${totalBroken}`);
  console.log(`Pages affected:  ${brokenByPage.size}`);
  console.log("=".repeat(70));

  if (brokenByPage.size === 0) {
    console.log("\n✅ No broken internal links found.");
    return;
  }

  // Sort pages for deterministic output
  const sorted = [...brokenByPage.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  console.log("");
  for (const [page, links] of sorted) {
    console.log(`\n📄 ${page}`);
    for (const { href, resolvedTo } of links) {
      console.log(`   ❌ href="${href}"`);
      if (href !== resolvedTo) {
        console.log(`      → resolves to: ${resolvedTo}`);
      }
    }
  }

  // Write markdown report
  const reportPath = path.resolve(process.cwd(), "docs", "broken-links-religioustheory.md");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const lines = [
    `# Broken Internal Links — /religioustheory/`,
    ``,
    `> Generated: ${new Date().toISOString()}`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Files scanned | ${htmlFiles.length} |`,
    `| Internal links checked | ${totalChecked} |`,
    `| Broken links | ${totalBroken} |`,
    `| Pages with broken links | ${brokenByPage.size} |`,
    ``,
  ];

  for (const [page, links] of sorted) {
    lines.push(`## ${page}`);
    lines.push(``);
    lines.push(`| Broken href | Resolves to |`);
    lines.push(`|-------------|-------------|`);
    for (const { href, resolvedTo } of links) {
      lines.push(`| \`${href}\` | \`${resolvedTo}\` |`);
    }
    lines.push(``);
  }

  fs.writeFileSync(reportPath, lines.join("\n") + "\n", "utf8");
  console.log(`\n📝 Report written to: ${reportPath}`);
}

main();
