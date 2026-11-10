#!/usr/bin/env python3
"""Crypto Client buy button, in a real headless browser (Python Playwright + Chromium).

  python3 tests/buy-browser.py            # needs: pip install playwright && playwright install chromium

Serves site/ (and a temp copy with buy.enabled flipped to true) on 127.0.0.1 and checks,
at 1280 and 390 wide, with and without reduced motion:
  - enabled: false (whatever config.js says now is only used for the "as configured" run):
      no rendered main page (/, /projects/, /projects/#cryptoclient) has any href to /client;
      the button is a disabled <button aria-disabled="true"> reading "Buy · Coming soon";
      it's the last thing in the entry (after the previews and every feature category, open or closed),
      with the config's disclaimer as small grey text directly under it (also when enabled);
      Tab never lands on it, and clicking it doesn't navigate.
  - enabled: true (temp copy): it renders <a href="/client/buy/">Buy a key</a>.
Never touches the real site/ files.
"""
import functools, http.server, re, shutil, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

SITE = Path(__file__).resolve().parent.parent / "site"
PAGES = ["/", "/projects/", "/projects/#cryptoclient"]
VIEWPORTS = [("desktop", 1280, 800), ("phone", 390, 844)]
SWITCH = re.compile(r'buy: \{ enabled: (true|false),')
passed = failed = 0

def rec(name, ok, detail=""):
    global passed, failed
    passed += ok; failed += (not ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}{' — ' + detail if detail else ''}")

def serve(root):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"

def copy_with(enabled):
    tmp = Path(tempfile.mkdtemp(prefix="buy-")) / "site"
    shutil.copytree(SITE, tmp, ignore=shutil.ignore_patterns("screenshots", ".claude"))
    cfg = tmp / "config.js"
    text, n = SWITCH.subn(f"buy: {{ enabled: {'true' if enabled else 'false'},", cfg.read_text())
    assert n == 1, "config.js should have exactly one buy switch"
    cfg.write_text(text)
    return tmp

def open_entry(pg, base, path):
    pg.goto(base + path, wait_until="networkidle")
    if path == "/":
        pg.evaluate("document.getElementById('projects').scrollIntoView()")
        pg.locator(".project").first.locator(".project-toggle").click()
        pg.wait_for_timeout(400)

CLIENT_HREFS = "[...document.querySelectorAll('[href]')].map(e => e.getAttribute('href')).filter(h => /\\/client(\\b|\\/)/.test(h) || /^https?:\\/\\/[^/]+\\/client/.test(h))"

DISCLAIMER = re.search(r'disclaimer: "([^"]*)"', (SITE / "config.js").read_text()).group(1)

def check_bottom(pg, scope, tag):
    root = scope if scope.startswith("#") else f"{scope} .post-body"
    # last element (tree order) of the whole entry must sit inside the buy row
    last_in_row = pg.evaluate(f"""() => {{ const all = document.querySelectorAll('{root} *');
        return all.length > 0 && !!all[all.length - 1].closest('.cc-buy-row'); }}""")
    rec(f"{tag}: buy row is the last thing in the entry (DOM order)", last_in_row)
    note = pg.evaluate(f"""() => {{ const b = document.querySelector('{root} .cc-buy'), n = b && b.nextElementSibling;
        if (!n) return null; const cs = getComputedStyle(n);
        return {{cls: n.className, text: n.textContent, size: parseFloat(cs.fontSize), color: cs.color,
                 btnSize: parseFloat(getComputedStyle(b).fontSize), shown: n.getBoundingClientRect().height > 0}}; }}""")
    grey = False
    if note:
        m = re.match(r"rgba?\((\d+), (\d+), (\d+)", note["color"])
        grey = bool(m) and len({m.group(1), m.group(2), m.group(3)}) == 1 and 90 <= int(m.group(1)) <= 160
    rec(f"{tag}: disclaimer directly under the button, exact text", bool(note) and note["cls"] == "cc-buy-note" and note["text"] == DISCLAIMER and note["shown"], str(note))
    rec(f"{tag}: disclaimer is small (<= 12px, smaller than the button) and muted grey", bool(note) and note["size"] <= 12 and note["size"] < note["btnSize"] and grey, str(note))
    # geometry: open the last category too, then the row must start below every preview and category
    pg.evaluate(f"() => {{ const d = document.querySelectorAll('{root} details.cc-cat'); d[d.length - 1].open = true; }}")
    pg.wait_for_timeout(500)
    geo = pg.evaluate(f"""() => {{ const row = document.querySelector('{root} .cc-buy-row').getBoundingClientRect().top;
        const others = [...document.querySelectorAll('{root} .cc-shot, {root} details.cc-cat, {root} .cc-features-title')].map(e => e.getBoundingClientRect().bottom);
        return {{row, maxOther: Math.max(...others), n: others.length}}; }}""")
    rec(f"{tag}: button sits below all previews and categories (one category open)", geo["n"] >= 14 and geo["row"] >= geo["maxOther"] - 0.5, str(geo))
    pg.evaluate(f"() => document.querySelectorAll('{root} details.cc-cat').forEach(d => d.open = false)")
    pg.wait_for_timeout(300)

def run(br, base, enabled):
    for label, w, h in VIEWPORTS:
        for rm in ("no-preference", "reduce"):
            tag = f"enabled={str(enabled).lower()} {label}/{rm}"
            ctx = br.new_context(viewport={"width": w, "height": h}, reduced_motion=rm)
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
            for path in PAGES:
                open_entry(pg, base, path)
                scope = '[data-post="cryptoclient"]' if path.endswith("#cryptoclient") else ("#details-cryptoclient" if path == "/" else None)
                if scope is None:   # /projects/ list (the hidden post views are in the DOM too)
                    hrefs = pg.evaluate(CLIENT_HREFS)
                    if enabled: rec(f"{tag} {path}: only the buy link points to /client", hrefs == ["/client/buy/"], str(hrefs))
                    else: rec(f"{tag} {path}: no href to /client in the DOM", hrefs == [], str(hrefs))
                    continue
                btn = pg.locator(f"{scope} .cc-buy")
                rec(f"{tag} {path}: one buy button", btn.count() == 1, str(btn.count()))
                check_bottom(pg, scope, f"{tag} {path}")
                if not enabled:
                    hrefs = pg.evaluate(CLIENT_HREFS)
                    rec(f"{tag} {path}: no href to /client in the DOM", hrefs == [], str(hrefs))
                    info = btn.evaluate("b => ({tag: b.tagName, dis: b.disabled, aria: b.getAttribute('aria-disabled'), href: b.hasAttribute('href'), text: b.textContent.replace(/\\s+/g, ' ').trim(), tab: b.tabIndex})")
                    rec(f"{tag} {path}: disabled <button aria-disabled=true>, no href, 'Buy · Coming soon'",
                        info["tag"] == "BUTTON" and info["dis"] and info["aria"] == "true" and not info["href"] and info["text"] == "Buy · Coming soon", str(info))
                    # Tab through the page: focus must never land on the button
                    pg.evaluate("document.activeElement && document.activeElement.blur()")
                    hit = False
                    for _ in range(80):
                        pg.keyboard.press("Tab")
                        if pg.evaluate("document.activeElement && document.activeElement.classList.contains('cc-buy')"):
                            hit = True; break
                    rec(f"{tag} {path}: Tab never focuses the button", not hit)
                    before = pg.url
                    btn.click(force=True); pg.wait_for_timeout(300)
                    btn.dispatch_event("click"); pg.wait_for_timeout(300)
                    rec(f"{tag} {path}: clicking does nothing (no navigation)", pg.url == before, pg.url)
                else:
                    info = btn.evaluate("a => ({tag: a.tagName, href: a.getAttribute('href'), text: a.textContent.trim()})")
                    hrefs = pg.evaluate(CLIENT_HREFS)
                    rec(f"{tag} {path}: the buy link is the only /client href", hrefs == ["/client/buy/"], str(hrefs))
                    rec(f"{tag} {path}: renders <a href=\"/client/buy/\">Buy a key</a>",
                        info == {"tag": "A", "href": "/client/buy/", "text": "Buy a key"}, str(info))
            rec(f"{tag}: no console errors", not errs, "; ".join(errs[:3]))
            ctx.close()

def main():
    current = SWITCH.search((SITE / "config.js").read_text())
    rec("config.js has one buy switch", current is not None)
    with sync_playwright() as p:
        br = p.chromium.launch()
        for enabled in (False, True):
            root = copy_with(enabled)
            srv, base = serve(root)
            try: run(br, base, enabled)
            finally: srv.shutdown(); shutil.rmtree(root.parent, ignore_errors=True)
        br.close()
    print(f"\n{passed}/{passed + failed} buy-button checks passed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
