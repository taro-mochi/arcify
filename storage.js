(() => {
  "use strict";

  const CONFIG_KEY = "arcifyConfigV2";
  const LEGACY_FAVORITES_KEY = "pinnedSites";
  const LEGACY_GROUPS_KEY = "arcifyGroupsV1";
  const SCHEMA_VERSION = 2;
  const MAX_URL_LENGTH = 4096;
  const MAX_FAVORITES = 100;
  const MAX_GROUPS = 50;
  const MAX_LINKS_PER_GROUP = 100;
  const MAX_GROUP_TITLE_LENGTH = 80;

  const GROUP_COLORS = new Set([
    "grey",
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange"
  ]);

  const SENSITIVE_QUERY_PARAMETER = /(?:^|_)(?:access_?token|refresh_?token|auth|authorization|api_?key|client_?secret|password|passwd|secret|session|session_?id|signature|signed|sig|sso|ticket|jwt|bearer|code)(?:$|_)/i;

  function sanitizeUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
      return null;
    }

    let url;

    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    if (url.username || url.password) {
      return null;
    }

    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAMETER.test(key)) {
        url.searchParams.delete(key);
      }
    }

    return url.toString();
  }

  function favoriteKey(rawUrl) {
    const sanitized = sanitizeUrl(rawUrl);

    if (!sanitized) {
      return null;
    }

    try {
      return new URL(sanitized).origin;
    } catch {
      return null;
    }
  }

  function linkKey(rawUrl) {
    const sanitized = sanitizeUrl(rawUrl);

    if (!sanitized) {
      return null;
    }

    try {
      const url = new URL(sanitized);
      let path = url.pathname || "/";

      if (path.length > 1) {
        path = path.replace(/\/+$/, "");
      }

      return `${url.origin}${path}${url.search}`;
    } catch {
      return null;
    }
  }

  function normalizeFavorites(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    const favorites = [];
    const seen = new Set();

    for (const item of value.slice(0, MAX_FAVORITES)) {
      const rawUrl = typeof item === "string" ? item : item?.url;
      const url = sanitizeUrl(rawUrl);
      const key = favoriteKey(url);

      if (!url || !key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      favorites.push({ url, key });
    }

    return favorites;
  }

  function normalizeGroupTitle(value) {
    if (typeof value !== "string") {
      return null;
    }

    const title = value.trim().slice(0, MAX_GROUP_TITLE_LENGTH);
    return title || null;
  }

  function normalizeGroups(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    const groups = [];
    const seenTitles = new Set();

    for (const item of value.slice(0, MAX_GROUPS)) {
      const title = normalizeGroupTitle(item?.title);

      if (!title || seenTitles.has(title)) {
        continue;
      }

      const color = GROUP_COLORS.has(item?.color) ? item.color : "grey";
      const links = [];
      const seenLinks = new Set();

      for (const link of Array.isArray(item?.links) ? item.links.slice(0, MAX_LINKS_PER_GROUP) : []) {
        const rawUrl = typeof link === "string" ? link : link?.url;
        const url = sanitizeUrl(rawUrl);
        const key = linkKey(url);

        if (!url || !key || seenLinks.has(key)) {
          continue;
        }

        seenLinks.add(key);
        links.push({ url, key });
      }

      if (links.length === 0) {
        continue;
      }

      seenTitles.add(title);
      groups.push({
        title,
        color,
        collapsed: item?.collapsed !== false,
        links
      });
    }

    return groups;
  }

  function normalizeConfig(value) {
    return {
      schemaVersion: SCHEMA_VERSION,
      favorites: normalizeFavorites(value?.favorites),
      groups: normalizeGroups(value?.groups)
    };
  }

  async function readConfig() {
    const stored = await chrome.storage.local.get([
      CONFIG_KEY,
      LEGACY_FAVORITES_KEY,
      LEGACY_GROUPS_KEY
    ]);

    if (stored[CONFIG_KEY]) {
      return normalizeConfig(stored[CONFIG_KEY]);
    }

    const migrated = normalizeConfig({
      favorites: stored[LEGACY_FAVORITES_KEY],
      groups: stored[LEGACY_GROUPS_KEY]
    });

    await chrome.storage.local.set({
      [CONFIG_KEY]: migrated
    });

    return migrated;
  }

  async function writeConfig(value) {
    const config = normalizeConfig(value);

    await chrome.storage.local.set({
      [CONFIG_KEY]: config
    });

    return config;
  }

  async function replaceFavorites(favorites) {
    const config = await readConfig();
    config.favorites = normalizeFavorites(favorites);
    return writeConfig(config);
  }

  async function replaceGroups(groups) {
    const config = await readConfig();
    config.groups = normalizeGroups(groups);
    return writeConfig(config);
  }

  async function replaceWorkspace({ favorites, groups }) {
    return writeConfig({ favorites, groups });
  }

  async function clearFavorites() {
    return replaceFavorites([]);
  }

  async function clearGroups() {
    return replaceGroups([]);
  }

  async function clearAll() {
    return writeConfig({ favorites: [], groups: [] });
  }

  globalThis.ArcifyStorage = Object.freeze({
    CONFIG_KEY,
    GROUP_COLORS,
    sanitizeUrl,
    favoriteKey,
    linkKey,
    normalizeFavorites,
    normalizeGroups,
    readConfig,
    writeConfig,
    replaceFavorites,
    replaceGroups,
    replaceWorkspace,
    clearFavorites,
    clearGroups,
    clearAll
  });
})();
