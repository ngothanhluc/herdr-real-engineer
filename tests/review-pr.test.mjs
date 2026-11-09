// Tests the review pane's GitHub plumbing on its own: the exact `gh pr view`
// JSON shape, comment/review mapping, caps, and every argv the pane runs.
// Run: node tests/review-pr.test.mjs
import assert from "node:assert/strict";
import { normalizePr, normalizeList, viewArgs, listArgs, diffArgs, reviewArgs, mergeArgs, PR_FIELDS } from "../mods/re-git-graph/review-pr.js";

// ---- the exact gh pr view shape
{
  const json = {
    number: 42,
    title: "Fix the thing",
    body: "Body **markdown**",
    author: { login: "octocat" },
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "fix/thing",
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    mergeStateStatus: "BLOCKED",
    additions: 10,
    deletions: 3,
    changedFiles: 2,
    url: "https://github.com/o/r/pull/42",
    comments: [{ author: { login: "alice" }, body: "Looks close.", createdAt: "2026-01-01T10:00:00Z" }],
    reviews: [{ author: { login: "bob" }, state: "APPROVED", body: "LGTM", submittedAt: "2026-01-02T10:00:00Z" }],
  };
  assert.deepEqual(normalizePr(json), {
    number: 42,
    title: "Fix the thing",
    body: "Body **markdown**",
    author: "octocat",
    state: "OPEN",
    draft: false,
    base: "main",
    head: "fix/thing",
    additions: 10,
    deletions: 3,
    changedFiles: 2,
    url: "https://github.com/o/r/pull/42",
    mergeable: "MERGEABLE",
    decision: "REVIEW_REQUIRED",
    comments: [{ author: "alice", body: "Looks close.", at: "2026-01-01T10:00:00Z" }],
    reviews: [{ author: "bob", state: "APPROVED", body: "LGTM", at: "2026-01-02T10:00:00Z" }],
  });
}

// ---- defaults and caps
{
  const empty = normalizePr({});
  assert.equal(empty.number, null);
  assert.equal(empty.title, "");
  assert.equal(empty.body, "");
  assert.equal(empty.author, null);
  assert.equal(empty.draft, false);
  assert.equal(empty.additions, 0);
  assert.equal(empty.deletions, 0);
  assert.equal(empty.changedFiles, 0);
  assert.equal(empty.mergeable, null);
  assert.equal(empty.decision, null);
  assert.deepEqual(empty.comments, []);
  assert.deepEqual(empty.reviews, []);

  const many = {
    body: "x".repeat(25000),
    comments: Array.from({ length: 60 }, (_x, i) => ({ author: { login: `c${i}` }, body: "hi", createdAt: "t" })),
    reviews: Array.from({ length: 60 }, (_x, i) => ({ author: { login: `r${i}` }, state: "COMMENTED", body: "", submittedAt: "t" })),
  };
  const capped = normalizePr(many);
  assert.equal(capped.body.length, 20000, "markdown bodies are capped");
  assert.equal(capped.comments.length, 50, "comments are capped");
  assert.equal(capped.reviews.length, 50, "reviews are capped");
  assert.equal(capped.comments[0].author, "c0");
  assert.equal(capped.reviews[0].state, "COMMENTED");

  const draft = normalizePr({ isDraft: true, state: "OPEN" });
  assert.equal(draft.draft, true);
}

// ---- gh pr list shape
{
  assert.deepEqual(normalizeList([
    { number: 7, title: "Seven", headRefName: "seven", author: { login: "ann" }, updatedAt: "2026-01-03T00:00:00Z" },
    { number: 8, title: "Eight", headRefName: "eight", author: null, updatedAt: "2026-01-04T00:00:00Z" },
  ]), [
    { number: 7, title: "Seven", head: "seven", author: "ann", updated: "2026-01-03T00:00:00Z" },
    { number: 8, title: "Eight", head: "eight", author: null, updated: "2026-01-04T00:00:00Z" },
  ]);
  assert.deepEqual(normalizeList({}), []);
}

// ---- argv
{
  assert.deepEqual(viewArgs(42), ["pr", "view", "42", "--json", PR_FIELDS]);
  assert.deepEqual(viewArgs(), ["pr", "view", "--json", PR_FIELDS], "no number means the current branch");
  assert.deepEqual(diffArgs(42), ["pr", "diff", "42"]);
  assert.deepEqual(listArgs(30), ["pr", "list", "--json", "number,title,headRefName,author,updatedAt", "--limit", "30"]);
  assert.deepEqual(listArgs(), ["pr", "list", "--json", "number,title,headRefName,author,updatedAt", "--limit", "30"]);
}

// ---- review: all three kinds, and request-changes needs a body
{
  assert.deepEqual(reviewArgs(42, "approve", ""), ["pr", "review", "42", "--approve", "-b", ""]);
  assert.deepEqual(reviewArgs(42, "approve", "Ship it"), ["pr", "review", "42", "--approve", "-b", "Ship it"]);
  assert.deepEqual(reviewArgs(42, "comment", "A note"), ["pr", "review", "42", "--comment", "-b", "A note"]);
  assert.deepEqual(reviewArgs(42, "request-changes", "Please add tests."), ["pr", "review", "42", "--request-changes", "-b", "Please add tests."]);
  assert.throws(() => reviewArgs(42, "request-changes", ""), /body|comment/i);
  assert.throws(() => reviewArgs(42, "request-changes", "   \n "), /body|comment/i);
  assert.throws(() => reviewArgs(42, "nonsense", "x"), /Unknown review kind/);
}

// ---- merge: every method, with and without deleting the branch
{
  assert.deepEqual(mergeArgs(42, "merge", false), ["pr", "merge", "42", "--merge"]);
  assert.deepEqual(mergeArgs(42, "merge", true), ["pr", "merge", "42", "--merge", "--delete-branch"]);
  assert.deepEqual(mergeArgs(42, "squash", false), ["pr", "merge", "42", "--squash"]);
  assert.deepEqual(mergeArgs(42, "squash", true), ["pr", "merge", "42", "--squash", "--delete-branch"]);
  assert.deepEqual(mergeArgs(42, "rebase", false), ["pr", "merge", "42", "--rebase"]);
  assert.deepEqual(mergeArgs(42, "rebase", true), ["pr", "merge", "42", "--rebase", "--delete-branch"]);
  assert.throws(() => mergeArgs(42, "fast-forward", false), /Unknown merge method/);
}

console.log("review pr ok");
