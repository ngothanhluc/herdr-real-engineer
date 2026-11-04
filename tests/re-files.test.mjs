// Tests re-files' menu table and file operations on a real throwaway folder.
// Run: node tests/re-files.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { menuFor, nameProblem, copyName, performDialog, duplicate, dialogFor, folderOf } from "../mods/re-files/ops.js";

const ids = (items) => items.map((i) => (i.separator ? "-" : i.id));
const local = { root: "/r", on: null }, remote = { root: "/r", on: "vps" };
const file = { kind: "file", rel: "src/a.txt", name: "a.txt" }, folder = { kind: "folder", rel: "src", name: "src" }, root = { kind: "root", rel: "", name: "r" };

assert.deepEqual(ids(menuFor(file, local)), ["copy-path", "copy-relative", "copy-name", "reveal", "editor", "terminal", "-", "new-file", "new-folder", "rename", "duplicate", "-", "delete"]);
assert.deepEqual(ids(menuFor(root, local)), ["copy-path", "copy-name", "reveal", "editor", "terminal", "-", "new-file", "new-folder", "-", "set-editor"], "root: no rename/duplicate/delete, editor setting last");
assert.deepEqual(ids(menuFor(folder, remote)), ["copy-path", "copy-relative", "copy-name", "terminal", "-", "new-file", "new-folder", "rename", "duplicate", "-", "delete"], "remote hides Finder and VS Code");
assert.deepEqual(ids(menuFor(root, remote)), ["copy-path", "copy-name", "terminal", "-", "new-file", "new-folder"], "no dangling separator");

const act = (id, t, c) => menuFor(t, c).find((i) => i.id === id).action(t, c);
assert.deepEqual(act("copy-path", file, local), { type: "copy", text: "/r/src/a.txt" });
assert.deepEqual(act("copy-relative", file, local), { type: "copy", text: "src/a.txt" });
assert.deepEqual(act("copy-path", root, local), { type: "copy", text: "/r" });
assert.deepEqual(act("reveal", file, local), { type: "exec", argv: ["open", "-R", "/r/src/a.txt"] });
assert.deepEqual(act("terminal", file, local), { type: "tab", folder: "/r/src" }, "a file's terminal opens in its folder");
assert.deepEqual(act("terminal", folder, local), { type: "tab", folder: "/r/src" });
assert.equal(folderOf({ kind: "file", rel: "top.txt" }), "");

for (const bad of ["", "  ", "a/b", ".", ".."]) assert.ok(nameProblem(bad), `rejects ${JSON.stringify(bad)}`);
for (const good of ["a", ".env", "a b.txt", "..."]) assert.equal(nameProblem(good), null, `accepts ${good}`);

assert.equal(copyName("a.txt", false, new Set()), "a copy.txt");
assert.equal(copyName("a.txt", false, new Set(["a copy.txt"])), "a copy 2.txt");
assert.equal(copyName("a.txt", false, new Set(["a copy.txt", "a copy 2.txt"])), "a copy 3.txt");
assert.equal(copyName(".env", false, new Set()), ".env copy");
assert.equal(copyName("lib.v2", true, new Set()), "lib.v2 copy", "folders keep dots in the stem");

assert.equal(dialogFor("new-file", file, local, "code").input.label, "Name, in src");
assert.equal(dialogFor("new-folder", { kind: "file", rel: "top.txt", name: "top.txt" }, local, "code").input.label, "Name, in r");

// File operations against a real folder, through an exec shaped like Herdr's.
const base = mkdtempSync(join(tmpdir(), "re-files-"));
const ctx = { root: base, on: "here" };
const calls = [];
const exec = async (cmd, args, options) => {
  assert.equal(options.on, "here", "every operation runs on the panel's machine");
  calls.push([cmd, ...args]);
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
mkdirSync(join(base, "src"));
writeFileSync(join(base, "src/a.txt"), "A");

let r = await performDialog("new-file", "b.txt", file, ctx, exec);
assert.deepEqual(r, { ok: true, reveal: "src/b.txt", open: true });
assert.equal(readFileSync(join(base, "src/b.txt"), "utf8"), "", "a new file next to the clicked file");

r = await performDialog("new-file", "a.txt", file, ctx, exec);
assert.equal(r.ok, false);
assert.match(r.message, /already exists/);
assert.equal(readFileSync(join(base, "src/a.txt"), "utf8"), "A", "an existing file is untouched");

r = await performDialog("new-folder", "lib", root, ctx, exec);
assert.ok(r.ok && existsSync(join(base, "lib")), "a new folder in the root");
assert.equal((await performDialog("new-folder", "x/y", root, ctx, exec)).ok, false);
assert.ok(!existsSync(join(base, "x")));

r = await performDialog("rename", "b.txt", file, ctx, exec);
assert.equal(r.ok, false, "rename refuses to replace");
assert.equal(readFileSync(join(base, "src/b.txt"), "utf8"), "");
r = await performDialog("rename", "c.txt", file, ctx, exec);
assert.ok(r.ok && !existsSync(join(base, "src/a.txt")) && readFileSync(join(base, "src/c.txt"), "utf8") === "A");

const c = { kind: "file", rel: "src/c.txt", name: "c.txt", siblings: ["b.txt", "c.txt"] };
assert.deepEqual(await duplicate(c, ctx, exec), { ok: true, reveal: "src/c copy.txt" });
// The tree's sibling list is stale here; the disk decides.
assert.deepEqual(await duplicate(c, ctx, exec), { ok: true, reveal: "src/c copy 2.txt" });
assert.equal(readFileSync(join(base, "src/c copy 2.txt"), "utf8"), "A");
writeFileSync(join(base, "lib/f"), "F");
assert.deepEqual(await duplicate({ kind: "folder", rel: "lib", name: "lib", siblings: ["lib", "src"] }, ctx, exec), { ok: true, reveal: "lib copy" });
assert.equal(readFileSync(join(base, "lib copy/f"), "utf8"), "F", "a folder duplicates with its contents");

assert.ok(calls.every(([cmd]) => ["test", "touch", "mkdir", "mv", "cp"].includes(cmd)), "no shell, no rm");

// Delete goes to the Trash; faked so the test doesn't fill the real one.
const trashed = [];
r = await performDialog("delete", "", c, ctx, async (cmd, args, options) => { trashed.push([cmd, ...args, options.on]); return { code: 0, stdout: "", stderr: "" }; });
assert.deepEqual(trashed, [["/usr/bin/trash", join(base, "src/c.txt"), "here"]]);
assert.deepEqual(r, { ok: true, reveal: "src" });
r = await performDialog("delete", "", c, ctx, async () => ({ code: 1, stdout: "", stderr: "no such file\n" }));
assert.deepEqual(r, { ok: false, message: "no such file" });

rmSync(base, { recursive: true, force: true });
console.log("re-files: ok");
