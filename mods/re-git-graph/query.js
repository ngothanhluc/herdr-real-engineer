// What the graph is asked for, with no herdr imports so node can test it: the
// branch filter (which refs `git log` starts from) and the find bar's matches.
import { logArgs } from "./git.js";

// A filter is { kind: "all" } | { kind: "current" } | { kind: "refs", refs: [full ref names] }.
export const ALL = { kind: "all" };
export const CURRENT = { kind: "current" };
export const FIND_MAX = 2000;

export const shortRef = (ref) => ref.replace(/^refs\/(heads|remotes)\//, "");

export function filterLogArgs(filter, { remotes, limit }) {
  return logArgs({ all: filter.kind === "all", remotes, limit, refs: filter.kind === "refs" ? filter.refs : undefined });
}

// A stored filter against the refs that exist (and show): gone refs drop out
// silently, and a selection left empty is all branches again.
export function normalizeFilter(stored, refs) {
  if (stored?.kind === "current") return CURRENT;
  if (stored?.kind !== "refs" || !Array.isArray(stored.refs)) return ALL;
  const kept = stored.refs.filter((r) => refs.includes(r));
  return kept.length ? { kind: "refs", refs: kept } : ALL;
}

export const sameFilter = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function filterLabel(filter) {
  if (filter.kind === "current") return "Current";
  if (filter.kind !== "refs") return "All branches";
  return filter.refs.length === 1 ? shortRef(filter.refs[0]) : `${filter.refs.length} branches`;
}

// Picking a named branch leaves All/Current; unpicking the last goes back to All.
export function toggleRef(filter, ref) {
  const refs = filter.kind === "refs" ? filter.refs : [];
  const next = refs.includes(ref) ? refs.filter((r) => r !== ref) : [...refs, ref];
  return next.length ? { kind: "refs", refs: next } : ALL;
}

// Row indices whose subject, author, ref name or hash (a prefix of 4+ hex) holds the query, any case.
export function findMatches(commits, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hex = /^[0-9a-f]{4,}$/.test(q);
  const matches = [];
  commits.forEach((c, i) => {
    if (c.uncommitted) return;
    if (c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q)
      || c.refs.some((r) => r.name.toLowerCase().includes(q)) || (hex && c.hash.startsWith(q))) matches.push(i);
  });
  return matches;
}
