import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const db = () => getStore({ name: "boxpace-hospitality", region: "ap-southeast-1" });
const same = (a, b) => {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
};
const icsDate = (value) => value.replaceAll("-", "");

export default async (request) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const url = new URL(request.url);
  const propertyId = url.searchParams.get("property") || "";
  const token = url.searchParams.get("token") || "";
  if (!/^[\w-]{1,100}$/.test(propertyId) || !token) return new Response("Not found", { status: 404 });
  const store = db();
  const [config, property, snapshot, bookings] = await Promise.all([
    store.get(`channel-config:${propertyId}`, { type: "json" }),
    store.get(`property:${propertyId}`, { type: "json" }),
    store.get(`channel-state:${propertyId}`, { type: "json" }),
    store.get("bookings", { type: "json" }),
  ]);
  if (!property || !config?.token || !same(token, config.token)) return new Response("Not found", { status: 404 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Boxpace Hospitality//Availability Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${String(property.name || "Boxpace property").replace(/[\r\n,;]/g, " ")} availability`];
  for (const day of snapshot?.blockedDates || []) {
    const start = new Date(`${day}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() + 1);
    const end = start.toISOString().slice(0, 10);
    lines.push("BEGIN:VEVENT", `UID:${propertyId}-${icsDate(day)}@boxpacehospitality.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(day)}`, `DTEND;VALUE=DATE:${icsDate(end)}`, "SUMMARY:Unavailable", "TRANSP:OPAQUE", "END:VEVENT");
  }
  for (const booking of bookings || []) {
    if (booking.propertyId !== propertyId || booking.status === "Cancelled") continue;
    lines.push("BEGIN:VEVENT", `UID:${propertyId}-${booking.id}@boxpacehospitality.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(booking.checkIn)}`, `DTEND;VALUE=DATE:${icsDate(booking.checkOut)}`, "SUMMARY:Unavailable", "TRANSP:OPAQUE", "END:VEVENT");
  }
  lines.push("END:VCALENDAR", "");
  return new Response(lines.join("\r\n"), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store", "content-disposition": "inline; filename=boxpace-availability.ics" },
  });
};
