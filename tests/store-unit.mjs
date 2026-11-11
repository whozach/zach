/**
 * Unit checks for the store helpers (no wrangler needed): plan/coin matrix,
 * amounts, quotes, base58, Solana ATA derivation, token cap, BTC/ETH matching.
 * The ATA constant was cross-checked on the build box against
 * @solana/spl-token getAssociatedTokenAddressSync (not a dependency here).
 */
import {
  PLANS, coinAllowed, planExpiry, usdToUnits, formatUnits, combineQuotes, b58encode, b58decode,
  associatedTokenAddress, matchBtc, matchEth, PRICE_SOURCES, SOL_RECIPIENT, USDC_SOL_MINT, BTC_RECIPIENT, ETH_RECIPIENT, autoConfirm, SUPPORT,
} from "../worker/store.js";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { tokenTimes } from "../worker/index.js";

let failed = 0, passed = 0;
const check = (name, cond, detail = "") => { cond ? passed++ : failed++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

check("prices are $7.99 / $22.99 / $59.99 / $124.99", PLANS["30d"].cents === 799 && PLANS["90d"].cents === 2299 && PLANS["365d"].cents === 5999 && PLANS.lifetime.cents === 12499);
check("matrix: lifetime only on Solana", coinAllowed("lifetime", "solana", "usdc") && coinAllowed("lifetime", "solana", "sol") &&
  !coinAllowed("lifetime", "bitcoin", "btc") && !coinAllowed("lifetime", "ethereum", "eth") && !coinAllowed("lifetime", "ethereum", "usdc"));
check("matrix: 30d/90d/365d on every coin", ["30d", "90d", "365d"].every((p) => coinAllowed(p, "bitcoin", "btc") && coinAllowed(p, "ethereum", "eth") && coinAllowed(p, "ethereum", "usdc") && coinAllowed(p, "solana", "sol")));
check("matrix: unknown coin / plan refused", !coinAllowed("30d", "base", "usdc") && !coinAllowed("7d", "solana", "usdc"));
check("planExpiry", planExpiry("30d", 1000) === 1000 + 30 * 86400 && planExpiry("lifetime", 1000) === null && planExpiry("standard", 1000) === undefined);
check("usdToUnits: $7.99 at $100,000/BTC = 7990 sats", usdToUnits(799, 100000, 8, 1n) === 7990n);
check("usdToUnits: rounds UP to the granularity", usdToUnits(799, 150.15, 9, 1000n) % 1000n === 0n && usdToUnits(799, 150.15, 9, 1000n) * 15015n >= 799n * 10n ** 9n * 100n / 100n);
check("formatUnits", formatUnits("7990123", 6) === "7.990123" && formatUnits("100000000", 8) === "1" && formatUnits("2663560000000000", 18) === "0.00266356");
check("combineQuotes: 1.9% ok, 2.1% refused", combineQuotes(150, 152.85).ok && !combineQuotes(150, 153.15).ok && !combineQuotes(150, NaN).ok);
check("two price sources per volatile coin; SOL = Coinbase + Kraken", Object.values(PRICE_SOURCES).every((s) => s.length === 2) && PRICE_SOURCES.sol.map((s) => s.name).join() === "coinbase:SOL-USD,kraken:SOLUSD");
const r = crypto.getRandomValues(new Uint8Array(32)); r[0] = 0;
check("base58 round trip (leading zero kept)", Buffer.from(b58decode(b58encode(r))).equals(Buffer.from(r)) && b58encode(new Uint8Array(32)) === "11111111111111111111111111111111");
// fixed vector (the first sales wallet), so this stays a check of the derivation whatever store-settings.js says
check("USDC ATA derivation (known wallet -> known token account)", (await associatedTokenAddress("4nfyHLEDszwxTgxUAz1B5t8U5ZagXxrkg59wuwrgkMrA", USDC_SOL_MINT)) === "3QgRp2GymVS9BGHvXPZVJJmQAE742gMohr1Mxg7MWy2V");

// ---- worker/store-settings.js: Zach's answers are well-formed (a typo here loses a buyer's payment) ----
function bech32Ok(addr) {
  const CH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const s = addr.toLowerCase(), pos = s.lastIndexOf("1");
  if (addr !== s && addr !== addr.toUpperCase()) return false;
  const hrp = s.slice(0, pos), data = [...s.slice(pos + 1)].map((c) => CH.indexOf(c));
  if (hrp !== "bc" || data.length < 7 || data.includes(-1)) return false;
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31), ...data]) {
    const top = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk === 1 && data[0] === 0; // checksum OK, witness version 0 (bc1q)
}
check("sales address: Bitcoin is a valid bc1q address (bech32 checksum)", /^bc1q[02-9ac-hj-np-z]{38}([02-9ac-hj-np-z]{20})?$/.test(BTC_RECIPIENT) && bech32Ok(BTC_RECIPIENT), BTC_RECIPIENT);
check("bech32 check catches a one-character typo", !bech32Ok("bc1qnhxzzgv7wg8cfkhmuwydgrgzmfycn67cmccfsf") && bech32Ok("bc1qnhxzzgv7wg8cfkhmuwydgrgzmfycn67cmccfse"));
let solBytes = null; try { solBytes = b58decode(SOL_RECIPIENT); } catch { /* bad base58 */ }
check("sales address: Solana is a 32-byte base58 key with a USDC token account", solBytes?.length === 32 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(SOL_RECIPIENT) &&
  typeof (await associatedTokenAddress(SOL_RECIPIENT, USDC_SOL_MINT).catch(() => null)) === "string", SOL_RECIPIENT);
check("sales address: Ethereum is 0x + 40 hex (stored lowercase)", /^0x[0-9a-f]{40}$/.test(ETH_RECIPIENT), ETH_RECIPIENT);
check("support contact: a short plain string (\"\" = hidden)", typeof SUPPORT === "string" && SUPPORT.length <= 120 && !/[<>\r\n]/.test(SUPPORT), JSON.stringify(SUPPORT));

const t = tokenTimes(1000, null);
const c = tokenTimes(1000, 1000 + 7200);
const m = tokenTimes(1000, 1000 + 36000);
let threw = false; try { tokenTimes(1000, 1000); } catch (e) { threw = e.code === "key_expired"; }
check("tokenTimes: no lexp -> +6h/+24h", t.exp === 1000 + 21600 && t.grace === 1000 + 86400);
check("tokenTimes: lexp in 2h -> exp = grace = lexp", c.exp === 8200 && c.grace === 8200);
check("tokenTimes: lexp in 10h -> exp +6h, grace = lexp", m.exp === 1000 + 21600 && m.grace === 37000);
check("tokenTimes: lexp <= iat -> key_expired, nothing signed", threw);

const o = { chain: "bitcoin", expected_amount: "8142", created_at: 1000, expires_at: 1900, status: "pending" };
const tx = (vin, status, value = 8142) => ({ txid: "a".repeat(64), vin: [{ prevout: { scriptpubkey_address: vin } }], vout: [{ scriptpubkey_address: BTC_RECIPIENT, value }], status });
check("BTC: change (spends from us) ignored", matchBtc(o, { tip: 10, txs: [tx(BTC_RECIPIENT, { confirmed: true, block_height: 1, block_time: 1100 })] }, 1200) === null);
check("BTC: mempool -> seen only", matchBtc(o, { tip: 10, txs: [tx("bc1qother", { confirmed: false })] }, 1200)?.kind === "seen");
check("BTC: 1 conf seen, 2 confs paid", matchBtc(o, { tip: 10, txs: [tx("bc1qother", { confirmed: true, block_height: 10, block_time: 1100 })] }, 1200)?.kind === "seen" &&
  matchBtc(o, { tip: 11, txs: [tx("bc1qother", { confirmed: true, block_height: 10, block_time: 1100 })] }, 1200)?.kind === "paid");
check("BTC: Taproot / other address ignored", matchBtc(o, { tip: 20, txs: [{ ...tx("bc1qother", { confirmed: true, block_height: 1, block_time: 1100 }), vout: [{ scriptpubkey_address: "bc1pxyz", value: 8142 }] }] }, 1200) === null);
const e = { chain: "ethereum", asset: "usdc", expected_amount: "7990001", created_at: 1000, expires_at: 1900, status: "pending" };
const tok = (x) => ({ hash: "0x" + "b".repeat(64), blockNumber: "100", timeStamp: "1100", from: "0x" + "1".repeat(40), to: ETH_RECIPIENT, value: "7990001", contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", logIndex: "3", ...x });
check("ETH USDC: finalized -> paid with logIndex", matchEth(e, { finalized: 100, normal: [], internal: [], token: [tok({})] })?.index === 3);
check("ETH USDC: not finalized -> seen", matchEth(e, { finalized: 99, normal: [], internal: [], token: [tok({})] })?.kind === "seen");
check("ETH USDC: wrong contract / from us / late ignored", matchEth(e, { finalized: 200, normal: [], internal: [], token: [tok({ contractAddress: "0x" + "c".repeat(40) }), tok({ from: ETH_RECIPIENT }), tok({ timeStamp: "2000" })] }) === null);

// ---- which chains are on (server) ----
check("autoConfirm: no keys -> only Bitcoin", autoConfirm({}, "bitcoin") && !autoConfirm({}, "solana") && !autoConfirm({}, "ethereum"));
check("autoConfirm: HELIUS_API_KEY or SOLANA_RPC_URL -> Solana; ETHERSCAN_API_KEY -> Ethereum", autoConfirm({ HELIUS_API_KEY: "k" }, "solana") && autoConfirm({ SOLANA_RPC_URL: "https://x" }, "solana") &&
  !autoConfirm({ HELIUS_API_KEY: "k" }, "ethereum") && autoConfirm({ ETHERSCAN_API_KEY: "k" }, "ethereum") && !autoConfirm({ ETHERSCAN_API_KEY: "k" }, "solana"));

// ---- buy page pick logic (site/client/assets/store.js, run in a sandbox) ----
const win = {};
runInNewContext(readFileSync(new URL("../site/client/assets/store.js", import.meta.url), "utf8"), { window: win });
const pick = win.CCStore.pickState;
const planList = [["30d", "30 days", "7.99"], ["90d", "90 days", "22.99"], ["365d", "365 days", "59.99"], ["lifetime", "Lifetime", "124.99"]].map(([id, label, usd]) => ({ id, label, usd }));
const coinList = (on) => [["solana", "usdc", "USDC (Solana)"], ["solana", "sol", "SOL"], ["bitcoin", "btc", "Bitcoin"], ["ethereum", "eth", "ETH"], ["ethereum", "usdc", "USDC (Ethereum)"]]
  .map(([chain, asset, label]) => ({ chain, asset, label, plans: chain === "solana" ? ["30d", "90d", "365d", "lifetime"] : ["30d", "90d", "365d"], auto_confirm: on.includes(chain) }));
const cfgOff = { plans: planList, coins: coinList(["bitcoin"]), default_coin: { chain: "bitcoin", asset: "btc" } };
const p0 = pick(cfgOff, "30d", null, false);
check("page (no keys): default coin is Bitcoin, continue enabled", p0.coin === "bitcoin:btc" && p0.plan === "30d" && p0.canCreate);
check("page (no keys): Solana + Ethereum coins disabled and marked off", p0.coins.filter((c) => !c.enabled).map((c) => c.key).join() === "solana:usdc,solana:sol,ethereum:eth,ethereum:usdc" && p0.coins.filter((c) => !c.on).length === 4);
const life = p0.plans.find((p) => p.id === "lifetime");
check("page (no keys): Lifetime unavailable with note 'Lifetime needs Solana, not on yet.'", !life.available && life.note === "Lifetime needs Solana, not on yet.", life.note);
check("page (no keys): 30/90/365 available", p0.plans.filter((p) => p.available).map((p) => p.id).join() === "30d,90d,365d");
const p1 = pick(cfgOff, "lifetime", "solana:usdc", false);
check("page (no keys): a stale Lifetime / Solana pick falls back to 30d + Bitcoin", p1.plan === "30d" && p1.coin === "bitcoin:btc" && p1.canCreate);
const p2 = pick(cfgOff, "90d", "ethereum:eth", false);
check("page (no keys): clicking a disabled Ethereum coin can't select it", p2.coin === "bitcoin:btc" && p2.plan === "90d");
const cfgOn = { plans: planList, coins: coinList(["bitcoin", "solana", "ethereum"]), default_coin: { chain: "solana", asset: "usdc" } };
const p3 = pick(cfgOn, "lifetime", null, false);
check("page (keys): Lifetime available, default Solana USDC, Bitcoin/ETH disabled for Lifetime", p3.plan === "lifetime" && p3.coin === "solana:usdc" && p3.coins.filter((c) => c.enabled).map((c) => c.key).join() === "solana:usdc,solana:sol");
check("page (keys): Ethereum selectable for 30d", pick(cfgOn, "30d", "ethereum:eth", false).coin === "ethereum:eth");
check("page: renew mode hides Lifetime", !pick(cfgOff, "30d", null, true).plans.some((p) => p.id === "lifetime"));
const pNone = pick({ plans: planList, coins: coinList([]), default_coin: null }, "30d", null, false);
check("page: nothing on -> continue disabled", !pNone.canCreate && pNone.coin === null);

// ---- plan and coin always agree (Zach: "Bitcoin picked, Lifetime still selectable") ----
const cfgLive = { plans: planList, coins: coinList(["bitcoin", "solana"]), default_coin: { chain: "solana", asset: "usdc" } };
const btc = pick(cfgLive, "30d", "bitcoin:btc", false);
const lifeB = btc.plans.find((p) => p.id === "lifetime");
check("Bitcoin picked: Lifetime shown but disabled, price kept, reason up front", btc.coin === "bitcoin:btc" && btc.plan === "30d" && lifeB.available && !lifeB.enabled && lifeB.tag === "$124.99" &&
  lifeB.note === "Lifetime is paid with USDC (Solana) or SOL. Pick one of those to buy it.", lifeB.note);
check("Bitcoin picked: 30/90/365 enabled", btc.plans.filter((p) => p.enabled).map((p) => p.id).join() === "30d,90d,365d");
const lifeS = pick(cfgLive, "lifetime", "solana:usdc", false);
const btcL = lifeS.coins.find((c) => c.key === "bitcoin:btc");
check("Lifetime picked: Bitcoin disabled as 'not for Lifetime', Solana coins enabled, note says why", lifeS.plan === "lifetime" && lifeS.coin === "solana:usdc" && !btcL.enabled && btcL.tag === "not for Lifetime" &&
  lifeS.coins.filter((c) => c.enabled).map((c) => c.key).join() === "solana:usdc,solana:sol" && lifeS.coinNote === "Lifetime can only be paid with USDC (Solana) or SOL.", lifeS.coinNote);
check("Lifetime picked: Ethereum coins that are off say 'not on yet'", lifeS.coins.filter((c) => c.key.startsWith("ethereum")).every((c) => !c.enabled && c.tag === "not on yet"));
const old = pick(cfgLive, "lifetime", "bitcoin:btc", false);
check("old link (Lifetime + Bitcoin): keeps Lifetime and moves to the default Solana coin", old.plan === "lifetime" && old.coin === "solana:usdc" && old.canCreate);
check("30 days picked: no coin note (every coin that's on pays it)", pick(cfgLive, "30d", "solana:sol", false).coinNote === "");
const ethOn = pick(cfgOn, "30d", "ethereum:eth", false);
check("Ethereum on + picked: Lifetime disabled with the Solana reason", ethOn.coin === "ethereum:eth" && !ethOn.plans.find((p) => p.id === "lifetime").enabled);
const lifeAll = pick(cfgOn, "lifetime", "solana:sol", false);
check("Ethereum on, Lifetime picked: ETH, USDC (Ethereum) and Bitcoin all 'not for Lifetime'", ["ethereum:eth", "ethereum:usdc", "bitcoin:btc"].every((k) => { const c = lifeAll.coins.find((x) => x.key === k); return !c.enabled && c.tag === "not for Lifetime"; }));
// every state the page can reach: the picked coin pays the picked plan, and clicking any enabled
// button never silently changes the other choice
let sweepOk = true, sweepDetail = "";
for (const cfg of [cfgOff, cfgLive, cfgOn]) for (const renew of [false, true]) for (const p0 of ["30d", "90d", "365d", "lifetime", null]) for (const c0 of [null, ...cfg.coins.map((c) => c.chain + ":" + c.asset)]) {
  const s = pick(cfg, p0, c0, renew);
  const cc = cfg.coins.find((c) => c.chain + ":" + c.asset === s.coin);
  if (s.canCreate && !(cc && cc.auto_confirm && cc.plans.includes(s.plan))) { sweepOk = false; sweepDetail = `state ${s.plan}/${s.coin}`; }
  for (const p of s.plans.filter((x) => x.enabled)) { const t = pick(cfg, p.id, s.coin, renew); if (t.coin !== s.coin || t.plan !== p.id) { sweepOk = false; sweepDetail = `plan click ${p.id} moved coin ${s.coin} -> ${t.coin}`; } }
  for (const c of s.coins.filter((x) => x.enabled)) { const t = pick(cfg, s.plan, c.key, renew); if (t.plan !== s.plan || t.coin !== c.key) { sweepOk = false; sweepDetail = `coin click ${c.key} moved plan ${s.plan} -> ${t.plan}`; } }
  for (const p of s.plans.filter((x) => !x.enabled)) if (!p.note) { sweepOk = false; sweepDetail = `disabled ${p.id} has no reason`; }
}
check("every reachable state agrees, and no enabled click silently switches plan or coin", sweepOk, sweepDetail);

console.log(`\n${passed}/${passed + failed} store unit checks passed.`);
if (failed) process.exit(1);
