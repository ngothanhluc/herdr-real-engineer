// The diff as it is drawn: paired rows with a number and a sign on each side,
// a filler where only one side has a line, and the changed words marked. Used
// by the review tab and by the commit details strip, so both read the same.
import { div } from "gpui-kit";
import { h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { ROW, NUM, SIGN, PAD, DIVIDER } from "./diff-view.js";

// An explicit width per cell: flex children let the first cell's content set
// the row's width and pushed the second column out of sight.
function cell(side, t, mono, width) {
  if (!side) return div().w(width).flex_none().h_full();
  if (side.fill) return div().w(width).flex_none().h_full().bg(t.raised);
  return h_flex().w(width).flex_none().min_w(0).h_full()
    .when(side.kind === "+", (e) => e.bg(t.ansi2 + "1a"))
    .when(side.kind === "-", (e) => e.bg(t.ansi1 + "1a"))
    .child(div().w(NUM).flex_none().pr(6).text_right().text_color(t.dim).child(side.number))
    .child(div().w(SIGN).flex_none().text_color(side.kind === "+" ? t.ansi2 : side.kind === "-" ? t.ansi1 : t.dim).child(side.sign))
    .child(div().flex_1().min_w(0).overflow_hidden().child(text(side, t, mono)));
}

function text(side, t, mono) {
  const body = div().h_full().font_family(mono).text_size(12).truncate();
  if (!side.hot) return body.child(side.text || " ");
  const [start, end] = side.hot;
  return h_flex().h_full().min_w(0).overflow_hidden().font_family(mono).text_size(12)
    .when(start > 0, (e) => e.child(div().flex_none().child(side.text.slice(0, start))))
    .child(div().flex_none().child(side.text.slice(start, end)).when(side.kind === "+", (e) => e.bg(t.ansi2 + "4d")).when(side.kind === "-", (e) => e.bg(t.ansi1 + "4d")))
    .when(end < side.text.length, (e) => e.child(div().flex_none().child(side.text.slice(end))));
}

function row(item, t, mono, side) {
  if (item.kind === "span") {
    return div().w_full().h(ROW).flex_none().px(PAD).truncate().bg(t.raised).text_color(t.dim).font_family(mono).text_size(11.5).child(item.text);
  }
  const [left, right] = item.sides;
  if (!item.split) return h_flex().w_full().h(ROW).flex_none().px(PAD).child(cell(left, t, mono, side));
  return h_flex().w_full().h(ROW).flex_none().px(PAD)
    .child(cell(left, t, mono, side))
    .child(div().w(DIVIDER).h_full().flex_none().bg(t.border))
    .child(cell(right, t, mono, side));
}

// The scrolling rows for a pane `width` px wide. Split columns stay half the
// pane, so a line past the edge is read with alt+z rather than by scrolling the
// right column out of sight. One column grows to its longest line instead.
export function diffList({ view, wrap, width, id, t, mono }) {
  const inner = Math.max(0, width - PAD * 2);
  const side = view.split ? Math.max(80, Math.floor((inner - DIVIDER) / 2)) : wrap ? inner : Math.max(inner, view.sideWidth);
  const scroll = wrap || view.split ? 0 : view.contentWidth;
  return div().size_full().min_h(0).relative()
    .child(div().id(id).size_full().when(!wrap, (el) => el.overflow_x_scrollbar())
      .child(div().w_full().min_w(scroll).h_full()
        .child(v_virtual_list(id, view.items.length, ROW, (i) => String(i),
          (range) => view.items.slice(range.start, range.end).map((item) => row(item, t, mono, side))).size_full())))
    .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
}

// The chip that cycles automatic, side by side and inline, and the one that
// toggles wrapping. Same labels and order on both surfaces.
export function diffChip(id, label, active, click, t, rounded) {
  return div().id(id).px(7).py(1).rounded(rounded).border_1().border_color(active ? t.accent : t.border)
    .text_size(10).cursor_pointer().text_color(active ? t.accent : t.muted)
    .hover((el) => el.bg(t.hover).text_color(t.foreground)).on_click(click).child(label);
}
