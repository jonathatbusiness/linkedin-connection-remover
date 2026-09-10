chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url?.startsWith("https://www.linkedin.com/mynetwork/invite-connect/connections")) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "LCR_TOGGLE_PANEL" });
  } catch (error) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
    } catch (injectionError) {
      console.warn("Connection Remover: não foi possível abrir o painel.", injectionError);
    }
  }
});
