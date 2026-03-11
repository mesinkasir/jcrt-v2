#!/usr/bin/env python3
"""
Update PDF metadata for JCRT 24.2 articles using frontmatter from matching .md files.

Usage: python3 scripts/update_pdf_metadata.py [--dry-run] [--dir content/archives/24.2]
"""

import argparse
import io
import os
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
JOURNAL_NAME = "Journal for Cultural & Religious Theory"
SUBJECT = "Doctrine of Discovery"

XMP_TEMPLATE = """\
<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">{title}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq>{author_seq}</rdf:Seq></dc:creator>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">{description}</rdf:li></rdf:Alt></dc:description>
      <dc:subject><rdf:Bag>{keyword_items}</rdf:Bag></dc:subject>
      <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">{copyright}</rdf:li></rdf:Alt></dc:rights>
      <xmpRights:WebStatement>{copyright_url}</xmpRights:WebStatement>
      <xmpRights:Marked>True</xmpRights:Marked>
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


def build_xmp(title: str, authors: list[str], description: str, keywords: list[str]) -> bytes:
    author_seq = "".join(f"      <rdf:li>{a}</rdf:li>\n" for a in authors)
    keyword_items = "".join(f"      <rdf:li>{k}</rdf:li>\n" for k in keywords)
    xml = XMP_TEMPLATE.format(
        title=title,
        author_seq=author_seq,
        description=description or "",
        keyword_items=keyword_items,
        copyright=COPYRIGHT_NOTICE,
        copyright_url=COPYRIGHT_URL,
    )
    return xml.encode("utf-8")


def update_pdf(pdf_path: Path, fm: dict, dry_run: bool = False) -> bool:
    title = fm.get("title", "")
    author_str = fm.get("author", "")
    description = fm.get("description", "")
    raw_keywords = fm.get("keywords", []) or []
    # Convert slug-style keywords to readable form
    keywords = [k.replace("-", " ").title() for k in raw_keywords]
    authors = format_authors(str(author_str) if author_str else "")

    author_display = "; ".join(authors) if authors else ""

    print(f"  Title:    {title}")
    print(f"  Authors:  {author_display}")
    print(f"  Keywords: {', '.join(keywords)}")

    if dry_run:
        print("  [dry-run] skipping write")
        return True

    reader = PdfReader(str(pdf_path))
    writer = PdfWriter()
    writer.append(reader)

    writer.add_metadata({
        "/Title": title,
        "/Author": author_display,
        "/Subject": SUBJECT,
        "/Keywords": ", ".join(keywords),
        "/Description": description,
        "/Rights": COPYRIGHT_NOTICE,
        "/CopyrightURL": COPYRIGHT_URL,
    })

    xmp_bytes = build_xmp(title, authors, description, keywords)
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

    for md_path in md_files:
        fm = parse_frontmatter(md_path)
        pdf_name = fm.get("pdf")
        if not pdf_name:
            # Try matching by slug
            pdf_path = md_path.with_suffix(".pdf")
        else:
            pdf_path = base_dir / pdf_name

        if not pdf_path.exists():
            print(f"[skip] {md_path.name}: no matching PDF ({pdf_path.name})")
            skipped += 1
            continue

        print(f"\n[update] {pdf_path.name}")
        update_pdf(pdf_path, fm, dry_run=args.dry_run)
        updated += 1

    print(f"\nDone: {updated} updated, {skipped} skipped.")


if __name__ == "__main__":
    main()
