// The graph's find bar (cmd-f or the search button), as VS Code Git Graph's:
// rows that match are highlighted, never hidden. Enter/shift-Enter step through
// them; stepping past the last loaded match loads more history, up to FIND_MAX commits.
import { div, svg } from "gpui-kit";
import { h_flex, InputState, Input } from "gpui-base";
import { icon } from "./menu.js";
import { findMatches, FIND_MAX } from "./query.js";

export class FindBar {
  // graph: the Graph; it calls update() after each build and reads matches/cursor to draw rows.
  constructor(graph) {
    this.graph = graph;
    this.query = ""; this.matches = []; this.set = new Set(); this.cursor = -1; this.pending = null;
    this.state = InputState.new({ placeholder: "Find commits" });
    this.state.on("change", (_e, cx) => { this.query = this.state.value(); this.pending = null; this.update(); this.cursor = this.matches.length ? 0 : -1; this.reveal(); cx.notify(); });
    this.state.on("submit", (e, cx) => { this.step(e.shift ? -1 : 1, cx); cx.notify(); });
  }

  focus() { this.state.set_selected_range({ start: 0, end: this.state.value().length }); this.state.focus(); }

  // The history changed (a page loaded, a refresh): match again, and finish a step that waited for more.
  update() {
    const g = this.graph;
    this.matches = findMatches(g.commits, this.query); this.set = new Set(this.matches);
    if (this.cursor >= this.matches.length) this.cursor = this.matches.length - 1;
    const p = this.pending;
    if (!p) return;
    if (this.matches.length > p.count) { this.pending = null; this.cursor = p.count; this.reveal(); }
    else if (!this.more()) { this.pending = null; this.cursor = this.matches.length ? 0 : -1; this.reveal(); }
    // The load that built this is still finishing: `again` reads once more, with the new limit.
    else { g.findMore(); g.again = "full"; }
  }

  more() { return this.graph.hasMore && this.graph.limit < FIND_MAX; }
  capped() { return this.graph.hasMore && this.graph.limit >= FIND_MAX; }

  step(dir, cx) {
    if (!this.query.trim() || this.pending) return;
    const n = this.matches.length;
    if (dir > 0 && (n === 0 || this.cursor >= n - 1) && this.more()) {
      this.pending = { count: n };
      this.graph.findMore();
      this.graph.refresh(cx);
      return;
    }
    if (!n) return;
    this.cursor = (this.cursor + dir + n) % n;
    this.reveal();
  }

  reveal() { if (this.cursor >= 0) this.graph.scroll.scroll_to_item(this.matches[this.cursor], "center"); }
  current() { return this.cursor >= 0 ? this.matches[this.cursor] : -1; }

  status() {
    if (this.pending) return "Searching…";
    if (!this.query.trim()) return "";
    const where = this.capped() ? ` · searched ${FIND_MAX} commits` : "";
    return (this.matches.length ? `${this.cursor + 1}/${this.matches.length}` : "No results") + where;
  }

  render(t, close) {
    const button = (id, glyph, action) => div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(action).child(svg(icon(glyph)).size(13));
    return h_flex().h(34).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(cx); cx.stop_propagation(); } })
      .child(svg(icon("search")).size(13).flex_none().text_color(t.muted))
      .child(Input.new(this.state).flex_1().min_w(100).h(24).px(6).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))
      .child(div().min_w(0).truncate().text_size(11.5).text_color(this.query.trim() && !this.matches.length && !this.pending ? t.ansi1 : t.dim).child(this.status()))
      .child(button("graph-find-prev", "chevron-up", (_e, cx) => { this.step(-1, cx); cx.notify(); }))
      .child(button("graph-find-next", "chevron-down", (_e, cx) => { this.step(1, cx); cx.notify(); }))
      .child(button("graph-find-close", "close", (_e, cx) => close(cx)));
  }
}
