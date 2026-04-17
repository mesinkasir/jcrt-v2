import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const redirectsPath = path.join(repoRoot, "public", "_redirects");
const netlifyTomlPath = path.join(repoRoot, "netlify.toml");

function loadRuleLines() {
  return fs
    .readFileSync(redirectsPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));
}

function parseRule(line) {
  const [from, to, status = ""] = line.split(/\s+/);
  return { from, to, status };
}

function findRuleIndex(ruleLines, from, to) {
  return ruleLines.findIndex((line) => {
    const rule = parseRule(line);
    return rule.from === from && rule.to === to;
  });
}

function assertPresent(failures, ruleLines, from, to) {
  if (findRuleIndex(ruleLines, from, to) === -1) {
    failures.push(`missing _redirects rule: ${from} -> ${to}`);
  }
}

function assertAbsent(failures, ruleLines, from, to) {
  if (findRuleIndex(ruleLines, from, to) !== -1) {
    failures.push(`stale _redirects rule still present: ${from} -> ${to}`);
  }
}

function assertOrderedBefore(failures, ruleLines, left, right) {
  const leftIndex = findRuleIndex(ruleLines, left[0], left[1]);
  const rightIndex = findRuleIndex(ruleLines, right[0], right[1]);
  if (leftIndex === -1 || rightIndex === -1) return;
  if (leftIndex >= rightIndex) {
    failures.push(
      `rule order incorrect: ${left[0]} -> ${left[1]} must appear before ${right[0]} -> ${right[1]}`
    );
  }
}

const ruleLines = loadRuleLines();
const failures = [];

const archiveExceptions = [
  ["/archives/01.2/vahanian", "/archives/01.2/nvahanian/"],
  ["/archives/01.2/vahanian/", "/archives/01.2/nvahanian/"],
  ["/archives/01.2/wyschograd_raschke.shtml", "/archives/01.2/wyschogrod_raschke/"],
  ["/archives/02.1/reinhard.shtml", "/archives/02.1/reinhard_lupton/"],
  ["/archives/02.1/intro_reinhard_lupton.shtml", "/archives/02.1/lupton/"],
  ["/archives/03.1/taylor.shtml", "/archives/03.1/"],
  ["/archives/04.1/manolopoulos.shtml", "/archives/04.1/markmanolopoulos/"],
  ["/archives/04.2/%20pecora.shtml", "/archives/04.2/pecora/"],
  ["/archives/07.1/zizek-taylor.shtml", "/archives/07.1/taylor/"],
  ["/archives/07.2/mdex.shtml", "/archives/07.2/"],
];

const archiveIndexRules = [
  ["/archives/:issue/index2/:slug/", "/archives/:issue/:slug/"],
  ["/archives/:issue/index.shtml", "/archives/:issue/"],
  ["/archives/:issue/index.html", "/archives/:issue/"],
  ["/archives/:issue/index", "/archives/:issue/"],
];

const archiveGenericRules = [
  ["/archives/:issue/:slug.shtml", "/archives/:issue/:slug/"],
  ["/archives/:issue/:slug.html", "/archives/:issue/:slug/"],
];

const archiveRewriteRule = ["/archives/:issue/:slug/", "/archives/:issue/:slug/index.html"];

const nonArchiveRules = [
  ["/religioustheory/abstracts/:file", "https://files.jcrt.org/docs/:file"],
  ["/authors/carl-raschke%20copy/", "/authors/carl-raschke/"],
];

const malformedPdfRules = [
  ["/archives/18.3/Roberts%20and%20Hayden.pdf", "/archives/18.3/robertsandhayden.pdf"],
  ["/archives/17.2/Hagedorn%20and%20Staudigl.pdf", "/archives/17.2/Hagedorn-and-Staudigl.pdf"],
  ["/archives/05%20.3/flato.pdf", "/archives/05.3/flato.pdf"],
  ["/archives/13.1/lugones.pdf-", "/archives/13.1/lugones.pdf"],
  ["/archives/17.2/Leclerq.pdf", "/archives/17.2/leclercq.pdf"],
  ["/archives/17.3/Datan.pdf", "/archives/17.3/Datar.pdf"],
];

for (const rule of [
  ...archiveExceptions,
  ...archiveIndexRules,
  ...archiveGenericRules,
  archiveRewriteRule,
  ...nonArchiveRules,
  ...malformedPdfRules,
]) {
  assertPresent(failures, ruleLines, rule[0], rule[1]);
}

for (const exceptionRule of archiveExceptions) {
  for (const genericRule of archiveGenericRules) {
    assertOrderedBefore(failures, ruleLines, exceptionRule, genericRule);
  }
}

for (const indexRule of archiveIndexRules) {
  for (const genericRule of archiveGenericRules) {
    assertOrderedBefore(failures, ruleLines, indexRule, genericRule);
  }
}

for (const genericRule of archiveGenericRules) {
  assertOrderedBefore(failures, ruleLines, genericRule, archiveRewriteRule);
}

assertAbsent(failures, ruleLines, "/archives/15.2/valente2", "/archives/15.2/valente/");

const netlifyToml = fs.readFileSync(netlifyTomlPath, "utf8");
if (netlifyToml.includes('function = "legacy-redirects"')) {
  failures.push('netlify.toml still references "legacy-redirects"');
}

for (const deletedPath of [
  path.join(repoRoot, "netlify", "edge-functions", "legacy-redirects.js"),
  path.join(repoRoot, "netlify", "edge-functions", "archive-route-manifest.js"),
]) {
  if (fs.existsSync(deletedPath)) {
    failures.push(`deleted file still exists: ${path.relative(repoRoot, deletedPath)}`);
  }
}

if (failures.length > 0) {
  console.error("Redirect validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Validated ${archiveExceptions.length} archive exceptions, ${archiveGenericRules.length} generic archive rules, and edge-function removal.`
);
