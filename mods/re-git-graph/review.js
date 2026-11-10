// The review pane: local Changes (worktree, or branch against its base) and a
// real GitHub Pull request through the gh CLI. Opened as a pane by a keybind;
// it draws its own dialogs so focus and state never leave the pane.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView, Textarea, TextareaState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, shared, setShared, openOverlay } from "herdr";
import { parseRows, parsePatch, syntheticAdd } from "./review-diff.js";
import { buildView, resolveMode, nextLayout, charWidth, windowWidth, MODE_KEY, WRAP_KEY } from "./diff-view.js";
import { diffList, diffChip } from "./diff-render.js";
import { openInFiles } from "./file-open.js";
import { normalizePr, normalizeList, viewArgs, listArgs, diffArgs, reviewArgs, mergeArgs } from "./review-pr.js";

const MAX_FILES = 400;

const mono = () => settings().font_family ?? "JetBrains Mono";
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const modified = (e) => Boolean(e?.modifiers?.platform || e?.modifiers?.control || e?.modifiers?.alt);

function gitError(result) {
  const lines = (result?.stderr || result?.stdout || "").split("\n").map((line) => line.trimEnd()).filter((line) => line && !line.startsWith("hint:"));
  return lines.slice(-6).join("\n") || `git exited with ${result?.code}`;
}

function ghError(result) {
  const text = (result?.stderr || result?.stdout || "").trim();
  return text.split("\n").slice(-10).join("\n") || `gh exited with ${result?.code}`;
}

function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function missingGh(args) {
  return `gh is not installed.\n\nInstall it with: brew install gh\nThen sign in with: gh auth login\n\nThe command was: gh ${args.join(" ")}`;
}

// The folder the graph is drawn for: the focused terminal's, else the space's.
// On another machine, `on` names it, as graph.js's location() does.
function here() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { root: pane?.cwd || f?.cwd || space?.folder || null, on };
}

function parseStatusZ(out) {
  const entries = [];
  for (const record of String(out ?? "").split("\0")) {
    if (!record) continue;
    const xy = record.slice(0, 2), path = record.slice(3);
    if (!path) continue;
    const untracked = xy === "??";
    const status = untracked || xy.includes("A") ? "A" : xy.includes("D") ? "D" : xy.includes("U") ? "U" : "M";
    entries.push({ path, status, untracked });
  }
  return entries;
}

function parseNumstatZ(out) {
  const stats = new Map();
  for (const record of String(out ?? "").split("\0")) {
    if (!record) continue;
    const [add, del, ...rest] = record.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    stats.set(path, { add: Number(add) || 0, del: Number(del) || 0, binary: add === "-" });
  }
  return stats;
}

function parseNumstat(out) {
  const stats = new Map();
  for (const line of String(out ?? "").split("\n")) {
    if (!line) continue;
    const [add, del, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    stats.set(path, { add: Number(add) || 0, del: Number(del) || 0, binary: add === "-" });
  }
  return stats;
}

function parseNameStatus(out) {
  const files = [];
  for (const line of String(out ?? "").split("\n")) {
    if (!line) continue;
    const [status, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (path) files.push({ path, status: (status || "M")[0] });
  }
  return files;
}

function statusColor(status, t) {
  return status === "A" ? t.ansi2 : status === "D" || status === "U" ? t.ansi1 : status === "R" ? t.ansi3 : t.blocked;
}

function decisionText(decision) {
  return decision === "APPROVED" ? "Approved" : decision === "CHANGES_REQUESTED" ? "Changes requested"
    : decision === "REVIEW_REQUIRED" ? "Review required" : "";
}

export default class Review extends View {
  init(_props, cx) {
    const p = _props ?? props() ?? {};
    this.propRoot = typeof p.root === "string" ? p.root : null;
    const loc = here();
    this.root = this.propRoot || loc.root || null;
    this.on = p.on ?? loc.on;
    // Inside the Git panel the shell draws the tabs and the card; the
    // review view is idle until its tab comes to the front.
    this.embedded = Boolean(p.embedded);
    this.active = p.active !== false;
    this.state = { tab: "changes", scope: "worktree", file: null, dialog: null };
    // The panel is the surface: split at 900px, inline below, alt+z for long lines.
    this.layout = ["auto", "split", "inline"].includes(shared(MODE_KEY)) ? shared(MODE_KEY) : "auto";
    this.wrap = shared(WRAP_KEY) === true;
    this.width = 0;
    this.changes = { status: "idle", files: [], error: null, truncated: false, hasHead: true, base: "HEAD" };
    this.pr = { status: "idle", data: null, error: null, picker: null, diff: null, branch: null, missing: false };
    this.diff = null;
    this.base = "HEAD";
    this.reviewed = new Set();
    this.closed = false;
    this.watching = false;
    this.debounce = null;
    this.changesBusy = false;
    this.ghBusy = false;
    this.diffSeq = 0;
    this.listId = `review-${Math.random().toString(36).slice(2)}`;
    this.diffId = `${this.listId}-diff`;
    this.diffXId = `${this.listId}-diff-x`;
    this.filesId = `${this.listId}-files`;
    this.bodyId = `${this.listId}-body`;
    this.pickerId = `${this.listId}-picker`;
    this.handle = cx.focus_handle();
    if (this.active) this.handle.focus();
    this.loadReviewed();
    if (this.active) { this.refreshChanges(cx); this.watch(cx); }
    cx.timer.every(10000, (cx) => {
      if (this.active && !this.closed && this.state.tab === "changes" && !this.ghBusy) this.refreshChanges(cx);
    });
  }

  // The shell switches to a review tab: take the keyboard and read again.
  focus(cx) {
    if (this.closed) return;
    this.active = true;
    this.syncRoot(cx);
    this.handle.focus();
    this.watch(cx);
    if (this.state.tab === "changes") this.refreshChanges(cx);
    else if (this.pr.status === "idle") this.loadPr(cx);
  }

  close() {
    this.closed = true;
    try { this.state.dialog?.body?.release(); } catch { /* already released */ }
    this.state.dialog = null;
    this.diff = null;
  }

  // ---- root and watching

  syncRoot(cx) {
    if (this.propRoot) return;
    const loc = here(), root = loc.root;
    if (root === this.root && (!root || loc.on === this.on)) return;
    this.root = root;
    this.on = loc.on;
    this.state.file = null;
    this.diff = null;
    this.changes = { status: "idle", files: [], error: null, truncated: false, hasHead: true, base: "HEAD" };
    this.pr = { status: "idle", data: null, error: null, picker: null, diff: null, branch: null, missing: false };
    this.loadReviewed();
    if (root) { this.refreshChanges(cx); this.watch(cx); }
  }

  watch(cx) {
    if (this.watching || !this.root || this.closed) return;
    this.watching = true;
    const root = this.root;
    cx.spawn(async (cx) => {
      try {
        while (!this.closed && this.root === root) {
          await watchFolder(root);
          if (this.closed || this.root !== root) break;
          if (this.debounce) continue;
          this.debounce = cx.timer.after(500, (cx) => {
            this.debounce = null;
            if (this.active && !this.closed && this.root === root && this.state.tab === "changes" && !this.ghBusy) this.refreshChanges(cx);
          });
        }
      } catch {
        // The 10-second timer still refreshes.
      } finally {
        this.watching = false;
        if (!this.closed && this.root !== root) this.watch(cx);
      }
    });
  }

  // ---- local changes

  refreshChanges(cx) {
    if (this.closed || !this.root) {
      if (!this.root) this.changes = { ...this.changes, status: "error", error: "No folder for this pane." };
      return;
    }
    if (this.changesBusy || this.ghBusy) return;
    this.changesBusy = true;
    if (!this.changes.files.length) this.changes.status = "loading";
    this.changes.error = null;
    const root = this.root, on = this.on, scope = this.state.scope;
    cx.spawn(async (cx) => {
      let next;
      try { next = scope === "branch" ? await this.loadBranch(root, on) : await this.loadWorktree(root, on); }
      catch (e) { next = { error: String(e?.message ?? e) }; }
      if (this.closed) { this.changesBusy = false; return; }
      if (this.root !== root || this.state.scope !== scope) {
        this.changesBusy = false;
        if (!this.closed) this.refreshChanges(cx);
        return;
      }
      if (next.error) {
        this.changes = { ...this.changes, status: this.changes.files.length ? "ready" : "error", error: next.error };
      } else {
        this.base = next.base;
        this.changes = { status: "ready", files: next.files, error: null, truncated: next.truncated, hasHead: next.hasHead, base: next.base };
        if (this.state.file !== null && !next.files.some((file) => file.path === this.state.file)) {
          this.state.file = null;
          this.diff = null;
        }
        this.loadReviewed();
      }
      this.changesBusy = false;
      cx.notify();
    });
  }

  async loadWorktree(root, on) {
    const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: root, on })
      .catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
    if (status.code !== 0) throw new Error(gitError(status));
    const entries = parseStatusZ(status.stdout);
    const head = await exec("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: root, on }).catch(() => null);
    const hasHead = Boolean(head && head.code === 0 && head.stdout.trim());
    let stats = new Map();
    if (hasHead) {
      const numstat = await exec("git", ["diff", "HEAD", "--numstat", "-z", "--no-renames"], { cwd: root, on }).catch(() => null);
      if (numstat?.code === 0) stats = parseNumstatZ(numstat.stdout);
    } else {
      for (const args of [["diff", "--cached", "--numstat", "-z", "--no-renames"], ["diff", "--numstat", "-z", "--no-renames"]]) {
        const result = await exec("git", args, { cwd: root, on }).catch(() => null);
        if (result?.code !== 0) continue;
        for (const [path, stat] of parseNumstatZ(result.stdout)) {
          const prev = stats.get(path) ?? { add: 0, del: 0, binary: false };
          stats.set(path, { add: prev.add + stat.add, del: prev.del + stat.del, binary: prev.binary || stat.binary });
        }
      }
    }
    const files = entries.map((entry) => {
      const stat = stats.get(entry.path) ?? { add: 0, del: 0, binary: false };
      return { path: entry.path, status: entry.status, untracked: entry.untracked, add: stat.add, del: stat.del, binary: stat.binary };
    });
    return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES, hasHead, base: "HEAD" };
  }

  async resolveBase(root, on) {
    const remote = await exec("git", ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"], { cwd: root, on }).catch(() => null);
    const candidates = [remote?.code === 0 ? remote.stdout.trim() : "", "main", "master"].filter(Boolean);
    for (const base of candidates) {
      const check = await exec("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { cwd: root, on }).catch(() => null);
      if (check?.code === 0) return base;
    }
    throw new Error("No base branch (tried origin/HEAD, main, master).");
  }

  async loadBranch(root, on) {
    const base = await this.resolveBase(root, on);
    const range = `${base}...HEAD`;
    const names = await exec("git", ["diff", "--name-status", "--no-renames", range], { cwd: root, on })
      .catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
    if (names.code !== 0) throw new Error(gitError(names));
    const numstat = await exec("git", ["diff", "--numstat", "--no-renames", range], { cwd: root, on }).catch(() => null);
    const stats = numstat?.code === 0 ? parseNumstat(numstat.stdout) : new Map();
    const files = parseNameStatus(names.stdout).map((entry) => {
      const stat = stats.get(entry.path) ?? { add: 0, del: 0, binary: false };
      return { path: entry.path, status: entry.status, untracked: false, add: stat.add, del: stat.del, binary: stat.binary };
    });
    return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES, hasHead: true, base };
  }

  // ---- one file's diff

  currentFiles() {
    return this.state.tab === "pr" ? (this.pr.diff?.files ?? []) : this.changes.files;
  }

  id(name) {
    return `${this.listId}-${name}`;
  }

  async openFile(file, cx) {
    const path = file.path;
    this.state.file = path;
    this.diff = { path, rows: null, error: null, binary: false, loading: true, add: file.add, del: file.del };
    const seq = ++this.diffSeq;
    cx.notify();
    const root = this.root, on = this.on, scope = this.state.scope;
    let result;
    try {
      if (this.state.tab === "pr") {
        result = { rows: file.rows ?? [], binary: Boolean(file.binary), add: file.add, del: file.del };
      } else if (scope === "worktree" && file.untracked) {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (text === null) result = { error: "Cannot read this file (binary, too large, or gone)." };
        else {
          const added = syntheticAdd(path, text);
          result = { rows: added.rows, binary: added.binary, add: added.add, del: added.del };
        }
      } else {
        const opts = ["--no-ext-diff", "--no-textconv", "--no-color"];
        const runs = scope === "branch" ? [[...opts, `${this.base}...HEAD`, "--", path]]
          : this.changes.hasHead ? [[...opts, "HEAD", "--", path]]
            : [[...opts, "--cached", "--", path], [...opts, "--", path]];
        let output = "", failure = null;
        for (const args of runs) {
          const run = await exec("git", ["diff", ...args], { cwd: root, on })
            .catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
          if (run.code !== 0) { failure = gitError(run); break; }
          if (run.stdout.trim()) output += (output ? "\n" : "") + run.stdout;
        }
        if (failure) result = { error: failure };
        else {
          const rows = parseRows(output);
          const binary = rows.length === 0 && /^Binary files .* differ$/m.test(output);
          result = {
            rows, binary,
            add: rows.reduce((n, row) => n + (row.kind === "+" ? 1 : 0), 0),
            del: rows.reduce((n, row) => n + (row.kind === "-" ? 1 : 0), 0),
          };
        }
      }
    } catch (e) { result = { error: String(e?.message ?? e) }; }
    if (this.closed || this.diffSeq !== seq || this.state.file !== path) return;
    this.diff = { path, loading: false, ...result };
    cx.notify();
  }

  // ---- reviewed marks

  reviewKey() {
    const scope = this.state.tab === "pr" ? "pr" : this.state.scope;
    const base = this.state.tab === "pr" ? (this.pr.data ? `#${this.pr.data.number}` : "none")
      : this.state.scope === "worktree" ? "HEAD" : (this.base || "HEAD");
    return `review:${this.root ?? ""}:${scope}:${base}`;
  }

  loadReviewed() {
    try {
      const raw = localStorage.getItem(this.reviewKey());
      const list = raw ? JSON.parse(raw) : [];
      this.reviewed = new Set(Array.isArray(list) ? list.filter((path) => typeof path === "string") : []);
    } catch { this.reviewed = new Set(); }
  }

  saveReviewed() {
    try { localStorage.setItem(this.reviewKey(), JSON.stringify([...this.reviewed])); } catch { /* storage is optional */ }
  }

  toggleReviewed() {
    const path = this.state.file;
    if (path === null) return;
    if (this.reviewed.has(path)) this.reviewed.delete(path); else this.reviewed.add(path);
    this.saveReviewed();
  }

  stepFile(step, cx) {
    const files = this.currentFiles();
    const at = files.findIndex((file) => file.path === this.state.file);
    if (at < 0) return;
    const next = files[Math.max(0, Math.min(files.length - 1, at + step))];
    if (next && next.path !== this.state.file) this.openFile(next, cx);
  }

  // ---- pull requests

  loadPr(cx, number) {
    if (this.closed || !this.root || this.ghBusy) return;
    this.ghBusy = true;
    this.pr.error = null;
    this.pr.missing = false;
    if (!this.pr.data) this.pr.status = "loading";
    const root = this.root, on = this.on;
    cx.spawn(async (cx) => {
      let next;
      try {
        const view = await exec("gh", viewArgs(number), { cwd: root, on })
          .catch((e) => ({ thrown: String(e?.message ?? e) }));
        if (view.thrown) {
          next = { error: missingGh(viewArgs(number)), missing: true };
        } else if (view.code === 0) {
          const json = safeJson(view.stdout, null);
          if (!json) next = { error: "gh returned invalid JSON." };
          else {
            const data = normalizePr(json);
            next = { data, diff: await this.loadPrDiff(data.number, root, on) };
          }
        } else if (number !== undefined && number !== null) {
          next = { error: ghError(view) };
        } else {
          const list = await exec("gh", listArgs(30), { cwd: root, on }).catch((e) => ({ thrown: String(e?.message ?? e) }));
          if (list.thrown) next = { error: missingGh(listArgs(30)), missing: true };
          else if (list.code !== 0) next = { error: ghError(list) };
          else {
            const picks = normalizeList(safeJson(list.stdout, []));
            next = picks.length ? { picker: picks } : { empty: true, branch: await this.currentBranch(root, on) };
          }
        }
      } catch (e) { next = { error: String(e?.message ?? e) }; }
      this.ghBusy = false;
      if (this.closed || this.root !== root) return;
      if (next.error) {
        this.pr = { ...this.pr, status: "error", error: next.error, missing: Boolean(next.missing), data: next.missing ? null : this.pr.data };
      } else if (next.picker) {
        this.pr = { status: "picker", data: null, error: null, picker: next.picker, diff: null, branch: null, missing: false };
      } else if (next.empty) {
        this.pr = { status: "empty", data: null, error: null, picker: null, diff: null, branch: next.branch, missing: false };
      } else {
        this.pr = { status: "ready", data: next.data, error: null, picker: null, diff: next.diff, branch: null, missing: false };
        this.loadReviewed();
      }
      cx.notify();
    });
  }

  async loadPrDiff(number, root, on) {
    try {
      const result = await exec("gh", diffArgs(number), { cwd: root, on });
      if (result.code !== 0) return { error: ghError(result), files: [], truncated: false };
      if (!result.stdout.trim()) return { error: "gh pr diff returned no output.", files: [], truncated: false };
      try {
        const files = parsePatch(result.stdout).files;
        return { error: null, files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES };
      } catch (e) {
        return { error: `Could not parse the diff: ${String(e?.message ?? e)}`, files: [], truncated: false };
      }
    } catch (e) { return { error: String(e?.message ?? e), files: [], truncated: false }; }
  }

  loadPrList(cx) {
    if (this.closed || !this.root || this.ghBusy) return;
    this.ghBusy = true;
    const root = this.root, on = this.on;
    cx.spawn(async (cx) => {
      let next;
      try {
        const list = await exec("gh", listArgs(30), { cwd: root, on }).catch((e) => ({ thrown: String(e?.message ?? e) }));
        if (list.thrown) next = { error: missingGh(listArgs(30)), missing: true };
        else if (list.code !== 0) next = { error: ghError(list) };
        else {
          const picks = normalizeList(safeJson(list.stdout, []));
          next = picks.length ? { picker: picks } : { empty: true, branch: await this.currentBranch(root, on) };
        }
      } catch (e) { next = { error: String(e?.message ?? e) }; }
      this.ghBusy = false;
      if (this.closed || this.root !== root) return;
      if (next.error) this.pr = { ...this.pr, status: this.pr.data ? "ready" : "error", error: next.error, missing: Boolean(next.missing) };
      else if (next.picker) this.pr = { ...this.pr, status: "picker", picker: next.picker, error: null, missing: false };
      else this.pr = { ...this.pr, status: "empty", picker: null, error: null, branch: next.branch, missing: false };
      cx.notify();
    });
  }

  async currentBranch(root, on) {
    const result = await exec("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd: root, on }).catch(() => null);
    return result?.code === 0 ? result.stdout.trim() : null;
  }

  choosePr(number, cx) {
    this.pr = { ...this.pr, picker: null, status: "loading", data: null, diff: null, error: null };
    cx.notify();
    this.loadPr(cx, number);
  }

  // ---- actions

  openDialog(kind, cx) {
    try { this.state.dialog?.body?.release(); } catch { /* already released */ }
    this.pr.error = null;
    const dialog = { kind, method: "merge", deleteBranch: false, warning: null, busy: false, body: null };
    if (kind !== "merge") {
      dialog.body = TextareaState.new({ placeholder: "Write a comment…", rows: 6 });
      dialog.body.on("change", (_e, cx) => {
        if (this.state.dialog === dialog) { dialog.warning = null; cx.notify(); }
      });
    }
    this.state.dialog = dialog;
    if (dialog.body) {
      dialog.body.focus();
      cx.timer.after(0, () => { if (this.state.dialog === dialog) dialog.body?.focus(); });
    }
    cx.notify();
  }

  closeDialog() {
    const dialog = this.state.dialog;
    this.state.dialog = null;
    try { dialog?.body?.release(); } catch { /* already released */ }
    if (!this.closed) this.handle.focus();
  }

  submitReview(cx) {
    const dialog = this.state.dialog;
    if (!dialog || dialog.busy || !this.pr.data) return;
    const body = dialog.body?.value() ?? "";
    if (dialog.kind === "request-changes" && !body.trim()) {
      dialog.warning = "Requesting changes needs a comment.";
      cx.notify();
      return;
    }
    let args;
    try { args = reviewArgs(this.pr.data.number, dialog.kind, body); }
    catch (e) { dialog.warning = String(e?.message ?? e); cx.notify(); return; }
    this.runAction(args, dialog, cx, () => { this.closeDialog(); this.loadPr(cx); });
  }

  submitMerge(cx) {
    const dialog = this.state.dialog;
    if (!dialog || dialog.busy || !this.pr.data) return;
    let args;
    try { args = mergeArgs(this.pr.data.number, dialog.method, dialog.deleteBranch); }
    catch (e) { dialog.warning = String(e?.message ?? e); cx.notify(); return; }
    this.runAction(args, dialog, cx, () => { this.closeDialog(); this.loadPr(cx); });
  }

  runAction(args, dialog, cx, done) {
    if (this.ghBusy) return;
    dialog.busy = true;
    this.ghBusy = true;
    this.pr.error = null;
    const root = this.root, on = this.on;
    cx.spawn(async (cx) => {
      let failure = null;
      try {
        const result = await exec("gh", args, { cwd: root, on });
        if (result.code !== 0) failure = ghError(result);
      } catch (e) { failure = String(e?.message ?? e); }
      this.ghBusy = false;
      dialog.busy = false;
      if (this.closed) return;
      if (failure) this.pr.error = failure;
      else done();
      cx.notify();
    });
    cx.notify();
  }

  // ---- keys

  keyDown(event, cx) {
    if (this.state.dialog) {
      if (event.key === "escape") {
        this.closeDialog();
        cx.stop_propagation();
        cx.notify();
      }
      return;
    }
    if (event.key === "z" && event.modifiers?.alt) {
      this.wrap = !this.wrap;
      setShared(WRAP_KEY, this.wrap);
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (modified(event)) return;
    if (event.key === "escape") {
      if (this.state.file !== null) {
        this.state.file = null;
        this.diff = null;
        cx.stop_propagation();
        cx.notify();
      }
      return;
    }
    if (event.key === "s") {
      this.layout = nextLayout(this.layout);
      setShared(MODE_KEY, this.layout);
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (event.key === "r" && this.state.file !== null) {
      this.toggleReviewed();
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if ((event.key === "j" || event.key === "k") && this.state.file !== null) {
      this.stepFile(event.key === "j" ? 1 : -1, cx);
      cx.stop_propagation();
      cx.notify();
    }
  }

  // ---- render

  render(cx) {
    this.syncRoot(cx);
    const t = theme(), m = mono();
    return v_flex().id(this.id("root")).relative().size_full().min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, (e) => e.rounded(10).border_1().border_color(t.border))
      .text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((event, cx) => this.keyDown(event, cx))
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); }
      })
      .child(this.header(t))
      .when(this.state.tab === "changes", (el) => el.child(this.changesBody(t, m)))
      .when(this.state.tab === "pr", (el) => el.child(this.prBody(t, m, cx)))
      .when(Boolean(this.state.dialog), (el) => el.child(this.dialog(t, cx)));
  }

  header(t) {
    const tab = (id, label, active, click) => h_flex().id(id).h(28).px(12).items_center().rounded(7).cursor_pointer().text_size(12.5)
      .when(active, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(!active, (el) => el.bg(t.chrome).text_color(t.muted))
      .hover((style) => style.bg(t.hover))
      .on_click(click).child(label);
    const scope = (id, label, active, click) => h_flex().id(id).h(24).px(10).items_center().rounded(6).cursor_pointer().text_size(11.5)
      .when(active, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(!active, (el) => el.text_color(t.muted))
      .hover((style) => style.bg(t.hover))
      .on_click(click).child(label);
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .when(!this.embedded, (el) => el
        .child(tab(this.id("tab-changes"), "Changes", this.state.tab === "changes", (_e, cx) => this.setTab("changes", cx)))
        .child(tab(this.id("tab-pr"), "Pull request", this.state.tab === "pr", (_e, cx) => this.setTab("pr", cx))))
      .when(this.state.tab === "changes", (el) => el.child(h_flex().h(26).flex_none().px(2).gap(2).items_center().rounded(6).bg(t.raised)
        .child(scope(this.id("scope-worktree"), "Worktree", this.state.scope === "worktree", (_e, cx) => this.setScope("worktree", cx)))
        .child(scope(this.id("scope-branch"), "Branch", this.state.scope === "branch", (_e, cx) => this.setScope("branch", cx)))))
      .child(div().flex_1())
      .child(h_flex().id(this.id("refresh")).size(26).flex_none().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted).text_size(14)
        .hover((style) => style.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.refresh(cx)).child("↻"));
  }

  setTab(tab, cx) {
    if (this.state.tab === tab) return;
    this.state.tab = tab;
    this.state.file = null;
    this.diff = null;
    this.loadReviewed();
    if (tab === "changes" && this.changes.status === "idle") this.refreshChanges(cx);
    if (tab === "pr" && this.pr.status === "idle") this.loadPr(cx);
    cx.notify();
  }

  setScope(scope, cx) {
    if (this.state.scope === scope) return;
    this.state.scope = scope;
    this.state.file = null;
    this.diff = null;
    this.changes = { status: "loading", files: [], error: null, truncated: false, hasHead: true, base: "HEAD" };
    this.loadReviewed();
    this.refreshChanges(cx);
    cx.notify();
  }

  refresh(cx) {
    if (this.state.tab === "pr") this.loadPr(cx);
    else this.refreshChanges(cx);
  }

  // ---- local changes view

  changesBody(t, m) {
    if (!this.root) return this.emptyState(t, "No folder", "Open this pane in a space with a folder.");
    if (this.state.file !== null) {
      return v_flex().flex_1().min_h(0)
        .child(this.diffHeader(t, m))
        .child(this.diffBody(t, m));
    }
    return v_flex().flex_1().min_h(0)
      .when(Boolean(this.changes.error), (el) => el.child(this.banner(t, this.changes.error)))
      .child(this.fileList(t, m, this.changes.files, this.changes.status, this.changes.truncated, true));
  }

  fileList(t, m, files, status, truncated, scroll) {
    const box = scroll
      ? v_flex().id(this.filesId).flex_1().min_h(0).overflow_y_scrollbar().p(6)
      : v_flex().p(6);
    const rows = files.map((file, i) => h_flex().id(this.id(`file-${i}`)).h(30).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .on_click((_e, cx) => this.openFile(file, cx))
      .child(div().w(14).flex_none().text_size(11).text_color(statusColor(file.status, t)).child(file.status))
      .child(div().flex_1().min_w(0).truncate().font_family(m).child(file.path))
      .when(file.add > 0, (el) => el.child(div().text_size(11).text_color(t.ansi2).child(`+${file.add}`)))
      .when(file.del > 0, (el) => el.child(div().text_size(11).text_color(t.ansi1).child(`−${file.del}`)))
      .when(this.reviewed.has(file.path), (el) => el.child(div().w(7).h(7).flex_none().rounded_full().bg(t.done))));
    if (truncated) rows.push(div().p(8).text_size(11).text_color(t.dim).child(`Showing the first ${MAX_FILES} files.`));
    if (!rows.length) rows.push(div().p(12).text_size(12).text_color(t.dim)
      .child(status === "loading" ? "Loading changes…" : status === "error" ? "Could not read changes." : "No changes."));
    return box.children(rows);
  }

  diffHeader(t, m) {
    const path = this.state.file ?? "";
    const entry = this.currentFiles().find((file) => file.path === path);
    const add = this.diff?.add ?? entry?.add ?? 0, del = this.diff?.del ?? entry?.del ?? 0;
    return h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(h_flex().id(this.id("back")).h(24).px(6).items_center().rounded(6).cursor_pointer().text_color(t.muted)
        .hover((style) => style.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.state.file = null; this.diff = null; cx.notify(); }).child("←"))
      .child(div().flex_1().min_w(0).truncate().font_family(m).text_color(t.foreground).child(path))
      .when(add > 0, (el) => el.child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)))
      .when(del > 0, (el) => el.child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .when(this.reviewed.has(path), (el) => el.child(div().w(7).h(7).flex_none().rounded_full().bg(t.done)))
      .child(diffChip(this.id("mode"), this.layout === "auto" ? `AUTO · ${resolveMode(this.layout, this.width).toUpperCase()}` : this.layout.toUpperCase(),
        resolveMode(this.layout, this.width) === "split", (_e, cx) => { this.layout = nextLayout(this.layout); setShared(MODE_KEY, this.layout); cx.notify(); }, t, 6))
      .child(diffChip(this.id("wrap"), this.wrap ? "WRAP" : "NO WRAP", this.wrap, (_e, cx) => {
        this.wrap = !this.wrap; setShared(WRAP_KEY, this.wrap); cx.notify();
      }, t, 6))
      .child(diffChip(this.id("window"), "WINDOW", false, (_e, cx) => this.openWindow(cx), t, 6))
      .child(diffChip(this.id("open"), "OPEN FILE", false,
        () => openInFiles({ root: this.root, base: this.root, path: this.state.file, key: "re-files.changed" }), t, 6))
      .child(div().text_size(10.5).text_color(t.dim).child("r reviewed · esc back"));
  }

  // The pane is a few hundred pixels wide, so a side-by-side read needs a
  // window. It fetches the same patch again; the props stay small.
  openWindow(cx) {
    const path = this.state.file, root = this.root;
    if (!path || !root) return;
    const pr = this.state.tab === "pr" ? this.pr.data?.number ?? null : null;
    const entry = this.currentFiles().find((file) => file.path === path);
    const width = windowWidth(this.diff?.rows ?? [], charWidth(settings().font_size));
    openOverlay({ mod: "re-git-graph", kind: "dialog", key: "re-git-graph.diff", width, height: 0.72,
      props: { role: "diff", root, cwd: root, on: this.on, path,
        source: pr ? "pr" : this.state.scope === "branch" ? "branch" : "worktree",
        pr, base: this.base, hasHead: this.changes.hasHead, fresh: Boolean(entry?.fresh) } });
  }

  diffBody(t, m) {
    const diff = this.diff;
    if (!diff || diff.loading) return div().p(12).text_color(t.dim).child("Loading diff…");
    if (diff.error) return div().p(12).text_color(t.ansi1).child(diff.error);
    if (diff.binary) return div().p(12).text_color(t.dim).child("Binary file · no diff");
    const rows = diff.rows ?? [];
    if (!rows.length) return div().p(12).text_color(t.dim).child("No changes.");
    const view = buildView({ rows, mode: resolveMode(this.layout, this.width), width: this.width,
      cw: charWidth(settings().font_size), wrap: this.wrap });
    return diffList({ view, wrap: this.wrap, width: this.width, id: this.diffId, t, mono: m });
  }

  // ---- pull request view

  prBody(t, m, cx) {
    if (!this.root) return this.emptyState(t, "No folder", "Open this pane in a space with a folder.");
    if (this.state.file !== null && this.pr.data) {
      return v_flex().flex_1().min_h(0)
        .child(this.diffHeader(t, m))
        .child(this.diffBody(t, m));
    }
    if (this.pr.status === "error" && this.pr.missing) return this.missingGh(t, cx);
    if (this.pr.status === "error") {
      return v_flex().flex_1().min_h(0)
        .child(this.banner(t, this.pr.error ?? "gh failed."))
        .child(this.emptyState(t, "Could not read the pull request", "Fix the error above, then refresh."));
    }
    if (this.pr.picker) return this.picker(t, cx);
    if (this.pr.status === "empty") return this.emptyPr(t, cx);
    if (!this.pr.data) return this.emptyState(t, "Loading pull request…", "Reading it with gh.");
    return v_flex().flex_1().min_h(0)
      .when(Boolean(this.pr.error), (el) => el.child(this.banner(t, this.pr.error)))
      .child(this.prHeader(t, m, cx))
      .child(v_flex().id(this.bodyId).flex_1().min_h(0).overflow_y_scrollbar()
        .child(this.conversation(t))
        .child(this.prFiles(t, m)));
  }

  prHeader(t, m, cx) {
    const pr = this.pr.data;
    const state = pr.state || "";
    const color = state === "OPEN" ? t.ansi2 : state === "MERGED" ? t.accent : state === "CLOSED" ? t.ansi1 : t.muted;
    const action = (id, label, primary, click) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((style) => style.opacity(0.88)).on_click(click).child(label);
    return v_flex().flex_none().px(14).py(10).gap(6).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().text_color(t.muted).child(`#${pr.number}`))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(pr.title))
        .child(div().text_size(11).text_color(color).child(`${state}${pr.draft ? " · draft" : ""}`)))
      .child(h_flex().gap(8).text_size(11.5).items_center()
        .child(div().font_family(m).text_color(t.muted).child(`${pr.base} ← ${pr.head}`))
        .child(div().text_color(t.ansi2).child(`+${pr.additions}`))
        .child(div().text_color(t.ansi1).child(`−${pr.deletions}`))
        .child(div().text_color(t.dim).child(count(pr.changedFiles, "file")))
        .child(div().flex_1())
        .when(Boolean(decisionText(pr.decision)), (el) => el.child(div().text_size(11).text_color(t.dim).child(decisionText(pr.decision)))))
      .child(h_flex().gap(6).pt(4)
        .child(action(this.id("action-comment"), "Comment", false, (_e, cx) => this.openDialog("comment", cx)))
        .child(action(this.id("action-approve"), "Approve", false, (_e, cx) => this.openDialog("approve", cx)))
        .child(action(this.id("action-changes"), "Request changes", false, (_e, cx) => this.openDialog("request-changes", cx)))
        .child(action(this.id("action-merge"), "Merge", true, (_e, cx) => this.openDialog("merge", cx))));
  }

  conversation(t) {
    const pr = this.pr.data;
    const parts = [div().text_size(11).text_color(t.dim).child("Conversation")];
    if (pr.body.trim()) parts.push(div().w_full().child(TextView.markdown(`${this.listId}-markdown-body`, pr.body).selectable(true)));
    pr.comments.forEach((comment, i) => {
      parts.push(v_flex().gap(3).p(9).rounded(8).bg(t.raised)
        .child(h_flex().gap(6).items_center().text_size(11)
          .child(div().text_color(t.muted).child(comment.author ?? "ghost"))
          .child(div().text_color(t.dim).child(comment.at ?? "")))
        .when(Boolean(comment.body.trim()), (el) => el.child(TextView.markdown(`${this.listId}-comment-${i}`, comment.body).selectable(true))));
    });
    pr.reviews.forEach((review, i) => {
      const color = review.state === "APPROVED" ? t.ansi2 : review.state === "CHANGES_REQUESTED" ? t.ansi1 : t.muted;
      parts.push(v_flex().gap(3).p(9).rounded(8).bg(t.raised)
        .child(h_flex().gap(6).items_center().text_size(11)
          .child(div().text_color(t.muted).child(review.author ?? "ghost"))
          .child(div().text_color(color).child(review.state))
          .child(div().text_color(t.dim).child(review.at ?? "")))
        .when(Boolean(review.body.trim()), (el) => el.child(TextView.markdown(`${this.listId}-review-${i}`, review.body).selectable(true))));
    });
    return v_flex().p(14).gap(8).border_b(1).border_color(t.border).children(parts);
  }

  prFiles(t, m) {
    const diff = this.pr.diff;
    return v_flex().border_t(1).border_color(t.border).pt(10)
      .child(h_flex().px(14).pb(6).gap(8).items_center()
        .child(div().text_size(11).text_color(t.dim).child("Files"))
        .child(div().text_size(11).text_color(t.dim).child(count(this.pr.data.changedFiles, "file"))))
      .when(Boolean(diff?.error), (el) => el.child(this.banner(t, diff.error)))
      .child(this.fileList(t, m, diff?.files ?? [], diff?.error ? "error" : diff ? "ready" : "loading", Boolean(diff?.truncated), false));
  }

  picker(t, cx) {
    const rows = this.pr.picker.map((pr, i) => h_flex().id(`review-pick-${this.listId}-${i}`).h(34).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .on_click((_e, cx) => this.choosePr(pr.number, cx))
      .child(div().w(42).flex_none().text_color(t.accent).child(`#${pr.number}`))
      .child(div().flex_1().min_w(0).truncate().child(pr.title))
      .child(div().text_size(11).text_color(t.muted).child(pr.head))
      .child(div().text_size(11).text_color(t.dim).child(pr.author ?? "")));
    return v_flex().flex_1().min_h(0)
      .child(h_flex().h(34).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("Pick one")))
      .child(v_flex().id(this.pickerId).flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .when(!rows.length, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child("No pull requests.")))
        .children(rows));
  }

  emptyPr(t, cx) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(28)
      .child(div().text_size(14).font_semibold().child("No pull request"))
      .child(div().max_w(380).text_center().text_size(12).text_color(t.muted).child(`No pull request for ${this.pr.branch || "this branch"}.`))
      .child(h_flex().id(this.id("choose-pr")).h(32).px(14).items_center().rounded(8).border_1().border_color(t.input).bg(t.raised)
        .text_color(t.foreground).text_size(12.5).font_medium().cursor_pointer().hover((style) => style.opacity(0.88))
        .on_click((_e, cx) => this.loadPrList(cx)).child("Choose a pull request"));
  }

  missingGh(t, cx) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(28)
      .child(div().text_size(14).font_semibold().child("gh is not installed"))
      .child(div().max_w(460).text_size(12).text_color(t.muted).children(String(this.pr.error ?? "").split("\n").map((line) => div().child(line || " "))))
      .child(h_flex().id(this.id("gh-retry")).h(32).px(14).items_center().rounded(8).border_1().border_color(t.input).bg(t.raised)
        .text_color(t.foreground).text_size(12.5).font_medium().cursor_pointer().hover((style) => style.opacity(0.88))
        .on_click((_e, cx) => this.loadPr(cx)).child("Try again"));
  }

  emptyState(t, title, body) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(8).px(28)
      .child(div().text_size(14).font_semibold().child(title))
      .child(div().max_w(380).text_center().text_size(12).text_color(t.muted).child(body));
  }

  banner(t, text) {
    return v_flex().flex_none().mx(12).my(8).p(10).gap(2).rounded(8).bg(t.ansi1 + "18").border_1().border_color(t.ansi1)
      .children(String(text ?? "").split("\n").map((line) => div().text_size(11.5).text_color(t.ansi1).child(line || " ")));
  }

  // ---- in-pane dialog

  dialog(t, cx) {
    const dialog = this.state.dialog;
    const card = v_flex().id(this.id("dialog-card")).w(440).max_w("92%").p(18).gap(10).rounded(12).bg(t.popover).border_1().border_color(t.border)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      .on_key_down((event, cx) => {
        if (event.key === "escape") { this.closeDialog(); cx.stop_propagation(); cx.notify(); }
      });
    if (dialog.kind === "merge") {
      const pill = (method, label) => h_flex().id(this.id(`merge-${method}`)).h(30).px(12).items_center().rounded(8).cursor_pointer().text_size(12)
        .when(dialog.method === method, (el) => el.bg(t.solid).text_color(t.solid_foreground))
        .when(dialog.method !== method, (el) => el.bg(t.raised).border_1().border_color(t.input).text_color(t.foreground))
        .on_click((_e, cx) => { dialog.method = method; cx.notify(); }).child(label);
      card
        .child(div().text_size(15).font_semibold().child(`Merge #${this.pr.data?.number ?? ""}`))
        .child(div().text_size(11.5).text_color(t.muted).truncate().child(this.pr.data?.title ?? ""))
        .when(Boolean(this.pr.error), (el) => el.child(v_flex().gap(2).p(8).rounded(8).bg(t.ansi1 + "18").border_1().border_color(t.ansi1)
          .children(String(this.pr.error).split("\n").map((line) => div().text_size(11).text_color(t.ansi1).child(line || " ")))))
        .child(div().pt(2).text_size(11).text_color(t.dim).child("Method"))
        .child(h_flex().gap(6).child(pill("merge", "Merge")).child(pill("squash", "Squash")).child(pill("rebase", "Rebase")))
        .child(h_flex().id(this.id("delete-branch")).h(28).gap(8).items_center().cursor_pointer()
          .on_click((_e, cx) => { dialog.deleteBranch = !dialog.deleteBranch; cx.notify(); })
          .child(div().size(16).flex_none().rounded(4).border_1().border_color(dialog.deleteBranch ? t.accent : t.input).flex().items_center().justify_center()
            .when(dialog.deleteBranch, (el) => el.bg(t.accent).text_color(t.accent_foreground).child("✓")))
          .child(div().text_size(12).child("Delete branch after merge")))
        .when(Boolean(dialog.warning), (el) => el.child(div().text_size(11.5).text_color(t.ansi1).child(dialog.warning)))
        .child(h_flex().pt(6).gap(8).justify_end()
          .child(this.button(t, this.id("dialog-cancel"), "Cancel", false, (_e, cx) => { this.closeDialog(); cx.notify(); }))
          .child(this.button(t, this.id("dialog-submit"), dialog.busy ? "Working…" : "Merge", true, (_e, cx) => this.submitMerge(cx))));
    } else {
      const label = dialog.kind === "approve" ? "Approve" : dialog.kind === "request-changes" ? "Request changes" : "Comment";
      card
        .child(div().text_size(15).font_semibold().child(`${label} #${this.pr.data?.number ?? ""}`))
        .child(div().text_size(11.5).text_color(t.muted).truncate().child(this.pr.data?.title ?? ""))
        .when(Boolean(this.pr.error), (el) => el.child(v_flex().gap(2).p(8).rounded(8).bg(t.ansi1 + "18").border_1().border_color(t.ansi1)
          .children(String(this.pr.error).split("\n").map((line) => div().text_size(11).text_color(t.ansi1).child(line || " ")))))
        .child(div().pt(2).text_size(11).text_color(t.dim).child("Comment"))
        .child(Textarea.new(dialog.body).w_full().h(150).p(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
        .when(Boolean(dialog.warning), (el) => el.child(div().text_size(11.5).text_color(t.ansi1).child(dialog.warning)))
        .child(h_flex().pt(6).gap(8).justify_end()
          .child(this.button(t, this.id("dialog-cancel"), "Cancel", false, (_e, cx) => { this.closeDialog(); cx.notify(); }))
          .child(this.button(t, this.id("dialog-submit"), dialog.busy ? "Working…" : "Submit", true, (_e, cx) => this.submitReview(cx))));
    }
    return div().id(this.id("dialog")).absolute().inset_0().flex().items_center().justify_center().bg(t.canvas + "cc")
      .on_click((_e, cx) => { if (!dialog.busy) { this.closeDialog(); cx.notify(); } })
      .child(card);
  }

  button(t, id, label, primary, click) {
    return h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((style) => style.opacity(0.88)).on_click(click).child(label);
  }
}
