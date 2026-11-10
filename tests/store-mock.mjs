/**
 * Local mock of every upstream the store calls (Coinbase, Kraken, mempool.space,
 * Etherscan V2, Solana RPC). The Worker only reroutes to this when the
 * STORE_MOCK_UPSTREAM var is an http://127.0.0.1:<port> URL (tests only).
 * Requests arrive as /<original host>/<path>?<query>.
 */
import http from "node:http";

export function createMock() {
  const state = {
    log: [],
    prices: { coinbase: { "BTC-USD": "100000.00", "ETH-USD": "3000.00", "SOL-USD": "150.00" }, kraken: { SOLUSD: "150.30" }, mempoolUSD: 100100, ethusd: "3001.0" },
    fail: {},             // { coinbase: true, kraken: "error"|"http", mempool: true, etherscanPrice: true }
    sol: { sigs: {}, txs: {} },       // sigs[ref] = [{signature, confirmationStatus, err}], txs[sig] = { confirmed, finalized }
    btc: { tip: 900000, txs: [] },
    eth: { finalized: 20000000, chains: { 1: { txlist: [], txlistinternal: [], tokentx: [] }, 8453: { txlist: [], txlistinternal: [], tokentx: [] } } },
  };
  const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(typeof obj === "string" ? obj : JSON.stringify(obj)); };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      const [, host, ...rest] = u.pathname.split("/");
      const path = "/" + rest.join("/");
      const entry = { host, path, query: Object.fromEntries(u.searchParams), body: body ? JSON.parse(body) : null };
      state.log.push(entry);
      if (host === "api.coinbase.com") {
        const m = path.match(/^\/v2\/prices\/([A-Z]+-USD)\/spot$/);
        if (!m || state.fail.coinbase) return send(res, 500, { errors: [{ id: "internal" }] });
        return send(res, 200, { data: { amount: state.prices.coinbase[m[1]], base: m[1].split("-")[0], currency: "USD" } });
      }
      if (host === "api.kraken.com" && path === "/0/public/Ticker") {
        if (state.fail.kraken === "http") return send(res, 502, "bad gateway");
        if (state.fail.kraken === "error") return send(res, 200, { error: ["EGeneral:Too many requests"] });
        const pair = u.searchParams.get("pair");
        const p = state.prices.kraken[pair];
        if (!p) return send(res, 200, { error: ["EQuery:Unknown asset pair"] });
        return send(res, 200, { error: [], result: { [pair]: { a: [p, "1", "1.0"], b: [p, "1", "1.0"], c: [p, "0.5"], v: ["1", "1"] } } });
      }
      if (host === "mempool.space") {
        if (path === "/api/v1/prices") return state.fail.mempool ? send(res, 500, "x") : send(res, 200, { time: 1, USD: state.prices.mempoolUSD, EUR: 1 });
        if (path === "/api/blocks/tip/height") return send(res, 200, String(state.btc.tip));
        if (/^\/api\/address\/[a-z0-9]+\/txs$/.test(path)) return send(res, 200, state.btc.txs);
        return send(res, 404, "not found");
      }
      if (host === "api.etherscan.io" && path === "/v2/api") {
        const q = entry.query;
        if (!q.apikey) return send(res, 200, { status: "0", message: "NOTOK", result: "Missing/Invalid API Key" });
        if (q.module === "stats" && q.action === "ethprice") {
          if (state.fail.etherscanPrice) return send(res, 200, { status: "0", message: "NOTOK", result: "rate limit" });
          return send(res, 200, { status: "1", message: "OK", result: { ethusd: state.prices.ethusd, ethbtc: "0.03" } });
        }
        if (q.module === "proxy" && q.action === "eth_getBlockByNumber" && q.tag === "finalized") {
          return send(res, 200, { jsonrpc: "2.0", id: 1, result: { number: "0x" + state.eth.finalized.toString(16) } });
        }
        if (q.module === "account") {
          const ds = state.eth.chains[q.chainid];
          const list = ds ? ds[q.action] : null;
          if (!list) return send(res, 200, { status: "0", message: "NOTOK", result: "Invalid chain" });
          // tokentx deliberately ignores contractaddress, so the Worker's own contract check is what's tested
          if (!list.length) return send(res, 200, { status: "0", message: "No transactions found", result: [] });
          return send(res, 200, { status: "1", message: "OK", result: list });
        }
        return send(res, 200, { status: "0", message: "NOTOK", result: "unknown" });
      }
      if (host === "mainnet.helius-rpc.com") {
        const { method, params, id } = entry.body || {};
        if (method === "getSignaturesForAddress") return send(res, 200, { jsonrpc: "2.0", id, result: state.sol.sigs[params[0]] || [] });
        if (method === "getTransaction") {
          const t = state.sol.txs[params[0]];
          const c = params[1]?.commitment;
          return send(res, 200, { jsonrpc: "2.0", id, result: t ? (c === "finalized" ? t.finalized ?? null : t.confirmed ?? t.finalized ?? null) : null });
        }
        return send(res, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "no" } });
      }
      send(res, 404, { mock: "unknown host " + host });
    });
  });
  return {
    state,
    listen: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise((r) => server.close(r)),
  };
}
