// Desktop-only table view generated from the same report DOM.
// Mobile keeps the original long-form report; no content is duplicated in the
// Markdown source or fetched from a second endpoint.
(function () {
  "use strict";

  var report = document.querySelector("main.report");
  if (!report) return;
  var feedbackRows = report.querySelectorAll(".item-fb");
  if (!feedbackRows.length) return;

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function withoutFeedback(node) {
    if (!node) return "";
    var copy = node.cloneNode(true);
    var remove = copy.querySelectorAll(".item-fb, a");
    for (var i = 0; i < remove.length; i++) remove[i].remove();
    return clean(copy.textContent);
  }

  function findLink(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var links = nodes[i].querySelectorAll ? nodes[i].querySelectorAll("a[href]") : [];
      for (var j = 0; j < links.length; j++) {
        var href = links[j].getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) return href;
      }
    }
    return "";
  }

  function findLabel(nodes, label) {
    for (var i = 0; i < nodes.length; i++) {
      var text = clean(nodes[i].textContent);
      if (text.indexOf(label + "：") === 0) return text.slice(label.length + 1).trim();
    }
    return "";
  }

  function importantItems() {
    var out = [];
    var headings = report.querySelectorAll("h3");
    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i];
      var nodes = [];
      var node = heading.nextElementSibling;
      while (node && node.tagName !== "H2" && node.tagName !== "H3") {
        nodes.push(node);
        node = node.nextElementSibling;
      }
      var fb = null;
      for (var n = 0; n < nodes.length; n++) {
        if (nodes[n].classList && nodes[n].classList.contains("item-fb")) {
          fb = nodes[n];
          break;
        }
      }
      if (!fb) continue;
      var metadata = "";
      for (var m = 0; m < nodes.length; m++) {
        var candidate = clean(nodes[m].textContent);
        if (candidate.indexOf(" · ") >= 0
            && candidate.indexOf("推荐等级") !== 0
            && candidate.indexOf("视频链接") !== 0) {
          metadata = candidate;
          break;
        }
      }
      out.push({
        itemId: fb.getAttribute("data-item-id") || "",
        grade: "重要内容",
        domain: fb.getAttribute("data-topic-name")
          || (metadata.split(" · ").length ? metadata.split(" · ").slice(-1)[0] : ""),
        title: clean(heading.textContent),
        metadata: metadata,
        recommendation: findLabel(nodes, "推荐等级") || "推荐",
        coreQuestion: findLabel(nodes, "核心问题"),
        keyMethod: findLabel(nodes, "关键方法 / 结论"),
        summary: findLabel(nodes, "为什么推荐"),
        url: findLink(nodes) || fb.getAttribute("data-url") || "",
        feedback: fb,
      });
    }
    return out;
  }

  function otherItems() {
    var out = [];
    var rows = report.querySelectorAll("li");
    for (var i = 0; i < rows.length; i++) {
      var fb = rows[i].querySelector(".item-fb");
      if (!fb) continue;
      var raw = withoutFeedback(rows[i]);
      var title = raw;
      var metadata = "";
      var recommendation = "一般相关";
      var summary = raw;
      var open = raw.indexOf("（");
      var close = raw.indexOf("）：", open + 1);
      if (open >= 0 && close > open) {
        title = clean(raw.slice(0, open));
        metadata = clean(raw.slice(open + 1, close));
        var rest = clean(raw.slice(close + 2));
        var rec = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (rec) {
          recommendation = rec[1];
          summary = rec[2];
        } else {
          summary = rest;
        }
      }
      var link = rows[i].querySelector("a[href]");
      out.push({
        itemId: fb.getAttribute("data-item-id") || "",
        grade: "其他相关",
        domain: fb.getAttribute("data-topic-name")
          || (metadata.split(" · ").length ? metadata.split(" · ").slice(-1)[0] : ""),
        title: title,
        metadata: metadata,
        recommendation: recommendation,
        coreQuestion: "",
        keyMethod: "",
        summary: summary,
        url: link ? link.href : (fb.getAttribute("data-url") || ""),
        feedback: fb,
      });
    }
    return out;
  }

  var items = importantItems().concat(otherItems());
  var seen = {};
  items = items.filter(function (item) {
    if (!item.itemId || seen[item.itemId]) return false;
    seen[item.itemId] = true;
    return true;
  });

  // Safety net for a future item layout: never silently drop feedback rows.
  for (var f = 0; f < feedbackRows.length; f++) {
    var row = feedbackRows[f];
    var itemId = row.getAttribute("data-item-id") || "";
    if (!itemId || seen[itemId]) continue;
    seen[itemId] = true;
    items.push({
      itemId: itemId,
      grade: "相关内容",
      domain: row.getAttribute("data-topic-name") || row.getAttribute("data-domain") || "",
      title: row.getAttribute("data-title") || "（无标题）",
      metadata: [row.getAttribute("data-domain") || "", row.getAttribute("data-tags") || ""]
        .filter(Boolean).join(" · "),
      recommendation: "相关",
      coreQuestion: "",
      keyMethod: "",
      summary: withoutFeedback(row.parentElement),
      url: row.getAttribute("data-url") || "",
      feedback: row,
    });
  }

  if (!items.length) return;
  var domainOrder = { "AI 大模型": 0, "嵌入式 Linux": 1, "未分类": 2 };
  items.sort(function (a, b) {
    var da = Object.prototype.hasOwnProperty.call(domainOrder, a.domain) ? domainOrder[a.domain] : 2;
    var db = Object.prototype.hasOwnProperty.call(domainOrder, b.domain) ? domainOrder[b.domain] : 2;
    if (da !== db) return da - db;
    var ga = a.grade === "重要内容" ? 0 : 1;
    var gb = b.grade === "重要内容" ? 0 : 1;
    return ga - gb;
  });

  function cell(row, className) {
    var td = document.createElement("td");
    if (className) td.className = className;
    row.appendChild(td);
    return td;
  }

  var summary = document.createElement("section");
  summary.className = "desktop-report-summary";
  var h1 = report.querySelector("h1");
  var intro = document.createElement("h1");
  intro.textContent = h1 ? h1.textContent : "信息日报";
  summary.appendChild(intro);
  var overview = document.createElement("p");
  overview.className = "meta";
  overview.textContent = "共 " + items.length + " 条 · 桌面表格视图 · 手机端使用原日报布局";
  summary.appendChild(overview);
  var quotes = report.querySelectorAll("blockquote");
  for (var qIndex = 0; qIndex < Math.min(quotes.length, 3); qIndex++) {
    var quoteLine = document.createElement("p");
    quoteLine.className = "meta";
    quoteLine.textContent = clean(quotes[qIndex].textContent);
    summary.appendChild(quoteLine);
  }

  var wrap = document.createElement("div");
  wrap.className = "desktop-report-table-wrap";
  var table = document.createElement("table");
  table.className = "desktop-report-table";
  table.innerHTML = (
    "<thead><tr>"
    + "<th>级别</th><th>领域</th><th>标题与来源</th><th>推荐</th>"
    + "<th>核心内容</th><th>视频</th><th>我的调整</th>"
    + "</tr></thead><tbody></tbody>"
  );
  var tbody = table.querySelector("tbody");
  var currentDomain = "";

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.domain !== currentDomain) {
      currentDomain = item.domain || "未分类";
      var groupRow = document.createElement("tr");
      groupRow.className = "domain-group-row";
      var groupCell = document.createElement("td");
      groupCell.colSpan = 7;
      groupCell.textContent = currentDomain;
      groupRow.appendChild(groupCell);
      tbody.appendChild(groupRow);
    }
    var tr = document.createElement("tr");
    tr.setAttribute("data-item-id", item.itemId);

    var grade = cell(tr, "table-grade");
    var badge = document.createElement("span");
    badge.className = "badge " + (item.grade === "重要内容" ? "badge-important" : "");
    badge.textContent = item.grade;
    grade.appendChild(badge);

    var domain = cell(tr, "table-domain");
    domain.textContent = item.domain || "未分类";

    var title = cell(tr, "table-title");
    var strong = document.createElement("strong");
    strong.textContent = item.title || "（无标题）";
    title.appendChild(strong);
    var cleanMetadata = item.metadata === item.domain
      ? ""
      : item.metadata.replace(" · " + item.domain, "").replace(item.domain + " · ", "");
    if (cleanMetadata) {
      var meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = cleanMetadata;
      title.appendChild(meta);
    }

    var recommendation = cell(tr, "table-recommendation");
    recommendation.textContent = item.recommendation || "相关";

    var content = cell(tr, "table-content");
    if (item.coreQuestion) {
      var q = document.createElement("div");
      q.className = "table-question";
      q.textContent = "问题：" + item.coreQuestion;
      content.appendChild(q);
    }
    if (item.keyMethod) {
      var details = document.createElement("details");
      details.className = "table-details";
      var detailsTitle = document.createElement("summary");
      detailsTitle.textContent = "展开方法与推荐理由";
      details.appendChild(detailsTitle);
      var detailsBody = document.createElement("div");
      detailsBody.className = "table-details-body";
      if (item.keyMethod) {
        var method = document.createElement("p");
        method.textContent = "方法 / 结论：" + item.keyMethod;
        detailsBody.appendChild(method);
      }
      if (item.summary) {
        var why = document.createElement("p");
        why.textContent = (item.keyMethod ? "推荐理由：" : "") + item.summary;
        detailsBody.appendChild(why);
      }
      details.appendChild(detailsBody);
      content.appendChild(details);
    } else if (item.summary) {
      var brief = document.createElement("div");
      brief.textContent = item.summary;
      content.appendChild(brief);
    }

    var video = cell(tr, "table-video");
    if (item.url) {
      var link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "打开视频";
      video.appendChild(link);
    } else {
      video.textContent = "—";
    }

    var feedback = cell(tr, "table-feedback");
    feedback.appendChild(item.feedback.cloneNode(true));
    tbody.appendChild(tr);
  }

  wrap.appendChild(table);
  report.insertBefore(wrap, report.firstChild);
  report.insertBefore(summary, wrap);
  document.body.classList.add("has-desktop-report");
})();
