import { timingSafeEqual } from "node:crypto";
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

export default async (request) => {
  if (!authorized(request)) return reply({ error: "Dashboard access is not configured or the password is incorrect." }, 401);
  const store = db();
  if (request.method === "GET") {
    const [saved, { blobs }] = await Promise.all([
      store.get("desk-state", { type: "json" }),
      store.list({ prefix: "property:" }),
    ]);
    const properties = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json" })));
    const propertyRows = properties.filter(Boolean);
    return reply({ state: { ...(saved || {}), properties: propertyRows.length ? propertyRows : (Array.isArray(saved?.properties) ? saved.properties : []) } });
  }
  if (request.method === "PUT") {
    const text = await request.text();
    if (text.length > 4_500_000) return reply({ error: "Dashboard data is too large." }, 413);
    let state;
    try { state = JSON.parse(text).state; } catch { return reply({ error: "Invalid data." }, 400); }
    const collections = ["leads", "operations", "transactions", "events", "properties"];
    if (!state || typeof state !== "object" || collections.some((key) => !Array.isArray(state[key]))) {
      return reply({ error: "Invalid dashboard data." }, 400);
    }
    const properties = state.properties;
    if (properties.some((item) => !item || typeof item.id !== "string" || !/^[\w-]{1,100}$/.test(item.id))) {
      return reply({ error: "Invalid property record." }, 400);
    }
    await store.setJSON("desk-state", Object.fromEntries(collections.filter((key) => key !== "properties").map((key) => [key, state[key]])));
    const existing = await store.list({ prefix: "property:" });
    const keep = new Set(properties.map((item) => `property:${item.id}`));
    await Promise.all([
      ...existing.blobs.filter(({ key }) => !keep.has(key)).flatMap(({ key }) => {
        const id = key.slice("property:".length);
        return [store.delete(key), store.delete(`channel-config:${id}`), store.delete(`channel-state:${id}`)];
      }),
      ...properties.map((item) => store.setJSON(`property:${item.id}`, item)),
    ]);
    return reply({ ok: true, savedAt: new Date().toISOString() });
  }
  return reply({ error: "Method not allowed." }, 405);
};

