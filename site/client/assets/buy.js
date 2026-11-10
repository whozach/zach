/* /client/buy: pick a plan + coin, create an order, show the pay QR, poll until paid. */
(function () {
  "use strict";
  var S = window.CCStore, el = S.el;
  var $ = function (id) { return document.getElementById(id); };
  var POLL_MS = 6000;
  var state = { config: null, plan: "30d", coin: "solana:usdc", order: null, claim: null, timer: null, tick: null, renew: null };

  function showMessage(text) {
    var m = $("message");
    if (!text) { m.hidden = true; m.textContent = ""; return; }
    m.textContent = text; m.hidden = false;
  }

  function coinKey(c) { return c.chain + ":" + c.asset; }

  function renderPick() {
    var cfg = state.config;
    var plans = $("plans"), coins = $("coins");
    plans.textContent = ""; coins.textContent = "";
    cfg.plans.forEach(function (p) {
      if (state.renew && p.id === "lifetime") return; // Lifetime has no renew
      var b = el("button", { type: "button", class: "choice", "aria-pressed": String(p.id === state.plan) }, [
        el("span", { text: p.label }), el("span", { class: "price", text: "$" + p.usd }),
      ]);
      b.addEventListener("click", function () { state.plan = p.id; fixCoin(); renderPick(); });
      plans.appendChild(b);
    });
    cfg.coins.forEach(function (c) {
      var allowed = c.plans.indexOf(state.plan) >= 0;
      var b = el("button", { type: "button", class: "choice", "aria-pressed": String(coinKey(c) === state.coin) }, [
        el("span", { text: c.label }), el("span", { class: "price", text: c.auto_confirm ? "" : "not on yet" }),
      ]);
      if (!allowed) b.disabled = true;
      b.addEventListener("click", function () { state.coin = coinKey(c); renderPick(); });
      coins.appendChild(b);
    });
    $("coinNote").hidden = state.plan !== "lifetime";
    $("create").disabled = false;
  }

  function fixCoin() {
    var c = state.config.coins.filter(function (x) { return coinKey(x) === state.coin; })[0];
    if (!c || c.plans.indexOf(state.plan) < 0) state.coin = "solana:usdc";
  }

  function drawQr(text) {
    var svg = $("qr");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
    var border = 3, size = qr.size + border * 2, d = [];
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) d.push("M" + (x + border) + "," + (y + border) + "h1v1h-1z");
    }
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("shape-rendering", "crispEdges");
    var ns = "http://www.w3.org/2000/svg";
    var bg = document.createElementNS(ns, "rect");
    bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%"); bg.setAttribute("fill", "#f4f4f4");
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", d.join("")); path.setAttribute("fill", "#070707");
    svg.appendChild(bg); svg.appendChild(path);
  }

  function renderOrder(o) {
    $("pick").hidden = true; $("pay").hidden = false;
    var f = $("payFields"); f.textContent = "";
    f.appendChild(el("div", { class: "field" }, [el("span", { class: "label", text: "network" }), el("div", { text: o.network })]));
    f.appendChild(S.valueRow("send exactly (" + o.coin_label + ")", o.amount));
    f.appendChild(S.valueRow("to address", o.recipient));
    f.appendChild(el("div", { class: "field" }, [el("span", { class: "label", text: "price" }), el("div", { text: "$" + o.usd_price + " · " + o.plan + (o.renew ? " renew" : "") })]));
    $("payNote").textContent = o.chain === "ethereum"
      ? "Ethereum mainnet only. Funds sent on Base, Polygon, BNB or any other network won't be seen. If your wallet doesn't read the QR, send the exact amount above by hand."
      : o.chain === "bitcoin"
        ? "Bitcoin only, to this bc1q address. The key is issued after 2 confirmations (about 20 minutes)."
        : "Scan with a Solana wallet (Phantom, Solflare…). The key is issued once the payment is finalized.";
    $("notConfigured").hidden = !!o.auto_confirm;
    drawQr(o.payment_url);
    updateStatus(o);
  }

  function updateStatus(o) {
    var s = $("payStatus"), cd = $("countdown");
    $("startOver").hidden = !(o.status === "expired");
    $("payCard").hidden = o.status === "expired" || o.status === "seen";
    if (state.tick) clearInterval(state.tick);
    if (o.status === "pending") {
      s.textContent = "Waiting for payment";
      var draw = function () {
        var left = o.expires_at - Math.floor(Date.now() / 1000);
        cd.textContent = left > 0 ? "Amount held for " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") : "Time's up. Checking one last time…";
      };
      draw(); state.tick = setInterval(draw, 1000);
    } else if (o.status === "seen") {
      s.textContent = "Payment seen, waiting for confirmations";
      cd.textContent = "You can leave this page open or come back to this address later.";
    } else if (o.status === "expired") {
      s.textContent = "This order expired";
      cd.textContent = "No payment was seen in time. If you did send funds, keep this page's address and contact support for a manual check.";
    } else if (o.status === "paid" || o.status === "manual") {
      s.textContent = "Paid. Opening your key…";
      cd.textContent = "";
    }
  }

  function poll() {
    if (!state.order) return;
    S.api("GET", "/orders/" + encodeURIComponent(state.order.id) + "?claim=" + encodeURIComponent(state.claim)).then(function (j) {
      if (!j.ok) {
        if (j.httpStatus === 404) { showMessage("This order link isn't valid."); stopPolling(); return; }
        showMessage(S.errText(j)); return; // keep polling (rate limit / network)
      }
      showMessage(null);
      state.order = j.order;
      if (j.order.status === "paid" || j.order.status === "manual") {
        stopPolling(); updateStatus(j.order);
        location.replace("/client/dashboard/" + S.hashOf({ o: j.order.id, c: state.claim }));
        return;
      }
      if (j.order.status === "expired") { stopPolling(); }
      updateStatus(j.order);
    });
  }

  function stopPolling() { if (state.timer) clearInterval(state.timer); state.timer = null; }
  function startPolling() { stopPolling(); state.timer = setInterval(poll, POLL_MS); }

  function create() {
    var parts = state.coin.split(":");
    var body = { plan: state.plan, chain: parts[0], asset: parts[1] };
    if (state.renew) { body.renew_license_id = state.renew.lic; body.renew_token = state.renew.rt; }
    $("create").disabled = true; showMessage(null);
    S.api("POST", "/orders", body).then(function (j) {
      $("create").disabled = false;
      if (!j.ok) { showMessage(S.errText(j)); return; }
      state.order = j.order; state.claim = j.claim_secret;
      history.replaceState(null, "", location.pathname + S.hashOf({ o: j.order.id, c: j.claim_secret }));
      renderOrder(j.order); startPolling();
    });
  }

  function init() {
    var h = S.readHash();
    $("create").addEventListener("click", create);
    $("startOver").addEventListener("click", function () { history.replaceState(null, "", location.pathname); location.reload(); });
    if (h.o && h.c) {
      state.claim = h.c;
      S.api("GET", "/orders/" + encodeURIComponent(h.o) + "?claim=" + encodeURIComponent(h.c)).then(function (j) {
        if (!j.ok) { showMessage(j.httpStatus === 404 ? "This order link isn't valid." : S.errText(j)); $("pick").hidden = true; return; }
        state.order = j.order;
        if (j.order.status === "paid" || j.order.status === "manual") {
          location.replace("/client/dashboard/" + S.hashOf({ o: j.order.id, c: h.c })); return;
        }
        renderOrder(j.order);
        if (j.order.status !== "expired") startPolling();
      });
      return;
    }
    if (h.renew && h.rt) {
      state.renew = { lic: h.renew, rt: h.rt };
      var rb = $("renewBanner"); rb.textContent = "Renewing an existing key. The time you buy is added to the time it has left."; rb.hidden = false;
    }
    S.api("GET", "/config").then(function (j) {
      if (!j.ok) { showMessage(S.errText(j)); return; }
      state.config = j; fixCoin(); renderPick();
    });
  }

  init();
})();
