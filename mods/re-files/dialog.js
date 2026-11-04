// A menu action's dialog, opened with props { role: "dialog", kind, target, ctx }:
// a name to type, a delete to confirm, the editor command, or unsaved edits to
// save or discard ("leave", answered to the panel through its commands).
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, exec, run, setShared } from "herdr";
import { dialogFor, performDialog } from "./ops.js";
import { changed, editorCommand } from "./menu.js";

export class Dialog {
  init(cx) {
    const { kind, target, ctx } = props();
    this.spec = dialogFor(kind, target, ctx, editorCommand());
    this.handle = cx.focus_handle();
    if (this.spec.input) {
      const value = this.spec.input.value;
      this.input = InputState.new({ value });
      this.input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.confirm(cx));
      // Selects the stem, as Finder does, so typing keeps the extension.
      const dot = target.kind === "file" && kind === "rename" ? value.lastIndexOf(".") : -1;
      if (value) this.input.set_selected_range({ start: 0, end: dot > 0 ? dot : value.length });
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    } else this.handle.focus();
  }

  confirm(cx) {
    if (this.busy) return;
    const { kind, target, ctx, overlay } = props();
    const value = this.input?.value() ?? "";
    if (kind === "leave") { closeOverlay(overlay); run("re-files.leave-save"); return; }
    if (kind === "editor") {
      if (!value.trim()) { this.error = "Type a command."; cx.notify(); return; }
      setShared("re-files.editor", value.trim());
      closeOverlay(overlay);
      return;
    }
    this.busy = true; this.error = null;
    cx.spawn(async (cx) => {
      let result;
      try { result = await performDialog(kind, value, target, ctx, exec); }
      catch (e) { result = { ok: false, message: String(e?.message ?? e) }; }
      this.busy = false;
      if (result.ok) { changed(ctx, result); closeOverlay(overlay); }
      else this.error = result.message;
      cx.notify();
    });
    cx.notify();
  }

  render() {
    const t = theme(), s = this.spec, danger = Boolean(s.danger);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? (danger ? t.ansi1 : t.solid) : t.input).bg(primary ? (danger ? t.ansi1 : t.solid) : t.raised)
      .text_color(primary ? (danger ? t.background : t.solid_foreground) : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((st) => st.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("re-files-dialog").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter" && !this.input) this.confirm(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(s.title)).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(Boolean(s.detail), (el) => el.child(div().pt(8).text_color(t.muted).child(s.detail)))
      .when(Boolean(this.input), (el) => el.child(div().pt(14).pb(7).text_size(11.5).text_color(t.dim).child(s.input.label))
        .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().pt(12).text_size(12).text_color(t.ansi1).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(button("fd-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .when(Boolean(s.discard), (el) => el.child(button("fd-discard", s.discard, false, () => { closeOverlay(props().overlay); run("re-files.leave-discard"); })))
        .child(button("fd-ok", this.busy ? "Working…" : s.confirm, true, (_e, cx) => this.confirm(cx))));
  }
}
