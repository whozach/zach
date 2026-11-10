/**
 * Unit checks for the store helpers (no wrangler needed): plan/coin matrix,
 * amounts, quotes, base58, Solana ATA derivation, token cap, BTC/ETH matching.
 * The ATA constant was cross-checked on the build box against
 * @solana/spl-token getAssociatedTokenAddressSync (not a dependency here).
 */
import {
  PLANS, coinAllowed, planExpiry, usdToUnits, formatUnits, combineQuotes, b58encode, b58decode,
  associatedTokenAddress, matchBtc, matchEth, PRICE_SOURCES, SOL_RECIPIENT, USDC_SOL_MINT, BTC_RECIPIENT, ETH_RECIPIENT,
} from "../worker/store.js";
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
check("USDC ATA of Ledger's Solana wallet", (await associatedTokenAddress(SOL_RECIPIENT, USDC_SOL_MINT)) === "3QgRp2GymVS9BGHvXPZVJJmQAE742gMohr1Mxg7MWy2V");

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

console.log(`\n${passed}/${passed + failed} store unit checks passed.`);
if (failed) process.exit(1);
