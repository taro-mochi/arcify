const GROUPS_KEY =
  "arcifyGroupsV1";

const groupsEl =
  document.getElementById(
    "groups"
  );

const statusEl =
  document.getElementById(
    "status"
  );

function setStatus(
  text,
  isError = false
) {
  statusEl.textContent = text;

  statusEl.className =
    isError
      ? "danger"
      : "";
}

async function renderGroups() {
  const result =
    await chrome.storage.local.get(
      GROUPS_KEY
    );

  const groups =
    Array.isArray(
      result[GROUPS_KEY]
    )
      ? result[GROUPS_KEY]
      : [];

  if (!groups.length) {
    groupsEl.innerHTML =
      "<div class='count'>No persistent groups saved yet.</div>";

    return;
  }

  groupsEl.innerHTML =
    groups
      .map(group => `
        <div class="group">
          <strong>${escapeHtml(group.title)}</strong>
          <span class="count">
            ${group.links.length} links
          </span>
        </div>
      `)
      .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document
  .getElementById("save")
  .addEventListener(
    "click",
    async () => {
      setStatus(
        "Saving..."
      );

      const tabs =
        await chrome.tabs.query({
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

      const response =
        await chrome.runtime.sendMessage({
          type:
            "ARCIFY_SAVE_GROUPS",

          windowId:
            tabs[0].windowId
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
    }
  );

document
  .getElementById("apply")
  .addEventListener(
    "click",
    async () => {
      setStatus(
        "Applying..."
      );

      const response =
        await chrome.runtime.sendMessage({
          type:
            "ARCIFY_APPLY_GROUPS"
        });

      if (!response?.ok) {
        setStatus(
          response?.error ||
            "Could not apply groups.",
          true
        );

        return;
      }

      setStatus(
        "Groups applied."
      );
    }
  );

document
  .getElementById("clear")
  .addEventListener(
    "click",
    async () => {
      const response =
        await chrome.runtime.sendMessage({
          type:
            "ARCIFY_CLEAR_GROUPS"
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
    }
  );

renderGroups();
