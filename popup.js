"use strict";

const CONFIG_KEY = "arcifyConfigV2";
const statusEl = document.getElementById("status");
const groupsEl = document.getElementById("groups");
const favoriteCountEl = document.getElementById("favorite-count");
const groupCountEl = document.getElementById("group-count");
const buttons = [...document.querySelectorAll("button")];

function setBusy(isBusy) {
  for (const button of buttons) {
    button.disabled = isBusy;
  }
}

function setStatus(message = "", isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? "error" : "";
}

async function currentWindowId() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return Number.isInteger(tab?.windowId) ? tab.windowId : null;
}

async function send(type, extra = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type, ...extra });

    if (!response?.ok) {
      throw new Error(response?.error || "Arcify could not complete the request.");
    }

    return response;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Arcify could not complete the request.");
  }
}

async function render() {
  const [{ [CONFIG_KEY]: config }, status] = await Promise.all([
    chrome.storage.local.get(CONFIG_KEY),
    send("ARCIFY_GET_STATUS")
  ]);

  favoriteCountEl.textContent = String(status.favorites ?? 0);
  groupCountEl.textContent = String(status.groups ?? 0);
  groupsEl.replaceChildren();

  const groups = Array.isArray(config?.groups) ? config.groups : [];

  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No groups saved.";
    groupsEl.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const row = document.createElement("div");
    row.className = "group-row";

    const title = document.createElement("span");
    title.textContent = String(group.title || "Untitled");

    const count = document.createElement("span");
    count.textContent = `${Array.isArray(group.links) ? group.links.length : 0} links`;

    row.append(title, count);
    groupsEl.appendChild(row);
  }
}

async function run(action, successMessage) {
  setBusy(true);
  setStatus("Working…");

  try {
    await action();
    await render();
    setStatus(successMessage);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function withCurrentWindow(type) {
  const windowId = await currentWindowId();

  if (windowId === null) {
    throw new Error("Arcify could not determine the current Chrome window.");
  }

  return send(type, { windowId });
}

document.getElementById("save-workspace").addEventListener("click", () => {
  run(
    () => withCurrentWindow("ARCIFY_SAVE_WORKSPACE"),
    "Saved this window as the Arcify workspace."
  );
});

document.getElementById("open-window").addEventListener("click", () => {
  run(
    () => send("ARCIFY_OPEN_WINDOW"),
    "Opened a new Arcify window."
  );
});

document.getElementById("restore-favorites").addEventListener("click", () => {
  run(
    () => withCurrentWindow("ARCIFY_RESTORE_FAVORITES"),
    "Restored saved favorites in this window."
  );
});

document.getElementById("restore-groups").addEventListener("click", () => {
  run(
    () => withCurrentWindow("ARCIFY_RESTORE_GROUPS"),
    "Restored saved groups in this window."
  );
});

document.getElementById("save-favorites").addEventListener("click", () => {
  run(
    () => withCurrentWindow("ARCIFY_SAVE_FAVORITES"),
    "Saved the pinned tabs from this window."
  );
});

document.getElementById("save-groups").addEventListener("click", () => {
  run(
    () => withCurrentWindow("ARCIFY_SAVE_GROUPS"),
    "Saved the tab groups from this window."
  );
});

document.getElementById("clear-all").addEventListener("click", () => {
  if (!window.confirm("Clear all saved Arcify favorites and groups? Existing Chrome tabs will not be closed.")) {
    return;
  }

  run(
    () => send("ARCIFY_CLEAR_ALL"),
    "Cleared the saved Arcify workspace."
  );
});

render().catch(error => {
  setStatus(error.message, true);
});
