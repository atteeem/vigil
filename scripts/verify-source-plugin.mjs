// Verifies the exact URLs in data/source-plugin.json where access permits, and writes
// data/source-plugin-verification.json. It fetches each supplied page ONCE (plus the
// feeds that page itself advertises) — it never guesses a URL and never works around
// a block: a 401/403/429 is recorded as "blocked", not bypassed. X is not fetched
// (login wall, no authorised adapter); Telegram is checked only by loading the exact
// public account URL supplied (no message content is read).
import { readFileSync, writeFileSync } from "node:fs";

const plugin = JSON.parse(readFileSync(new URL("../data/source-plugin.json", import.meta.url), "utf8"));
const UA = "Mozilla/5.0 (compatible; VigilSourceVerification/1.0; +local-development)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*" }, signal: AbortSignal.timeout(25000) });
      const text = await res.text().catch(() => "");
      return { ok: res.ok, status: res.status, finalUrl: res.url, contentType: res.headers.get("content-type") ?? "", text: text.slice(0, 600000) };
    } catch (err) {
      last = err;
      await sleep(1500);
    }
  }
  return { ok: false, status: 0, error: String(last?.cause?.code ?? last?.message ?? last), finalUrl: url, contentType: "", text: "" };
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const title = (html) => decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim()).slice(0, 140);

function advertisedFeeds(html, base) {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    const type = /type=["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (!/application\/(rss|atom)\+xml/.test(type)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      out.push({ url: new URL(decode(href), base).toString(), kind: type.includes("atom") ? "atom" : "rss" });
    } catch {
      /* skip */
    }
  }
  return [...new Map(out.map((f) => [f.url, f])).values()];
}

/** Same shape the RSS adapter needs: RSS 2.0 <item> elements carrying a <link>. */
function rssStats(xml) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const withLink = items.filter((i) => /<link[^>]*>\s*(?:<!\[CDATA\[)?\s*https?:\/\//i.test(i));
  return { items: items.length, withLink: withLink.length, sampleLink: /<link[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^<\s\]]+)/i.exec(withLink[0] ?? "")?.[1] ?? null };
}

async function checkFeed(url) {
  const r = await get(url);
  const looksXml = /xml|rss/i.test(r.contentType) || /^\s*<\?xml|<rss[\s>]/i.test(r.text.slice(0, 400));
  const stats = looksXml ? rssStats(r.text) : { items: 0, withLink: 0, sampleLink: null };
  return { url, status: r.status, contentType: r.contentType, finalUrl: r.finalUrl, ...stats, isRss: looksXml && stats.withLink > 0, atomOnly: looksXml && /<feed[\s>]/i.test(r.text.slice(0, 600)) };
}

async function checkSite(url) {
  const r = await get(url);
  const blocked = [401, 403, 429].includes(r.status);
  const res = { requested: url, status: r.status, ok: r.ok, blocked, finalUrl: r.finalUrl, title: r.ok ? title(r.text) : null, error: r.error ?? null, feeds: [] };
  if (r.ok) {
    res.feeds = advertisedFeeds(r.text, r.finalUrl);
    // Feed links this page merely mentions (for an RSS index page), recorded for reference only.
    res.mentionedFeedLinks = [...new Set((r.text.match(/href=["']([^"']+(?:\.xml|\/rss[^"']*|\/feed[^"']*))["']/gi) ?? []).map((m) => m.slice(6, -1)))].slice(0, 15);
  }
  return res;
}

async function checkTelegram(url) {
  const r = await get(url);
  const t = /<div class="tgme_page_title"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i.exec(r.text)?.[1] ?? /<meta property="og:title" content="([^"]*)"/i.exec(r.text)?.[1] ?? "";
  const extra = decode((/<div class="tgme_page_extra"[^>]*>([\s\S]*?)<\/div>/i.exec(r.text)?.[1] ?? "").replace(/<[^>]+>/g, "").trim());
  const desc = decode(/<meta property="og:description" content="([^"]*)"/i.exec(r.text)?.[1] ?? "").slice(0, 160);
  const isChannel = /subscribers|members/i.test(extra) || /tgme_channel_info/.test(r.text);
  return { requested: url, status: r.status, ok: r.ok, exists: r.ok && Boolean(t) && !/^Telegram: (Contact|Launch)/i.test(t) && (isChannel || extra.length > 0), title: decode(t).slice(0, 120), extra: extra.slice(0, 80), description: desc, isChannel, error: r.error ?? null };
}

const results = {};
for (const s of plugin.sources) {
  const row = { key: s.key, name: s.name };
  if (s.website) {
    row.site = await checkSite(s.website);
    await sleep(500);
  }
  if (s.feed) {
    row.suppliedFeed = await checkFeed(s.feed);
    await sleep(400);
  } else if (row.site?.feeds?.length) {
    // Only feeds the site itself advertises, RSS 2.0 only (the adapter does not read Atom).
    row.advertisedFeeds = [];
    for (const f of row.site.feeds.filter((x) => x.kind === "rss").slice(0, 3)) {
      row.advertisedFeeds.push(await checkFeed(f.url));
      await sleep(400);
    }
  }
  if (s.telegram) {
    row.telegram = await checkTelegram(s.telegram);
    await sleep(600);
  }
  if (s.x) row.x = { requested: s.x, skipped: "X requires a login and Vigil has no authorised X adapter; account not fetched." };
  results[s.key] = row;
  const flags = [row.site ? `site=${row.site.status}${row.site.blocked ? "(blocked)" : ""}` : "", row.suppliedFeed ? `feed=${row.suppliedFeed.isRss ? "rss" : "NOT-RSS"}` : "", row.advertisedFeeds ? `adv=${row.advertisedFeeds.filter((f) => f.isRss).length}/${row.advertisedFeeds.length}` : "", row.telegram ? `tg=${row.telegram.exists ? "exists" : "no"}(${row.telegram.title})` : "", row.x ? "x=skipped" : ""].filter(Boolean).join(" ");
  console.log(s.key.padEnd(32), flags);
}

const report = { checkedAt: new Date().toISOString(), note: "Generated by scripts/verify-source-plugin.mjs. Seeder reads this; do not edit by hand.", results };
writeFileSync(new URL("../data/source-plugin-verification.json", import.meta.url), JSON.stringify(report, null, 1));
console.log(`\nwrote data/source-plugin-verification.json (${Object.keys(results).length} sources)`);
