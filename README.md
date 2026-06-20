# Edward & Christie — Fleet Service Record System

A web app for recording vehicle/machinery services day by day, keeping a full
searchable service history, managing editable oil & filter price lists, and
automatically calculating labour charge and sundry on every service sheet.

**Version 3 adds** a user login system (with password change), file
attachments on every service record (PDF / JPG / PNG / Word / Excel), and an
advanced **filter cross-reference engine** — type any part number and instantly
see every equivalent across brands, the machines that use it, and its price.

## Quick start

```bash
npm install      # install dependencies
npm run seed     # build the database from the data files (first run only)
npm start        # start the server -> http://localhost:2300
```

### First sign-in

On first run a default administrator is created and printed to the console:

```
username: admin      password: admin123
```

You'll be asked to set a new password immediately. Override the defaults with
the `ADMIN_USER` / `ADMIN_PASS` environment variables before the first seed.
Admins can add more users (admin or normal) from the account menu → **Manage users**.

On Windows you can simply run **`start_app.ps1`**, which does all three steps and
opens the browser for you.

> Requires Node.js 18+. The database is a single SQLite file at `data/service.db`
> (created by `npm run seed`). It is not stored in git — re-run the seed to rebuild it.

## What's inside

| Section | What it does |
|---|---|
| **📊 Dashboard** | Fleet/service counts, services-this-month, recent activity, and a services-per-month table by year. |
| **🗓️ Daily Log** | Step through services day by day and add a new service for the selected date. |
| **📋 Service Records** | Global, searchable history (by vehicle, registration, job no, site, date range) so anyone can look up a record. |
| **🚛 Fleet & Filters** | Search the fleet; open a vehicle's full service history or start a new sheet. |
| **🔁 Cross-Reference** | Type **any** filter part number (OEM, HIFI, Fleetguard, Donaldson, Baldwin, Sakura, VIC…) and get the matching filter plus every cross-referenced equivalent, the machines that use it, and its price. Includes a browsable **Filter Database** of all 1,100+ filters. |
| **💧 Price Lists** | Editable **Oils**, **Filter Types**, and a 195-item **Filter Price Book**. Prices auto-fill on the service sheet. |
| **👥 Users** *(admin)* | Add users, set roles (admin / user), reset passwords, enable/disable accounts. |
| **⚙️ Settings** *(admin)* | Change the labour %, threshold, sundry %, and company details. |

## Logins & roles

All pages require a sign-in. Two roles:

- **User** — record and look up services, attach files, use and grow the
  cross-reference database.
- **Admin** — everything above, plus **Settings**, **user management** and
  rebuilding the cross-reference index.

Every user can change their own password from the account menu (it signs
out their other devices). Passwords are hashed with scrypt; sessions are
opaque httpOnly cookies stored server-side.

## File attachments

Each service sheet has an **Attachments** panel — drag & drop or pick files
(PDF, JPG, JPEG, PNG, GIF, WEBP, Word, Excel, CSV, TXT; up to 25 MB each).
Files are stored under `data/attachments/` (kept out of git, like the
database) with their metadata in the `ServiceAttachments` table. When you
start a brand-new service the files are queued and uploaded the moment the
record is saved.

## Filter cross-reference engine

On seed, every filter's **OEM number, HIFI number and free-text cross-reference
string** is parsed into a normalised, searchable index (`FilterCrossRefs`).
Searching ignores spaces, dashes and case, so `FF-5045`, `ff5045` and `FF 5045`
all match. Results group equivalents by brand, highlight the term you searched,
and show the machines that use the filter plus a price (looked up through any
equivalent code in the price book).

The index is **fully editable** — add an equivalent from any result card and it
becomes instantly searchable. Manual additions are preserved across re-seeds;
only the auto-parsed part is rebuilt. Admins can re-parse the catalog at any
time via `POST /api/xref/rebuild`.

> **Note on data quality:** the engine indexes the cross-reference data that
> ships in `vehicle_filter_data.js`. Much of that source data is sparse or
> placeholder, so the *system* is complete but the *content* is meant to be
> grown over time by adding verified equivalents (from supplier catalogs / your
> own procurement knowledge) through the UI. Never order a part on an unverified
> cross-reference.

## Charge calculation

On each service sheet the totals are worked out from the **parts subtotal**
(oils + filters + any other cost lines):

```
Labour  = 20% of parts   when parts ≤ Rs 10,000
        = 15% of parts   when parts >  Rs 10,000
Sundry  = 5%  of parts
Total   = parts + labour + sundry
```

Examples: parts **8,000** → total **10,000**; parts **25,000** → total **30,000**.

All four numbers (20%, 15%, the Rs 10,000 threshold, and 5%) are editable in
**Settings**. Each saved job stores its own snapshot of the rates, so changing
them later never alters past records.

## Where the data comes from

`npm run seed` loads:

- **Vehicles, filters, links, genuine prices, motorcycles, filter price book** — from `vehicle_filter_data.js`.
- **Service history** — read straight from `Service record.xlsx` (the *Summery* sheet).

Re-running the seed is safe: the reference catalog is rebuilt, but your edited
price lists and any service jobs entered in the app are left untouched.

### Migrating records from the old Microsoft Access app (optional)

If you have records that only exist in the old `VehicleFilterDB.accdb`, run
`export_services.ps1` once on Windows. It writes `seed_data/services_export.json`,
which the seeder then imports **instead of** the Excel history (so there are no
duplicates).

## Notes

The legacy PowerShell scripts (`create_database.ps1`, `migrate_*.ps1`, `check_*.ps1`,
etc.) were used to build the original Access database and the `vehicle_filter_data.js`
export. They are kept for reference and are not needed to run the app.
