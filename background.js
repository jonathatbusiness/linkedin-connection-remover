chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url?.startsWith("https://www.linkedin.com/mynetwork/invite-connect/connections")) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "LCR_TOGGLE_PANEL" });
  } catch (error) {
    console.warn("Connection Remover: não foi possível abrir o painel.", error);
  }
});
