// The identity dialog, opened over the window in two shapes: with
// props { role: "confirm", pair, root, on } it confirms one pair before a
// change from the Config tab; with { role: "confirm", mode: "setup", root, on,
// inherited } it asks a repository without an identity of its own to pick one.
// Both write the pair and move the stamp the Config tab reloads on.
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { exec, notify, props, closeOverlay, theme, shared, setShared } from "herdr";
import { pairsOf, rememberPair, SCOPE_LABEL, IDENTITY_STORE, IDENTITY_STAMP } from "./config.js";

const gitError = (result) => (result?.stderr || result?.stdout || `git exited with ${result?.code}`).trim();

export class Confirm {
  init(cx) {
    const p = props() ?? {};
    this.mode = p.mode === "setup" ? "setup" : "confirm";
    this.busy = false;
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (this.mode === "setup") {
      const inherited = p.inherited ?? {};
      this.pairs = pairsOf(shared(IDENTITY_STORE));
      this.name = InputState.new({ value: inherited.name ?? "", placeholder: "Name" });
      this.email = InputState.new({ value: inherited.email ?? "", placeholder: "Email" });
      for (const input of [this.name, this.email]) input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      this.name.on("submit", () => this.email.focus());
      this.email.on("submit", (_e, cx) => this.setTyped(cx));
      this.name.focus();
      cx.timer.after(300, () => this.name.focus());
    }
  }

  later() {
    closeOverlay(props().overlay);
  }

  // Only the local config is written: the global name and email stay as they
  // are, so another repository can keep its own identity.
  set(pair, cx) {
    if (this.busy) return;
    const { root, on, overlay } = props();
    this.busy = true;
    this.error = null;
    cx.spawn(async (cx) => {
      for (const [key, value] of [["user.name", pair.name], ["user.email", pair.email]]) {
        let result;
        try {
          result = await exec("git", ["--no-optional-locks", "config", "--local", key, value], { cwd: root, on });
        } catch (e) {
          result = { code: -1, stderr: String(e?.message ?? e) };
        }
        if (result.code !== 0) {
          this.busy = false;
          this.error = gitError(result);
          cx.notify();
          return;
        }
      }
      setShared(IDENTITY_STORE, rememberPair(shared(IDENTITY_STORE), pair));
      setShared(IDENTITY_STAMP, Date.now());
      notify({ title: "Identity set", body: `${pair.name} <${pair.email}>`, level: "success" });
      closeOverlay(overlay);
    });
    cx.notify();
  }

  setTyped(cx) {
    const pair = { name: this.name.value().trim(), email: this.email.value().trim() };
    if (!pair.name || !pair.email) {
      this.error = "A name and an email are both needed.";
      cx.notify();
      return;
    }
    this.set(pair, cx);
  }

  button(t, id, text, primary, action) {
    return h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
  }

  frame(t, p, title) {
    return v_flex().id("re-git-config-confirm").track_focus(this.handle).size_full().min_h(0).p(18).gap(10)
      .bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "escape") this.later();
        else if (e.key === "enter" && this.mode === "confirm") this.set(p.pair, cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(title))
        .child(div().text_size(11).text_color(t.dim).child("Esc")));
  }

  render() {
    const t = theme(), p = props() ?? {};
    return this.mode === "setup" ? this.setup(t, p) : this.confirm(t, p);
  }

  confirm(t, p) {
    const pair = p.pair ?? {};
    return this.frame(t, p, "Set this identity?")
      .child(v_flex().gap(1)
        .child(div().text_size(13).font_medium().child(pair.name ?? ""))
        .child(div().text_size(12).text_color(t.muted).child(pair.email ?? "")))
      .child(div().text_size(11.5).text_color(t.muted).child("Writes user.name and user.email to this repository's config."))
      .when(Boolean(p.root), (e) => e.child(div().w_full().truncate().text_size(11).text_color(t.dim).tooltip(p.root ?? "").child(p.root ?? "")))
      .when(Boolean(this.error), (e) => e.child(div().w_full().text_size(11.5).text_color(t.ansi1).tooltip(this.error).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().justify_end().gap(8)
        .child(this.button(t, "re-git-config-confirm-cancel", "Cancel", false, () => this.later()))
        .child(this.button(t, "re-git-config-confirm-set", this.busy ? "Setting…" : "Set identity", true, (_e, cx) => this.set(pair, cx))));
  }

  setup(t, p) {
    const inherited = p.inherited ?? {}, known = Boolean(inherited.name || inherited.email);
    const rows = this.pairs.map((pair, i) => h_flex().id(`re-git-config-pick-${i}`).flex_none().px(4).py(4).gap(8).items_center().rounded(5).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.set(pair, cx))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().w_full().truncate().text_size(12).text_color(t.foreground).child(pair.name || "(no name)"))
        .child(div().w_full().truncate().text_size(11).text_color(t.muted).child(pair.email))));
    return this.frame(t, p, "Set this repository's identity")
      .child(v_flex().gap(1).pb(2)
        .child(div().text_size(11).text_color(t.dim).child(known ? "Borrowed from the wider config" : "No identity anywhere yet"))
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12.5)
            .child(known ? `${inherited.name || "(no name)"} <${inherited.email || "(no email)"}>` : "Git cannot commit here until this is set."))
          .when(known && Boolean(inherited.scope), (e) => e.child(div().flex_none().text_size(10).text_color(t.dim).child(SCOPE_LABEL[inherited.scope] ?? inherited.scope)))))
      .child(div().text_size(10.5).text_color(t.dim).child("Pick one you used before"))
      .child(v_flex().id("re-git-config-picks").flex_1().min_h(0).overflow_y_scrollbar()
        .when(!this.pairs.length, (e) => e.child(div().py(4).text_size(11.5).text_color(t.dim).child("No saved pairs yet.")))
        .children(rows))
      .child(v_flex().gap(6)
        .child(Input.new(this.name).h(30).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))
        .child(Input.new(this.email).h(30).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground)))
      .when(Boolean(this.error), (e) => e.child(div().w_full().text_size(11.5).text_color(t.ansi1).tooltip(this.error).child(this.error)))
      .child(h_flex().justify_end().gap(8)
        .child(this.button(t, "re-git-config-later", "Later", false, () => this.later()))
        .child(this.button(t, "re-git-config-setup-set", this.busy ? "Setting…" : "Set identity", true, (_e, cx) => this.setTyped(cx))));
  }
}
