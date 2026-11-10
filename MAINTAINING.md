# Maintaining the mods

Herdr updates its shipped mods between releases. Two mods here start from those
files, so an upgrade is a small merge, not a rewrite:

| Mod | Starts from |
|-----|-------------|
| `re-tabs` | `tabs` |
| `re-files` | `files` |

`sync/manifest.json` lists them. `sync/<mod>.patch` is the difference between
the shipped file and ours. The patch is the only copy of the local changes, so
never edit a patch by hand: change the mod, then regenerate.

## After a Herdr update

```sh
herdr-app --version
node tools/sync.mjs --check
```

`--check` applies each patch to the installed shipped mod and compares the
result with `mods/`. It skips a mod when Herdr is not installed, so it is safe
in CI. A stale result means Herdr changed a file under our patch.

For each stale mod:

```sh
node tools/sync.mjs re-tabs
```

The tool copies the new shipped files into `mods/re-tabs/`, applies the patch,
and updates `cloned_from.version`. If a hunk no longer fits, it writes a
`*.rej` file and exits non-zero. Resolve each reject in `mods/re-tabs/`, delete
the `.rej`, then regenerate:

```sh
node tools/sync.mjs --generate
node tools/sync.mjs --check
```

`--generate` rewrites every patch from the installed Herdr and the current
mods, so it also works when the shipped mod is missing or the patch only needs
a context refresh.

## Finish

```sh
npm test
./install.sh
herdr-app check "$HOME/.config/herdr-app/mods/re-tabs"
herdr-app check "$HOME/.config/herdr-app/mods/re-files"
herdr-app status
```

`herdr-app check` takes one app directory at a time. Watch `herdr-app status`
for `"errors": []` before you trust a hot reload.

## Rules

- Do not edit `gpui-kit.d.ts` or `jsconfig.json`; Herdr writes them.
- Keep the mod name, its keys and its shared-state prefix (`re-tabs.*`,
  `re-files.*`) stable. They are what layouts and `keys.json` point at.
- A local-only file (for example `re-files/ops.js`) is not in the patch. Leave
  it in the mod folder; the sync tool copies only shipped files.
- If a Herdr release removes a shipped file we still need, the sync tool leaves
  the local copy in place. Check the mod by hand after the merge.
- `mods/re-git-graph`, `mods/re-awake` and `mods/re-markdown` do not come from a
  shipped mod. They are edited directly.
