# Git config

The Git panel's **Config** tab answers one question: who does this repository
commit as? It is the panel's only write, and it writes just `user.name` and
`user.email` to the repository's own config.

## What the tab shows

- A 32px header with the folder and `↻`.
- **This repository**: Name and Email as Git resolves them, each with the scope
  the value comes from (`Local`, `Global`, `System`, `Worktree`). A missing one
  reads `(not set)`.
- **Saved pairs**: the identities used before, newest first. Picking one sets
  the repository to it. The list keeps 12 pairs and lives in Herdr's
  `shared.json` under `re-git-graph.identities`.
- **Set this repository**: a Name box, an Email box and `Set`. Enter in the
  email box submits.

The identity a repository already uses joins the saved pairs when the tab
opens, so a project that inherits a global name can pin it locally in one
click.

## A repository with no identity

Opening a repository whose own config has no `user.name` or `user.email` asks
once, in a dialog over the window: it names the identity Git borrows from the
wider config and its scope, lists the pairs used before, and offers Name and
Email boxes already filled with the borrowed pair. **Set identity** writes the
local config; **Later** or Esc leaves it, and the question returns next session,
never twice in one. A repository with both keys set is never asked, and a
hidden panel keeps quiet.

## What picking writes

Clicking a pair, or typing a new one and pressing `Set`, asks first. A confirm
over the window names the pair and the folder, with **Cancel** and **Set
identity**; Enter confirms and Esc cancels. Git's error, if any, stays in the
confirm.

Confirming runs:

```sh
git --no-optional-locks config --local user.name <name>
git --no-optional-locks config --local user.email <email>
```

Then the confirm closes, the tab remembers the pair, reloads, and toasts it. `--local` keeps the global and
system config untouched, so each repository keeps its own identity. It also
fails outside a repository, and the tab shows Git's message under the form.

## How it reads

The tab runs one command in the panel's folder:

```sh
git --no-optional-locks config --list -z --show-scope
```

`--show-scope` adds the scope. `-z` ends each setting with NUL and separates
the key from its value with a newline, so values may contain newlines. Each
record is:

```text
scope\0key\nvalue\0
```

Git lists scopes from system to worktree, so the last value for a key is the
one it would use. The tab keeps only `user.name` and `user.email`.

## Limits

- The tab shows only when the folder is one repository. A folder that isn't a
  repository, or one that lists the repositories under it, has no identity to
  set, so the tab stays out of the row.
- Identity only. Every other setting stays a `git config` or editor action;
  the tab does not list them.
- An `includeIf` block with a `gitdir:` condition can set the identity too. A
  local value overrides it for this repository, which is what the tab writes.
- Values are shown as Git returns them, and the saved pairs sit in
  `shared.json` in plain text, emails included. Do not screenshot the tab from
  a machine whose identity you would rather not share.
- Git may refuse to read a repository owned by another user
  (`safe.directory`), and then the tab sees no identity.
- `--show-scope` needs Git 2.26 or newer. The panel is tested on Git 2.55.
