#!/usr/bin/env python3
"""Scaffold a new blog post with every production checkpoint baked in.

Usage:
    python3 blog/new-post.py --slug my-post --title "My Post Title" \\
        --description "One-line description." --hero /path/to/hero.jpg \\
        [--hero-alt "Alt text"] [--hero-caption "Caption text"] \\
        [--date 2026-09-27] [--category Retrospective]

What it does:
  1. Copies the hero image to blog/images/hero-<slug>.<ext>
  2. Scaffolds blog/<slug>/index.html from the checkpoint template:
     canonical, OG + Twitter cards, JSON-LD Article, hero figure with
     alt + caption, <article> markup, and NO scroll-gated data-reveal
     on the body (hero/title animations only).
  3. Adds the post card to the top of blog/index.html
  4. Adds the URL to sitemap.xml
  5. Adds the post to the ## Blog section of llms.txt

Then: write the body prose, run harness/verify_blog.py, and take the
1440px + 390px screenshots before showing it to anyone.
Stdlib only.
"""
import argparse, datetime, html, os, re, shutil, sys

WT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOG = os.path.join(WT, "blog")
SITE = "https://kodalivenow.com"

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title_esc} &mdash; Koda&rsquo;s Blog</title>
<meta name="description" content="{desc_attr}">
<link rel="canonical" href="{site}/blog/{slug}/">
<meta name="theme-color" content="#14101d">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Koda">
<meta property="og:title" content="{title_attr}">
<meta property="og:description" content="{desc_attr}">
<meta property="og:url" content="{site}/blog/{slug}/">
<meta property="og:image" content="{site}/blog/images/{hero_file}">
<meta property="og:image:alt" content="{hero_alt_attr}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title_attr}">
<meta name="twitter:description" content="{desc_attr}">
<meta name="twitter:image" content="{site}/blog/images/{hero_file}">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{title_json}",
  "description": "{desc_json}",
  "image": "{site}/blog/images/{hero_file}",
  "datePublished": "{date_iso}",
  "author": {{ "@type": "Person", "name": "Koda" }}
}}
</script>
<link rel="icon" type="image/svg+xml" href="../../assets/img/favicon.svg">
<link rel="preload" href="../../assets/fonts/clash-display-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="../../assets/fonts/clash-display-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="../../assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="../../assets/fonts/jetbrains-mono-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../../assets/css/main.css">
<link rel="stylesheet" href="../../assets/css/polish-type.css">
<link rel="stylesheet" href="../../assets/css/polish-glass.css">
<link rel="stylesheet" href="../../assets/css/polish-icons.css">
<link rel="stylesheet" href="../../assets/css/polish-motion.css">
<link rel="stylesheet" href="../../assets/css/blog.css">
<script defer src="../../assets/js/polish-motion.js"></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <nav class="nav" aria-label="Primary">
    <a class="brand" href="../../" aria-label="Koda &mdash; home">
      <img src="../../assets/img/curl-mark.svg" alt="" width="30" height="30">
      <span>Koda</span>
    </a>
    <ul class="nav-links">
      <li><a href="../../">Home</a></li>
      <li><a href="../../about/">About</a></li>
      <li><a href="../../now/">Now</a></li>
      <li><a href="../../code/">Code</a></li>
      <li><a href="../" aria-current="page">Blog</a></li>
    </ul>
  </nav>
</header>
<main id="main">
<section class="page-hero" aria-label="{title_attr}">
  <div class="container">
    <p class="eyebrow" data-reveal>Blog</p>
    <h1 data-reveal>{title_esc}</h1>
    <div class="post-meta" data-reveal><time datetime="{date_iso}">{date_human}</time><span class="dot" aria-hidden="true">&middot;</span><span>{category_esc}</span></div>
  </div>
</section>

<div class="container">
  <figure class="post-hero">
    <div class="frame"><img src="../images/{hero_file}" alt="{hero_alt_attr}" fetchpriority="high"></div>
    <figcaption>{hero_caption_esc}</figcaption>
  </figure>
</div>

<article class="section" aria-label="Post body" style="padding-block-start:0">
  <div class="container">
    <div class="prose">
      <!-- TODO: write the post body. Keep the h2/h3 hierarchy clean,
           give every image meaningful alt text, and keep every claim
           checkable. The body is never scroll-gated: do NOT add
           data-reveal to .prose. -->
      <p>Post body goes here.</p>
    </div>
    <nav class="post-nav" aria-label="More posts">
      <a href="../">&larr; All posts</a>
      <span></span>
    </nav>
  </div>
</article>
</main>
<footer class="site-footer">
  <div class="container footer-grid">
    <div>
      <div class="footer-brand">
        <img src="../../assets/img/curl-mark.svg" alt="" width="34" height="34">
        <span>Koda</span>
      </div>
      <p class="footer-handle">@kodalivenow on Threads &amp; Instagram</p>
    </div>
    <div class="footer-meta">
      <p>&copy; 2026 Koda</p>
      <p class="footer-colophon">Designed, written, and built by me.</p>
    </div>
  </div>
</footer>
</body>
</html>
"""

CARD = """      <a class="card post-card" data-reveal href="{slug}/">
        <span class="thumb"><img src="images/{hero_file}" alt="{hero_alt_attr}" loading="lazy"></span>
        <span>
          <p class="post-date">{date_human}</p>
          <h2>{title_esc}</h2>
          <p>{desc_esc}</p>
        </span>
      </a>
"""


def fail(msg):
    print(f"new-post: error: {msg}", file=sys.stderr)
    sys.exit(2)


def main():
    ap = argparse.ArgumentParser(description="Scaffold a new blog post.")
    ap.add_argument("--slug", required=True, help="URL slug, e.g. my-post")
    ap.add_argument("--title", required=True)
    ap.add_argument("--description", required=True, help="One-line description")
    ap.add_argument("--hero", required=True, help="Path to a web-ready hero image (jpg/png/webp)")
    ap.add_argument("--hero-alt", default="", help="Hero alt text (required for quality)")
    ap.add_argument("--hero-caption", default="", help="Hero caption (may be empty)")
    ap.add_argument("--date", default=str(datetime.date.today()), help="YYYY-MM-DD")
    ap.add_argument("--category", default="Notes")
    a = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9-]+", a.slug):
        fail("slug must match [a-z0-9-]+")
    try:
        d = datetime.date.fromisoformat(a.date)
    except ValueError:
        fail("date must be YYYY-MM-DD")
    if not a.hero_alt.strip():
        fail("--hero-alt is required: every image needs meaningful alt text")

    post_dir = os.path.join(BLOG, a.slug)
    if os.path.exists(post_dir):
        fail(f"blog/{a.slug}/ already exists")

    ext = os.path.splitext(a.hero)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        fail("hero must be .jpg/.png/.webp")
    if not os.path.isfile(a.hero):
        fail(f"hero not found: {a.hero}")

    date_human = d.strftime("%B %-d, %Y")
    hero_file = f"hero-{a.slug}{ext}"
    shutil.copy(a.hero, os.path.join(BLOG, "images", hero_file))
    print(f"hero -> blog/images/{hero_file}")

    esc = lambda s: html.escape(s, quote=False)
    attr = lambda s: html.escape(s, quote=True)
    js = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')

    page = TEMPLATE.format(
        site=SITE, slug=a.slug,
        title_esc=esc(a.title), title_attr=attr(a.title), title_json=js(a.title),
        desc_attr=attr(a.description), desc_esc=esc(a.description), desc_json=js(a.description),
        hero_file=hero_file, hero_alt_attr=attr(a.hero_alt),
        hero_caption_esc=esc(a.hero_caption) if a.hero_caption else "",
        date_iso=d.isoformat(), date_human=date_human,
        category_esc=esc(a.category),
    )
    os.makedirs(post_dir)
    with open(os.path.join(post_dir, "index.html"), "w") as f:
        f.write(page)
    print(f"page -> blog/{a.slug}/index.html")

    # 3. card at the top of the post list
    idx = os.path.join(BLOG, "index.html")
    s = open(idx).read()
    card = CARD.format(slug=a.slug, hero_file=hero_file, hero_alt_attr=attr(a.hero_alt),
                       date_human=date_human, title_esc=esc(a.title), desc_esc=esc(a.description))
    anchor = '<div class="post-list">\n'
    if anchor not in s:
        fail("could not find post-list anchor in blog/index.html")
    s = s.replace(anchor, anchor + card, 1)
    open(idx, "w").write(s)
    print("card added to blog/index.html")

    # 4. sitemap
    sm = os.path.join(WT, "sitemap.xml")
    s = open(sm).read()
    entry = f'  <url><loc>{SITE}/blog/{a.slug}/</loc><lastmod>{d.isoformat()}</lastmod></url>\n</urlset>'
    if "</urlset>" not in s:
        fail("could not find </urlset> in sitemap.xml")
    s = s.replace("</urlset>", entry, 1)
    open(sm, "w").write(s)
    print("sitemap.xml updated")

    # 5. llms.txt — append after the last bullet of the ## Blog section
    lp = os.path.join(WT, "llms.txt")
    lines = open(lp).read().splitlines(keepends=True)
    try:
        bstart = next(i for i, l in enumerate(lines) if l.startswith("## Blog"))
    except StopIteration:
        fail("no ## Blog section in llms.txt")
    # last bullet = last "- " line before the next "## " heading or EOF
    last_bullet = bstart
    for i in range(bstart + 1, len(lines)):
        if lines[i].startswith("## "):
            break
        if lines[i].startswith("- "):
            last_bullet = i
    lines.insert(last_bullet + 1, f"- {a.title} — {a.description}: {SITE}/blog/{a.slug}/\n")
    open(lp, "w").write("".join(lines))
    print("llms.txt updated")

    print()
    print("QA checklist before this post ships:")
    print("  1. Write the body prose in blog/%s/index.html (remove the TODO)." % a.slug)
    print("  2. python3 harness/verify_blog.py  (must exit 0)")
    print("  3. Review 1440px + 390px screenshots: hero visible, body visible at load, no scroll.")
    print("  4. Confirm zero console/page errors (font-CORS noise excluded).")


if __name__ == "__main__":
    main()
