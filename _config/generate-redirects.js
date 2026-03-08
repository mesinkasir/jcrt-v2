import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const siteDir = path.join(__dirname, '../_site');
const sourceRedirectsFile = path.join(__dirname, '../public/_redirects');
const archivesDir = path.join(__dirname, '../content/archives');
const theoryPostsDir = path.join(__dirname, '../content/religioustheory/posts');
const redirectsFile = path.join(siteDir, '_redirects');
const redirectsCacheFile = path.join(__dirname, '../.cache/redirects-cache.json');
const indexExtensions = ['htm', 'shtml', 'xhtml', 'htmx'];
const archiveExtensions = ['html', 'htm', 'shtml', 'xhtml', 'htmx'];
const brokenArchiveWildcardPattern = /^\/archives\/:issue\/\*\.(?:htm|shtml|xhtml|htmx)\s+/;
const whitespacePattern = /\s/;

async function findIndexFiles(dir, base = '') {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);
    
    if (entry.isDirectory()) {
      files.push(...await findIndexFiles(fullPath, relativePath));
    } else if (entry.name === 'index.html') {
      files.push({
        fullPath,
        relativePath: base,
        webPath: base.replace(/\\/g, '/') || '/'
      });
    }
  }
  
  return files;
}

function hasWhitespace(value) {
  return whitespacePattern.test(String(value || ''));
}

function dedupeRules(rules) {
  const seen = new Set();
  const deduped = [];
  for (const rule of rules) {
    const normalized = String(rule || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

async function hashTree(rootDir, extensions) {
  const extSet = new Set((extensions || []).map((ext) => String(ext).toLowerCase()));
  const rows = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!extSet.has(ext)) continue;
      const stat = await fs.stat(fullPath);
      const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      rows.push(`${rel}|${stat.size}|${Math.trunc(stat.mtimeMs)}`);
    }
  }

  await walk(rootDir);
  rows.sort((a, b) => a.localeCompare(b));
  return sha256(rows.join('\n'));
}

async function loadRedirectCache() {
  try {
    const raw = await fs.readFile(redirectsCacheFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // ignore missing/invalid cache
  }
  return {
    theoryInputHash: '',
    archiveInputHash: '',
    theoryRedirects: null,
    archiveRedirects: null,
  };
}

async function saveRedirectCache(cache) {
  await fs.mkdir(path.dirname(redirectsCacheFile), { recursive: true });
  await fs.writeFile(redirectsCacheFile, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function extractFrontMatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return {};
  try {
    return yaml.load(match[1]) || {};
  } catch {
    return {};
  }
}

function formatLegacyDatePath(dateValue, slug) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `/religioustheory/${year}/${month}/${day}/${slug}/`;
}

async function buildTheoryLegacyRedirects() {
  const entries = await fs.readdir(theoryPostsDir, { withFileTypes: true });
  const redirects = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fullPath = path.join(theoryPostsDir, entry.name);
    const raw = await fs.readFile(fullPath, 'utf8');
    const frontMatter = extractFrontMatter(raw);
    const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : [];
    if (!tags.includes('theoryPosts')) continue;

    const slug = String(frontMatter.slug || entry.name.replace(/\.md$/, '')).trim();
    if (!slug) continue;

    const target = `/religioustheory/posts/${slug}/`;
    const targetPath = path.join(siteDir, target.replace(/^\/+/, ''), 'index.html');
    try {
      await fs.access(targetPath);
    } catch {
      continue;
    }

    const source = formatLegacyDatePath(frontMatter.date, slug);
    if (!source) continue;
    redirects.push(`${source} ${target} 301!`);
  }

  return redirects;
}

async function buildArchiveLegacyRedirects() {
  const redirects = [];
  const issueEntries = await fs.readdir(archivesDir, { withFileTypes: true });

  for (const issueEntry of issueEntries) {
    if (!issueEntry.isDirectory()) continue;
    const issueSlug = issueEntry.name;
    if (!issueSlug.includes('.')) continue;

    const issueDir = path.join(archivesDir, issueSlug);
    const articleEntries = await fs.readdir(issueDir, { withFileTypes: true });

    for (const articleEntry of articleEntries) {
      if (!articleEntry.isFile() || !articleEntry.name.endsWith('.md')) continue;

      const fileSlug = articleEntry.name.replace(/\.md$/, '');
      if (fileSlug === 'index') continue;

      const target = `/archives/${issueSlug}/${fileSlug}/`;

      for (const ext of archiveExtensions) {
        redirects.push(`/archives/${issueSlug}/${fileSlug}.${ext} ${target} 301`);
      }
    }
  }

  return redirects;
}

async function main() {
  console.log('🔄 Generating Netlify redirect rules...');
  
  try {
    const baseRedirectsRaw = await fs.readFile(sourceRedirectsFile, 'utf8');
    const baseRules = baseRedirectsRaw
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => !brokenArchiveWildcardPattern.test(line))
      .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''));
    const indexFiles = await findIndexFiles(siteDir);
    const rules = [];
    
    let skippedWhitespaceRules = 0;
    for (const file of indexFiles) {
      const webBase = file.webPath === '/' ? '/' : `/${file.webPath}/`;
      if (hasWhitespace(webBase)) {
        skippedWhitespaceRules += indexExtensions.length;
        continue;
      }
      
      for (const ext of indexExtensions) {
        rules.push(`${webBase}index.${ext} ${webBase}index.html 301!`);
      }
    }

    const cache = await loadRedirectCache();
    const [archiveInputHash, theoryInputHash] = await Promise.all([
      hashTree(archivesDir, ['.md']),
      hashTree(theoryPostsDir, ['.md']),
    ]);

    let archiveRedirects = Array.isArray(cache.archiveRedirects) ? cache.archiveRedirects : null;
    if (cache.archiveInputHash !== archiveInputHash || !archiveRedirects) {
      archiveRedirects = await buildArchiveLegacyRedirects();
    }

    let theoryRedirects = Array.isArray(cache.theoryRedirects) ? cache.theoryRedirects : null;
    if (cache.theoryInputHash !== theoryInputHash || !theoryRedirects) {
      theoryRedirects = await buildTheoryLegacyRedirects();
    }

    const allRules = dedupeRules([...baseRules, ...rules, ...archiveRedirects, ...theoryRedirects]);
    const nextContent = `${allRules.join('\n')}\n`;
    let wroteFile = true;
    try {
      const currentContent = await fs.readFile(redirectsFile, 'utf8');
      if (currentContent === nextContent) {
        wroteFile = false;
      }
    } catch {
      wroteFile = true;
    }
    if (wroteFile) {
      await fs.writeFile(redirectsFile, nextContent, 'utf8');
    }
    await saveRedirectCache({
      archiveInputHash,
      theoryInputHash,
      archiveRedirects,
      theoryRedirects,
      generatedAt: new Date().toISOString(),
    });

    console.log(`✅ Generated ${allRules.length} Netlify redirect rules (${baseRules.length} base rules, ${rules.length} extension redirects, ${archiveRedirects.length} archive legacy redirects, ${theoryRedirects.length} theory legacy redirects)`);
    if (!wroteFile) {
      console.log('ℹ️ _redirects unchanged (skipped file write)');
    }
    if (skippedWhitespaceRules > 0) {
      console.log(`ℹ️ Skipped ${skippedWhitespaceRules} extension redirects with whitespace in URL paths`);
    }
  } catch (error) {
    console.error('❌ Error generating Netlify redirects:', error);
    process.exit(1);
  }
}

main();
