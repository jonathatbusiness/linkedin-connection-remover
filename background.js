chrome.action.onClicked.addListener(async (tab) => {
  const supportedPage = tab.url?.startsWith("https://www.linkedin.com/mynetwork/invite-connect/connections") ||
    tab.url?.startsWith("https://www.linkedin.com/search/results/people");
  if (!tab.id || !supportedPage) {
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
      console.warn("Connection Remover: could not open the panel.", injectionError);
    }
  }
});
