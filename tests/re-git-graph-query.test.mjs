// The branch filter's log args and normalization, and the find bar's matching,
// against a real throwaway repo. Run: node tests/re-git-graph-query.test.mjs
import * as G from "../mods/re-git-graph/git.js";
import * as Q from "../mods/re-git-graph/query.js";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const env = { ...process.env, GIT_AUTHOR_NAME: "Ada Lovelace", GIT_AUTHOR_EMAIL: "a@a", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const sh = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commit = (cwd, msg, extra = {}) => { writeFileSync(join(cwd, `${msg}.txt`), msg); sh(cwd, "add", "."); execFileSync("git", ["commit", "-qm", msg], { cwd, env: { ...env, ...extra } }); };

const base = mkdtempSync(join(tmpdir(), "re-git-graph-query-")), remote = join(base, "remote.git"), repo = join(base, "repo");
try {
  sh(base, "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "init", "-q", "-b", "main", repo);
  commit(repo, "init"); commit(repo, "Fix Parser crash");
  sh(repo, "checkout", "-qb", "feature"); commit(repo, "f1", { GIT_AUTHOR_NAME: "Grace Hopper" });
  sh(repo, "checkout", "-q", "main"); sh(repo, "checkout", "-qb", "other"); commit(repo, "o1");
  sh(repo, "checkout", "-q", "main"); commit(repo, "m2"); sh(repo, "tag", "release-1");
  sh(repo, "remote", "add", "origin", remote); sh(repo, "push", "-q", "origin", "main");
  sh(repo, "checkout", "-q", "main"); commit(repo, "local-only");

  const subjects = (filter, remotes = true) => {
    const r = spawnSync("git", [...G.READ, ...Q.filterLogArgs(filter, { remotes, limit: 300 })], { cwd: repo, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return G.parseLog(r.stdout).map((c) => c.subject).sort();
  };

  // ---- log args per kind
  assert.deepEqual(subjects(Q.ALL), ["Fix Parser crash", "f1", "init", "local-only", "m2", "o1"].sort(), "all: every branch");
  assert.deepEqual(subjects(Q.CURRENT), ["Fix Parser crash", "init", "local-only", "m2"].sort(), "current: HEAD only");
  assert.deepEqual(subjects({ kind: "refs", refs: ["refs/heads/feature"] }), ["Fix Parser crash", "f1", "init"].sort(), "one branch");
  assert.deepEqual(subjects({ kind: "refs", refs: ["refs/heads/feature", "refs/heads/other"] }), ["Fix Parser crash", "f1", "init", "o1"].sort(), "union of branches");
  assert.deepEqual(subjects({ kind: "refs", refs: ["refs/remotes/origin/main"] }), ["Fix Parser crash", "init", "m2"].sort(), "a remote branch, without main's local commit");
  assert.ok(!Q.filterLogArgs(Q.ALL, { remotes: false, limit: 1 }).includes("refs/remotes/origin/main") && Q.filterLogArgs(Q.ALL, { remotes: false, limit: 1 }).includes("--exclude=refs/remotes/*"), "all keeps the remotes switch");
  const refArgs = Q.filterLogArgs({ kind: "refs", refs: ["refs/heads/feature"] }, { remotes: true, limit: 5 });
  assert.ok(!refArgs.includes("--all") && !refArgs.includes("HEAD") && refArgs.includes("-n5"), "refs replace the scope, keep the rest");

  // ---- normalization
  const existing = sh(repo, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes").split("\n").filter(Boolean);
  assert.deepEqual(Q.normalizeFilter({ kind: "refs", refs: ["refs/heads/feature", "refs/heads/gone"] }, existing), { kind: "refs", refs: ["refs/heads/feature"] }, "a missing branch drops out");
  sh(repo, "branch", "-qD", "other");
  const after = sh(repo, "for-each-ref", "--format=%(refname)", "refs/heads").split("\n").filter(Boolean);
  assert.deepEqual(Q.normalizeFilter({ kind: "refs", refs: ["refs/heads/other"] }, after), Q.ALL, "nothing left: all branches");
  assert.deepEqual(Q.normalizeFilter({ kind: "refs", refs: ["refs/remotes/origin/main"] }, after), Q.ALL, "a hidden remote counts as missing");
  assert.deepEqual(Q.normalizeFilter(undefined, after), Q.ALL);
  assert.deepEqual(Q.normalizeFilter({ kind: "current" }, after), Q.CURRENT);
  assert.deepEqual(Q.normalizeFilter({ kind: "refs", refs: "refs/heads/main" }, after), Q.ALL, "malformed storage is all");

  // ---- toggling and labels
  let f = Q.toggleRef(Q.CURRENT, "refs/heads/main");
  assert.deepEqual(f, { kind: "refs", refs: ["refs/heads/main"] }, "a named branch leaves Current");
  assert.equal(Q.filterLabel(f), "main");
  f = Q.toggleRef(f, "refs/remotes/origin/main");
  assert.equal(Q.filterLabel(f), "2 branches");
  assert.deepEqual(Q.toggleRef(Q.toggleRef(f, "refs/heads/main"), "refs/remotes/origin/main"), Q.ALL, "unpicking the last is All");
  assert.equal(Q.filterLabel(Q.ALL), "All branches"); assert.equal(Q.filterLabel(Q.CURRENT), "Current");

  // ---- find
  const commits = G.withUncommitted(G.parseLog(spawnSync("git", [...G.READ, ...Q.filterLogArgs(Q.ALL, { remotes: true, limit: 300 })], { cwd: repo, env, encoding: "utf8" }).stdout), 1, null);
  const hit = (q) => Q.findMatches(commits, q).map((i) => commits[i].subject).sort();
  assert.deepEqual(hit("parser"), ["Fix Parser crash"], "subject, any case");
  assert.deepEqual(hit("GRACE"), ["f1"], "author name");
  assert.deepEqual(hit("release-"), ["m2"], "tag name");
  assert.deepEqual(hit("origin/ma"), ["m2"], "remote branch name");
  assert.deepEqual(hit("feature"), ["f1"], "local branch name");
  assert.deepEqual(hit("uncommitted"), [], "the uncommitted row never matches");
  assert.deepEqual(hit("  "), [], "blank query: no matches");
  const target = commits.find((c) => c.subject === "f1");
  assert.deepEqual(hit(target.hash.slice(0, 4).toUpperCase()), ["f1", ...commits.filter((c) => c !== target && !c.uncommitted && c.hash.startsWith(target.hash.slice(0, 4))).map((c) => c.subject)].sort(), "hash prefix, any case");
  assert.deepEqual(Q.findMatches([{ ...target, subject: "x", author: "y", refs: [] }], target.hash.slice(0, 3)), [], "under 4 hex chars is no hash match");
  assert.deepEqual(Q.findMatches([{ ...target, subject: "x", author: "y", refs: [] }], target.hash.slice(2, 8)), [], "hash matches from the start only");
  assert.deepEqual(Q.findMatches(commits, "f1").every((i) => i > 0), true, "indices are rows, the uncommitted row at 0");
  console.log("re-git-graph query tests passed");
} finally { rmSync(base, { recursive: true, force: true }); }
