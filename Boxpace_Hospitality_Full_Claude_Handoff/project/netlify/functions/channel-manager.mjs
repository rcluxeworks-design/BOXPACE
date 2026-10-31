import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const db = () => getStore({ name: "boxpace-hospitality", region: "ap-southeast-1" });
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function authorized(request) {
  const secret = process.env.BOXPACE_DASHBOARD_PASSWORD || "";
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secret || !supplied) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function safeFeedUrl(value) {
  try {
    const normalized = String(value || "").trim().replace(/^webcal:\/\//i, "https://").replace(/^http:\/\//i, "https://");
    const url = new URL(normalized);
    const supported = ["airbnb.com", "booking.com", "vrbo.com", "expedia.com", "agoda.com", "makemytrip.com", "goibibo.com", "tripadvisor.com"];
    if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost" ||
        url.hostname.endsWith(".local") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) ||
        !supported.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    return url.toString();
  } catch { return null; }
}

function parseCalendar(text) {
  if (text.length > 1_000_000 || !text.includes("BEGIN:VCALENDAR")) throw new Error("This URL did not return a supported iCalendar feed.");
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = {}; continue; }
    if (line === "END:VEVENT" && current) {
      const start = current.start?.match(/^(\d{4})(\d{2})(\d{2})/);
      const end = current.end?.match(/^(\d{4})(\d{2})(\d{2})/);
      if (start && end && current.status !== "CANCELLED") {
        const from = `${start[1]}-${start[2]}-${start[3]}`;
        const to = `${end[1]}-${end[2]}-${end[3]}`;
        if (to > from) events.push({ from, to });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const match = line.match(/^(DTSTART|DTEND|STATUS)(?:;[^:]*)?:(.*)$/i);
    if (match) current[match[1].toLowerCase()] = match[2].trim().toUpperCase();
  }
  return events;
}

function datesFromEvents(events) {
  const dates = new Set();
  for (const { from, to } of events) {
    const cursor = new Date(`${from}T00:00:00Z`);
    const finish = new Date(`${to}T00:00:00Z`);
    for (let guard = 0; cursor < finish && guard < 740; guard++) {
      dates.add(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return [...dates].sort();
}

async function fetchCalendar(url) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(current, {
      signal: AbortSignal.timeout(7000),
      redirect: "manual",
      headers: { accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1", "user-agent": "BoxpaceCalendarSync/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The OTA calendar redirected without a destination.");
      current = safeFeedUrl(new URL(location, current).toString());
      if (!current) throw new Error("The OTA calendar redirected to an unsupported address. Re-export its HTTPS iCal link.");
      continue;
    }
    return response;
  }
  throw new Error("The OTA calendar redirected too many times. Re-export its HTTPS iCal link.");
}

async function refreshProperty(store, propertyId, suppliedFeeds) {
  if (!/^[\w-]{1,100}$/.test(propertyId)) throw new Error("Invalid property.");
  const property = await store.get(`property:${propertyId}`, { type: "json" });
  if (!property) throw new Error("Save this property in the Desk before connecting its calendars.");
  const feeds = suppliedFeeds || (await store.get(`channel-config:${propertyId}`, { type: "json" }))?.feeds || [];
  if (!Array.isArray(feeds) || feeds.length > 5) throw new Error("Add up to five OTA calendar links.");
  const previous = await store.get(`channel-state:${propertyId}`, { type: "json" });
  const previousFeeds = previous?.feedDates || {};
  const feedResults = await Promise.all(feeds.map(async (feed, index) => {
    const url = safeFeedUrl(feed.url);
    if (!url) return { label: String(feed.label || `Calendar ${index + 1}`).slice(0, 60), ok: false, error: "Use a public HTTPS iCalendar link." };
    const key = createHash("sha256").update(url).digest("hex");
    try {
      const response = await fetchCalendar(url);
      if (!response.ok) throw new Error(`Calendar returned HTTP ${response.status}.`);
      const body = await response.text();
      const events = parseCalendar(body);
      return { key, label: String(feed.label || `Calendar ${index + 1}`).slice(0, 60), ok: true, events, dates: datesFromEvents(events) };
    } catch (error) {
      const message = error.name === "TimeoutError" ? "Calendar request timed out. The last imported dates have been kept." : error instanceof TypeError ? "Could not reach this OTA calendar. Check that the exported HTTPS iCal link is current; the last imported dates have been kept." : `${(error.message || "Could not read calendar.").slice(0, 120)} The last imported dates have been kept.`;
      return { key, label: String(feed.label || `Calendar ${index + 1}`).slice(0, 60), ok: false, error: message, dates: previousFeeds[key]?.dates || [] };
    }
  }));
  const successful = feedResults.filter((item) => item.ok);
  const feedDates = Object.fromEntries(feedResults.map((item) => [item.key, { label: item.label, dates: item.dates, lastSuccessAt: item.ok ? new Date().toISOString() : (previousFeeds[item.key]?.lastSuccessAt || null) }]));
  const blockedDates = [...new Set(Object.values(feedDates).flatMap((item) => item.dates))].sort();
  const config = await store.get(`channel-config:${propertyId}`, { type: "json" }) || { token: randomBytes(32).toString("hex") };
  if (suppliedFeeds) config.feeds = suppliedFeeds.map((feed, index) => ({ label: String(feed.label || `Calendar ${index + 1}`).slice(0, 60), url: safeFeedUrl(feed.url) || "" }));
  config.token ||= randomBytes(32).toString("hex");
  config.updatedAt = new Date().toISOString();
  const snapshot = {
    propertyId,
    blockedDates,
    feedDates,
    feeds: feedResults.map(({ label, ok, error, events, dates }) => ({ label, ok, error, eventCount: events?.length || 0, retainedDates: ok ? 0 : dates?.length || 0 })),
    feedCount: feeds.length,
    successfulFeeds: successful.length,
    lastSyncAt: new Date().toISOString(),
  };
  await Promise.all([
    store.setJSON(`channel-config:${propertyId}`, config),
    store.setJSON(`channel-state:${propertyId}`, snapshot),
  ]);
  return { ...snapshot, exportToken: config.token };
}

export { db, refreshProperty };

export default async (request) => {
  if (!authorized(request)) return reply({ error: "Dashboard access is not configured or the password is incorrect." }, 401);
  const store = db();
  if (request.method === "GET") {
    const { blobs } = await store.list({ prefix: "property:" });
    const rows = await Promise.all(blobs.map(async ({ key }) => {
      const id = key.slice("property:".length);
      const [property, config, sync] = await Promise.all([
        store.get(key, { type: "json" }),
        store.get(`channel-config:${id}`, { type: "json" }),
        store.get(`channel-state:${id}`, { type: "json" }),
      ]);
      return property ? { propertyId: id, propertyName: property.name, feeds: config?.feeds || [], exportToken: config?.token || "", sync: sync || null } : null;
    }));
    return reply({ calendars: rows.filter(Boolean) });
  }
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  let data;
  try { data = await request.json(); } catch { return reply({ error: "Invalid request." }, 400); }
  try {
    if (data.action === "sync-one") return reply({ calendar: await refreshProperty(store, data.propertyId) });
    if (data.action === "configure") {
      const feeds = Array.isArray(data.feeds) ? data.feeds.filter((feed) => feed?.url?.trim()).map((feed) => ({ label: feed.label, url: feed.url.trim() })) : [];
      if (feeds.length > 5) return reply({ error: "You can connect up to five OTA calendars per property." }, 400);
      if (feeds.some((feed) => !safeFeedUrl(feed.url))) return reply({ error: "Each calendar link must be a public HTTPS iCalendar URL." }, 400);
      const prior = await store.get(`channel-config:${data.propertyId}`, { type: "json" });
      await store.setJSON(`channel-config:${data.propertyId}`, { feeds, token: prior?.token || randomBytes(32).toString("hex") });
      return reply({ calendar: await refreshProperty(store, data.propertyId, feeds) });
    }
    if (data.action === "sync-all") {
      const { blobs } = await store.list({ prefix: "channel-config:" });
      const results = await Promise.all(blobs.map(async ({ key }) => {
        const id = key.slice("channel-config:".length);
        try { return await refreshProperty(store, id); }
        catch (error) { return { propertyId: id, error: error.message }; }
      }));
      return reply({ calendars: results });
    }
    return reply({ error: "Unknown calendar action." }, 400);
  } catch (error) {
    return reply({ error: error.message || "Calendar sync failed." }, 400);
  }
};
