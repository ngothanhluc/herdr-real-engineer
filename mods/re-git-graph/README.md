# re-git-graph

The commit graph and its tabs. The notice for the code this mod started from
is in [LICENSE](LICENSE) and is not changed.

How it is built:

- The mod folder, its paths, the shared-state keys (`re-git-graph.*`) and the
  keys a pane takes all use `re-git-graph`.
- The update check asks `ngothanhluc/herdr-real-engineer` for its latest
  release. `VERSION` in `update.js` matches this repository's release tag.
- A branch filter dropdown in the toolbar: all, current, or a chosen set of
  local and remote branches.
- A find bar on `cmd-f`: matches are highlighted, never hidden, and Enter
  steps through them.
- The Pull request tab beside the graph, and local changes in the graph's own
  uncommitted row (`shell.js`, `review.js`).
- A Config tab (`config.js`, `config-view.js`, `confirm.js`): sets the
  repository's `user.name` and `user.email` from a list of pairs used before,
  after a confirm, and asks once for a repository that has no identity of its
  own.
