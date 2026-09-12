chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const defaultSearchUrl = "https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&origin=FACETED_SEARCH";
  const saved = await chrome.storage.local.get("lcrStateV2");
  let searchUrl = saved.lcrStateV2?.collection?.searchUrl || defaultSearchUrl;
  try {
    const url = new URL(searchUrl);
    if (url.origin !== "https://www.linkedin.com" || !url.pathname.startsWith("/search/results/people")) throw new Error("Invalid saved search URL");
    url.searchParams.delete("page");
    searchUrl = url.href;
  } catch {
    searchUrl = defaultSearchUrl;
  }

  const alreadyOnPeopleSearch = tab.url?.startsWith("https://www.linkedin.com/search/results/people");
  if (!alreadyOnPeopleSearch) {
    await chrome.tabs.update(tab.id, { url: searchUrl });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "LCR_OPEN_COLLECT" });
  } catch (error) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["src/content/content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content/content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, { type: "LCR_OPEN_COLLECT" });
    } catch (injectionError) {
      console.warn("Connection Remover: could not open the panel.", injectionError);
    }
  }
});
