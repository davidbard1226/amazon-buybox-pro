# Amazon BuyBox Pro — Setup Guide (amazon.co.za)

Track your buybox (win/lose), competitor prices, and generate price updates for
**amazon.co.za** — no SP-API, no AWS, no developer registration. The extension
reads **your own Seller Central data** (Manage Pricing page) and the dashboard
turns it into a repricer.

> ⚠️ **Honest caveat:** automated reading of Seller Central pages is technically
> against Amazon's ToS (every seller tool does this — it's your own account
> data, far lower risk than scraping public product pages). We deliberately do
> **not** scrape public Amazon pages. Use at your own discretion.

---

## 1. Install the extension

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** → select the `chrome-extension` folder in this repo.
4. Find **Amazon BuyBox Pro** in the list and click **Details** → enable
   **Allow access to file URLs** (required so the dashboard can read the data).

## 2. Run a scan

1. Log in to **Seller Central** → **Pricing → Manage Pricing** (amazon.co.za).
2. Click the extension icon → **▶ Start auto-scan (all pages)**.
   - It clicks through every page (100 SKUs per page → ~30 pages for 3000 SKUs,
     roughly 90 seconds).
   - You can also click **📄 Scan current page only** to capture just the page
     you're on.
3. The popup shows progress (page X / total, products stored).

> If the auto-scan can't find the table, open Manage Pricing manually, click
> **Scan current page only**, and send me the page HTML — the parser is
> header-based and may need a selector tweak for your marketplace's UI.

## 3. Open the dashboard

1. Open `index.html` in the same Chrome profile (double-click the file).
2. Top-right shows **🔌 extension: connected** when the bridge is live.
3. Click **🔄 Pull now** (or wait — it auto-pulls every 15s).

## 4. Set up costs & floors (one-time)

The repricer **never prices blind** — every product needs a cost price:

1. Products tab → click **✎** on a product → enter **Cost price (R)**.
2. Min price auto-calculates from cost + profit % (default 7%). Override if needed.
3. **Max price** = optional ceiling (leave blank = no cap).
4. 🔒 **Lock price** = never raise above current (for specials / Black Friday).

> For 3000 SKUs, import costs in bulk: export the JSON, fill costs in a
> spreadsheet, re-import. (Or use the extension's scan data + a cost CSV —
> ask me and I'll add a cost-CSV import.)

## 5. Reprice

1. **Repricer tab** → choose strategy:
   - **Beat buybox by amount** (default R1) — chase the box down.
   - **Match buybox exactly** — hold the box price.
   - **Floor only** — never chase; only raise to your floor if below it.
2. Preview shows every product that will change, with guards applied.
3. **📄 Generate flat file** → downloads a TSV (`sku` + `price`).
4. Seller Central → **Inventory → Add Products via Upload** → **Price & Inventory**
   template → upload the file.

> If Amazon rejects the file, download the official **Price & Inventory**
> template from the upload page, paste your `sku` + `price` columns into it,
> and re-upload.

## 6. (Recommended) Amazon Automate Pricing

Amazon's built-in repricer can do the fast chasing natively:

1. Seller Central → **Pricing → Automate Pricing**.
2. Rule: **Match Buy Box Price** or **Beat by R X**, with min/max prices.
3. Assign SKUs.

The dashboard then becomes your **monitoring + alert layer** (win/lose, competitor
prices, Telegram alerts).

## 7. Telegram alerts (optional)

Settings tab → enter bot token + chat ID → enable. You get pinged when a product
**loses** or **wins** the buybox between scans.

---

## Architecture

```
chrome-extension/
  content-seller.js   parses Manage Pricing (header-based, robust)
  content-bridge.js   exposes window.__bbpBridge on the dashboard page
  background.js       auto-scan: clicks through pages, stores to chrome.storage
  popup.html/.js      scan controls + status
index.html            dashboard: products, repricer, flat-file export, alerts
```

Data flow: **Seller Central → extension (chrome.storage.local) → dashboard
(localStorage) → flat file → Seller Central upload.**

## Troubleshooting

| Symptom | Fix |
|---|---|
| "extension: —" in dashboard | Extension not loaded, or **Allow access to file URLs** off |
| Auto-scan finds no table | Open Manage Pricing manually, use **Scan current page only**, send me the HTML |
| Flat file rejected | Paste into the official Price & Inventory template |
| Products missing cost | Repricer skips them — set cost in edit modal or import |
| Buybox status all "NO BOX" | The Buy Box column wasn't recognized — send me a page sample |