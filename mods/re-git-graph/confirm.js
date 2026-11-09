// The confirm a Config change asks for first, opened over the window with props
// { role: "confirm", pair, root, on }. It writes the pair itself, so the Config
// tab only has to read the folder again when the stamp moves.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, notify, props, closeOverlay, theme, shared, setShared } from "herdr";
import { rememberPair, IDENTITY_STORE, IDENTITY_STAMP } from "./config.js";

const gitError = (result) => (result?.stderr || result?.stdout || `git exited with ${result?.code}`).trim();

export class Confirm {
  init(cx) {
    this.busy = false;
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  set(cx) {
    if (this.busy) return;
    const { pair, root, on, overlay } = props();
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

  render() {
    const t = theme(), p = props() ?? {}, pair = p.pair ?? {};
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("re-git-config-confirm").track_focus(this.handle).size_full().min_h(0).p(18).gap(10)
      .bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.set(cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Set this identity?"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(v_flex().gap(1)
        .child(div().text_size(13).font_medium().child(pair.name ?? ""))
        .child(div().text_size(12).text_color(t.muted).child(pair.email ?? "")))
      .child(div().text_size(11.5).text_color(t.muted).child("Writes user.name and user.email to this repository's config."))
      .when(Boolean(p.root), (e) => e.child(div().w_full().truncate().text_size(11).text_color(t.dim).tooltip(p.root ?? "").child(p.root ?? "")))
      .when(Boolean(this.error), (e) => e.child(div().w_full().text_size(11.5).text_color(t.ansi1).tooltip(this.error).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().justify_end().gap(8)
        .child(button("re-git-config-confirm-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("re-git-config-confirm-set", this.busy ? "Setting…" : "Set identity", true, (_e, cx) => this.set(cx))));
  }
}
