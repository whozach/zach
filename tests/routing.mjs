#!/usr/bin/env node
/**
 * Host/path routing tests against `wrangler dev --local`.
 * One dev server per host; --local-upstream sets request.url's host, the same
 * way a real custom domain does. Checks:
 *  - api.haunted.ong: API at /license/v1/*, everything else a JSON 404, never site assets
 *  - haunted.ong, www.haunted.ong, zachxbt.boo: /api/* is the site's normal 404 page,
 *    every site file is served byte-for-byte with its _headers
 *  - store pages: /client/buy/ and /client/dashboard/ (+ their assets) only on haunted.ong
 *    and www, with noindex + CSP; every other /client/* path, and all of /client/* on
 *    zachxbt.boo, is a noindex 404; main pages carry no wallet / QR / store link
 *  - optional BASELINE_DIR=<old checkout>: every site path matches the old Worker exactly
 * Never reads or prints secrets.
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(root, "site");
const BASE_PORT = Number(process.env.ROUTING_PORT || 8791);
const SITE_HOSTS = ["haunted.ong", "www.haunted.ong", "zachxbt.boo"];
const API_HOST = "api.haunted.ong";
const procs = [];
const tmps = [];
let failed = 0, passed = 0;

function record(name, ok, detail = "") {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

function startDev(dir, host, port) {
  const persist = mkdtempSync(join(tmpdir(), "routing-"));
  tmps.push(persist);
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "wrangler@4", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port),
      "--local-upstream", host, "--persist-to", persist], {
      cwd: dir, stdio: ["ignore", "pipe", "pipe"], detached: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
    });
    procs.push(child);
    let buf = "";
    const t = setTimeout(() => reject(new Error(`dev server for ${host} not ready\n${buf}`)), 90000);
    const on = (d) => { buf += d; if (/Ready on/.test(buf)) { clearTimeout(t); resolve(`http://127.0.0.1:${port}`); } };
    child.stdout.on("data", on); child.stderr.on("data", on);
    child.on("exit", (c) => { if (c) { clearTimeout(t); reject(new Error(`dev for ${host} exited ${c}\n${buf}`)); } });
  });
}

async function get(base, path, opts = {}) {
  const res = await fetch(base + path, { redirect: "manual", ...opts });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, h: res.headers, body, text: body.toString("utf8") };
}
const ct = (r) => r.h.get("content-type") || "";
const isJson404 = (r) => {
  try { const j = JSON.parse(r.text); return r.status === 404 && /json/.test(ct(r)) && j.ok === false && j.error?.code === "not_found"; }
  catch { return false; }
};

// every uploaded site file (honours site/.assetsignore's simple entries)
function siteFiles() {
  const ignore = readFileSync(join(SITE, ".assetsignore"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n), rel = relative(SITE, p);
      const top = rel.split("/")[0];
      if (ignore.includes(top) || ignore.includes(rel) || rel.split("/").includes(".claude")) continue;
      if (rel === ".assetsignore" || rel === "_headers") continue;
      if (top === "client") continue; // store files are checked separately (host-limited)
      if (rel.endsWith(".html")) continue; // html is checked via its pretty URL (/, /projects/, 404)
      if (statSync(p).isDirectory()) walk(p); else out.push("/" + rel);
    }
  };
  walk(SITE);
  return out.sort();
}

async function main() {
  const api = await startDev(root, API_HOST, BASE_PORT);
  const site = {};
  for (let i = 0; i < SITE_HOSTS.length; i++) site[SITE_HOSTS[i]] = await startDev(root, SITE_HOSTS[i], BASE_PORT + 1 + i);
  const baselineDir = process.env.BASELINE_DIR;
  const baseline = baselineDir ? await startDev(baselineDir, "haunted.ong", BASE_PORT + 9) : null;

  // ---- api.haunted.ong ----
  for (const p of ["/", "/index.html", "/projects/", "/css/styles.css", "/assets/pfp.webp", "/robots.txt", "/404.html", "/api/license/v1/check", "/client/", "/license", "/license/v2/validate"]) {
    const r = await get(api, p);
    record(`api host: GET ${p} is a JSON 404, no site content`, isJson404(r) && !/<html/i.test(r.text), `${r.status} ${ct(r)}`);
  }
  {
    const r = await get(api, "/license/v1/check", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    record("api host: POST /license/v1/check is a JSON 404", isJson404(r), `${r.status}`);
    const v = await get(api, "/license/v1/validate", { method: "POST", headers: { "content-type": "application/json" }, body: "junk-not-json" });
    let j = null; try { j = JSON.parse(v.text); } catch {}
    record("api host: POST /license/v1/validate junk is a JSON error", v.status >= 400 && v.status < 500 && /json/.test(ct(v)) && j?.ok === false, `${v.status} ${j?.error?.code}`);
    const a = await get(api, "/license/v1/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "CC-AAAAA-AAAAA-AAAAA-AAAAA", device_fp: "0".repeat(64) }) });
    record("api host: /license/v1/activate reaches the API (JSON answer)", /json/.test(ct(a)) && a.status !== 404 || (a.status === 404 && JSON.parse(a.text).error?.code !== "not_found") || a.status === 400, `${a.status} ${a.text.slice(0, 60)}`);
    const adm = await get(api, "/license/v1/admin/licenses");
    record("api host: admin route without token is 401 JSON", adm.status === 401 && /json/.test(ct(adm)), `${adm.status}`);
    record("api host: responses carry X-Robots-Tag noindex", (r.h.get("x-robots-tag") || "").includes("noindex") && (v.h.get("x-robots-tag") || "").includes("noindex"));
    const old = await get(api, "/api/license/v1/validate", { method: "POST", headers: { "content-type": "application/json" }, body: "junk-not-json" });
    record("api host: old /api/license/v1/validate path is gone (JSON 404)", isJson404(old), `${old.status}`);
  }

  // ---- site hosts ----
  const files = siteFiles();
  const nf = await get(site["haunted.ong"], "/definitely-not-a-page-xyz");
  const nfFile = readFileSync(join(SITE, "404.html"));
  record("site: unknown path is the 404 page", nf.status === 404 && nf.body.equals(nfFile), `${nf.status}`);
  for (const host of SITE_HOSTS) {
    const b = site[host];
    const postNf = await get(b, "/some/unknown/path", { method: "POST", headers: { "content-type": "application/json" }, body: "junk" });
    const home = await get(b, "/");
    record(`${host}: GET / is 200 and byte-identical to site/index.html`, home.status === 200 && home.body.equals(readFileSync(join(SITE, "index.html"))), `${home.status}`);
    const proj = await get(b, "/projects/");
    record(`${host}: GET /projects/ byte-identical`, proj.status === 200 && proj.body.equals(readFileSync(join(SITE, "projects/index.html"))), `${proj.status}`);
    const css = await get(b, "/css/styles.css");
    record(`${host}: /css/styles.css keeps its _headers Cache-Control`, css.status === 200 && css.h.get("cache-control") === "public, max-age=3600, stale-while-revalidate=86400", css.h.get("cache-control"));
    const font = await get(b, "/assets/Rubik-Regular.woff2");
    record(`${host}: woff2 keeps immutable caching`, font.status === 200 && font.h.get("cache-control") === "public, max-age=31536000, immutable", font.h.get("cache-control"));
    for (const [m, p] of [["GET", "/api"], ["GET", "/api/"], ["GET", "/api/license/v1/check"], ["POST", "/api/license/v1/check"], ["POST", "/api/license/v1/validate"], ["GET", "/api/license/v1/admin/licenses"], ["GET", "/api/anything/else"]]) {
      const r = await get(b, p, m === "POST" ? { method: "POST", headers: { "content-type": "application/json" }, body: "junk" } : {});
      const ok = m === "GET"
        ? r.status === 404 && r.body.equals(nfFile) && !/json/.test(ct(r)) && !r.h.get("x-robots-tag")
        : r.status === postNf.status && r.body.equals(postNf.body) && ct(r) === ct(postNf) && !r.h.get("x-robots-tag");
      record(`${host}: ${m} ${p} answers like any unknown site path (no API hint)`, ok, `${r.status} ${ct(r)}`);
    }
    const storeHost = host !== "zachxbt.boo";
    const nf404 = ["/client", "/client/", "/client/other", "/client/buy/x", "/client/buyx", "/client/dashboardx", "/client/assets/nope.js", "/client/assets/", "/client/buy/index.htm"];
    if (!storeHost) nf404.push("/client/buy/", "/client/buy", "/client/dashboard/", "/client/assets/store.js", "/client/assets/qrcodegen.js");
    for (const p of nf404) {
      const r = await get(b, p);
      record(`${host}: GET ${p} is a noindex 404`, r.status === 404 && /noindex/.test(r.h.get("x-robots-tag") || "") && r.body.equals(nfFile), `${r.status} x-robots-tag=${r.h.get("x-robots-tag")}`);
    }
    if (storeHost) {
      for (const page of ["buy", "dashboard"]) {
        const file = readFileSync(join(SITE, "client", page, "index.html"));
        const r = await get(b, `/client/${page}/`);
        record(`${host}: GET /client/${page}/ serves the store page with noindex (header + meta), CSP, no-referrer`,
          r.status === 200 && r.body.equals(file) && /noindex/.test(r.h.get("x-robots-tag") || "") && /<meta name="robots" content="noindex/.test(r.text) &&
          /connect-src https:\/\/api\.haunted\.ong/.test(r.h.get("content-security-policy") || "") && r.h.get("referrer-policy") === "no-referrer" && r.h.get("x-frame-options") === "DENY",
          `${r.status} xrt=${r.h.get("x-robots-tag")}`);
        for (const alt of [`/client/${page}`, `/client/${page}/index.html`]) {
          const x = await get(b, alt);
          record(`${host}: GET ${alt} redirects to /client/${page}/ (noindex)`, (x.status === 307 || x.status === 308) && new URL(x.h.get("location"), "http://h").pathname === `/client/${page}/` && /noindex/.test(x.h.get("x-robots-tag") || ""), `${x.status} ${x.h.get("location")}`);
        }
        const post = await get(b, `/client/${page}/`, { method: "POST", headers: { "content-type": "application/json" }, body: "junk" });
        record(`${host}: POST /client/${page}/ answers like an unknown path (+noindex)`, post.status === postNf.status && post.body.equals(postNf.body) && /noindex/.test(post.h.get("x-robots-tag") || ""), `${post.status}`);
      }
      for (const f of ["store.css", "store.js", "buy.js", "dashboard.js", "qrcodegen.js"]) {
        const r = await get(b, `/client/assets/${f}`);
        record(`${host}: /client/assets/${f} served byte-for-byte with noindex`, r.status === 200 && r.body.equals(readFileSync(join(SITE, "client/assets", f))) && /noindex/.test(r.h.get("x-robots-tag") || ""), `${r.status}`);
      }
      const head = await get(b, "/client/buy/", { method: "HEAD" });
      record(`${host}: HEAD /client/buy/ is 200 with noindex`, head.status === 200 && /noindex/.test(head.h.get("x-robots-tag") || ""), `${head.status}`);
    }
    const lic = await get(b, "/license/v1/validate", { method: "POST", headers: { "content-type": "application/json" }, body: "junk" });
    record(`${host}: /license/v1/* is not the API here (same as unknown path)`, lic.status === postNf.status && !/json/.test(ct(lic)) && lic.body.equals(postNf.body), `${lic.status}`);
    const licG = await get(b, "/license/v1/check");
    record(`${host}: GET /license/v1/check is the site 404`, licG.status === 404 && licG.body.equals(nfFile), `${licG.status}`);
  }
  // store pages: only /client/buy has a QR; nothing main links to the store; not in the sitemap
  {
    const buy = readFileSync(join(SITE, "client/buy/index.html"), "utf8"), dash = readFileSync(join(SITE, "client/dashboard/index.html"), "utf8");
    const dashJs = readFileSync(join(SITE, "client/assets/dashboard.js"), "utf8");
    const wallets = /4nfyHLEDszwxTgxUAz1B5t8U5ZagXxrkg59wuwrgkMrA|0xd7ee3e4725967b353ba60334cf14679ed2f7df5e|bc1qnhxzzgv7wg8cfkhmuwydgrgzmfycn67cmccfse|qrcodegen|solana:|bitcoin:|ethereum:/i;
    record("store: QR library only on /client/buy; dashboard has no QR, wallet or pay address", /qrcodegen\.js/.test(buy) && !wallets.test(dash) && !wallets.test(dashJs));
    const mainFiles = [];
    const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n), rel = relative(SITE, p); if (rel.split("/")[0] === "client" || rel.includes("screenshots") || rel.includes(".claude")) continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(html|js|xml|txt|css|md)$/.test(n) || n === "_headers") mainFiles.push(p); } };
    walk(SITE);
    const offenders = mainFiles.filter((p) => wallets.test(readFileSync(p, "utf8")) || /\/client\b/.test(readFileSync(p, "utf8")));
    record(`store: none of the ${mainFiles.length} main site files has a wallet, QR or link to /client (sitemap included)`, offenders.length === 0, offenders.map((p) => relative(SITE, p)).join(" "));
    const thirdParty = [buy, dash].concat(["store.js", "buy.js", "dashboard.js", "store.css"].map((f) => readFileSync(join(SITE, "client/assets", f), "utf8")))
      .some((t) => /(src|href)=["']https?:\/\//i.test(t) || /url\(["']?https?:/i.test(t) || /fetch\(["'`]https?:\/\/(?!api\.haunted\.ong)/.test(t));
    record("store: no third-party scripts, styles, fonts or analytics", !thirdParty);
  }

  // every site file on every site host
  let bad = [];
  for (const host of SITE_HOSTS) for (const f of files) {
    const r = await get(site[host], f);
    if (r.status !== 200 || !r.body.equals(readFileSync(join(SITE, f)))) bad.push(`${host}${f}:${r.status}`);
  }
  record(`site: all ${files.length} uploaded files served byte-for-byte on all 3 hosts`, bad.length === 0, bad.slice(0, 5).join(" "));

  // ---- baseline comparison (old Worker, haunted.ong) ----
  if (baseline) {
    const paths = ["/", "/projects", "/projects/", "/index.html", "/projects/index.html", "/nope-xyz", "/404.html", "/client", "/client/", "/client/other", "/client/assets/nope.js", "/root", ...files];
    // ETag values aren't compared: wrangler dev derives them per checkout (two
    // copies of the same old code differ too). Production hashes file content.
    const keys = ["content-type", "cache-control", "location", "x-robots-tag", "content-encoding"];
    const diffs = [];
    for (const p of paths) for (const method of ["GET", "HEAD", "POST"]) {
      const o = await get(baseline, p, { method }), n = await get(site["haunted.ong"], p, { method });
      const oo = [o.status, sha(o.body), !!o.h.get("etag"), ...keys.map((k) => o.h.get(k))].join("|");
      const nn = [n.status, sha(n.body), !!n.h.get("etag"), ...keys.map((k) => n.h.get(k))].join("|");
      // /client is the one intended change: same answer, plus X-Robots-Tag: noindex
      // /client gained X-Robots-Tag: noindex in the api.haunted.ong move; against a
      // pre-move baseline that's the one allowed difference. Against the move
      // version (the live one before the store) everything must be identical.
      const same = nn === oo || (p.startsWith("/client") && o.h.get("x-robots-tag") === null && n.h.get("x-robots-tag") === "noindex" &&
          oo.replace(/\|noindex\|/, "||") === nn.replace(/\|noindex\|/, "||"));
      if (!same) diffs.push(`${method} ${p}\n    old ${oo}\n    new ${nn}`);
    }
    record(`baseline: ${paths.length * 3} GET/HEAD/POST site responses match the old Worker (status, body, headers)`, diffs.length === 0, diffs.slice(0, 3).join("\n"));
    // conditional request still revalidates
    const et = (await get(site["haunted.ong"], "/css/styles.css")).h.get("etag");
    const eto = (await get(baseline, "/css/styles.css")).h.get("etag");
    const c = await get(site["haunted.ong"], "/css/styles.css", { headers: { "if-none-match": et || "" } });
    const co = await get(baseline, "/css/styles.css", { headers: { "if-none-match": eto || "" } });
    record("baseline: If-None-Match revalidation (304) works as before", !!et && c.status === 304 && co.status === 304, `old=${co.status} new=${c.status}`);
  }

  console.log(`\n---- routing summary ----\n${passed}/${passed + failed} passed, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error("routing test failed to run:", e.message); process.exitCode = 1; })
  .finally(() => {
    for (const p of procs) { try { process.kill(-p.pid, "SIGTERM"); } catch {} }
    setTimeout(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }); }, 1500);
  });
