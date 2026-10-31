import { getStore } from "@netlify/blobs";

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const publicFields = [
  "id", "name", "area", "type", "description", "highlights", "bedrooms", "beds", "minimumStay",
  "bathrooms", "guests", "checkin", "checkout", "weekdayRate", "weekendRate",
  "seasonalRate", "seasonalFrom", "seasonalTo", "amenities", "rules", "cancellation", "photos", "availability", "updatedAt",
];

export default async (request) => {
  if (request.method !== "GET") return reply({ error: "Method not allowed." }, 405);
  try {
    const store = getStore({ name: "boxpace-hospitality", region: "ap-southeast-1" });
    const [{ blobs }, state] = await Promise.all([
      store.list({ prefix: "property:" }),
      store.get("desk-state", { type: "json" }),
    ]);
    const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json" })));
    const properties = records.length ? records.filter(Boolean) : (Array.isArray(state?.properties) ? state.properties : []);
    const bookings = await store.get("bookings", { type: "json" }) || [];
    const published = await Promise.all(properties
      .filter((property) => property?.status === "Published")
      .map(async (property) => {
        const snapshot = await store.get(`channel-state:${property.id}`, { type: "json" });
        const merged = { ...property, availability: { ...(property.availability || {}) } };
        if (snapshot?.feedCount && snapshot.successfulFeeds < snapshot.feedCount) {
          for (const [day, status] of Object.entries(merged.availability)) if (status === "available") merged.availability[day] = "on-request";
        }
        for (const day of snapshot?.blockedDates || []) merged.availability[day] = "unavailable";
        for (const booking of bookings || []) {
          if (booking.propertyId !== property.id || booking.status === "Cancelled") continue;
          const day = new Date(`${booking.checkIn}T00:00:00Z`), end = new Date(`${booking.checkOut}T00:00:00Z`);
          for (let guard = 0; day < end && guard < 367; guard++) { merged.availability[day.toISOString().slice(0, 10)] = "unavailable"; day.setUTCDate(day.getUTCDate() + 1); }
        }
        return Object.fromEntries(publicFields.filter((key) => merged[key] !== undefined).map((key) => [key, merged[key]]));
      }));
    return reply({ properties: published });
  } catch {
    return reply({ error: "Property listings are temporarily unavailable." }, 503);
  }
};
