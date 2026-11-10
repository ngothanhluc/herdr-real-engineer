// The diff model: paired rows, split or inline, wrapped or scrolled, and the
// two things a side-by-side view needs that a unified one does not — a filler
// where a replaced line has no partner, and the words that actually changed
// inside a replaced line. Pure: no Herdr imports, so node can check it.

import { pairRows } from "./review-diff.js";

export const ROW = 20;
export const NUM = 36;
export const SIGN = 12;
export const PAD = 12;
export const DIVIDER = 1;

// The width a pane needs before two columns beat one.
export const BREAKPOINT = 900;

export const MODE_KEY = "re-git-graph.diffLayout";
export const WRAP_KEY = "re-git-graph.diffWrap";
export const LAYOUTS = ["auto", "split", "inline"];

// JetBrains Mono advances 0.6 of its size; Herdr reports the size in
// settings().font_size, so the columns a pane holds come from the real font
// rather than a constant that drifts when someone zooms.
export function charWidth(fontSize) {
  const size = Number(fontSize) > 0 ? Number(fontSize) : 13.5;
  return Math.round(size * 60) / 100;
}

export function resolveMode(layout, width) {
  if (layout === "split" || layout === "inline") return layout;
  return width >= BREAKPOINT ? "split" : "inline";
}

export function nextLayout(layout) {
  return LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length] ?? "auto";
}

const isSpan = (row) => Boolean(row) && (row.kind === "@" || (row.kind === " " && row.old == null && row.new == null));

// The changed part of a replaced line: what is left after the shared head and
// tail come off. Both sides, since a line can shrink as well as grow.
export function hotRange(before, after) {
  const a = String(before ?? ""), b = String(after ?? "");
  if (!a || !b) return [null, null];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const left = [head, a.length - tail], right = [head, b.length - tail];
  return [left[1] > left[0] ? left : null, right[1] > right[0] ? right : null];
}

// One line's text as the segments its column width holds, with the changed
// range clamped into the segment it lands on.
export function wrapText(text, columns, hot) {
  const body = String(text ?? "");
  if (!Number.isFinite(columns) || columns <= 0 || body.length <= columns) return [{ text: body, hot: hot ?? null }];
  const out = [];
  for (let start = 0; start < body.length; start += columns) {
    const piece = body.slice(start, start + columns);
    const inside = hot && hot[1] > start && hot[0] < start + columns
      ? [Math.max(0, hot[0] - start), Math.min(piece.length, hot[1] - start)]
      : null;
    out.push({ text: piece, hot: inside && inside[1] > inside[0] ? inside : null });
  }
  return out;
}

// The columns each side holds, given the pane's width.
export function columnsFor(mode, width, cw) {
  const inner = Math.max(0, (width || 0) - PAD * 2);
  const side = mode === "split" ? Math.max(0, (inner - DIVIDER) / 2) : inner;
  return Math.max(8, Math.floor(Math.max(0, side - NUM - SIGN) / (cw || 8)));
}

const side = (row, leftSide, hot, wrap, columns) => {
  if (!row) return null;
  const number = row.old != null || row.new != null ? String((leftSide ? row.old : row.new) ?? "") : "";
  const out = wrapText(row.text, wrap ? columns : null, hot);
  return {
    kind: row.kind,
    number,
    sign: row.kind === "+" ? "+" : row.kind === "-" ? "−" : " ",
    lines: out,
  };
};

// items: one per visual line, so a virtual list keeps its single row height.
// { kind: "span", text } spans both columns (a hunk header, git's no-newline
// note); { kind: "line", split, sides } holds one side per column, where a
// missing side either continues a wrapped line (null) or is filler (fill).
export function buildView({ rows = [], mode = "inline", width = 0, cw = 8.1, wrap = false }) {
  const split = mode === "split";
  const columns = columnsFor(mode, width, cw);
  const items = [];
  let widest = { left: 0, right: 0 };

  const note = (row) => {
    items.push({ kind: "span", text: row.text });
  };

  const cell = (own, k) => {
    if (!own) return k === 0 ? { fill: true } : null;
    const line = own.lines[k];
    if (!line) return null;
    return { kind: own.kind, number: k === 0 ? own.number : "", sign: k === 0 ? own.sign : " ",
      text: line.text, hot: line.hot };
  };

  const push = (left, right) => {
    const count = Math.max(left?.lines.length ?? 0, right?.lines.length ?? 0, 1);
    for (let k = 0; k < count; k++) {
      items.push({ kind: "line", split, sides: split ? [cell(left, k), cell(right, k)] : [cell(left, 0), null] });
    }
  };

  const measure = (row) => {
    if (!row) return;
    const length = String(row.text ?? "").length;
    if (row.kind !== "+" && row.kind !== "-") { widest.left = Math.max(widest.left, length); widest.right = Math.max(widest.right, length); }
    else if (row.kind === "-") widest.left = Math.max(widest.left, length);
    else widest.right = Math.max(widest.right, length);
  };

  if (!split) {
    for (const row of rows) {
      if (isSpan(row)) { note(row); continue; }
      const one = side(row, true, null, wrap, columns);
      if (one) widest.left = Math.max(widest.left, String(row.text ?? "").length);
      const count = Math.max(one?.lines.length ?? 0, 1);
      for (let k = 0; k < count; k++) items.push({ kind: "line", split: false, sides: [cell(one, k), null] });
    }
  } else {
    for (const pair of pairRows(rows)) {
      if (isSpan(pair.left)) { note(pair.left); continue; }
      const [leftHot, rightHot] = pair.left && pair.right && pair.left.kind === "-" && pair.right.kind === "+"
        ? hotRange(pair.left.text, pair.right.text) : [null, null];
      measure(pair.left);
      measure(pair.right);
      push(side(pair.left, true, leftHot, wrap, columns), side(pair.right, false, rightHot, wrap, columns));
    }
  }

  // What one side needs to hold its longest line. Both columns take the wider
  // of the two, so they stay equal and a long line is reached by scrolling
  // rather than by losing its tail to the cell edge.
  const sideWidth = NUM + SIGN + Math.ceil(Math.max(split ? Math.max(widest.left, widest.right) : widest.left, 1) * cw);
  const content = PAD * 2 + sideWidth + (split ? DIVIDER + sideWidth : 0);
  return { mode, split, columns, items, sideWidth, contentWidth: Math.max(320, content) };
}

// The width a window needs to hold both columns at their longest line, kept
// between the breakpoint and 1600 so one huge line still fits on a laptop.
export function windowWidth(rows, cw = 8.1) {
  const { sideWidth } = buildView({ rows, mode: "split", width: 100000, cw });
  return Math.max(BREAKPOINT, Math.min(1600, Math.round(PAD * 2 + 2 * sideWidth + DIVIDER + 16)));
}
