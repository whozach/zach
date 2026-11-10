#!/usr/bin/env node
/**
 * Crypto Client feature list vs Cipher's 0.51 list (tests/fixtures/feature-list-0.51.md, or FEATURE_LIST=<path>).
 * The list is split on semicolons; a trailing "(...)" is detail, not part of the name.
 * Checks:
 *  - the list has 115 features, and each category matches its "(N)" header
 *  - every listed feature is on the site exactly once with status "in"; nothing else is "in"
 *  - every feature is one line in config.js with status "in" or "soon" (so a revert is a one-line edit)
 *  - a one-line revert in a temp copy moves exactly that feature to Coming soon
 *  - Force Clone, cloning and Photon appear nowhere on the main site files
 * No network, no browser.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(root, "site");
const LIST = process.env.FEATURE_LIST || join(root, "tests/fixtures/feature-list-0.51.md");
let passed = 0, failed = 0;
const rec = (name, ok, detail = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const norm = (s) => s.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();

// ---- Cipher's list ----
const text = readFileSync(LIST, "utf8");
const listed = [];
let headerOk = true, cat = null, want = 0;
for (const line of text.split(/\r?\n/)) {
  const h = line.match(/^##\s+(.+?)\s+\((\d+)\)\s*$/);
  if (h) { cat = h[1]; want = Number(h[2]); continue; }
  if (cat && line.trim()) {
    const names = line.split(";").map((s) => s.trim()).filter(Boolean);
    if (names.length !== want) { headerOk = false; console.log(`  ${cat}: header says ${want}, line has ${names.length}`); }
    listed.push(...names.map((n) => ({ cat, name: n, key: norm(n) })));
    cat = null;
  }
}
rec(`0.51 list: ${listed.length} features, every category matches its (N) header`, listed.length === 115 && headerOk);
rec("0.51 list: no Force Clone in it", !listed.some((f) => /clone/i.test(f.name)));

// ---- site data ----
function load(src) {
  const ctx = { window: {} }; vm.runInNewContext(src, ctx);
  const item = ctx.window.BOO_CONFIG.projects.items.find((i) => i.id === "cryptoclient");
  return item.features.flatMap((g) => g.items.map((f) => ({ cat: g.category, status: f.status, name: f.name, key: norm(f.name) })));
}
const cfgText = readFileSync(join(SITE, "config.js"), "utf8");
const site = load(cfgText);
const inSite = site.filter((f) => f.status === "in");
const missing = listed.filter((f) => !inSite.some((s) => s.key === f.key));
const extra = inSite.filter((s) => !listed.some((f) => f.key === s.key));
const dups = site.filter((s, i) => site.findIndex((t) => t.key === s.key) !== i);
rec("site: every 0.51 feature is In the client", missing.length === 0, missing.map((f) => f.name).join("; "));
rec("site: nothing else is In the client", extra.length === 0, extra.map((f) => f.name).join("; "));
const EXPECT_SOON = Number(process.env.EXPECT_SOON ?? 1);   // Ping is the only Coming soon item
rec(`site: ${inSite.length} In the client, ${site.length - inSite.length} Coming soon (expected 115 / ${EXPECT_SOON})`,
  inSite.length === 115 && site.length - inSite.length === EXPECT_SOON);
rec("site: no Notifications row (it's the friend join alerts, already In the client)", !site.some((f) => /^notifications$/i.test(f.name)));
rec("site: no duplicate feature names", dups.length === 0, dups.map((f) => f.name).join("; "));
rec('site: every status is exactly "in" or "soon"', site.every((f) => f.status === "in" || f.status === "soon"));
const featureLines = cfgText.split("\n").filter((l) => /^\s*\{ status: "/.test(l));
rec("config.js: each feature is a single line { status, name, desc }",
  featureLines.length === site.length && featureLines.every((l) => /^\s*\{ status: "(in|soon)", name: "[^"]+", desc: "[^"]*" \},?\s*$/.test(l)), `${featureLines.length} lines / ${site.length} features`);

// ---- one-line revert ----
{
  const target = "Freecam";
  const line = featureLines.find((l) => l.includes(`name: "${target}"`));
  const reverted = cfgText.replace(line, line.replace('status: "in"', 'status: "soon"'));
  const changed = cfgText.split("\n").filter((l, i) => l !== reverted.split("\n")[i]).length;
  const after = load(reverted);
  const f = after.find((x) => x.name === target);
  rec(`revert: changing one line moves "${target}" to Coming soon (114 / ${after.length - 114})`,
    changed === 1 && f.status === "soon" && after.filter((x) => x.status === "in").length === 114);
}

// ---- Force Clone / Photon nowhere on the main site ----
{
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n), rel = relative(SITE, p); if (rel.split("/")[0] === "client" || rel.includes("screenshots") || rel.includes(".claude")) continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(html|js|css|xml|txt|md)$/.test(n)) files.push(p); } };
  walk(SITE);
  const bad = files.filter((p) => /force\s*clone|\bclon(e|ing)\b|photon/i.test(readFileSync(p, "utf8")));
  rec(`site: no Force Clone, cloning or Photon in ${files.length} main files`, bad.length === 0, bad.map((p) => relative(SITE, p)).join(" "));
}

console.log(`\n${passed}/${passed + failed} feature-list checks passed`);
process.exit(failed ? 1 : 0);
