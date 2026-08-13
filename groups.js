(() => {
  "use strict";

  const TAB_GROUP_NONE = chrome.tabGroups.TAB_GROUP_ID_NONE ?? -1;

  async function getNormalWindow(windowId) {
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

  async function capture(windowId) {
    if (!Number.isInteger(windowId) || !(await getNormalWindow(windowId))) {
      throw new Error("Arcify can only save groups from a normal Chrome window.");
    }

    const [tabs, nativeGroups] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups.query({ windowId })
    ]);

    const titles = nativeGroups.map(group => (group.title || "").trim());

    if (titles.some(title => !title)) {
      throw new Error("Give every tab group a name before saving the workspace.");
    }

    if (new Set(titles).size !== titles.length) {
      throw new Error("Give every saved tab group a unique name.");
    }

    const captured = [];

    for (const group of nativeGroups.sort((a, b) => a.id - b.id)) {
      const links = [];
      const seen = new Set();
      const members = tabs
        .filter(tab => tab.groupId === group.id && !tab.pinned)
        .sort((a, b) => a.index - b.index);

      for (const tab of members) {
        const url = ArcifyStorage.sanitizeUrl(tab.url || tab.pendingUrl);
        const key = ArcifyStorage.linkKey(url);

        if (!url || !key || seen.has(key)) {
          continue;
        }

        seen.add(key);
        links.push({ url, key });
      }

      if (links.length === 0) {
        continue;
      }

      captured.push({
        title: group.title.trim(),
        color: ArcifyStorage.GROUP_COLORS.has(group.color) ? group.color : "grey",
        collapsed: group.collapsed,
        links,
        firstIndex: members[0]?.index ?? Number.MAX_SAFE_INTEGER
      });
    }

    captured.sort((a, b) => a.firstIndex - b.firstIndex);

    return captured.map(({ firstIndex: _firstIndex, ...group }) => group);
  }

  async function groupFingerprint(windowId, group) {
    try {
      const tabs = await chrome.tabs.query({
        windowId,
        groupId: group.id
      });

      return tabs
        .filter(tab => !tab.pinned)
        .sort((a, b) => a.index - b.index)
        .map(tab => ArcifyStorage.linkKey(tab.url || tab.pendingUrl))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function sameOrderedKeys(left, right) {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }

  async function findExistingExactGroup(windowId, savedGroup) {
    let candidates;

    try {
      candidates = await chrome.tabGroups.query({
        windowId,
        title: savedGroup.title
      });
    } catch {
      return null;
    }

    const wantedKeys = savedGroup.links.map(link => link.key);

    for (const candidate of candidates) {
      if (candidate.windowId !== windowId || candidate.title !== savedGroup.title) {
        continue;
      }

      const existingKeys = await groupFingerprint(windowId, candidate);

      if (sameOrderedKeys(existingKeys, wantedKeys)) {
        return candidate;
      }
    }

    return null;
  }

  async function findReusableTab(windowId, link, usedTabIds) {
    let tabs;

    try {
      tabs = await chrome.tabs.query({ windowId });
    } catch {
      return null;
    }

    return (
      tabs.find(tab => {
        if (
          usedTabIds.has(tab.id) ||
          tab.pinned ||
          tab.groupId !== TAB_GROUP_NONE
        ) {
          return false;
        }

        return ArcifyStorage.linkKey(tab.url || tab.pendingUrl) === link.key;
      }) || null
    );
  }

  async function restoreOne(windowId, savedGroup) {
    if (!(await getNormalWindow(windowId))) {
      return false;
    }

    const existingGroup = await findExistingExactGroup(windowId, savedGroup);

    if (existingGroup) {
      try {
        await chrome.tabGroups.update(existingGroup.id, {
          title: savedGroup.title,
          color: savedGroup.color,
          collapsed: savedGroup.collapsed
        });
        return true;
      } catch {
        return false;
      }
    }

    const tabIds = [];
    const usedTabIds = new Set();

    for (const link of savedGroup.links) {
      if (!(await getNormalWindow(windowId))) {
        return false;
      }

      let tab = await findReusableTab(windowId, link, usedTabIds);

      if (!tab) {
        try {
          tab = await chrome.tabs.create({
            windowId,
            url: link.url,
            active: false
          });
        } catch {
          return false;
        }
      }

      if (tab.windowId !== windowId || tab.pinned) {
        return false;
      }

      usedTabIds.add(tab.id);
      tabIds.push(tab.id);
    }

    if (tabIds.length === 0 || !(await getNormalWindow(windowId))) {
      return false;
    }

    try {
      const groupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId }
      });

      const group = await chrome.tabGroups.get(groupId);

      if (group.windowId !== windowId) {
        return false;
      }

      await chrome.tabGroups.update(groupId, {
        title: savedGroup.title,
        color: savedGroup.color,
        collapsed: savedGroup.collapsed
      });

      return true;
    } catch {
      return false;
    }
  }

  async function restore(windowId, groups) {
    if (!Number.isInteger(windowId) || !(await getNormalWindow(windowId))) {
      return { restored: 0, failed: 0 };
    }

    const normalized = ArcifyStorage.normalizeGroups(groups);
    let restored = 0;
    let failed = 0;

    for (const group of normalized) {
      if (await restoreOne(windowId, group)) {
        restored += 1;
      } else {
        failed += 1;
      }
    }

    return { restored, failed };
  }

  globalThis.ArcifyGroups = Object.freeze({
    capture,
    restore
  });
})();
