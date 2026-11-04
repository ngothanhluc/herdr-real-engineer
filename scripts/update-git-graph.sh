#!/bin/sh
# Pulls new upstream git-graph releases into mods/re-git-graph (a squashed git subtree).
# After it merges, rerun the rename (git-graph -> re-git-graph) on any new code and npm test.
set -eu
cd "$(dirname "$0")/.."
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/rabeeh-ta/herdr-git-graph.git
git fetch upstream
git subtree split --prefix=mods/git-graph upstream/main -b upstream-git-graph
git subtree pull --squash --prefix=mods/re-git-graph . upstream-git-graph -m "Update 'mods/re-git-graph' from rabeeh-ta/herdr-git-graph"
grep -rn "[^-]git-graph" mods/re-git-graph/*.js | grep -v "re-git-graph\|herdr-git-graph" || echo "no stray git-graph names"
