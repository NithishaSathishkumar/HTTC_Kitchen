# HTTC Kitchen Hub

A shared operations dashboard for temple kitchen staff and volunteers.

## Kitchen workflows

- Pantry inventory with restock thresholds
- Excel inventory import with worksheet selection, column matching, row validation, and automatic duplicate combining (Admins and Staff)
- Active and inactive volunteer roster with roles, contact details, and hours served
- Shift scheduling, check-in and check-out from the kitchen overview
- Monthly kitchen calendar with single-day or multi-day events and morning, afternoon, and evening cook assignments for each date
- Kitchen expense records with monthly totals

Kitchen records are stored in Supabase Postgres and shared by signed-in visitors who have access to the site.

## Import inventory from Excel

Open Inventory → Import Excel and choose an `.xlsx` workbook (up to 5 MB and 500 rows). Match the item name, quantity, unit, and restock columns, then review and import. Restock level defaults to 0. Quantities can use numeric cells with a separate Unit column or combined values like `12 kg`, including the dashboard's existing Excel exports. A blank template is available in the import dialog.

Invalid rows must be corrected before importing. Matching item names and units combine into one pantry item, including existing duplicates, repeated worksheet rows, and manual additions. Names ignore case and extra spaces; common unit aliases such as lb/lbs and kg/kilograms match. Weights combine across compatible units (g, kg, lb, oz), including packages with an explicit weight such as packet (4lb). A loose stock unit is preferred for the total. Packages without a weight remain separate; enter the weight in their Unit field to combine them. Event ingredient quantities are converted to the combined stock unit when read and saved. Quantities are added and the highest restock level is kept. Importing the same file again adds its quantities again. Edit item changes the combined total; saved event ingredients keep their links and use the combined stock for pantry checks. The server checks access and validates the complete batch before inserting it in one database request. Original record IDs are preserved and no additional SQL migration is required.

## Access roles

- New Google accounts are automatically added with View only access. Preserve at least one Admin account so new sign-ins can be reviewed.
- Admins can add people by email, assign roles, and remove dashboard access.
- Staff can add and update kitchen records.
- View-only accounts can read the dashboard and submit change requests for an Admin to review. An Admin can grant Staff access, mark a request handled, or decline it.

Only an Admin can open Team access. Kitchen API routes check each signed-in account's role on the server.

## Connect Supabase

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor. It adds volunteer fields plus access, calendar, and change-request tables without changing existing kitchen records or access assignments. Big events can span multiple dates, with separate meal plans and cook assignments for each day.
2. Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to the Site's production environment settings. Use a server-only secret key; it is never sent to the browser.

## Google sign-in

The dashboard uses Supabase Auth with Google OAuth and a PKCE callback. Its kitchen API checks the signed-in Supabase user before reading or changing records. The publishable API key is used for Auth; the Supabase secret key remains server-side for database operations.

To enable Google sign-in for local development:

1. In Google Cloud Console, create a Web OAuth client. Add `http://127.0.0.1:5173` as an authorized JavaScript origin.
2. In Supabase, open Authentication → Sign In / Providers → Google, enable the provider, and add the Google Client ID and Client Secret. Use the callback URL shown there as the Google OAuth client's authorized redirect URI.
3. In Supabase Authentication → URL Configuration, allow `http://127.0.0.1:5173/auth/callback` as a redirect URL.
4. Keep the Google OAuth app restricted to the temple team while testing. Add a production redirect and runtime `SUPABASE_API_KEY` only when the dashboard is ready to publish.

The OAuth provider cannot complete sign-in until its Google credentials are entered in Supabase. Never put the Google Client Secret or Supabase secret key in browser code or this repository.

The dashboard talks to Supabase's REST API from its server route. The SQL schema enables row-level security and grants table access only to the server role.
