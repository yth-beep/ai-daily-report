// 偏好调整按钮：直接调用 Cloudflare Worker 后端，无需登录 GitHub。
// 依赖 docs/assets/feedback-config.js 提供的 window.FEEDBACK_CONFIG.apiUrl。
(function () {
  "use strict";

  var section = document.getElementById("pref-section");
  if (!section) return;

  var statusEl = document.getElementById("pref-status");
  var buttonsEl = section.querySelector(".pref-buttons");
  var buttons = section.querySelectorAll(".pref-btn");
  var reportDate = buttonsEl ? buttonsEl.getAttribute("data-report-date") : "";

  var modal = document.getElementById("key-modal");
  var modalInput = document.getElementById("key-input");
  var modalForm = document.getElementById("key-form");
  var modalCancel = document.getElementById("key-cancel");

  var API_URL = (window.FEEDBACK_CONFIG && window.FEEDBACK_CONFIG.apiUrl) || "";
  var KEY_STORAGE = "wb-feedback-key";

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "pref-status meta";
    if (ok === true) statusEl.className += " pref-status-ok";
    else if (ok === false) statusEl.className += " pref-status-err";
  }

  // API 地址未配置：禁用按钮并提示
  if (!API_URL) {
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    setStatus("反馈后端未配置：请先部署 Cloudflare Worker，并在 docs/assets/feedback-config.js 填写 apiUrl。", false);
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
      modalCancel.onclick = function () {
        close(null);
      };
      modal.querySelector(".key-modal-backdrop").onclick = function () {
        close(null);
      };
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

  function submit(domain, delta) {
    ensureKey().then(function (key) {
      if (!key) {
        setStatus("已取消，未提交。", false);
        return;
      }
      var payload = { domain: domain, delta: delta, date: reportDate, eventId: newEventId() };
      setStatus("提交中…", null);

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
          if (r.ok) {
            setStatus(delta > 0 ? "已加重" : "已减轻", true);
          } else {
            var msg = (r.data && r.data.error) ? r.data.error : ("请求失败（" + r.status + "）");
            setStatus("提交失败：" + msg, false);
            if (r.status === 401) {
              clearKey();
              setStatus("密钥错误，已清除本地保存的密钥，请重新点击输入。", false);
            }
          }
        })
        .catch(function () {
          setStatus("网络错误，请稍后重试。", false);
        });
    });
  }

  for (var b = 0; b < buttons.length; b++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var domain = btn.getAttribute("data-domain");
        var delta = parseInt(btn.getAttribute("data-delta"), 10);
        submit(domain, delta);
      });
    })(buttons[b]);
  }
})();
