// The Git panel: the graph, the Pull request view and Git config as tabs in
// one pane, so Review switches what the panel shows instead of splitting a
// pane beside it. Local changes are the graph's own uncommitted row. The
// review and config views are made with the shell and stay idle until their
// tab comes to the front.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared } from "herdr";
import { Graph } from "./graph.js";
import { ConfigView } from "./config-view.js";
import Review from "./review.js";

// `re-tabs.review` (cmd-shift-r) asks for "changes", `re-tabs.config` for
// "config". The panel can be mounted by the request, so it sets the tab after
// the next render.
const TAB_REQUEST = "re-git-graph.tab";
const REQUEST_FRESH_MS = 10000;

const TABS = [["graph", "Git"], ["pr", "Pull request"], ["config", "Config"]];

export class Shell {
  init(cx) {
    this.tab = "graph";
    this.seenRequest = 0;
    this.closed = false;
    this.graph = new Graph();
    this.graph.init(cx);
    this.graph.embedded = true;
    // Made here, where focus handles are allowed; they stay idle until their
    // tab comes to the front, so a render never creates one.
    this.review = new Review();
    this.review.init({ embedded: true, active: false }, cx);
    this.config = new ConfigView();
    this.config.init(cx);
  }

  close(cx) {
    this.closed = true;
    this.review?.close?.(cx);
    this.config?.close?.(cx);
  }

  show(tab, cx) {
    if (!this.tabsShown().some(([id]) => id === tab)) tab = "graph";
    this.tab = tab;
    if (tab === "graph") {
      this.review.active = false;
      this.graph.handle?.focus?.();
    } else if (tab === "pr") {
      this.review.setTab("pr", cx);
      this.review.focus(cx);
    } else {
      this.review.active = false;
      this.config.open(this.graph.root || this.graph.cwd, this.graph.on, cx);
    }
    cx.notify();
  }

  tabButton(id, label, active, click, t) {
    return h_flex().id(id).h(26).px(10).items_center().rounded(6).cursor_pointer().text_size(12)
      .when(active, (e) => e.bg(t.selected).text_color(t.foreground))
      .when(!active, (e) => e.bg(t.chrome).text_color(t.muted))
      .hover((s) => s.bg(t.hover))
      .on_click(click).child(label);
  }

  // The Config tab sets one repository's identity. A folder that isn't one, or
  // the list of repositories under it, has nothing to set, so the tab stays out
  // of the row until a repository is in front. While the first read runs the
  // row keeps its tabs, so they don't flicker in.
  tabsShown() {
    const known = this.graph.root || this.graph.state === "loading";
    return known ? TABS : TABS.filter(([id]) => id !== "config");
  }

  tabs(list, t, cx) {
    return h_flex().h(34).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
      .children(list.map(([id, label]) => this.tabButton(`re-git-graph-tab-${id}`, label, this.tab === id, (_e, cx) => this.show(id, cx), t)));
  }

  // A shortcut set the request while another tab was in front (or before this
  // panel was mounted); ignore one that is no longer fresh. The switch runs
  // after this render, where focusing a handle is allowed.
  takeRequest(cx) {
    const request = shared(TAB_REQUEST);
    if (!request?.at || request.at === this.seenRequest) return;
    this.seenRequest = request.at;
    if (Date.now() - request.at < REQUEST_FRESH_MS) cx.timer.after(0, (cx) => this.openRequest(request.tab, cx));
  }

  openRequest(tab, cx) {
    if (tab === "changes") this.openChanges(cx);
    else if (tab === "pr") this.show("pr", cx);
    else if (tab === "config") this.show("config", cx);
    else this.show("graph", cx);
  }

  // cmd-shift-r: the Git tab, landed on the worktree's uncommitted row. The
  // history may still be loading (the panel can be mounted by this request),
  // so try again briefly.
  openChanges(cx, tries = 0) {
    if (tries === 0) this.show("graph", cx);
    if (this.graph.showUncommitted(cx)) return;
    if (!this.closed && tries < 15) cx.timer.after(200, (cx) => this.openChanges(cx, tries + 1));
  }

  render(cx) {
    this.takeRequest(cx);
    const t = theme(), list = this.tabsShown();
    // The folder left its repository while Config was in front: show the graph,
    // and take the keyboard there after this render.
    if (!list.some(([id]) => id === this.tab)) {
      this.tab = "graph";
      this.review.active = false;
      cx.timer.after(0, (cx) => this.graph.handle?.focus?.());
    }
    const part = this.tab === "graph" ? this.graph.render(cx) : this.tab === "pr" ? this.review.render(cx) : this.config.render(cx);
    return v_flex().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .child(this.tabs(list, t, cx))
      .child(div().flex_1().min_h(0).child(part));
  }
}
