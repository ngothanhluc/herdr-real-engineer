import { View } from "gpui-kit";
import { props } from "herdr";
import { Menu } from "./menu.js";
import { Dialog } from "./dialog.js";
import { Update } from "./update.js";
import { Settings } from "./settings.js";
import { Branches } from "./branches.js";
import { Confirm } from "./confirm.js";
import { Shell } from "./shell.js";
import Review from "./review.js";
import DiffWindow from "./diff-window.js";

// One mod, several roles: the Git panel (a shell with the graph and the
// review view as tabs), a review pane opened by a layout without a Git
// block (`props.view`), and over the window the right-click menu, the dialogs
// its actions ask first, the identity confirm, the update window, the Git
// settings and the branch filter (props.role).
export default class GitGraph extends View {
  init(_props, cx) {
    if (props()?.view === "review") {
      this.part = new Review();
      this.part.init(null, cx);
      return;
    }
    const role = props()?.role;
    this.part = role === "menu" ? new Menu() : role === "dialog" ? new Dialog() : role === "update" ? new Update() : role === "settings" ? new Settings() : role === "branches" ? new Branches() : role === "confirm" ? new Confirm() : role === "diff" ? new DiffWindow() : new Shell();
    this.part.init(cx);
  }

  close(cx) { this.part?.close?.(cx); }

  render(cx) { return this.part.render(cx); }
}
