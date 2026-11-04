# Third-party code

This repository is a layout and a few mods for [Herdr](https://herdr.dev). Most
of it started as someone else's code, under licenses that ask for credit. This
file says where each part came from and what changed.

| Where | Started as | License | What changed here |
|-------|------------|---------|-------------------|
| `layouts/real-engineer.json` | Herdr's shipped `main` layout, app 0.1.13 ([herdrdev/herdr-app](https://github.com/herdrdev/herdr-app)) | Apache-2.0 | The tabs block shows `re-tabs`, the Files panel shows `re-files`, and the panel stack `panel-body` gets a third child, `graph`. |
| `mods/re-tabs/` | Herdr's `tabs` mod, app 0.1.13 | Apache-2.0 | Renamed (`cloned_from` in `mod.json`), a Graph button, panel toggles that remember the space's last panel, and the `re-tabs.files` / `re-tabs.graph` key commands. |
| `mods/re-files/` | Herdr's `files` mod, app 0.1.13 | Apache-2.0 | Renamed (`cloned_from` in `mod.json`), the right-click menu and file operations, the editable preview with save and conflict handling, and the extra `dialog.js`, `menu.js`, `ops.js`, `edit.js` written here. The icons it copied from Herdr are unchanged. |
| `mods/re-git-graph/` | [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph) v0.3.0, commit `af1492f`, pulled in as a squashed `git subtree` | MIT | Renamed from `git-graph`, shared keys and the update check point at this repo, and a branch filter dropdown and a find bar were added. `mods/re-git-graph/LICENSE` keeps rabeeh-ta's copyright and permission notice. |
| icons | [Lucide](https://lucide.dev) | ISC | Redrawn or copied as SVG. See `mods/re-git-graph/icons/LICENSE-lucide.txt` and `mods/re-files/icons/LICENSE-lucide.txt`. |

The full Apache-2.0 text is in [LICENSE-APACHE-2.0.txt](LICENSE-APACHE-2.0.txt).
MIT notices are in [LICENSE](LICENSE) (this repository's own work) and
`mods/re-git-graph/LICENSE` (the graph's original code).

Every mod says the same in its own `README.md`, and the two files changed from
Herdr's shipped mods say so at the top of the file.

Nothing here is made, reviewed or endorsed by Herdr or by rabeeh-ta. If
something is wrong or missing, open an issue and it gets fixed.
