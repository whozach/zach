/* Shared helpers for the Crypto Client store pages. No third-party code. */
(function () {
  "use strict";
  var API = "https://api.haunted.ong/license/v1/store";

  // timeoutMs (optional): give up after that long and answer { ok: false, error.code: "timeout" }
  function api(method, path, body, timeoutMs) {
    var init = { method: method, headers: {}, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" };
    if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    var ctl = timeoutMs && typeof AbortController === "function" ? new AbortController() : null, timer = null;
    if (ctl) { init.signal = ctl.signal; timer = setTimeout(function () { ctl.abort(); }, timeoutMs); }
    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: { code: "bad_response", message: "Unexpected answer from the store." } }; })
        .then(function (j) { clearTimeout(timer); j.httpStatus = res.status; return j; });
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") return { ok: false, error: { code: "timeout", message: "The store didn't answer in time. Try again." } };
      return { ok: false, error: { code: "network", message: "Can't reach the store. Check your connection and try again." } };
    });
  }

  // The claim secret lives in the URL fragment (#...), which browsers never send to a server.
  function readHash() {
    var out = {};
    var h = location.hash.replace(/^#/, "");
    if (!h) return out;
    h.split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return out;
  }

  function hashOf(obj) {
    return "#" + Object.keys(obj).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&");
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }

  function copyButton(getText) {
    var b = el("button", { type: "button", class: "copy", text: "copy" });
    b.addEventListener("click", function () {
      var t = getText();
      var done = function () { b.textContent = "copied"; setTimeout(function () { b.textContent = "copy"; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { b.textContent = "select it"; });
      else b.textContent = "select it";
    });
    return b;
  }

  function valueRow(label, value) {
    return el("div", { class: "field" }, [
      el("span", { class: "label", text: label }),
      el("div", { class: "value-row" }, [el("div", { class: "mono", text: value }), copyButton(function () { return value; })]),
    ]);
  }

  function fmtDate(unix) {
    try { return new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return new Date(unix * 1000).toISOString(); }
  }

  function fmtLeft(seconds) {
    if (seconds <= 0) return "expired";
    var d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  function errText(j) {
    return (j && j.error && j.error.message) || "Something went wrong. Try again.";
  }

  // What the buy page may offer, from /store/config. A coin is only offered when the store
  // checks its payments automatically (auto_confirm). Plan and coin always agree, decided only
  // from the plans each coin lists: a plan the picked coin can't pay is disabled (with the reason),
  // and a coin that can't pay the picked plan is disabled ("not for Lifetime"). Nothing is
  // selectable that the next click would refuse.
  var CHAIN_NAMES = { solana: "Solana", ethereum: "Ethereum", bitcoin: "Bitcoin" };
  function pickState(cfg, plan, coin, renew) {
    var keyOf = function (c) { return c.chain + ":" + c.asset; };
    var takes = function (c, pid) { return !!c && (c.plans || []).indexOf(pid) >= 0; };
    var on = cfg.coins.filter(function (c) { return c.auto_confirm === true; });
    var onKey = function (k) { return on.filter(function (c) { return keyOf(c) === k; })[0] || null; };
    var defs = cfg.plans.filter(function (p) { return !(renew && p.id === "lifetime"); });
    var avail = function (p) { return on.some(function (c) { return takes(c, p.id); }); };
    var payers = function (pid) { return on.filter(function (c) { return takes(c, pid); }); };
    var or = function (list) { return list.length < 3 ? list.join(" or ") : list.slice(0, -1).join(", ") + " or " + list[list.length - 1]; };

    // coin: the one asked for if it's on, else the store's default, else the first one that's on
    var dflt = cfg.default_coin ? onKey(keyOf(cfg.default_coin)) : null;
    var selCoin = (coin && onKey(coin)) || dflt || on[0] || null;
    // plan: the one asked for if some coin pays it. If the coin can't (an old link), keep the plan
    // and move to a coin that pays it, the default one first.
    var want = defs.filter(function (p) { return p.id === plan && avail(p); })[0] || null;
    if (want && !takes(selCoin, want.id)) selCoin = (takes(dflt, want.id) && dflt) || payers(want.id)[0];
    var planId = want ? want.id : ((defs.filter(function (p) { return avail(p) && takes(selCoin, p.id); })[0] || {}).id || null);
    var planLabel = (defs.filter(function (p) { return p.id === planId; })[0] || {}).label || "";

    var plans = defs.map(function (p) {
      var a = avail(p), enabled = a && takes(selCoin, p.id), note = "";
      if (!a) {
        var chains = [];
        cfg.coins.forEach(function (c) { var n = CHAIN_NAMES[c.chain] || c.chain; if (takes(c, p.id) && chains.indexOf(n) < 0) chains.push(n); });
        note = p.label + " needs " + (chains.join(" or ") || "a coin") + ", not on yet.";
      } else if (!enabled) {
        note = p.label + " is paid with " + or(payers(p.id).map(function (c) { return c.label; })) + ". Pick one of those to buy it.";
      }
      return { id: p.id, label: p.label, usd: p.usd, available: a, enabled: enabled, tag: a ? "$" + p.usd : "not on yet", note: note };
    });
    var coins = cfg.coins.map(function (c) {
      var isOn = c.auto_confirm === true, enabled = isOn && !!planId && takes(c, planId);
      return { key: keyOf(c), label: c.label, on: isOn, enabled: enabled, tag: !isOn ? "not on yet" : (!enabled && planId ? "not for " + planLabel : "") };
    });
    var shut = on.filter(function (c) { return planId && !takes(c, planId); });
    var coinNote = shut.length ? planLabel + " can only be paid with " + or(payers(planId).map(function (c) { return c.label; })) + "." : "";
    var selKey = selCoin && planId && takes(selCoin, planId) ? keyOf(selCoin) : null;
    return { plans: plans, coins: coins, plan: planId, coin: selKey, coinNote: coinNote, canCreate: !!(planId && selKey) };
  }

  window.CCStore = { api: api, readHash: readHash, hashOf: hashOf, el: el, copyButton: copyButton, valueRow: valueRow, fmtDate: fmtDate, fmtLeft: fmtLeft, errText: errText, pickState: pickState };
})();
