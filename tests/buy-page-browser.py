#!/usr/bin/env python3
"""/client/buy in a real headless browser (Python Playwright + Chromium), with the store API faked.

  python3 tests/buy-page-browser.py        # needs: pip install playwright && playwright install chromium

Serves site/ on 127.0.0.1; https://api.haunted.ong/** is answered by the test (delayed, failing or normal).
At 1280 and 390 wide:
  - loading: before the config arrives, the spinner line and placeholder rows show (first paint, no blank cards),
    continue is disabled; a slow config (> 6 s) offers retry; a failed one shows why plus retry, and retry loads it
  - plan and coin agree: Bitcoin picked -> Lifetime disabled with the reason; Lifetime picked -> Bitcoin
    disabled ("not for Lifetime"); no click ever silently switches the other choice; same with Ethereum on
  - an order link shows "Loading your order…" and no plan picker
  - no sideways overflow, no console errors (apart from the deliberately failed requests)
"""
import http.server, json, re, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

SITE = Path(__file__).resolve().parent.parent / "site"
# optional: SHOTS=/dir saves screenshots of the loading, slow, failed and picker states
import os
SHOTS = os.path.join(os.environ["SHOTS"], "{name}-{v}.png") if os.environ.get("SHOTS") else None
VIEWPORTS = [("desktop", 1280, 800), ("phone", 390, 844)]
passed = failed = 0

def rec(name, ok, detail=""):
    global passed, failed
    passed += bool(ok); failed += (not ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}{' — ' + str(detail) if detail and not ok else ''}")

def serve(root):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
        def log_message(self, *a): pass
    handler = Quiet
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"

PLANS = [{"id": "30d", "label": "30 days", "usd": "7.99", "days": 30}, {"id": "90d", "label": "90 days", "usd": "22.99", "days": 90},
         {"id": "365d", "label": "365 days", "usd": "59.99", "days": 365}, {"id": "lifetime", "label": "Lifetime", "usd": "124.99", "days": None}]
def config(on):
    coins = [("solana", "usdc", "USDC (Solana)"), ("solana", "sol", "SOL"), ("bitcoin", "btc", "Bitcoin"),
             ("ethereum", "eth", "ETH (Ethereum mainnet only)"), ("ethereum", "usdc", "USDC (Ethereum mainnet only)")]
    return {"ok": True, "plans": PLANS, "support": "support@haunted.ong", "order_ttl_seconds": 900,
            "default_coin": {"chain": "solana", "asset": "usdc"} if "solana" in on else {"chain": "bitcoin", "asset": "btc"},
            "coins": [{"chain": c, "asset": a, "label": l, "auto_confirm": c in on,
                       "plans": ["30d", "90d", "365d", "lifetime"] if c == "solana" else ["30d", "90d", "365d"]} for c, a, l in coins]}

def main():
    srv, base = serve(SITE)
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        for v, w, h in VIEWPORTS:
            ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if v == "phone" else 1, is_mobile=v == "phone", has_touch=v == "phone")
            # "hold": config requests wait in `held` until the test releases them (the page keeps running)
            mode = {"hold": False, "fail": 0, "on": ["solana", "bitcoin"]}; held = []
            def api(route, request):
                cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS"}
                if request.method == "OPTIONS": return route.fulfill(status=204, headers=cors)
                if "/store/config" in request.url:
                    if mode["hold"]: return held.append((route, request))
                    if mode["fail"]:
                        mode["fail"] -= 1
                        return route.fulfill(status=503, headers={"content-type": "application/json", **cors}, body=json.dumps({"ok": False, "error": {"code": "server_error", "message": "The store is having a problem. Try again in a minute."}}))
                    return route.fulfill(status=200, headers={"content-type": "application/json", **cors}, body=json.dumps(config(mode["on"])))
                if "/store/orders/" in request.url:
                    if mode["hold"]: return held.append((route, request))
                    return route.fulfill(status=404, headers={"content-type": "application/json", **cors}, body=json.dumps({"ok": False, "error": {"code": "not_found", "message": "Not found."}}))
                return route.fulfill(status=404, headers=cors, body="{}")
            ctx.route("https://api.haunted.ong/**", api)
            p = ctx.new_page(); errs = []
            p.on("console", lambda m: errs.append(m.text) if m.type == "error" and "503" not in m.text and "404" not in m.text else None)
            p.on("pageerror", lambda e: errs.append(str(e)))
            def release():
                mode["hold"] = False
                while held: api(*held.pop(0))
            L = lambda txt: p.locator("#plans").get_by_role("button", name=re.compile("^" + re.escape(txt)))
            C = lambda txt: p.locator("#coins").get_by_role("button", name=re.compile("^" + re.escape(txt)))
            pressed = lambda sel: p.eval_on_selector_all(sel + " .choice[aria-pressed=true]", "x => x.map(e => e.querySelector('span').textContent)")

            # 1. loading state from the first paint
            mode.update(hold=True)
            p.goto(base + "/client/buy/", wait_until="commit"); p.wait_for_selector("#loadState"); p.wait_for_timeout(600)
            rec(f"{v} loading: spinner line shows before the config arrives", p.locator("#loadState").is_visible() and p.locator("#loadSpin").is_visible() and p.locator("#loadText").inner_text() == "Loading plans and prices…")
            rec(f"{v} loading: placeholder rows instead of empty cards (4 plans, 3 coins), continue disabled",
                p.locator("#plans .skeleton").count() == 4 and p.locator("#coins .skeleton").count() == 3 and p.locator("#plans .skeleton").first.is_visible() and p.locator("#create").is_disabled())
            rec(f"{v} loading: no stray Lifetime note while loading", p.locator("#coinNote").is_hidden())
            p.screenshot(path=SHOTS.format(name="loading", v=v)) if SHOTS else None
            release()
            p.wait_for_selector("#plans button.choice", timeout=10000)
            rec(f"{v} loaded: spinner gone, real plans and coins, continue enabled", p.locator("#loadState").is_hidden() and p.locator("#plans .skeleton").count() == 0 and L("30 days").count() == 1 and p.locator("#create").is_enabled())
            rec(f"{v} loaded: no sideways overflow", p.evaluate("document.documentElement.scrollWidth <= innerWidth"))

            # 2. plan and coin agree
            C("Bitcoin").click()
            rec(f"{v} Bitcoin picked: Lifetime disabled, price shown, reason under the plans",
                L("Lifetime").is_disabled() and "$124.99" in L("Lifetime").inner_text() and p.locator("#planNote").inner_text() == "Lifetime is paid with USDC (Solana) or SOL. Pick one of those to buy it.")
            L("Lifetime").click(force=True); p.wait_for_timeout(200)
            rec(f"{v} Bitcoin picked: clicking Lifetime changes nothing", pressed("#coins") == ["Bitcoin"] and pressed("#plans") == ["30 days"])
            p.screenshot(path=SHOTS.format(name="bitcoin-picked", v=v), full_page=True) if SHOTS else None
            C("USDC (Solana)").click(); L("Lifetime").click()
            rec(f"{v} Lifetime picked: Bitcoin disabled as 'not for Lifetime', note says why",
                C("Bitcoin").is_disabled() and "not for Lifetime" in C("Bitcoin").inner_text() and p.locator("#coinNote").inner_text() == "Lifetime can only be paid with USDC (Solana) or SOL." and pressed("#coins") == ["USDC (Solana)"])
            p.screenshot(path=SHOTS.format(name="lifetime-picked", v=v), full_page=True) if SHOTS else None
            C("Bitcoin").click(force=True); p.wait_for_timeout(200)
            rec(f"{v} Lifetime picked: clicking Bitcoin changes nothing", pressed("#plans") == ["Lifetime"] and pressed("#coins") == ["USDC (Solana)"])
            rec(f"{v} Ethereum (off) says 'not on yet' and is disabled", C("ETH").is_disabled() and "not on yet" in C("ETH").inner_text())
            L("90 days").click(); C("Bitcoin").click()
            rec(f"{v} back to 90 days + Bitcoin: allowed, continue enabled", pressed("#plans") == ["90 days"] and pressed("#coins") == ["Bitcoin"] and p.locator("#create").is_enabled())

            # 3. Ethereum on
            mode.update(on=["solana", "bitcoin", "ethereum"])
            p.goto(base + "/client/buy/?eth", wait_until="networkidle"); p.wait_for_selector("#plans button.choice")
            C("ETH").click()
            rec(f"{v} Ethereum on + picked: Lifetime disabled with the Solana reason", L("Lifetime").is_disabled() and "Solana" in p.locator("#planNote").inner_text())
            C("SOL").click(); L("Lifetime").click()
            rec(f"{v} Ethereum on, Lifetime picked: both Ethereum coins and Bitcoin disabled", all(C(t).is_disabled() for t in ["ETH", "USDC (Ethereum", "Bitcoin"]))

            # 4. slow config -> retry offered
            mode.update(hold=True, on=["solana", "bitcoin"])
            p.goto(base + "/client/buy/?slow", wait_until="commit"); p.wait_for_timeout(6800)
            rec(f"{v} slow config (> 6 s): says it's slow and offers retry", p.locator("#retryBtn").is_visible() and "slow" in p.locator("#loadText").inner_text())
            p.screenshot(path=SHOTS.format(name="slow", v=v)) if SHOTS else None
            release()
            p.wait_for_selector("#plans button.choice", timeout=10000)
            rec(f"{v} slow config: still loads when it arrives", p.locator("#loadState").is_hidden())

            # 5. failed config -> reason + retry, and retry works
            mode.update(fail=1)
            p.goto(base + "/client/buy/?fail", wait_until="networkidle"); p.wait_for_timeout(300)
            rec(f"{v} failed config: shows why plus retry, spinner off", p.locator("#retryBtn").is_visible() and p.locator("#loadSpin").is_hidden() and "problem" in p.locator("#loadText").inner_text())
            p.screenshot(path=SHOTS.format(name="failed", v=v)) if SHOTS else None
            p.locator("#retryBtn").click(); p.wait_for_selector("#plans button.choice", timeout=10000)
            rec(f"{v} retry: loads the plans", p.locator("#loadState").is_hidden() and L("Lifetime").count() == 1)

            # 6. order link
            mode.update(hold=True)
            p.goto(base + "/client/buy/#o=ord_0000000000000000&c=" + "x" * 43, wait_until="commit"); p.wait_for_selector("#loadState"); p.wait_for_timeout(600)
            rec(f"{v} order link: 'Loading your order…', no plan picker", p.locator("#loadText").inner_text() == "Loading your order…" and p.locator("#pick").is_hidden())
            release(); p.wait_for_timeout(800)
            rec(f"{v} order link (unknown order): loading ends with the message", p.locator("#loadState").is_hidden() and "isn't valid" in p.locator("#message").inner_text())

            rec(f"{v}: no console errors", not errs, errs[:3])
            ctx.close()
        br.close()
    srv.shutdown()
    print(f"\n{passed}/{passed + failed} buy-page checks passed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
