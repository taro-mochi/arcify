const GROUPS_STORAGE_KEY = "arcifyGroupsV1";

const groupsEl = document.getElementById("groups");
const statusEl = document.getElementById("status");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = isError ? "danger" : "";
}

async function sendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

async function renderGroups() {
  const result = await chrome.storage.local.get(
    GROUPS_STORAGE_KEY
  );

  const groups = Array.isArray(
    result[GROUPS_STORAGE_KEY]
  )
    ? result[GROUPS_STORAGE_KEY]
    : [];

  groupsEl.replaceChildren();

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "count";
    empty.textContent =
      "No persistent groups saved yet.";

    groupsEl.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const row = document.createElement("div");
    row.className = "group";

    const title = document.createElement("strong");
    title.textContent = group.title;

    const count = document.createElement("span");
    count.className = "count";
    count.textContent =
      ` ${group.links.length} links`;

    row.append(title, count);
    groupsEl.appendChild(row);
  }
}

document
  .getElementById("save")
  .addEventListener("click", async () => {
    setStatus("Saving...");

    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tabs.length) {
      setStatus(
        "Could not determine the current window.",
        true
      );
      return;
    }

    const response = await sendMessage({
      type: "ARCIFY_SAVE_GROUPS",
      windowId: tabs[0].windowId
    });

    if (!response?.ok) {
      setStatus(
        response?.error ||
          "Could not save groups.",
        true
      );
      return;
    }

    await renderGroups();

    setStatus(
      `Saved ${response.groups.length} group(s).`
    );
  });

document
  .getElementById("apply")
  .addEventListener("click", async () => {
    setStatus("Applying...");

    const response = await sendMessage({
      type: "ARCIFY_APPLY_GROUPS"
    });

    if (!response?.ok) {
      setStatus(
        response?.error ||
          "Could not apply groups.",
        true
      );
      return;
    }

    setStatus("Groups applied.");
  });

document
  .getElementById("clear")
  .addEventListener("click", async () => {
    const response = await sendMessage({
      type: "ARCIFY_CLEAR_GROUPS"
    });

    if (!response?.ok) {
      setStatus(
        response?.error ||
          "Could not clear groups.",
        true
      );
      return;
    }

    await renderGroups();

    setStatus(
      "Saved groups cleared. Existing tabs were not closed."
    );
  });

renderGroups().catch(error => {
  setStatus(error.message, true);
});
