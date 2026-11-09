import assert from "node:assert/strict";
import { parseIdentityZ, asPair, samePair, pairsOf, rememberPair, MAX_PAIRS } from "../mods/re-git-graph/config.js";

// `git config --list -z --show-scope`: `scope\0key\nvalue\0` per setting.
const records = [
  "system", "core.editor\nvi",
  "global", "user.name\nAda",
  "global", "user.email\nada@example.com",
  "local", "user.name\nAda Lovelace",
  "local", "core.bare\nfalse",
];
const entries = parseIdentityZ(records.join("\0") + "\0");

// Only the two identity keys, and the most specific value for each.
assert.deepEqual(entries, {
  name: { value: "Ada Lovelace", scope: "local" },
  email: { value: "ada@example.com", scope: "global" },
});
assert.deepEqual(parseIdentityZ(""), {});
assert.deepEqual(parseIdentityZ(undefined), {});

// An empty value stays empty rather than disappearing.
assert.deepEqual(parseIdentityZ("local\0user.name\n\0"), { name: { value: "", scope: "local" } });

assert.deepEqual(asPair({ name: " Ada ", email: "ada@example.com " }), { name: "Ada", email: "ada@example.com" });
assert.equal(asPair({ name: "", email: "" }), null);
assert.equal(asPair(null), null);

assert.equal(samePair({ name: "Ada", email: "ADA@example.com" }, { name: " Ada ", email: "ada@example.com" }), true);
assert.equal(samePair({ name: "Ada", email: "ada@example.com" }, { name: "Ada", email: "other@example.com" }), false);
assert.equal(samePair(null, { name: "Ada", email: "ada@example.com" }), false);

// The stored list is repaired: trimmed, deduped, capped.
assert.deepEqual(pairsOf([{ name: " Ada ", email: "ada@example.com" }, { name: "Ada", email: "ADA@example.com" }, { name: "" }]),
  [{ name: "Ada", email: "ada@example.com" }]);
assert.deepEqual(pairsOf("nope"), []);
assert.equal(pairsOf(Array.from({ length: MAX_PAIRS + 5 }, (_, i) => ({ name: `N${i}`, email: `n${i}@example.com` }))).length, MAX_PAIRS);

// A remembered pair moves to the front without being duplicated.
const stored = [{ name: "A", email: "a@example.com" }, { name: "B", email: "b@example.com" }];
assert.deepEqual(rememberPair(stored, { name: "B", email: "b@example.com" }).map((p) => p.name), ["B", "A"]);
assert.deepEqual(rememberPair(stored, { name: "C", email: "c@example.com" }).map((p) => p.name), ["C", "A", "B"]);
assert.deepEqual(rememberPair(stored, { name: "", email: "" }).map((p) => p.name), ["A", "B"]);

console.log("config ok");
