// Tests the ignored-entry set re-files fades in the tree.
// Run: node tests/ignore.test.mjs
import assert from "node:assert/strict";
import { parseIgnored, isIgnored } from "../mods/re-files/ignore.js";

const listed = ["node_modules/", "dist/app.js", ".audit/", "src/generated/", "b.txt"].join("\0") + "\0";
const ignored = parseIgnored(listed);

assert.deepEqual([...ignored].sort(), [".audit", "b.txt", "dist/app.js", "node_modules", "src/generated"], "folders lose the trailing slash");

assert.equal(isIgnored(ignored, "node_modules"), true, "the folder itself");
assert.equal(isIgnored(ignored, "node_modules/react/index.js"), true, "anything inside an ignored folder");
assert.equal(isIgnored(ignored, "src/generated/types.ts"), true, "a nested ignored folder");
assert.equal(isIgnored(ignored, "dist/app.js"), true, "an ignored file");
assert.equal(isIgnored(ignored, "b.txt"), true);

assert.equal(isIgnored(ignored, "dist/app.js.map"), false, "a shared prefix is not a match");
assert.equal(isIgnored(ignored, "node_modulesx"), false, "a shared name is not a match");
assert.equal(isIgnored(ignored, "node_modulesx/a.js"), false);
assert.equal(isIgnored(ignored, "src/app.js"), false);
assert.equal(isIgnored(ignored, "src/generated-notes/a.md"), false);
assert.equal(isIgnored(ignored, ""), false, "the root is never faded");
assert.equal(isIgnored(parseIgnored(""), "anything"), false, "an empty listing fades nothing");
assert.equal(isIgnored(parseIgnored(null), "anything"), false);
assert.equal(isIgnored(undefined, "anything"), false, "no git, no fading");

console.log("ignore ok");
