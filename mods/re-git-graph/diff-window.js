// One file's diff in a window of its own, for the width two columns need. The
// panel opens it for the review tab and for a commit's file, so a PR's change
// and an uncommitted one are read the same way. Alt+Z wraps the long lines;
// "s" cycles auto, split and inline. The drawing itself is diff-render's.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, settings, exec, readTextFile, shared, setShared } from "herdr";
import { parsePatch, syntheticAdd } from "./review-diff.js";
import { diffArgs, READ } from "./git.js";
import { buildView, resolveMode, nextLayout, charWidth, MODE_KEY, WRAP_KEY } from "./diff-view.js";
import { diffList, diffChip } from "./diff-render.js";
import { openInFiles } from "./file-open.js";

const lines = (text) => String(text ?? "").split("\n").map((line) => line.trimEnd()).filter(Boolean);

function gitError(result) {
  return lines(result?.stderr || result?.stdout).slice(-6).join("\n") || `git exited with ${result?.code ?? "?"}`;
}

// A commit, the worktree, a branch or a pull request: the same four reads the
// review tab makes, so the window never shows a different patch from the panel.
async function load({ source, root, on, path, commit, base, hasHead, pr, fresh }) {
  if (source === "pr") {
    const result = await exec("gh", ["pr", "diff", String(pr)], { cwd: root, on });
    if (result.code !== 0) throw new Error(gitError(result));
    const found = parsePatch(result.stdout).files.find((file) => file.path === path);
    if (!found) throw new Error("This file is no longer in the pull request.");
    return found;
  }
  if (source === "commit" || (source === "uncommitted" && !fresh)) {
    const result = await exec("git", [...READ, ...diffArgs(commit, path)], { cwd: root, on });
    if (result.code !== 0) throw new Error(gitError(result));
    return parsePatch(result.stdout).files[0] ?? null;
  }
  if (fresh) {
    let text;
    try { text = await readTextFile(`${root}/${path}`, { on }); }
    catch { throw new Error("Cannot preview this file (binary, too large, or unreadable)."); }
    if (text === null) throw new Error("This file is no longer available.");
    if (text.includes("\0")) return { path, status: "A", add: 0, del: 0, binary: true, rows: [] };
    return syntheticAdd(path, text);
  }
  const opts = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
  const range = source === "branch" ? [`${base}...HEAD`] : hasHead ? ["HEAD"] : ["--cached"];
  let result = await exec("git", [...READ, ...opts, ...range, "--", path], { cwd: root, on });
  if (result.code !== 0) throw new Error(gitError(result));
  if (source === "worktree" && !hasHead && !result.stdout.trim()) {
    const unstaged = await exec("git", [...READ, ...opts, "--", path], { cwd: root, on });
    if (unstaged.code === 0) result = unstaged;
  }
  return parsePatch(result.stdout).files[0] ?? null;
}

export default class DiffWindow extends View {
  // The host calls init(props, cx) for a view it builds itself; the mod calls
  // init(cx) for one it makes in its own init. Both land here once.
  init(first, second) {
    const cx = second ?? first;
    const p = props() ?? {};
    if (this.handle) return;
    this.source = p.source ?? "worktree";
    this.path = p.path ?? "";
    this.root = p.root ?? null;
    this.cwd = p.cwd ?? null;
    this.on = p.on ?? null;
    this.commit = p.commit ?? null;
    this.base = p.base ?? null;
    this.hasHead = Boolean(p.hasHead);
    this.pr = p.pr ?? null;
    this.fresh = Boolean(p.fresh);

    this.layout = ["auto", "split", "inline"].includes(shared(MODE_KEY)) ? shared(MODE_KEY) : "auto";
    this.wrap = shared(WRAP_KEY) === true;
    this.width = 0;
    this.rows = null;
    this.entry = null;
    this.error = null;
    this.built = null;
    this.loading = true;
    this.handle = cx.focus_handle();
    this.handle.focus();

    const { source, root, on, path, commit, base, hasHead, pr, fresh } = this;
    cx.spawn(async (cx) => {
      try {
        const entry = await load({ source, root, on, path, commit, base, hasHead, pr, fresh });
        this.entry = entry;
        this.rows = entry?.rows ?? [];
      } catch (error) {
        this.error = String(error?.message ?? error).trim() || "Cannot read this diff.";
        this.rows = [];
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  cycleLayout(cx) {
    this.layout = nextLayout(this.layout);
    setShared(MODE_KEY, this.layout);
    cx.notify();
  }

  toggleWrap(cx) {
    this.wrap = !this.wrap;
    setShared(WRAP_KEY, this.wrap);
    cx.notify();
  }

  view() {
    const width = this.width || 1200;
    const mode = resolveMode(this.layout, width);
    const key = `${mode}|${Math.round(width)}|${this.wrap}|${this.rows?.length ?? 0}`;
    if (this.built?.key === key) return this.built.view;
    const view = buildView({ rows: this.rows ?? [], mode, width, cw: charWidth(settings().font_size), wrap: this.wrap });
    this.built = { key, view };
    return view;
  }

  onKey(event, cx) {
    if (event.key === "escape") { this.close(); cx.stop_propagation(); return; }
    if (event.key === "z" && event.modifiers?.alt) { this.toggleWrap(cx); cx.stop_propagation(); return; }
    if (event.key === "s" && !(event.modifiers?.platform || event.modifiers?.control || event.modifiers?.alt)) {
      this.cycleLayout(cx);
      cx.stop_propagation();
    }
  }

  render(cx) {
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const view = this.view();
    const layout = this.layout === "auto" ? `AUTO · ${view.mode.toUpperCase()}` : this.layout.toUpperCase();
    const id = "re-git-graph-diffwindow";
    const header = h_flex().h(34).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().flex_1().min_w(0).truncate().font_family(mono).text_size(11.5).text_color(t.foreground).child(this.path))
      .when(Boolean(this.entry) && !this.entry.binary, (e) => e
        .child(div().text_size(11).text_color(t.ansi2).child(`+${this.entry.add ?? 0}`))
        .child(div().text_size(11).text_color(t.ansi1).child(`−${this.entry.del ?? 0}`)))
      .child(diffChip("re-diff-layout", layout, view.mode === "split", (_e, cx) => this.cycleLayout(cx), t, 0))
      .child(diffChip("re-diff-wrap", this.wrap ? "WRAP" : "NO WRAP", this.wrap, (_e, cx) => this.toggleWrap(cx), t, 0))
      .child(diffChip("re-diff-open", "OPEN FILE", false,
        () => openInFiles({ root: this.root, base: this.cwd, path: this.path, key: "re-files.changed" }), t, 0))
      .child(div().id("re-diff-close").h(22).px(9).flex_none().flex().items_center().rounded(6).border_1().border_color(t.border)
        .text_size(13).text_color(t.muted).cursor_pointer().tooltip("Close · esc")
        .hover((e) => e.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("×"));

    const body = div().flex_1().min_h(0).relative()
      .when(Boolean(this.error), (e) => e.child(div().p(14).text_size(12).text_color(t.ansi1).child(this.error)))
      .when(!this.error && this.loading, (e) => e.child(div().p(14).text_size(12).text_color(t.dim).child("Loading diff…")))
      .when(!this.error && !this.loading && view.items.length === 0, (e) => e.child(div().p(14).text_size(12).text_color(t.dim)
        .child(this.entry?.binary ? "Binary file · no text diff" : "No text changes")))
      .when(!this.error && !this.loading && view.items.length > 0, (e) => e
        .child(diffList({ view, wrap: this.wrap, width: this.width || 1200, id, t, mono })));

    return v_flex().size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .border_1().border_color(t.border).track_focus(this.handle)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); }
      })
      .child(header)
      .child(body)
      .child(h_flex().h(20).flex_none().px(10).gap(10).items_center().border_t(1).border_color(t.border).bg(t.chrome)
        .child(div().text_size(10).text_color(t.dim).child(this.wrap ? "wrapped · alt+z for one line per row" : "alt+z wraps long lines"))
        .child(div().text_size(10).text_color(t.dim).child(`· s layout · ${view.columns} cols${view.split ? " a side" : ""} · esc`)));
  }
}
