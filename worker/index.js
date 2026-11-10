/**
 * Crypto Client license API — Worker main script for zachxbt-boo.
 * Implements every endpoint in key-api-spec.md. No npm dependencies.
 *
 * Routing (assets.run_worker_first = true, so every request lands here):
 *  - Host api.haunted.ong: the API, at /license/v1/*. Every other path on
 *    that host is a JSON 404. Site assets are never served there.
 *  - Any other host (haunted.ong, www.haunted.ong, zachxbt.boo, workers.dev):
 *    /api and /api/* -> the site's normal 404 page (same as any unknown path,
 *    so the API isn't revealed); /client and /client/* -> the site's 404 page
 *    plus X-Robots-Tag: noindex (reserved for key buys, payments, dashboard);
 *    everything else -> env.ASSETS.fetch(request), untouched, so _headers,
 *    caching, ETags and the 404 page behave exactly as before.
 */

const API_HOST = "api.haunted.ong";
const API_BASE = "/license/v1";
// Missing-on-purpose asset path used to fetch the site's real 404 page.
const NOT_FOUND_PROBE = "/__not_found__/";
const BODY_LIMIT = 4096;
const HEARTBEAT_SECONDS = 1800;
const EXP_SECONDS = 6 * 60 * 60;
const GRACE_SECONDS = 24 * 60 * 60;
const LAST_SEEN_MIN_INTERVAL = 10 * 60;
const RESET_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const RESET_MAX_PER_WINDOW = 2;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_HASH_PREFIX = "cc-key-v1:";
const KID = "k1";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const HTTP_BY_CODE = {
  bad_request: 400,
  unauthorized: 401,
  token_invalid: 401,
  key_not_found: 404,
  not_found: 404,
  key_revoked: 403,
  key_expired: 403,
  activation_released: 403,
  device_limit: 409,
  device_mismatch: 409,
  rate_limited: 429,
  reset_limit: 429,
  server_error: 500,
};

const LIC_ID_RE = /^lic_[0-9A-HJKMNP-TV-Z]{16}$/;
const DEVICE_FP_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Bytes / encoding
// ---------------------------------------------------------------------------

const te = new TextEncoder();
const td = new TextDecoder();

function toHex(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < u8.length; i++) out += u8[i].toString(16).padStart(2, "0");
  return out;
}

function b64urlEncode(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlDecode(s) {
  if (typeof s !== "string" || !s) throw new Error("invalid b64url");
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b = atob(s.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function bytesEqual(a, b) {
  const ua = a instanceof Uint8Array ? a : new Uint8Array(a);
  const ub = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (ua.byteLength !== ub.byteLength) return false;
  const subtle = crypto.subtle;
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(ua, ub);
  }
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

async function sha256Bytes(data) {
  const raw = typeof data === "string" ? te.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
}

async function sha256Hex(data) {
  return toHex(await sha256Bytes(data));
}

function parsePepper(raw) {
  if (!raw || typeof raw !== "string") throw new Error("FP_PEPPER missing");
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return b64urlDecode(trimmed);
}

async function hmacSha256Hex(pepperBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    pepperBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, te.encode(message));
  return toHex(mac);
}

function randomCrockford(n) {
  const out = new Array(n);
  const buf = crypto.getRandomValues(new Uint8Array(n));
  for (let i = 0; i < n; i++) out[i] = CROCKFORD[buf[i] & 31];
  return out.join("");
}

function newId(prefix) {
  return prefix + randomCrockford(16);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Key format: CC-XXXXX-XXXXX-XXXXX-XXXXX
// ---------------------------------------------------------------------------

async function checkChar(nineteen) {
  const hash = await sha256Bytes(nineteen);
  return CROCKFORD[hash[0] % 32];
}

export async function generateKeyString() {
  const nineteen = randomCrockford(19);
  const body = nineteen + (await checkChar(nineteen));
  return `CC-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}`;
}

/**
 * Normalize a user-supplied key. Returns { key, hint } or { error }.
 * error is "prefix" | "format" | "checksum".
 */
export async function normalizeKey(input) {
  if (typeof input !== "string" || !input) return { error: "format" };
  let s = input.toUpperCase().replace(/[-\s]/g, "");
  s = s.replaceAll("O", "0").replace(/[IL]/g, "1");
  if (!s.startsWith("CC")) return { error: "prefix" };
  const body = s.slice(2);
  if (body.length !== 20) return { error: "format" };
  for (let i = 0; i < body.length; i++) {
    if (!CROCKFORD.includes(body[i])) return { error: "format" };
  }
  const expected = await checkChar(body.slice(0, 19));
  if (expected !== body[19]) return { error: "checksum" };
  const key = `CC-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}`;
  return { key, hint: body.slice(16) };
}

export async function keyHashHex(normalizedKey) {
  return sha256Hex(KEY_HASH_PREFIX + normalizedKey);
}

function keyErrorMessage(kind) {
  if (kind === "prefix") return "Key must use the CC- prefix.";
  if (kind === "checksum") return "Key checksum is invalid.";
  return "Key format is invalid.";
}

// ---------------------------------------------------------------------------
// Tokens (Ed25519 over base64url(payload) + "." + base64url(sig))
// ---------------------------------------------------------------------------

let cachedKeys = null;

function parseJwk(raw) {
  if (!raw) throw new Error("SIGNING_KEY_JWK missing");
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function loadKeys(env) {
  if (cachedKeys) return cachedKeys;
  const jwk = parseJwk(env.SIGNING_KEY_JWK);
  const pub = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  const signer = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  const verifier = await crypto.subtle.importKey("jwk", pub, { name: "Ed25519" }, false, ["verify"]);
  cachedKeys = { signer, verifier };
  return cachedKeys;
}

export function serializePayload(p) {
  return JSON.stringify({
    v: p.v,
    lic: p.lic,
    act: p.act,
    gen: p.gen,
    dev: p.dev,
    plan: p.plan,
    iat: p.iat,
    exp: p.exp,
    grace: p.grace,
    lexp: p.lexp ?? null,
    kid: p.kid,
  });
}

export function tokenTimes(iat) {
  return { iat, exp: iat + EXP_SECONDS, grace: iat + GRACE_SECONDS };
}

export async function signToken(env, claims) {
  const iat = claims.iat ?? nowSec();
  const times = tokenTimes(iat);
  const payload = {
    v: 1,
    lic: claims.lic,
    act: claims.act,
    gen: claims.gen,
    dev: claims.dev,
    plan: claims.plan,
    iat: times.iat,
    exp: times.exp,
    grace: times.grace,
    lexp: claims.lexp ?? null,
    kid: KID,
  };
  const json = serializePayload(payload);
  const first = b64urlEncode(te.encode(json));
  const { signer } = await loadKeys(env);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, signer, te.encode(first));
  return { token: `${first}.${b64urlEncode(sig)}`, payload };
}

/**
 * Verify the Ed25519 signature (and basic format / kid) only.
 * Does not consult D1 or check exp/grace/gen.
 * Returns { ok: true, payload } or { ok: false }.
 */
export async function verifyTokenSignature(env, token) {
  if (typeof token !== "string") return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false };
  let payload;
  try {
    payload = JSON.parse(td.decode(b64urlDecode(parts[0])));
  } catch {
    return { ok: false };
  }
  if (!payload || payload.v !== 1 || payload.kid !== KID) return { ok: false };
  if (typeof payload.lic !== "string" || typeof payload.act !== "string") return { ok: false };
  try {
    const { verifier } = await loadKeys(env);
    const sig = b64urlDecode(parts[1]);
    const good = await crypto.subtle.verify({ name: "Ed25519" }, verifier, sig, te.encode(parts[0]));
    if (!good) return { ok: false };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Rate limiting — exported so tests can check ordering without a live limiter
// ---------------------------------------------------------------------------

/**
 * Decide which limiter key to use for /validate (and /deactivate).
 * Signature MUST already have been checked. Forged/malformed tokens never
 * use a license id from the payload.
 */
export function licenseRouteLimiter(sigOk, licenseId, ip) {
  if (!sigOk || !licenseId) {
    return { binding: "RL_PUBLIC", key: `a:${ip}`, retryAfter: 60 };
  }
  return { binding: "RL_LICENSE", key: `l:${licenseId}`, retryAfter: 60 };
}

export function activateLimiters(ip, keyHash) {
  return [
    { binding: "RL_PUBLIC", key: `a:${ip}`, retryAfter: 60 },
    { binding: "RL_KEY", key: `k:${keyHash}`, retryAfter: 60 },
  ];
}

export function resetLimiter(keyHash) {
  return { binding: "RL_RESET", key: `k:${keyHash}`, retryAfter: 60 };
}

export function adminLimiter() {
  return { binding: "RL_ADMIN", key: "admin", retryAfter: 60 };
}

function limiterAvailable(binding) {
  return binding && typeof binding.limit === "function";
}

/**
 * Returns { success, retryAfter, enforced }.
 * enforced is false when the binding is missing or throws (typical of wrangler dev).
 */
export async function consumeLimit(binding, key, retryAfter = 60) {
  if (!limiterAvailable(binding)) {
    return { success: true, retryAfter, enforced: false };
  }
  try {
    const result = await binding.limit({ key });
    const success = result?.success !== false;
    const ra = Number.isFinite(result?.retryAfter) ? result.retryAfter : retryAfter;
    return { success, retryAfter: ra, enforced: true };
  } catch {
    return { success: true, retryAfter, enforced: false };
  }
}

async function rejectIfLimited(env, target) {
  const result = await consumeLimit(env[target.binding], target.key, target.retryAfter);
  if (!result.success) {
    return jsonError("rate_limited", "Too many requests. Try again later.", {
      retry_after: result.retryAfter,
    });
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function jsonOk(body, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...body }), { status, headers: JSON_HEADERS });
}

function jsonError(code, message, extra = {}) {
  const status = HTTP_BY_CODE[code] ?? 400;
  const headers = { ...JSON_HEADERS };
  const error = { code, message };
  if (extra.reason != null && extra.reason !== "") error.reason = extra.reason;
  if (extra.retry_after != null) {
    error.retry_after = extra.retry_after;
    headers["Retry-After"] = String(extra.retry_after);
  }
  return new Response(JSON.stringify({ ok: false, error }), { status, headers });
}

function jsonNotFound() {
  return jsonError("not_found", "Not found.");
}

function clientIp(request) {
  // Used only as an in-memory limiter key. Never written to D1 or logs.
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf.trim();
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim() || "local";
  return "local";
}

async function readJsonBody(request, { optional = false } = {}) {
  const cl = request.headers.get("Content-Length");
  if (cl !== null && cl !== "") {
    const n = Number(cl);
    if (Number.isFinite(n) && n > BODY_LIMIT) {
      return { error: jsonError("bad_request", "Request body too large.") };
    }
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > BODY_LIMIT) {
    return { error: jsonError("bad_request", "Request body too large.") };
  }
  if (buf.byteLength === 0) {
    if (optional) return { data: {} };
    return { error: jsonError("bad_request", "Request body is required.") };
  }
  try {
    const data = JSON.parse(td.decode(buf));
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { error: jsonError("bad_request", "JSON body must be an object.") };
    }
    return { data };
  } catch {
    return { error: jsonError("bad_request", "Malformed JSON.") };
  }
}

/**
 * Constant-time admin bearer check: SHA-256 both sides (equal-length digests),
 * then timing-safe compare. Missing or wrong tokens both take this path.
 */
export async function adminBearerOk(header, token) {
  const provided = header ?? "";
  const expected = "Bearer " + (token ?? "");
  const [a, b] = await Promise.all([
    sha256Bytes(provided),
    sha256Bytes(expected),
  ]);
  const equal = bytesEqual(a, b);
  if (!token || token.length < 32) return false;
  return equal;
}

async function requireAdmin(request, env) {
  const limited = await rejectIfLimited(env, adminLimiter());
  if (limited) return { error: limited };
  const ok = await adminBearerOk(request.headers.get("Authorization"), env.ADMIN_TOKEN);
  if (!ok) return { error: jsonError("unauthorized", "Unauthorized.") };
  return { ok: true };
}

function licensePublic(row, devicesUsed) {
  return {
    id: row.id,
    plan: row.plan,
    key_hint: row.key_hint,
    expires_at: row.expires_at ?? null,
    devices_used: devicesUsed,
    max_devices: row.max_devices,
  };
}

function licenseRevokedOrExpired(row, now) {
  if (row.status === "revoked") {
    return jsonError("key_revoked", "This license was revoked.", {
      reason: row.revoke_reason || undefined,
    });
  }
  if (row.expires_at != null && row.expires_at <= now) {
    return jsonError("key_expired", "This license has expired.");
  }
  return null;
}

function parseDeviceFp(value) {
  if (typeof value !== "string") return null;
  const fp = value.trim().toLowerCase();
  if (!DEVICE_FP_RE.test(fp)) return null;
  return fp;
}

function optionalLabel(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  if (value.length > 32) return undefined;
  return value;
}

function optionalVersion(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  if (value.length > 64) return undefined;
  return value;
}

// ---------------------------------------------------------------------------
// D1 helpers
// ---------------------------------------------------------------------------

async function audit(db, licenseId, action, detail) {
  const text = detail == null ? null : typeof detail === "string" ? detail : JSON.stringify(detail);
  await db
    .prepare("INSERT INTO audit (at, license_id, action, detail) VALUES (?, ?, ?, ?)")
    .bind(nowSec(), licenseId ?? null, action, text)
    .run();
}

async function countActive(db, licenseId) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM activations WHERE license_id = ? AND status = 'active'")
    .bind(licenseId)
    .first();
  return row?.n ?? 0;
}

async function getLicenseById(db, id) {
  return db.prepare("SELECT * FROM licenses WHERE id = ?").bind(id).first();
}

async function getLicenseByHash(db, hash) {
  return db.prepare("SELECT * FROM licenses WHERE key_hash = ?").bind(hash).first();
}

async function getActivation(db, licenseId, deviceHmac) {
  return db
    .prepare("SELECT * FROM activations WHERE license_id = ? AND device_hmac = ?")
    .bind(licenseId, deviceHmac)
    .first();
}

async function getActivationById(db, id) {
  return db.prepare("SELECT * FROM activations WHERE id = ?").bind(id).first();
}

async function dummySign(env) {
  // Equalize key_not_found timing with a successful activate (which signs a token).
  try {
    await signToken(env, {
      lic: "lic_0000000000000000",
      act: "act_0000000000000000",
      gen: 0,
      dev: "0".repeat(32),
      plan: "standard",
      lexp: null,
    });
  } catch {
    /* ignore */
  }
}

function devicePrefix(hmac) {
  return typeof hmac === "string" ? hmac.slice(0, 32) : "";
}

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

async function handleActivate(request, env) {
  const ip = clientIp(request);
  const body = await readJsonBody(request);
  if (body.error) return body.error;

  const norm = await normalizeKey(body.data.key);
  if (norm.error) return jsonError("bad_request", keyErrorMessage(norm.error));

  const hash = await keyHashHex(norm.key);
  for (const t of activateLimiters(ip, hash)) {
    const limited = await rejectIfLimited(env, t);
    if (limited) return limited;
  }

  const fp = parseDeviceFp(body.data.device_fp);
  if (!fp) return jsonError("bad_request", "device_fp must be 64 hex characters.");
  const label = optionalLabel(body.data.device_label);
  if (label === undefined) return jsonError("bad_request", "device_label must be at most 32 characters.");
  const version = optionalVersion(body.data.client_version);
  if (version === undefined) return jsonError("bad_request", "client_version must be at most 64 characters.");

  const pepper = parsePepper(env.FP_PEPPER);
  const deviceHmac = await hmacSha256Hex(pepper, fp);
  const now = nowSec();

  const license = await getLicenseByHash(env.LICENSE_DB, hash);
  if (!license) {
    await dummySign(env);
    return jsonError("key_not_found", "No license found for that key.");
  }
  const blocked = licenseRevokedOrExpired(license, now);
  if (blocked) return blocked;

  const existing = await getActivation(env.LICENSE_DB, license.id, deviceHmac);
  let act;
  if (existing) {
    const nextGen = (existing.token_gen ?? 1) + 1;
    await env.LICENSE_DB.prepare(
      `UPDATE activations
          SET status = 'active', token_gen = ?, last_seen_at = ?,
              client_version = ?, device_label = COALESCE(?, device_label)
        WHERE id = ?`,
    )
      .bind(nextGen, now, version, label, existing.id)
      .run();
    act = { ...existing, status: "active", token_gen: nextGen, last_seen_at: now };
  } else {
    const used = await countActive(env.LICENSE_DB, license.id);
    if (used >= license.max_devices) {
      return jsonError("device_limit", "This key is already active on another device.");
    }
    const id = newId("act_");
    try {
      await env.LICENSE_DB.prepare(
        `INSERT INTO activations
           (id, license_id, device_hmac, device_label, client_version, created_at, last_seen_at, token_gen, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
      )
        .bind(id, license.id, deviceHmac, label, version, now, now)
        .run();
    } catch (err) {
      const used2 = await countActive(env.LICENSE_DB, license.id);
      if (used2 >= license.max_devices) {
        return jsonError("device_limit", "This key is already active on another device.");
      }
      throw err;
    }
    act = { id, token_gen: 1 };
  }

  const signed = await signToken(env, {
    lic: license.id,
    act: act.id,
    gen: act.token_gen,
    dev: devicePrefix(deviceHmac),
    plan: license.plan,
    lexp: license.expires_at ?? null,
  });
  const used = await countActive(env.LICENSE_DB, license.id);
  await audit(env.LICENSE_DB, license.id, "activate", { act: act.id, gen: act.token_gen });
  return jsonOk({
    token: signed.token,
    license: licensePublic(license, used),
    heartbeat_seconds: HEARTBEAT_SECONDS,
  });
}

async function verifyThenLimit(request, env, token) {
  const ip = clientIp(request);
  const verified = await verifyTokenSignature(env, token);
  const target = licenseRouteLimiter(verified.ok, verified.ok ? verified.payload.lic : null, ip);
  const limited = await rejectIfLimited(env, target);
  if (limited) return { error: limited };
  if (!verified.ok) return { error: jsonError("token_invalid", "Token is invalid.") };
  return { payload: verified.payload };
}

async function loadValidSession(env, payload, deviceFp) {
  const now = nowSec();
  const license = await getLicenseById(env.LICENSE_DB, payload.lic);
  if (!license) return { error: jsonError("token_invalid", "Token is invalid.") };
  const blocked = licenseRevokedOrExpired(license, now);
  if (blocked) return { error: blocked };

  const fp = parseDeviceFp(deviceFp);
  if (!fp) return { error: jsonError("bad_request", "device_fp must be 64 hex characters.") };
  const deviceHmac = await hmacSha256Hex(parsePepper(env.FP_PEPPER), fp);
  if (devicePrefix(deviceHmac) !== payload.dev) {
    return { error: jsonError("device_mismatch", "Token does not match this device.") };
  }

  const act = await getActivationById(env.LICENSE_DB, payload.act);
  if (!act || act.license_id !== license.id) {
    return { error: jsonError("token_invalid", "Token is invalid.") };
  }
  if (act.status !== "active") {
    return { error: jsonError("activation_released", "This device was deactivated or reset. Activate again.") };
  }
  if (act.token_gen !== payload.gen) {
    return { error: jsonError("token_invalid", "Token is invalid.") };
  }
  if (act.device_hmac !== deviceHmac) {
    return { error: jsonError("device_mismatch", "Token does not match this device.") };
  }
  // Accept up to grace, including after exp, so a returning client can refresh.
  if (typeof payload.grace !== "number" || now >= payload.grace) {
    return { error: jsonError("token_invalid", "Token is invalid.") };
  }
  return { license, act, deviceHmac, now };
}

async function handleValidate(request, env) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const gated = await verifyThenLimit(request, env, body.data.token);
  if (gated.error) return gated.error;

  const session = await loadValidSession(env, gated.payload, body.data.device_fp);
  if (session.error) return session.error;

  const version = optionalVersion(body.data.client_version);
  if (version === undefined) return jsonError("bad_request", "client_version must be at most 64 characters.");

  if (session.now - (session.act.last_seen_at ?? 0) >= LAST_SEEN_MIN_INTERVAL) {
    await env.LICENSE_DB.prepare(
      "UPDATE activations SET last_seen_at = ?, client_version = COALESCE(?, client_version) WHERE id = ?",
    )
      .bind(session.now, version, session.act.id)
      .run();
  }

  const signed = await signToken(env, {
    lic: session.license.id,
    act: session.act.id,
    gen: session.act.token_gen,
    dev: devicePrefix(session.deviceHmac),
    plan: session.license.plan,
    lexp: session.license.expires_at ?? null,
  });
  const used = await countActive(env.LICENSE_DB, session.license.id);
  return jsonOk({
    token: signed.token,
    license: licensePublic(session.license, used),
    heartbeat_seconds: HEARTBEAT_SECONDS,
  });
}

async function handleDeactivate(request, env) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const gated = await verifyThenLimit(request, env, body.data.token);
  if (gated.error) return gated.error;

  const session = await loadValidSession(env, gated.payload, body.data.device_fp);
  if (session.error) return session.error;

  await env.LICENSE_DB.prepare(
    "UPDATE activations SET status = 'released', token_gen = token_gen + 1, last_seen_at = ? WHERE id = ?",
  )
    .bind(session.now, session.act.id)
    .run();
  const used = await countActive(env.LICENSE_DB, session.license.id);
  await audit(env.LICENSE_DB, session.license.id, "deactivate", { act: session.act.id });
  return jsonOk({ devices_used: used, max_devices: session.license.max_devices });
}

async function countSelfResets(db, licenseId, since) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM audit WHERE license_id = ? AND action = 'self_reset' AND at >= ?")
    .bind(licenseId, since)
    .first();
  return row?.n ?? 0;
}

async function handleReset(request, env) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;

  const norm = await normalizeKey(body.data.key);
  if (norm.error) return jsonError("bad_request", keyErrorMessage(norm.error));
  const hash = await keyHashHex(norm.key);

  const limited = await rejectIfLimited(env, resetLimiter(hash));
  if (limited) return limited;

  const fp = parseDeviceFp(body.data.device_fp);
  if (!fp) return jsonError("bad_request", "device_fp must be 64 hex characters.");

  const now = nowSec();
  const license = await getLicenseByHash(env.LICENSE_DB, hash);
  if (!license) {
    await dummySign(env);
    return jsonError("key_not_found", "No license found for that key.");
  }
  const blocked = licenseRevokedOrExpired(license, now);
  if (blocked) return blocked;

  const usedResets = await countSelfResets(env.LICENSE_DB, license.id, now - RESET_WINDOW_SECONDS);
  if (usedResets >= RESET_MAX_PER_WINDOW) {
    return jsonError("reset_limit", "Device reset limit reached. Try again after 30 days, or ask an admin.", {
      retry_after: RESET_WINDOW_SECONDS,
    });
  }

  const deviceHmac = await hmacSha256Hex(parsePepper(env.FP_PEPPER), fp);
  const existing = await getActivation(env.LICENSE_DB, license.id, deviceHmac);
  const actId = existing?.id ?? newId("act_");
  const nextGen = (existing?.token_gen ?? 0) + 1;
  const label = optionalLabel(body.data.device_label);
  if (label === undefined) return jsonError("bad_request", "device_label must be at most 32 characters.");
  const version = optionalVersion(body.data.client_version);
  if (version === undefined) return jsonError("bad_request", "client_version must be at most 64 characters.");

  const stmts = [
    env.LICENSE_DB.prepare(
      "UPDATE activations SET status = 'released', token_gen = token_gen + 1, last_seen_at = ? WHERE license_id = ? AND status = 'active'",
    ).bind(now, license.id),
    env.LICENSE_DB.prepare("UPDATE licenses SET resets_used = resets_used + 1 WHERE id = ?").bind(license.id),
  ];
  if (existing) {
    stmts.push(
      env.LICENSE_DB.prepare(
        `UPDATE activations
            SET status = 'active', token_gen = ?, last_seen_at = ?, created_at = ?,
                client_version = ?, device_label = COALESCE(?, device_label)
          WHERE id = ?`,
      ).bind(nextGen, now, now, version, label, existing.id),
    );
  } else {
    stmts.push(
      env.LICENSE_DB.prepare(
        `INSERT INTO activations
           (id, license_id, device_hmac, device_label, client_version, created_at, last_seen_at, token_gen, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      ).bind(actId, license.id, deviceHmac, label, version, now, now, nextGen),
    );
  }
  stmts.push(
    env.LICENSE_DB.prepare(
      "INSERT INTO audit (at, license_id, action, detail) VALUES (?, ?, 'self_reset', ?)",
    ).bind(now, license.id, JSON.stringify({ act: actId })),
  );
  await env.LICENSE_DB.batch(stmts);

  const signed = await signToken(env, {
    lic: license.id,
    act: actId,
    gen: nextGen,
    dev: devicePrefix(deviceHmac),
    plan: license.plan,
    lexp: license.expires_at ?? null,
  });
  const used = await countActive(env.LICENSE_DB, license.id);
  return jsonOk({
    token: signed.token,
    license: licensePublic({ ...license, resets_used: license.resets_used + 1 }, used),
    heartbeat_seconds: HEARTBEAT_SECONDS,
  });
}

// ---------------------------------------------------------------------------
// Admin handlers
// ---------------------------------------------------------------------------

async function handleIssue(request, env) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const count = body.data.count == null ? 1 : body.data.count;
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    return jsonError("bad_request", "count must be an integer from 1 to 100.");
  }
  const plan = body.data.plan == null || body.data.plan === "" ? "standard" : body.data.plan;
  if (typeof plan !== "string" || plan.length > 32) {
    return jsonError("bad_request", "plan is invalid.");
  }
  const maxDevices = body.data.max_devices == null ? 1 : body.data.max_devices;
  if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 20) {
    return jsonError("bad_request", "max_devices must be an integer from 1 to 20.");
  }
  let expiresAt = body.data.expires_at ?? null;
  if (expiresAt != null) {
    if (!Number.isInteger(expiresAt) || expiresAt <= 0) {
      return jsonError("bad_request", "expires_at must be unix seconds or null.");
    }
  }
  const note = body.data.note == null ? null : body.data.note;
  if (note != null && (typeof note !== "string" || note.length > 512)) {
    return jsonError("bad_request", "note must be at most 512 characters.");
  }

  const now = nowSec();
  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = await generateKeyString();
    const id = newId("lic_");
    const hash = await keyHashHex(key);
    const hint = (await normalizeKey(key)).hint;
    await env.LICENSE_DB.prepare(
      `INSERT INTO licenses
         (id, key_hash, key_hint, plan, max_devices, status, expires_at, note, created_at, resets_used)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 0)`,
    )
      .bind(id, hash, hint, plan, maxDevices, expiresAt, note, now)
      .run();
    await audit(env.LICENSE_DB, id, "issue", { plan, max_devices: maxDevices });
    keys.push({ id, key, key_hint: hint });
  }
  return jsonOk({ keys });
}

async function handleRevoke(request, env, id) {
  const body = await readJsonBody(request, { optional: true });
  if (body.error) return body.error;
  const reason = body.data.reason == null ? null : body.data.reason;
  if (reason != null && (typeof reason !== "string" || reason.length > 256)) {
    return jsonError("bad_request", "reason must be at most 256 characters.");
  }
  const license = await getLicenseById(env.LICENSE_DB, id);
  if (!license) return jsonError("key_not_found", "No license found.");
  const now = nowSec();
  await env.LICENSE_DB.batch([
    env.LICENSE_DB.prepare(
      "UPDATE licenses SET status = 'revoked', revoke_reason = ?, revoked_at = ? WHERE id = ?",
    ).bind(reason, now, id),
    env.LICENSE_DB.prepare("UPDATE activations SET token_gen = token_gen + 1 WHERE license_id = ?").bind(id),
    env.LICENSE_DB.prepare(
      "INSERT INTO audit (at, license_id, action, detail) VALUES (?, ?, 'revoke', ?)",
    ).bind(now, id, JSON.stringify({ reason })),
  ]);
  return jsonOk({ id, status: "revoked" });
}

async function handleUnrevoke(request, env, id) {
  const license = await getLicenseById(env.LICENSE_DB, id);
  if (!license) return jsonError("key_not_found", "No license found.");
  const now = nowSec();
  await env.LICENSE_DB.batch([
    env.LICENSE_DB.prepare(
      "UPDATE licenses SET status = 'active', revoke_reason = NULL, revoked_at = NULL WHERE id = ?",
    ).bind(id),
    env.LICENSE_DB.prepare(
      "INSERT INTO audit (at, license_id, action, detail) VALUES (?, ?, 'unrevoke', NULL)",
    ).bind(now, id),
  ]);
  return jsonOk({ id, status: "active" });
}

async function handleAdminReset(request, env, id) {
  const license = await getLicenseById(env.LICENSE_DB, id);
  if (!license) return jsonError("key_not_found", "No license found.");
  const now = nowSec();
  await env.LICENSE_DB.batch([
    env.LICENSE_DB.prepare(
      "UPDATE activations SET status = 'released', token_gen = token_gen + 1, last_seen_at = ? WHERE license_id = ? AND status = 'active'",
    ).bind(now, id),
    env.LICENSE_DB.prepare(
      "INSERT INTO audit (at, license_id, action, detail) VALUES (?, ?, 'admin_reset', NULL)",
    ).bind(now, id),
  ]);
  const used = await countActive(env.LICENSE_DB, id);
  return jsonOk({ id, devices_used: used, max_devices: license.max_devices });
}

async function handlePatch(request, env, id) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const license = await getLicenseById(env.LICENSE_DB, id);
  if (!license) return jsonError("key_not_found", "No license found.");

  const sets = [];
  const args = [];
  if (Object.prototype.hasOwnProperty.call(body.data, "max_devices")) {
    const md = body.data.max_devices;
    if (!Number.isInteger(md) || md < 1 || md > 20) {
      return jsonError("bad_request", "max_devices must be an integer from 1 to 20.");
    }
    sets.push("max_devices = ?");
    args.push(md);
  }
  if (Object.prototype.hasOwnProperty.call(body.data, "expires_at")) {
    const exp = body.data.expires_at;
    if (exp != null && (!Number.isInteger(exp) || exp <= 0)) {
      return jsonError("bad_request", "expires_at must be unix seconds or null.");
    }
    sets.push("expires_at = ?");
    args.push(exp);
  }
  if (Object.prototype.hasOwnProperty.call(body.data, "note")) {
    const note = body.data.note;
    if (note != null && (typeof note !== "string" || note.length > 512)) {
      return jsonError("bad_request", "note must be at most 512 characters.");
    }
    sets.push("note = ?");
    args.push(note);
  }
  if (sets.length === 0) return jsonError("bad_request", "No updatable fields provided.");
  args.push(id);
  await env.LICENSE_DB.prepare(`UPDATE licenses SET ${sets.join(", ")} WHERE id = ?`).bind(...args).run();
  await audit(env.LICENSE_DB, id, "patch", body.data);
  const updated = await getLicenseById(env.LICENSE_DB, id);
  const used = await countActive(env.LICENSE_DB, id);
  return jsonOk({ license: licensePublic(updated, used), note: updated.note });
}

async function lastSeenFor(db, licenseId) {
  const row = await db
    .prepare("SELECT MAX(last_seen_at) AS last_seen_at FROM activations WHERE license_id = ?")
    .bind(licenseId)
    .first();
  return row?.last_seen_at ?? null;
}

function listItem(row) {
  return {
    id: row.id,
    key_hint: row.key_hint,
    plan: row.plan,
    status: row.status,
    max_devices: row.max_devices,
    devices_used: row.devices_used,
    expires_at: row.expires_at ?? null,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at ?? null,
    note: row.note ?? null,
  };
}

async function handleList(url, env) {
  const status = url.searchParams.get("status");
  if (status && status !== "active" && status !== "revoked") {
    return jsonError("bad_request", "status must be active or revoked.");
  }
  let limit = 50;
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit != null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return jsonError("bad_request", "limit must be an integer from 1 to 100.");
    }
  }
  const cursor = url.searchParams.get("cursor");
  if (cursor && !LIC_ID_RE.test(cursor)) {
    return jsonError("bad_request", "cursor is invalid.");
  }

  const where = [];
  const args = [];
  if (status) {
    where.push("l.status = ?");
    args.push(status);
  }
  if (cursor) {
    const c = await getLicenseById(env.LICENSE_DB, cursor);
    if (!c) return jsonError("bad_request", "cursor is invalid.");
    where.push("(l.created_at < ? OR (l.created_at = ? AND l.id < ?))");
    args.push(c.created_at, c.created_at, c.id);
  }
  const sql = `
    SELECT l.*,
           (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.status = 'active') AS devices_used,
           (SELECT MAX(last_seen_at) FROM activations a WHERE a.license_id = l.id) AS last_seen_at
      FROM licenses l
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ?`;
  args.push(limit + 1);
  const { results } = await env.LICENSE_DB.prepare(sql).bind(...args).all();
  const rows = results ?? [];
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(listItem);
  const next_cursor = hasMore ? items[items.length - 1].id : null;
  return jsonOk({ items, next_cursor });
}

async function handleGetOne(env, id) {
  const license = await getLicenseById(env.LICENSE_DB, id);
  if (!license) return jsonError("key_not_found", "No license found.");
  const used = await countActive(env.LICENSE_DB, id);
  const { results } = await env.LICENSE_DB.prepare(
    `SELECT id, device_hmac, device_label, client_version, created_at, last_seen_at, status
       FROM activations WHERE license_id = ? ORDER BY created_at ASC`,
  )
    .bind(id)
    .all();
  const activations = (results ?? []).map((a) => ({
    id: a.id,
    device_label: a.device_label ?? null,
    client_version: a.client_version ?? null,
    created_at: a.created_at,
    last_seen_at: a.last_seen_at,
    status: a.status,
    device_hmac: typeof a.device_hmac === "string" ? a.device_hmac.slice(0, 8) : null,
  }));
  return jsonOk({
    license: {
      ...licensePublic(license, used),
      status: license.status,
      revoke_reason: license.revoke_reason ?? null,
      created_at: license.created_at,
      revoked_at: license.revoked_at ?? null,
      resets_used: license.resets_used,
      note: license.note ?? null,
      last_seen_at: await lastSeenFor(env.LICENSE_DB, id),
    },
    activations,
  });
}

async function handleAudit(url, env) {
  const licenseId = url.searchParams.get("license_id");
  if (licenseId && !LIC_ID_RE.test(licenseId)) {
    return jsonError("bad_request", "license_id is invalid.");
  }
  let limit = 50;
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit != null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return jsonError("bad_request", "limit must be an integer from 1 to 200.");
    }
  }
  let sql = "SELECT id, at, license_id, action, detail FROM audit";
  const args = [];
  if (licenseId) {
    sql += " WHERE license_id = ?";
    args.push(licenseId);
  }
  sql += " ORDER BY id DESC LIMIT ?";
  args.push(limit);
  const { results } = await env.LICENSE_DB.prepare(sql).bind(...args).all();
  return jsonOk({ items: results ?? [] });
}

async function handleLookup(request, env) {
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const norm = await normalizeKey(body.data.key);
  if (norm.error) return jsonError("bad_request", keyErrorMessage(norm.error));
  const hash = await keyHashHex(norm.key);
  const license = await getLicenseByHash(env.LICENSE_DB, hash);
  if (!license) return jsonError("key_not_found", "No license found for that key.");
  return handleGetOne(env, license.id);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

async function handleApi(request, env, path) {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  const admin = path.startsWith(API_BASE + "/admin/");
  let gate = null;
  if (admin) {
    gate = await requireAdmin(request, env);
    if (gate.error) return gate.error;
  }

  if (path === API_BASE + "/activate") {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return handleActivate(request, env);
  }
  if (path === API_BASE + "/validate") {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return handleValidate(request, env);
  }
  if (path === API_BASE + "/deactivate") {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return handleDeactivate(request, env);
  }
  if (path === API_BASE + "/reset") {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return handleReset(request, env);
  }

  if (path === API_BASE + "/admin/keys") {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return handleIssue(request, env);
  }
  if (path === API_BASE + "/admin/lookup") {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return handleLookup(request, env);
  }
  if (path === API_BASE + "/admin/licenses") {
    if (method !== "GET") return jsonError("bad_request", "Method not allowed.");
    return handleList(url, env);
  }
  if (path === API_BASE + "/admin/audit") {
    if (method !== "GET") return jsonError("bad_request", "Method not allowed.");
    return handleAudit(url, env);
  }

  const licReset = path.match(new RegExp(`^${API_BASE}/admin/licenses/(lic_[0-9A-HJKMNP-TV-Z]{16})/reset$`));
  if (licReset) {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return handleAdminReset(request, env, licReset[1]);
  }
  const licRevoke = path.match(new RegExp(`^${API_BASE}/admin/licenses/(lic_[0-9A-HJKMNP-TV-Z]{16})/revoke$`));
  if (licRevoke) {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return handleRevoke(request, env, licRevoke[1]);
  }
  const licUnrevoke = path.match(new RegExp(`^${API_BASE}/admin/licenses/(lic_[0-9A-HJKMNP-TV-Z]{16})/unrevoke$`));
  if (licUnrevoke) {
    if (method !== "POST") return jsonError("bad_request", "Method not allowed.");
    return handleUnrevoke(request, env, licUnrevoke[1]);
  }
  const licOne = path.match(new RegExp(`^${API_BASE}/admin/licenses/(lic_[0-9A-HJKMNP-TV-Z]{16})$`));
  if (licOne) {
    if (method === "GET") return handleGetOne(env, licOne[1]);
    if (method === "PATCH") return handlePatch(request, env, licOne[1]);
    return jsonError("bad_request", "Method not allowed.");
  }

  return jsonNotFound();
}

function hostOf(url) {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

function underPrefix(path, prefix) {
  return path === prefix || path.startsWith(prefix + "/");
}

// Answer exactly like an unknown path on the static site (GET/HEAD -> the
// site's 404 page with a 404, other methods -> whatever the asset server says
// for a missing file), so /api/* and /client/* don't stand out. If a file
// ever exists under one of these prefixes in site/, it is still not served.
async function siteNotFound(request, env, extraHeaders) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...(extraHeaders || {}) } });
  }
  let res = await env.ASSETS.fetch(request);
  if (res.status < 400) {
    const u = new URL(request.url);
    u.pathname = NOT_FOUND_PROBE;
    u.search = "";
    res = await env.ASSETS.fetch(new Request(u.toString(), { method: request.method, headers: request.headers }));
    if (res.status < 400) res = new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (!extraHeaders) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(extraHeaders)) out.headers.set(k, v);
  return out;
}

async function handleApiHost(request, env, path) {
  let res;
  if (underPrefix(path, "/license")) res = await handleApi(request, env, path);
  else res = jsonNotFound();
  res = new Response(res.body, res);
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const host = hostOf(url);
      const path = normalizePath(url.pathname);

      if (host === API_HOST) return await handleApiHost(request, env, path);

      // Site hosts. Note: test on the raw pathname too so /api/ and /client/ match.
      if (underPrefix(path, "/api")) return await siteNotFound(request, env);
      if (underPrefix(path, "/client")) return await siteNotFound(request, env, { "X-Robots-Tag": "noindex" });

      if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
        return new Response("Not found", { status: 404 });
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      // Do not leak internals, IPs, or secrets.
      return jsonError("server_error", "Internal server error.");
    }
  },
};
