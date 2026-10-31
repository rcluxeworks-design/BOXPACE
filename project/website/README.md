# Boxpace Hospitality public website

A responsive multi-page hospitality website for Netlify, connected to the protected Team Desk and Netlify Blobs.

## Pages and files

- `index.html` — homepage summary, featured published properties, services overview and owner partnership summary.
- `properties.html` / `property.html` — the guest-facing Stays page, published villa catalogue, filters, date availability check and individual property details. Guests see an estimated stay total when every night is marked available.
- `services.html` — separate service details.
- `owners.html`, `about.html`, `contact.html` — owner information, company overview and enquiry form.
- `desk.html` — password-gated Team Desk, with sales, operations, accounts, bookings, booking calendar, tariff desk, OTA calendar feeds and property management.
- `site.css` / `site.js` — shared public site design and property/enquiry interactions.
- `villa-hero.png`, `villa-lonavala.png` — illustrative AI-created villa scenes, not images of confirmed Boxpace listings.

## Property publishing

The public catalogue reads only records with status `Published` from `/api/properties`. Team Desk saves property records in Netlify Blobs. Draft and archived listings remain private; owner contact details and commercial terms are excluded from the public response. Listing photos are resized in the browser and stored with the property record. Publishing requires a name, location, description, guest capacity, weekday rate and at least one photo. The private property editor includes a date calendar with Available, Booked/blocked and Needs confirmation states, weekday/weekend rates, and optional seasonal-rate dates. Only explicitly available nights return an available estimate; dates not set to available require confirmation.

## Bookings, tariffs and OTA calendars

The private Bookings page records direct, offline or manually entered OTA reservations with guest contact, villa, dates and a tariff calculated from the property rates. Pending and confirmed bookings close those dates on the public property availability checker and are included in the Boxpace iCalendar export. The booking register downloads as an `.xlsx` workbook with guest, villa, date, tariff, total and source columns. The Tariff Desk updates weekday, weekend and seasonal prices used by the public website and booking total calculation.

OTA calendar integration uses iCalendar feeds: import each OTA's calendar into Boxpace, and import the Boxpace calendar URL into each OTA listing. Incoming blocked dates are refreshed hourly and on request; unsuccessful imports retain previously known blocks and turn unblocked manual dates into "needs confirmation" until all feeds refresh. iCalendar feeds do not provide reservation guest details, booking price changes or instant rate sync. External OTA bookings therefore close dates but must be entered manually in Bookings to appear with guest and tariff details in the register. Each OTA controls how often it refreshes the Boxpace URL, so this helps reduce conflicts but cannot guarantee instant cross-OTA blocking. Monitor OTA calendars for conflicts.

## Enquiries and access

Public enquiry forms send records to `/api/enquiries` and appear in the Team Desk sales CRM. Owner prospects and guest enquiries have separate pipeline stages, filters, source, priority, next action, follow-up date, notes and potential value. Follow-ups are also shown on the Desk calendar. Leads can be updated and exported to CSV; CRM values are planning inputs, not confirmed income. The protected Team Desk requires `BOXPACE_DASHBOARD_PASSWORD` in Netlify function environment variables. Do not place the password in public files. Full-stack hosting is required; a static-only upload does not run the server functions.

See `../DEPLOY.md` for deployment instructions and existing-site setup. OTA partner APIs, OTA rate sync, payments and automatic import of external guest details are not connected. An enquiry is not a confirmed reservation.
