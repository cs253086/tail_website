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

Publishing is automatic. `.github/workflows/publish.yml` rebuilds and deploys the site
when this repository is pushed, and whenever tailos pushes to its main; a tailos push
that touches no allowlisted file stops within seconds. Every publish is a commit here,
so `git log -- public` shows what became visible and when. DESIGN.md §5.4 has the
details.

To see a change before it goes out, build it locally. The generator reads the tailos
repository from `../tailos`, or from `TAILOS_ROOT`:

```bash
npm install
npm run build          # regenerates public/ and generated/
git diff               # exactly what the next publish makes visible
```

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
npx wrangler r2 bucket create tail-os-downloads   # needs R2 enabled in the dashboard
```

Publishing then needs three secrets, each set under the repository's
**Settings → Secrets and variables → Actions**:

| Repository | Secret | What it holds |
|---|---|---|
| tail_website | `TAILOS_READ_TOKEN` | A GitHub fine-grained token with Contents: read on tailos |
| tail_website | `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with Cloudflare Pages: Edit |
| tailos | `SITE_PUBLISH_TOKEN` | A GitHub fine-grained token with Actions: read and write on tail_website |

Until they exist, both workflows skip with a warning naming what is missing.

### Downloads too large for Pages

Pages refuses files over 25 MiB, so the SDK installer lives in R2. Build it in tailos,
upload it, then publish:

```bash
make -C ../tailos sdk-installer REPACKAGE=1
node tools/upload-download.mjs ~/.local/share/tail-sdk/tailos/sdk/tail-sdk-installer-0.1.0.tar.gz
npm run build && git commit -am 'Publish the rebuilt SDK installer' && git push
```

The upload tool reads the object back and records its checksum in `content/allowlist.json`
only if it matches. It uses wrangler, which uploads at most 300 MiB.

### Cost

Nothing here has billing enabled. Cloudflare Pages hosting and 100,000 Function
requests a day are free; the Gemini free tier allows 1,500 answers a day and needs
no card. Three limits keep the site inside it — a 30-day answer cache, a per-IP
token bucket, and a 1,000/day ceiling — and each degrades to keyword results
rather than an error.

## Migrating from Bluehost

Bluehost keeps serving the old site until the last step.

1. Deploy here and verify on `tail-os.pages.dev`.
2. Repoint the `tail-os.com` nameservers to Cloudflare.
3. Confirm the live domain, then cancel the Bluehost hosting plan.
4. Keep the domain registered where it is, or transfer it at renewal.

The registration is separate from the hosting plan, so step 3 does not put the
domain at risk.
