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

// --- stemming ----------------------------------------------------------------
//
// A reader types "installation"; the documents say "installing" and "install".
// Without a common root those are three unrelated terms, and the query that
// happened to pick the wrong form reached 2 chunks where another reached 22.
//
// This is Porter (1980), inline because bm25.mjs is copied verbatim into the
// browser bundle with no bundler, so it cannot take a dependency. A bespoke
// list of suffixes would be smaller and would be wrong at the edges; a named
// algorithm has behaviour a future reader can look up.

function isConsonant(word, i) {
  const letter = word[i];
  if (letter === 'a' || letter === 'e' || letter === 'i' || letter === 'o' || letter === 'u') {
    return false;
  }
  // `y` is a consonant only when what precedes it is not.
  return letter === 'y' ? (i === 0 ? true : !isConsonant(word, i - 1)) : true;
}

// Porter's m: how many vowel-consonant sequences the word contains.
function measure(word) {
  let count = 0;
  let i = 0;
  while (i < word.length && isConsonant(word, i)) i += 1;
  while (i < word.length) {
    while (i < word.length && !isConsonant(word, i)) i += 1;
    if (i >= word.length) break;
    count += 1;
    while (i < word.length && isConsonant(word, i)) i += 1;
  }
  return count;
}

function hasVowel(word) {
  for (let i = 0; i < word.length; i += 1) if (!isConsonant(word, i)) return true;
  return false;
}

function endsDoubleConsonant(word) {
  const n = word.length;
  return n >= 2 && word[n - 1] === word[n - 2] && isConsonant(word, n - 1);
}

// Porter's *o: ends consonant-vowel-consonant, the last not w, x or y.
function endsCvc(word) {
  const n = word.length;
  if (n < 3) return false;
  if (!isConsonant(word, n - 1) || isConsonant(word, n - 2) || !isConsonant(word, n - 3)) return false;
  return !'wxy'.includes(word[n - 1]);
}

const STEP2 = [
  ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'],
  ['izer', 'ize'], ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'],
  ['eli', 'e'], ['ousli', 'ous'], ['ization', 'ize'], ['ation', 'ate'],
  ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'],
  ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'],
];

const STEP3 = [
  ['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'],
  ['ical', 'ic'], ['ful', ''], ['ness', ''],
];

const STEP4 = [
  'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment',
  'ent', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize',
];

function replaceEnding(word, suffix, replacement, minMeasure) {
  if (!word.endsWith(suffix)) return null;
  const stem = word.slice(0, word.length - suffix.length);
  return measure(stem) > minMeasure ? stem + replacement : word;
}

export function stem(term) {
  // Only English words are stemmed. An identifier, a version or a flag is not
  // one, and taking "-ing" off a symbol would leave it unfindable by its own
  // name. Anything holding a digit, underscore, hyphen or dot is left exactly
  // as written, which is also how the search box finds `qemu-system-aarch64`.
  if (!/^[a-z]+$/.test(term) || term.length < 3) return term;

  let word = term;

  // 1a — plurals.
  if (word.endsWith('sses')) word = word.slice(0, -2);
  else if (word.endsWith('ies')) word = word.slice(0, -2);
  else if (word.endsWith('ss')) { /* kept */ }
  else if (word.endsWith('s')) word = word.slice(0, -1);

  // 1b — past and progressive.
  let step1bApplied = false;
  if (word.endsWith('eed')) {
    if (measure(word.slice(0, -3)) > 0) word = word.slice(0, -1);
  } else if (word.endsWith('ed') && hasVowel(word.slice(0, -2))) {
    word = word.slice(0, -2);
    step1bApplied = true;
  } else if (word.endsWith('ing') && hasVowel(word.slice(0, -3))) {
    word = word.slice(0, -3);
    step1bApplied = true;
  }
  if (step1bApplied) {
    if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) word += 'e';
    else if (endsDoubleConsonant(word) && !'lsz'.includes(word[word.length - 1])) {
      word = word.slice(0, -1);
    } else if (measure(word) === 1 && endsCvc(word)) word += 'e';
  }

  // 1c — terminal y becomes i so "safety" and "safeties" agree.
  if (word.endsWith('y') && hasVowel(word.slice(0, -1))) word = `${word.slice(0, -1)}i`;

  // 2 and 3 — nominalisations, the step that makes "installation" reachable.
  for (const [suffix, replacement] of STEP2) {
    const next = replaceEnding(word, suffix, replacement, 0);
    if (next !== null) { word = next; break; }
  }
  for (const [suffix, replacement] of STEP3) {
    const next = replaceEnding(word, suffix, replacement, 0);
    if (next !== null) { word = next; break; }
  }

  // 4 — strip the residue from a word that is long enough to spare it.
  let stripped = false;
  for (const suffix of STEP4) {
    const next = replaceEnding(word, suffix, '', 1);
    if (next !== null) { word = next; stripped = true; break; }
  }
  if (!stripped && (word.endsWith('sion') || word.endsWith('tion'))) {
    const stemPart = word.slice(0, -3);
    if (measure(stemPart) > 1) word = stemPart;
  }

  // 5 — trailing e, and a doubled l.
  if (word.endsWith('e')) {
    const base = word.slice(0, -1);
    const m = measure(base);
    if (m > 1 || (m === 1 && !endsCvc(base))) word = base;
  }
  if (measure(word) > 1 && endsDoubleConsonant(word) && word.endsWith('l')) {
    word = word.slice(0, -1);
  }

  return word;
}

export function tokenize(text) {
  const out = [];
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9_.+#-]+/)) {
    // Trim punctuation that only ever appears as a sentence artefact, but keep
    // it inside a token: "aarch64-elf-gcc" and "v0.9.0" are single terms.
    const term = raw.replace(/^[.+#-]+|[.+#-]+$/g, '');
    if (term.length < 2 || term.length > 40) continue;
    if (STOPWORDS.has(term)) continue;
    out.push(stem(term));
    const alias = COMPOUND_ALIASES.get(term);
    if (alias) out.push(...alias.map(stem));
    // A hyphenated or dotted compound is also indexed by its parts, so
    // "qemu-system-aarch64" answers a search for "aarch64".
    if (/[.\-+]/.test(term)) {
      for (const part of term.split(/[.\-+]+/)) {
        if (part.length >= 2 && part.length <= 40 && !STOPWORDS.has(part)) out.push(stem(part));
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
