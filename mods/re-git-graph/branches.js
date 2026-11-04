// The branch filter's popup, opened from the toolbar with props
// { role: "branches", key, heads, remotes } (full ref names; remotes empty when
// hidden). It writes the choice to shared("re-git-graph.branches")[key] at once;
// the graph reads it from there.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";
import { ALL, CURRENT, normalizeFilter, toggleRef, shortRef } from "./query.js";
import { icon } from "./menu.js";

export const STORE = "re-git-graph.branches";
const ROW = 28, SHOWN = 10;
// The list scrolls past SHOWN rows; a popup doesn't grow a flex child, so the list has a fixed height.
const listHeight = (rows) => Math.max(1, Math.min(rows, SHOWN)) * ROW;
export const branchesHeight = (count) => 6 + 30 + 4 + listHeight(count + 2) + 6;

export class Branches {
  init(cx) {
    this.state = InputState.new({ placeholder: "Filter branches" });
    this.at = 0;
    this.state.on("change", (_e, cx) => { this.at = 0; cx.notify(); });
    this.state.on("submit", (_e, cx) => { this.choose(this.rows()[this.at]); cx.notify(); });
    this.state.focus();
    cx.timer.after(300, () => this.state.focus());
  }

  filter() {
    const { key, heads, remotes } = props();
    return normalizeFilter(shared(STORE)?.[key], [...heads, ...remotes]);
  }

  rows() {
    const { heads, remotes } = props(), q = this.state.value().trim().toLowerCase();
    const named = [...heads, ...remotes].filter((r) => shortRef(r).toLowerCase().includes(q)).map((ref) => ({ ref }));
    return [...(q ? [] : [{ kind: "all" }, { kind: "current" }]), ...named];
  }

  choose(row) {
    if (!row) return;
    const f = this.filter(), next = row.ref ? toggleRef(f, row.ref) : row.kind === "all" ? ALL : CURRENT;
    setShared(STORE, { ...(shared(STORE) ?? {}), [props().key]: next });
  }

  render() {
    const t = theme(), f = this.filter(), rows = this.rows();
    const on = (row) => (row.ref ? f.kind === "refs" && f.refs.includes(row.ref) : f.kind === row.kind);
    const box = (checked) => div().size(13).flex_none().rounded(3).border_1().border_color(checked ? t.accent : t.input).when(checked, (e) => e.bg(t.accent))
      .flex().items_center().justify_center().when(checked, (e) => e.child(svg(icon("check")).size(10).text_color(t.accent_foreground)));
    return v_flex().id("re-git-graph-branches").size_full().p(6).gap(4).bg(t.popover).text_size(12).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (e.key === "up") this.at = Math.max(this.at - 1, 0);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(Input.new(this.state).h(30).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))
      .child(v_flex().id("gb-rows").h(listHeight(rows.length)).flex_none().overflow_y_scrollbar()
        .when(!rows.length, (e) => e.child(div().h(ROW).px(8).flex().items_center().text_color(t.dim).child("No branches match")))
        .children(rows.map((row, i) => h_flex().id(`gb-${i}`).h(ROW).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .when(i === this.at, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.at = i; this.choose(row); cx.notify(); })
          .child(box(on(row)))
          .when(Boolean(row.ref), (e) => e.child(svg(icon(row.ref?.startsWith("refs/remotes/") ? "cloud" : "branch")).size(12).flex_none().text_color(t.muted)))
          .child(div().flex_1().min_w(0).truncate().when(!row.ref, (e) => e.font_medium())
            .child(row.ref ? shortRef(row.ref) : row.kind === "all" ? "All branches" : "Current")))));
  }
}
