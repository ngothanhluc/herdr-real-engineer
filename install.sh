#!/bin/sh
# Copies the mods and layout into Herdr. Herdr runs code through symlinks but doesn't load their SVG assets, so copy.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
for m in "$here"/mods/*/; do
  name=$(basename "$m")
  [ -L "$home/mods/$name" ] && rm "$home/mods/$name"
  rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json "$m" "$home/mods/$name/"
done
[ -L "$home/layouts/real-engineer.json" ] && rm "$home/layouts/real-engineer.json"
cp "$here/layouts/real-engineer.json" "$home/layouts/real-engineer.json"
echo "installed into $home (merge keys.json by hand if you haven't)"
