# re-tabs

The tab bar for the Real Engineer layout. It starts from Herdr's shipped
`tabs` mod; `sync/re-tabs.patch` holds the local delta. The Apache-2.0 text is
in [../../LICENSE-APACHE-2.0.txt](../../LICENSE-APACHE-2.0.txt).

Changed here:

- The mod, its keys and its localStorage entry are named `re-tabs`, so it sits
  beside Herdr's own `tabs` instead of replacing it.
- A **Graph** button follows Files and Changes, and shows only when the layout
  has a `graph` node.
- Each panel button opens its panel, switches an open panel to it, or closes
  the panel when it already shows that view. The choice is kept per space.
- The key commands `re-tabs.files` and `re-tabs.graph` do the same from
  `nextCommand`.

Everything else is the shipped tab bar. After a Herdr update, run
`node tools/sync.mjs --check`.
