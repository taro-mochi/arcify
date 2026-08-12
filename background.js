const PIN_SCHEMA_VERSION = 4;
const UNPIN_DELAY_MS = 700;
const SUPPRESSION_MS = 3000;

chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS"
}).catch(error => {
  console.error("Arcify could not restrict storage access:", error);
});

let queue = Promise.resolve();

const suppressedChanges = new Map();

function enqueue(fn) {
  queue = queue
    .then(fn)
    .catch(error => {
      console.error("Arcify:", error);
    });

  return queue;
}

function getTabUrl(tab) {
  return tab?.url || tab?.pendingUrl || null;
}

function isTrackableUrl(url) {
  return (
    typeof url === "string" &&
    (
      url.startsWith("https://") ||
      url.startsWith("http://")
    )
  );
}

function siteKey(url) {
  if (!isTrackableUrl(url)) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function makeSite(tab) {
  const url = getTabUrl(tab);
  const key = siteKey(url);

  if (!key) {
    return null;
  }

  return {
    name: tab.title || hostname(url) || key,
    url,
    key
  };
}

async function getPinnedSites() {
  const result = await chrome.storage.local.get("pinnedSites");

  if (!Array.isArray(result.pinnedSites)) {
    return [];
  }

  const seen = new Set();
  const resultSites = [];

  for (const site of result.pinnedSites) {
    if (!site || !isTrackableUrl(site.url)) {
      continue;
    }

    const key = siteKey(site.url);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);

    resultSites.push({
      name: site.name || hostname(site.url) || key,
      url: site.url,
      key
    });
  }

  return resultSites;
}

async function savePinnedSites(sites) {
  const seen = new Set();

  const cleaned = [];

  for (const site of sites) {
    const key = siteKey(site.url);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);

    cleaned.push({
      name: site.name || hostname(site.url) || key,
      url: site.url,
      key
    });
  }

  await chrome.storage.local.set({
    pinnedSites: cleaned,
    arcifyStateVersion: PIN_SCHEMA_VERSION
  });

}

function suppressionKey(tabId, pinned) {
  return `${tabId}:${pinned}`;
}

function suppress(tabId, pinned) {
  suppressedChanges.set(
    suppressionKey(tabId, pinned),
    Date.now() + SUPPRESSION_MS
  );
}

function consumeSuppression(tabId, pinned) {
  const key = suppressionKey(tabId, pinned);

  const expires = suppressedChanges.get(key);

  if (!expires) {
    return false;
  }

  suppressedChanges.delete(key);

  if (Date.now() > expires) {
    return false;
  }

  return true;
}

async function importPinsFromFocusedWindow() {
  let window;

  try {
    window = await chrome.windows.getLastFocused();
  } catch {
    return [];
  }

  if (
    !window ||
    window.type !== "normal" ||
    window.incognito
  ) {
    return [];
  }

  const tabs = await chrome.tabs.query({
    windowId: window.id,
    pinned: true
  });

  const sites = [];
  const seen = new Set();

  for (const tab of tabs) {
    if (tab.incognito) {
      continue;
    }

    const site = makeSite(tab);

    if (!site || seen.has(site.key)) {
      continue;
    }

    seen.add(site.key);
    sites.push(site);
  }

  await savePinnedSites(sites);


  return sites;
}

async function addPinnedSite(tab) {
  const site = makeSite(tab);

  if (!site) {
    return false;
  }

  const sites = await getPinnedSites();

  if (
    sites.some(existing =>
      existing.key === site.key
    )
  ) {
    return false;
  }

  sites.push(site);

  await savePinnedSites(sites);


  return true;
}

async function removePinnedSite(tab) {
  const url = getTabUrl(tab);
  const key = siteKey(url);

  if (!key) {
    return null;
  }

  const sites = await getPinnedSites();

  const existing = sites.find(
    site => site.key === key
  );

  if (!existing) {
    return null;
  }

  await savePinnedSites(
    sites.filter(
      site => site.key !== key
    )
  );


  return existing;
}

async function safelySetPinned(tabId, pinned) {
  suppress(tabId, pinned);

  try {
    return await chrome.tabs.update(
      tabId,
      {
        pinned
      }
    );
  } catch (error) {
    suppressedChanges.delete(
      suppressionKey(tabId, pinned)
    );

    throw error;
  }
}

async function ensureWindow(windowId) {
  let window;

  try {
    window =
      await chrome.windows.get(windowId);
  } catch {
    return;
  }

  if (
    window.type !== "normal" ||
    window.incognito
  ) {
    return;
  }

  const sites = await getPinnedSites();

  let tabs;

  try {
    tabs =
      await chrome.tabs.query({
        windowId
      });
  } catch {
    return;
  }

  const usedTabIds = new Set();

  for (
    let index = 0;
    index < sites.length;
    index++
  ) {
    const site = sites[index];

    let tab = tabs.find(candidate => {
      if (usedTabIds.has(candidate.id)) {
        return false;
      }

      return (
        siteKey(getTabUrl(candidate)) ===
        site.key
      );
    });

    if (!tab) {
      try {
        tab = await chrome.tabs.create({
          windowId,
          url: site.url,
          active: false,
          index
        });

        tabs.push(tab);
      } catch {
        continue;
      }
    }

    usedTabIds.add(tab.id);

    try {
      if (!tab.pinned) {
        tab = await safelySetPinned(
          tab.id,
          true
        );
      }

      await chrome.tabs.move(
        tab.id,
        {
          index
        }
      );
    } catch {
    }
  }
}

async function ensureAllWindows() {
  const windows =
    await chrome.windows.getAll({
      windowTypes: ["normal"]
    });

  for (const window of windows) {
    if (!window.incognito) {
      await ensureWindow(window.id);
    }
  }
}

async function unpinSiteEverywhere(site) {
  const windows =
    await chrome.windows.getAll({
      windowTypes: ["normal"]
    });

  for (const window of windows) {
    if (window.incognito) {
      continue;
    }

    let tabs;

    try {
      tabs =
        await chrome.tabs.query({
          windowId: window.id
        });
    } catch {
      continue;
    }

    for (const tab of tabs) {
      if (!tab.pinned) {
        continue;
      }

      if (
        siteKey(getTabUrl(tab)) !==
        site.key
      ) {
        continue;
      }

      try {
        await safelySetPinned(
          tab.id,
          false
        );
      } catch {
      }
    }
  }
}

async function confirmManualUnpin(tabId) {
  let tab;

  try {
    tab =
      await chrome.tabs.get(tabId);
  } catch {

    return;
  }

  if (
    tab.incognito ||
    tab.pinned
  ) {
    return;
  }

  const removed =
    await removePinnedSite(tab);

  if (removed) {
    await unpinSiteEverywhere(
      removed
    );
  }
}

chrome.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    if (
      typeof changeInfo.pinned !==
      "boolean"
    ) {
      return;
    }

    if (tab.incognito) {
      return;
    }

    if (
      consumeSuppression(
        tabId,
        changeInfo.pinned
      )
    ) {

      return;
    }

    if (changeInfo.pinned) {
      enqueue(async () => {
        const added =
          await addPinnedSite(tab);

        if (added) {
          await ensureAllWindows();
        }
      });

      return;
    }

    setTimeout(() => {
      enqueue(
        () =>
          confirmManualUnpin(tabId)
      );
    }, UNPIN_DELAY_MS);
  }
);

chrome.windows.onCreated.addListener(
  window => {
    if (
      window.type !== "normal" ||
      window.incognito
    ) {
      return;
    }

    enqueue(
      () => ensureWindow(window.id)
    );
  }
);

chrome.runtime.onStartup.addListener(
  () => {
    enqueue(
      () => ensureAllWindows()
    );
  }
);

chrome.runtime.onInstalled.addListener(
  () => {
    enqueue(async () => {
      const result =
        await chrome.storage.local.get(
          "arcifyStateVersion"
        );

      if (
        result.arcifyStateVersion !==
        PIN_SCHEMA_VERSION
      ) {
        await importPinsFromFocusedWindow();
      }

      await ensureAllWindows();
    });
  }
);

// ============================================================
// MRU TAB SWITCHING
//
// Control + Period internally.
// Karabiner will later translate Control + ` -> Control + Period.
//
// storage.session survives service-worker sleep, but clears
// when Chrome fully exits, which is exactly what we want for
// tab history.
// ============================================================

function mruStorageKey(windowId) {
  return `arcify_mru_${windowId}`;
}

async function recordTabActivation(activeInfo) {
  const key = mruStorageKey(activeInfo.windowId);

  const result =
    await chrome.storage.session.get(key);

  const state = result[key] || {
    currentTabId: null,
    previousTabId: null
  };

  if (state.currentTabId === activeInfo.tabId) {
    return;
  }

  const newState = {
    previousTabId: state.currentTabId,
    currentTabId: activeInfo.tabId
  };

  await chrome.storage.session.set({
    [key]: newState
  });
}

async function switchToLastTab() {
  const activeTabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  const currentTab = activeTabs[0];

  if (!currentTab) {
    return;
  }

  const key = mruStorageKey(currentTab.windowId);

  const result =
    await chrome.storage.session.get(key);

  const state = result[key];

  if (
    !state ||
    !state.previousTabId
  ) {
    return;
  }

  let previousTab;

  try {
    previousTab =
      await chrome.tabs.get(
        state.previousTabId
      );
  } catch {
    return;
  }

  if (
    previousTab.windowId !==
    currentTab.windowId
  ) {
    return;
  }

  await chrome.tabs.update(
    previousTab.id,
    {
      active: true
    }
  );
}

chrome.tabs.onActivated.addListener(
  activeInfo => {
    recordTabActivation(activeInfo)
      .catch(console.error);
  }
);

chrome.commands.onCommand.addListener(
  command => {
    if (command !== "switch-last-tab") {
      return;
    }

    switchToLastTab()
      .catch(console.error);
  }
);

importScripts("groups.js");
