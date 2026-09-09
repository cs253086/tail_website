// Ranking shared by three consumers: the generator writes the index, the
// /api/ask Function retrieves against it, and the browser searches the same
// bytes. One implementation means a citation and a search hit can never
// disagree about what the corpus says.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does',
  'for', 'from', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'of', 'on', 'or',
  'that', 'the', 'this', 'to', 'was', 'what', 'when', 'where', 'which', 'who',
  'will', 'with', 'you', 'your',
]);

// The documentation writes the product name both ways — "TAIL OS" in
// get_started.md, "TailOS" in install_qemu.md — and readers type either.
// Expanding the concatenated spelling into its parts, at index and query time
// alike, makes which one they chose irrelevant.
const COMPOUND_ALIASES = new Map([
  ['tailos', ['tail', 'os']],
  ['tail_os', ['tail', 'os']],
]);

const K1 = 1.2;
const B = 0.75;

// A section titled "Run TailOS (one command)" is a far stronger signal of what
// it answers than the same words appearing once in a paragraph. Weighting the
// heading field is the BM25F treatment of that, and it is why a question
// phrased like a section title retrieves that section.
const HEADING_WEIGHT = 3;
const BODY_WEIGHT = 1;

export function tokenize(text) {
  const out = [];
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9_.+#-]+/)) {
    // Trim punctuation that only ever appears as a sentence artefact, but keep
    // it inside a token: "aarch64-elf-gcc" and "v0.9.0" are single terms.
    const term = raw.replace(/^[.+#-]+|[.+#-]+$/g, '');
    if (term.length < 2 || term.length > 40) continue;
    if (STOPWORDS.has(term)) continue;
    out.push(term);
    const alias = COMPOUND_ALIASES.get(term);
    if (alias) out.push(...alias);
    // A hyphenated or dotted compound is also indexed by its parts, so
    // "qemu-system-aarch64" answers a search for "aarch64".
    if (/[.\-+]/.test(term)) {
      for (const part of term.split(/[.\-+]+/)) {
        if (part.length >= 2 && part.length <= 40 && !STOPWORDS.has(part)) out.push(part);
      }
    }
  }
  return out;
}

// Each document is { id, heading, body }; `heading` is optional. Term
// frequencies and document length are both field-weighted, as BM25F requires —
// weighting frequency alone would quietly break length normalisation.
export function buildIndex(documents) {
  const docs = [];
  const postings = Object.create(null);

  documents.forEach((doc, docIndex) => {
    const counts = new Map();
    let length = 0;

    for (const [text, weight] of [[doc.heading, HEADING_WEIGHT], [doc.body, BODY_WEIGHT]]) {
      if (!text) continue;
      for (const term of tokenize(text)) {
        counts.set(term, (counts.get(term) ?? 0) + weight);
        length += weight;
      }
    }

    docs.push({ id: doc.id, len: length });
    for (const [term, tf] of counts) {
      (postings[term] ??= []).push(docIndex, tf);
    }
  });

  const totalLength = docs.reduce((sum, doc) => sum + doc.len, 0);
  return {
    version: 1,
    avgLen: docs.length ? totalLength / docs.length : 0,
    docs,
    postings,
  };
}

export function search(index, query, limit = 10) {
  const queryTerms = tokenize(query);
  if (!queryTerms.length || !index.docs.length) return [];

  const N = index.docs.length;
  const scores = new Map();

  for (const term of new Set(queryTerms)) {
    const posting = index.postings[term];
    if (!posting) continue;

    const df = posting.length / 2;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

    for (let i = 0; i < posting.length; i += 2) {
      const docIndex = posting[i];
      const tf = posting[i + 1];
      const len = index.docs[docIndex].len;
      const norm = tf + K1 * (1 - B + (B * len) / (index.avgLen || 1));
      scores.set(docIndex, (scores.get(docIndex) ?? 0) + idf * ((tf * (K1 + 1)) / norm));
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([docIndex, score]) => ({ id: index.docs[docIndex].id, score }));
}
