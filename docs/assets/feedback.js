// 逐条反馈：日报里每一条内容后面都有「这条加重 / 这条减轻」。
// 直接调用 Cloudflare Pages 后端，无需登录 GitHub。
// 依赖 docs/assets/feedback-config.js 提供的 window.FEEDBACK_CONFIG.apiUrl。
(function () {
  "use strict";

  var rows = document.querySelectorAll(".item-fb");
  if (!rows.length) return;

  var API_URL = (window.FEEDBACK_CONFIG && window.FEEDBACK_CONFIG.apiUrl) || "";
  var KEY_STORAGE = "wb-feedback-key";

  var modal = document.getElementById("key-modal");
  var modalInput = document.getElementById("key-input");
  var modalForm = document.getElementById("key-form");
  var modalCancel = document.getElementById("key-cancel");

  function rowStatus(row, msg, state) {
    var el = row.querySelector(".item-fb-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "item-fb-status meta";
    if (state === true) el.className += " pref-status-ok";
    else if (state === false) el.className += " pref-status-err";
  }

  function setRowDisabled(row, disabled) {
    var buttons = row.querySelectorAll(".pref-btn");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = disabled;
  }

  // 后端地址未配置：全部按钮禁用，并逐条说明原因（不假装成功）。
  if (!API_URL) {
    for (var r = 0; r < rows.length; r++) {
      setRowDisabled(rows[r], true);
      rowStatus(rows[r], "反馈后端未配置：部署后填写 docs/assets/feedback-config.js 的 apiUrl。", false);
    }
    return;
  }

  function getKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ""; } catch (e) { return ""; }
  }
  function setKey(k) {
    try { localStorage.setItem(KEY_STORAGE, k); } catch (e) { /* ignore */ }
  }
  function clearKey() {
    try { localStorage.removeItem(KEY_STORAGE); } catch (e) { /* ignore */ }
  }

  // 页面内自定义弹窗（替代 window.prompt），适配手机和电脑。
  // 只把密钥保存到本设备 localStorage，不发送到其他位置。
  function promptForKey() {
    return new Promise(function (resolve) {
      if (!modal || !modalInput || !modalForm) {
        resolve(null);
        return;
      }
      var settled = false;
      function close(key) {
        if (settled) return;
        settled = true;
        modal.hidden = true;
        resolve(key);
      }
      modalInput.value = "";
      modal.hidden = false;
      try { modalInput.focus(); } catch (e) { /* ignore */ }

      modalForm.onsubmit = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        var key = (modalInput.value || "").trim();
        if (key) setKey(key);
        close(key || null);
      };
      modalCancel.onclick = function () { close(null); };
      modal.querySelector(".key-modal-backdrop").onclick = function () { close(null); };
    });
  }

  function ensureKey() {
    var key = getKey();
    if (key) return Promise.resolve(key);
    return promptForKey();
  }

  function newEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function submit(row, delta) {
    var domain = row.getAttribute("data-domain") || "";
    var itemId = row.getAttribute("data-item-id") || "";
    var date = row.getAttribute("data-report-date") || "";
    var tags = (row.getAttribute("data-tags") || "")
      .split(",")
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; })
      .slice(0, 8);
    var title = row.getAttribute("data-title") || "";

    ensureKey().then(function (key) {
      if (!key) {
        rowStatus(row, "已取消，未提交。", false);
        return;
      }
      var payload = {
        domain: domain,
        delta: delta,
        date: date,
        eventId: newEventId(),
        itemId: itemId,
        tags: tags,
        title: title,
      };
      setRowDisabled(row, true);
      rowStatus(row, "提交中…", null);

      fetch(API_URL.replace(/\/+$/, "") + "/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Feedback-Key": key },
        body: JSON.stringify(payload),
      })
        .then(function (resp) {
          return resp.json().catch(function () { return {}; }).then(function (data) {
            return { ok: resp.ok, status: resp.status, data: data };
          });
        })
        .then(function (r) {
          setRowDisabled(row, false);
          if (r.ok) {
            rowStatus(row, delta > 0 ? "已加重这一条" : "已减轻这一条", true);
            return;
          }
          if (r.status === 401) {
            clearKey();
            rowStatus(row, "密钥错误，已清除本设备保存的密钥，请重新点击输入。", false);
            return;
          }
          var msg = (r.data && r.data.error) ? r.data.error : ("请求失败（" + r.status + "）");
          rowStatus(row, "提交失败：" + msg, false);
        })
        .catch(function () {
          setRowDisabled(row, false);
          rowStatus(row, "网络错误，请稍后重试。", false);
        });
    });
  }

  for (var i = 0; i < rows.length; i++) {
    (function (row) {
      var buttons = row.querySelectorAll(".pref-btn[data-delta]");
      for (var b = 0; b < buttons.length; b++) {
        (function (btn) {
          btn.addEventListener("click", function () {
            var delta = parseInt(btn.getAttribute("data-delta"), 10);
            if (delta === 1 || delta === -1) submit(row, delta);
          });
        })(buttons[b]);
      }
    })(rows[i]);
  }
})();
