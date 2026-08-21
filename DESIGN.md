# TAIL OS website — v2 design

Status: proposed
Date: 2026-08-20
Supersedes: the hand-written static site (`index.html`, `docs/index.html`)

## 1. Problem

The current site is 1,665 lines of hand-written HTML. `docs/index.html` alone is 673
lines transcribed by hand from the tailos repo. The last five commits are all
re-transcriptions (`Rewrite Architecture sections from v0.9.0 design docs`,
`Replace Guide with Architecture section in docs`). Every tailos release restarts
that work, and between releases the site is silently wrong.

The site must also become the primary way a newcomer understands TAIL OS, without
a hand-curated navigation tree over 341 markdown documents.

## 2. Goals

1. Nothing about the docs is hand-maintained. The tailos repo is the only source of truth.
2. The front door is a single question box. A visitor types a question and gets an answer.
3. Every answer is grounded in real published text and cites it. A claim with no citation
   never reaches the reader.
4. Answers are free to serve. No credit card is attached to any account in this system,
   so no traffic pattern can produce a bill.
5. Nothing outside an explicit allowlist can ever become public.
6. Pages remain indexable by search engines and linkable from GitHub issues.

## 3. Non-goals

- Generated API reference from the 835 Rust source files. Deferred; docs only for now.
- Vector embeddings or a vector database. Keyword retrieval over a curated corpus is
  sufficient at this scale and costs nothing.
- User accounts, comments, analytics dashboards, versioned doc trees.

## 4. Why not AI-only

The original proposal was a search bar and nothing else — no pages. Four properties
of an OS project make that fail, and each one is why a page substrate exists:

| Property | Failure without pages |
|---|---|
| Targets ISO safety certification | A hallucinated error code or flag is worse than no doc. Grounding requires real text to ground against. |
| Unknown to a first-time visitor | You cannot ask a question about software you have never heard of. |
| Discovered through search engines and issue links | Answers that exist only when asked are unindexable and unlinkable. |
| Public endpoint | Without a fixed corpus, the endpoint is a free general-purpose chatbot for strangers. |

The resolution is AI-first, not AI-only. The visitor experiences a search bar. Beneath
it, generated pages give the answer something to cite, Google something to index, and a
GitHub issue something to link.

## 5. Architecture

```
  source root (default ~/src/tailos, configurable)
        │  allowlist.json names exactly which files may be published
        ▼
  tools/generate.mjs          ← runs on the maintainer's machine, never in CI
        │
        ├──► public/docs/<slug>/index.html   static pages, one per allowlisted doc
        ├──► public/search-index.json        browser-side keyword search
        ├──► public/sitemap.xml
        └──► generated/chunks.json           retrieval corpus, bundled into the Function
        │
        │  git commit  (the diff is the publication review)
        ▼
  Cloudflare Pages
        ├── static assets, served from the edge, free and unmetered
        └── functions/api/ask.js  ← Pages Function
                  ├─ 1. normalize question, look up KV answer cache
                  ├─ 2. BM25 retrieve top-K chunks from the bundled corpus
                  ├─ 3. call Gemini Flash with those chunks only
                  ├─ 4. reject any answer carrying no citation
                  └─ 5. on quota exhaustion, rate limit, or API failure:
                        return retrieval results with no answer
```

### 5.0 TAIL OS is not a public project

The site links to no repository. Two mechanisms follow from that, because removing
the navigation link alone would not have been enough:

- A link to a repository file that is *not* published is **unlinked** — its text
  stays, the anchor goes. Sending a reader to a repository they cannot open is
  worse than plain text.
- The documents themselves were written assuming a public repository: `get_started.md`
  carries a clone URL, and both installation guides carry a
  `raw.githubusercontent.com` launcher command. `content/allowlist.json` therefore
  also carries **redaction rules**, applied to the markdown before rendering so they
  catch a URL whether it appears as a link, as bare text, or inside a fenced command.
  Rendering happens after redaction, and the build **fails** if a pattern survives
  into the output.

The allowlist decides which files may be published; redaction decides what inside
them may not be. Every redaction is printed at build time, because a redaction means
a published document still instructs the reader to fetch something they cannot
reach — a content problem in the source that a placeholder hides rather than solves.

### 5.1 The publication boundary is physical

The generator runs locally, where both repos exist. Its output is committed to the
website repo. Cloudflare never has credentials for the tailos repo and never sees a
file that was not generated.

This is deliberate. tailos contains `kernel_design_internal.md`, `TODO.md`, `ROADMAP.md`
and per-module internal design docs. A denylist would leak anything not yet marked.
Instead, `content/allowlist.json` names every publishable file explicitly, and the
generator fails the build if it is asked to emit anything not on that list.

The consequence is that `git diff` before a push *is* the publication review: the
website repo contains exactly what the public can read, and nothing else.

### 5.2 Retrieval runs server-side, never in the browser

The client sends only a question string. It cannot supply passages.

Had the browser done retrieval and posted passages to the Function, a crafted request
could inject arbitrary text as "documentation" — making citations meaningless and
turning the endpoint into a general-purpose LLM proxy. Because the Function retrieves
from its own bundled corpus, answering about anything other than TAIL OS is not
prevented by a rule; it is unreachable.

### 5.3 Citations are enforced mechanically, not requested politely

The model is instructed to cite every claim as `[n]` against the numbered passages it
was given, and to refuse when the passages do not contain the answer.

The Function then parses the response. An answer containing zero valid citation markers,
or a marker pointing outside the supplied passage range, is discarded and the request
degrades to retrieval results. Prompt instructions can be ignored by a model; this check
cannot. A fabricated answer cannot reach the reader while still appearing sourced.

## 6. Content pipeline

**Chunking.** Each allowlisted markdown file is split at heading boundaries into chunks
of roughly 400–900 tokens. Each chunk retains its heading path (`Kernel Design › IPC ›
Message Passing`), its source file, and its anchor. The heading path is what a citation
displays; the anchor is what it deep-links to.

**Ranking.** BM25 with the heading path as a separately weighted field (BM25F).
A section *titled* "Run TailOS (one command)" is a far stronger signal of what it
answers than the same words appearing once in a paragraph; weighting frequency alone
would break length normalisation, so field weight applies to document length too.

The tokenizer also expands the concatenated spelling of the product name. The
documentation writes both "TAIL OS" (`get_started.md`) and "TailOS"
(`install_qemu.md`), and readers type either. Without the expansion, a question
about "TAIL OS on QEMU" scored zero against the QEMU document's own title.

**Index.** A BM25 index is built over the chunks. It is written twice: as
`search-index.json` for browser-side search, and as `chunks.json` bundled into the
Function for retrieval. Both come from one build, so browser search results and AI
citations can never disagree.

BM25 is implemented in `tools/bm25.mjs` (~60 lines) and imported by the generator, the
Function, and the browser bundle. One ranking implementation, three consumers.

**Cache invalidation.** The build emits a content hash. KV answer-cache keys are
`sha256(normalized_question) + buildId`. Republishing the docs changes `buildId`, which
retires every cached answer without an explicit purge step.

### 6.1 Launch corpus

The initial allowlist is three documents: `get_started.md`, `install_rpi3.md`, and
`install_qemu.md`. The site therefore launches able to answer questions about obtaining,
building, and running TAIL OS — and nothing else.

This has a consequence worth stating plainly: at launch, most questions a visitor might
think to ask ("how does IPC work?", "what are the scheduling guarantees?") will be
refused, because the corpus does not contain the answer. That refusal is correct
behaviour, not a defect — §5.3 exists precisely so the system says "not documented"
instead of inventing an answer. But it means the usefulness of the site is bounded by
the allowlist, and growing the allowlist is the single largest lever on site quality.

Two design consequences follow:

1. The suggested questions on the home page are drawn only from covered topics, so a
   first-time visitor's first interaction succeeds rather than hits a refusal.
2. The refusal path is a common case at launch, not an edge case. It must name what the
   site does cover and link to the GitHub repository, rather than being a dead end.

A dedicated public-documentation directory is planned in the tailos repository (or as a
separate public repository). When it exists, the generator's source root points at it
and the allowlist enumerates its contents. The allowlist is retained even then: a
directory named "public" still accumulates drafts, and the allowlist is what makes the
published set reviewable in a diff.

## 7. Cost and quota control

Gemini Flash free tier: 1,500 requests/day, 15/minute, no credit card. Three mechanisms
keep the system inside it:

| Mechanism | Storage | Behaviour |
|---|---|---|
| Answer cache | KV, 30-day TTL | Identical questions never reach Gemini. A docs site repeats the same ~50 questions indefinitely. |
| Per-IP rate limit | KV token bucket | Caps one visitor's share. Prevents a scraper draining the daily quota. |
| Global daily ceiling | KV counter, 1,200/day | Below the 1,500 hard limit, leaving headroom. On reaching it, Gemini is not called at all. |

Every limit degrades to retrieval results rather than an error. The site is never
broken by exhaustion — it is only less clever until midnight.

Cloudflare Pages static hosting and 100,000 Function requests/day are free. No component
of this system has billing enabled.

## 8. Model interface

The Gemini call lives behind one function in `functions/api/_model.js`:

```
answer({ question, passages }) -> { text, citations }
```

Nothing else in the codebase knows which provider is in use. Moving to Claude — if
answer quality on architectural questions ever justifies the cost — is an edit to that
one file, with the grounding contract, citation check, caching, and rate limiting
unchanged.

## 9. Site surface

| Route | Content |
|---|---|
| `/` | Question box, five suggested questions drawn from the current corpus, three-line description of TAIL OS, install snippet, GitHub link. No sidebar. |
| `/ask/?q=...` | Answer with inline citations, source cards linking into `/docs/`, keyword results below. Shareable URL. `noindex`, and disallowed in `robots.txt`. |
| `/docs/` | Generated index of every published document. |
| `/docs/<slug>/` | One generated page per allowlisted document. Plain HTML, readable with JavaScript disabled. |

The home page and the documentation shell are deliberately different layouts. `/`
is the front door — what search engines index and what a stranger lands on — and a
sidebar there is noise. Every other route carries the persistent section nav,
because once a reader is inside the documentation they want the map. Asking a
question therefore navigates to `/ask/` rather than re-skinning `/` in place, so
each route has exactly one layout.

Answers are generated per request, so `/ask/` is excluded from indexing *and* from
crawling: a crawler walking generated answers would drain the daily model quota for
pages that are `noindex` anyway.

The suggested questions answer the cold-start problem directly: a first-time visitor
who does not yet know what to ask is shown what is worth asking. They are generated from
the allowlist rather than hardcoded, so they cannot drift into advertising topics the
corpus no longer covers.

Documentation pages are static HTML and work without JavaScript, which is what keeps
them indexable. The question box is progressive enhancement over a plain form.

**Visual direction.** Light-first and theme-aware, one accent colour, generous
whitespace, Inter for text and JetBrains Mono for code — continuing the typographic
choices already in the current stylesheet. The home page is close to empty by design.

### 9.1 Asset caching

Assets are served from `/assets/<buildId>/…` and cached immutably for a year.
The hash sits in a directory segment rather than in filenames so that relative
imports between the client modules keep resolving unchanged.

This pairing is load-bearing in both directions: the immutable header is only safe
because the path changes every build, and a build that emitted assets to a fixed
path would serve returning visitors stale CSS and JavaScript indefinitely. A test
asserts the two stay together.

### 9.2 Rendering model output

Model output never reaches `innerHTML`. `answer-format.js` parses an answer into a
render tree of text, inline-code and citation pieces; the renderer walks that tree
setting `textContent` only. Parsing is separated from rendering so the shape of an
answer is testable without a DOM, and so the renderer stays small enough to audit
at a glance. Markup in an answer is therefore displayed as literal text by
construction, not by escaping.

## 10. Dependencies

The current site has none. This design adds three, two of them development-only:

| Package | Scope | Why |
|---|---|---|
| `markdown-it` | build | Markdown to HTML. Writing a CommonMark parser is not warranted. |
| `wrangler` | dev | Cloudflare's CLI. Required to run and deploy Pages Functions. |
| `vitest` | dev | Test runner for the generator and Function. |

BM25, chunking, front-matter parsing, and browser search are hand-written rather than
pulled in. Nothing ships to the browser except the site's own code.

## 11. Testing

| Suite | Covers |
|---|---|
| `tools/*.test.mjs` | Allowlist enforcement (a non-allowlisted path fails the build), chunk boundaries and heading paths, BM25 ranking against a fixture corpus, sitemap and slug generation. |
| `functions/api/ask.test.js` | Citation rejection (uncited and out-of-range answers are discarded), cache key derivation and build-hash invalidation, rate-limit bucket arithmetic, every degradation path returns results rather than an error. |
| `assets/js/answer-format.test.js` | Answer parsing: fenced commands kept whole, citation markers extracted, brackets inside inline code not mistaken for citations, markup treated as literal text. |
| `tools/redact.test.mjs` | Private URLs replaced wherever they appear including inside fenced commands, unrelated URLs untouched, and output that escaped redaction failing the build. |
| `tools/build.test.mjs` | Runs the generator and asserts on its output: a page per allowlisted document and no others, no reference to the private repository anywhere, no test file published, assets carrying the current build hash, no unpublished repository file present, `/ask/` disallowed in robots.txt. |

The model call is faked at the `answer()` boundary. No test performs network I/O.

## 12. Migration

Bluehost keeps serving the current site untouched until the last step.

1. Build v2, deploy to `tail-os.pages.dev`, verify.
2. Repoint `tail-os.com` nameservers to Cloudflare.
3. Confirm the live domain, then cancel Bluehost hosting.
4. Keep the domain registered where it is, or transfer to Cloudflare Registrar at renewal.

The `tail-os.com` registration is separate from the Bluehost hosting plan, so step 3
carries no risk to the domain.

`.htaccess` is deleted at cutover. Its clean-URL rewriting is unnecessary because
generated pages are directory-style (`/docs/kernel-design/index.html`), and its security
headers move to `public/_headers`.

## 13. Resolved decisions

| Decision | Resolution |
|---|---|
| Documentation model | AI-first over generated pages; no hand-maintained documentation. |
| Hosting | Cloudflare Pages and Pages Functions. Bluehost retired after cutover. |
| Domain | `tail-os.com` is registered separately from Bluehost hosting; cancelling hosting is safe. |
| Model provider | Gemini Flash free tier, behind the `answer()` interface in §8. No billing enabled anywhere. |
| Quota protection | Answer cache, per-IP limit, and global daily ceiling — all degrading to retrieval results. |
| Initial allowlist | `get_started.md`, `install_rpi3.md`, `install_qemu.md`. |
| Future corpus | A dedicated public-documentation directory in tailos, or a separate public repository; adopted by repointing the source root.
