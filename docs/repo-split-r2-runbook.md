# jcrt-v2 + jcrt-files (R2/Worker) Runbook

This runbook keeps **Decap + Netlify on jcrt-v2** and delivers heavy assets from **files.jcrt.org** via **Cloudflare Worker + R2**.

## Flow
- Editors continue uploading via Decap to `jcrt-v2/public/images`.
- GitHub Action `sync-jcrt-files.yml` mirrors:
  - `public/images -> jcrt-files/images`
  - `public/docs -> jcrt-files/docs`
  - `public/citations -> jcrt-files/citations`
  - `content/archives/**/*.pdf -> jcrt-files/archives/**`
- `jcrt-files` deploy workflow uploads changed files to R2 and deploys Worker.
- Worker serves files at `https://files.jcrt.org/<key>`.

## Required GitHub Secrets (jcrt-v2)
- `JCRT_FILES_PUSH_TOKEN`: PAT with write access to `The-Whitestone-Foundation/jcrt-files`.

## Domain + routing
- `files.jcrt.org` is configured in Cloudflare as Worker custom domain.
- File paths are stable and predictable:
  - `https://files.jcrt.org/images/...`
  - `https://files.jcrt.org/archives/<issue>/<file>.pdf`
  - `https://files.jcrt.org/citations/...`

## Decap compatibility
No editor flow changes required. Decap stays pointed to `jcrt-v2` and keeps:
- `media_folder: public/images`
- `public_folder: /images`

The sync + publish pipeline makes those assets available from `files.jcrt.org`.
