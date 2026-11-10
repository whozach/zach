/* Shared helpers for the Crypto Client store pages. No third-party code. */
(function () {
  "use strict";
  var API = "https://api.haunted.ong/license/v1/store";

  function api(method, path, body) {
    var init = { method: method, headers: {}, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" };
    if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: { code: "bad_response", message: "Unexpected answer from the store." } }; })
        .then(function (j) { j.httpStatus = res.status; return j; });
    }, function () {
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

  window.CCStore = { api: api, readHash: readHash, hashOf: hashOf, el: el, copyButton: copyButton, valueRow: valueRow, fmtDate: fmtDate, fmtLeft: fmtLeft, errText: errText };
})();
