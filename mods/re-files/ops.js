// The right-click menu, its dialogs and the file operations behind them, with
// no Herdr imports: `exec` is passed in, so tests run these on a real folder.
// A target is { kind: "file" | "folder" | "root", rel, name, siblings? } (rel is
// relative to the panel's root, "" for the root); ctx is { root, on }.

export const absPath = (ctx, rel) => (rel ? `${ctx.root}/${rel}` : ctx.root);
export const parentRel = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
export const join = (rel, name) => (rel ? `${rel}/${name}` : name);
// Where New File/Folder go and a terminal opens: the folder itself, or a file's folder.
export const folderOf = (t) => (t.kind === "file" ? parentRel(t.rel) : t.rel);

const entry = (t) => t.kind !== "root";
const local = (_t, ctx) => !ctx.on;
const SEP = { separator: true };

export const MENU = [
  { id: "copy-path", label: "Copy Path", icon: "copy", action: (t, c) => ({ type: "copy", text: absPath(c, t.rel) }) },
  { id: "copy-relative", label: "Copy Relative Path", icon: "copy", when: entry, action: (t) => ({ type: "copy", text: t.rel }) },
  { id: "copy-name", label: "Copy Name", icon: "copy", action: (t) => ({ type: "copy", text: t.name }) },
  { id: "reveal", label: "Reveal in Finder", icon: "search", when: local, action: (t, c) => ({ type: "exec", argv: ["open", "-R", absPath(c, t.rel)] }) },
  { id: "editor", label: "Open in editor", icon: "code", when: local, action: (t, c) => ({ type: "editor", path: absPath(c, t.rel) }) },
  { id: "terminal", label: "Open in Terminal", icon: "terminal", action: (t, c) => ({ type: "tab", folder: absPath(c, folderOf(t)) }) },
  SEP,
  { id: "new-file", label: "New File…", icon: "file-plus", action: () => ({ type: "dialog", kind: "new-file" }) },
  { id: "new-folder", label: "New Folder…", icon: "folder-plus", action: () => ({ type: "dialog", kind: "new-folder" }) },
  { id: "rename", label: "Rename…", icon: "rename", when: entry, action: () => ({ type: "dialog", kind: "rename" }) },
  { id: "duplicate", label: "Duplicate", icon: "duplicate", when: entry, action: () => ({ type: "duplicate" }) },
  SEP,
  { id: "delete", label: "Delete", icon: "trash", danger: true, when: entry, action: () => ({ type: "dialog", kind: "delete" }) },
  SEP,
  { id: "set-editor", label: "Set editor command…", icon: "settings", when: (t, c) => t.kind === "root" && !c.on, action: () => ({ type: "dialog", kind: "editor" }) },
];

// The items for this target, without leading, trailing or doubled separators.
export function menuFor(target, ctx) {
  const out = [];
  for (const item of MENU) {
    if (item.separator) { if (out.length && !out[out.length - 1].separator) out.push(item); continue; }
    if (!item.when || item.when(target, ctx)) out.push(item);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}
export const menuHeight = (items) => 10 + items.reduce((n, i) => n + (i.separator ? 9 : 30), 0);

// What's wrong with a typed file or folder name, or null.
export function nameProblem(name) {
  if (!name.trim()) return "Type a name.";
  if (name.includes("/")) return "A name can't contain /.";
  if (name.includes("\0")) return "A name can't contain a null character.";
  if (name === "." || name === "..") return `"${name}" isn't a usable name.`;
  return null;
}

// "a.txt" -> "a copy.txt", then "a copy 2.txt"…; folders and dotfiles keep the whole name as the stem.
export function copyName(name, dir, taken) {
  const dot = dir ? -1 : name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n > 1 ? ` ${n}` : ""}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function dialogFor(kind, target, ctx, editor) {
  const what = target.kind === "folder" ? "folder" : "file", inside = `Name, in ${folderOf(target) || ctx.root.split("/").pop()}`;
  switch (kind) {
    case "new-file": return { title: "New File", input: { label: inside, value: "" }, confirm: "Create" };
    case "new-folder": return { title: "New Folder", input: { label: inside, value: "" }, confirm: "Create" };
    case "rename": return { title: `Rename ${what}`, input: { label: "New name", value: target.name }, confirm: "Rename" };
    case "delete": return { title: `Move ${what} to Trash`, detail: `Move "${target.rel}" to the Trash?`, confirm: "Move to Trash", danger: true };
    case "editor": return { title: "Editor command", detail: "Open in editor runs this program with the path as its argument.", input: { label: "Command", value: editor }, confirm: "Save" };
    case "leave": return { title: "Unsaved changes", detail: `Save your changes to "${target.name}"?`, confirm: "Save", discard: "Discard" };
    default: return null;
  }
}
export const dialogHeight = (spec) => 36 + (spec.detail ? Math.ceil(spec.detail.length / 52) * 19 + 8 : 0) + (spec.input ? 66 : 0) + 30 + 52 + 26;

const exists = async (path, on, exec) => (await exec("test", ["-e", path], { on })).code === 0;
const ok = (r, what) => (r.code === 0 ? null : (r.stderr || r.stdout).trim() || `${what} failed`);

// Runs a confirmed dialog with the typed value: { ok, message?, reveal? }.
// reveal: the rel path to show in the tree afterwards; open: open it in the preview.
export async function performDialog(kind, value, target, ctx, exec) {
  const on = ctx.on;
  if (kind === "delete") {
    const problem = ok(await exec("/usr/bin/trash", [absPath(ctx, target.rel)], { on }), "Moving to the Trash");
    return problem ? { ok: false, message: problem } : { ok: true, reveal: parentRel(target.rel) };
  }
  const problem = nameProblem(value);
  if (problem) return { ok: false, message: problem };
  const rel = join(kind === "rename" ? parentRel(target.rel) : folderOf(target), value);
  if (kind === "rename" && rel === target.rel) return { ok: true };
  if (await exists(absPath(ctx, rel), on, exec)) return { ok: false, message: `"${value}" already exists there.` };
  const dest = absPath(ctx, rel);
  const argv = kind === "new-file" ? ["touch", dest]
    : kind === "new-folder" ? ["mkdir", dest]
    : ["mv", "-n", absPath(ctx, target.rel), dest];
  const failed = ok(await exec(argv[0], argv.slice(1), { on }), argv[0]);
  return failed ? { ok: false, message: failed } : { ok: true, reveal: rel, open: kind === "new-file" };
}

export async function duplicate(target, ctx, exec) {
  const taken = new Set(target.siblings ?? []), parent = parentRel(target.rel);
  // The tree's list can be capped, so the disk has the last word.
  let name = copyName(target.name, target.kind === "folder", taken);
  while (await exists(absPath(ctx, join(parent, name)), ctx.on, exec)) { taken.add(name); name = copyName(target.name, target.kind === "folder", taken); }
  const rel = join(parent, name);
  const failed = ok(await exec("cp", ["-Rn", absPath(ctx, target.rel), absPath(ctx, rel)], { on: ctx.on }), "Duplicate");
  return failed ? { ok: false, message: failed } : { ok: true, reveal: rel };
}
