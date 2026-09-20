// Plain-JS mirror of lib/sources/identity.ts for the seed script (which runs under bare
// `node`). tests/source-plugin.spec.ts asserts both implementations agree.

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|s|t)$/i;

export function canonicalizeUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export function urlKey(input) {
  if (!input) return null;
  const canonical = canonicalizeUrl(input);
  if (!canonical) return null;
  const u = new URL(canonical);
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}${path === "" ? "" : u.search}`;
}

export function siteHost(input) {
  const canonical = input ? canonicalizeUrl(input) : null;
  return canonical ? new URL(canonical).hostname.replace(/^www\./, "") : null;
}

export function parseTelegramHandle(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^@[A-Za-z0-9_]{4,}$/.test(trimmed)) return trimmed.slice(1);
  const canonical = canonicalizeUrl(trimmed);
  if (!canonical) return null;
  const u = new URL(canonical);
  if (!/^(www\.)?(t|telegram)\.me$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const handle = parts[0] === "s" ? parts[1] : parts[0];
  return handle && /^[A-Za-z0-9_]{4,}$/.test(handle) ? handle : null;
}

export function parseXUrl(input) {
  if (!input) return null;
  const canonical = canonicalizeUrl(input);
  if (!canonical) return null;
  const u = new URL(canonical);
  if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const handle = parts[0];
  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  const statusId = parts[1] === "status" && parts[2] && /^\d+$/.test(parts[2]) ? parts[2] : null;
  return { handle, statusId };
}

export function identityKeys(f) {
  const keys = [];
  const add = (prefix, value) => value && keys.push(`${prefix}:${value}`);
  add("site", urlKey(f.canonicalSourceUrl));
  add("feed", urlKey(f.feedUrl));
  add("social", urlKey(f.socialProfileUrl));
  const handle = String(f.platformHandle ?? f.telegramHandle ?? "").replace(/^@/, "").toLowerCase();
  if (handle && f.platform) add("handle", `${f.platform}/${handle}`);
  else if (handle && f.telegramHandle) add("handle", `telegram/${handle}`);
  return keys;
}
