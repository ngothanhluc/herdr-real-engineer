#!/usr/bin/env node
// Keep a cloned Herdr mod equal to the shipped mod plus a stored patch.
//
//   node tools/sync.mjs --check          verify sync/ still reproduces mods/
//   node tools/sync.mjs --generate       rebuild every patch from the installed Herdr
//   node tools/sync.mjs <mod> [--version X]   merge a new shipped mod into mods/<mod>
//
// The installed shipped mods live in $HERDR_APP_HOME/mods (default ~/.config/herdr-app).
// A patch is the difference between the shipped files and our files, so an upgrade
// applies our delta to the new shipped files and reports any hunk that no longer fits.

import { execFileSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "sync", "manifest.json");
const GENERATED = new Set(["gpui-kit.d.ts", "jsconfig.json"]);
const appHome = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const target = args.find((a) => !a.startsWith("--") && a !== valueOf("--version"));

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith(".") || GENERATED.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)];
  }).sort();
}

function copyFiles(files, from, to) {
  for (const file of files) {
    mkdirSync(dirname(join(to, file)), { recursive: true });
    cpSync(join(from, file), join(to, file));
  }
}

function tempDir(label) {
  return mkdtempSync(join(tmpdir(), `herdr-sync-${label}-`));
}

function shipped(from) {
  return join(appHome, "mods", from);
}

function appVersion() {
  try {
    return execFileSync("herdr-app", ["--version"], { encoding: "utf8" }).trim().split(/\s+/).pop();
  } catch {
    return null;
  }
}

function versionOf(mod) {
  return readJson(join(ROOT, "mods", mod, "mod.json")).cloned_from?.version ?? null;
}

function setVersion(mod, version) {
  const path = join(ROOT, "mods", mod, "mod.json");
  const json = readJson(path);
  json.cloned_from = { ...json.cloned_from, version };
  writeJson(path, json);
}

function diffPatch(a, b) {
  let text;
  try {
    text = execFileSync("diff", ["-ruN", "a", "b"], { cwd: dirname(a), encoding: "utf8" });
  } catch (error) {
    if (error.status !== 1) throw error;
    text = error.stdout;
  }
  // Timestamps change every run; the paths are all a patch needs.
  return text.replace(/^((?:---|\+\+\+) [ab]\/[^\t\n]+)\t.*$/gm, "$1");
}

function applyPatch(dir, patch) {
  try {
    execFileSync("git", ["apply", "-p1", "--reject", patch], { cwd: dir, stdio: "pipe" });
    return { ok: true, output: "", rejected: new Set() };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    const rejects = walk(dir).filter((f) => f.endsWith(".rej"));
    return { ok: false, output, rejected: new Set(rejects.map((f) => f.replace(/\.rej$/, ""))) };
  }
}

function sameJson(a, b) {
  const strip = (value) => {
    const copy = JSON.parse(JSON.stringify(value));
    if (copy.cloned_from) delete copy.cloned_from.version;
    return JSON.stringify(copy);
  };
  return strip(a) === strip(b);
}

function generate(mod, entry) {
  const from = shipped(entry.from);
  if (!existsSync(from)) {
    console.log(`skip ${mod}: no ${from}`);
    return false;
  }
  const dir = tempDir("generate");
  const a = join(dir, "a"), b = join(dir, "b");
  mkdirSync(a); mkdirSync(b);
  const files = walk(from);
  copyFiles(files, from, a);
  const local = join(ROOT, "mods", mod);
  copyFiles(files.filter((f) => existsSync(join(local, f))), local, b);
  const version = appVersion();
  if (version) setVersion(mod, version);
  const patch = diffPatch(a, b);
  const out = join(ROOT, "sync", `${mod}.patch`);
  if (patch.trim()) writeFileSync(out, patch);
  else rmSync(out, { force: true });
  rmSync(dir, { recursive: true, force: true });
  console.log(`${patch.trim() ? "wrote" : "unchanged"} sync/${mod}.patch`);
  return true;
}

function merge(mod, entry) {
  const from = shipped(entry.from);
  if (!existsSync(from)) throw new Error(`no shipped mod at ${from}`);
  const dir = tempDir("merge");
  const files = walk(from);
  copyFiles(files, from, dir);
  const patch = join(ROOT, "sync", `${mod}.patch`);
  const result = existsSync(patch) ? applyPatch(dir, patch) : { ok: true, output: "", rejected: new Set() };
  const local = join(ROOT, "mods", mod);
  // A rejected file keeps the local copy: a half-applied merge must not ship.
  const safe = result.ok ? files : result.rejected.size ? files.filter((f) => !result.rejected.has(f)) : [];
  copyFiles(safe, dir, local);
  const version = valueOf("--version") || appVersion();
  if (version) setVersion(mod, version);
  const rejects = join(ROOT, "sync", "rejects", mod);
  if (result.rejected.size) {
    rmSync(rejects, { recursive: true, force: true });
    for (const file of result.rejected) copyFiles([`${file}.rej`], dir, rejects);
  }
  rmSync(dir, { recursive: true, force: true });
  if (result.ok) return [];
  return [
    result.output,
    result.rejected.size
      ? `kept local: ${[...result.rejected].join(", ")}\n  rejects: ${relative(ROOT, rejects)}`
      : "kept every local file: the patch did not apply",
  ].filter(Boolean);
}

function check(mod, entry) {
  const from = shipped(entry.from);
  if (!existsSync(from)) {
    console.log(`skip ${mod}: no shipped mod at ${from}`);
    return true;
  }
  const dir = tempDir("check");
  const files = walk(from);
  copyFiles(files, from, dir);
  const patch = join(ROOT, "sync", `${mod}.patch`);
  const result = existsSync(patch) ? applyPatch(dir, patch) : { ok: true, output: "", rejected: new Set() };
  const local = join(ROOT, "mods", mod);
  const stale = [];
  for (const file of files) {
    if (!existsSync(join(local, file))) continue;
    if (file === "mod.json") {
      if (!sameJson(readJson(join(dir, file)), readJson(join(local, file)))) stale.push(file);
    } else if (!readFileSync(join(dir, file)).equals(readFileSync(join(local, file)))) {
      stale.push(file);
    }
  }
  const version = versionOf(mod), installed = appVersion();
  if (version && installed && version !== installed) stale.push(`mod.json: cloned_from.version is ${version}, Herdr is ${installed}`);
  rmSync(dir, { recursive: true, force: true });
  if (!result.ok || stale.length) {
    console.log(`stale ${mod}${result.ok ? "" : `\n  patch: ${result.output}`}${stale.length ? `\n  files: ${stale.join(", ")}` : ""}`);
    return false;
  }
  console.log(`ok ${mod}`);
  return true;
}

const manifest = readJson(MANIFEST);
const entries = target ? [[target, manifest.mods[target]]] : Object.entries(manifest.mods);

if (target && !manifest.mods[target]) {
  console.error(`${target} is not in sync/manifest.json`);
  process.exit(2);
}

if (flags.has("--generate")) {
  const installed = appVersion();
  if (installed) manifest.herdr = installed;
  for (const [mod, entry] of entries) generate(mod, entry);
  writeJson(MANIFEST, manifest);
  process.exit(0);
}

if (flags.has("--check")) {
  const ok = entries.map(([mod, entry]) => check(mod, entry)).every(Boolean);
  process.exit(ok ? 0 : 1);
}

if (!target) {
  console.error("usage: node tools/sync.mjs --check | --generate | <mod> [--version X]");
  process.exit(2);
}

const problems = merge(target, manifest.mods[target]);
if (problems.length) {
  console.error(`${target}: fix ${problems.length} rejected hunk(s), then run --check`);
  process.exit(1);
}
console.log(`${target}: merged ${appVersion() ?? "the installed"} Herdr files`);
