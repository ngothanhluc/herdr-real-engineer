# re-files

The Files panel for the Real Engineer layout. It starts from Herdr's shipped
`files` mod; `sync/re-files.patch` holds the local delta. The Apache-2.0 text
is in [../../LICENSE-APACHE-2.0.txt](../../LICENSE-APACHE-2.0.txt).

Changed here:

- The mod, its keys and its localStorage entries are named `re-files`, so it
  sits beside Herdr's own `files` instead of replacing it.
- A right-click menu on files, folders and the empty part of the tree: copy
  path, relative path or name, Reveal in Finder, Open in editor, Open in
  Terminal, New File, New Folder, Rename, Duplicate, Delete to the Trash, and
  Set editor command.
- An editable preview with `cmd-s`, an unsaved marker, a save-or-discard
  prompt on the way back, and a bar that offers Reload or Overwrite when the
  file changed or was deleted on disk.
- Entries Git ignores fade in the tree: 55% opacity, the name in dim italic,
  and `Ignored by Git` on hover. One `git ls-files --others --ignored
  --exclude-standard --directory` per refresh answers for the whole tree,
  including everything inside an ignored folder.

Files written here: `dialog.js`, `menu.js`, `ops.js`, `edit.js`, `ignore.js`.
The chevron and file/folder SVGs are unchanged. After a Herdr update, run
`node tools/sync.mjs --check`.
