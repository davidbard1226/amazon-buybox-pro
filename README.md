# 🛒 Amazon BuyBox Pro — co.za Tracker & Repricer

Track your **buybox win/lose**, competitor prices, and generate price updates for
**amazon.co.za** — no SP-API, no AWS, no developer registration.

- **Extension** reads your own Seller Central **Manage Pricing** data (your
  price, buybox price, lowest price, win/lose) and stores it locally.
- **Dashboard** turns it into a repricer: strategy engine (beat/match/floor),
  per-product min/max floors, 🔒 price locks, Telegram alerts, and a
  **Price & Inventory flat file** you upload to Seller Central.
- Built for **3000+ SKUs** (auto-scan clicks through all paginated pages).

## Quick start

1. Load `chrome-extension` via `chrome://extensions` → Developer mode →
   **Load unpacked** → enable **Allow access to file URLs**.
2. Open Seller Central → **Pricing → Manage Pricing** → extension popup →
   **▶ Start auto-scan**.
3. Open `index.html` → **🔄 Pull now**.
4. Set cost prices per product (repricer never prices blind).
5. Repricer tab → **📄 Generate flat file** → upload via Seller Central →
   **Add Products via Upload → Price & Inventory**.

Full details: [docs/setup-guide.md](docs/setup-guide.md)

## Why no API?

SP-API requires developer registration, LWA app, IAM role, and OAuth — a heavy
one-time setup. Instead, the extension reads the buybox data Seller Central
already shows you on the Manage Pricing page (your own account data), which is
exactly the data the tracker needs. Repricing goes through Amazon's flat-file
upload or Amazon's built-in **Automate Pricing**.

> ⚠️ Automated reading of Seller Central is technically against Amazon's ToS
> (standard practice among seller tools). We never scrape public product pages.

## Features

- 📦 Products table: win/lose/no-box badges, your price vs buybox vs lowest
- ⚙️ Repricer: beat by R, match, floor-only; per-product min/max; R50 absolute floor
- 🔒 Price lock: never raise above current (specials) — drops still chase down
- ⚡ Fast-track flags for priority products
- 📤 Price & Inventory flat-file export (TSV)
- 🤖 Automate Pricing guidance (Amazon's native repricer)
- ⚡ Telegram alerts on buybox win/lose changes
- 🔌 Extension bridge: auto-sync every 15s, auto-scan all pages

## Project layout

```
index.html                 dashboard (products, repricer, export, settings)
chrome-extension/
  manifest.json            MV3 manifest
  content-seller.js        Manage Pricing parser (header-based)
  content-bridge.js        dashboard bridge (window.__bbpBridge)
  background.js            auto-scan pagination + periodic scans
  popup.html / popup.js    scan controls + status
docs/setup-guide.md        full setup + troubleshooting
```