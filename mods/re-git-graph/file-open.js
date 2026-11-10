// Showing the file in Herdr's own Files panel: select that panel, show it, and
// send the request it already listens for. No editor is started.
import { run, setShared } from "herdr";

const trim = (path) => String(path ?? "").replace(/\/$/, "");

export function openInFiles({ root, base, path, key }) {
  const abs = String(path ?? "").startsWith("/") ? path : `${trim(root)}/${path}`;
  const dir = trim(base || root);
  const rel = dir && abs.startsWith(`${dir}/`) ? abs.slice(dir.length + 1) : abs;
  run("layout.select", { stack: "panel-body", child: "files" });
  run("layout.show", { id: "panel" });
  setShared(key, { at: Date.now(), root: dir, reveal: rel, open: true });
}
