!function () {
  "use strict";
  const panel = document.getElementById("control-panel");
  const input = document.getElementById("globalInput");
  const autoCloseToggle = document.getElementById("autoCloseInputToggle");

  function updatePlaceholder() {
    const send = localStorage.getItem("send_shortcut") || "Ctrl+Enter";
    const wrap = send === "Enter" ? "Ctrl+Enter" : "Enter";
    const hasQuote = !!(window.QwQuotes && window.QwQuotes.count() > 0);
    input.placeholder = window.QwI18n && window.QwI18n.t
      ? window.QwI18n.t(hasQuote ? "input.placeholderQuote" : "input.placeholder", { send: send, wrap: wrap })
      : `输入内容... (${send} 发送, ${wrap} 换行，可粘贴文件)`;
  }

  function focusInput() {
    setTimeout(() => input.focus(), 50);
  }

  /** 常驻底栏: toggle / show 只聚焦输入框; hide 为 no-op (兼容 send.js 的 autoClose 调用) */
  function toggle() {
    focusInput();
  }
  function show() {
    focusInput();
  }
  function hide() {
    /* permanent composer: do not hide */
  }

  // FAB 折叠箭头 (原逻辑依赖 toggleInputBtn, 现锚点改为 settingsBtn)
  const fab = document.querySelector(".fab-container");
  const fabArrow = document.getElementById("fabCollapseArrow");
  const fabAnchor = document.getElementById("settingsBtn");
  if (fab && fabArrow) {
    const key = "fab_buttons_collapsed";
    const syncTitle = () => {
      const t = fab.classList.contains("fab-collapsed") ? "fab.expandBtns" : "fab.collapseBtns";
      if (window.QwI18n && window.QwI18n.t) fabArrow.title = window.QwI18n.t(t);
    };
    if (localStorage.getItem(key) === "true") fab.classList.add("fab-collapsed");
    syncTitle();
    fabArrow.addEventListener("click", () => {
      const collapsed = fab.classList.toggle("fab-collapsed");
      localStorage.setItem(key, collapsed.toString());
      syncTitle();
    });
    const hotzone = document.getElementById("fabArrowHotzone");
    let hideT = null;
    const showArrow = () => {
      clearTimeout(hideT);
      fabArrow.classList.add("visible");
    };
    const scheduleHide = () => {
      hideT = setTimeout(() => fabArrow.classList.remove("visible"), 140);
    };
    [fabAnchor, fabArrow, hotzone].forEach((el) => {
      if (!el) return;
      el.addEventListener("mouseenter", showArrow);
      el.addEventListener("mouseleave", scheduleHide);
    });
    window.addEventListener("qw-lang-changed", syncTitle);
  }

  // 常驻底栏下「发送后关闭」无效, 强制关闭并隐藏勾选
  if (autoCloseToggle) {
    autoCloseToggle.checked = false;
    localStorage.setItem("auto_close_input", "false");
  }

  document.addEventListener("keydown", (ev) => {
    if (window.QwState && window.QwState.matchShortcut(ev, window.QwState.getInputToggleShortcut())) {
      ev.preventDefault();
      toggle();
    }
    if (window.QwState && window.QwState.getNewSessionShortcut && window.QwState.matchShortcut(ev, window.QwState.getNewSessionShortcut())) {
      ev.preventDefault();
      const btn = document.getElementById("newSessionBtn");
      if (btn) btn.click();
    }
    if (window.QwState && window.QwState.getHideInputShortcut && window.QwState.matchShortcut(ev, window.QwState.getHideInputShortcut())) {
      ev.preventDefault();
      if (window.QwHideInput && window.QwHideInput.toggle) window.QwHideInput.toggle();
    }
    if (window.QwState && window.QwState.getFullscreenShortcut && window.QwState.matchShortcut(ev, window.QwState.getFullscreenShortcut())) {
      ev.preventDefault();
      if (window.QwSiteFocus && window.QwSiteFocus.toggleFullscreen) window.QwSiteFocus.toggleFullscreen();
    }
    if (!ev.defaultPrevented && window.QwState && window.QwState.getTopToolbarShortcut && window.QwState.matchShortcut(ev, window.QwState.getTopToolbarShortcut())) {
      ev.preventDefault();
      if (!ev.repeat && window.QwTopToolbar && window.QwTopToolbar.toggle) window.QwTopToolbar.toggle();
    }
    if (!ev.defaultPrevented && window.QwState && window.QwState.getGlobalTimelineShortcut && window.QwState.matchShortcut(ev, window.QwState.getGlobalTimelineShortcut())) {
      ev.preventDefault();
      if (!ev.repeat && window.QwGlobalTimeline && window.QwGlobalTimeline.toggle) window.QwGlobalTimeline.toggle();
    }
    if (!ev.defaultPrevented && window.QwState && window.QwState.getInpageTimelineShortcut && window.QwState.matchShortcut(ev, window.QwState.getInpageTimelineShortcut())) {
      ev.preventDefault();
      if (!ev.repeat && window.QwInpageTimeline && window.QwInpageTimeline.toggle) window.QwInpageTimeline.toggle();
    }
  });

  // 输入框右键菜单
  const menu = document.createElement("div");
  menu.className = "qw-context-menu";
  menu.style.display = "none";
  menu.innerHTML =
    '\n    <div class="qw-context-item" data-action="cut"><i>✂️</i><span data-i18n="ctx.cut">剪切</span></div>\n    <div class="qw-context-item" data-action="copy"><i>📄</i><span data-i18n="ctx.copy">复制</span></div>\n    <div class="qw-context-item" data-action="paste"><i>📋</i><span data-i18n="ctx.paste">粘贴</span></div>\n    <div class="qw-context-item" data-action="selectAll"><i>🔘</i><span data-i18n="ctx.selectAll">全选</span></div>\n  ';
  document.body.appendChild(menu);
  if (window.QwI18n && window.QwI18n.apply) window.QwI18n.apply(menu);

  function hideMenu() {
    menu.style.display = "none";
  }
  function hasSelection() {
    return input.selectionStart !== input.selectionEnd;
  }
  async function copySelection() {
    if (!hasSelection()) return;
    const text = input.value.substring(input.selectionStart, input.selectionEnd);
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("[ContextMenu] 复制失败:", err);
    }
  }

  input.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const sel = hasSelection();
    menu.querySelectorAll('[data-action="cut"], [data-action="copy"]').forEach((el) => {
      el.classList.toggle("disabled", !sel);
    });
    menu.querySelector('[data-action="selectAll"]').classList.toggle("disabled", !input.value);
    menu.style.display = "block";
    const rect = menu.getBoundingClientRect();
    let x = ev.clientX;
    let y = ev.clientY;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
    menu.style.left = x + "px";
    menu.style.top = y + "px";
  });

  menu.addEventListener("click", (ev) => {
    const item = ev.target.closest(".qw-context-item");
    if (!item || item.classList.contains("disabled")) return;
    const action = item.getAttribute("data-action");
    hideMenu();
    if (action === "cut") {
      (async () => {
        if (!hasSelection()) return;
        await copySelection();
        input.focus();
        input.setRangeText("", input.selectionStart, input.selectionEnd, "start");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })();
    } else if (action === "copy") {
      copySelection();
    } else if (action === "paste") {
      (async () => {
        input.focus();
        if (window.electronAPI && window.electronAPI.readClipboardFiles) {
          try {
            const files = await window.electronAPI.readClipboardFiles();
            if (files && files.length > 0) {
              const mapped = files.map(
                (f) =>
                  new File([f.data], f.name, {
                    type: f.type || "application/octet-stream",
                    lastModified: f.lastModified || Date.now(),
                  })
              );
              if (window.QwAttachments && window.QwAttachments.addFiles) {
                window.QwAttachments.addFiles(mapped);
                return;
              }
            }
          } catch (err) {
            console.error("[ContextMenu] 读取资源管理器复制的文件失败:", err);
          }
        }
        try {
          if (navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            const images = [];
            let text = "";
            for (const item of items) {
              for (const type of item.types) {
                if (type.startsWith("image/")) {
                  const blob = await item.getType(type);
                  const ext = (type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
                  images.push(new File([blob], `pasted-${Date.now()}-${images.length}.${ext}`, { type: type }));
                } else if (type === "text/plain" && !text) {
                  const blob = await item.getType(type);
                  text = await blob.text();
                }
              }
            }
            if (images.length > 0 && window.QwAttachments && window.QwAttachments.addFiles) {
              window.QwAttachments.addFiles(images);
            }
            if (text) {
              const start = input.selectionStart;
              const end = input.selectionEnd;
              input.setRangeText(text, start, end, "end");
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            if (images.length === 0 && !text) {
              const fallback = await navigator.clipboard.readText();
              if (fallback) {
                const start = input.selectionStart;
                const end = input.selectionEnd;
                input.setRangeText(fallback, start, end, "end");
                input.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }
          } else {
            const fallback = await navigator.clipboard.readText();
            if (fallback) {
              const start = input.selectionStart;
              const end = input.selectionEnd;
              input.setRangeText(fallback, start, end, "end");
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }
        } catch (err) {
          console.error("[ContextMenu] 粘贴失败 (可能权限被拒或剪贴板为空):", err);
        }
      })();
    } else if (action === "selectAll") {
      input.focus();
      input.select();
    }
  });

  document.addEventListener("mousedown", (ev) => {
    if (!menu.contains(ev.target)) hideMenu();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideMenu();
  });
  window.addEventListener("blur", hideMenu);
  window.addEventListener("scroll", hideMenu, true);

  input.addEventListener("keydown", (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    const shortcut = localStorage.getItem("send_shortcut") || "Ctrl+Enter";
    const sendBtn = document.getElementById("globalSendBtn");
    if (shortcut === "Enter") {
      if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
        ev.preventDefault();
        sendBtn.click();
      }
    } else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      sendBtn.click();
    }
  });

  updatePlaceholder();
  window.addEventListener("qw-lang-changed", updatePlaceholder);

  function syncNewSessionTitle() {
    const btn = document.getElementById("newSessionBtn");
    if (!btn) return;
    const key = window.QwState && window.QwState.getNewSessionShortcut
      ? window.QwState.getNewSessionShortcut()
      : "Ctrl+Shift+R";
    const t = window.QwI18n && window.QwI18n.t ? window.QwI18n.t : null;
    btn.title = t ? t("footer.newSession.title", { key: key }) : "各家回到首页，开始新话题 (" + key + ")";
  }
  syncNewSessionTitle();
  window.addEventListener("qw-lang-changed", syncNewSessionTitle);
  window.addEventListener("qw-new-session-changed", syncNewSessionTitle);

  // 输入框随内容增高, 并回写底栏高度给 grid/fab 让位
  function syncComposerMetrics() {
    if (!input || !panel) return;
    // 单行起步; 随内容增高, 最多约 5 行 (与 CSS max-height:130px 对齐), 超出后在框内上下滚动
    const maxH = 130;
    input.style.height = "40px";
    input.style.height = Math.min(maxH, Math.max(40, input.scrollHeight)) + "px";
    const barH = Math.max(64, panel.offsetHeight);
    document.documentElement.style.setProperty("--qw-composer-h", barH + "px");
  }
  input.addEventListener("input", syncComposerMetrics);
  input.addEventListener("keyup", syncComposerMetrics);
  if (window.ResizeObserver) {
    new ResizeObserver(syncComposerMetrics).observe(panel);
  }
  window.addEventListener("qw-lang-changed", () => setTimeout(syncComposerMetrics, 0));

  // 常驻显示
  if (panel) panel.style.display = "flex";
  syncComposerMetrics();
  setTimeout(() => {
    syncComposerMetrics();
    if (window.QwFocusGuard) window.QwFocusGuard.arm({ ms: 25e3 });
    else input.focus();
  }, 300);

  window.QwInputPanel = {
    toggle: toggle,
    show: show,
    hide: hide,
    updatePlaceholder: updatePlaceholder,
    autoCloseChecked: () => false,
  };
}();
