/**
 * Crypto Client store: crypto-only key sales for haunted.ong/client/buy.
 * Implements client-store-plan.md §2–§9. No npm dependencies.
 *
 * Routes (all on api.haunted.ong, under /license/v1):
 *   GET  /store/config                    plans, coins, which coins auto-confirm
 *   POST /store/orders                    create an order (unique exact amount, 15 min)
 *   GET  /store/orders/{id}?claim=        poll (confirms on-chain, reveals the key once paid)
 *   POST /store/orders/{id}/ack           "I've copied it": drop the plaintext key now
 *   POST /store/license                   dashboard: look up by claim or by CC- key
 *   GET  /admin/orders                    list (ADMIN_TOKEN)
 *   GET  /admin/orders/export             confirmed orders for Ledger (JSON or CSV)
 *   POST /admin/orders/{id}/fulfill       manual path (underpay, late, wrong network)
 * Store routes (only) send CORS for https://haunted.ong and https://www.haunted.ong.
 *
 * Receiving addresses are Ledger's PUBLIC addresses. No private keys, xpubs or
 * seeds ever live here. Payment matching never scans the Solana wallet's own
 * history (it is also a trading wallet): Solana uses the per-order reference.
 */
import {
  jsonOk, jsonError, clientIp, readJsonBody, audit, rejectIfLimited,
  sha256Hex, bytesEqual, newId, nowSec, b64urlEncode, b64urlDecode, parsePepper,
  getLicenseById, getLicenseByHash, generateKeyString, normalizeKey, keyHashHex,
} from "./index.js";
// Zach's answers (support contact, sales addresses) live only in store-settings.js.
import { SUPPORT_CONTACT, SALES_ADDRESSES } from "./store-settings.js";

const API_BASE = "/license/v1";
const STORE_BASE = API_BASE + "/store";

// ---------------------------------------------------------------------------
// Settled product rules (plan §2) — constants, not config
// ---------------------------------------------------------------------------

export const PLANS = {
  "30d": { cents: 799, days: 30, label: "30 days" },
  "90d": { cents: 2299, days: 90, label: "90 days" },
  "365d": { cents: 5999, days: 365, label: "365 days" },
  lifetime: { cents: 12499, days: null, label: "Lifetime" },
};

/** Expiry for a plan id issued at `now`: unix seconds, null (lifetime), or undefined (not a store plan). */
export function planExpiry(plan, now) {
  const p = Object.prototype.hasOwnProperty.call(PLANS, plan) ? PLANS[plan] : null;
  if (!p) return undefined;
  return p.days == null ? null : now + p.days * 86400;
}

// Receiving addresses: set in store-settings.js (checked by tests/store-unit.mjs).
// BTC (bech32) and ETH are compared lowercase everywhere.
export const SOL_RECIPIENT = SALES_ADDRESSES.solana.trim();
export const ETH_RECIPIENT = SALES_ADDRESSES.ethereum.trim().toLowerCase();
export const BTC_RECIPIENT = SALES_ADDRESSES.bitcoin.trim().toLowerCase();
export const SUPPORT = SUPPORT_CONTACT.trim();
export const USDC_SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Circle, Solana mainnet
export const USDC_ETH_CONTRACT = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // Circle, Ethereum mainnet
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// unit: smallest unit; round: base amount rounded up to this; offUnit/offMax: unique offset
export const COINS = {
  "solana:usdc": { chain: "solana", asset: "usdc", decimals: 6, quote: null, round: 1n, offUnit: 1n, offMax: 999, recipient: SOL_RECIPIENT, label: "USDC (Solana)", lifetime: true },
  "solana:sol": { chain: "solana", asset: "sol", decimals: 9, quote: "sol", round: 1000n, offUnit: 1n, offMax: 999, recipient: SOL_RECIPIENT, label: "SOL", lifetime: true },
  "bitcoin:btc": { chain: "bitcoin", asset: "btc", decimals: 8, quote: "btc", round: 1n, offUnit: 1n, offMax: 299, recipient: BTC_RECIPIENT, label: "Bitcoin", lifetime: false },
  "ethereum:eth": { chain: "ethereum", asset: "eth", decimals: 18, quote: "eth", round: 10n ** 10n, offUnit: 10n ** 10n, offMax: 999, recipient: ETH_RECIPIENT, label: "ETH (Ethereum mainnet only)", lifetime: false },
  "ethereum:usdc": { chain: "ethereum", asset: "usdc", decimals: 6, quote: null, round: 1n, offUnit: 1n, offMax: 999, recipient: ETH_RECIPIENT, label: "USDC (Ethereum mainnet only)", lifetime: false },
};

const ORDER_TTL = 15 * 60;               // amount locked for 15 minutes
const PAY_SKEW = 5 * 60;                 // tx time may be this much before created_at (clock skew)
const LATE_SKEW = 30;                    // tx time may be this much after expires_at (clock skew)
const EXPIRE_AFTER = 3 * 60;             // sweep expires never-seen orders this long after expires_at (indexer lag)
const SEEN_GIVE_UP = 3 * 24 * 3600;      // a "seen" payment that never confirms (dropped/RBF) -> expired, manual
const REVEAL_SECONDS = 7 * 24 * 3600;    // plaintext key kept for the claim at most 7 days
const CHECK_THROTTLE = 10;               // a poll re-checks the chain at most every 10 s per order
const BTC_CONFIRMATIONS = 2;
const QUOTE_MAX_SPREAD = 0.02;           // >2% disagreement between sources -> safe mode
const QUOTE_CACHE_SECONDS = 30;          // per-isolate quote cache (Kraken limits per IP)
const RENEW_TOKEN_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 8000;
const ALLOWED_ORIGINS = new Set(["https://haunted.ong", "https://www.haunted.ong"]);
const ORDER_ID_RE = /^ord_[0-9A-HJKMNP-TV-Z]{16}$/;
const LIC_ID_RE = /^lic_[0-9A-HJKMNP-TV-Z]{16}$/;
const CLAIM_RE = /^[A-Za-z0-9_-]{43}$/;
const OPEN = ["pending", "seen"];

/** Site paths (normalized, no trailing slash) the Worker serves from site/client/. Everything else under /client is a noindex 404. */
export const STORE_CLIENT_FILES = new Set([
  "/client/buy", "/client/buy/index.html",
  "/client/dashboard", "/client/dashboard/index.html",
  "/client/assets/store.css", "/client/assets/store.js", "/client/assets/buy.js",
  "/client/assets/dashboard.js", "/client/assets/qrcodegen.js",
  // The client download (public: every build locks without a key). A new release adds its zip here,
  // in site/client/download/, and in the dashboard's download card.
  "/client/download/crypto-client-0.54.1.zip",
]);

export function isStorePath(path) {
  return path === STORE_BASE || path.startsWith(STORE_BASE + "/");
}

export function coinAllowed(plan, chain, asset) {
  const c = COINS[`${chain}:${asset}`];
  if (!c || !PLANS[plan]) return false;
  if (plan === "lifetime" && !c.lifetime) return false; // Lifetime is Solana only (server-side rule)
  return true;
}

// ---------------------------------------------------------------------------
// Upstream fetch (mockable ONLY toward 127.0.0.1 for local tests)
// ---------------------------------------------------------------------------

function upstreamUrl(env, url) {
  const m = env.STORE_MOCK_UPSTREAM;
  if (typeof m === "string" && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(m)) {
    const u = new URL(url);
    return `${m}/${u.host}${u.pathname}${u.search}`;
  }
  return url;
}

async function getJson(env, url, init) {
  const res = await fetch(upstreamUrl(env, url), {
    ...(init || {}),
    headers: { accept: "application/json", ...((init && init.headers) || {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Price quotes (plan §6): two sources, both must answer and agree within 2%
// ---------------------------------------------------------------------------

function positivePrice(v) {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new Error("bad price");
  return n;
}

const coinbaseSpot = (pair) => ({
  name: `coinbase:${pair}`,
  get: async (env) => positivePrice((await getJson(env, `https://api.coinbase.com/v2/prices/${pair}/spot`))?.data?.amount),
});

const mempoolUsd = {
  name: "mempool.space:USD",
  get: async (env) => positivePrice((await getJson(env, "https://mempool.space/api/v1/prices"))?.USD),
};

const etherscanEthUsd = {
  name: "etherscan:ethusd",
  get: async (env) => {
    const key = env.ETHERSCAN_API_KEY;
    if (!key) throw new Error("ETHERSCAN_API_KEY not set");
    const j = await getJson(env, `https://api.etherscan.io/v2/api?chainid=1&module=stats&action=ethprice&apikey=${encodeURIComponent(key)}`);
    if (j?.status !== "1") throw new Error("etherscan error");
    return positivePrice(j?.result?.ethusd);
  },
};

// Kraken public ticker (free, no key): https://docs.kraken.com/api/docs/rest-api/get-ticker-information
// Price = result.SOLUSD.c[0] (last trade close). A non-empty `error` array is a failure.
const krakenLast = (pair) => ({
  name: `kraken:${pair}`,
  get: async (env) => {
    const j = await getJson(env, `https://api.kraken.com/0/public/Ticker?pair=${pair}`);
    if (!Array.isArray(j?.error) || j.error.length > 0) throw new Error("kraken error");
    const r = j?.result?.[pair];
    if (!r || !Array.isArray(r.c)) throw new Error("kraken shape");
    return positivePrice(r.c[0]);
  },
});

/**
 * Exactly two sources per volatile coin. Both are required: there is NO
 * single-source fallback. If either fails or they disagree by >2%, the store
 * refuses the order (safe mode).
 *   BTC: Coinbase spot + mempool.space     ETH: Coinbase spot + Etherscan (needs ETHERSCAN_API_KEY)
 *   SOL: Coinbase spot + Kraken (Oracle's pick, free/no key)
 * To swap a source, replace its entry here; keep two.
 */
export const PRICE_SOURCES = {
  btc: [coinbaseSpot("BTC-USD"), mempoolUsd],
  eth: [coinbaseSpot("ETH-USD"), etherscanEthUsd],
  sol: [coinbaseSpot("SOL-USD"), krakenLast("SOLUSD")],
};

const quoteCache = new Map(); // coin -> { at, quote } (successful quotes only)

export function combineQuotes(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const spread = (hi - lo) / lo;
  if (!(spread <= QUOTE_MAX_SPREAD)) return { ok: false, spread };
  return { ok: true, price: (a + b) / 2, spread };
}

async function getQuote(env, coin) {
  const now = Date.now();
  const hit = quoteCache.get(coin);
  if (hit && now - hit.at < QUOTE_CACHE_SECONDS * 1000 && !env.STORE_MOCK_UPSTREAM) return hit.quote;
  const sources = PRICE_SOURCES[coin];
  if (!sources || sources.length !== 2) return { ok: false, reason: "no_sources" };
  const settled = await Promise.allSettled(sources.map((s) => s.get(env)));
  if (settled.some((r) => r.status !== "fulfilled")) return { ok: false, reason: "source_failed" };
  const [a, b] = settled.map((r) => r.value);
  const c = combineQuotes(a, b);
  if (!c.ok) return { ok: false, reason: "disagree" };
  const quote = { ok: true, price: c.price, a: `${sources[0].name}=${a}`, b: `${sources[1].name}=${b}` };
  quoteCache.set(coin, { at: now, quote });
  return quote;
}

/** USD cents -> smallest units at `price` USD per coin, rounded UP to `round`. */
export function usdToUnits(cents, price, decimals, round) {
  const priceMicro = BigInt(Math.round(price * 1e6));
  if (priceMicro <= 0n) throw new Error("bad price");
  const num = BigInt(cents) * 10n ** BigInt(decimals) * 10000n; // cents/100 * 1e6 micro
  let units = (num + priceMicro - 1n) / priceMicro;
  if (round > 1n) units = ((units + round - 1n) / round) * round;
  return units;
}

export function formatUnits(intStr, decimals) {
  const v = BigInt(intStr);
  const d = 10n ** BigInt(decimals);
  const whole = v / d;
  let frac = (v % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function randInt(max) {
  // 1..max, uniform enough for an offset
  const buf = crypto.getRandomValues(new Uint32Array(1));
  return 1 + (buf[0] % max);
}

// ---------------------------------------------------------------------------
// Base58 + Solana associated token account (no deps)
// ---------------------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58encode(u8) {
  let n = 0n;
  for (const b of u8) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of u8) { if (b !== 0) break; out = "1" + out; }
  return out;
}

export function b58decode(s) {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch !== "1") break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}

const ED_P = 2n ** 255n - 19n;
function modPow(b, e, m) {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
const ED_D = ((ED_P - 121665n) * modPow(121666n, ED_P - 2n, ED_P)) % ED_P;

/** Same rule as curve25519-dalek's CompressedEdwardsY::decompress (what Solana's PDA check uses). */
export function isOnCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  y %= ED_P;
  const y2 = (y * y) % ED_P;
  const u = (y2 - 1n + ED_P) % ED_P;
  const v = (ED_D * y2 + 1n) % ED_P;
  const x2 = (u * modPow(v, ED_P - 2n, ED_P)) % ED_P;
  if (x2 === 0n) return true;
  return modPow(x2, (ED_P - 1n) / 2n, ED_P) === 1n;
}

async function findProgramAddress(seeds, programId) {
  const pid = b58decode(programId);
  const marker = new TextEncoder().encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, new Uint8Array([bump]), pid, marker];
    const len = parts.reduce((a, p) => a + p.length, 0);
    const buf = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
    if (!isOnCurve(h)) return b58encode(h);
  }
  throw new Error("no PDA");
}

const ataCache = new Map();
/** Associated token account of `owner` for `mint` (classic Token program). */
export async function associatedTokenAddress(owner, mint) {
  const k = owner + ":" + mint;
  if (!ataCache.has(k)) {
    ataCache.set(k, await findProgramAddress([b58decode(owner), b58decode(TOKEN_PROGRAM), b58decode(mint)], ATA_PROGRAM));
  }
  return ataCache.get(k);
}

// ---------------------------------------------------------------------------
// CORS + responses for store routes
// ---------------------------------------------------------------------------

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const h = { Vary: "Origin", "Cache-Control": "no-store" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

function withHeaders(res, headers) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

function storeLimiter(kind, ip) {
  return kind === "order"
    ? { binding: "RL_STORE_ORDER", key: `o:${ip}`, retryAfter: 60 }
    : { binding: "RL_STORE_POLL", key: `p:${ip}`, retryAfter: 60 };
}

// ---------------------------------------------------------------------------
// Claim secrets, renew tokens
// ---------------------------------------------------------------------------

function newClaimSecret() {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function claimHash(secret) {
  return sha256Hex("cc-claim-v1:" + secret);
}

async function claimMatches(row, secret) {
  if (!row || typeof secret !== "string" || !CLAIM_RE.test(secret)) return false;
  const h = await claimHash(secret);
  return bytesEqual(new TextEncoder().encode(h), new TextEncoder().encode(row.claim_secret_hash));
}

async function renewKey(env) {
  const raw = await crypto.subtle.importKey("raw", parsePepper(env.FP_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sub = await crypto.subtle.sign("HMAC", raw, new TextEncoder().encode("store-renew-token-v1"));
  return crypto.subtle.importKey("raw", sub, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function makeRenewToken(env, licId, now) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify({ lic: licId, exp: now + RENEW_TOKEN_SECONDS })));
  const sig = await crypto.subtle.sign("HMAC", await renewKey(env), new TextEncoder().encode(body));
  return `rt1.${body}.${b64urlEncode(sig)}`;
}

async function checkRenewToken(env, token, now) {
  if (typeof token !== "string" || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "rt1") return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await renewKey(env), b64urlDecode(parts[2]), new TextEncoder().encode(parts[1]));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (!p || typeof p.lic !== "string" || !Number.isInteger(p.exp) || p.exp <= now) return null;
    return p.lic;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Config: which confirmers are switched on
// ---------------------------------------------------------------------------

function solanaRpcUrl(env) {
  if (env.SOLANA_RPC_URL) return env.SOLANA_RPC_URL;
  if (env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`;
  return null;
}

export function autoConfirm(env, chain) {
  if (chain === "bitcoin") return true; // mempool.space, no key
  if (chain === "solana") return !!solanaRpcUrl(env);
  if (chain === "ethereum") return !!env.ETHERSCAN_API_KEY;
  return false;
}

// ---------------------------------------------------------------------------
// Order view
// ---------------------------------------------------------------------------

function paymentUrl(o) {
  const amt = formatUnits(o.expected_amount, o.amount_decimals);
  const msg = "Crypto%20Client%20key";
  if (o.chain === "solana") {
    const tok = o.asset === "usdc" ? `&spl-token=${USDC_SOL_MINT}` : "";
    return `solana:${o.recipient}?amount=${amt}${tok}&reference=${o.reference}&label=haunted.ong&message=${msg}`;
  }
  if (o.chain === "bitcoin") return `bitcoin:${o.recipient}?amount=${amt}&label=haunted.ong`;
  if (o.chain === "ethereum") {
    if (o.asset === "usdc") return `ethereum:${USDC_ETH_CONTRACT}@1/transfer?address=${o.recipient}&uint256=${o.expected_amount}`;
    return `ethereum:${o.recipient}@1?value=${o.expected_amount}`;
  }
  return null;
}

function orderView(env, o) {
  const c = COINS[`${o.chain}:${o.asset}`];
  return {
    id: o.id,
    plan: o.plan,
    chain: o.chain,
    asset: o.asset,
    coin_label: c ? c.label : o.asset,
    network: o.chain === "ethereum" ? "Ethereum mainnet only" : o.chain === "solana" ? "Solana mainnet" : "Bitcoin mainnet (bc1q)",
    recipient: o.recipient,
    expected_amount: o.expected_amount,
    amount_decimals: o.amount_decimals,
    amount: formatUnits(o.expected_amount, o.amount_decimals),
    usd_price: (o.usd_price_cents / 100).toFixed(2),
    payment_url: paymentUrl(o),
    reference: o.reference ?? undefined,
    created_at: o.created_at,
    expires_at: o.expires_at,
    status: o.status,
    seen_at: o.seen_at ?? null,
    paid_at: o.paid_at ?? null,
    renew: !!o.renew_license_id,
    auto_confirm: autoConfirm(env, o.chain),
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleStoreRoute(request, env, path, url) {
  const cors = corsHeaders(request);
  const origin = request.headers.get("Origin");
  const method = request.method.toUpperCase();
  // Browsers on other origins are refused outright (no CORS, no work done).
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return withHeaders(jsonError("forbidden", "Origin not allowed."), { Vary: "Origin", "Cache-Control": "no-store" });
  }
  if (method === "OPTIONS") {
    if (!origin) return withHeaders(jsonError("bad_request", "Method not allowed."), cors);
    return new Response(null, {
      status: 204,
      headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type" },
    });
  }
  let res;
  try {
    res = await routeStore(request, env, path, url, method);
  } catch (err) {
    res = jsonError("server_error", "Internal server error.");
  }
  return withHeaders(res, cors);
}

async function routeStore(request, env, path, url, method) {
  const ip = clientIp(request);
  if (path === STORE_BASE + "/config") {
    if (method !== "GET") return jsonError("bad_request", "Method not allowed.");
    return handleConfig(env);
  }
  if (path === STORE_BASE + "/orders") {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    const limited = await rejectIfLimited(env, storeLimiter("order", ip));
    if (limited) return limited;
    return handleCreateOrder(request, env);
  }
  const one = path.match(/^\/license\/v1\/store\/orders\/(ord_[0-9A-HJKMNP-TV-Z]{16})(\/ack)?$/);
  if (one) {
    const limited = await rejectIfLimited(env, storeLimiter("poll", ip));
    if (limited) return limited;
    if (one[2]) {
      if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
      return handleAck(request, env, one[1]);
    }
    if (method !== "GET") return jsonError("bad_request", "Method not allowed.");
    return handlePoll(env, one[1], url.searchParams.get("claim"));
  }
  if (path === STORE_BASE + "/license") {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    const limited = await rejectIfLimited(env, storeLimiter("poll", ip));
    if (limited) return limited;
    return handleDashboard(request, env);
  }
  return jsonError("not_found", "Not found.");
}

function handleConfig(env) {
  const plans = Object.entries(PLANS).map(([id, p]) => ({ id, label: p.label, usd: (p.cents / 100).toFixed(2), days: p.days }));
  const coins = Object.values(COINS).map((c) => ({
    chain: c.chain, asset: c.asset, label: c.label,
    plans: Object.keys(PLANS).filter((p) => coinAllowed(p, c.chain, c.asset)),
    auto_confirm: autoConfirm(env, c.chain),
  }));
  // Default: Solana USDC when Solana checks are on, else the first coin that is on (Bitcoin).
  const on = coins.filter((c) => c.auto_confirm);
  const def = on.find((c) => c.chain === "solana" && c.asset === "usdc") || on[0] || null;
  return jsonOk({ plans, coins, default_coin: def ? { chain: def.chain, asset: def.asset } : null, order_ttl_seconds: ORDER_TTL, support: SUPPORT || null });
}

async function handleCreateOrder(request, env) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const { plan, chain, asset } = body.data;
  if (typeof plan !== "string" || !Object.prototype.hasOwnProperty.call(PLANS, plan)) {
    return jsonError("bad_request", "plan must be 30d, 90d, 365d or lifetime.");
  }
  const coinKey = `${chain}:${asset}`;
  if (typeof chain !== "string" || typeof asset !== "string" || !Object.prototype.hasOwnProperty.call(COINS, coinKey)) {
    return jsonError("bad_request", "Unsupported coin.");
  }
  if (!coinAllowed(plan, chain, asset)) {
    return jsonError("bad_request", "Lifetime can only be paid on Solana (USDC or SOL).", { reason: "lifetime_solana_only" });
  }
  const coin = COINS[coinKey];
  // No order (no address, no QR) for a coin whose payments can't be confirmed automatically yet.
  // Switches on by itself once HELIUS_API_KEY / SOLANA_RPC_URL or ETHERSCAN_API_KEY exist.
  // Admin fulfill of existing orders is unaffected.
  if (!autoConfirm(env, chain)) {
    return jsonError("coin_not_available", `${{ solana: "Solana", ethereum: "Ethereum" }[chain] || coin.label} payments aren't switched on yet. Pick another coin.`, { reason: "auto_confirm_off", chain, asset });
  }
  const now = nowSec();
  const db = env.LICENSE_DB;

  // Renew: proof is a short-lived renew token from the dashboard.
  let renewId = null;
  if (body.data.renew_license_id != null || body.data.renew_token != null) {
    if (plan === "lifetime") return jsonError("bad_request", "Lifetime can't be bought as a renew.", { reason: "lifetime_no_renew" });
    const lid = body.data.renew_license_id;
    if (typeof lid !== "string" || !LIC_ID_RE.test(lid)) return jsonError("bad_request", "renew_license_id is invalid.");
    const proven = await checkRenewToken(env, body.data.renew_token, now);
    if (proven !== lid) return jsonError("unauthorized", "Renew link expired. Open the dashboard again.");
    const lic = await getLicenseById(db, lid);
    if (!lic) return jsonError("key_not_found", "No license found.");
    if (lic.status !== "active") return jsonError("key_revoked", "This license was revoked.");
    if (lic.expires_at == null) return jsonError("bad_request", "Lifetime keys don't need a renew.", { reason: "lifetime_no_renew" });
    renewId = lid;
  }

  let base;
  let quote = null;
  if (coin.quote) {
    quote = await getQuote(env, coin.quote);
    if (!quote.ok) {
      return jsonError("safe_mode", "Price check failed, so the store is in safe mode for this coin. Try again in a minute or pay with USDC.", { reason: quote.reason });
    }
    base = usdToUnits(PLANS[plan].cents, quote.price, coin.decimals, coin.round);
  } else {
    base = BigInt(PLANS[plan].cents) * 10n ** BigInt(coin.decimals - 2); // 1 USDC = 1 USD
  }

  const claim = newClaimSecret();
  const claimH = await claimHash(claim);
  const reference = chain === "solana" ? b58encode(crypto.getRandomValues(new Uint8Array(32))) : null;
  const id = newId("ord_");
  let row = null;
  for (let attempt = 0; attempt < 8 && !row; attempt++) {
    const amount = (base + BigInt(randInt(coin.offMax)) * coin.offUnit).toString();
    try {
      await db.prepare(
        `INSERT INTO orders (id, claim_secret_hash, plan, chain, asset, usd_price_cents, coin_price, price_source_a, price_source_b,
                             expected_amount, amount_decimals, recipient, reference, status, expires_at, renew_license_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).bind(id, claimH, plan, chain, asset, PLANS[plan].cents, quote ? String(quote.price) : null, quote ? quote.a : null,
        quote ? quote.b : null, amount, coin.decimals, coin.recipient, reference, now + ORDER_TTL, renewId, now).run();
      row = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message))) throw err; // amount collision -> new offset
    }
  }
  if (!row) return jsonError("rate_limited", "The store is busy. Try again in a moment.", { retry_after: 30 });
  return jsonOk({ order: orderView(env, row), claim_secret: claim }, 201);
}

async function loadClaimed(env, id, claim) {
  const row = await env.LICENSE_DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!(await claimMatches(row, claim))) return null;
  return row;
}

async function revealFor(env, row, now) {
  // Plaintext key only for the claim holder, only within 7 days of payment.
  if (!row.issued_key) return null;
  if (row.paid_at == null || now - row.paid_at > REVEAL_SECONDS) {
    await env.LICENSE_DB.prepare("UPDATE orders SET issued_key = NULL WHERE id = ?").bind(row.id).run();
    return null;
  }
  if (row.revealed_at == null) {
    await env.LICENSE_DB.prepare("UPDATE orders SET revealed_at = ? WHERE id = ? AND revealed_at IS NULL").bind(now, row.id).run();
    await audit(env.LICENSE_DB, row.license_id, "key_reveal", { order: row.id });
  }
  return { key: row.issued_key, available_until: row.paid_at + REVEAL_SECONDS };
}

async function licenseSummary(env, licId, now) {
  const lic = licId ? await getLicenseById(env.LICENSE_DB, licId) : null;
  if (!lic) return null;
  return {
    id: lic.id, plan: lic.plan, key_hint: lic.key_hint, status: lic.status,
    expires_at: lic.expires_at ?? null, lifetime: lic.expires_at == null,
    seconds_left: lic.expires_at == null ? null : Math.max(0, lic.expires_at - now),
  };
}

async function handlePoll(env, id, claim) {
  let row = await loadClaimed(env, id, claim);
  if (!row) return jsonError("not_found", "Not found.");
  let now = nowSec();
  let confirm = autoConfirm(env, row.chain) ? "ok" : "not_configured";
  if (OPEN.includes(row.status) && now - (row.checked_at ?? 0) >= CHECK_THROTTLE) {
    const r = await confirmOrders(env, [row], now);
    if (r.errors) confirm = "check_failed";
    await expireOrders(env, now, [row.id]);
    row = await env.LICENSE_DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
    now = nowSec();
  }
  const out = { order: orderView(env, row), confirm };
  if (row.status === "paid" || row.status === "manual") {
    out.license = await licenseSummary(env, row.license_id, now);
    const rev = await revealFor(env, row, now);
    out.key = rev ? rev.key : null;
    out.key_available_until = rev ? rev.available_until : null;
  }
  return jsonOk(out);
}

async function handleAck(request, env, id) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const row = await loadClaimed(env, id, body.data.claim);
  if (!row) return jsonError("not_found", "Not found.");
  await env.LICENSE_DB.prepare("UPDATE orders SET issued_key = NULL WHERE id = ?").bind(id).run();
  return jsonOk({ id, key: null });
}

async function handleDashboard(request, env) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const now = nowSec();
  let licId = null;
  let reveal = null;
  if (body.data.key != null) {
    const norm = await normalizeKey(body.data.key);
    if (norm.error) return jsonError("bad_request", "Key format is invalid.");
    const hash = await keyHashHex(norm.key);
    const limited = await rejectIfLimited(env, { binding: "RL_KEY", key: `k:${hash}`, retryAfter: 60 });
    if (limited) return limited;
    const lic = await getLicenseByHash(env.LICENSE_DB, hash);
    if (!lic) return jsonError("key_not_found", "No license found for that key.");
    licId = lic.id;
  } else {
    const oid = body.data.order_id;
    if (typeof oid !== "string" || !ORDER_ID_RE.test(oid)) return jsonError("bad_request", "order_id or key is required.");
    const row = await loadClaimed(env, oid, body.data.claim);
    if (!row) return jsonError("not_found", "Not found.");
    if (!(row.status === "paid" || row.status === "manual") || !row.license_id) {
      return jsonOk({ order: orderView(env, row), license: null });
    }
    licId = row.license_id;
    reveal = await revealFor(env, row, now);
  }
  const license = await licenseSummary(env, licId, now);
  const out = { license, key: reveal ? reveal.key : null, key_available_until: reveal ? reveal.available_until : null };
  if (license && license.status === "active" && !license.lifetime) out.renew_token = await makeRenewToken(env, license.id, now);
  return jsonOk(out);
}

// ---------------------------------------------------------------------------
// Confirmers (plan §5)
// ---------------------------------------------------------------------------

function inWindow(o, t) {
  // Payment time must be at/after order creation (minus skew) and, unless the
  // order was already seen in time, at/before expires_at (plus a little skew).
  if (!Number.isFinite(t)) return false;
  if (t < o.created_at - PAY_SKEW) return false;
  if (o.status === "seen") return true;
  return t <= o.expires_at + LATE_SKEW;
}

// ---- Solana ----

async function solanaRpc(env, method, params) {
  const url = solanaRpcUrl(env);
  const j = await getJson(env, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (j && j.error) throw new Error("rpc error");
  return j ? j.result : null;
}

function txAccountKeys(tx) {
  const msg = tx?.transaction?.message;
  const raw = Array.isArray(msg?.accountKeys) ? msg.accountKeys : [];
  const keys = raw.map((k) => (typeof k === "string" ? k : k?.pubkey));
  // jsonParsed lists lookup-table keys inline (with `source`); plain json appends meta.loadedAddresses.
  const inline = raw.some((k) => k && typeof k === "object" && "source" in k);
  if (!inline && tx?.meta?.loadedAddresses) {
    keys.push(...(tx.meta.loadedAddresses.writable || []), ...(tx.meta.loadedAddresses.readonly || []));
  }
  return keys;
}

/** Validate one Solana tx against an order. Returns { ok, amount, time } or { ok:false, why }. */
export async function verifySolanaTx(o, tx) {
  if (!tx || !tx.meta) return { ok: false, why: "missing" };
  if (tx.meta.err != null) return { ok: false, why: "failed" };
  const keys = txAccountKeys(tx);
  if (!keys.includes(o.reference)) return { ok: false, why: "no_reference" };
  const ins = tx.transaction?.message?.instructions || [];
  const last = ins[ins.length - 1];
  const lastProgram = last ? (last.programId ?? keys[last.programIdIndex]) : null;
  let delta;
  if (o.asset === "sol") {
    if (lastProgram !== SYSTEM_PROGRAM) return { ok: false, why: "last_ix" };
    const i = keys.indexOf(o.recipient);
    if (i < 0) return { ok: false, why: "no_recipient" };
    const pre = tx.meta.preBalances?.[i], post = tx.meta.postBalances?.[i];
    if (pre == null || post == null) return { ok: false, why: "no_balance" };
    delta = BigInt(post) - BigInt(pre);
  } else if (o.asset === "usdc") {
    if (lastProgram !== TOKEN_PROGRAM) return { ok: false, why: "last_ix" };
    // Only the recipient's associated token account for the official USDC mint
    // counts. Never the SOL balance, never a look-alike token.
    const ata = await associatedTokenAddress(o.recipient, USDC_SOL_MINT);
    const post = (tx.meta.postTokenBalances || []).find(
      (b) => b && b.mint === USDC_SOL_MINT && b.owner === o.recipient && keys[b.accountIndex] === ata,
    );
    if (!post) return { ok: false, why: "no_usdc_ata" };
    const pre = (tx.meta.preTokenBalances || []).find((b) => b && b.accountIndex === post.accountIndex);
    if (pre && pre.mint !== USDC_SOL_MINT) return { ok: false, why: "mint_mismatch" };
    // First payment may create the ATA in the same tx: no pre-balance -> 0.
    const preAmt = pre ? BigInt(pre.uiTokenAmount?.amount ?? "0") : 0n;
    delta = BigInt(post.uiTokenAmount?.amount ?? "0") - preAmt;
  } else return { ok: false, why: "asset" };
  if (delta !== BigInt(o.expected_amount)) return { ok: false, why: "amount", amount: delta.toString() };
  return { ok: true, amount: delta.toString(), time: tx.blockTime };
}

async function checkSolana(env, o) {
  // Find the payment by the order's reference ONLY. Never by the recipient
  // (that is also Ledger's trading wallet).
  const sigs = (await solanaRpc(env, "getSignaturesForAddress", [o.reference, { commitment: "confirmed", limit: 20 }])) || [];
  let seen = null;
  for (const s of sigs) {
    if (!s || typeof s.signature !== "string" || s.err != null) continue;
    const finalized = s.confirmationStatus === "finalized";
    const tx = await solanaRpc(env, "getTransaction", [s.signature, {
      commitment: finalized ? "finalized" : "confirmed", encoding: "jsonParsed", maxSupportedTransactionVersion: 0,
    }]);
    const v = await verifySolanaTx(o, tx);
    if (!v.ok || !inWindow(o, v.time)) continue;
    if (finalized) return { kind: "paid", txid: s.signature, index: 0, amount: v.amount, time: v.time };
    seen = seen || { kind: "seen", txid: s.signature, time: v.time };
  }
  return seen;
}

// ---- Bitcoin (mempool.space) ----

async function btcSnapshot(env) {
  const [tip, txs] = await Promise.all([
    getJson(env, "https://mempool.space/api/blocks/tip/height"),
    getJson(env, `https://mempool.space/api/address/${BTC_RECIPIENT}/txs`),
  ]);
  if (!Number.isInteger(tip) || !Array.isArray(txs)) throw new Error("mempool shape");
  return { tip, txs };
}

export function matchBtc(o, snap, now) {
  let seen = null;
  for (const tx of snap.txs) {
    if (!tx || typeof tx.txid !== "string") continue;
    // Ledger spending from this address (with change back) can never pay an order.
    if ((tx.vin || []).some((i) => i?.prevout?.scriptpubkey_address === BTC_RECIPIENT)) continue;
    (tx.vout || []).forEach((out, index) => {
      if (!out || out.scriptpubkey_address !== BTC_RECIPIENT) return;
      if (String(out.value) !== String(o.expected_amount)) return;
      const st = tx.status || {};
      if (st.confirmed && Number.isInteger(st.block_height)) {
        if (!inWindow(o, st.block_time)) return;
        const confs = snap.tip - st.block_height + 1;
        if (confs >= BTC_CONFIRMATIONS) {
          if (!seen || seen.kind !== "paid") seen = { kind: "paid", txid: tx.txid, index, amount: String(out.value), time: st.block_time, confs };
        } else if (!seen) seen = { kind: "seen", txid: tx.txid, time: st.block_time, confs };
      } else if (!seen && inWindow(o, now)) {
        // mempool only: may mark seen, never paid (RBF)
        seen = { kind: "seen", txid: tx.txid, time: now, confs: 0 };
      }
    });
    if (seen && seen.kind === "paid") break;
  }
  return seen;
}

// ---- Ethereum (Etherscan V2, chainid=1 only) ----

async function etherscan(env, params) {
  const q = new URLSearchParams({ chainid: "1", ...params, apikey: env.ETHERSCAN_API_KEY });
  const j = await getJson(env, `https://api.etherscan.io/v2/api?${q}`);
  return j;
}

async function etherscanList(env, params) {
  const j = await etherscan(env, { module: "account", ...params, address: ETH_RECIPIENT, startblock: "0", endblock: "99999999", page: "1", offset: "100", sort: "desc" });
  if (j?.status === "1" && Array.isArray(j.result)) return j.result;
  if (j?.status === "0" && /no (transactions|records) found/i.test(String(j?.message)) ) return [];
  throw new Error("etherscan list error");
}

async function ethSnapshot(env, needNative, needToken) {
  const fin = await etherscan(env, { module: "proxy", action: "eth_getBlockByNumber", tag: "finalized", boolean: "false" });
  const finalized = fin?.result?.number ? parseInt(fin.result.number, 16) : NaN;
  const [normal, internal, token] = await Promise.all([
    needNative ? etherscanList(env, { action: "txlist" }) : [],
    needNative ? etherscanList(env, { action: "txlistinternal" }) : [],
    needToken ? etherscanList(env, { action: "tokentx", contractaddress: USDC_ETH_CONTRACT }) : [],
  ]);
  return { finalized, normal, internal, token };
}

export function matchEth(o, snap) {
  const me = ETH_RECIPIENT.toLowerCase();
  let cands = [];
  if (o.asset === "eth") {
    for (const t of [...snap.normal, ...snap.internal]) {
      if (!t || String(t.isError) !== "0") continue;
      if (t.txreceipt_status != null && t.txreceipt_status !== "" && String(t.txreceipt_status) !== "1") continue;
      if (String(t.to).toLowerCase() !== me || String(t.from).toLowerCase() === me) continue;
      if (String(t.value) !== String(o.expected_amount)) continue;
      cands.push({ txid: String(t.hash).toLowerCase(), index: -1, block: Number(t.blockNumber), time: Number(t.timeStamp), amount: String(t.value) });
    }
  } else if (o.asset === "usdc") {
    for (const t of snap.token) {
      // Circle's contract only. Never trust tokenSymbol / tokenName.
      if (!t || String(t.contractAddress).toLowerCase() !== USDC_ETH_CONTRACT) continue;
      if (String(t.to).toLowerCase() !== me || String(t.from).toLowerCase() === me) continue;
      if (String(t.value) !== String(o.expected_amount)) continue;
      const li = Number(t.logIndex);
      if (!Number.isInteger(li)) continue;
      cands.push({ txid: String(t.hash).toLowerCase(), index: li, block: Number(t.blockNumber), time: Number(t.timeStamp), amount: String(t.value) });
    }
  }
  let seen = null;
  for (const c of cands) {
    if (!/^0x[0-9a-f]{64}$/.test(c.txid) || !Number.isInteger(c.block)) continue;
    if (!inWindow(o, c.time)) continue;
    if (Number.isInteger(snap.finalized) && c.block <= snap.finalized) return { kind: "paid", ...c };
    seen = seen || { kind: "seen", txid: c.txid, time: c.time };
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Confirm + issue
// ---------------------------------------------------------------------------

/** Check a batch of open orders against their chains. Same code for poll and cron. */
export async function confirmOrders(env, orders, now) {
  const db = env.LICENSE_DB;
  const results = new Map();
  let errors = 0;
  const by = { solana: [], bitcoin: [], ethereum: [] };
  for (const o of orders) if (OPEN.includes(o.status) && by[o.chain]) by[o.chain].push(o);

  if (by.bitcoin.length) {
    try {
      const snap = await btcSnapshot(env);
      for (const o of by.bitcoin) results.set(o.id, matchBtc(o, snap, now));
    } catch { errors++; }
  }
  if (by.ethereum.length && autoConfirm(env, "ethereum")) {
    try {
      const snap = await ethSnapshot(env, by.ethereum.some((o) => o.asset === "eth"), by.ethereum.some((o) => o.asset === "usdc"));
      for (const o of by.ethereum) results.set(o.id, matchEth(o, snap));
    } catch { errors++; }
  }
  if (by.solana.length && autoConfirm(env, "solana")) {
    for (const o of by.solana) {
      try { results.set(o.id, await checkSolana(env, o)); } catch { errors++; }
    }
  }

  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await db.prepare(`UPDATE orders SET checked_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`).bind(now, ...ids).run();
  }
  for (const o of orders) {
    const r = results.get(o.id);
    if (!r) continue;
    if (r.kind === "paid") {
      await issueForOrder(env, o, { txid: r.txid, index: r.index, amount: r.amount, status: "paid", open: OPEN, now });
    } else if (r.kind === "seen" && o.status === "pending") {
      await db.prepare("UPDATE orders SET status = 'seen', seen_at = ?, seen_txid = ? WHERE id = ? AND status = 'pending'")
        .bind(now, r.txid, o.id).run();
    }
  }
  return { errors };
}

/**
 * Mark the order paid/manual, record the payment, and issue a key or apply a
 * renew — all in ONE D1 batch (a transaction). The UNIQUE index on
 * (chain, chain_txid, chain_index) makes the whole batch fail if the payment
 * already unlocked another order.
 */
export async function issueForOrder(env, o, pay) {
  const db = env.LICENSE_DB;
  const now = pay.now;
  const openList = pay.open.map(() => "?").join(",");
  const days = PLANS[o.plan].days;
  const stmts = [];
  let licId, key = null, hint = null;
  if (o.renew_license_id) {
    licId = o.renew_license_id;
    stmts.push(db.prepare(
      `UPDATE licenses SET expires_at = MAX(?, expires_at) + ?, plan = ?
        WHERE id = ? AND expires_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status IN (${openList}))`,
    ).bind(now, days * 86400, o.plan, licId, o.id, ...pay.open));
  } else {
    licId = newId("lic_");
    key = await generateKeyString();
    hint = (await normalizeKey(key)).hint;
    const hash = await keyHashHex(key);
    stmts.push(db.prepare(
      `INSERT INTO licenses (id, key_hash, key_hint, plan, max_devices, status, expires_at, note, created_at, resets_used)
       SELECT ?, ?, ?, ?, 1, 'active', ?, ?, ?, 0
        WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status IN (${openList}))`,
    ).bind(licId, hash, hint, o.plan, planExpiry(o.plan, now), `store ${o.id}`, now, o.id, ...pay.open));
  }
  stmts.push(db.prepare(
    `UPDATE orders SET status = ?, paid_at = ?, chain_txid = ?, chain_index = ?, amount_paid = ?, license_id = ?,
                       issued_key = ?, note = COALESCE(?, note)
      WHERE id = ? AND status IN (${openList})`,
  ).bind(pay.status, now, pay.txid, pay.index, pay.amount, licId, key, pay.note ?? null, o.id, ...pay.open));
  let res;
  try {
    res = await db.batch(stmts);
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) return { ok: false, conflict: true };
    throw err;
  }
  const changed = res[res.length - 1]?.meta?.changes ?? 0;
  if (changed !== 1) return { ok: false, gone: true };
  await audit(db, licId, o.renew_license_id ? "renew" : "issue", {
    order: o.id, plan: o.plan, chain: o.chain, via: pay.status, ...(o.renew_license_id ? { days } : { max_devices: 1 }),
  });
  return { ok: true, license_id: licId, key };
}

export async function expireOrders(env, now, onlyIds) {
  const db = env.LICENSE_DB;
  const filt = onlyIds ? ` AND id IN (${onlyIds.map(() => "?").join(",")})` : "";
  const args = onlyIds || [];
  await db.prepare(`UPDATE orders SET status = 'expired' WHERE status = 'pending' AND expires_at < ?${filt}`)
    .bind(now - EXPIRE_AFTER, ...args).run();
  await db.prepare(`UPDATE orders SET status = 'expired' WHERE status = 'seen' AND seen_at < ?${filt}`)
    .bind(now - SEEN_GIVE_UP, ...args).run();
}

/** Cron sweep (plan §4): confirm open orders, expire stale ones, drop old plaintext keys. */
export async function storeSweep(env) {
  const db = env.LICENSE_DB;
  const now = nowSec();
  const { results } = await db.prepare(
    "SELECT * FROM orders WHERE status IN ('pending','seen') ORDER BY created_at ASC LIMIT 100",
  ).all();
  const open = results || [];
  if (open.length) await confirmOrders(env, open, now);
  await expireOrders(env, now, null);
  await db.prepare("UPDATE orders SET issued_key = NULL WHERE issued_key IS NOT NULL AND paid_at < ?")
    .bind(now - REVEAL_SECONDS).run();
  return { checked: open.length };
}

// ---------------------------------------------------------------------------
// Admin: list, export for Ledger, manual fulfill
// ---------------------------------------------------------------------------

function adminOrderItem(o) {
  return {
    id: o.id, plan: o.plan, chain: o.chain, asset: o.asset, status: o.status,
    usd_price: (o.usd_price_cents / 100).toFixed(2), coin_price: o.coin_price ?? null,
    price_source_a: o.price_source_a ?? null, price_source_b: o.price_source_b ?? null,
    expected_amount: o.expected_amount, amount_decimals: o.amount_decimals, recipient: o.recipient,
    reference: o.reference ?? null, created_at: o.created_at, expires_at: o.expires_at,
    seen_at: o.seen_at ?? null, seen_txid: o.seen_txid ?? null, paid_at: o.paid_at ?? null,
    chain_txid: o.chain_txid ?? null, chain_index: o.chain_index ?? null, amount_paid: o.amount_paid ?? null,
    license_id: o.license_id ?? null, renew_license_id: o.renew_license_id ?? null, note: o.note ?? null,
  };
}

export async function handleAdminOrdersRoute(request, env, path, url) {
  const method = request.method.toUpperCase();
  if (path === API_BASE + "/admin/orders") {
    if (method !== "GET") return jsonError("bad_request", "Method not allowed.");
    return adminList(env, url);
  }
  if (path === API_BASE + "/admin/orders/export") {
    if (method !== "GET") return jsonError("bad_request", "Method not allowed.");
    return adminExport(env, url);
  }
  const f = path.match(/^\/license\/v1\/admin\/orders\/(ord_[0-9A-HJKMNP-TV-Z]{16})\/fulfill$/);
  if (f) {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return adminFulfill(request, env, f[1]);
  }
  const one = path.match(/^\/license\/v1\/admin\/orders\/(ord_[0-9A-HJKMNP-TV-Z]{16})$/);
  if (one) {
    if (method !== "GET") return jsonError("bad_request", "Method not allowed.");
    const o = await env.LICENSE_DB.prepare("SELECT * FROM orders WHERE id = ?").bind(one[1]).first();
    if (!o) return jsonError("not_found", "Not found.");
    return jsonOk({ order: adminOrderItem(o) });
  }
  return jsonError("not_found", "Not found.");
}

async function adminList(env, url) {
  const status = url.searchParams.get("status");
  if (status && !["pending", "seen", "paid", "expired", "manual"].includes(status)) {
    return jsonError("bad_request", "status is invalid.");
  }
  let limit = 50;
  const raw = url.searchParams.get("limit");
  if (raw != null) {
    limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return jsonError("bad_request", "limit must be an integer from 1 to 200.");
  }
  const cursor = url.searchParams.get("cursor");
  if (cursor && !ORDER_ID_RE.test(cursor)) return jsonError("bad_request", "cursor is invalid.");
  const where = [], args = [];
  if (status) { where.push("status = ?"); args.push(status); }
  if (cursor) {
    const c = await env.LICENSE_DB.prepare("SELECT created_at, id FROM orders WHERE id = ?").bind(cursor).first();
    if (!c) return jsonError("bad_request", "cursor is invalid.");
    where.push("(created_at < ? OR (created_at = ? AND id < ?))"); args.push(c.created_at, c.created_at, c.id);
  }
  args.push(limit + 1);
  const { results } = await env.LICENSE_DB.prepare(
    `SELECT * FROM orders ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(...args).all();
  const rows = results || [];
  const more = rows.length > limit;
  const items = (more ? rows.slice(0, limit) : rows).map(adminOrderItem);
  return jsonOk({ items, next_cursor: more ? items[items.length - 1].id : null });
}

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

async function adminExport(env, url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const f = from == null || from === "" ? 0 : Number(from);
  const t = to == null || to === "" ? 4102444800 : Number(to);
  if (!Number.isInteger(f) || !Number.isInteger(t) || f < 0 || t < f) return jsonError("bad_request", "from/to must be unix seconds.");
  // Test orders (tools/store-test-order.sh) are fulfilled by hand with a fake txid "TESTORDER<ms>". They
  // aren't sales, so the export for Ledger leaves them out. A real txid can't start with that: BTC/ETH txids
  // are hex and Solana signatures are base58, which has no capital O. GET /admin/orders still lists them.
  const { results } = await env.LICENSE_DB.prepare(
    `SELECT o.*, l.key_hint AS key_hint FROM orders o LEFT JOIN licenses l ON l.id = o.license_id
      WHERE o.status IN ('paid','manual') AND o.paid_at >= ? AND o.paid_at <= ?
        AND NOT (o.status = 'manual' AND o.chain_txid LIKE 'TESTORDER%')
      ORDER BY o.paid_at ASC, o.id ASC LIMIT 5000`,
  ).bind(f, t).all();
  const items = (results || []).map((o) => ({
    order_id: o.id, status: o.status, chain: o.chain, asset: o.asset,
    txid: o.chain_txid, index: o.chain_index, amount_paid: o.amount_paid, amount_decimals: o.amount_decimals,
    amount_paid_decimal: o.amount_paid != null && /^\d+$/.test(o.amount_paid) ? formatUnits(o.amount_paid, o.amount_decimals) : null,
    usd_price: (o.usd_price_cents / 100).toFixed(2), coin_price: o.coin_price ?? null, plan: o.plan,
    paid_at: o.paid_at, license_id: o.license_id, key_hint: o.key_hint ?? null, renew: !!o.renew_license_id,
  }));
  if (url.searchParams.get("format") === "csv") {
    const cols = ["order_id", "status", "chain", "asset", "txid", "index", "amount_paid", "amount_decimals", "amount_paid_decimal", "usd_price", "coin_price", "plan", "paid_at", "license_id", "key_hint", "renew"];
    const lines = [cols.join(",")].concat(items.map((i) => cols.map((c) => csvCell(i[c])).join(",")));
    return new Response(lines.join("\r\n") + "\r\n", {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="crypto-client-orders.csv"' },
    });
  }
  return jsonOk({ items });
}

async function adminFulfill(request, env, id) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const txid = body.data.txid;
  if (typeof txid !== "string" || txid.length < 8 || txid.length > 128 || !/^[0-9A-Za-z]+$/.test(txid)) {
    return jsonError("bad_request", "txid is required (the payment's txid or signature).");
  }
  const index = body.data.index == null ? 0 : body.data.index;
  if (!Number.isInteger(index) || index < -1 || index > 100000) return jsonError("bad_request", "index must be an integer.");
  const amountPaid = body.data.amount_paid == null ? null : String(body.data.amount_paid);
  if (amountPaid != null && !/^\d{1,40}$/.test(amountPaid)) return jsonError("bad_request", "amount_paid must be an integer string (smallest units).");
  const note = body.data.note == null ? null : body.data.note;
  if (note != null && (typeof note !== "string" || note.length > 512)) return jsonError("bad_request", "note must be at most 512 characters.");
  const o = await env.LICENSE_DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!o) return jsonError("not_found", "Not found.");
  if (!["pending", "seen", "expired"].includes(o.status)) return jsonError("bad_request", `Order is already ${o.status}.`);
  const normTx = o.chain === "ethereum" ? txid.toLowerCase() : txid;
  const r = await issueForOrder(env, o, {
    txid: normTx, index, amount: amountPaid, status: "manual", open: ["pending", "seen", "expired"], now: nowSec(), note: note ? `manual: ${note}` : "manual",
  });
  if (r.conflict) return jsonError("payment_conflict", "That payment already unlocked another order.");
  if (!r.ok) return jsonError("bad_request", "Order changed while fulfilling; check it again.");
  const updated = await env.LICENSE_DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  return jsonOk({ order: adminOrderItem(updated), license_id: r.license_id, key: r.key });
}
