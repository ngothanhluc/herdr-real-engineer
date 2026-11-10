// The tree's right-click menu, opened as a popup at the pointer with props
// { role: "menu", target, ctx }. Styled like re-git-graph's (Herdr's own menu).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, notify, theme, run, exec, shared, setShared } from "herdr";
import { menuFor, menuHeight, dialogFor, dialogHeight, duplicate } from "./ops.js";

const icon = (name) => `mods/re-files/icons/${name}.svg`;
export const editorCommand = () => shared("re-files.editor") || "code";

// Tells the panel to reload its tree and show `reveal` (a rel path).
export const changed = (ctx, result) => setShared("re-files.changed", { at: Date.now(), root: ctx.root, reveal: result.reveal ?? null, open: Boolean(result.open) });

export function openMenu(target, ctx) {
  openOverlay({ mod: "re-files", kind: "popup", at: "pointer", width: 240, height: menuHeight(menuFor(target, ctx)), props: { role: "menu", target, ctx } });
}

export function openDialog(kind, target, ctx) {
  const spec = dialogFor(kind, target, ctx, editorCommand());
  openOverlay({ mod: "re-files", kind: "dialog", width: 420, height: dialogHeight(spec), props: { role: "dialog", kind, target, ctx } });
}

async function openInEditor(path) {
  let r;
  try { r = await exec(editorCommand(), [path]); }
  catch { r = await exec("open", ["-a", "Visual Studio Code", path]); }
  if (r.code !== 0) notify({ title: "Couldn't open the editor", body: (r.stderr || r.stdout).trim(), level: "error" });
}

export class Menu {
  init(cx) {
    const { target, ctx } = props();
    this.items = menuFor(target, ctx);
    this.at = -1;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i, cx) {
    const it = this.items[i], { overlay, target, ctx } = props();
    if (!it || it.separator || this.busy !== undefined) return;
    const a = it.action(target, ctx);
    if (a.type === "copy") {
      cx.write_to_clipboard(a.text);
      closeOverlay(overlay);
      notify({ title: "Copied", body: a.text, level: "success", timeout: 2000 });
    } else if (a.type === "tab") {
      closeOverlay(overlay);
      run("tab.new", { folder: a.folder });
    } else if (a.type === "dialog") {
      closeOverlay(overlay);
      openDialog(a.kind, target, ctx);
    } else {
      // Runs here, then closes: a closed popup's tasks would be cancelled.
      this.busy = i;
      cx.spawn(async (cx) => {
        try {
          if (a.type === "editor") await openInEditor(a.path);
          else if (a.type === "exec") await exec(a.argv[0], a.argv.slice(1), { on: ctx.on });
          else if (a.type === "duplicate") {
            const result = await duplicate(target, ctx, exec);
            if (result.ok) changed(ctx, result);
            else notify({ title: "Couldn't duplicate", body: result.message, level: "error" });
          }
        } catch (e) { notify({ title: "Couldn't do that", body: String(e?.message ?? e), level: "error" }); }
        closeOverlay(overlay);
        cx.notify();
      });
    }
    cx.notify();
  }

  move(step) {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.at + step * k + n * 2) % n;
      if (!this.items[i].separator) { this.at = i; return; }
    }
  }

  render(cx) {
    const t = theme();
    return v_flex().id("re-files-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.move(1);
        else if (e.key === "up") this.move(-1);
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(this.items.map((it, i) => it.separator
        ? div().mx(7).my(4).h(1).flex_none().bg(t.border)
        : h_flex().id(`fm-${i}`).h(30).flex_none().px(8).gap(9).rounded(7).items_center().cursor_pointer()
          .text_color(it.danger ? t.ansi1 : t.foreground)
          .when(i === this.at || this.busy === i, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(i, cx))
          .child(svg(icon(it.icon)).size(14).flex_none().text_color(it.danger ? t.ansi1 : t.muted))
          .child(div().flex_1().min_w(0).truncate().child(this.busy === i ? "Working…" : it.label))));
  }
}
