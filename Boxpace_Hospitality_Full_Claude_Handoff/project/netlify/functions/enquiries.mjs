import { randomUUID, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const store = () => getStore({ name: "boxpace-hospitality", region: "ap-southeast-1" });
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
  const db = store();
  if (request.method === "POST") {
    try {
      const isJson = (request.headers.get("content-type") || "").includes("application/json");
      const body = isJson ? await request.json() : Object.fromEntries(await request.formData());
      if (body.website) return reply({ ok: true }); // honeypot
      const name = String(body.name || "").trim().slice(0, 120);
      const contact = String(body.contact || "").trim().slice(0, 160);
      const type = String(body.enquiry_type || "Something else").slice(0, 80);
      const area = String(body.area || "").slice(0, 80);
      const message = String(body.message || "").trim().slice(0, 2000);
      const property = String(body.property || "").trim().slice(0, 180);
      const dates = String(body.dates || "").trim().slice(0, 100);
      const guests = String(body.guests || "").trim().slice(0, 40);
      const bedrooms = String(body.bedrooms || "").trim().slice(0, 40);
      const serviceInterest = String(body.service_interest || "").trim().slice(0, 120);
      const channels = String(body.channels || "").trim().slice(0, 160);
      if (!name || !contact || !/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|[+()\d][+()\d\s.-]{6,}/.test(contact)) {
        return reply({ error: "Please enter your name and a valid email address or phone number." }, 400);
      }
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const lead = {
        id, name, contact,
        type: type === "Villa owner partnership" ? "Villa owner" : "Guest enquiry",
        requirement: [property && `Property: ${property}`, area, bedrooms && `Type: ${bedrooms}`, dates && `Dates: ${dates}`, guests && `Guests: ${guests}`, serviceInterest && `Service interest: ${serviceInterest}`, channels && `Channels: ${channels}`, message].filter(Boolean).join(" · "),
        stage: "New", follow: "", value: 0, next: "Reply to website enquiry",
        source: "Website enquiry", createdAt,
      };
      await db.setJSON(`enquiry:${id}`, lead, { onlyIfNew: true });
      if (!isJson) return new Response(null, {
        status: 303,
        headers: { location: "/enquiry-received.html", "cache-control": "no-store" },
      });
      return reply({ ok: true, id });
    } catch {
      return reply({ error: "We could not save your enquiry. Please try again." }, 400);
    }
  }

  if (!authorized(request)) return reply({ error: "Dashboard access is not configured or the password is incorrect." }, 401);
  if (request.method === "GET") {
    const [saved, { blobs }, { blobs: propertyBlobs }] = await Promise.all([
      db.get("desk-state", { type: "json" }),
      db.list({ prefix: "enquiry:" }),
      db.list({ prefix: "property:" }),
    ]);
    const [websiteLeads, properties] = await Promise.all([
      Promise.all(blobs.map(({ key }) => db.get(key, { type: "json" }))),
      Promise.all(propertyBlobs.map(({ key }) => db.get(key, { type: "json" }))),
    ]);
    const propertyRows = properties.filter(Boolean);
    return reply({ state: { ...(saved || {}), properties: propertyRows.length ? propertyRows : (Array.isArray(saved?.properties) ? saved.properties : []) }, websiteLeads: websiteLeads.filter(Boolean) });
  }
  if (request.method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[\w-]{16,80}$/.test(id)) return reply({ error: "Invalid enquiry id." }, 400);
    await db.delete(`enquiry:${id}`);
    return reply({ ok: true });
  }
  return reply({ error: "Method not allowed." }, 405);
};

