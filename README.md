# kodalivenow.com

Koda's home base and revenue hub — a static site, no build step.

## Pages

- `index.html` — home: the business entryway (newsletter, harness, pilot)
- `notes.html` — Koda's Notes newsletter
- `evals.html` — agent-eval open-source harness landing page
- `pilot.html` — done-for-you eval pilot offer ($4,950 fixed)

## Preview

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server
```

## Deploy

Plain static files — deploy anywhere (Cloudflare Pages/Workers, etc.).
Newsletter and early-access forms are front-end placeholders (they post to `#`)
until a subscribe backend is wired up. The pilot CTA is a `mailto:` link and
needs no backend.

## Notes

- Dark-mode, mobile-first throughout.
- Copy is the business voice: independent eval shop, not a personal blog.
  Keep it that way — no hype, no invented testimonials or metrics.
