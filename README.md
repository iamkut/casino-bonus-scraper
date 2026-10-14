# Casino Bonus Scraper

Pulls bonus data for online casinos from a public comparison page, uses an LLM to turn the free-text bonus terms into structured fields, writes `data.json`, and renders it in a themed HTML page. A tiny Node server lets you kick off scrapes against any URL from the UI.

## What it does

1. `scraper.js` fetches a single public page (default: `https://www.vegasslotsonline.com/casino-bonuses/`), respects `robots.txt`, strips scripts/style, and sends the visible text to OpenAI `gpt-4o-mini` with a strict-JSON prompt. Exposes a `scrape({ source, maxCasinos })` function for reuse.
2. The LLM returns a `casinos` array with four fields per casino: `name`, `welcome_bonus`, `wagering_requirement` (number), `min_deposit`. The scraper tags each with the `source_url` and writes `data.json`.
3. `server.js` is a dependency-free Node HTTP server. It serves the static files and exposes `POST /api/scrape` so the UI can trigger a refresh.
4. `index.html` renders results as a responsive card grid with search filtering, a URL input, and a Scrape button that calls the API.

## Setup

Clone the repo and install dependencies from inside the project folder:

```bash
git clone https://github.com/iamkut/casino-bonus-scraper.git
cd casino-bonus-scraper
npm install
```

Node 18+ required (uses built-in `fetch`).

### API key

The scraper reads its OpenAI key from an environment variable at runtime — **no key is committed to this repo**. The easiest way to supply one is a `.env` file (gitignored):

```bash
cp .env.example .env
# then open .env and paste your key
```

Prefer not to use a `.env` file? Export in your shell before running:

```bash
# Git Bash / Linux / macOS
export OPENAI_API_KEY=sk-...

# PowerShell
$env:OPENAI_API_KEY = "sk-..."

# cmd
set OPENAI_API_KEY=sk-...
```

Note: shell exports only live in the current terminal session. If you open a new tab, you'll need to re-export.

## Usage

```bash
# Run the server (UI + scrape API) — open http://localhost:8080
npm start

# From the UI: paste a URL (or leave blank for the default) and hit Scrape.
# Use the filter box to narrow results when the list is long.

# CLI-only scrape (no server) — writes data.json directly
npm run scrape
node scraper.js https://www.some-casino.com/promotions
```

The server exposes one JSON endpoint:

```
POST /api/scrape
Content-Type: application/json

{ "url": "https://...", "maxCasinos": 20 }   // both optional
```

`PORT` env var overrides the default `8080`.

## Deployment

### GitHub Pages (static)

The repo is set up to deploy directly from `main` with no build step — GitHub Pages serves `index.html`, `assets/`, and `data.json` as-is.

1. Push the repo to GitHub.
2. In the repo on GitHub: **Settings → Pages → Build and deployment**. Source: **Deploy from a branch**. Branch: `main`, folder: `/ (root)`. Save.
3. Wait ~1 minute. The site will be live at `https://<your-username>.github.io/<repo-name>/`.

Because Pages is static-only, the **Scrape button won't work** — there's no `/api/scrape` endpoint to call. To refresh the data:

```bash
npm run scrape          # regenerates data.json locally (needs OPENAI_API_KEY)
git add data.json
git commit -m "refresh data"
git push
```

Pages picks up the new `data.json` on the next deploy (usually under a minute).

> Never commit `.env` or paste your `OPENAI_API_KEY` into any file. `.gitignore` already excludes `.env`.

### Render (full UI with live scraping)

To make the in-browser Scrape button work, deploy to Render — the repo includes a `render.yaml` blueprint, so there's no manual config:

1. Sign in at [render.com](https://render.com) with GitHub.
2. **New → Blueprint**, pick this repo. Render reads `render.yaml` and proposes a free web service named `casino-bonus-scraper`.
3. During setup, Render prompts for the one unset env var — paste your `OPENAI_API_KEY` and apply.
4. First deploy takes a couple of minutes; after that each `git push` auto-deploys.

The service URL (e.g. `https://casino-bonus-scraper.onrender.com`) hosts both the UI and the `/api/scrape` endpoint, so the Scrape button works end-to-end.

> The free plan sleeps after ~15 min of inactivity. The first request after idle takes ~30s to wake the service — subsequent requests are instant.

### Other Node hosts

The app is a plain Node 18+ server (`npm start`), so it also runs on Fly.io, Railway, a VPS, etc. Set `OPENAI_API_KEY` in the host's environment.

## Approach notes

- **Source-agnostic extraction.** Rather than writing per-site CSS selectors, the whole page text is handed to the LLM. Changing source is a one-liner.
- **LLM step.** OpenAI `gpt-4o-mini` — small, fast, cheap — is sufficient for pulling four fields out of a prose bonus description. The call uses `response_format: json_object` so the response is always valid JSON; a markdown-fence stripper is kept defensively.
- **robots.txt respected.** Uses `robots-parser`; if the source disallows the configured User-Agent, the script errors out instead of continuing. Switch to another source as the brief allows.
- **No login/captcha bypass.** Plain `fetch` with a descriptive UA. If a source returns a Cloudflare challenge or captcha page, the scraper detects it (via known markers like `cf-chl`, `Just a moment...`) and errors out so you can swap source.
- **Shared data source.** `data.json` is the single source of truth any front-end can read, which matches the role's "one shared data source for all sites" pattern.

## Repo layout

```
casino-bonus-scraper/
  package.json
  scraper.js      # scrape() function + CLI entry
  server.js       # Node HTTP server: static files + POST /api/scrape
  index.html      # UI: URL input, scrape button, filtered card grid
  data.json       # output; committed so static deploys work out of the box
  README.md
```
