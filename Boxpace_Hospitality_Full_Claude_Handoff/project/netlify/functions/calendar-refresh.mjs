import { db, refreshProperty } from "./channel-manager.mjs";

export const config = { schedule: "0 * * * *" };

export default async () => {
  const store = db();
  const { blobs } = await store.list({ prefix: "channel-config:" });
  const results = await Promise.all(blobs.map(async ({ key }) => {
    const propertyId = key.slice("channel-config:".length);
    try { return await refreshProperty(store, propertyId); }
    catch (error) { return { propertyId, error: error.message || "Calendar refresh failed." }; }
  }));
  return new Response(JSON.stringify({ refreshed: results.length, results }), { headers: { "content-type": "application/json" } });
};
