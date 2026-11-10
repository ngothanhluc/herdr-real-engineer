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
- "Working" is Herdr's own `agents()` status, counted for spaces on this
  computer only (`space.machine === null`).

`caffeinate -i -s` stops idle and system sleep on AC power. It doesn't stop
display sleep and it can't hold the Mac awake through a closed lid.

State lives in `shared("re-awake")` as `{ mode: "on" | "auto" | "off" }`.
`cmd-shift-a` cycles it (`mods/re-awake` key `re-awake.cycle`).

`herdr-app check mods/re-awake` loads it; `launchctl list herdr-awake` and
`pmset -g assertions` show what it really did.
