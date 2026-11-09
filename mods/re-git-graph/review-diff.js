// Unified diff parsing for the review pane. Pure: no herdr imports, so the
// numbering, file statuses and split pairing can be tested on their own.

const MAX_LINE = 2000;
const MAX_ROWS = 4000;

function clip(line) {
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE) + "…" : line;
}

function stripPrefix(value, prefix) {
  if (!value) return null;
  if (value === "/dev/null") return null;
  let path = value;
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  if (path.startsWith(prefix)) path = path.slice(prefix.length);
  return path || null;
}

// Numbers each diff line once, the way git lays a hunk out. Rows before the
// first `@@` (file headers, index lines) are not diff rows and are dropped.
export function parseRows(hunkText) {
  const all = String(hunkText ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const first = all.findIndex((line) => line.startsWith("@@"));
  if (first < 0) return [];
  const rows = [];
  let old = 0, next = 0;
  for (let i = first; i < all.length && rows.length < MAX_ROWS; i++) {
    const line = clip(all[i]);
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (m) {
      old = +m[1]; next = +m[2];
      rows.push({ kind: "@", old: null, new: null, text: line });
      continue;
    }
    const kind = line[0];
    if (kind === "-") rows.push({ kind, old: old++, new: null, text: line.slice(1) || " " });
    else if (kind === "+") rows.push({ kind, old: null, new: next++, text: line.slice(1) || " " });
    else if (kind === " ") rows.push({ kind, old: old++, new: next++, text: line.slice(1) || " " });
    // "\ No newline at end of file" and anything else is not a row.
  }
  return rows;
}

function fileEntry(lines) {
  const binaryLine = lines.find((line) => line.startsWith("Binary files ") && line.trimEnd().endsWith(" differ"));
  const binary = Boolean(binaryLine);
  const plus = lines.find((line) => line.startsWith("+++ "));
  const minus = lines.find((line) => line.startsWith("--- "));
  const renameFrom = lines.find((line) => line.startsWith("rename from "));
  const renameTo = lines.find((line) => line.startsWith("rename to "));
  const status = lines.some((line) => line.startsWith("new file mode")) ? "A"
    : lines.some((line) => line.startsWith("deleted file mode")) ? "D"
      : renameFrom || renameTo ? "R"
        : "M";
  let binaryPath = null;
  if (binaryLine) {
    const m = /^Binary files (.*) and (.*) differ$/.exec(binaryLine);
    if (m) binaryPath = stripPrefix(m[2], "b/") ?? stripPrefix(m[1], "a/");
  }
  let headerPath = null;
  const header = lines.find((line) => line.startsWith("diff --git "));
  if (header) {
    const rest = header.slice("diff --git ".length);
    const at = rest.lastIndexOf(" b/");
    if (at >= 0) headerPath = stripPrefix(rest.slice(at + 1), "b/");
  }
  const path = status === "R" ? stripPrefix(renameTo?.slice("rename to ".length), "")
    : status === "D" ? stripPrefix(minus?.slice("--- ".length), "a/")
      : stripPrefix(plus?.slice("+++ ".length), "b/")
        ?? stripPrefix(minus?.slice("--- ".length), "a/")
        ?? binaryPath
        ?? headerPath;
  const rows = binary ? [] : parseRows(lines.join("\n"));
  return {
    path: path ?? "",
    status,
    add: rows.reduce((n, row) => n + (row.kind === "+" ? 1 : 0), 0),
    del: rows.reduce((n, row) => n + (row.kind === "-" ? 1 : 0), 0),
    binary,
    rows,
  };
}

// Splits a `git diff` / `gh pr diff` patch into one entry per file.
export function parsePatch(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith("diff --git ")) starts.push(i);
  return { files: starts.map((start, k) => fileEntry(lines.slice(start, starts[k + 1] ?? lines.length))) };
}

// An untracked file has no diff to ask git for: every line is an addition.
export function syntheticAdd(path, text) {
  const src = String(text ?? "").replace(/\r\n/g, "\n");
  if (src.includes("\0")) return { path, status: "A", add: 0, del: 0, binary: true, rows: [] };
  if (src === "") return { path, status: "A", add: 0, del: 0, binary: false, rows: [] };
  const lines = src.replace(/\n$/, "").split("\n");
  const rows = [];
  for (let i = 0; i < lines.length && rows.length < MAX_ROWS; i++) {
    rows.push({ kind: "+", old: null, new: i + 1, text: clip(lines[i]) });
  }
  return { path, status: "A", add: rows.length, del: 0, binary: false, rows };
}

// A split view pairs a run of removed lines with the run of added lines after
// it, by index. A side with nothing left over is null.
export function pairRows(rows) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === "@" || row.kind === " ") {
      out.push({ left: row, right: row });
      i++;
      continue;
    }
    if (row.kind === "-") {
      const left = [];
      while (i < rows.length && rows[i].kind === "-") left.push(rows[i++]);
      const right = [];
      while (i < rows.length && rows[i].kind === "+") right.push(rows[i++]);
      for (let k = 0; k < Math.max(left.length, right.length); k++) {
        out.push({ left: left[k] ?? null, right: right[k] ?? null });
      }
      continue;
    }
    if (row.kind === "+") {
      const right = [];
      while (i < rows.length && rows[i].kind === "+") right.push(rows[i++]);
      for (const added of right) out.push({ left: null, right: added });
      continue;
    }
    i++;
  }
  return out;
}

export function diffStat(files) {
  return (files ?? []).reduce((sum, file) => ({ add: sum.add + (file.add ?? 0), del: sum.del + (file.del ?? 0) }), { add: 0, del: 0 });
}
