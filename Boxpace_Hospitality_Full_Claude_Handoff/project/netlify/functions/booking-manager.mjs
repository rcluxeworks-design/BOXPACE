import { randomUUID, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const db = () => getStore({ name: "boxpace-hospitality", region: "ap-southeast-1" });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
function authorized(request) {
  const secret = process.env.BOXPACE_DASHBOARD_PASSWORD || "";
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(secret), b = Buffer.from(supplied);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value; }
function datesBetween(from, to) {
  const result = [];
  const day = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
  for (let guard = 0; day < end && guard < 367; guard++) { result.push(day.toISOString().slice(0, 10)); day.setUTCDate(day.getUTCDate() + 1); }
  return result;
}
function price(property, date) {
  if (property.rateByDate?.[date]) return Number(property.rateByDate[date]) || 0;
  if (property.seasonalRate && property.seasonalFrom && property.seasonalTo && date >= property.seasonalFrom && date <= property.seasonalTo) return Number(property.seasonalRate) || 0;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return [5, 6].includes(weekday) ? (Number(property.weekendRate) || Number(property.weekdayRate) || 0) : (Number(property.weekdayRate) || 0);
}

export default async (request) => {
  if (!authorized(request)) return reply({ error: "Dashboard access is not configured or the password is incorrect." }, 401);
  const store = db();
  if (request.method === "GET") {
    const [{ blobs }, bookings] = await Promise.all([store.list({ prefix: "property:" }), store.get("bookings", { type: "json" })]);
    const otaBlocks = await Promise.all(blobs.map(async ({ key }) => {
      const id = key.slice("property:".length);
      const [property, snapshot] = await Promise.all([store.get(key, { type: "json" }), store.get(`channel-state:${id}`, { type: "json" })]);
      return property && snapshot?.blockedDates?.length ? { propertyId: id, propertyName: property.name, dates: snapshot.blockedDates } : null;
    }));
    return reply({ bookings: bookings || [], otaBlocks: otaBlocks.filter(Boolean) });
  }
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  let data;
  try { data = await request.json(); } catch { return reply({ error: "Invalid request." }, 400); }
  const bookings = (await store.get("bookings", { type: "json" })) || [];
  if (data.action === "cancel") {
    const booking = bookings.find((row) => row.id === data.id);
    if (!booking) return reply({ error: "Booking not found." }, 404);
    booking.status = "Cancelled";
    booking.updatedAt = new Date().toISOString();
    await store.setJSON("bookings", bookings);
    return reply({ booking });
  }
  if (data.action !== "create") return reply({ error: "Unknown booking action." }, 400);
  const { propertyId, guestName, contact, checkIn, checkOut } = data;
  if (typeof guestName !== "string" || !guestName.trim() || guestName.length > 120) return reply({ error: "Enter the guest name." }, 400);
  if (!validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn) return reply({ error: "Choose a valid check-in and later check-out date." }, 400);
  if (datesBetween(checkIn, checkOut).length > 90) return reply({ error: "A booking cannot exceed 90 nights." }, 400);
  if (typeof contact !== "string" || contact.length > 160) return reply({ error: "Enter a guest phone or email." }, 400);
  const property = await store.get(`property:${propertyId}`, { type: "json" });
  if (!property || property.status === "Archived") return reply({ error: "Choose an active property." }, 404);
  const nights = datesBetween(checkIn, checkOut);
  const guests = Math.max(1, Number(data.guests) || 1);
  if (property.guests && guests > Number(property.guests)) return reply({ error: `This property accommodates up to ${property.guests} guests.` }, 409);
  const overlap = bookings.find((row) => row.propertyId === propertyId && row.status !== "Cancelled" && row.checkIn < checkOut && checkIn < row.checkOut);
  if (overlap) return reply({ error: `These dates overlap an active booking (${overlap.checkIn} to ${overlap.checkOut}).` }, 409);
  const ota = await store.get(`channel-state:${propertyId}`, { type: "json" });
  const blocked = new Set(ota?.blockedDates || []);
  const conflictingDate = nights.find((day) => blocked.has(day));
  if (conflictingDate) return reply({ error: `The property is blocked by an imported OTA calendar on ${conflictingDate}. Refresh and check the source calendar.` }, 409);
  const tariffs = nights.map((date) => ({ date, rate: price(property, date) }));
  const total = tariffs.reduce((sum, item) => sum + item.rate, 0);
  if (!total) return reply({ error: "Add nightly rates in the Tariff Desk before recording a booking." }, 409);
  const booking = {
    id: randomUUID(), propertyId, propertyName: property.name,
    guestName: guestName.trim(), contact: contact.trim(), guests,
    checkIn, checkOut, nights: nights.length,
    channel: ["Direct", "Airbnb", "Booking.com", "MakeMyTrip", "Goibibo", "Other OTA", "Offline"].includes(data.channel) ? data.channel : "Direct",
    status: data.status === "Pending" ? "Pending" : "Confirmed",
    tariffs, total, notes: typeof data.notes === "string" ? data.notes.slice(0, 1200) : "",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  bookings.push(booking);
  await store.setJSON("bookings", bookings);
  return reply({ booking }, 201);
};
