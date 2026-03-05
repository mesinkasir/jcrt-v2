export default class LegacyReligiousTheoryDateRedirects {
  data() {
    return {
      pagination: {
        data: "collections.theoryPosts",
        size: 1,
        alias: "post",
      },
      layout: false,
      eleventyExcludeFromCollections: true,
      sitemapIgnore: true,
      permalink: ({ post }) => {
        if (!post?.url) return false;

        const rawDate = post.date || post.data?.date;
        const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
        if (Number.isNaN(date.getTime())) return false;

        const year = String(date.getUTCFullYear());
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        const day = String(date.getUTCDate()).padStart(2, "0");
        const slug = String(post.data?.slug || post.fileSlug || "").trim();
        if (!slug) return false;

        return `/religioustheory/${year}/${month}/${day}/${slug}/index.html`;
      },
    };
  }

  render({ post }) {
    const target = post?.url || "/religioustheory/";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=${target}">
  <meta name="robots" content="noindex">
  <link rel="canonical" href="${target}">
  <title>Redirecting...</title>
  <script>window.location.replace(${JSON.stringify(target)});</script>
</head>
<body>
  <p>Redirecting to <a href="${target}">${target}</a>.</p>
</body>
</html>`;
  }
}
