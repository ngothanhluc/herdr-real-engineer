// The Config tab's data: this repository's `user.name` and `user.email`, and
// the pairs you have used before. Pure, so the tests run them under Node.

// Where the pairs live in shared.json, and the stamp a write moves so the tab
// reads the folder again.
export const IDENTITY_STORE = "re-git-graph.identities";
export const IDENTITY_STAMP = "re-git-graph.identity";

export const SCOPE_LABEL = { worktree: "Worktree", local: "Local", global: "Global", system: "System", command: "Command" };

// The most pairs kept; the least recently used fall off the end.
export const MAX_PAIRS = 12;

const asKey = (key) => (key === "user.name" ? "name" : key === "user.email" ? "email" : null);
const text = (value) => String(value ?? "").trim();

// `git config --list -z --show-scope`, filtered to the two identity keys. Each
// record is `scope\0key\nvalue\0`. Git lists the most specific scope last, so
// the last value for a key is the one it would use.
export function parseIdentityZ(stdout) {
  const found = {};
  const parts = String(stdout ?? "").split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i], pair = parts[i + 1];
    const cut = pair.indexOf("\n");
    const which = asKey(cut < 0 ? pair : pair.slice(0, cut));
    if (!which) continue;
    found[which] = { value: cut < 0 ? "" : pair.slice(cut + 1), scope };
  }
  return found;
}

export function asPair(value) {
  const name = text(value?.name), email = text(value?.email);
  return name || email ? { name, email } : null;
}

export function samePair(a, b) {
  return Boolean(a && b) && text(a.name) === text(b.name) && text(a.email).toLowerCase() === text(b.email).toLowerCase();
}

// A stored list as pairs, repaired: strings trimmed, junk dropped, duplicates
// and extras past MAX_PAIRS removed.
export function pairsOf(value) {
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const pair = asPair(raw);
    if (pair && !out.some((seen) => samePair(seen, pair))) out.push(pair);
    if (out.length === MAX_PAIRS) break;
  }
  return out;
}

// The pair first, then the rest, so the picker reads newest first.
export function rememberPair(value, pair) {
  const next = asPair(pair);
  return next ? pairsOf([next, ...pairsOf(value)]) : pairsOf(value);
}
