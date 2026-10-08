!function () {
  "use strict";

  if (typeof chrome === "undefined" || !chrome.tabs || typeof chrome.tabs.sendMessage !== "function") return;
  const sendMessage = chrome.tabs.sendMessage;
  let sequence = 0;

  try {
    chrome.tabs.sendMessage = function (tabId, message) {
      if (message && message.action === "BROADCAST_MESSAGE" && !message.sendId) {
        message.sendId = "snd_" + Date.now().toString(36) + "_" + (++sequence).toString(36);
      }
      return sendMessage.apply(this, arguments);
    };
  } catch (error) {
    console.warn("[QwSend] 无法安装消息去重钩子:", error);
  }
}();
