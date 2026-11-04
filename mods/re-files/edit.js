// Editing the preview of a local file. The panel holds `edit`:
// { path (absolute), original (the text on disk as last read or written),
//   conflict: null | { disk } (the disk changed under the edits; disk null: it's gone) }.
// Dirty is derived (the editor's text differs from original), so no event can leave it stale.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { readTextFile, writeTextFile, notify, nextCommand, openOverlay, theme } from "herdr";
import { dialogFor, dialogHeight } from "./ops.js";

export function track(code, path, original) {
  code.on("change", (_e, cx) => cx.notify());
  return { path, original, conflict: null };
}

export const dirty = (view) => Boolean(view.edit && view.code && view.code.value() !== view.edit.original);

// Writes the editor's text if the disk still holds `expected`; else records the conflict.
function write(view, expected, cx, then) {
  const { code, edit } = view;
  if (!code || !edit || edit.saving) return;
  const value = code.value();
  edit.saving = true;
  cx.spawn(async (cx) => {
    try {
      await writeTextFile(edit.path, value, expected);
      edit.original = value; edit.conflict = null;
      if (view.edit === edit) then?.(cx);
    } catch (e) {
      const disk = await readTextFile(edit.path).catch(() => undefined);
      if (disk !== undefined && disk !== expected) edit.conflict = { disk };
      else notify({ title: "Couldn't save", body: String(e?.message ?? e), level: "error" });
    } finally {
      edit.saving = false;
      cx.notify();
    }
  });
}

export const save = (view, cx, then) => write(view, view.edit?.original, cx, then);

export function leave(view, cx) {
  if (!dirty(view)) { view.show(null); cx.notify(); return; }
  const target = { kind: "file", rel: view.file, name: view.file.split("/").pop() }, ctx = { root: view.root, on: view.on };
  openOverlay({ mod: "re-files", kind: "dialog", modal: true, width: 420, height: dialogHeight(dialogFor("leave", target, ctx)), props: { role: "dialog", kind: "leave", target, ctx } });
}

// Key commands (keys.json "mod:re-files") and the leave dialog's answers.
export function listen(view, cx) {
  cx.spawn(async (cx) => {
    for (;;) {
      const command = await nextCommand();
      if (command === "save") save(view, cx);
      else if (command === "leave-save") save(view, cx, () => view.show(null));
      else if (command === "leave-discard") view.show(null);
      cx.notify();
    }
  });
}

export function conflictBar(view, t = theme()) {
  const { edit } = view;
  const button = (id, text, action) => h_flex().id(id).h(24).px(10).items_center().rounded(6).border_1().border_color(t.input).bg(t.raised)
    .text_size(12).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(action).child(text);
  return h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).bg(t.raised).text_size(12)
    .child(div().flex_1().min_w(0).truncate().text_color(t.blocked).child(edit.conflict.disk === null ? "File deleted on disk" : "File changed on disk"))
    .child(button("files-reload", "Reload", (_e, cx) => { view.show(view.file, cx); cx.notify(); }))
    .child(button("files-overwrite", "Overwrite", (_e, cx) => write(view, edit.conflict.disk, cx)));
}
