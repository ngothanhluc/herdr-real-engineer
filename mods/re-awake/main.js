// Keeps this Mac awake on demand: On always, Agent while an agent on this
// computer is working, Off never. macOS only. See README.md.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, spaces, theme, window, exec, shared, setShared, nextCommand } from "herdr";

const MODES = ["on", "auto", "off"];
const LABEL = { on: "On", auto: "Agent", off: "Off" };
const TIP = {
  on: "Stay awake until you turn this off",
  auto: "Stay awake while an agent on this computer is working",
  off: "Let this Mac sleep as usual",
};
const LID = "Closing the lid still puts this Mac to sleep.";
const JOB = "herdr-awake";
const LAUNCHCTL = "/bin/launchctl";
const CAFFEINATE = "/usr/bin/caffeinate";
const PS = "/bin/ps";

const mac = () => (window()?.platform ?? "macos") === "macos";

// One setting for the machine, not one per layout: both Awake mods read and
// write "awake", and either can drive the same launchctl job. The old per-mod
// keys are read once so an existing choice carries over.
const mode = () => {
  const saved = shared("awake") ?? shared("re-awake") ?? shared("fg-awake");
  return MODES.includes(saved?.mode) ? saved.mode : "off";
};

// The pid the assertion is tied to: caffeinate -w exits when it does, so quitting
// Herdr can't leave the Mac awake. pgrep can't see the app from a mod; ps can.
async function herdrPid() {
  const r = await exec(PS, ["-A", "-o", "pid=,comm="]);
  for (const line of (r.stdout ?? "").split("\n")) {
    const found = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (found && found[2].trim().split("/").pop() === "Herdr") return found[1];
  }
  return null;
}

// `launchctl list <label>` prints the job as a plist; a job with no live process
// has no PID key.
async function running() {
  const r = await exec(LAUNCHCTL, ["list", JOB]);
  if ((r.code ?? 1) !== 0) return false;
  return /"PID"\s*=\s*\d+/.test(r.stdout ?? "");
}

async function start() {
  const pid = await herdrPid();
  if (!pid) throw new Error("no Herdr process to hold the assertion");
  await exec(LAUNCHCTL, ["remove", JOB]); // a stale job under the same label
  // -w ends the assertion with that process; -t bounds it if the pid is reused.
  const r = await exec(LAUNCHCTL, ["submit", "-l", JOB, "--", CAFFEINATE, "-i", "-s", "-w", pid, "-t", "3600"]);
  if ((r.code ?? 1) !== 0) throw new Error((r.stderr ?? "").trim() || `launchctl exited ${r.code}`);
}

async function stop() {
  await exec(LAUNCHCTL, ["remove", JOB]);
}

function workingHere() {
  const local = new Map(spaces().map((s) => [s.id, s.machine]));
  return agents().filter((a) => a.status === "working" && local.get(a.space) === null).length;
}

const want = (m) => m === "on" || (m === "auto" && workingHere() > 0);

export default class Awake extends View {
  init(_props, cx) {
    this.cx = cx;
    this.mode = mode();
    this.active = false;
    this.error = null;
    this.busy = false;
    this.lastWant = null;
    this.sync();
    // Agent status changes re-render; this catches the rest (a refused start, the
    // job dying behind our back, the Mac waking from sleep).
    cx.spawn(async () => { for (;;) { await cx.sleep(20000); await this.sync(); } });
    cx.spawn(async () => { for (;;) { if ((await nextCommand()) === "cycle") this.cycle(); } });
  }

  cycle() {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
  }

  setMode(mode) {
    this.mode = mode;
    setShared("awake", { mode });
    this.sync();
    this.cx.notify();
  }

  // Ask for what the mode wants and report what is really running, so the pill
  // never claims the Mac is held awake when it isn't.
  async sync() {
    if (this.busy || !mac()) return;
    this.busy = true;
    try {
      if (want(this.mode) !== (await running())) {
        if (want(this.mode)) await start();
        else await stop();
      }
      this.active = await running();
      this.error = null;
    } catch (e) {
      this.active = false;
      this.error = String(e?.message ?? e);
    } finally {
      this.busy = false;
      this.cx.notify();
    }
  }

  render() {
    const t = theme();
    if (!mac()) {
      return h_flex().size_full().px(10).gap(6).items_center().bg(t.chrome)
        .child(svg("mods/re-awake/icons/coffee.svg").size(13).flex_none().text_color(t.dim))
        .child(div().text_size(11.5).text_color(t.muted).child("Awake"))
        .child(div().flex_1())
        .child(div().text_size(10).text_color(t.dim).child("macOS only"));
    }
    if (this.mode !== mode()) this.mode = mode();
    const wish = want(this.mode);
    if (wish !== this.lastWant) {
      this.lastWant = wish;
      this.sync();
    }
    const pill = (m) => {
      const on = this.mode === m;
      return div().id(`re-awake-${m}`).h(17).px(6).rounded(4).flex_none().items_center()
        .text_size(10).text_color(on ? t.foreground : t.muted)
        .bg(on ? t.selected : t.chrome).hover((s) => s.bg(on ? t.selected : t.hover))
        .tooltip(TIP[m]).on_click(() => this.setMode(m)).child(LABEL[m]);
    };
    return h_flex().size_full().px(10).gap(6).items_center().bg(t.chrome)
      .tooltip(this.error ?? (this.mode === "off" ? "Keep this Mac awake" : LID))
      .child(svg("mods/re-awake/icons/coffee.svg").size(13).flex_none()
        .text_color(this.error ? t.blocked : this.active ? t.accent : t.dim))
      .child(div().text_size(11.5).text_color(this.active ? t.foreground : t.muted).child("Awake"))
      .child(div().flex_1())
      .child(pill("on")).child(pill("auto")).child(pill("off"));
  }
}
