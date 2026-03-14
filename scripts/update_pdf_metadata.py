#!/usr/bin/env python3
"""
Update PDF metadata for JCRT archive articles using frontmatter from matching .md files.

Usage: python3 scripts/update_pdf_metadata.py [--dry-run] [--dir content/archives/24.2]
"""

import argparse
import re
import sys
from pathlib import Path

import yaml
from pypdf import PdfReader, PdfWriter

COPYRIGHT_NOTICE = (
    "Copyright \u00a9 held by the author(s). All rights reserved. "
    "This text may be used and shared in accordance with the fair-use provisions "
    "of U.S. copyright law. Any use of this text in other ways requires the consent "
    "of the author and the publisher, the Journal for Cultural and Religious Theory, "
    "and must cite publication in this journal."
)
COPYRIGHT_URL = "https://jcrt.org/copyright/"
JOURNAL_NAME = "The Journal for Cultural and Religious Theory"
JOURNAL_ABBR = "Journal for Cultural & Religious Theory"
PUBLISHER = "Whitestone Publications"
ISSN = "1530-5228"
SUBJECT = "Religion and Cultural Theory"
DEFAULT_KEYWORDS = ["religion", "philosophly", "and cultural theory"]

XMP_TEMPLATE = """\
<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
        xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">{title}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq>{author_seq}</rdf:Seq></dc:creator>
      <dc:publisher>{publisher}</dc:publisher>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">{description}</rdf:li></rdf:Alt></dc:description>
      <dc:subject><rdf:Bag>{keyword_items}</rdf:Bag></dc:subject>
      <dc:type>article</dc:type>
      <dc:language>en</dc:language>
      <dc:source>{journal_name}, ISSN {issn}</dc:source>
      <dc:identifier>{issn}</dc:identifier>
      <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">{copyright}</rdf:li></rdf:Alt></dc:rights>
      <xmpRights:WebStatement>{copyright_url}</xmpRights:WebStatement>
      <xmpRights:Marked>True</xmpRights:Marked>
      <prism:publicationName>{journal_name}</prism:publicationName>
      <prism:issn>{issn}</prism:issn>
      {prism_volume}
      {prism_number}
      {prism_start_page}
      {prism_end_page}
      {prism_pub_date}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""


def parse_frontmatter(md_path: Path) -> dict:
    text = md_path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    return yaml.safe_load(m.group(1)) or {}


def format_authors(author_str: str) -> list[str]:
    """Split 'A; B; C' or 'A, B, and C' author strings into a list."""
    if not author_str:
        return []
    parts = [a.strip() for a in re.split(r";", author_str) if a.strip()]
    return parts


def parse_pages(pages_str: str) -> tuple[str, str]:
    """Parse '123-456' into ('123', '456'). Returns ('', '') if unparseable."""
    if not pages_str:
        return ("", "")
    m = re.match(r"^(\d+)\s*[-\u2013]\s*(\d+)$", str(pages_str).strip())
    if m:
        return (m.group(1), m.group(2))
    return ("", "")


def normalize_keywords(raw_keywords) -> list[str]:
    """Accept keywords as list/string/number/null and normalize to title case."""
    if raw_keywords is None:
        values = []
    elif isinstance(raw_keywords, list):
        values = raw_keywords
    else:
        values = [raw_keywords]

    normalized = []
    for value in values:
        text = str(value).strip()
        if not text:
            continue
        normalized.append(text.replace("-", " ").title())

    if not normalized:
        return list(DEFAULT_KEYWORDS)
    return normalized


def build_xmp(title: str, authors: list[str], description: str, keywords: list[str],
              volume: str = "", issue: str = "", start_page: str = "",
              end_page: str = "", pub_date: str = "") -> bytes:
    author_seq = "".join(f"      <rdf:li>{a}</rdf:li>\n" for a in authors)
    keyword_items = "".join(f"      <rdf:li>{k}</rdf:li>\n" for k in keywords)
    xml = XMP_TEMPLATE.format(
        title=title,
        author_seq=author_seq,
        publisher=PUBLISHER,
        description=description or "",
        keyword_items=keyword_items,
        journal_name=JOURNAL_NAME,
        issn=ISSN,
        copyright=COPYRIGHT_NOTICE,
        copyright_url=COPYRIGHT_URL,
        prism_volume=f"<prism:volume>{volume}</prism:volume>" if volume else "",
        prism_number=f"<prism:number>{issue}</prism:number>" if issue else "",
        prism_start_page=f"<prism:startingPage>{start_page}</prism:startingPage>" if start_page else "",
        prism_end_page=f"<prism:endingPage>{end_page}</prism:endingPage>" if end_page else "",
        prism_pub_date=f"<prism:publicationDate>{pub_date}</prism:publicationDate>" if pub_date else "",
    )
    return xml.encode("utf-8")


def update_pdf(pdf_path: Path, fm: dict, dry_run: bool = False) -> bool:
    title = fm.get("title", "")
    author_str = fm.get("author", "")
    description = fm.get("description", "")
    raw_keywords = fm.get("keywords")
    keywords = normalize_keywords(raw_keywords)
    authors = format_authors(str(author_str) if author_str else "")

    author_display = "; ".join(authors) if authors else ""

    volume = str(fm.get("volume", "") or "")
    issue = str(fm.get("issue", "") or "")
    start_page, end_page = parse_pages(str(fm.get("pages", "") or ""))
    pub_date = ""
    if fm.get("date"):
        try:
            d = fm["date"]
            if hasattr(d, "isoformat"):
                pub_date = d.isoformat()
            else:
                pub_date = str(d)[:10]
        except Exception:
            pass

    print(f"  Title:    {title}")
    print(f"  Authors:  {author_display}")
    print(f"  Keywords: {', '.join(keywords)}")
    if volume or issue:
        print(f"  Vol/Iss:  {volume}/{issue}  Pages: {start_page}-{end_page}" if start_page else f"  Vol/Iss:  {volume}/{issue}")

    if dry_run:
        print("  [dry-run] skipping write")
        return True

    reader = PdfReader(str(pdf_path))
    writer = PdfWriter()
    writer.append(reader)

    meta = {
        "/Title": title,
        "/Author": author_display,
        "/Subject": SUBJECT,
        "/Keywords": ", ".join(keywords),
        "/Description": description,
        "/Publisher": PUBLISHER,
        "/JournalTitle": JOURNAL_NAME,
        "/ISSN": ISSN,
        "/Rights": COPYRIGHT_NOTICE,
        "/CopyrightURL": COPYRIGHT_URL,
    }
    if volume:
        meta["/Volume"] = volume
    if issue:
        meta["/Issue"] = issue
    if start_page:
        meta["/StartPage"] = start_page
    if end_page:
        meta["/EndPage"] = end_page
    if pub_date:
        meta["/PublicationDate"] = pub_date

    writer.add_metadata(meta)

    xmp_bytes = build_xmp(title, authors, description, keywords,
                          volume=volume, issue=issue, start_page=start_page,
                          end_page=end_page, pub_date=pub_date)
    writer.xmp_metadata = xmp_bytes

    # Write to temp, then replace original
    tmp_path = pdf_path.with_suffix(".tmp.pdf")
    with open(tmp_path, "wb") as f:
        writer.write(f)
    tmp_path.replace(pdf_path)
    return True


def main():
    parser = argparse.ArgumentParser(description="Update PDF metadata from .md frontmatter")
    parser.add_argument("--dir", default="content/archives/24.2", help="Directory containing .md and .pdf files")
    parser.add_argument("--dry-run", action="store_true", help="Parse and print without writing")
    args = parser.parse_args()

    base_dir = Path(args.dir)
    if not base_dir.is_absolute():
        base_dir = Path.cwd() / base_dir

    if not base_dir.exists():
        print(f"Error: directory not found: {base_dir}", file=sys.stderr)
        sys.exit(1)

    md_files = sorted(base_dir.glob("*.md"))
    updated = 0
    skipped = 0
    failed = 0

    for md_path in md_files:
        try:
            fm = parse_frontmatter(md_path)
            pdf_name = fm.get("pdf")
            if not pdf_name:
                # Try matching by slug
                pdf_path = md_path.with_suffix(".pdf")
            else:
                pdf_path = base_dir / str(pdf_name)

            if not pdf_path.exists():
                print(f"[skip] {md_path.name}: no matching PDF ({pdf_path.name})")
                skipped += 1
                continue

            print(f"\n[update] {pdf_path.name}")
            update_pdf(pdf_path, fm, dry_run=args.dry_run)
            updated += 1
        except Exception as exc:
            print(f"[fail] {md_path.name}: {exc.__class__.__name__}: {exc}")
            failed += 1

    print(f"\nDone: {updated} updated, {skipped} skipped, {failed} failed.")


if __name__ == "__main__":
    main()
