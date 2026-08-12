const ARCIFY_GROUPS_KEY = "arcifyGroupsV1";

let arcifyGroupQueue = Promise.resolve();

function queueGroupOperation(fn) {
  arcifyGroupQueue = arcifyGroupQueue
    .then(fn)
    .catch(error => {
      console.error("Arcify Groups:", error);
    });

  return arcifyGroupQueue;
}

function groupTabUrl(tab) {
  return tab?.url || tab?.pendingUrl || null;
}

function isGroupUrlAllowed(url) {
  return (
    typeof url === "string" &&
    (
      url.startsWith("https://") ||
      url.startsWith("http://")
    )
  );
}

function groupLinkKey(url) {
  if (!isGroupUrlAllowed(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);

    let path = parsed.pathname || "/";

    if (path.length > 1) {
      path = path.replace(/\/+$/, "");
    }

    return `${parsed.origin}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

async function getSavedArcifyGroups() {
  const result =
    await chrome.storage.local.get(
      ARCIFY_GROUPS_KEY
    );

  return Array.isArray(
    result[ARCIFY_GROUPS_KEY]
  )
    ? result[ARCIFY_GROUPS_KEY]
    : [];
}

async function saveArcifyGroups(groups) {
  await chrome.storage.local.set({
    [ARCIFY_GROUPS_KEY]: groups
  });

  console.log(
    "Arcify saved groups:",
    groups
  );
}

async function captureGroupsFromWindow(windowId) {
  const window =
    await chrome.windows.get(windowId);

  if (
    window.type !== "normal" ||
    window.incognito
  ) {
    throw new Error(
      "Arcify can only save groups from a normal Chrome window."
    );
  }

  const tabs =
    await chrome.tabs.query({
      windowId
    });

  const nativeGroups =
    await chrome.tabGroups.query({
      windowId
    });

  if (nativeGroups.length === 0) {
    await saveArcifyGroups([]);

    return {
      ok: true,
      groups: []
    };
  }

  const titles =
    nativeGroups.map(group =>
      (group.title || "").trim()
    );

  if (titles.some(title => !title)) {
    throw new Error(
      "Please give every tab group a name before saving it."
    );
  }

  const duplicateTitles =
    titles.filter(
      (title, index) =>
        titles.indexOf(title) !== index
    );

  if (duplicateTitles.length > 0) {
    throw new Error(
      "Please give every Arcify group a unique name."
    );
  }

  const captured = [];

  for (const group of nativeGroups) {
    const members =
      tabs
        .filter(
          tab =>
            tab.groupId === group.id &&
            !tab.pinned
        )
        .sort(
          (a, b) =>
            a.index - b.index
        );

    const links = [];
    const seen = new Set();

    for (const tab of members) {
      const url = groupTabUrl(tab);

      if (!isGroupUrlAllowed(url)) {
        continue;
      }

      const key =
        groupLinkKey(url);

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);

      links.push({
        name:
          tab.title ||
          key,

        url,
        key
      });
    }

    if (links.length === 0) {
      continue;
    }

    captured.push({
      title: group.title.trim(),
      color: group.color,
      collapsed: group.collapsed,
      links,
      firstIndex:
        members.length
          ? members[0].index
          : Number.MAX_SAFE_INTEGER
    });
  }

  captured.sort(
    (a, b) =>
      a.firstIndex - b.firstIndex
  );

  const cleaned =
    captured.map(group => ({
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      links: group.links
    }));

  await saveArcifyGroups(cleaned);

  return {
    ok: true,
    groups: cleaned
  };
}

async function findOrCreateTabForGroup(
  windowId,
  savedLink,
  targetGroupId,
  usedTabIds
) {
  const tabs =
    await chrome.tabs.query({
      windowId
    });

  let candidate =
    tabs.find(tab => {
      if (
        usedTabIds.has(tab.id) ||
        tab.pinned
      ) {
        return false;
      }

      if (
        targetGroupId !== null &&
        tab.groupId !== targetGroupId
      ) {
        return false;
      }

      return (
        groupLinkKey(
          groupTabUrl(tab)
        ) ===
        savedLink.key
      );
    });

  if (!candidate) {
    candidate =
      tabs.find(tab => {
        if (
          usedTabIds.has(tab.id) ||
          tab.pinned
        ) {
          return false;
        }

        return (
          groupLinkKey(
            groupTabUrl(tab)
          ) ===
          savedLink.key
        );
      });
  }

  if (candidate) {
    usedTabIds.add(
      candidate.id
    );

    return {
      tab: candidate,
      created: false
    };
  }

  const created =
    await chrome.tabs.create({
      windowId,
      url: savedLink.url,
      active: false
    });

  usedTabIds.add(
    created.id
  );

  return {
    tab: created,
    created: true
  };
}

async function ensureOneArcifyGroup(
  windowId,
  savedGroup
) {
  const nativeGroups =
    await chrome.tabGroups.query({
      windowId
    });

  let targetGroup =
    nativeGroups.find(
      group =>
        group.title ===
        savedGroup.title
    ) || null;

  const usedTabIds =
    new Set();

  const tabIds = [];

  for (
    const link of savedGroup.links
  ) {
    const result =
      await findOrCreateTabForGroup(
        windowId,
        link,
        targetGroup
          ? targetGroup.id
          : null,
        usedTabIds
      );

    tabIds.push(
      result.tab.id
    );

  }

  if (tabIds.length === 0) {
    return null;
  }

  let groupId;

  if (targetGroup) {
    groupId =
      targetGroup.id;

    const tabs =
      await chrome.tabs.query({
        windowId
      });

    const needsGrouping =
      tabIds.filter(tabId => {
        const tab =
          tabs.find(
            candidate =>
              candidate.id === tabId
          );

        return (
          tab &&
          tab.groupId !== groupId
        );
      });

    if (needsGrouping.length) {
      await chrome.tabs.group({
        groupId,
        tabIds: needsGrouping
      });
    }
  } else {
    groupId =
      await chrome.tabs.group({
        tabIds,
        createProperties: {
          windowId
        }
      });
  }

  await chrome.tabGroups.update(
    groupId,
    {
      title: savedGroup.title,
      color: savedGroup.color,
      collapsed:
        savedGroup.collapsed
    }
  );

  return groupId;
}

async function arrangeArcifyGroups(
  windowId,
  savedGroups
) {
  const tabs =
    await chrome.tabs.query({
      windowId
    });

  const pinnedCount =
    tabs.filter(
      tab => tab.pinned
    ).length;

  let targetIndex =
    pinnedCount;

  for (
    const savedGroup of savedGroups
  ) {
    const groups =
      await chrome.tabGroups.query({
        windowId
      });

    const nativeGroup =
      groups.find(
        group =>
          group.title ===
          savedGroup.title
      );

    if (!nativeGroup) {
      continue;
    }

    try {
      await chrome.tabGroups.move(
        nativeGroup.id,
        {
          index: targetIndex
        }
      );
    } catch {
    }

    const members =
      await chrome.tabs.query({
        windowId,
        groupId:
          nativeGroup.id
      });

    targetIndex +=
      Math.max(
        members.length,
        1
      );
  }
}

async function ensureArcifyGroupsInWindow(
  windowId
) {
  let window;

  try {
    window =
      await chrome.windows.get(
        windowId
      );
  } catch {
    return;
  }

  if (
    window.type !== "normal" ||
    window.incognito
  ) {
    return;
  }

  const savedGroups =
    await getSavedArcifyGroups();

  if (!savedGroups.length) {
    return;
  }

  for (
    const savedGroup of savedGroups
  ) {
    try {
      await ensureOneArcifyGroup(
        windowId,
        savedGroup
      );
    } catch (error) {
      console.error(
        `Arcify could not restore group ${savedGroup.title}:`,
        error
      );
    }
  }

  await arrangeArcifyGroups(
    windowId,
    savedGroups
  );
}

async function ensureArcifyGroupsInAllWindows() {
  const windows =
    await chrome.windows.getAll({
      windowTypes: ["normal"]
    });

  for (const window of windows) {
    if (!window.incognito) {
      await ensureArcifyGroupsInWindow(
        window.id
      );
    }
  }
}

chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {
    if (
      !message ||
      typeof message.type !==
        "string"
    ) {
      return;
    }

    if (
      message.type ===
      "ARCIFY_SAVE_GROUPS"
    ) {
      queueGroupOperation(
        async () => {
          const result =
            await captureGroupsFromWindow(
              message.windowId
            );

          await ensureArcifyGroupsInAllWindows();

          return result;
        }
      )
        .then(sendResponse)
        .catch(error => {
          sendResponse({
            ok: false,
            error: error.message
          });
        });

      return true;
    }

    if (
      message.type ===
      "ARCIFY_APPLY_GROUPS"
    ) {
      queueGroupOperation(
        async () => {
          await ensureArcifyGroupsInAllWindows();

          return {
            ok: true
          };
        }
      )
        .then(sendResponse)
        .catch(error => {
          sendResponse({
            ok: false,
            error: error.message
          });
        });

      return true;
    }

    if (
      message.type ===
      "ARCIFY_CLEAR_GROUPS"
    ) {
      saveArcifyGroups([])
        .then(() => {
          sendResponse({
            ok: true
          });
        })
        .catch(error => {
          sendResponse({
            ok: false,
            error: error.message
          });
        });

      return true;
    }
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

    setTimeout(() => {
      queueGroupOperation(
        () =>
          ensureArcifyGroupsInWindow(
            window.id
          )
      );
    }, 600);
  }
);

chrome.runtime.onStartup.addListener(
  () => {
    setTimeout(() => {
      queueGroupOperation(
        () =>
          ensureArcifyGroupsInAllWindows()
      );
    }, 1000);
  }
);
