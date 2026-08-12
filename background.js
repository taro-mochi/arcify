const DEFAULT_PINS = [
  {
    name: "Gmail",
    url: "https://mail.google.com/"
  },
  {
    name: "Calendar",
    url: "https://calendar.google.com/"
  },
  {
    name: "ChatGPT",
    url: "https://chatgpt.com/"
  }
];

async function getPinnedSites() {
  const result = await chrome.storage.local.get("pinnedSites");

  if (result.pinnedSites) {
    return result.pinnedSites;
  }

  await chrome.storage.local.set({
    pinnedSites: DEFAULT_PINS
  });

  return DEFAULT_PINS;
}

function getHostname(url) {
  if (!url) return null;

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sameSite(existingUrl, desiredUrl) {
  return getHostname(existingUrl) === getHostname(desiredUrl);
}

async function ensurePinnedTabs(windowId) {
  const window = await chrome.windows.get(windowId);

  if (window.type !== "normal") return;

  const desiredPins = await getPinnedSites();

  let existingTabs = await chrome.tabs.query({
    windowId
  });

  for (let i = 0; i < desiredPins.length; i++) {
    const desired = desiredPins[i];

    let existingTab = existingTabs.find(tab =>
      sameSite(tab.url || tab.pendingUrl, desired.url)
    );

    if (existingTab) {
      if (!existingTab.pinned) {
        existingTab = await chrome.tabs.update(
          existingTab.id,
          { pinned: true }
        );
      }

      await chrome.tabs.move(existingTab.id, {
        index: i
      });

    } else {
      const newTab = await chrome.tabs.create({
        windowId,
        url: desired.url,
        pinned: true,
        active: false,
        index: i
      });

      existingTabs.push(newTab);
    }
  }
}

chrome.windows.onCreated.addListener(window => {
  ensurePinnedTabs(window.id).catch(console.error);
});

chrome.runtime.onStartup.addListener(async () => {
  const windows = await chrome.windows.getAll({
    windowTypes: ["normal"]
  });

  for (const window of windows) {
    await ensurePinnedTabs(window.id);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get("pinnedSites");

  if (!result.pinnedSites) {
    await chrome.storage.local.set({
      pinnedSites: DEFAULT_PINS
    });
  }

  const windows = await chrome.windows.getAll({
    windowTypes: ["normal"]
  });

  for (const window of windows) {
    await ensurePinnedTabs(window.id);
  }
});
