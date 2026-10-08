!function () {
  "use strict";

  const inject = window.QwInject;
  if (!inject || typeof inject.inject !== "function") return;

  const originalInject = inject.inject;
  const inFlight = new Map();
  const recentlyInjected = new Map();
  const DEDUPE_GRACE_MS = 2500;

  document.addEventListener("paste", (event) => {
    if (event.isTrusted || !event.clipboardData) return;
    const target = event.target;
    if (!target || !target.isContentEditable) return;

    const pastedText = (event.clipboardData.getData("text/plain") || "").replace(/\s+/g, " ").trim();
    if (!pastedText) return;

    let currentText = "";
    try {
      currentText = (window.QwInject._utils.readInputText(target) || "").replace(/\s+/g, " ").trim();
    } catch (error) {
      return;
    }

    if (currentText.includes(pastedText)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      console.warn("[QwInject] blocked duplicate fallback paste");
    }
  }, true);

  function fileKey(files) {
    return (files || []).map((file) => [file.name, file.size, file.type, file.lastModified].join(":")).join(",");
  }

  inject.inject = function (site, text, files, options) {
    const siteId = site && site.id ? site.id : "";
    const key = siteId + "\u0000" + (text || "") + "\u0000" + fileKey(files);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const recentUntil = recentlyInjected.get(key) || 0;
    if (recentUntil > Date.now()) return Promise.resolve(true);
    recentlyInjected.delete(key);

    const result = Promise.resolve(originalInject.call(this, site, text, files, options));
    inFlight.set(key, result);
    result.then(
      (ok) => {
        if (inFlight.get(key) === result) inFlight.delete(key);
        if (ok === true) recentlyInjected.set(key, Date.now() + DEDUPE_GRACE_MS);
      },
      () => { if (inFlight.get(key) === result) inFlight.delete(key); }
    );
    return result;
  };
}();
