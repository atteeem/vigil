// Seeds the exact sources in data/source-plugin.json, using the checks recorded in
// data/source-plugin-verification.json. Rules:
//  - nothing is guessed: URLs come from the JSON verbatim (canonicalised, never rewritten);
//  - a source is ENABLED only when verified AND an existing adapter can ingest it
//    (an RSS 2.0 feed that parsed with linked items). Telegram/X/unreachable/unknown-feed
//    sources are recorded and stay disabled;
//  - existing sources are matched by exact URL / handle, never duplicated, never renamed,
//    and never switched on;
//  - entries with no exact URL are NEEDS_VERIFICATION placeholders.
import { readFileSync } from "node:fs";
import { canonicalizeUrl, identityKeys, parseTelegramHandle, parseXUrl, siteHost } from "./source-identity.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));

const registrable = (host) => (host ? host.split(".").slice(-2).join(".") : "");

/** The feed to poll for a website entry: the supplied one if it is RSS, else the FIRST feed the
 * site itself advertises that parses as RSS 2.0 — never a comments/stories feed. */
function chooseFeed(entry, check) {
  if (entry.feed) return check?.suppliedFeed?.isRss ? check.suppliedFeed : null;
  const candidates = (check?.advertisedFeeds ?? []).filter((f) => f.isRss && !/\/comments\/|web-stories/i.test(f.url));
  return candidates[0] ?? null;
}

function decide(entry, check, checkedAt) {
  const out = {
    type: "manual",
    platform: "website",
    platformHandle: null,
    socialProfileUrl: null,
    canonicalSourceUrl: entry.website ? canonicalizeUrl(entry.website) : null,
    feedUrl: null,
    url: null,
    telegramHandle: null,
    verificationStatus: "needs_verification",
    verifiedAt: null,
    verificationNotes: "",
    enabled: false,
    autoIngest: false,
    permissionStatus: "unauthorized",
  };
  const notes = [];
  const site = check?.site;
  const siteOk = Boolean(site?.ok);
  if (site) {
    if (site.blocked) notes.push(`Site answered HTTP ${site.status} to an automated request (not worked around).`);
    else if (!site.ok) notes.push(`Site not reachable (${site.error ?? `HTTP ${site.status}`}).`);
    else notes.push(`Site reachable (HTTP ${site.status}, title "${site.title}"${siteHost(site.finalUrl) !== siteHost(entry.website) ? `, redirected to ${site.finalUrl}` : ""}).`);
  }

  if (entry.telegram) {
    const handle = parseTelegramHandle(entry.telegram);
    out.type = "telegram";
    out.platform = "telegram";
    out.platformHandle = handle;
    out.telegramHandle = `@${handle}`;
    out.socialProfileUrl = canonicalizeUrl(entry.telegram);
    const tg = check?.telegram;
    if (!tg || tg.error) {
      out.verificationStatus = "inaccessible";
      notes.push(`Telegram page could not be loaded (${tg?.error ?? "no check recorded"}).`);
    } else if (!tg.exists) {
      out.verificationStatus = "rejected";
      notes.push(`t.me/${handle} did not resolve to a public account.`);
    } else {
      // Identity/public existence confirmed; but Vigil's Telegram access needs authorised credentials.
      out.verificationStatus = "needs_verification";
      notes.push(`Public ${tg.isChannel ? "channel" : "account"} exists: "${tg.title}"${tg.extra ? ` (${tg.extra})` : ""}. Not verified as active/official for Vigil's access method: Telegram ingestion needs authorised credentials, so it stays disabled.`);
    }
  } else if (entry.x) {
    const x = parseXUrl(entry.x);
    out.platform = "x";
    out.platformHandle = x?.handle ?? null;
    out.socialProfileUrl = canonicalizeUrl(entry.x);
    out.verificationStatus = "needs_verification";
    notes.push("X account not fetched: X requires a login and Vigil has no authorised X adapter. Identity, activity and public access are unverified; left disabled.");
  } else {
    const feed = chooseFeed(entry, check);
    if (feed) {
      const sameSite = registrable(siteHost(feed.finalUrl ?? feed.url)) === registrable(siteHost(entry.website));
      out.type = "rss";
      out.platform = "rss";
      out.feedUrl = canonicalizeUrl(feed.url);
      out.url = out.feedUrl;
      if (siteOk && sameSite) {
        out.verificationStatus = "verified";
        out.verifiedAt = checkedAt;
        out.enabled = true;
        out.autoIngest = true;
        out.permissionStatus = "authorized";
        notes.push(`Feed ${out.feedUrl} parsed as RSS 2.0 with ${feed.withLink} linked items (advertised by the site itself).`);
      } else {
        notes.push(`Feed ${out.feedUrl} parses, but the site could not be confirmed as the supplied organisation (same-site ${sameSite}, reachable ${siteOk}).`);
      }
    } else if (entry.feed) {
      notes.push(`Supplied feed URL ${entry.feed} did not return an RSS 2.0 feed (HTTP ${check?.suppliedFeed?.status}, ${check?.suppliedFeed?.contentType || "no content type"}). Not auto-substituted with another feed.`);
    } else if (siteOk) {
      out.verificationStatus = "verified";
      out.verifiedAt = checkedAt;
      notes.push("Site verified as reachable; no RSS 2.0 feed is advertised, so it is a reference/specialist source and is not ingested.");
    } else {
      out.verificationStatus = site?.blocked || site?.error || site?.status ? "inaccessible" : "needs_verification";
    }
  }
  if (entry.note) notes.push(entry.note);
  out.verificationNotes = notes.join(" ");
  return out;
}

export async function seedSourcePlugin(prisma) {
  const plugin = read("source-plugin.json");
  const verification = read("source-plugin-verification.json");
  const checkedAt = new Date(verification.checkedAt);

  const existing = await prisma.source.findMany();
  const index = new Map();
  const register = (s) => {
    for (const key of identityKeys({ canonicalSourceUrl: s.canonicalSourceUrl, feedUrl: s.feedUrl ?? (s.type === "rss" ? s.url : null), socialProfileUrl: s.socialProfileUrl, platform: s.platform, platformHandle: s.platformHandle, telegramHandle: s.telegramHandle })) {
      // A site key only identifies a "website" row; feeds and handles identify their own channel.
      if (key.startsWith("site:") && s.platform !== "website") continue;
      if (!index.has(key)) index.set(key, s);
    }
  };
  existing.forEach(register);

  const conflicts = new Map((await prisma.conflict.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
  const link = async (sourceId, list) => {
    for (const [slug, scope] of list ?? []) {
      const conflictId = conflicts.get(slug);
      if (!conflictId) continue;
      await prisma.sourceConflictLink.upsert({
        where: { sourceId_conflictId: { sourceId, conflictId } },
        update: {},
        create: { sourceId, conflictId, scope },
      });
    }
  };

  let created = 0;
  let matched = 0;
  for (const entry of plugin.sources) {
    const check = verification.results[entry.key];
    const d = decide(entry, check, checkedAt);
    const keys = identityKeys(d).filter((k) => !k.startsWith("site:") || d.type === "manual");
    // Channel-level match only: same feed, same account handle/URL, or (for a website-only row) same site.
    const channelKeys = d.type === "manual" && d.platform === "website" ? keys : keys.filter((k) => !k.startsWith("site:"));
    const hit = channelKeys.map((k) => index.get(k)).find(Boolean);
    const identity = {
      canonicalSourceUrl: d.canonicalSourceUrl,
      feedUrl: d.feedUrl,
      socialProfileUrl: d.socialProfileUrl,
      platform: d.platform,
      platformHandle: d.platformHandle,
      independenceClass: entry.class ?? null,
      claimPolicy: entry.claim ?? null,
      verificationStatus: d.verificationStatus,
      verifiedAt: d.verifiedAt,
      verificationNotes: d.verificationNotes,
    };
    let source;
    if (hit) {
      matched += 1;
      // Fill identity only; never rename, re-role or enable an existing source, and never
      // overwrite an admin's own classification with ours.
      const patch = {};
      for (const [k, v] of Object.entries(identity)) {
        if (["verificationStatus", "verifiedAt", "verificationNotes"].includes(k)) continue;
        if ((hit[k] === null || hit[k] === undefined) && v !== null) patch[k] = v;
      }
      if (hit.verificationStatus === "needs_verification" && d.verificationStatus !== "needs_verification") Object.assign(patch, { verificationStatus: d.verificationStatus, verifiedAt: d.verifiedAt, verificationNotes: d.verificationNotes });
      source = Object.keys(patch).length ? await prisma.source.update({ where: { id: hit.id }, data: patch }) : hit;
    } else {
      source = await prisma.source.create({
        data: {
          name: entry.name,
          type: d.type,
          url: d.url,
          telegramHandle: d.telegramHandle,
          country: entry.country ?? null,
          language: entry.language ?? null,
          sourceCategory: entry.category ?? null,
          sourceRole: entry.role ?? null,
          reliabilityTier: null,
          permissionStatus: d.permissionStatus,
          enabled: d.enabled,
          autoIngest: d.autoIngest,
          autoProcessing: true,
          pollIntervalMinutes: 30,
          ...identity,
        },
      });
      created += 1;
      register(source);
    }
    await link(source.id, entry.conflicts);
  }

  // Placeholders with no verified exact URL: recorded, disabled, never polled.
  for (const nv of plugin.needsVerification) {
    const name = nv.name;
    const found = await prisma.source.findFirst({ where: { name, type: "manual" } });
    const data = { canonicalSourceUrl: nv.website ? canonicalizeUrl(nv.website) : null, verificationStatus: "needs_verification", verificationNotes: `NEEDS_VERIFICATION: ${nv.reason}`, platform: "manual" };
    const source = found
      ? found
      : await prisma.source.create({ data: { name, type: "manual", sourceCategory: "Needs verification", permissionStatus: "unauthorized", enabled: false, autoIngest: false, autoProcessing: true, ...data } });
    if (!found) created += 1;
    await link(source.id, nv.conflicts);
  }

  // References: individual articles/posts and non-feed pages. Kept as candidates with the exact URL.
  let references = 0;
  for (const ref of plugin.references) {
    const conflictId = conflicts.get(ref.conflict) ?? null;
    const url = canonicalizeUrl(ref.url) ?? ref.url;
    const dupe = await prisma.sourceCandidate.findFirst({ where: { url, conflictId } });
    if (dupe) continue;
    await prisma.sourceCandidate.create({ data: { name: ref.name, url, conflictId, sourceType: ref.kind === "social_post" ? "social" : ref.kind === "specialist_reference" ? "monitor" : "news", status: "candidate", notes: `Reference (${ref.kind}), exact URL supplied by the project owner. ${ref.note ?? ""}`.trim() } });
    references += 1;
  }

  console.log(`Seeded source plugin: ${plugin.sources.length} sources (${created} new, ${matched} matched existing), ${plugin.needsVerification.length} needs-verification placeholders, ${references} new references.`);
}
