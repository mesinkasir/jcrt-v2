import fs from "node:fs";
import path from "node:path";

const issueYearCache = new Map();

function readIssueYear(issue) {
  if (!issue) return null;
  if (issueYearCache.has(issue)) return issueYearCache.get(issue);

  const issueIndexPath = path.join(process.cwd(), "content", "archives", issue, "index.njk");
  if (!fs.existsSync(issueIndexPath)) {
    issueYearCache.set(issue, null);
    return null;
  }

  const src = fs.readFileSync(issueIndexPath, "utf8");
  const match = src.match(/^\s*year:\s*['"]?(\d{4})['"]?\s*$/m);
  const year = match ? Number.parseInt(match[1], 10) : null;
  issueYearCache.set(issue, Number.isFinite(year) ? year : null);
  return issueYearCache.get(issue);
}

export default {
  title: "Journal for Cultural and Religious Theory",
  layout: "archive-post.njk",
  eleventyComputed: {
    date: (data) => {
      if (data?.date) return data.date;
      const directYear = Number.parseInt(data?.year, 10);
      if (Number.isFinite(directYear) && directYear > 0) return `${directYear}-01-01`;

      const stem = String(data?.page?.filePathStem || "");
      const parts = stem.split("/");
      const issue = parts.length >= 3 ? parts[parts.length - 2] : null;
      const issueYear = readIssueYear(issue);
      if (Number.isFinite(issueYear) && issueYear > 0) return `${issueYear}-01-01`;

      return data?.page?.date || null;
    },
    pdfUrl: (data) => {
      const slug = data.page.fileSlug;
      if (!slug || slug === "index") return null;
      const fileName = data.pdf ?? `${slug.charAt(0).toUpperCase() + slug.slice(1)}.pdf`;
      const folder = data.page.filePathStem.substring(0, data.page.filePathStem.lastIndexOf('/'));
      return `${folder}/${fileName}`;
    },
    risCitationUrl: (data) => {
      const slug = data.page.fileSlug;
      if (!slug || slug === "index") return null;
      const issue = (data.page.filePathStem || "").split("/").slice(-2, -1)[0];
      if (!issue) return null;
      return `/citations/archives/${issue}/${slug}.ris`;
    },
    jsonCitationUrl: (data) => {
      const slug = data.page.fileSlug;
      if (!slug || slug === "index") return null;
      const issue = (data.page.filePathStem || "").split("/").slice(-2, -1)[0];
      if (!issue) return null;
      return `/citations/archives/${issue}/${slug}.csl.json`;
    },
    articleNumber: (data) => parseInt(data.article_number, 10) || 999,
    tags: (data) => {
      const manualTags = Array.isArray(data.tags) ? data.tags : [];
      const keywords = data.keywords ?? [];
      const keywordArray = Array.isArray(keywords) ? keywords : String(keywords).split(",");
      const essentialTags = ["archives"];
      const combined = [...manualTags, ...keywordArray, ...essentialTags];
      return [...new Set(combined.map(t => String(t).trim()).filter(Boolean))];
    }
  }
};
