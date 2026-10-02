/*! 自动话题会话
 * 规则 (与用户约定):
 * - 「新建会话」后第一次发送 → 列表新增一条话题 (标题=首句)
 * - 同话题续聊不新增; 抓取窗口内把各家「落地页 → 对话页」地址补齐, 齐了或超时后冻结
 * - 单家私自开新对话: 不新增、不改写已冻结的对话 URL
 * - 点列表恢复某条 → 设为当前话题并冻结
 *
 * 取链方式与手动保存 session-switch.js 的 s(e) 对齐, 避免自动/手动结果不一致.
 */
!function () {
  "use strict";

  var KEY_ACTIVE = "qw_auto_topic_active";
  var KEY_PENDING = "qw_auto_topic_pending";
  var KEY_FROZEN = "qw_auto_topic_frozen";
  // GPT/Claude 首条发出后改地址往往慢于千问, 窗口加长
  var CAPTURE_MS = 60000;
  var POLL_MS = 500;

  var captureTimer = null;
  var pollTimer = null;
  var capturingId = null;
  var urlObserver = null;

  function getActiveId() {
    try {
      return localStorage.getItem(KEY_ACTIVE) || "";
    } catch (e) {
      return "";
    }
  }

  function setActiveId(id) {
    try {
      if (id) localStorage.setItem(KEY_ACTIVE, id);
      else localStorage.removeItem(KEY_ACTIVE);
    } catch (e) {}
  }

  function isPending() {
    try {
      return localStorage.getItem(KEY_PENDING) === "1";
    } catch (e) {
      return false;
    }
  }

  function setPending(v) {
    try {
      localStorage.setItem(KEY_PENDING, v ? "1" : "0");
    } catch (e) {}
  }

  function isFrozen() {
    try {
      return localStorage.getItem(KEY_FROZEN) === "1";
    } catch (e) {
      return false;
    }
  }

  function setFrozen(v) {
    try {
      localStorage.setItem(KEY_FROZEN, v ? "1" : "0");
    } catch (e) {}
  }

  function enabledSites() {
    try {
      var disabled = new Set(window.QwState.getDisabledIds() || []);
      return (window.QwState.getOrderedUrls() || []).filter(function (s) {
        return !disabled.has(s.id);
      });
    } catch (e) {
      return [];
    }
  }

  /** 与手动保存 session-switch `s(e)` 同一套取链 */
  function readFrameUrl(site) {
    try {
      var wrap = document.getElementById("frame-" + site.id);
      var el = wrap && wrap.querySelector(".frame-url-text");
      var raw = (el && (el.getAttribute("data-full-url") || el.innerText)) || "";
      if (/^https?:/i.test(raw) && !(window.QwState && window.QwState.isLikelyEmbeddedFrameUrl && window.QwState.isLikelyEmbeddedFrameUrl(raw))) {
        try {
          var u = new URL(raw);
          ["ai_id", "_t", "_qwrl", "qw_sidebar"].forEach(function (k) {
            u.searchParams.delete(k);
          });
          return u.toString();
        } catch (e) {
          return raw;
        }
      }
    } catch (e) {}
    return site.url;
  }

  function cleanUrl(u) {
    if (!u || !/^https?:/i.test(u)) return "";
    try {
      var x = new URL(u);
      ["ai_id", "_t", "_qwrl", "qw_sidebar"].forEach(function (k) {
        x.searchParams.delete(k);
      });
      return x.toString();
    } catch (e) {
      return u;
    }
  }

  function samePage(a, b) {
    try {
      var ua = new URL(cleanUrl(a) || a);
      var ub = new URL(cleanUrl(b) || b);
      var pa = ua.pathname.replace(/\/$/, "") || "/";
      var pb = ub.pathname.replace(/\/$/, "") || "/";
      return ua.origin === ub.origin && pa === pb;
    } catch (e) {
      return (cleanUrl(a) || a) === (cleanUrl(b) || b);
    }
  }

  /**
   * ChatGPT 首条发送后会先落到临时会话 /c/WEB:uuid, 稍后才换成真正的 /c/xxxxxx.
   * 临时链恢复无效, 必须当成「未定稿落地」继续抓取.
   */
  function isTempChatUrl(url) {
    if (!url) return false;
    try {
      var u = new URL(cleanUrl(url) || url);
      var p = u.pathname || "";
      if (/\/c\/WEB:/i.test(p)) return true;
      if (/\/c\/(pending|temp|local):/i.test(p)) return true;
      return false;
    } catch (e) {
      return /\/c\/WEB:/i.test(String(url));
    }
  }

  /**
   * 落地页 / 新对话页 / 临时会话页 (还不能用来精确恢复):
   * - 等于站点目录首页
   * - 或路径像 / /new /chat (无 id) 等
   * - 或 ChatGPT 的 /c/WEB: 临时 id
   * - 或路径末段没有足够长的会话 id
   * 真正对话页: /c/真实id、/chat/uuid、带 conversation id 的 query 等
   */
  function isLandingUrl(url, site) {
    if (!url) return true;
    if (isTempChatUrl(url)) return true;
    if (site && site.url && samePage(url, site.url)) return true;
    try {
      var u = new URL(cleanUrl(url) || url);
      var p = u.pathname.replace(/\/$/, "") || "/";
      var q = u.search || "";

      // 明确的对话页 (排除 WEB: 临时)
      if (/\/c\/(?!WEB:)[a-zA-Z0-9_-]{8,}/i.test(p)) return false; // ChatGPT 正式 id
      if (/\/chat\/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(p)) return false; // Claude uuid
      if (/\/chat\/[a-zA-Z0-9_-]{12,}/i.test(p)) return false;
      if (/\/(conversation|conversations|share)\/[a-zA-Z0-9_-]{8,}/i.test(p)) return false;
      if (/[?&](chat[_-]?id|conversation[_-]?id|session[_-]?id|sessionId|chatId)=/i.test(q)) return false;
      if (/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) return false;
      // 末段很长的 token, 多半是会话 id
      var last = p.split("/").pop() || "";
      if (
        last.length >= 16 &&
        /[A-Za-z0-9_-]+/.test(last) &&
        !/^(new|chat|app|code|search|labs|gemini|claude|gpt|WEB:.*)$/i.test(last)
      ) {
        return false;
      }

      // 常见新对话落地
      if (p === "/" || /^\/(new|chat|chats|app|code|search|all|projects?)?$/i.test(p)) return true;
      if (/\/new$/i.test(p)) return true;
      return true; // 默认偏落地: 抓取窗口里允许再升级
    } catch (e) {
      return true;
    }
  }

  /** 抓取窗口: 允许落地/临时→正式对话; 禁止正式→落地; 禁止正式→另一正式 */
  function canUpgrade(saved, next, site) {
    if (!next) return false;
    if (!saved) return true;
    if (saved === next) return false;
    var savedLand = isLandingUrl(saved, site);
    var nextLand = isLandingUrl(next, site);
    if (!savedLand && nextLand) return false;
    if (savedLand && !nextLand) return true;
    if (savedLand && nextLand) {
      // 临时 WEB: → 仍算落地, 但若 next 也是临时且不同, 可跟上最新临时; 正式前都会再升一次
      return saved !== next;
    }
    return false;
  }

  function titleFromText(text) {
    var s = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!s) {
      try {
        var d = new Date();
        return d.toLocaleDateString() + " " + d.toTimeString().slice(0, 5);
      } catch (e) {
        return "话题";
      }
    }
    if (s.length > 36) s = s.slice(0, 36) + "…";
    return s;
  }

  function snapshotTabs() {
    return enabledSites().map(function (site) {
      var tab = { siteId: site.id, url: readFrameUrl(site) };
      if (window.QwProfiles && window.QwProfiles.active) {
        var pid = window.QwProfiles.active();
        if (typeof pid === "string" && pid) tab.profileId = pid;
      }
      return tab;
    });
  }

  function notifyChanged() {
    try {
      window.dispatchEvent(new CustomEvent("qw-sessions-changed"));
    } catch (e) {}
  }

  function findSession(id) {
    if (!id) return null;
    var list = window.QwState.getSavedSessions() || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function writeSession(session) {
    var list = window.QwState.getSavedSessions() || [];
    var idx = list.findIndex(function (s) {
      return s.id === session.id;
    });
    if (idx >= 0) list[idx] = session;
    else list.unshift(session);
    window.QwState.saveSavedSessions(list);
    notifyChanged();
  }

  function stopCapture() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (captureTimer) {
      clearTimeout(captureTimer);
      captureTimer = null;
    }
    if (urlObserver) {
      try {
        urlObserver.disconnect();
      } catch (e) {}
      urlObserver = null;
    }
    capturingId = null;
  }

  function allSitesHaveChat(session) {
    var sites = enabledSites();
    if (!sites.length) return true;
    var byId = {};
    (session.tabs || []).forEach(function (tab) {
      byId[tab.siteId] = tab;
    });
    return sites.every(function (site) {
      var tab = byId[site.id];
      return tab && tab.url && !isLandingUrl(tab.url, site);
    });
  }

  function freezeActive() {
    setFrozen(true);
    stopCapture();
  }

  function readStorageLastUrl(siteId, cb) {
    try {
      if (!(typeof chrome !== "undefined" && chrome.storage && chrome.storage.local)) {
        cb("");
        return;
      }
      var key = "last_url_" + siteId;
      chrome.storage.local.get([key], function (res) {
        try {
          chrome.runtime.lastError;
          var u = res && res[key];
          cb(typeof u === "string" ? u : "");
        } catch (e) {
          cb("");
        }
      });
    } catch (e) {
      cb("");
    }
  }

  function pickBetterUrl(saved, frameUrl, storedUrl, site) {
    var candidates = [frameUrl, storedUrl].filter(Boolean);
    var best = saved || "";
    candidates.forEach(function (c) {
      try {
        var u = new URL(c);
        ["ai_id", "_t", "_qwrl", "qw_sidebar"].forEach(function (k) {
          u.searchParams.delete(k);
        });
        c = u.toString();
      } catch (e) {}
      if (canUpgrade(best, c, site) || (!best && c)) best = c;
    });
    return best;
  }

  function upgradeActiveUrls() {
    if (isFrozen()) return;
    var id = getActiveId();
    if (!id || (capturingId && capturingId !== id)) return;
    var session = findSession(id);
    if (!session) return;

    var sites = enabledSites();
    var siteMap = {};
    sites.forEach(function (s) {
      siteMap[s.id] = s;
    });

    var pending = sites.length;
    var frameUrls = {};
    sites.forEach(function (site) {
      frameUrls[site.id] = readFrameUrl(site);
    });

    function finish(storedMap) {
      if (isFrozen() || getActiveId() !== id) return;
      var changed = false;
      var tabs = (session.tabs || []).map(function (tab) {
        var site = siteMap[tab.siteId];
        if (!site) return tab;
        var next = pickBetterUrl(tab.url, frameUrls[site.id], storedMap[site.id], site);
        if (next && next !== tab.url && canUpgrade(tab.url, next, site)) {
          changed = true;
          return Object.assign({}, tab, { url: next });
        }
        return tab;
      });

      sites.forEach(function (site) {
        if (
          tabs.some(function (tab) {
            return tab.siteId === site.id;
          })
        )
          return;
        var tab = {
          siteId: site.id,
          url: pickBetterUrl("", frameUrls[site.id], storedMap[site.id], site) || readFrameUrl(site),
        };
        if (window.QwProfiles && window.QwProfiles.active) {
          var pid = window.QwProfiles.active();
          if (typeof pid === "string" && pid) tab.profileId = pid;
        }
        tabs.push(tab);
        changed = true;
      });

      if (changed) {
        session = Object.assign({}, session, {
          tabs: tabs,
          timestamp: Date.now(),
        });
        writeSession(session);
      }

      if (allSitesHaveChat(session)) freezeActive();
    }

    var storedMap = {};
    if (!sites.length) return finish(storedMap);
    sites.forEach(function (site) {
      readStorageLastUrl(site.id, function (u) {
        if (u) storedMap[site.id] = u;
        pending -= 1;
        if (pending <= 0) finish(storedMap);
      });
    });
  }

  function watchUrlTexts() {
    if (urlObserver || !window.MutationObserver) return;
    var root = document.getElementById("grid-container");
    if (!root) return;
    urlObserver = new MutationObserver(function () {
      upgradeActiveUrls();
    });
    urlObserver.observe(root, {
      subtree: true,
      characterData: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-full-url"],
    });
  }

  function startCapture(sessionId) {
    stopCapture();
    if (isFrozen()) return;
    capturingId = sessionId;
    upgradeActiveUrls();
    watchUrlTexts();
    pollTimer = setInterval(upgradeActiveUrls, POLL_MS);
    captureTimer = setTimeout(function () {
      var sess = findSession(getActiveId());
      // 还有站点停在落地页就只停轮询、保持未冻结, 同话题下次发送会再抓
      if (sess && !topicStillNeedsCapture(sess)) freezeActive();
      else stopCapture();
    }, CAPTURE_MS);
  }

  function createTopic(text) {
    var sites = enabledSites();
    if (!sites.length) return null;
    var session = {
      id: "s_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36),
      name: titleFromText(text),
      timestamp: Date.now(),
      tabs: snapshotTabs(),
    };
    writeSession(session);
    setActiveId(session.id);
    setPending(false);
    setFrozen(false);
    startCapture(session.id);
    return session;
  }

  function onNewSession() {
    setPending(true);
    setActiveId("");
    setFrozen(false);
    stopCapture();
  }

  function topicStillNeedsCapture(session) {
    if (!session) return false;
    var sites = enabledSites();
    var byId = {};
    (session.tabs || []).forEach(function (tab) {
      byId[tab.siteId] = tab;
    });
    return sites.some(function (site) {
      var tab = byId[site.id];
      return !tab || !tab.url || isLandingUrl(tab.url, site);
    });
  }

  function onSend(detail) {
    var text = (detail && detail.text) || "";
    var active = getActiveId();
    var pending = isPending();
    var exists = active && findSession(active);

    if (pending || !exists) {
      createTopic(text);
      return;
    }

    // 已冻结但还有站点停在落地页 (GPT/Claude 改地址偏慢) → 解冻再抓一轮
    if (isFrozen() && topicStillNeedsCapture(exists)) {
      setFrozen(false);
      startCapture(active);
      return;
    }

    if (!isFrozen()) startCapture(active);
  }

  function onRestored(detail) {
    var id = detail && detail.sessionId;
    if (!id) id = guessSessionFromFrames();
    if (!id) return;
    setActiveId(id);
    setPending(false);
    setFrozen(true);
    stopCapture();
  }

  function guessSessionFromFrames() {
    var tabs = snapshotTabs();
    if (!tabs.length) return "";
    var list = window.QwState.getSavedSessions() || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var map = {};
      (s.tabs || []).forEach(function (tab) {
        map[tab.siteId] = tab.url;
      });
      var hit = tabs.filter(function (tab) {
        return map[tab.siteId] && samePage(map[tab.siteId], tab.url);
      }).length;
      if (hit >= Math.ceil(tabs.length / 2)) return s.id;
    }
    return list[0] ? list[0].id : "";
  }

  (function boot() {
    var id = getActiveId();
    var sess = id && findSession(id);
    if (!sess) {
      setPending(true);
      setActiveId("");
      setFrozen(false);
      return;
    }
    if (!isFrozen()) startCapture(id);
  })();

  window.addEventListener("qw-new-session", onNewSession);
  window.addEventListener("qw-send-dispatched", function (ev) {
    try {
      onSend(ev.detail || {});
    } catch (e) {
      console.error("[QwSessionAuto]", e);
    }
  });
  window.addEventListener("qw-session-restored", function (ev) {
    try {
      onRestored(ev.detail || {});
    } catch (e) {
      console.error("[QwSessionAuto]", e);
    }
  });

  window.QwSessionAuto = {
    createTopic: createTopic,
    freeze: freezeActive,
    isPending: isPending,
    getActiveId: getActiveId,
  };
}();
