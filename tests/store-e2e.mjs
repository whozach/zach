#!/usr/bin/env node
/**
 * Store e2e (client-store-plan.md §10) against `wrangler dev --local`, with
 * every chain / price API mocked by tests/store-mock.mjs.
 *   A: api.haunted.ong with HELIUS_API_KEY + ETHERSCAN_API_KEY set (test values) -> confirmers on
 *   B: api.haunted.ong with no keys -> Solana/Ethereum orders refused (coin_not_available)
 *   C: api.haunted.ong with only HELIUS_API_KEY -> Solana on, Ethereum still refused
 * D1 rows are aged with `wrangler d1 execute --local` (expiry / reveal-window tests).
 * Never prints ADMIN_TOKEN, SIGNING_KEY_JWK or FP_PEPPER.
 */
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createMock } from "./store-mock.mjs";
// The sales addresses and support contact come from worker/store-settings.js, so a new wallet
// there needs no test edits. The USDC token account is derived (store-unit checks the derivation).
import { SALES_ADDRESSES, SUPPORT_CONTACT } from "../worker/store-settings.js";
import { associatedTokenAddress } from "../worker/store.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT_A = Number(process.env.STORE_PORT || 8801), PORT_B = PORT_A + 1;
const API_HOST = "api.haunted.ong";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OUR_SOL = SALES_ADDRESSES.solana.trim();
const OUR_USDC_ATA = await associatedTokenAddress(OUR_SOL, USDC_MINT);
const OUR_ETH = SALES_ADDRESSES.ethereum.trim().toLowerCase();
const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const OUR_BTC = SALES_ADDRESSES.bitcoin.trim().toLowerCase();
const SYSTEM = "11111111111111111111111111111111", TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", ATA_PROG = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const ORIGIN = "https://haunted.ong";

const procs = [], tmps = [];
let passed = 0, failed = 0;
const record = (name, ok, detail = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadDevVars() {
  const out = {};
  for (const line of readFileSync(join(root, ".dev.vars"), "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("="); if (i < 0) continue;
    let v = line.slice(i + 1); if ((v[0] === "'" || v[0] === '"') && v.endsWith(v[0])) v = v.slice(1, -1);
    out[line.slice(0, i)] = v;
  }
  return out;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" } });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.slice(0, 4).join(" ")} exited ${code}\n${err.slice(-800)}\n${out.slice(-800)}`))));
  });
}

function startDev(port, persist, vars) {
  return new Promise((resolve, reject) => {
    const args = ["--yes", "wrangler@4", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--local-upstream", API_HOST,
      "--persist-to", persist, "--test-scheduled"];
    for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
    const child = spawn("npx", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" } });
    procs.push(child);
    let buf = "";
    const t = setTimeout(() => reject(new Error("dev not ready\n" + buf)), 90000);
    const on = (d) => { buf += d; if (/Ready on/.test(buf)) { clearTimeout(t); resolve(`http://127.0.0.1:${port}`); } };
    child.stdout.on("data", on); child.stderr.on("data", on);
    child.on("exit", (c) => { if (c) { clearTimeout(t); reject(new Error("dev exited " + c + "\n" + buf)); } });
  });
}

let persistA;
async function sql(command, persist = persistA) {
  const out = await run("npx", ["--yes", "wrangler@4", "d1", "execute", "crypto-licenses", "--local", "--persist-to", persist, "--json", "--command", command]);
  const j = JSON.parse(out.slice(out.indexOf("[")));
  return j[0]?.results ?? [];
}

function mk(base) {
  return async (method, path, { body, token, origin = ORIGIN, headers = {} } = {}) => {
    // a fresh documentation-range client IP per call, so the per-IP store limiters
    // (which wrangler dev does enforce) don't trip; the limiter test sets its own
    const h = { "CF-Connecting-IP": `198.51.100.${1 + Math.floor(Math.random() * 250)}`, ...headers };
    if (origin) h.origin = origin;
    if (body !== undefined) h["content-type"] = "application/json";
    if (token) h.authorization = "Bearer " + token;
    const res = await fetch(base + "/license/v1" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, h: res.headers };
  };
}

// ---- tx builders ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const rnd58 = (n = 44) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => B58[b % 58]).join("");
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const keyObjs = (keys) => keys.map((k, i) => ({ pubkey: k, signer: i === 0, writable: i < 3, source: "transaction" }));

function usdcTx({ ref, amount, preAta = "5000000", mint = USDC_MINT, err = null, blockTime = now(), owner = OUR_SOL, ataKey = OUR_USDC_ATA }) {
  const payer = rnd58(), payerAta = rnd58();
  const keys = [payer, payerAta, ataKey, mint, ref, TOKEN, ATA_PROG, SYSTEM];
  const pre = [{ accountIndex: 1, mint, owner: payer, uiTokenAmount: { amount: "900000000", decimals: 6 } }];
  if (preAta != null) pre.push({ accountIndex: 2, mint, owner, uiTokenAmount: { amount: preAta, decimals: 6 } });
  const post = [
    { accountIndex: 1, mint, owner: payer, uiTokenAmount: { amount: String(900000000n - BigInt(amount)), decimals: 6 } },
    { accountIndex: 2, mint, owner, uiTokenAmount: { amount: String(BigInt(preAta ?? "0") + BigInt(amount)), decimals: 6 } },
  ];
  const ix = [];
  if (preAta == null) ix.push({ programId: ATA_PROG, parsed: { type: "create", info: { account: ataKey, wallet: owner, mint } } });
  ix.push({ programId: TOKEN, parsed: { type: "transferChecked", info: { destination: ataKey, mint, tokenAmount: { amount: String(amount) } } } });
  return { blockTime, slot: 1, meta: { err, fee: 5000, preBalances: [1e9, 2039280, preAta == null ? 0 : 2039280, 1, 0, 1, 1, 1], postBalances: [1e9 - 5000, 2039280, 2039280, 1, 0, 1, 1, 1], preTokenBalances: pre, postTokenBalances: post },
    transaction: { signatures: [rnd58(88)], message: { accountKeys: keyObjs(keys), instructions: ix } } };
}

function solTx({ ref, lamports, blockTime = now(), err = null }) {
  const payer = rnd58();
  const keys = [payer, OUR_SOL, ref, SYSTEM];
  return { blockTime, slot: 1, meta: { err, fee: 5000, preBalances: [5e9, 7e9, 0, 1], postBalances: [5e9 - lamports - 5000, 7e9 + lamports, 0, 1], preTokenBalances: [], postTokenBalances: [] },
    transaction: { signatures: [rnd58(88)], message: { accountKeys: keyObjs(keys), instructions: [{ programId: SYSTEM, parsed: { type: "transfer", info: { destination: OUR_SOL, lamports } } }] } } };
}

// SOL-balance-only tx carrying the reference: must NOT count as a USDC payment
function solBalanceOnlyTx({ ref, amount }) {
  const t = solTx({ ref, lamports: Number(amount) });
  t.transaction.message.instructions = [{ programId: TOKEN, parsed: { type: "transfer", info: {} } }];
  return t;
}

async function main() {
  if (!existsSync(join(root, ".dev.vars"))) await run("node", ["tools/gen-secrets.mjs"]);
  const vars = loadDevVars();
  const admin = vars.ADMIN_TOKEN;
  const mock = createMock();
  const M = await mock.listen();
  const S = mock.state;
  persistA = mkdtempSync(join(tmpdir(), "store-a-")); tmps.push(persistA);
  const persistB = mkdtempSync(join(tmpdir(), "store-b-")); tmps.push(persistB);
  const persistC = mkdtempSync(join(tmpdir(), "store-c-")); tmps.push(persistC);
  for (const p of [persistA, persistB, persistC]) await run("npx", ["--yes", "wrangler@4", "d1", "migrations", "apply", "crypto-licenses", "--local", "--persist-to", p]);
  const A = await startDev(PORT_A, persistA, { STORE_MOCK_UPSTREAM: M, HELIUS_API_KEY: "test-helius-not-real", ETHERSCAN_API_KEY: "test-etherscan-not-real" });
  const B = await startDev(PORT_B, persistB, { STORE_MOCK_UPSTREAM: M });
  const C = await startDev(PORT_B + 1, persistC, { STORE_MOCK_UPSTREAM: M, HELIUS_API_KEY: "test-helius-not-real" });
  const a = mk(A), b = mk(B), c3 = mk(C);
  const sweep = async (base = A) => { const r = await fetch(base + "/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"); const t = await r.text(); if (r.status !== 200) throw new Error("scheduled handler: " + r.status + " " + t.slice(0, 200)); return r.status; };
  const poll = (o, claim, api = a) => api("GET", `/store/orders/${o}?claim=${encodeURIComponent(claim)}`);
  // sweep (cron path) then poll: a poll alone re-checks the chain at most every 10 s per order
  const check = async (o, claim, api = a, base = A) => { await sweep(base); return poll(o, claim, api); };
  const order = async (plan, chain, asset, extra = {}, api = a) => api("POST", "/store/orders", { body: { plan, chain, asset, ...extra } });

  // ---------------- config + CORS ----------------
  const cfg = await a("GET", "/store/config");
  const lifeCoins = cfg.json?.coins?.filter((c) => c.plans.includes("lifetime")).map((c) => c.chain + ":" + c.asset).sort().join(",");
  record("config: 4 plans at $7.99 / $22.99 / $59.99 / $124.99", cfg.json?.plans?.map((p) => p.id + "=" + p.usd).join(",") === "30d=7.99,90d=22.99,365d=59.99,lifetime=124.99");
  record("config: lifetime offered only on Solana USDC/SOL", lifeCoins === "solana:sol,solana:usdc", lifeCoins);
  record("config: default coin is Solana USDC", cfg.json?.default_coin?.chain === "solana" && cfg.json?.default_coin?.asset === "usdc");
  record("config: support contact is the one in store-settings.js (null while empty)", cfg.json?.support === (SUPPORT_CONTACT.trim() || null), JSON.stringify(cfg.json?.support));
  record("CORS: store response carries ACAO for https://haunted.ong (+ Vary: Origin, no-store)", cfg.h.get("access-control-allow-origin") === ORIGIN && /Origin/.test(cfg.h.get("vary") || "") && cfg.h.get("cache-control") === "no-store");
  const pre = await fetch(A + "/license/v1/store/orders", { method: "OPTIONS", headers: { origin: "https://www.haunted.ong", "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
  record("CORS: preflight from https://www.haunted.ong -> 204 with methods/headers", pre.status === 204 && pre.headers.get("access-control-allow-origin") === "https://www.haunted.ong" && /POST/.test(pre.headers.get("access-control-allow-methods") || "") && /content-type/i.test(pre.headers.get("access-control-allow-headers") || ""), `${pre.status}`);
  const evil = await a("POST", "/store/orders", { origin: "https://evil.example", body: { plan: "30d", chain: "solana", asset: "usdc" } });
  record("CORS: other origin is refused (403, no ACAO, no order)", evil.status === 403 && !evil.h.get("access-control-allow-origin"), `${evil.status}`);
  const evilPre = await fetch(A + "/license/v1/store/orders", { method: "OPTIONS", headers: { origin: "http://haunted.ong" } });
  record("CORS: preflight from http:// (not https) origin refused", evilPre.status === 403 && !evilPre.headers.get("access-control-allow-origin"), `${evilPre.status}`);
  const actCors = await a("POST", "/activate", { body: { key: "CC-AAAAA-AAAAA-AAAAA-AAAAA", device_fp: "0".repeat(64) } });
  const actPre = await fetch(A + "/license/v1/activate", { method: "OPTIONS", headers: { origin: ORIGIN } });
  record("CORS: /activate still has no Access-Control-Allow-Origin (even with Origin: haunted.ong)", !actCors.h.get("access-control-allow-origin") && !actPre.headers.get("access-control-allow-origin"), `${actCors.status}/${actPre.status}`);

  // ---------------- rate limits ----------------
  let lim = [];
  for (let i = 0; i < 11; i++) lim.push((await a("POST", "/store/orders", { headers: { "CF-Connecting-IP": "203.0.113.200" }, body: { plan: "nope" } })).status);
  record("rate limit: order creation is limited per IP (10/min; 11th -> 429)", lim.slice(0, 10).every((x) => x === 400) && lim[10] === 429, lim.join(","));
  lim = [];
  for (let i = 0; i < 21; i++) lim.push((await a("GET", "/store/orders/ord_0000000000000000?claim=x", { headers: { "CF-Connecting-IP": "203.0.113.201" } })).status);
  record("rate limit: polls are limited per IP (20/min; 21st -> 429)", lim.slice(0, 20).every((x) => x === 404) && lim[20] === 429, lim.slice(18).join(","));

  // ---------------- plan / coin matrix ----------------
  for (const [c, as] of [["bitcoin", "btc"], ["ethereum", "eth"], ["ethereum", "usdc"]]) {
    const r = await order("lifetime", c, as);
    record(`matrix: lifetime + ${c}/${as} rejected by the Worker`, r.status === 400 && r.json?.error?.reason === "lifetime_solana_only", `${r.status} ${r.json?.error?.reason}`);
  }
  const bad = await order("7d", "solana", "usdc");
  record("matrix: unknown plan rejected", bad.status === 400);
  const btc30 = await order("30d", "bitcoin", "btc");
  record("matrix: 30d + bitcoin accepted (two price sources agree)", btc30.status === 201 && btc30.json?.order?.status === "pending" && /^bitcoin:bc1qnhxzzgv7wg8cfkhmuwydgrgzmfycn67cmccfse\?amount=0\.0000\d+&label=haunted\.ong$/.test(btc30.json?.order?.payment_url), btc30.json?.order?.payment_url);
  const life = await order("lifetime", "solana", "usdc");
  record("matrix: lifetime + Solana USDC accepted, $124.99, 15-min lock", life.status === 201 && life.json.order.usd_price === "124.99" && life.json.order.expires_at - life.json.order.created_at === 900);

  // ---------------- unique amounts ----------------
  const usdcOrders = [];
  for (let i = 0; i < 6; i++) usdcOrders.push((await order("30d", "solana", "usdc")).json);
  const amts = usdcOrders.map((o) => o.order.expected_amount);
  record("unique amount: 6 open Solana USDC 30d orders all have different exact amounts in [7.990001, 7.990999]", new Set(amts).size === 6 && amts.every((x) => +x > 7990000 && +x < 7991000), amts.join(","));
  let dupBlocked = false;
  try { await sql(`INSERT INTO orders (id, claim_secret_hash, plan, chain, asset, usd_price_cents, expected_amount, amount_decimals, recipient, status, expires_at, created_at) VALUES ('ord_DUP0000000000000', 'x', '30d', 'solana', 'usdc', 799, '${amts[0]}', 6, 'x', 'pending', 1, 1)`); }
  catch (e) { dupBlocked = /UNIQUE/i.test(e.message); }
  record("unique amount: D1 index refuses a second open order with the same (chain, asset, amount)", dupBlocked);
  const u0 = usdcOrders[0].order;
  record("Solana Pay URL: recipient, amount in USDC units, spl-token = official mint, reference, label, message",
    u0.payment_url === `solana:${OUR_SOL}?amount=${(+u0.expected_amount / 1e6).toString()}&spl-token=${USDC_MINT}&reference=${u0.reference}&label=haunted.ong&message=Crypto%20Client%20key`, u0.payment_url);
  record("claim secret is returned once, 43 chars; DB keeps only a hash", /^[A-Za-z0-9_-]{43}$/.test(usdcOrders[0].claim_secret) &&
    !(await sql(`SELECT claim_secret_hash FROM orders WHERE id='${u0.id}'`))[0].claim_secret_hash.includes(usdcOrders[0].claim_secret));

  // ---------------- safe mode (quotes) ----------------
  const solOk = await order("30d", "solana", "sol");
  const solMid = (150 + 150.3) / 2;
  const expLamports = Math.ceil((7.99 / solMid) * 1e9 / 1000) * 1000;
  record("quote: SOL priced from Coinbase + Kraken mid, rounded, + unique lamport offset", solOk.status === 201 && +solOk.json.order.expected_amount > expLamports - 1000 && +solOk.json.order.expected_amount <= expLamports + 999, `${solOk.json?.order?.expected_amount} ~ ${expLamports}`);
  S.fail.kraken = "error";
  const kErr = await order("30d", "solana", "sol");
  S.fail.kraken = "http";
  const kHttp = await order("30d", "solana", "sol");
  S.fail.kraken = null;
  record("safe mode: Kraken returns a non-empty error array -> no order (503 safe_mode)", kErr.status === 503 && kErr.json?.error?.code === "safe_mode" && kErr.json?.error?.reason === "source_failed", `${kErr.status} ${kErr.json?.error?.reason}`);
  record("safe mode: Kraken HTTP failure -> no order; no single-source fallback", kHttp.status === 503 && kHttp.json?.error?.code === "safe_mode");
  S.fail.coinbase = true;
  const cbDown = await order("30d", "solana", "sol");
  S.fail.coinbase = false;
  record("safe mode: Coinbase down -> no SOL order", cbDown.status === 503 && cbDown.json?.error?.code === "safe_mode");
  S.prices.kraken.SOLUSD = "153.10"; // 2.07% above Coinbase
  const dis = await order("30d", "solana", "sol");
  S.prices.kraken.SOLUSD = "152.90"; // 1.93%
  const near = await order("30d", "solana", "sol");
  S.prices.kraken.SOLUSD = "150.30";
  record("safe mode: SOL sources >2% apart -> refused", dis.status === 503 && dis.json?.error?.reason === "disagree", `${dis.status} ${dis.json?.error?.reason}`);
  record("quote: SOL sources 1.9% apart -> accepted", near.status === 201);
  S.prices.mempoolUSD = 97000; // 3% below Coinbase
  const btcDis = await order("90d", "bitcoin", "btc");
  S.prices.mempoolUSD = 100100;
  record("safe mode: BTC Coinbase vs mempool.space >2% apart -> refused", btcDis.status === 503 && btcDis.json?.error?.reason === "disagree");
  const ordersBeforeCount = (await sql("SELECT COUNT(*) AS n FROM orders"))[0].n;
  record("safe mode: refused orders wrote nothing to D1", ordersBeforeCount === 1 + 1 + 6 + 1 + 1, `orders=${ordersBeforeCount}`);
  const usdcNoQuote = S.log.filter((l) => l.host === "api.coinbase.com").length;
  await order("30d", "ethereum", "usdc");
  record("quote: USDC orders don't fetch any price", S.log.filter((l) => l.host === "api.coinbase.com").length === usdcNoQuote);

  // ---------------- Solana USDC: seen at confirmed, paid at finalized ----------------
  const o1 = usdcOrders[1];
  const tx1 = usdcTx({ ref: o1.order.reference, amount: o1.order.expected_amount });
  S.sol.sigs[o1.order.reference] = [{ signature: "SIG1" + rnd58(80), confirmationStatus: "confirmed", err: null }];
  S.sol.txs[S.sol.sigs[o1.order.reference][0].signature] = { confirmed: tx1, finalized: null };
  const p1 = await poll(o1.order.id, o1.claim_secret);
  record("Solana USDC: confirmed tx -> 'seen', no key yet", p1.json?.order?.status === "seen" && p1.json?.key === undefined, p1.json?.order?.status);
  S.sol.sigs[o1.order.reference][0].confirmationStatus = "finalized";
  S.sol.txs[S.sol.sigs[o1.order.reference][0].signature].finalized = tx1;
  await sweep();
  const p1b = await poll(o1.order.id, o1.claim_secret);
  const key1 = p1b.json?.key;
  record("Solana USDC: finalized -> paid (via cron sweep) and the claim reveals a CC- key", p1b.json?.order?.status === "paid" && /^CC-/.test(key1 || "") && p1b.json?.license?.plan === "30d", `${p1b.json?.order?.status}`);
  const exp30 = p1b.json?.license?.expires_at - p1b.json?.order?.paid_at;
  record("plan preset: 30d key expires 30 days after issue", exp30 === 30 * 86400, `${exp30}`);
  const refOnly = S.log.filter((l) => l.host === "mainnet.helius-rpc.com" && l.body?.method === "getSignaturesForAddress");
  record("Solana: payments are found by reference only, never by the (trading) wallet address", refOnly.length > 0 && refOnly.every((l) => l.body.params[0] !== OUR_SOL && l.body.params[0] !== OUR_USDC_ATA));
  const actK = await a("POST", "/activate", { body: { key: key1, device_fp: "a".repeat(64) } });
  record("store-issued key activates (max_devices 1)", actK.status === 200 && actK.json?.license?.max_devices === 1 && actK.json?.license?.plan === "30d");

  // first payment: ATA created in the same tx (no pre balance)
  const o2 = usdcOrders[2];
  const sig2 = "SIG2" + rnd58(80);
  S.sol.sigs[o2.order.reference] = [{ signature: sig2, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sig2] = { finalized: usdcTx({ ref: o2.order.reference, amount: o2.order.expected_amount, preAta: null }) };
  const p2 = await check(o2.order.id, o2.claim_secret);
  record("Solana USDC first payment: ATA created in the same tx (no pre-balance = 0) -> paid", p2.json?.order?.status === "paid" && /^CC-/.test(p2.json?.key || ""), p2.json?.order?.status);

  // USDC order "paid" only by a SOL balance change -> ignored
  const o3 = usdcOrders[3];
  const sig3 = "SIG3" + rnd58(80);
  S.sol.sigs[o3.order.reference] = [{ signature: sig3, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sig3] = { finalized: solBalanceOnlyTx({ ref: o3.order.reference, amount: o3.order.expected_amount }) };
  // fake USDC (same name, other mint) on a second signature
  const sig3b = "SIG3b" + rnd58(80);
  S.sol.sigs[o3.order.reference].push({ signature: sig3b, confirmationStatus: "finalized", err: null });
  S.sol.txs[sig3b] = { finalized: usdcTx({ ref: o3.order.reference, amount: o3.order.expected_amount, mint: "FakeUSDC" + rnd58(36) }) };
  const p3 = await check(o3.order.id, o3.claim_secret);
  record("Solana USDC: SOL-balance change and a look-alike mint are both ignored", p3.json?.order?.status === "pending", p3.json?.order?.status);

  // failed tx (meta.err) does not issue
  const o4 = usdcOrders[4];
  const sig4 = "SIG4" + rnd58(80);
  S.sol.sigs[o4.order.reference] = [{ signature: sig4, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sig4] = { finalized: usdcTx({ ref: o4.order.reference, amount: o4.order.expected_amount, err: { InstructionError: [0, "Custom"] } }) };
  const p4 = await check(o4.order.id, o4.claim_secret);
  // underpay on another
  const o5 = usdcOrders[5];
  const sig5 = "SIG5" + rnd58(80);
  S.sol.sigs[o5.order.reference] = [{ signature: sig5, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sig5] = { finalized: usdcTx({ ref: o5.order.reference, amount: String(BigInt(o5.order.expected_amount) - 1n) }) };
  const p5 = await check(o5.order.id, o5.claim_secret);
  record("Solana: failed tx (meta.err) does not issue", p4.json?.order?.status === "pending");
  record("underpay (1 micro-USDC short) stays unissued", p5.json?.order?.status === "pending" && p5.json?.key === undefined);

  // SOL native exact
  const so = solOk.json;
  const sigS = "SIGS" + rnd58(80);
  S.sol.sigs[so.order.reference] = [{ signature: sigS, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sigS] = { finalized: solTx({ ref: so.order.reference, lamports: Number(so.order.expected_amount) }) };
  const pS = await check(so.order.id, so.claim_secret);
  record("Solana SOL: exact lamports to the wallet, finalized -> paid", pS.json?.order?.status === "paid" && /^CC-/.test(pS.json?.key || ""));

  // ---------------- Bitcoin ----------------
  const bo = btc30.json;
  const sats = Number(bo.order.expected_amount);
  const changeTx = { txid: hex(32), vin: [{ prevout: { scriptpubkey_address: OUR_BTC, value: 5000000 } }], vout: [{ scriptpubkey_address: "bc1qsomeoneelse000000000000000000000000000", value: 100000 }, { scriptpubkey_address: OUR_BTC, value: sats }], status: { confirmed: true, block_height: S.btc.tip - 5, block_time: now() } };
  S.btc.txs = [changeTx];
  await sweep();
  let pb = await poll(bo.order.id, bo.claim_secret);
  record("BTC: change output back to our address (tx also spends from it) is ignored, even at 6 confs", pb.json?.order?.status === "pending", pb.json?.order?.status);
  const payTxid = hex(32);
  const payTx = { txid: payTxid, vin: [{ prevout: { scriptpubkey_address: "bc1qbuyer0000000000000000000000000000000", value: 900000 } }], vout: [{ scriptpubkey_address: "bc1qbuyer0000000000000000000000000000000", value: 1000 }, { scriptpubkey_address: OUR_BTC, value: sats }], status: { confirmed: false } };
  S.btc.txs = [payTx, changeTx];
  await sweep();
  pb = await poll(bo.order.id, bo.claim_secret);
  record("BTC: mempool (unconfirmed) payment -> 'seen', never paid", pb.json?.order?.status === "seen" && !pb.json?.key, pb.json?.order?.status);
  payTx.status = { confirmed: true, block_height: S.btc.tip, block_time: now() };
  await sweep();
  pb = await poll(bo.order.id, bo.claim_secret);
  record("BTC: 1 confirmation -> still not paid", pb.json?.order?.status === "seen");
  S.btc.tip += 1;
  await sweep();
  pb = await poll(bo.order.id, bo.claim_secret);
  const bRow = (await sql(`SELECT chain_txid, chain_index, amount_paid FROM orders WHERE id='${bo.order.id}'`))[0];
  record("BTC: 2 confirmations -> paid; txid + vout index recorded", pb.json?.order?.status === "paid" && bRow.chain_txid === payTxid && bRow.chain_index === 1 && bRow.amount_paid === String(sats), JSON.stringify(bRow));
  const bo2 = (await order("365d", "bitcoin", "btc")).json;
  S.btc.txs.unshift({ txid: hex(32), vin: [{ prevout: { scriptpubkey_address: "bc1qx", value: 1 } }], vout: [{ scriptpubkey_address: OUR_BTC, value: Number(bo2.order.expected_amount) - 1 }], status: { confirmed: true, block_height: S.btc.tip - 3, block_time: now() } });
  await sweep();
  record("BTC: 1 sat short with 4 confs -> not paid (exact sats required)", (await poll(bo2.order.id, bo2.claim_secret)).json?.order?.status === "pending");

  // ---------------- Ethereum ----------------
  const eo = (await order("30d", "ethereum", "eth")).json;
  record("ETH: order created with Coinbase + Etherscan quote; EIP-681 URL on chain 1", /^ethereum:0xd7ee3e4725967b353ba60334cf14679ed2f7df5e@1\?value=\d+$/.test(eo?.order?.payment_url || "") && eo.order.network === "Ethereum mainnet only", eo?.order?.payment_url);
  const wei = eo.order.expected_amount;
  const ethTx = (o) => ({ blockNumber: String(S.eth.finalized + 3), timeStamp: String(now()), hash: "0x" + hex(32), from: "0x" + hex(20), to: OUR_ETH, value: wei, isError: "0", txreceipt_status: "1", ...o });
  S.eth.chains[8453].txlist = [ethTx({})]; // right amount, wrong chain (Base)
  S.eth.chains[1].txlist = [ethTx({ from: OUR_ETH })]; // Ledger's own transfer to itself
  await sweep();
  let pe = await poll(eo.order.id, eo.claim_secret);
  const chainIds = new Set(S.log.filter((l) => l.host === "api.etherscan.io").map((l) => l.query.chainid));
  record("ETH: payment on another chain and from == our address are both ignored; only chainid=1 is queried", pe.json?.order?.status === "pending" && chainIds.size === 1 && chainIds.has("1"), `${pe.json?.order?.status} chains=${[...chainIds]}`);
  const goodEth = ethTx({});
  S.eth.chains[1].txlist.push(goodEth);
  await sweep();
  pe = await poll(eo.order.id, eo.claim_secret);
  record("ETH: exact native payment above the finalized block -> 'seen', waits", pe.json?.order?.status === "seen");
  S.eth.finalized += 5;
  await sweep();
  pe = await poll(eo.order.id, eo.claim_secret);
  const eRow = (await sql(`SELECT chain_txid, chain_index FROM orders WHERE id='${eo.order.id}'`))[0];
  record("ETH: once finalized -> paid (native index -1)", pe.json?.order?.status === "paid" && eRow.chain_txid === goodEth.hash && eRow.chain_index === -1, JSON.stringify(eRow));
  const eo2 = (await order("90d", "ethereum", "eth")).json;
  S.eth.chains[1].txlistinternal = [{ blockNumber: String(S.eth.finalized - 1), timeStamp: String(now()), hash: "0x" + hex(32), from: "0x" + hex(20), to: OUR_ETH, value: eo2.order.expected_amount, isError: "0", traceId: "0" }];
  await sweep();
  record("ETH: payment from a contract wallet (internal tx) -> paid", (await poll(eo2.order.id, eo2.claim_secret)).json?.order?.status === "paid");

  const ue = (await order("90d", "ethereum", "usdc")).json;
  record("ETH USDC: EIP-681 token transfer on Circle's contract", ue.order.payment_url === `ethereum:${USDC_ETH}@1/transfer?address=${OUR_ETH}&uint256=${ue.order.expected_amount}`, ue.order.payment_url);
  const tokTx = (o) => ({ blockNumber: String(S.eth.finalized - 2), timeStamp: String(now()), hash: "0x" + hex(32), from: "0x" + hex(20), to: OUR_ETH, value: ue.order.expected_amount, contractAddress: USDC_ETH, tokenSymbol: "USDC", tokenName: "USDC", tokenDecimal: "6", logIndex: "7", ...o });
  S.eth.chains[1].tokentx = [tokTx({ contractAddress: "0x" + hex(20) })];
  await sweep();
  record("ETH USDC: token named 'USDC' on the wrong contract is ignored", (await poll(ue.order.id, ue.claim_secret)).json?.order?.status === "pending");
  const goodTok = tokTx({});
  S.eth.chains[1].tokentx.push(goodTok);
  await sweep();
  const pue = await poll(ue.order.id, ue.claim_secret);
  record("ETH USDC: Circle contract, exact amount, finalized -> paid", pue.json?.order?.status === "paid");

  // ---------------- one payment, one order ----------------
  const victim = (await order("30d", "ethereum", "usdc")).json;
  const conflict = await a("POST", `/admin/orders/${victim.order.id}/fulfill`, { token: admin, origin: null, body: { txid: goodTok.hash, index: 7, note: "test reuse" } });
  record("one payment, one order: manual fulfill with an already-used (chain, txid, index) -> 409, nothing issued", conflict.status === 409 && conflict.json?.error?.code === "payment_conflict" &&
    (await sql(`SELECT status, license_id FROM orders WHERE id='${victim.order.id}'`))[0].status === "pending");
  const solReuse = await a("POST", `/admin/orders/${usdcOrders[3].order.id}/fulfill`, { token: admin, origin: null, body: { txid: S.sol.sigs[o1.order.reference][0].signature, index: 0 } });
  record("one payment, one order: a Solana signature that paid one order can't pay another", solReuse.status === 409);
  let dupTx = false;
  try { await sql(`UPDATE orders SET chain_txid='${payTxid}', chain_index=1 WHERE id='${bo2.order.id}'`); } catch (e) { dupTx = /UNIQUE/i.test(e.message); }
  record("one payment, one order: enforced by the D1 unique index, not only app code", dupTx);
  let dupRef = false;
  try { await sql(`UPDATE orders SET reference='${o1.order.reference}' WHERE id='${o4.order.id}'`); } catch (e) { dupRef = /UNIQUE/i.test(e.message); }
  record("Solana reference is unique per order (D1 index)", dupRef);

  // ---------------- late payment / expiry ----------------
  const late = (await order("30d", "solana", "usdc")).json;
  const t0 = now();
  await sql(`UPDATE orders SET created_at=${t0 - 2000}, expires_at=${t0 - 1100} WHERE id='${late.order.id}'`);
  const sigL = "SIGL" + rnd58(80);
  S.sol.sigs[late.order.reference] = [{ signature: sigL, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sigL] = { finalized: usdcTx({ ref: late.order.reference, amount: late.order.expected_amount, blockTime: t0 }) };
  const pl = await poll(late.order.id, late.claim_secret);
  record("late payment (after the 15-min window) is not auto-issued; order expires", pl.json?.order?.status === "expired" && pl.json?.key === undefined, pl.json?.order?.status);
  const late2 = (await order("30d", "solana", "usdc")).json;
  await sql(`UPDATE orders SET created_at=${t0 - 2000}, expires_at=${t0 - 1100} WHERE id='${late2.order.id}'`);
  await sweep();
  const sigL2 = "SIGL2" + rnd58(80);
  S.sol.sigs[late2.order.reference] = [{ signature: sigL2, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sigL2] = { finalized: usdcTx({ ref: late2.order.reference, amount: late2.order.expected_amount, blockTime: t0 - 1500 }) };
  await sweep();
  const pl2 = await poll(late2.order.id, late2.claim_secret);
  record("expired, never-seen order stays expired even if a payment shows up later", pl2.json?.order?.status === "expired");
  const man = await a("POST", `/admin/orders/${late2.order.id}/fulfill`, { token: admin, origin: null, body: { txid: sigL2, index: 0, amount_paid: late2.order.expected_amount, note: "late pay, checked by hand" } });
  const pman = await poll(late2.order.id, late2.claim_secret);
  record("admin manual fulfill of the late order -> 'manual', key to admin and to the claim", man.status === 200 && man.json?.order?.status === "manual" && /^CC-/.test(man.json?.key || "") && pman.json?.key === man.json.key);
  const oldTx = (await order("30d", "solana", "usdc")).json;
  const sigOld = "SIGO" + rnd58(80);
  S.sol.sigs[oldTx.order.reference] = [{ signature: sigOld, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sigOld] = { finalized: usdcTx({ ref: oldTx.order.reference, amount: oldTx.order.expected_amount, blockTime: now() - 3600 }) };
  record("a tx older than the order (time < created_at) doesn't count", (await poll(oldTx.order.id, oldTx.claim_secret)).json?.order?.status === "pending");

  // ---------------- claim / reveal window ----------------
  const wrong = await poll(o1.order.id, usdcOrders[0].claim_secret);
  const cross = await poll(o2.order.id, o1.claim_secret);
  record("poll: wrong claim -> 404; another order's claim never opens this order", wrong.status === 404 && cross.status === 404 && !/CC-/.test(wrong.text + cross.text));
  await sql(`UPDATE orders SET paid_at=${now() - 8 * 86400} WHERE id='${o1.order.id}'`);
  const p1old = await poll(o1.order.id, o1.claim_secret);
  const keyGone = (await sql(`SELECT issued_key FROM orders WHERE id='${o1.order.id}'`))[0].issued_key;
  record("claim URL: after 7 days the key is no longer revealed and the plaintext is deleted", p1old.json?.order?.status === "paid" && p1old.json?.key === null && keyGone === null && p1old.json?.license?.key_hint);
  await sql(`UPDATE orders SET paid_at=${now() - 8 * 86400} WHERE id='${o2.order.id}'`);
  await sweep();
  record("cron: drops plaintext keys older than 7 days", (await sql(`SELECT issued_key FROM orders WHERE id='${o2.order.id}'`))[0].issued_key === null);
  const ack = await a("POST", `/store/orders/${so.order.id}/ack`, { body: { claim: so.claim_secret } });
  const pAck = await poll(so.order.id, so.claim_secret);
  record("'I've copied it' (ack) drops the plaintext key immediately", ack.status === 200 && pAck.json?.key === null && pAck.json?.order?.status === "paid");
  const audits = await sql("SELECT detail FROM audit WHERE action IN ('issue','renew','key_reveal')");
  record("audit has issue + key_reveal rows without any plaintext key", audits.length > 0 && audits.every((r) => !/CC-/.test(r.detail || "")));

  // ---------------- dashboard + renew ----------------
  const dash = await a("POST", "/store/license", { body: { order_id: ue.order.id, claim: ue.claim_secret } });
  record("dashboard by claim: plan, hint, expiry, key, renew token", dash.status === 200 && dash.json?.license?.plan === "90d" && /^CC-/.test(dash.json?.key || "") && /^rt1\./.test(dash.json?.renew_token || ""));
  const dashKey = await a("POST", "/store/license", { body: { key: dash.json.key } });
  record("dashboard by pasted key: license shown, no plaintext key echoed", dashKey.status === 200 && dashKey.json?.license?.id === dash.json.license.id && dashKey.json?.key === null);
  const licBefore = dash.json.license.expires_at;
  const rn = (await order("30d", "solana", "usdc", { renew_license_id: dash.json.license.id, renew_token: dash.json.renew_token })).json;
  const sigR = "SIGR" + rnd58(80);
  S.sol.sigs[rn.order.reference] = [{ signature: sigR, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sigR] = { finalized: usdcTx({ ref: rn.order.reference, amount: rn.order.expected_amount }) };
  const pr = await poll(rn.order.id, rn.claim_secret);
  record("renew: adds 30 days onto the time left (90d key -> +30d), same license, no new key", pr.json?.order?.status === "paid" && pr.json?.license?.id === dash.json.license.id &&
    pr.json?.license?.expires_at === licBefore + 30 * 86400 && pr.json?.license?.plan === "30d" && pr.json?.key === null, `${pr.json?.license?.expires_at - licBefore}`);
  // renew an already-expired key: starts from now
  await sql(`UPDATE licenses SET expires_at=${now() - 500} WHERE id='${dash.json.license.id}'`);
  const dash2 = await a("POST", "/store/license", { body: { order_id: ue.order.id, claim: ue.claim_secret } });
  const rn2 = (await order("90d", "solana", "usdc", { renew_license_id: dash.json.license.id, renew_token: dash2.json.renew_token })).json;
  const sigR2 = "SIGR2" + rnd58(80);
  S.sol.sigs[rn2.order.reference] = [{ signature: sigR2, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sigR2] = { finalized: usdcTx({ ref: rn2.order.reference, amount: rn2.order.expected_amount }) };
  const pr2 = await poll(rn2.order.id, rn2.claim_secret);
  const fromNow = pr2.json?.license?.expires_at - pr2.json?.order?.paid_at;
  record("renew of an expired key: 90 days from now (max(now, expiry))", pr2.json?.order?.status === "paid" && fromNow === 90 * 86400, `${fromNow}`);
  const badRt = await order("30d", "solana", "usdc", { renew_license_id: dash.json.license.id, renew_token: dash2.json.renew_token.slice(0, -2) + "AA" });
  record("renew: forged renew token -> 401", badRt.status === 401);
  const lifeRenew = await order("lifetime", "solana", "usdc", { renew_license_id: dash.json.license.id, renew_token: dash2.json.renew_token });
  record("renew: Lifetime can't be bought as a renew", lifeRenew.status === 400 && lifeRenew.json?.error?.reason === "lifetime_no_renew");
  const sigLf = "SIGLF" + rnd58(80);
  S.sol.sigs[life.json.order.reference] = [{ signature: sigLf, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sigLf] = { finalized: usdcTx({ ref: life.json.order.reference, amount: life.json.order.expected_amount }) };
  const plf = await check(life.json.order.id, life.json.claim_secret);
  const dlf = await a("POST", "/store/license", { body: { order_id: life.json.order.id, claim: life.json.claim_secret } });
  record("lifetime purchase: expires_at null, dashboard says Lifetime and offers no renew", plf.json?.order?.status === "paid" && plf.json?.license?.expires_at === null && dlf.json?.license?.lifetime === true && !dlf.json?.renew_token);
  const lfAct = await a("POST", "/activate", { body: { key: plf.json.key, device_fp: "b".repeat(64) } });
  const lfp = JSON.parse(Buffer.from(lfAct.json.token.split(".")[0], "base64url"));
  record("lifetime token: lexp null, exp/grace = iat+6h/24h (uncapped)", lfp.lexp === null && lfp.exp === lfp.iat + 21600 && lfp.grace === lfp.iat + 86400);

  // ---------------- token cap + admin plan presets ----------------
  const short = await a("POST", "/admin/keys", { token: admin, origin: null, body: { plan: "30d", expires_at: now() + 7200, note: "cap test" } });
  const sa = await a("POST", "/activate", { body: { key: short.json.keys[0].key, device_fp: "c".repeat(64) } });
  const sp = JSON.parse(Buffer.from(sa.json.token.split(".")[0], "base64url"));
  record("token cap: key expiring in 2h -> exp == grace == lexp", sp.exp === sp.lexp && sp.grace === sp.lexp && sp.lexp > sp.iat, `iat=${sp.iat} exp=${sp.exp} grace=${sp.grace} lexp=${sp.lexp}`);
  const mid = await a("POST", "/admin/keys", { token: admin, origin: null, body: { plan: "30d", expires_at: now() + 10 * 3600 } });
  const ma = await a("POST", "/activate", { body: { key: mid.json.keys[0].key, device_fp: "d".repeat(64) } });
  const mp = JSON.parse(Buffer.from(ma.json.token.split(".")[0], "base64url"));
  record("token cap: key expiring in 10h -> exp = iat+6h, grace = lexp", mp.exp === mp.iat + 21600 && mp.grace === mp.lexp);
  const mv = await a("POST", "/validate", { body: { token: ma.json.token, device_fp: "d".repeat(64) } });
  const mvp = JSON.parse(Buffer.from(mv.json.token.split(".")[0], "base64url"));
  record("token cap: /validate refresh is capped too", mv.status === 200 && mvp.grace === mvp.lexp);
  const pre90 = await a("POST", "/admin/keys", { token: admin, origin: null, body: { plan: "90d" } });
  const g90 = await a("GET", `/admin/licenses/${pre90.json.keys[0].id}`, { token: admin, origin: null });
  const preLife = await a("POST", "/admin/keys", { token: admin, origin: null, body: { plan: "lifetime" } });
  const gLife = await a("GET", `/admin/licenses/${preLife.json.keys[0].id}`, { token: admin, origin: null });
  const preStd = await a("POST", "/admin/keys", { token: admin, origin: null, body: { plan: "standard" } });
  const gStd = await a("GET", `/admin/licenses/${preStd.json.keys[0].id}`, { token: admin, origin: null });
  const d90 = g90.json.license.expires_at - now();
  record("admin issue: plan 90d with no expires_at -> 90 days; lifetime -> null; standard -> null (unchanged)", Math.abs(d90 - 90 * 86400) < 30 && gLife.json.license.expires_at === null && gStd.json.license.expires_at === null, `${d90}`);
  await sql(`UPDATE licenses SET expires_at=${now() - 10} WHERE id='${short.json.keys[0].id}'`);
  const sv = await a("POST", "/validate", { body: { token: sa.json.token, device_fp: "c".repeat(64) } });
  record("expired key: /validate returns key_expired (no new token signed)", sv.status === 403 && sv.json?.error?.code === "key_expired" && !sv.json?.token);

  // ---------------- admin list + export ----------------
  const noAuth = await a("GET", "/admin/orders/export", { origin: null });
  record("admin export needs ADMIN_TOKEN", noAuth.status === 401);
  // a test order (tools/store-test-order.sh): fulfilled by hand with txid "TESTORDER<ms>"; never a sale
  const tst = (await order("30d", "bitcoin", "btc")).json;
  const tstF = await a("POST", `/admin/orders/${tst.order.id}/fulfill`, { token: admin, origin: null, body: { txid: "TESTORDER" + Date.now(), index: 0, note: "TEST ORDER, not a sale (tools/store-test-order.sh)" } });
  const tstEx = await a("GET", "/admin/orders/export", { token: admin, origin: null });
  const tstCsv = await (await fetch(A + "/license/v1/admin/orders/export?format=csv", { headers: { authorization: "Bearer " + admin } })).text();
  const tstList = await a("GET", `/admin/orders/${tst.order.id}`, { token: admin, origin: null });
  record("admin export: a TESTORDER test fulfillment is left out (JSON and CSV), but the admin order view still has it",
    tstF.status === 200 && tstF.json?.order?.status === "manual" && !(tstEx.json?.items || []).some((i) => i.order_id === tst.order.id) &&
    !tstCsv.includes(tst.order.id) && tstList.json?.order?.status === "manual", `${tstF.status} ${tstF.json?.error?.code || ""}`);
  const ex = await a("GET", "/admin/orders/export", { token: admin, origin: null });
  const items = ex.json?.items || [];
  const sample = items.find((i) => i.order_id === bo.order.id);
  record("admin export: confirmed orders only, with chain, txid, index, amount, USD price, plan, paid_at, license, hint",
    ex.status === 200 && items.length >= 10 && items.every((i) => i.status === "paid" || i.status === "manual") &&
    sample && sample.chain === "bitcoin" && sample.txid === payTxid && sample.index === 1 && sample.amount_paid === String(sats) && sample.usd_price === "7.99" && sample.plan === "30d" && sample.key_hint && sample.paid_at,
    `items=${items.length}`);
  record("admin export: the manual order is included and marked manual", items.some((i) => i.order_id === late2.order.id && i.status === "manual"));
  const csv = await fetch(A + "/license/v1/admin/orders/export?format=csv", { headers: { authorization: "Bearer " + admin } });
  const csvText = await csv.text();
  record("admin export: CSV option", csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type") || "") && csvText.startsWith("order_id,status,chain,asset,txid,index,amount_paid") && csvText.includes(payTxid));
  const rng = await a("GET", `/admin/orders/export?from=${now() + 3600}`, { token: admin, origin: null });
  record("admin export: from/to filter", rng.status === 200 && rng.json.items.length === 0);
  const li = await a("GET", "/admin/orders?status=pending&limit=3", { token: admin, origin: null });
  const li2 = await a("GET", `/admin/orders?status=pending&limit=3&cursor=${li.json?.next_cursor}`, { token: admin, origin: null });
  record("admin list: status filter + cursor paging, no claim hashes or keys", li.status === 200 && li.json.items.length === 3 && li.json.items.every((i) => i.status === "pending") && li2.json.items.length > 0 &&
    !JSON.stringify(li.json).includes("claim_secret_hash") && !/CC-/.test(JSON.stringify(li.json)));
  record("store pages API never sends cookies: no Set-Cookie on store routes", !cfg.h.get("set-cookie") && !dash.h.get("set-cookie"));

  // ---------------- with keys (A): every coin is on ----------------
  record("with keys: config says every coin auto-confirms; default coin Solana USDC", cfg.json.coins.every((c) => c.auto_confirm === true) && cfg.json.default_coin?.chain === "solana");
  const onA = [];
  for (const [ch, as] of [["solana", "usdc"], ["solana", "sol"], ["ethereum", "usdc"], ["ethereum", "eth"], ["bitcoin", "btc"]]) onA.push((await order("30d", ch, as)).status);
  record("with keys: 30d orders on all 5 coins are created (201)", onA.every((x) => x === 201), onA.join(","));

  // ---------------- B: no keys -> Solana/Ethereum refused, Bitcoin on ----------------
  const cfgB = await b("GET", "/store/config");
  const ac = Object.fromEntries(cfgB.json.coins.map((c) => [c.chain + ":" + c.asset, c.auto_confirm]));
  record("no keys: config says Solana + Ethereum auto-confirm off, Bitcoin on", ac["solana:usdc"] === false && ac["solana:sol"] === false && ac["ethereum:usdc"] === false && ac["ethereum:eth"] === false && ac["bitcoin:btc"] === true, JSON.stringify(ac));
  record("no keys: config default coin falls back to Bitcoin", cfgB.json.default_coin?.chain === "bitcoin" && cfgB.json.default_coin?.asset === "btc", JSON.stringify(cfgB.json.default_coin));
  const ordersBefore = (await sql("SELECT COUNT(*) AS n FROM orders", persistB))[0].n;
  const quotesBefore = S.log.filter((l) => /coinbase|kraken|mempool|etherscan/.test(l.host)).length;
  for (const [ch, as] of [["solana", "usdc"], ["solana", "sol"], ["ethereum", "usdc"], ["ethereum", "eth"]]) {
    const r = await order("30d", ch, as, {}, b);
    record(`no keys: 30d + ${ch}/${as} refused -> 409 coin_not_available, no address/QR`, r.status === 409 && r.json?.error?.code === "coin_not_available" && r.json?.error?.reason === "auto_confirm_off" &&
      !r.json?.order && !/payment_url|recipient|4nfyHLED|0x[0-9a-f]{40}/i.test(r.text || JSON.stringify(r.json)), `${r.status} ${r.json?.error?.code} ${r.json?.error?.message}`);
  }
  const lifeB = await order("lifetime", "solana", "usdc", {}, b);
  record("no keys: lifetime + Solana refused (coin_not_available)", lifeB.status === 409 && lifeB.json?.error?.code === "coin_not_available");
  const lifeBtcB = await order("lifetime", "bitcoin", "btc", {}, b);
  record("no keys: lifetime + Bitcoin still refused as lifetime_solana_only", lifeBtcB.status === 400 && lifeBtcB.json?.error?.reason === "lifetime_solana_only");
  record("no keys: refused orders write no row and fetch no price", (await sql("SELECT COUNT(*) AS n FROM orders", persistB))[0].n === ordersBefore &&
    S.log.filter((l) => /coinbase|kraken|mempool|etherscan/.test(l.host)).length === quotesBefore);
  const btcB = await order("30d", "bitcoin", "btc", {}, b);
  record("no keys: 30d + Bitcoin order still created (201, auto_confirm true)", btcB.status === 201 && btcB.json?.order?.auto_confirm === true && /^bitcoin:/.test(btcB.json?.order?.payment_url));

  // An order made before this fix (Solana, keys off) is never auto-issued, but admin fulfill still works.
  const legacyRef = rnd58();
  await sql(`INSERT INTO orders (id, claim_secret_hash, plan, chain, asset, usd_price_cents, expected_amount, amount_decimals, recipient, reference, status, expires_at, created_at)
             VALUES ('ord_PREFXB0000000000', 'x', '30d', 'solana', 'usdc', 799, '7990777', 6, '${OUR_SOL}', '${legacyRef}', 'pending', ${now() + 900}, ${now()})`, persistB);
  const sigB = "SIGB" + rnd58(80);
  S.sol.sigs[legacyRef] = [{ signature: sigB, confirmationStatus: "finalized", err: null }];
  S.sol.txs[sigB] = { finalized: usdcTx({ ref: legacyRef, amount: "7990777" }) };
  const rpcBefore = S.log.filter((l) => l.host === "mainnet.helius-rpc.com").length;
  await sweep(B);
  const legacy = await b("GET", "/admin/orders/ord_PREFXB0000000000", { token: admin, origin: null });
  record("no HELIUS key: an older Solana order is never auto-issued (no RPC call)", legacy.json?.order?.status === "pending" && S.log.filter((l) => l.host === "mainnet.helius-rpc.com").length === rpcBefore, legacy.json?.order?.status);
  const manB = await b("POST", "/admin/orders/ord_PREFXB0000000000/fulfill", { token: admin, origin: null, body: { txid: sigB, index: 0, amount_paid: "7990777", note: "checked by hand" } });
  record("no keys: admin fulfill still works -> manual + key", manB.status === 200 && manB.json?.order?.status === "manual" && /^CC-/.test(manB.json?.key || ""), `${manB.status} ${manB.json?.error?.code}`);

  // ---------------- C: only HELIUS_API_KEY -> Solana switches on by itself, Ethereum still off ----------------
  const cfgC = await c3("GET", "/store/config");
  const acC = Object.fromEntries(cfgC.json.coins.map((c) => [c.chain + ":" + c.asset, c.auto_confirm]));
  record("HELIUS only: Solana on, Ethereum off; default coin back to Solana USDC", acC["solana:usdc"] === true && acC["solana:sol"] === true && acC["ethereum:usdc"] === false && acC["ethereum:eth"] === false &&
    cfgC.json.default_coin?.chain === "solana" && cfgC.json.default_coin?.asset === "usdc", JSON.stringify(acC));
  const cSol = await order("30d", "solana", "usdc", {}, c3), cLife = await order("lifetime", "solana", "sol", {}, c3);
  record("HELIUS only: Solana USDC 30d + SOL lifetime orders created", cSol.status === 201 && cLife.status === 201, `${cSol.status}/${cLife.status}`);
  const cEth = await order("30d", "ethereum", "usdc", {}, c3), cEth2 = await order("30d", "ethereum", "eth", {}, c3);
  record("HELIUS only: Ethereum USDC/ETH still refused (coin_not_available)", cEth.status === 409 && cEth.json?.error?.code === "coin_not_available" && cEth2.status === 409, `${cEth.status}/${cEth2.status}`);

  // no secrets / test keys in responses or logs we control
  const leak = JSON.stringify(S.log.filter((l) => l.host !== "api.etherscan.io" && l.host !== "mainnet.helius-rpc.com"));
  record("upstream calls other than Etherscan/Helius carry no API keys", !leak.includes("test-helius") && !leak.includes("test-etherscan"));

  console.log(`\n---- store summary ----\n${passed}/${passed + failed} passed, ${failed} failed.`);
  await mock.close();
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error("store e2e failed to run:", e.stack || e.message); process.exitCode = 1; })
  .finally(() => {
    for (const p of procs) { try { process.kill(-p.pid, "SIGTERM"); } catch {} }
    setTimeout(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }); process.exit(process.exitCode || 0); }, 1500);
  });
