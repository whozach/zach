#!/usr/bin/env node
/**
 * End-to-end tests against `wrangler dev --local`, simulating the
 * api.haunted.ong host with --local-upstream (request.url host = API_HOST).
 * Covers key-api-spec.md §11 (1–8) plus CRYPTO- prefix, bad checksum, and oversize body.
 * Never prints ADMIN_TOKEN, SIGNING_KEY_JWK, or FP_PEPPER.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const API_HOST = process.env.API_HOST || "api.haunted.ong";
const API = BASE + "/license/v1";
const PORT = Number(new URL(BASE).port || 8787);
const START_SERVER = process.env.START_SERVER !== "0";

const results = [];
let failed = 0;
let wranglerProc = null;
let rateLimitEnforced = null;

function loadDevVars(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1);
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, i)] = v;
  }
  return out;
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
  else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

async function parseRes(res) {
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function req(method, path, { body, token, headers: extra } = {}) {
  const headers = { ...(extra || {}) };
  if (body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
  if (token) headers.authorization = "Bearer " + token;
  const res = await fetch((path.startsWith("http") ? path : API + path), {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return parseRes(res);
}

function fp(tag) {
  // 64 hex, distinct per device tag. Not a real fingerprint.
  const hex = Buffer.from(String(tag).padEnd(32, "x")).toString("hex").slice(0, 64);
  return hex.length === 64 ? hex : (hex + "0".repeat(64)).slice(0, 64);
}

function decodePayload(token) {
  const first = token.split(".")[0];
  return JSON.parse(Buffer.from(first, "base64url").toString("utf8"));
}

async function signLocal(jwk, payload) {
  const key = await crypto.subtle.importKey(
    "jwk",
    typeof jwk === "string" ? JSON.parse(jwk) : jwk,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const json = JSON.stringify({
    v: payload.v,
    lic: payload.lic,
    act: payload.act,
    gen: payload.gen,
    dev: payload.dev,
    plan: payload.plan,
    iat: payload.iat,
    exp: payload.exp,
    grace: payload.grace,
    lexp: payload.lexp ?? null,
    kid: payload.kid,
  });
  const first = Buffer.from(json, "utf8").toString("base64url");
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, Buffer.from(first, "utf8"));
  return `${first}.${Buffer.from(sig).toString("base64url")}`;
}

function runCmd(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true", ...opts.env },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err, code });
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${err}\n${out}`));
    });
  });
}

function startWrangler() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "--yes",
        "wrangler@4",
        "dev",
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        String(PORT),
        "--local-upstream",
        API_HOST,
        "--persist-to",
        ".wrangler/state",
      ],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
        detached: true,
      },
    );
    wranglerProc = child;
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      if (/Ready on|127\.0\.0\.1:|localhost:/.test(buf)) {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("wrangler dev --local did not become ready in time.\n" + buf));
    }, 60000);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("exit", (code) => {
      if (code && code !== 0) {
        cleanup();
        reject(new Error("wrangler dev exited early: " + code + "\n" + buf));
      }
    });
  });
}

async function waitReady() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + "/");
      if (res.status) return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("server never answered on " + BASE);
}

async function setup() {
  if (!existsSync(join(root, ".dev.vars"))) {
    await runCmd("node", ["tools/gen-secrets.mjs"]);
  }
  await runCmd("npx", [
    "--yes",
    "wrangler@4",
    "d1",
    "migrations",
    "apply",
    "crypto-licenses",
    "--local",
    "--persist-to",
    ".wrangler/state",
  ]);
  if (START_SERVER) await startWrangler();
  await waitReady();
}

function stopWrangler() {
  if (!wranglerProc) return;
  const pid = wranglerProc.pid;
  try {
    if (pid) process.kill(-pid, "SIGTERM");
  } catch {
    try {
      wranglerProc.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  wranglerProc = null;
}

async function main() {
  await setup();
  const vars = loadDevVars(join(root, ".dev.vars"));
  if (!vars.ADMIN_TOKEN || !vars.SIGNING_KEY_JWK || !vars.FP_PEPPER) {
    throw new Error(".dev.vars is missing required keys (names only checked).");
  }
  const admin = vars.ADMIN_TOKEN;
  const jwk = JSON.parse(vars.SIGNING_KEY_JWK);
  const fpA = fp("device-a-primary-slot");
  const fpB = fp("device-b-second-slot");

  // 1. Issue → activate → validate → deactivate → activate again
  const issued = await req("POST", "/admin/keys", {
    token: admin,
    body: { count: 1, plan: "standard", max_devices: 1, note: "e2e-1" },
  });
  const key1 = issued.json?.keys?.[0]?.key;
  const lic1 = issued.json?.keys?.[0]?.id;
  record(
    "§11.1 issue a CC- key",
    issued.status === 200 &&
      issued.json?.ok === true &&
      typeof key1 === "string" &&
      key1.startsWith("CC-") &&
      /^CC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(key1),
    `http ${issued.status}`,
  );

  const act1 = await req("POST", "/activate", {
    body: { key: key1, device_fp: fpA, client_version: "0.47.0", device_label: "desktop" },
  });
  const token1 = act1.json?.token;
  record(
    "§11.1 activate",
    act1.status === 200 && act1.json?.ok === true && typeof token1 === "string" && token1.includes("."),
    `http ${act1.status} devices_used=${act1.json?.license?.devices_used}`,
  );

  const val1 = await req("POST", "/validate", {
    body: { token: token1, device_fp: fpA, client_version: "0.47.0" },
  });
  const token1b = val1.json?.token;
  record(
    "§11.1 validate",
    val1.status === 200 && val1.json?.ok === true && typeof token1b === "string",
    `http ${val1.status}`,
  );

  const deact = await req("POST", "/deactivate", { body: { token: token1b, device_fp: fpA } });
  record(
    "§11.1 deactivate",
    deact.status === 200 && deact.json?.ok === true && deact.json?.devices_used === 0,
    `http ${deact.status} devices_used=${deact.json?.devices_used}`,
  );

  const act1again = await req("POST", "/activate", {
    body: { key: key1, device_fp: fpA, client_version: "0.47.0" },
  });
  const token1c = act1again.json?.token;
  record(
    "§11.1 activate again on the same device",
    act1again.status === 200 && act1again.json?.ok === true && typeof token1c === "string",
    `http ${act1again.status}`,
  );

  // 2. Second device with max_devices 1 → device_limit; reset moves the seat
  const act2 = await req("POST", "/activate", {
    body: { key: key1, device_fp: fpB, client_version: "0.47.0" },
  });
  record(
    "§11.2 second device gets device_limit",
    act2.status === 409 && act2.json?.error?.code === "device_limit",
    `http ${act2.status} code=${act2.json?.error?.code}`,
  );

  const reset = await req("POST", "/reset", {
    body: { key: key1, device_fp: fpB, client_version: "0.47.0" },
  });
  const tokenB = reset.json?.token;
  record(
    "§11.2 reset moves the seat to the new device",
    reset.status === 200 && reset.json?.ok === true && typeof tokenB === "string",
    `http ${reset.status}`,
  );

  const oldAfterReset = await req("POST", "/validate", {
    body: { token: token1c, device_fp: fpA, client_version: "0.47.0" },
  });
  record(
    "§11.2 previous device is released after reset",
    oldAfterReset.status === 403 && oldAfterReset.json?.error?.code === "activation_released",
    `http ${oldAfterReset.status} code=${oldAfterReset.json?.error?.code}`,
  );

  // 3. Revoke, then the very next validate returns key_revoked
  const issued2 = await req("POST", "/admin/keys", {
    token: admin,
    body: { count: 1, plan: "standard", note: "e2e-revoke" },
  });
  const keyR = issued2.json?.keys?.[0]?.key;
  const licR = issued2.json?.keys?.[0]?.id;
  const actR = await req("POST", "/activate", {
    body: { key: keyR, device_fp: fpA, client_version: "0.47.0" },
  });
  const tokenR = actR.json?.token;
  const rev = await req("POST", `/admin/licenses/${licR}/revoke`, {
    token: admin,
    body: { reason: "e2e" },
  });
  const valRev = await req("POST", "/validate", {
    body: { token: tokenR, device_fp: fpA, client_version: "0.47.0" },
  });
  record(
    "§11.3 revoke then the next validate returns key_revoked",
    rev.status === 200 &&
      valRev.status === 403 &&
      valRev.json?.error?.code === "key_revoked" &&
      valRev.json?.error?.reason === "e2e",
    `revoke=${rev.status} validate=${valRev.status} code=${valRev.json?.error?.code}`,
  );

  // 4. Tampered payload / signature; stale gen after reactivation
  const issued3 = await req("POST", "/admin/keys", {
    token: admin,
    body: { count: 1, note: "e2e-tamper" },
  });
  const keyT = issued3.json?.keys?.[0]?.key;
  const actT = await req("POST", "/activate", {
    body: { key: keyT, device_fp: fpA, client_version: "0.47.0" },
  });
  const tokenT = actT.json?.token;
  const [seg, sig] = tokenT.split(".");
  const payloadT = decodePayload(tokenT);
  const tamperedJson = Buffer.from(JSON.stringify({ ...payloadT, plan: "forged" })).toString("base64url");
  const badPayload = await req("POST", "/validate", {
    body: { token: `${tamperedJson}.${sig}`, device_fp: fpA },
  });
  record(
    "§11.4 tampered payload returns token_invalid",
    badPayload.status === 401 && badPayload.json?.error?.code === "token_invalid",
    `http ${badPayload.status} code=${badPayload.json?.error?.code}`,
  );

  const badSigBytes = Buffer.from(sig, "base64url");
  badSigBytes[0] ^= 0xff;
  const badSigTok = `${seg}.${badSigBytes.toString("base64url")}`;
  const badSig = await req("POST", "/validate", {
    body: { token: badSigTok, device_fp: fpA },
  });
  record(
    "§11.4 tampered signature returns token_invalid",
    badSig.status === 401 && badSig.json?.error?.code === "token_invalid",
    `http ${badSig.status} code=${badSig.json?.error?.code}`,
  );

  const staleOld = tokenT;
  const actAgain = await req("POST", "/activate", {
    body: { key: keyT, device_fp: fpA, client_version: "0.47.0" },
  });
  const stale = await req("POST", "/validate", {
    body: { token: staleOld, device_fp: fpA },
  });
  record(
    "§11.4 stale gen after reactivation returns token_invalid",
    actAgain.status === 200 && stale.status === 401 && stale.json?.error?.code === "token_invalid",
    `http ${stale.status} code=${stale.json?.error?.code}`,
  );

  // 5. API host never serves the site, unknown API path, /check
  const home = await fetch(BASE + "/");
  const homeText = await home.text();
  const homeCt = home.headers.get("content-type") || "";
  record(
    "§11.5 GET / on the API host is a JSON 404, not the site",
    home.status === 404 && /json/i.test(homeCt) && !/<html/i.test(homeText),
    `http ${home.status} content-type=${homeCt}`,
  );

  const unknown = await req("GET", "/unknown");
  record(
    "§11.5 /license/v1/unknown returns JSON 404",
    unknown.status === 404 &&
      unknown.json?.ok === false &&
      unknown.json?.error?.code === "not_found" &&
      /json/i.test(unknown.headers.get("content-type") || ""),
    `http ${unknown.status} code=${unknown.json?.error?.code}`,
  );

  const check = await req("POST", "/check", { body: { token: "x", device_fp: fpA } });
  record(
    "§11.5 POST /license/v1/check returns JSON 404 (not an alias of /validate)",
    check.status === 404 && check.json?.ok === false && check.json?.error?.code === "not_found",
    `http ${check.status} code=${check.json?.error?.code}`,
  );

  // 6. Admin auth
  const noBearer = await req("POST", "/admin/keys", { body: { count: 1 } });
  record(
    "§11.6 admin without bearer returns 401",
    noBearer.status === 401 && noBearer.json?.error?.code === "unauthorized",
    `http ${noBearer.status} code=${noBearer.json?.error?.code}`,
  );
  const wrongBearer = await req("POST", "/admin/keys", {
    body: { count: 1 },
    token: "this-is-not-the-admin-token-value-at-all-000000",
  });
  record(
    "§11.6 admin with a wrong bearer returns 401",
    wrongBearer.status === 401 && wrongBearer.json?.error?.code === "unauthorized",
    `http ${wrongBearer.status} code=${wrongBearer.json?.error?.code}`,
  );

  // 7. Token times; validate after exp before grace
  const issued7 = await req("POST", "/admin/keys", {
    token: admin,
    body: { count: 1, note: "e2e-times" },
  });
  const key7 = issued7.json?.keys?.[0]?.key;
  const act7 = await req("POST", "/activate", {
    body: { key: key7, device_fp: fpA, client_version: "0.47.0" },
  });
  const p7 = decodePayload(act7.json.token);
  const expOk = p7.exp === p7.iat + 6 * 3600;
  const graceOk = p7.grace === p7.iat + 24 * 3600;
  record(
    "§11.7 fresh token has exp = iat+6h, grace = iat+24h, exp < grace",
    act7.status === 200 && expOk && graceOk && p7.exp < p7.grace && p7.kid === "k1",
    `iat=${p7.iat} exp=${p7.exp} grace=${p7.grace}`,
  );

  const pastIat = Math.floor(Date.now() / 1000) - 7 * 3600; // exp 1h ago, grace 17h ahead
  const midToken = await signLocal(jwk, {
    v: 1,
    lic: p7.lic,
    act: p7.act,
    gen: p7.gen,
    dev: p7.dev,
    plan: p7.plan,
    iat: pastIat,
    exp: pastIat + 6 * 3600,
    grace: pastIat + 24 * 3600,
    lexp: p7.lexp ?? null,
    kid: "k1",
  });
  const midNow = Math.floor(Date.now() / 1000);
  const inWindow = midNow >= pastIat + 6 * 3600 && midNow < pastIat + 24 * 3600;
  const midVal = await req("POST", "/validate", {
    body: { token: midToken, device_fp: fpA, client_version: "0.47.0" },
  });
  let freshP = null;
  if (midVal.json?.token) freshP = decodePayload(midVal.json.token);
  record(
    "§11.7 after exp and before grace, /validate accepts the token and returns a fresh one",
    inWindow &&
      midVal.status === 200 &&
      midVal.json?.ok === true &&
      typeof midVal.json?.token === "string" &&
      midVal.json.token !== midToken &&
      freshP &&
      freshP.exp === freshP.iat + 6 * 3600 &&
      freshP.grace === freshP.iat + 24 * 3600,
    `http ${midVal.status} in_window=${inWindow} code=${midVal.json?.error?.code || "ok"}`,
  );

  // 8. Forged token must not burn the license limiter
  const issued8 = await req("POST", "/admin/keys", {
    token: admin,
    body: { count: 1, note: "e2e-rl" },
  });
  const key8 = issued8.json?.keys?.[0]?.key;
  const act8 = await req("POST", "/activate", {
    body: { key: key8, device_fp: fpA, client_version: "0.47.0" },
  });
  const p8 = decodePayload(act8.json.token);
  const forgedPayload = Buffer.from(
    JSON.stringify({
      v: 1,
      lic: p8.lic,
      act: p8.act,
      gen: p8.gen,
      dev: p8.dev,
      plan: p8.plan,
      iat: p8.iat,
      exp: p8.exp,
      grace: p8.grace,
      lexp: null,
      kid: "k1",
    }),
  ).toString("base64url");
  const forgedSig = Buffer.alloc(64, 7).toString("base64url");
  const forgedTok = `${forgedPayload}.${forgedSig}`;

  // Use a fresh CF-Connecting-IP so earlier /activate IP counts do not
  // bleed into this check (activate and unverified validate share a:ip).
  const forgedIp = "203.0.113.80";
  let forgedInvalid = 0;
  let forgedLimited = 0;
  let forgedOther = 0;
  for (let i = 0; i < 12; i++) {
    const r = await req("POST", "/validate", {
      body: { token: forgedTok, device_fp: fpA },
      headers: { "CF-Connecting-IP": forgedIp },
    });
    if (r.status === 401 && r.json?.error?.code === "token_invalid") forgedInvalid += 1;
    else if (r.status === 429) forgedLimited += 1;
    else forgedOther += 1;
  }
  const afterForge = await req("POST", "/validate", {
    body: { token: act8.json.token, device_fp: fpA, client_version: "0.47.0" },
  });
  record(
    "§11.8 forged token (bad signature, plausible lic) returns token_invalid",
    forgedInvalid >= 12 && forgedLimited === 0 && forgedOther === 0,
    `invalid=${forgedInvalid} limited=${forgedLimited} other=${forgedOther}`,
  );
  record(
    "§11.8 real /validate after 12 forged requests still succeeds (license limiter not consumed)",
    afterForge.status === 200 && afterForge.json?.ok === true,
    `http ${afterForge.status} code=${afterForge.json?.error?.code || "ok"}`,
  );

  // Probe whether wrangler dev actually enforces the rate-limit binding.
  // Use a well-formed unknown key so we only hit limiters + key_not_found.
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const nineteen = "E2EPR0BEKEYN0R0BE12"; // 19 Crockford chars, no I/L/O/U
  if (nineteen.length !== 19) throw new Error("probe nineteen length");
  const hash = await crypto.subtle.digest("SHA-256", Buffer.from(nineteen, "utf8"));
  const checkCh = alphabet[new Uint8Array(hash)[0] % 32];
  const body = nineteen + checkCh;
  const probeKey = `CC-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}`;
  const probeIp = "203.0.113.81";
  let notFound = 0;
  let limited = 0;
  let other = 0;
  let otherDetail = [];
  for (let i = 0; i < 6; i++) {
    const r = await req("POST", "/activate", {
      body: { key: probeKey, device_fp: fpA },
      headers: { "CF-Connecting-IP": probeIp },
    });
    if (r.status === 404 && r.json?.error?.code === "key_not_found") notFound += 1;
    else if (r.status === 429) limited += 1;
    else {
      other += 1;
      if (otherDetail.length < 3) otherDetail.push(`${r.status}:${r.json?.error?.code || r.text.slice(0, 80)}`);
    }
  }
  // Per-key activate limit is 5/min. A 6th request would 429 if enforced.
  rateLimitEnforced = limited > 0;
  record(
    "rate-limit binding probe (6 activates of an unknown key; 5/min per key)",
    true,
    rateLimitEnforced
      ? `enforced locally (not_found=${notFound}, limited=${limited})`
      : `NOT enforced by wrangler dev --local (not_found=${notFound}, limited=${limited}, other=${other}${otherDetail.length ? " detail=" + otherDetail.join(",") : ""}); ordering is covered by tests/rate-limit-order.mjs`,
  );

  // Extra: CRYPTO- prefix, bad checksum, oversize body
  const cryptoPrefix = await req("POST", "/activate", {
    body: { key: "CRYPTO-7Q2MK-ABCDE-FGHIJ-KLMN0", device_fp: fpA },
  });
  record(
    "CRYPTO- prefixed key is rejected",
    cryptoPrefix.status === 400 && cryptoPrefix.json?.error?.code === "bad_request",
    `http ${cryptoPrefix.status} code=${cryptoPrefix.json?.error?.code}`,
  );

  const badCheck = "CC-01234-56789-ABCDE-FGHJ0"; // last char almost certainly wrong
  const badCs = await req("POST", "/activate", { body: { key: badCheck, device_fp: fpA } });
  record(
    "bad checksum is rejected",
    badCs.status === 400 && badCs.json?.error?.code === "bad_request",
    `http ${badCs.status} code=${badCs.json?.error?.code}`,
  );

  const oversize = await req("POST", "/activate", {
    body: JSON.stringify({ key: key1, device_fp: fpA, pad: "x".repeat(5000) }),
  });
  record(
    "oversize body is rejected",
    oversize.status === 400 && oversize.json?.error?.code === "bad_request",
    `http ${oversize.status} code=${oversize.json?.error?.code}`,
  );

  // No CORS headers on API responses
  const corsHdr = val1.headers.get("access-control-allow-origin");
  record(
    "API responses have no Access-Control-Allow-Origin",
    corsHdr == null,
    corsHdr == null ? "absent" : corsHdr,
  );

  // Smoke a few remaining admin routes (not in §11, reported honestly)
  const listed = await req("GET", "/admin/licenses?status=active&limit=5", { token: admin });
  record(
    "extra: GET /admin/licenses returns items",
    listed.status === 200 && listed.json?.ok === true && Array.isArray(listed.json.items),
    `http ${listed.status} count=${listed.json?.items?.length}`,
  );
  const one = await req("GET", `/admin/licenses/${lic1}`, { token: admin });
  const hmacFull = JSON.stringify(one.json ?? {}).includes(one.json?.activations?.[0]?.device_hmac?.length > 8
    ? "skip"
    : "");
  const prefixesOk = (one.json?.activations ?? []).every(
    (a) => typeof a.device_hmac === "string" && a.device_hmac.length === 8,
  );
  record(
    "extra: GET /admin/licenses/{id} returns activations with only 8 hex of device_hmac",
    one.status === 200 && one.json?.ok === true && prefixesOk,
    `http ${one.status}`,
  );
  const lookup = await req("POST", "/admin/lookup", { token: admin, body: { key: key1 } });
  record(
    "extra: POST /admin/lookup finds the license",
    lookup.status === 200 && lookup.json?.ok === true && lookup.json?.license?.id === lic1,
    `http ${lookup.status}`,
  );
  const patched = await req("PATCH", `/admin/licenses/${lic1}`, {
    token: admin,
    body: { note: "e2e-patched" },
  });
  record(
    "extra: PATCH /admin/licenses/{id}",
    patched.status === 200 && patched.json?.ok === true && patched.json?.note === "e2e-patched",
    `http ${patched.status}`,
  );
  const unrev = await req("POST", `/admin/licenses/${licR}/unrevoke`, { token: admin });
  record(
    "extra: POST /admin/licenses/{id}/unrevoke",
    unrev.status === 200 && unrev.json?.ok === true && unrev.json?.status === "active",
    `http ${unrev.status}`,
  );
  const admReset = await req("POST", `/admin/licenses/${issued3.json?.keys?.[0]?.id}/reset`, { token: admin });
  record(
    "extra: POST /admin/licenses/{id}/reset",
    admReset.status === 200 && admReset.json?.ok === true,
    `http ${admReset.status}`,
  );
  const audit = await req("GET", `/admin/audit?license_id=${lic1}&limit=10`, { token: admin });
  const auditText = JSON.stringify(audit.json ?? "");
  const leakedIp = /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(auditText);
  record(
    "extra: GET /admin/audit returns rows and no IPs",
    audit.status === 200 && audit.json?.ok === true && Array.isArray(audit.json.items) && !leakedIp,
    `http ${audit.status} rows=${audit.json?.items?.length} ip_leaked=${leakedIp}`,
  );

  // Third self-reset should hit reset_limit (already used 1 on key1). Do two more.
  const reset2 = await req("POST", "/reset", { body: { key: key1, device_fp: fpA } });
  const reset3 = await req("POST", "/reset", { body: { key: key1, device_fp: fpB } });
  record(
    "extra: third self-reset in 30 days returns reset_limit",
    reset2.status === 200 && reset3.status === 429 && reset3.json?.error?.code === "reset_limit",
    `second=${reset2.status} third=${reset3.status} code=${reset3.json?.error?.code}`,
  );

  console.log("\n---- summary ----");
  const pass = results.filter((r) => r.ok).length;
  console.log(`${pass}/${results.length} passed, ${failed} failed.`);
  if (rateLimitEnforced === false) {
    console.log(
      "Note: the Workers ratelimits binding was not enforced by wrangler dev --local. Section 11.8 integration could not prove a counter increment; tests/rate-limit-order.mjs covers the ordering logic.",
    );
  }
  if (failed) process.exit(1);
}

main()
  .catch((err) => {
    console.error("E2E failed to run:", err.message || err);
    process.exit(1);
  })
  .finally(() => {
    if (START_SERVER) stopWrangler();
  });
