# TAIL OS — website

The site for TAIL OS, a real-time microkernel operating system written in Rust for
robotics and safety-critical systems.

**TAIL OS is not a public project.** The site links to no repository, and
`content/allowlist.json` carries redaction rules that strip private repository URLs
out of every document before it is rendered. The build fails if one survives.

Live at [tail-os.com](https://tail-os.com).

## What this is

An AI-first documentation site. The front door is a question box; every answer is
retrieved from, and cites, real pages generated from the TAIL OS repository.

Nothing about the documentation is hand-maintained. `content/allowlist.json` names
the tailos files that may be published, and everything else — pages, search index,
retrieval corpus, sitemap — is generated from them.

See [DESIGN.md](DESIGN.md) for why it is built this way.

## Layout

```
content/allowlist.json   the only files that may become public
tools/                   the generator (chunking, ranking, HTML)
functions/api/           the /api/ask Cloudflare Pages Function
assets/                  stylesheet and client scripts (source)
public/                  generated site — committed, never hand-edited
generated/chunks.json    retrieval corpus, bundled into the Function
```

## Publishing a change

The generator reads the tailos repository from `../tailos`, or from `TAILOS_ROOT`.
It runs here, not in CI, so Cloudflare never holds credentials for that repository
and can never see a file that was not generated.

```bash
npm install
npm run build          # regenerates public/ and generated/
git diff               # this is the publication review
git commit && git push # Cloudflare Pages deploys public/
```

**`git diff` before pushing is the point.** The repository contains exactly what the
public can read, so the diff shows precisely what is about to become visible.

### Publishing another document

Add an entry to `content/allowlist.json` — path, slug, title, summary, and the
questions it can answer — then rebuild. Nothing outside that file is ever read.
Questions live with the document that answers them, so deleting a document also
removes its suggestions from the home page.

Check the build output. It prints every redaction it made, and a redaction means the
document you just published still contains instructions written for a repository
your readers cannot reach. Fix that in the source document rather than leaving the
placeholder on the page.

## Local development

```bash
npm run build
npm run dev            # http://localhost:8788, Functions included
npm test
```

For answers to work locally, copy `.dev.vars.example` to `.dev.vars` and add a
Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
Without one the site still runs: `/api/ask` degrades to keyword results.

## Deploying

One-time setup:

```bash
npx wrangler kv namespace create ANSWER_CACHE   # paste the id into wrangler.toml
npx wrangler pages project create tail-os
npx wrangler pages secret put GEMINI_API_KEY --project-name tail-os
```

Then connect the repository in the Cloudflare dashboard, with build output `public/`
and no build command — the site is already built and committed.

### Cost

Nothing here has billing enabled. Cloudflare Pages hosting and 100,000 Function
requests a day are free; the Gemini free tier allows 1,500 answers a day and needs
no card. Three limits keep the site inside it — a 30-day answer cache, a per-IP
token bucket, and a 1,200/day ceiling — and each degrades to keyword results
rather than an error.

## Migrating from Bluehost

Bluehost keeps serving the old site until the last step.

1. Deploy here and verify on `tail-os.pages.dev`.
2. Repoint the `tail-os.com` nameservers to Cloudflare.
3. Confirm the live domain, then cancel the Bluehost hosting plan.
4. Keep the domain registered where it is, or transfer it at renewal.

The registration is separate from the hosting plan, so step 3 does not put the
domain at risk.
