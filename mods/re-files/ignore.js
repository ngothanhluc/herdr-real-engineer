// Which entries the repository ignores, for the tree to fade them.
//
// One `git ls-files` answers for every folder at once: an ignored folder comes
// back once (`--directory`), and nothing inside it is listed, because Git
// cannot re-include a file whose parent folder is excluded. So a path is
// ignored when it, or one of its folders, is in the set.
export const IGNORED_ARGS = ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"];

export function parseIgnored(stdout) {
  return new Set(String(stdout ?? "").split("\0").filter(Boolean).map((path) => path.replace(/\/+$/, "")));
}

// `path` is relative to the panel's root, the form row ids already use.
export function isIgnored(ignored, path) {
  if (!path || !ignored?.size) return false;
  if (ignored.has(path)) return true;
  for (let i = path.lastIndexOf("/"); i > 0; i = path.lastIndexOf("/", i - 1)) {
    if (ignored.has(path.slice(0, i))) return true;
  }
  return false;
}
