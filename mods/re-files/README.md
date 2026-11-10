# re-files

Herdr's `files` mod from app 0.1.13 (Apache-2.0, part of
[herdrdev/herdr-app](https://github.com/herdrdev/herdr-app)), renamed and
changed for the Real Engineer layout. The Apache-2.0 text is in
[../../LICENSE-APACHE-2.0.txt](../../LICENSE-APACHE-2.0.txt).

Changed here:

- The mod, its keys and its localStorage entries are named `re-files`, so it
  sits beside Herdr's own `files` instead of replacing it.
- A right-click menu on files, folders and the empty part of the tree: copy
  path, relative path or name, Reveal in Finder, Open in VS Code, Open in
  Terminal, New File, New Folder, Rename, Duplicate, Delete to the Trash, and
  Set editor command.
- An editable preview with `cmd-s`, an unsaved marker, a save-or-discard
  prompt on the way back, and a bar that offers Reload or Overwrite when the
  file changed or was deleted on disk.
- Entries Git ignores fade in the tree: 55% opacity, the name in dim italic,
  and `Ignored by Git` on hover. One `git ls-files --others --ignored
  --exclude-standard --directory` per refresh answers for the whole tree,
  including everything inside an ignored folder.

Files written here, not in Herdr's mod: `dialog.js`, `menu.js`, `ops.js`,
`edit.js`, `ignore.js`. `main.js` says at the top that it was changed. The
chevron and file/folder SVGs are Herdr's, unchanged.
