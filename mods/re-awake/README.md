# re-awake

Keeps this Mac awake: **On** always, **Agent** while an agent on this computer
is working, **Off** never. Written for the Real Engineer layout, which puts it
in a 30px block above the sidebar footer.

macOS only, through tools that ship with it:

- `launchctl submit -l herdr-awake -- /usr/bin/caffeinate -i -s -w <pid> -t 3600`
  starts the assertion. `-w` ties it to Herdr's own process, so quitting Herdr
  lets go; `-t` bounds it in case that pid is ever reused.
- `launchctl remove herdr-awake` stops it.
- The pid comes from `ps -A -o pid=,comm=`, because `pgrep` can't see the app
  from inside a mod.
- "Working" is Herdr's own status: `agents()` in spaces on this computer
  (`space.machine === null`), plus `terminals()` on this computer (a bare
  address). The second catches sub-agents started with `hc run`, which have
  no pane and keep working while their parent sits idle.

`caffeinate -i -s` stops idle and system sleep on AC power. It doesn't stop
display sleep and it can't hold the Mac awake through a closed lid.

State lives in `shared("awake")` as `{ mode: "on" | "auto" | "off" }`, so the
Forager layout's `fg-awake` shows and drives the same setting. Both mods use
the one `herdr-awake` launchctl job; reading an older `re-awake` or `fg-awake`
key happens once, as a migration. `cmd-shift-a` cycles it (`mods/re-awake` key
`re-awake.cycle`).

`herdr-app check mods/re-awake` loads it; `launchctl list herdr-awake` and
`pmset -g assertions` show what it really did.
