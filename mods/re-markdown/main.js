// A read-only Markdown preview for the focused pane's folder, as a floating
// window: the folder's Markdown files, or one file rendered by TextView. It
// reloads while open, and another mod can hand it a file with props { path }.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, home, props, closeOverlay } from "herdr";

const FRONT = /^---\r?\n/;

// Front matter as a fenced block: TextView reads a leading `---` as a rule and
// the YAML under it as prose, which is not what the file means.
export function displayText(text) {
  if (!FRONT.test(text)) return text;
  const lines = text.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].replace(/\r$/, "") === "---") { end = i; break; }
  if (end < 0) return text;
  return "```yaml\n" + lines.slice(1, end).join("\n") + "\n```\n" + lines.slice(end + 1).join("\n");
}

// The focused pane's live folder, else the active space's folder, else home.
// `on` is the active space's machine, null for this computer.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return { root: pane?.cwd || f?.cwd || space?.folder || home(), on: space?.machine ?? null };
}

const absolute = (path) => /^(?:[A-Za-z]:[\\/]|\/)/.test(path);
const join = (root, path) => (absolute(path) ? path : `${root.replace(/[\\/]$/, "")}/${path}`);
const base = (path) => path.split(/[\\/]/).pop() || path;
const depth = (path) => path.split("/").length;

const MARKDOWN = ["*.md", "*.markdown", "*.mdx"];
const FIND = "find . -maxdepth 3 -name node_modules -prune -o -name .git -prune -o -type f \\( -name '*.md' -o -name '*.markdown' -o -name '*.mdx' \\) -print";

// Tracked files first, as git sees them; a folder that is not a repository (or
// a machine without git) falls back to a shallow find. Depth first, then path.
async function listFiles(root, on) {
  let paths = null;
  try {
    const r = await exec("git", ["ls-files", "-z", "--", ...MARKDOWN], { cwd: root, on });
    if (r.code === 0) paths = r.stdout.split("\0").filter(Boolean);
  } catch {}
  if (paths === null) {
    const r = await exec("sh", ["-c", FIND], { cwd: root, on });
    if (r.code !== 0) throw new Error((r.stderr || "").trim() || "Cannot list Markdown files");
    paths = r.stdout.split("\n").map((line) => line.replace(/^\.\//, "").trim()).filter(Boolean);
  }
  return paths.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)).slice(0, 40);
}

class Markdown extends View {
  init(_props, cx) {
    this.uid = `md-${Math.random().toString(36).slice(2, 9)}`;
    this.serial = 0;
    this.listGen = 0;
    this.readGen = 0;
    this.files = [];
    this.file = null;
    this.text = null;
    this.error = null;
    this.fileError = null;
    this.loading = true;
    this.loaded = false;
    this.closed = false;
    this.debounce = null;
    this.poll = null;
    this.watcher = null;
    const { root, on } = location();
    this.root = root;
    this.on = on;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // A window doesn't take the keyboard when it opens; focus again once it is mounted.
    cx.timer.after(50, () => { if (!this.closed) this.handle.focus(); });
    this.load(cx);
    // watchFolder is local only, so another machine gets a slow poll instead.
    if (on) this.poll = cx.timer.every(3000, (cx) => { if (!this.closed) this.refresh(cx); });
    else this.watch(cx);
    const start = props()?.path;
    if (typeof start === "string" && start) this.open(start, cx);
  }

  close() {
    this.closed = true;
    this.poll?.cancel();
    this.watcher?.cancel();
    this.debounce?.cancel();
    this.poll = null;
    this.watcher = null;
    this.debounce = null;
    this.listGen++;
    this.readGen++;
  }

  watch(cx) {
    const root = this.root;
    this.watcher = cx.spawn(async (cx) => {
      try {
        while (!this.closed && this.root === root) {
          await watchFolder(root);
          if (this.closed || this.root !== root) return;
          this.refresh(cx);
        }
      } catch {}
    });
  }

  load(cx) {
    const root = this.root, on = this.on, gen = ++this.listGen;
    if (!this.loaded) this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const files = await listFiles(root, on);
        if (this.closed || gen !== this.listGen) return;
        this.files = files;
        this.error = null;
      } catch (e) {
        if (this.closed || gen !== this.listGen) return;
        this.error = String(e?.message ?? e);
      } finally {
        if (!this.closed && gen === this.listGen) {
          this.loaded = true;
          this.loading = false;
          cx.notify();
        }
      }
    });
  }

  refresh(cx) {
    this.load(cx);
    if (this.file) this.scheduleRead(cx);
  }

  // A burst of change events is one re-read.
  scheduleRead(cx) {
    this.debounce?.cancel();
    this.debounce = cx.timer.after(300, (cx) => {
      this.debounce = null;
      if (!this.closed) this.read(cx);
    });
  }

  read(cx) {
    const path = this.file;
    if (!path) return;
    const root = this.root, on = this.on, gen = ++this.readGen;
    cx.spawn(async (cx) => {
      let text = null, error = null;
      try {
        const raw = await readTextFile(join(root, path), { on });
        if (raw === null) error = "This file is no longer available";
        else if (raw.includes("\0")) error = "Binary file · no preview";
        else text = displayText(raw);
      } catch {
        error = "Cannot read this file";
      }
      if (this.closed || gen !== this.readGen || this.file !== path) return;
      if (text !== null) {
        this.text = text;
        this.fileError = null;
        this.serial++; // a fresh TextView id, so a changed file re-renders
      } else {
        this.text = null;
        this.fileError = error;
      }
      cx.notify();
    });
  }

  open(path, cx) {
    this.file = path;
    this.text = null;
    this.fileError = null;
    this.read(cx);
    this.handle.focus();
    cx.notify();
  }

  back(cx) {
    this.file = null;
    this.text = null;
    this.fileError = null;
    this.readGen++;
    this.debounce?.cancel();
    this.debounce = null;
    this.handle.focus();
    cx.notify();
  }

  closeWindow() {
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
  }

  body(t) {
    if (this.file) {
      if (this.text !== null) {
        return div().flex_1().min_h(0).px(16).py(12).text_size(13)
          .child(TextView.markdown(`${this.uid}-text-${this.serial}`, this.text)
            .scrollable(true).selectable(true).size_full()
            .on_link_click((url, cx) => cx.open_url(url)));
      }
      return div().p(12).text_color(t.dim).child(this.fileError || "Loading…");
    }
    const rows = this.files.map((path) => {
      const cut = path.lastIndexOf("/"), parent = cut < 0 ? "" : path.slice(0, cut);
      return h_flex().id(`${this.uid}-file-${path}`).h(28).flex_none().px(10).gap(8).items_center().rounded(7)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.open(path, cx))
        .child(div().flex_1().min_w(0).truncate().child(cut < 0 ? path : path.slice(cut + 1)))
        .when(Boolean(parent), (el) => el.child(div().flex_none().max_w(240).truncate().text_size(12).text_color(t.dim).child(parent)));
    });
    return v_flex().id(`${this.uid}-list`).flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .children(rows)
      .when(!this.files.length, (el) => el.child(div().p(8).text_size(12).text_color(t.dim)
        .child(this.error || (this.loading ? "Loading…" : "No Markdown files"))));
  }

  render() {
    const t = theme(), title = this.file ? base(this.file) : base(this.root);
    return v_flex().id(this.uid).track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        const overlay = props()?.overlay;
        if (!overlay) return;
        closeOverlay(overlay);
        cx.stop_propagation();
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), (el) => el.child(div().id(`${this.uid}-back`).w(20).cursor_pointer()
          .text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.back(cx)).child("←")))
        .child(div().font_semibold().child("Markdown"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(title))
        .child(div().id(`${this.uid}-close`).w(20).h(20).flex_none().flex().items_center().justify_center()
          .cursor_pointer().text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .on_click(() => this.closeWindow()).child("×")))
      .child(this.body(t));
  }
}

export default Markdown;
