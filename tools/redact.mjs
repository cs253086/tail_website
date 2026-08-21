// Some published documents were written assuming the repository is public.
// The allowlist decides which files may be published; these rules decide what
// inside them may not be — a private clone URL stays private even when the
// document that mentions it is public.
//
// Redaction runs on the markdown before rendering, so it catches a URL whether
// it appears as a link, as bare text, or inside a fenced command.

export function compileRules(rules = []) {
  return rules.map((rule) => ({
    pattern: new RegExp(rule.pattern, 'g'),
    replacement: rule.replacement,
    label: rule.label ?? rule.pattern,
  }));
}

export function redact(text, rules) {
  const hits = [];
  let out = String(text);

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, (match) => {
      hits.push({ label: rule.label, match });
      return rule.replacement;
    });
  }

  return { text: out, hits };
}

// The guarantee, not the intent: rendering happens after redaction, so anything
// still matching here escaped the rules and the build must stop rather than
// publish it.
export function assertRedacted(html, rules, where) {
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(html);
    if (match) {
      throw new Error(`redaction escaped into ${where}: ${match[0]}`);
    }
  }
}
