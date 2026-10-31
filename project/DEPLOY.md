# Boxpace website + shared desk deployment

## What is included

- `website/index.html` submits enquiries to the Netlify Function at `/api/enquiries`.
- `website/desk.html` is the hosted, password-gated Team Desk. It syncs sales, operations, accounts, calendar events and property listings.
- `website/properties.html` and `website/property.html` show only published properties.
- `netlify/functions/` receives public enquiries, serves the authenticated dashboard and returns the public-safe fields of published properties.
- Netlify Blobs stores the records persistently across deploys, in the Singapore region.

## One-time Netlify setup

The current `boxpacehospitality.netlify.app` link was published as a static drag-and-drop site. Static-only publishing does not publish these server functions. Redeploy this project using a Netlify Git-connected project or Netlify CLI from this folder (the folder containing `netlify.toml`).

Before the new deploy, add a strong private environment variable in Netlify:

- **Name:** `BOXPACE_DASHBOARD_PASSWORD`
- **Value:** choose a unique password for the Boxpace desk; do not put it in this repository or share it with website visitors.
- **Scope:** Functions / runtime.

Deploy after setting the variable so the functions receive it. If it is changed later, deploy again.

## Publish from a Mac

1. Download `Boxpace-Hospitality-Redesign.zip` and extract it. Open Terminal, type `cd ` (include a space), drag the extracted `Boxpace Hospitality` folder into the Terminal window, and press Return. Confirm this is the folder containing `netlify.toml`.
2. Check Node.js with `node -v`. Netlify CLI requires Node.js 18.14.0 or later.
3. Install the project dependency and Netlify CLI:

   ```sh
   npm install
   npm install -g netlify-cli
   ```

4. Sign in and connect this folder to the existing site:

   ```sh
   netlify login
   netlify link
   ```

   Complete the browser sign-in, then select the existing `boxpacehospitality` site. Do not create a second site.
5. Publish the full-stack version to the existing public URL:

   ```sh
   netlify deploy --prod
   ```

   `netlify.toml` tells Netlify to publish `website/` and deploy the functions in `netlify/functions/`.

Official instructions: [Netlify CLI installation and deploy](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/) and [environment variables](https://docs.netlify.com/build/environment-variables/get-started/).

## Share Team Desk privately

Team Desk is not linked from the public website and is marked `noindex`. Share the direct `/desk.html` address and dashboard password only with your team. The screen stays locked until the password is accepted; server requests still require the same password. Use a strong password and rotate it if it is shared beyond the team.

## Use the shared desk

1. Open `https://boxpacehospitality.netlify.app/desk.html` after the full-stack deploy finishes.
2. Enter the private dashboard password set above at the Team Desk access screen. It remains in that browser tab’s session storage.
3. New website enquiries are saved online and appear in **Sales & leads**. Dashboard edits sync to the same hosted data; the dashboard refreshes while open.

If you already entered records in the standalone `dashboard.html`, export a JSON backup there first. Browser storage for the local file and the hosted website are separate. Open the hosted `/desk.html`, use **Import backup**, select that JSON file, then connect the shared desk to sync the imported records to Netlify.

## Notes

- New leads and dashboard records are stored in Netlify Blobs. Keep regular JSON/CSV exports as an additional backup.
- Website visitors cannot read dashboard data; dashboard API reads and writes require the environment password. The public properties endpoint exposes only published guest-facing fields; owner contacts and commercial terms remain private.
- This does not connect Doorloom, payment systems, or live OTA inventory. Property updates appear on the website after a successful shared-desk sync; confirm the sync status before closing the desk.
- The old static site remains live until the full-stack deployment replaces it. The deployment bundle is `Boxpace-Hospitality-FullStack.zip`.
