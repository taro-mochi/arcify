"use strict";

importScripts("storage.js", "groups.js");

chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch(() => {});

const MRU_KEY_PREFIX = "arcify.mru.";
let mutationQueue = Promise.resolve();

function enqueueMutation(operation) {
  mutationQueue = mutationQueue.then(operation, operation);
  return mutationQueue;
}

async function getNormalWindow(windowId) {
  if (!Number.isInteger(windowId)) {
    return null;
  }

  try {
    const window = await chrome.windows.get(windowId);

    if (window.type !== "normal" || window.incognito) {
      return null;
    }

    return window;
  } catch {
    return null;
  }
}

async function captureFavorites(windowId) {
  if (!(await getNormalWindow(windowId))) {
    throw new Error("Arcify can only save favorites from a normal Chrome window.");
  }

  const tabs = await chrome.tabs.query({
    windowId,
    pinned: true
  });

  return ArcifyStorage.normalizeFavorites(
    tabs.sort((a, b) => a.index - b.index).map(tab => ({
      url: tab.url || tab.pendingUrl
    }))
  );
}

async function restoreFavorites(windowId, favorites) {
  if (!(await getNormalWindow(windowId))) {
    return { restored: 0, failed: 0 };
  }

  const normalized = ArcifyStorage.normalizeFavorites(favorites);
  let tabs;

  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch {
    return { restored: 0, failed: normalized.length };
  }

  const usedTabIds = new Set();
  let restored = 0;
  let failed = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const favorite = normalized[index];

    let tab =
      tabs.find(candidate => {
        return (
          !usedTabIds.has(candidate.id) &&
          candidate.pinned &&
          ArcifyStorage.favoriteKey(candidate.url || candidate.pendingUrl) === favorite.key
        );
      }) ||
      tabs.find(candidate => {
        return (
          !usedTabIds.has(candidate.id) &&
          !candidate.pinned &&
          candidate.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
          ArcifyStorage.favoriteKey(candidate.url || candidate.pendingUrl) === favorite.key
        );
      }) ||
      null;

    if (!tab) {
      try {
        tab = await chrome.tabs.create({
          windowId,
          url: favorite.url,
          pinned: true,
          active: false,
          index
        });
        tabs.push(tab);
      } catch {
        failed += 1;
        continue;
      }
    }

    usedTabIds.add(tab.id);

    try {
      if (!tab.pinned) {
        tab = await chrome.tabs.update(tab.id, { pinned: true });
      }

      await chrome.tabs.move(tab.id, { index });
      restored += 1;
    } catch {
      failed += 1;
    }
  }

  return { restored, failed };
}

async function saveFavorites(windowId) {
  const favorites = await captureFavorites(windowId);
  const config = await ArcifyStorage.replaceFavorites(favorites);
  return { favorites: config.favorites.length };
}

async function saveGroups(windowId) {
  const groups = await ArcifyGroups.capture(windowId);
  const config = await ArcifyStorage.replaceGroups(groups);
  return { groups: config.groups.length };
}

async function saveWorkspace(windowId) {
  const [favorites, groups] = await Promise.all([
    captureFavorites(windowId),
    ArcifyGroups.capture(windowId)
  ]);

  const config = await ArcifyStorage.replaceWorkspace({ favorites, groups });

  return {
    favorites: config.favorites.length,
    groups: config.groups.length
  };
}

async function restoreFavoritesFromConfig(windowId) {
  const config = await ArcifyStorage.readConfig();
  return restoreFavorites(windowId, config.favorites);
}

async function restoreGroupsFromConfig(windowId) {
  const config = await ArcifyStorage.readConfig();
  return ArcifyGroups.restore(windowId, config.groups);
}

async function restoreWorkspaceFromConfig(windowId) {
  const config = await ArcifyStorage.readConfig();
  const favorites = await restoreFavorites(windowId, config.favorites);
  const groups = await ArcifyGroups.restore(windowId, config.groups);
  return { favorites, groups };
}

async function openArcifyWindow() {
  let window;

  try {
    window = await chrome.windows.create({ focused: true });
  } catch {
    throw new Error("Chrome could not create a new Arcify window.");
  }

  if (!window?.id) {
    throw new Error("Chrome did not return a valid window.");
  }

  const result = await restoreWorkspaceFromConfig(window.id);

  return {
    windowId: window.id,
    ...result
  };
}

async function getStatus() {
  const config = await ArcifyStorage.readConfig();

  return {
    favorites: config.favorites.length,
    groups: config.groups.length,
    links: config.groups.reduce((total, group) => total + group.links.length, 0)
  };
}

function isTrustedMessage(sender) {
  return sender?.id === chrome.runtime.id;
}

function validWindowId(value) {
  return Number.isInteger(value) && value >= 0;
}

async function handleMessage(message, sender) {
  if (!isTrustedMessage(sender) || !message || typeof message.type !== "string") {
    throw new Error("Invalid Arcify request.");
  }

  switch (message.type) {
    case "ARCIFY_GET_STATUS":
      return getStatus();

    case "ARCIFY_SAVE_FAVORITES":
      if (!validWindowId(message.windowId)) throw new Error("Invalid Chrome window.");
      return enqueueMutation(() => saveFavorites(message.windowId));

    case "ARCIFY_SAVE_GROUPS":
      if (!validWindowId(message.windowId)) throw new Error("Invalid Chrome window.");
      return enqueueMutation(() => saveGroups(message.windowId));

    case "ARCIFY_SAVE_WORKSPACE":
      if (!validWindowId(message.windowId)) throw new Error("Invalid Chrome window.");
      return enqueueMutation(() => saveWorkspace(message.windowId));

    case "ARCIFY_RESTORE_FAVORITES":
      if (!validWindowId(message.windowId)) throw new Error("Invalid Chrome window.");
      return enqueueMutation(() => restoreFavoritesFromConfig(message.windowId));

    case "ARCIFY_RESTORE_GROUPS":
      if (!validWindowId(message.windowId)) throw new Error("Invalid Chrome window.");
      return enqueueMutation(() => restoreGroupsFromConfig(message.windowId));

    case "ARCIFY_RESTORE_WORKSPACE":
      if (!validWindowId(message.windowId)) throw new Error("Invalid Chrome window.");
      return enqueueMutation(() => restoreWorkspaceFromConfig(message.windowId));

    case "ARCIFY_OPEN_WINDOW":
      return enqueueMutation(openArcifyWindow);

    case "ARCIFY_CLEAR_FAVORITES":
      return enqueueMutation(async () => {
        const config = await ArcifyStorage.clearFavorites();
        return { favorites: config.favorites.length };
      });

    case "ARCIFY_CLEAR_GROUPS":
      return enqueueMutation(async () => {
        const config = await ArcifyStorage.clearGroups();
        return { groups: config.groups.length };
      });

    case "ARCIFY_CLEAR_ALL":
      return enqueueMutation(async () => {
        await ArcifyStorage.clearAll();
        return { favorites: 0, groups: 0 };
      });

    default:
      throw new Error("Unknown Arcify request.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => {
      sendResponse({
        ok: false,
        error: typeof error?.message === "string" ? error.message : "Arcify could not complete the request."
      });
    });

  return true;
});

function mruKey(windowId) {
  return `${MRU_KEY_PREFIX}${windowId}`;
}

async function recordTabActivation({ windowId, tabId }) {
  const key = mruKey(windowId);
  const stored = await chrome.storage.session.get(key);
  const state = stored[key] || {
    currentTabId: null,
    previousTabId: null
  };

  if (state.currentTabId === tabId) {
    return;
  }

  await chrome.storage.session.set({
    [key]: {
      previousTabId: state.currentTabId,
      currentTabId: tabId
    }
  });
}

async function switchToLastTab() {
  const [currentTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (!currentTab?.id || !Number.isInteger(currentTab.windowId)) {
    return;
  }

  const key = mruKey(currentTab.windowId);
  const stored = await chrome.storage.session.get(key);
  const previousTabId = stored[key]?.previousTabId;

  if (!Number.isInteger(previousTabId)) {
    return;
  }

  try {
    const previousTab = await chrome.tabs.get(previousTabId);

    if (previousTab.windowId === currentTab.windowId) {
      await chrome.tabs.update(previousTabId, { active: true });
    }
  } catch {
    await chrome.storage.session.remove(key);
  }
}

chrome.tabs.onActivated.addListener(activeInfo => {
  recordTabActivation(activeInfo).catch(() => {});
});

chrome.windows.onRemoved.addListener(windowId => {
  chrome.storage.session.remove(mruKey(windowId)).catch(() => {});
});

chrome.commands.onCommand.addListener(command => {
  if (command === "switch-last-tab") {
    switchToLastTab().catch(() => {});
    return;
  }

  if (command === "open-arcify-window") {
    enqueueMutation(openArcifyWindow).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(() => {
  ArcifyStorage.readConfig().catch(() => {});
});
