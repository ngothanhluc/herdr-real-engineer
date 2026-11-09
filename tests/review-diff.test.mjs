// Tests the review pane's diff parsing on its own: hunk numbering, file
// statuses, binary files, /dev/null paths, split pairing and synthetic adds.
// Run: node tests/review-diff.test.mjs
import assert from "node:assert/strict";
import { parseRows, parsePatch, syntheticAdd, pairRows, diffStat } from "../mods/re-git-graph/review-diff.js";

// ---- hunk numbering
{
  const rows = parseRows([
    "diff --git a/x.txt b/x.txt",
    "index 111..222 100644",
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -10,3 +20,4 @@",
    " one",
    "-two",
    "+TWO",
    "+three",
    " four",
    "\\ No newline at end of file",
  ].join("\n"));
  assert.deepEqual(rows, [
    { kind: "@", old: null, new: null, text: "@@ -10,3 +20,4 @@" },
    { kind: " ", old: 10, new: 20, text: "one" },
    { kind: "-", old: 11, new: null, text: "two" },
    { kind: "+", old: null, new: 21, text: "TWO" },
    { kind: "+", old: null, new: 22, text: "three" },
    { kind: " ", old: 12, new: 23, text: "four" },
  ]);
  assert.deepEqual(parseRows(""), [], "no hunk header, no rows");
  assert.deepEqual(parseRows("--- a/x\n+++ b/x\n"), [], "headers alone are not rows");
}

// ---- caps: 2000 characters per line, 4000 rows
{
  const long = parseRows("@@ -1 +1 @@\n+" + "x".repeat(2500));
  assert.ok(long[1].text.length <= 2000, "a long line is capped at 2000 characters");
  assert.ok(long[1].text.endsWith("…"));

  const many = ["@@ -1,0 +1,4100 @@", ...Array.from({ length: 4100 }, (_x, i) => `+line ${i}`)];
  const rows = parseRows(many.join("\n"));
  assert.equal(rows.length, 4000);
  assert.equal(rows[0].kind, "@");
  assert.equal(rows.at(-1).kind, "+");
  assert.equal(rows.at(-1).new, 3999);
}

// ---- files: modified, added, deleted, renamed, binary, spaces, /dev/null
{
  const patch = [
    "diff --git a/src/a.js b/src/a.js",
    "index 111..222 100644",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1,2 +1,2 @@",
    "-old",
    "+new",
    " same",
    "diff --git a/new.txt b/new.txt",
    "new file mode 100644",
    "index 000..333",
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1,2 @@",
    "+a",
    "+b",
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "index 444..000",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
    "diff --git a/old name.txt b/new name.txt",
    "similarity index 100%",
    "rename from old name.txt",
    "rename to new name.txt",
    "diff --git a/img.png b/img.png",
    "index 555..666 100644",
    "Binary files a/img.png and b/img.png differ",
    "diff --git a/dir/file name.js b/dir/file name.js",
    "--- a/dir/file name.js",
    "+++ b/dir/file name.js",
    "@@ -1 +1 @@",
    "-one",
    "+two",
  ].join("\n");
  const { files } = parsePatch(patch);
  assert.deepEqual(files.map((file) => [file.path, file.status, file.add, file.del, file.binary]), [
    ["src/a.js", "M", 1, 1, false],
    ["new.txt", "A", 2, 0, false],
    ["gone.txt", "D", 0, 1, false],
    ["new name.txt", "R", 0, 0, false],
    ["img.png", "M", 0, 0, true],
    ["dir/file name.js", "M", 1, 1, false],
  ]);
  assert.equal(files[0].rows[0].kind, "@");
  assert.deepEqual(files[4].rows, [], "binary files carry no rows");
  assert.deepEqual(parsePatch(""), { files: [] });
}

// ---- an untracked file has no diff: every line is an addition
{
  const added = syntheticAdd("notes.txt", "one\ntwo\n");
  assert.equal(added.status, "A");
  assert.equal(added.add, 2);
  assert.equal(added.del, 0);
  assert.deepEqual(added.rows, [
    { kind: "+", old: null, new: 1, text: "one" },
    { kind: "+", old: null, new: 2, text: "two" },
  ]);
  assert.deepEqual(syntheticAdd("empty.txt", "").rows, []);
  assert.equal(syntheticAdd("empty.txt", "").add, 0);
  const blank = syntheticAdd("blank.txt", "one\n\n");
  assert.equal(blank.add, 2, "a trailing blank line is a line");
  assert.equal(blank.rows[1].text, "");
  assert.equal(syntheticAdd("image.bin", "a\0b").binary, true);
  assert.deepEqual(syntheticAdd("image.bin", "a\0b").rows, []);
}

// ---- split pairing: runs pair by index, unmatched sides are null
{
  const rows = parseRows([
    "@@ -1,3 +1,4 @@",
    "-a",
    "-b",
    "+A",
    "+B",
    "+C",
    " ctx",
  ].join("\n"));
  const pairs = pairRows(rows);
  assert.equal(pairs.length, 5);
  assert.equal(pairs[0].left, rows[0]);
  assert.equal(pairs[0].right, rows[0], "a hunk header spans both sides");
  assert.equal(pairs[1].left.text, "a");
  assert.equal(pairs[1].right.text, "A");
  assert.equal(pairs[2].left.text, "b");
  assert.equal(pairs[2].right.text, "B");
  assert.equal(pairs[3].left, null);
  assert.equal(pairs[3].right.text, "C");
  assert.equal(pairs[4].left.text, "ctx");
  assert.equal(pairs[4].right.text, "ctx", "context spans both sides");
  assert.equal(pairs[4].left.old, 3);
  assert.equal(pairs[4].right.new, 4);

  const moreRemoved = pairRows(parseRows("@@ -1,2 +1 @@\n-a\n-b\n+A").slice(1));
  assert.equal(moreRemoved.length, 2);
  assert.equal(moreRemoved[1].left.text, "b");
  assert.equal(moreRemoved[1].right, null);

  const pureAdds = pairRows(parseRows("@@ -0,0 +1,2 @@\n+a\n+b").slice(1));
  assert.deepEqual(pureAdds.map((pair) => [pair.left, pair.right?.text]), [[null, "a"], [null, "b"]]);
}

// ---- totals
{
  assert.deepEqual(diffStat([
    { add: 2, del: 1 },
    { add: 5, del: 0 },
    { add: 0, del: 3 },
  ]), { add: 7, del: 4 });
  assert.deepEqual(diffStat([]), { add: 0, del: 0 });
}

console.log("review diff ok");
