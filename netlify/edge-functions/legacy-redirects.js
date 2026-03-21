const EXACT_REDIRECTS = new Map([
  ["/religious-theory.html", "/religioustheory/"],

  // Crawl-discovered malformed archive PDF URLs
  ["/archives/18.3/Roberts and Hayden.pdf", "https://files.jcrt.org/archives/18.3/robertsandhayden.pdf"],
  ["/archives/17.2/Hagedorn and Staudigl.pdf", "https://files.jcrt.org/archives/17.2/Hagedorn-and-Staudigl.pdf"],
  ["/archives/18.3/Ruetenik.pdf · PDF file", "https://files.jcrt.org/archives/18.3/Ruetenik.pdf"],
  ["/archives/09.1/Malabou.pdf.", "https://files.jcrt.org/archives/09.1/Malabou.pdf"],
  ["/archives/05 .3/flato.pdf", "https://files.jcrt.org/archives/05.3/flato.pdf"],
  ["/archives/13.1/lugones.pdf-", "https://files.jcrt.org/archives/13.1/lugones.pdf"],

  // Legacy typos in archive author PDFs
  ["/archives/17.2/Leclerq.pdf", "https://files.jcrt.org/archives/17.2/leclercq.pdf"],
  ["/archives/17.3/Datan.pdf", "https://files.jcrt.org/archives/17.3/Datar.pdf"],

  // Legacy Religious Theory abstracts path now served from docs
  ["/religioustheory/abstracts/Medvedeva.pdf", "https://files.jcrt.org/docs/Medvedeva.pdf"],
  ["/religioustheory/abstracts/Hujing.pdf", "https://files.jcrt.org/docs/Hujing.pdf"],
  ["/religioustheory/abstracts/Pope.pdf", "https://files.jcrt.org/docs/Pope.pdf"],
  ["/religioustheory/abstracts/Grane.pdf", "https://files.jcrt.org/docs/Grane.pdf"],
  ["/religioustheory/abstracts/Durante.pdf", "https://files.jcrt.org/docs/Durante.pdf"],
  ["/religioustheory/abstracts/Prewitt-Davis.pdf", "https://files.jcrt.org/docs/Prewitt-Davis.pdf"],

  // Legacy author profile typo from crawl
  ["/authors/carl-raschke copy/", "/authors/carl-raschke/"]
]);

function cleanPath(pathname) {
  return pathname
    .replace(/%C2%A0/gi, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArchivePath(pathname) {
  const m = pathname.match(/^\/archives\/([^/]+)\/([^/]+)$/i);
  if (!m) return null;

  const issue = m[1].replace(/\s+/g, "");
  const rawFile = m[2]
    .replace(/\s*·\s*PDF\s*file$/i, "")
    .replace(/[.\-]+$/g, "")
    .trim();

  const candidates = [
    rawFile,
    rawFile.replace(/\s+and\s+/gi, "and"),
    rawFile.replace(/\s+/g, "-"),
    rawFile.replace(/\s+/g, ""),
    rawFile.toLowerCase(),
    rawFile.replace(/\s+/g, "").toLowerCase()
  ];

  for (const file of candidates) {
    if (/\.pdf$/i.test(file)) {
      return `https://files.jcrt.org/archives/${issue}/${file}`;
    }
  }

  return null;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const rawPath = decodeURIComponent(url.pathname);
  const cleanedPath = cleanPath(rawPath);
  const lowerPath = cleanedPath.toLowerCase();

  if (EXACT_REDIRECTS.has(cleanedPath)) {
    return Response.redirect(new URL(EXACT_REDIRECTS.get(cleanedPath), url.origin), 301);
  }
  if (EXACT_REDIRECTS.has(lowerPath)) {
    return Response.redirect(new URL(EXACT_REDIRECTS.get(lowerPath), url.origin), 301);
  }

  const abstractMatch = cleanedPath.match(/^\/religioustheory\/abstracts\/([^/]+\.pdf)$/i);
  if (abstractMatch) {
    return Response.redirect(`https://files.jcrt.org/docs/${abstractMatch[1]}`, 301);
  }

  if (/^\/archives\/[^/]+\/[^/]+\.pdf(?:\s*·\s*PDF\s*file)?[.\-]*$/i.test(cleanedPath)) {
    const normalized = normalizeArchivePath(cleanedPath);
    if (normalized) {
      return Response.redirect(normalized, 301);
    }
  }

  return context.next();
};
