// The Git panel's Config tab: who this repository commits as. It shows the
// user.name and user.email Git reports for the folder, then the pairs you have
// used before. Picking one writes it to the repository's own config, so each
// project keeps its identity. Every other setting stays a `git config` or
// editor action.
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { exec, openOverlay, theme, settings, shared, setShared } from "herdr";
import { parseIdentityZ, pairsOf, rememberPair, samePair, SCOPE_LABEL, IDENTITY_STORE as STORE, IDENTITY_STAMP } from "./config.js";

export class ConfigView {
  init(cx) {
    this.closed = false;
    this.root = null;
    this.on = null;
    this.entries = {};
    this.status = "idle";
    this.error = null;
    this.pairs = pairsOf(shared(STORE));
    this.seenStamp = shared(IDENTITY_STAMP);
    this.name = InputState.new({ placeholder: "Name" });
    this.email = InputState.new({ placeholder: "Email" });
    this.name.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.email.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.name.on("submit", () => this.email.focus());
    this.email.on("submit", (_e, cx) => this.applyTyped(cx));
  }

  close() {
    this.closed = true;
  }

  // The shell calls this when its Config tab comes to the front.
  open(root, on, cx) {
    this.closed = false;
    this.root = root || null;
    this.on = on ?? null;
    this.error = null;
    this.load(cx);
    this.name.focus();
    cx.notify();
  }

  value(which) {
    return this.entries[which]?.value ?? "";
  }

  load(cx) {
    const root = this.root, on = this.on;
    if (!root) {
      this.status = "error";
      this.error = "No folder for this panel.";
      return;
    }
    this.status = "loading";
    cx.spawn(async (cx) => {
      let result;
      try {
        result = await exec("git", ["--no-optional-locks", "config", "--list", "-z", "--show-scope"], { cwd: root, on });
      } catch (e) {
        result = { code: -1, stderr: String(e?.message ?? e) };
      }
      if (this.closed || this.root !== root || this.on !== on) return;
      if (result.code !== 0) {
        this.status = "error";
        this.error = (result.stderr || result.stdout || `git exited with ${result.code}`).trim();
        cx.notify();
        return;
      }
      this.entries = parseIdentityZ(result.stdout);
      this.status = "ready";
      this.remember();
      cx.notify();
    });
    cx.notify();
  }

  // The identity a repository already uses is one it may use again, so it joins
  // the picker: a project that inherits a global name can pin it in one click.
  remember() {
    const pair = { name: this.value("name"), email: this.value("email") };
    const stored = pairsOf(shared(STORE)), known = Boolean(pair.name && pair.email);
    // The list is read on every load, so a pair the confirm just wrote shows up.
    this.pairs = known ? rememberPair(stored, pair) : stored;
    if (known && !samePair(stored[0], pair)) setShared(STORE, this.pairs);
  }

  // Every write asks first: the confirm carries the pair, writes it, and moves
  // the stamp this view reloads on.
  apply(pair) {
    if (!this.root || !pair?.name || !pair?.email) return;
    openOverlay({ mod: "re-git-graph", kind: "dialog", width: 420, height: 200, props: { role: "confirm", pair, root: this.root, on: this.on } });
  }

  applyTyped(cx) {
    const pair = { name: this.name.value().trim(), email: this.email.value().trim() };
    if (!pair.name || !pair.email) {
      this.error = "A name and an email are both needed.";
      cx.notify();
      return;
    }
    this.apply(pair);
  }

  header(t) {
    const busy = this.status === "loading";
    return h_flex().h(32).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(this.root ?? "").child(this.root ?? this.on ?? "No folder"))
      .child(h_flex().id("git-config-refresh").size(24).flex_none().items_center().justify_center().rounded(5).cursor_pointer()
        .text_size(14).text_color(busy ? t.accent : t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.load(cx)).child("↻"));
  }

  current(t, m) {
    const row = (label, which) => {
      const entry = this.entries[which], value = this.value(which);
      return h_flex().h(22).gap(8).items_center()
        .child(div().w(42).flex_none().text_size(11).text_color(t.dim).child(label))
        .child(div().flex_1().min_w(0).truncate().font_family(m).text_size(11.5).text_color(value ? t.foreground : t.dim)
          .tooltip(value).child(value || "(not set)"))
        .when(entry && value, (e) => e.child(div().flex_none().text_size(10).text_color(t.dim).child(SCOPE_LABEL[entry.scope] ?? entry.scope)));
    };
    return v_flex().flex_none().px(10).pt(8).pb(8).gap(1).border_b(1).border_color(t.border)
      .child(div().pb(2).text_size(10.5).text_color(t.dim).child("This repository"))
      .child(row("Name", "name"))
      .child(row("Email", "email"));
  }

  pairRow(pair, i, t) {
    const active = Boolean(this.value("name")) && samePair(pair, { name: this.value("name"), email: this.value("email") });
    return h_flex().id(`git-config-pair-${i}`).flex_none().px(10).py(4).gap(8).items_center().rounded(5).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(() => this.apply(pair))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().w_full().truncate().text_size(12).text_color(t.foreground).child(pair.name || "(no name)"))
        .child(div().w_full().truncate().text_size(11).text_color(t.muted).tooltip(pair.email).child(pair.email)))
      .when(active, (e) => e.child(div().flex_none().text_size(11).text_color(t.accent).child("✓")));
  }

  list(t) {
    if (!this.pairs.length) return v_flex().flex_1().min_h(0).px(10).py(10).child(div().text_size(12).text_color(t.dim).child("No saved pairs yet."));
    return v_flex().id("git-config-pairs").flex_1().min_h(0).overflow_y_scrollbar().px(4).py(4)
      .children(this.pairs.map((pair, i) => this.pairRow(pair, i, t)));
  }

  form(t) {
    const set = h_flex().id("git-config-set").h(26).flex_none().px(10).items_center().justify_center().rounded(6).cursor_pointer().text_size(12)
      .bg(t.chrome).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.applyTyped(cx)).child("Set");
    return v_flex().flex_none().px(10).py(8).gap(6).border_t(1).border_color(t.border)
      .child(div().text_size(10.5).text_color(t.dim).child("Set this repository"))
      .child(Input.new(this.name).h(26).px(8).rounded(6).border_1().border_color(t.input)
        .bg(t.background).text_size(12).text_color(t.foreground))
      .child(h_flex().gap(6).items_center()
        .child(Input.new(this.email).flex_1().h(26).px(8).rounded(6).border_1().border_color(t.input)
          .bg(t.background).text_size(12).text_color(t.foreground))
        .child(set))
      .when(this.error, (e) => e.child(div().w_full().truncate().text_size(11).text_color(t.ansi1).tooltip(this.error).child(this.error)));
  }

  render(cx) {
    const t = theme(), m = settings().font_family ?? "JetBrains Mono";
    const stamp = shared(IDENTITY_STAMP);
    if (stamp !== this.seenStamp) { this.seenStamp = stamp; if (this.root) this.load(cx); }
    return v_flex().id("re-git-config").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12.5)
      .child(this.header(t))
      .child(this.current(t, m))
      .child(this.list(t))
      .child(this.form(t));
  }
}
