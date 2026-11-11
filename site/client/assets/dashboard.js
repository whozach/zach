/* /client/dashboard: plan, key, time left, renew. No wallet, no QR, no payment address. */
(function () {
  "use strict";
  var S = window.CCStore;
  var $ = function (id) { return document.getElementById(id); };
  var state = { o: null, c: null };

  function showMessage(text) {
    var m = $("message");
    if (!text) { m.hidden = true; return; }
    m.textContent = text; m.hidden = false;
  }

  function render(j) {
    $("info").hidden = false;
    if (!j.license) {
      $("dlCard").hidden = true;
      $("waitCard").hidden = false;
      $("waitText").textContent = j.order && j.order.status === "expired" ? "This order expired before a payment was seen." : "Payment not confirmed yet.";
      $("backToBuy").href = "/client/buy/" + S.hashOf({ o: state.o, c: state.c });
      return;
    }
    $("waitCard").hidden = true;
    // the client download and install steps show once there's a license (paid or entered by key)
    $("dlCard").hidden = false;
    var L = j.license;
    if (j.key) {
      $("keyCard").hidden = false;
      var f = $("keyField"); f.textContent = "";
      f.appendChild(S.valueRow("CC- key", j.key));
      $("keyNote").textContent = "Copy it somewhere safe. It's shown here until " + S.fmtDate(j.key_available_until) + ", or until you press \u201cI've copied it\u201d. After that only the last 4 characters are shown.";
    } else {
      $("keyCard").hidden = true;
    }
    $("licCard").hidden = false;
    $("fPlan").textContent = L.lifetime ? "Lifetime" : L.plan;
    $("fHint").textContent = "CC-\u2026" + L.key_hint;
    $("fExp").textContent = L.lifetime ? "Lifetime" : S.fmtDate(L.expires_at);
    $("fLeft").textContent = L.lifetime ? "no expiry" : S.fmtLeft(L.seconds_left);
    $("fStatus").textContent = L.status;
    if (j.renew_token && !L.lifetime) {
      $("renewBtn").href = "/client/buy/" + S.hashOf({ renew: L.id, rt: j.renew_token });
      $("renewBtn").hidden = false; $("renewNote").hidden = false;
    } else { $("renewBtn").hidden = true; $("renewNote").hidden = true; }
  }

  function byClaim() {
    S.api("POST", "/license", { order_id: state.o, claim: state.c }).then(function (j) {
      if (!j.ok) { showMessage(j.httpStatus === 404 ? "This link isn't valid." : S.errText(j)); $("lookup").hidden = false; return; }
      showMessage(null); render(j);
    });
  }

  function byKey() {
    var key = $("keyInput").value.trim();
    if (!key) return;
    $("lookupBtn").disabled = true;
    S.api("POST", "/license", { key: key }).then(function (j) {
      $("lookupBtn").disabled = false;
      if (!j.ok) { showMessage(S.errText(j)); return; }
      showMessage(null); $("lookup").hidden = true; $("keyCard").hidden = true; render(j);
    });
  }

  function ack() {
    S.api("POST", "/orders/" + encodeURIComponent(state.o) + "/ack", { claim: state.c }).then(function (j) {
      if (j.ok) { $("keyCard").hidden = true; }
      else showMessage(S.errText(j));
    });
  }

  function init() {
    var h = S.readHash();
    $("lookupBtn").addEventListener("click", byKey);
    $("keyInput").addEventListener("keydown", function (e) { if (e.key === "Enter") byKey(); });
    $("ackBtn").addEventListener("click", ack);
    if (h.o && h.c) { state.o = h.o; state.c = h.c; byClaim(); }
    else $("lookup").hidden = false;
  }

  init();
})();
