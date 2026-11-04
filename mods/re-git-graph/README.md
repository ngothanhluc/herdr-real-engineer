# re-git-graph

[rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph) v0.3.0
(commit `af1492f`), MIT, pulled into this repository as a squashed `git subtree`
so its history stays with it. `scripts/update-git-graph.sh` refreshes it.

rabeeh-ta's copyright and permission notice is in [LICENSE](LICENSE) and is not
changed. Changes made here:

- Renamed from `git-graph` to `re-git-graph`: the mod folder, the mod's own
  paths, the shared-state keys (`re-git-graph.*`), and the keys a pane takes.
- The update check asks `ngothanhluc/herdr-real-engineer` for its latest
  release instead of the upstream repo. `VERSION` in `update.js` matches this
  repository's release tag.
- A branch filter dropdown in the toolbar: all, current, or a chosen set of
  local and remote branches.
- A find bar on `cmd-f`: matches are highlighted, never hidden, and Enter
  steps through them.

Bugs in those additions are this repository's; bugs in the rest belong
upstream, and are worth an issue there.
