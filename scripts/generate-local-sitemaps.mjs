import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const ARCHIVES_DIR = path.join(ROOT, "content", "archives");
const OUT_DIR = path.join(ROOT, "public", "sitemaps");
const BASE_URL = "https://jcrt.org";

const ISSN_PLAIN = "15305228";
const ISSN_DASH = "1530-5228";
const PUBLISHER_DOAJ = "Whitestone Publications";
const PUBLISHER_OAI = "Whitestone Foundation";
const JOURNAL_TITLE_DOAJ = "The Journal for Cultural and Religious Theory";
const JOURNAL_TITLE_OAI = "Journal for Cultural &amp; Religious Theory";
const RIGHTS_TEXT =
  "Copyright held by the author(s). Articles are licensed under a Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License.";
const DOAJ_SKIP_SLUGS = new Set(["index", "author-bios", "table-of-contents", "abstracts", "bios"]);

function parseFrontMatter(content) {
  if (!content.startsWith("---")) return {};
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return {};
  try {
    return yaml.load(match[1]) || {};
  } catch {
    return {};
  }
}

function escXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function walkMarkdown(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (item.isFile() && item.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out;
}

function toDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function normalizeNum(v) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? raw : String(n);
}

function parsePages(pages) {
  const raw = String(pages || "").trim();
  if (!raw) return { sp: "", ep: "" };
  const norm = raw.replace(/\s+/g, "").replace(/[–—]/g, "-");
  const [sp = "", ep = ""] = norm.split("-", 2);
  return { sp, ep };
}

function splitAuthors(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(splitAuthors);
  const s = String(value).trim();
  if (!s) return [];
  if (s.includes(";")) return s.split(";").map((p) => p.trim()).filter(Boolean);
  if (/\s+and\s+/i.test(s)) return s.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  return [s];
}

function splitKeywords(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((k) => String(k).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function issueSort(a, b) {
  const [av, ai] = a.issue.split(".").map(Number);
  const [bv, bi] = b.issue.split(".").map(Number);
  if (av !== bv) return av - bv;
  if (ai !== bi) return ai - bi;
  return a.slug.localeCompare(b.slug);
}

function getIssueMeta(issueSlug, cache) {
  if (cache.has(issueSlug)) return cache.get(issueSlug);
  const issueIndex = path.join(ARCHIVES_DIR, issueSlug, "index.njk");
  let meta = {};
  try {
    meta = parseFrontMatter(fs.readFileSync(issueIndex, "utf8"));
  } catch {
    meta = {};
  }
  cache.set(issueSlug, meta || {});
  return cache.get(issueSlug);
}

function readArchiveEntries() {
  const files = walkMarkdown(ARCHIVES_DIR);
  const cache = new Map();
  const entries = [];

  for (const filePath of files) {
    const rel = path.relative(ARCHIVES_DIR, filePath);
    const parts = rel.split(path.sep);
    if (parts.length < 2) continue;

    const issueSlug = parts[0];
    if (!issueSlug.includes(".")) continue;

    const slug = path.basename(filePath, ".md");
    const content = fs.readFileSync(filePath, "utf8");
    const data = parseFrontMatter(content);
    if (!data || typeof data !== "object") continue;

    const issueMeta = getIssueMeta(issueSlug, cache);
    const [dirVol, dirIss] = issueSlug.split(".");

    const volume = normalizeNum(data.volume || issueMeta.volume || dirVol);
    const issueNum = normalizeNum(data.issue || issueMeta.issue || dirIss);
    const { sp, ep } = parsePages(data.pages);
    const authors = splitAuthors(data.author);
    const keywords = splitKeywords(data.keywords);
    const description = String(data.description || data.abstract || "").trim();
    const title = String(data.title || "").trim();
    const published = data.published !== false;
    const sitemapIgnore = !!data.sitemapIgnore;

    let dateStr = toDateOnly(data.date);
    if (!dateStr && issueMeta.year) dateStr = `${issueMeta.year}-01-01`;
    if (!dateStr && data.year) dateStr = `${data.year}-01-01`;

    const pdfFile = String(data.pdf || "").trim();
    const stem = pdfFile.toLowerCase().endsWith(".pdf")
      ? pdfFile.slice(0, -4)
      : slug;

    entries.push({
      issue: issueSlug,
      slug,
      title,
      authors,
      keywords,
      description,
      volume,
      issueNum,
      sp,
      ep,
      dateStr,
      pdfFile,
      citationStem: stem,
      canonicalUrl: `${BASE_URL}/archives/${issueSlug}/${slug}/`,
      pdfUrl: pdfFile ? `${BASE_URL}/archives/${issueSlug}/${pdfFile}` : "",
      published,
      sitemapIgnore,
    });
  }

  entries.sort(issueSort);
  return entries;
}

function generateDoaj(entries) {
  const filtered = entries.filter((e) =>
    e.published && e.title && !DOAJ_SKIP_SLUGS.has(e.slug.toLowerCase()),
  );

  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<records xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
    `         xsi:noNamespaceSchemaLocation="https://jcrt.org/sitemaps/doajArticles.xsd">`,
  ];

  for (const e of filtered) {
    lines.push(`  <record>`);
    lines.push(`    <language>eng</language>`);
    lines.push(`    <publisher>${escXml(PUBLISHER_DOAJ)}</publisher>`);
    lines.push(`    <journalTitle>${escXml(JOURNAL_TITLE_DOAJ)}</journalTitle>`);
    lines.push(`    <issn>${ISSN_PLAIN}</issn>`);
    lines.push(`    <publicationDate>${escXml(e.dateStr)}</publicationDate>`);
    lines.push(`    <volume>${escXml(e.volume)}</volume>`);
    lines.push(`    <issue>${escXml(e.issueNum)}</issue>`);
    lines.push(`    <startPage>${escXml(e.sp)}</startPage>`);
    lines.push(`    <endPage>${escXml(e.ep)}</endPage>`);
    lines.push(`    <publisherRecordId>${escXml(e.slug)}</publisherRecordId>`);
    lines.push(`    <documentType>article</documentType>`);
    lines.push(`    <title language="eng">${escXml(e.title)}</title>`);

    if (e.authors.length) {
      lines.push(`    <authors>`);
      for (const author of e.authors) {
        lines.push(`      <author><name>${escXml(author)}</name></author>`);
      }
      lines.push(`    </authors>`);
    }

    if (e.description) {
      lines.push(`    <abstract language="eng">${escXml(e.description)}</abstract>`);
    }

    lines.push(`    <fullTextUrl format="html">${escXml(e.canonicalUrl)}</fullTextUrl>`);

    if (e.keywords.length) {
      lines.push(`    <keywords language="eng">`);
      for (const kw of e.keywords) {
        lines.push(`      <keyword>${escXml(kw)}</keyword>`);
      }
      lines.push(`    </keywords>`);
    }

    lines.push(`  </record>`);
  }

  lines.push(`</records>`);
  return { xml: `${lines.join("\n")}\n`, count: filtered.length };
}

function generateOai(entries) {
  const now = new Date().toISOString();
  const filtered = entries.filter((e) => e.published && !e.sitemapIgnore);

  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"`,
    `         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
    `         xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd">`,
    `  <responseDate>${escXml(now)}</responseDate>`,
    `  <request verb="ListRecords" metadataPrefix="oai_dc">https://jcrt.org/sitemaps/oai_dc.xml</request>`,
    `  <ListRecords>`,
  ];

  for (const e of filtered) {
    const oaiId = `oai:jcrt.org:archives:${e.issue}:${e.slug}`;
    const datestamp = e.dateStr || now.slice(0, 10);

    lines.push(`    <record>`);
    lines.push(`      <header>`);
    lines.push(`        <identifier>${escXml(oaiId)}</identifier>`);
    lines.push(`        <datestamp>${escXml(datestamp)}</datestamp>`);
    lines.push(`      </header>`);
    lines.push(`      <metadata>`);
    lines.push(`        <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"`);
    lines.push(`                   xmlns:dc="http://purl.org/dc/elements/1.1/"`);
    lines.push(`                   xmlns:dcterms="http://purl.org/dc/terms/"`);
    lines.push(`                   xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.openarchives.org/OAI/2.0/oai_dc.xsd">`);

    if (e.title) lines.push(`          <dc:title>${escXml(e.title)}</dc:title>`);
    for (const author of e.authors) {
      lines.push(`          <dc:creator>${escXml(author)}</dc:creator>`);
    }
    lines.push(`          <dc:publisher>${escXml(PUBLISHER_OAI)}</dc:publisher>`);
    lines.push(`          <dc:date>${escXml(datestamp)}</dc:date>`);
    lines.push(`          <dc:type>article</dc:type>`);
    lines.push(`          <dc:format>text/html</dc:format>`);
    lines.push(`          <dc:language>en</dc:language>`);
    lines.push(`          <dc:identifier>${ISSN_DASH}</dc:identifier>`);
    lines.push(`          <dc:identifier>${escXml(e.canonicalUrl)}</dc:identifier>`);
    lines.push(`          <dc:identifier.uri>${escXml(e.canonicalUrl)}</dc:identifier.uri>`);
    if (e.pdfUrl) lines.push(`          <dc:relation>${escXml(e.pdfUrl)}</dc:relation>`);
    if (e.description) lines.push(`          <dc:description>${escXml(e.description)}</dc:description>`);
    for (const kw of e.keywords) {
      lines.push(`          <dc:subject>${escXml(kw)}</dc:subject>`);
    }
    lines.push(`          <dc:rights>${escXml(RIGHTS_TEXT)}</dc:rights>`);
    lines.push(`          <dc:source>${JOURNAL_TITLE_OAI}, ISSN ${ISSN_DASH}</dc:source>`);
    if (e.volume) {
      const citation = `Vol. ${e.volume}${e.issueNum ? `, No. ${e.issueNum}` : ""}${e.sp ? `, pp. ${e.sp}${e.ep ? `-${e.ep}` : ""}` : ""}`;
      lines.push(`          <dcterms:bibliographicCitation>${escXml(citation)}</dcterms:bibliographicCitation>`);
    }
    lines.push(`        </oai_dc:dc>`);
    lines.push(`      </metadata>`);
    lines.push(`    </record>`);
  }

  lines.push(`  </ListRecords>`);
  lines.push(`</OAI-PMH>`);
  return { xml: `${lines.join("\n")}\n`, count: filtered.length };
}

function generateCitationSitemap(entries, extension) {
  const urls = new Set();
  for (const e of entries) {
    if (!e.published || e.sitemapIgnore) continue;
    const stem = String(e.citationStem || "").trim();
    if (!stem) continue;
    urls.add(`${BASE_URL}/citations/archives/${e.issue}/${stem}${extension}`);
  }

  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ];

  for (const url of [...urls].sort()) {
    lines.push(`  <url><loc>${escXml(url)}</loc></url>`);
  }

  lines.push(`</urlset>`);
  return { xml: `${lines.join("\n")}\n`, count: urls.size };
}

function writeFile(relativePath, content) {
  const outputPath = path.join(OUT_DIR, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  return outputPath;
}

const entries = readArchiveEntries();

const doaj = generateDoaj(entries);
writeFile("doaj-archives.xml", doaj.xml);

const oai = generateOai(entries);
writeFile("oai_dc.xml", oai.xml);

const ris = generateCitationSitemap(entries, ".ris");
writeFile(path.join("citations", "ris-sitemap.xml"), ris.xml);

const csl = generateCitationSitemap(entries, ".csl.json");
writeFile(path.join("citations", "csl-json-sitemap.xml"), csl.xml);

console.log(`[sitemaps] doaj-archives.xml records: ${doaj.count}`);
console.log(`[sitemaps] oai_dc.xml records: ${oai.count}`);
console.log(`[sitemaps] citations/ris-sitemap.xml URLs: ${ris.count}`);
console.log(`[sitemaps] citations/csl-json-sitemap.xml URLs: ${csl.count}`);
