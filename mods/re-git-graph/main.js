import { View } from "gpui-kit";
import { props } from "herdr";
import { Graph } from "./graph.js";
import { Menu } from "./menu.js";
import { Dialog } from "./dialog.js";
import { Update } from "./update.js";
import { Settings } from "./settings.js";
import { Branches } from "./branches.js";
import Review from "./review.js";

// One mod, several roles: the graph (a panel or a pane), the review pane
// (`props.view`), and over the window the right-click menu, the dialogs its
// actions ask first, the update window, the Git Graph settings and the branch
// filter (props.role).
export default class GitGraph extends View {
  init(_props, cx) {
    if (props()?.view === "review") {
      this.part = new Review();
      this.part.init(null, cx);
      return;
    }
    const role = props()?.role;
    this.part = role === "menu" ? new Menu() : role === "dialog" ? new Dialog() : role === "update" ? new Update() : role === "settings" ? new Settings() : role === "branches" ? new Branches() : new Graph();
    this.part.init(cx);
  }

  close(cx) { this.part?.close?.(cx); }

  render(cx) { return this.part.render(cx); }
}
