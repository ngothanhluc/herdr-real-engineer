# re-tabs

Herdr's `tabs` mod from app 0.1.13 (Apache-2.0, part of
[herdrdev/herdr-app](https://github.com/herdrdev/herdr-app)), renamed and
changed for the Real Engineer layout. The Apache-2.0 text is in
[../../LICENSE-APACHE-2.0.txt](../../LICENSE-APACHE-2.0.txt).

Changed here:

- The mod, its keys and its localStorage entry are named `re-tabs`, so it sits
  beside Herdr's own `tabs` instead of replacing it.
- A **Graph** button follows Files and Changes, and shows only when the layout
  has a `graph` node.
- Each panel button opens its panel, switches an open panel to it, or closes
  the panel when it already shows that view. The choice is kept per space.
- The key commands `re-tabs.files` and `re-tabs.graph` do the same from
  `nextCommand`.

Everything else is Herdr's mod as shipped. `main.js` says at the top that it
was changed.
