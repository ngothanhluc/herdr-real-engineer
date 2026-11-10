// The diff model: which layout a width earns, where a wrapped line splits,
// which words changed inside a replaced line, and the filler that keeps two
// columns aligned.
import assert from "node:assert/strict";
import { parseRows, pairRows } from "../mods/re-git-graph/review-diff.js";
import { buildView, wrapText, hotRange, resolveMode, charWidth, columnsFor, nextLayout, windowWidth,
  ROW, NUM, SIGN, PAD, DIVIDER, BREAKPOINT } from "../mods/re-git-graph/diff-view.js";

const patch = [
  "@@ -10,3 +10,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 22;",
  "+const c = 3;",
  " const d = 4;",
].join("\n");
const rows = parseRows(patch);

// ---- names and numbers

assert.equal(BREAKPOINT, 900);
assert.equal(resolveMode("auto", 899), "inline");
assert.equal(resolveMode("auto", 900), "split");
assert.equal(resolveMode("split", 300), "split", "a person's choice beats the width");
assert.equal(resolveMode("inline", 1600), "inline");
assert.equal(nextLayout("auto"), "split");
assert.equal(nextLayout("inline"), "auto", "three states cycle back to automatic");

assert.equal(charWidth(13.5), 8.1, "JetBrains Mono advances 0.6 of its size");
assert.equal(charWidth(13), 7.8);
assert.equal(charWidth(undefined), 8.1, "a missing size falls back to the default font");

// A solved width does not depend on the font fitting: the columns come from it.
assert.equal(NUM, 36); assert.equal(SIGN, 12); assert.equal(PAD, 12); assert.equal(DIVIDER, 1);
assert.equal(columnsFor("split", 900, 8.1), 48, "two sides of 48 columns fit 900px");
assert.equal(columnsFor("split", 368, 8.1), 15, "the 368px panel cannot hold a side-by-side view");
assert.equal(columnsFor("inline", 900, 8.1), 102);

// ---- replaced lines: only the changed words

assert.deepEqual(hotRange("const b = 2;", "const b = 22;"), [null, [11, 12]]);
assert.deepEqual(hotRange("a = 1", "a = 2"), [[4, 5], [4, 5]], "a one-character swap marks both sides");
assert.deepEqual(hotRange("abcdef", "abcxef"), [[3, 4], [3, 4]], "both sides lose the same middle");
assert.deepEqual(hotRange("same", "same"), [null, null], "an unchanged line has no hot range");
assert.deepEqual(hotRange("", "x"), [null, null]);

// ---- wrapping

assert.deepEqual(wrapText("abcdefghij", 4), [{ text: "abcd", hot: null }, { text: "efgh", hot: null }, { text: "ij", hot: null }]);
assert.deepEqual(wrapText("short", 10), [{ text: "short", hot: null }]);
assert.deepEqual(wrapText("", 4), [{ text: "", hot: null }], "an empty line is still one row");
assert.deepEqual(wrapText("xxxxxxxxxx", 4, [3, 6]),
  [{ text: "xxxx", hot: [3, 4] }, { text: "xxxx", hot: [0, 2] }, { text: "xx", hot: null }],
  "a hot range is clamped into each segment");

// ---- a split view of a real hunk

const split = buildView({ rows, mode: "split", width: 900, cw: 8.1 });
assert.equal(split.mode, "split");
assert.equal(split.items[0].kind, "span", "the hunk header spans both columns");
assert.equal(split.items[1].sides[0].text, "const a = 1;");
assert.equal(split.items[1].sides[1].text, "const a = 1;", "a context line shows on both sides");
assert.equal(split.items[2].sides[0].sign, "−");
assert.equal(split.items[2].sides[1].sign, "+");
assert.deepEqual(split.items[2].sides[1].hot, [11, 12], "the added character is marked");
assert.equal(split.items[3].sides[0].fill, true, "an unpaired addition leaves a filler on the left");
assert.equal(split.items[3].sides[1].text, "const c = 3;");

// Every line item carries exactly two cells, so a row is one visual line.
for (const item of split.items) if (item.kind === "line") assert.equal(item.sides.length, 2);

// ---- wrapped pairs keep their rows aligned

{
  const long = parseRows([ "@@ -1 +1 @@", `-${"a".repeat(30)}`, "+short" ].join("\n"));
  const view = buildView({ rows: long, mode: "split", width: 400, cw: 8.1, wrap: true });
  const lines = view.items.filter((item) => item.kind === "line");
  assert.ok(view.columns < 30, "the narrow view wraps the long line");
  assert.equal(lines.length, Math.ceil(30 / view.columns), "the pair is as tall as its longer side");
  assert.equal(lines[0].sides[1].text, "short");
  for (const line of lines.slice(1)) assert.equal(line.sides[1], null, "the shorter side stays blank, not filler");
  assert.equal(lines[0].sides[0].number, "1", "the number sits on the first visual line only");
  assert.equal(lines[1].sides[0].number, "");
}

// ---- an inline view keeps a row per line and grows sideways

const inline = buildView({ rows, mode: "inline", width: 900, cw: 8.1 });
assert.equal(inline.items.length, 1 + 5, "a hunk header plus five rows");
assert.equal(inline.items[2].split, false);
assert.equal(inline.items[2].sides[1], null);
assert.equal(inline.items[2].sides[0].sign, "−");

const wide = buildView({ rows: parseRows([ "@@ -1 +1 @@", `-${"x".repeat(200)}` ].join("\n")), mode: "inline", width: 900, cw: 8.1 });
assert.equal(wide.items.length, 2, "without wrapping a long line is still one row");
assert.ok(wide.contentWidth > 900, "the scroll width holds a line past the pane");

// ---- one side's width, and the content width a split view asks for

{
  const long = parseRows([ "@@ -1 +1 @@", `-${"z".repeat(120)}`, "+short" ].join("\n"));
  const view = buildView({ rows: long, mode: "split", width: 1200, cw: 8.1 });
  assert.equal(view.sideWidth, NUM + SIGN + Math.ceil(120 * 8.1), "a side is as wide as its longest line");
  assert.equal(view.contentWidth, PAD * 2 + view.sideWidth + DIVIDER + view.sideWidth, "both columns take that width");
  assert.equal(view.columns, columnsFor("split", 1200, 8.1), "the drawn columns still come from the pane");
}

// ---- window sizing

assert.equal(windowWidth(rows, 8.1), BREAKPOINT, "a short diff opens at the breakpoint, not smaller");
const longRows = parseRows([ "@@ -1 +1 @@", `-${"y".repeat(400)}` ].join("\n"));
assert.equal(windowWidth(longRows, 8.1), 1600, "a very long line caps the window");

// ---- one visual line per row

assert.equal(ROW, 20, "one visual line is one row of the list");

console.log("diff view ok");
