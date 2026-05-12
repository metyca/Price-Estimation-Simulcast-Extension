# Auction Pricing Assistant – Chrome Extension

A Manifest V3 Chrome extension that injects an **Estimate** button beside every vehicle row on the OPENLANE / Velocicast auction page. One click extracts all available vehicle data and sends it to your CatBoost pricing API, displaying estimated market price, recommended max bid, safety badges, and more in a polished popover card.

> **No build step required.** Load the folder directly in Chrome – no npm, no Node.js, no bundler.

---

## File Structure

```
chrome-extension/
├── manifest.json       ← MV3 manifest
├── content.js          ← All content script logic (single file)
├── background.js       ← Service worker (opens options on install, relays batch trigger)
├── options.html        ← Settings page HTML + inline CSS
├── options.js          ← Settings page logic
├── styles.css          ← Injected UI styles (content script)
├── README.md
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How to Load in Chrome (Load Unpacked)

1. Download or clone this repository so you have the `chrome-extension/` folder locally.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `chrome-extension/` folder (the folder that contains `manifest.json`).
5. The extension icon (blue **A**) appears in your toolbar.

That's it – no `npm install`, no `npm run build`, no compilation.

---

## Configuring the API URL and API Key

On first install, the options page opens automatically. You can also reach it via:

- Right-click the extension icon → **Options**
- `chrome://extensions` → click **Details** on the extension → **Extension options**

Fill in the following fields and click **Save Settings**:

| Field | Description | Default |
|---|---|---|
| API Base URL | Your CatBoost API host (no trailing slash) | `https://catboost-100027963480.northamerica-northeast2.run.app` |
| Endpoint Path | Prediction route | `/v1/predict` |
| API Key / Token | Sent as `X-API-Key` header – leave blank if open | _(empty)_ |
| Request Timeout | Milliseconds before the request is aborted | `15000` |
| Default Source | Payload `source` field | `openlane` |
| Default Section | Payload `section` field | `simulcast` |

Click **Test Connection** to verify the API is reachable before going live.

Settings are stored via `chrome.storage.sync` and persist across browser restarts and profiles.

---

## API Payload Format

The API expects a **`POST /v1/predict`** request with `Content-Type: application/json` and the following body structure:

```json
{
  "vehicle": {
    "year": 2022,
    "make": "MAZDA",
    "model": "CX-30",
    "trim": "GX",
    "mileage": 108050,
    "vin": "3MVDMBB7XNM415065",
    "cityAuction": "Halifax",
    "source": "openlane",
    "section": "simulcast",
    "titleFull": "2022 MAZDA CX-30 GX",
    "exteriorColor": "Black",
    "sellerName": null,
    "engine": null,
    "fuelType": null,
    "drivetrain": null,
    "transmission": null,
    "auctionRunTimeAt": null
  }
}
```

### Required `vehicle` fields

| Field | Type | Notes |
|---|---|---|
| `year` | integer (1980–2030) | Model year |
| `make` | string | e.g. `MAZDA`, `FORD` |
| `model` | string | e.g. `CX-30`, `Transit` |

### Optional `vehicle` fields

| Field | Type | Notes |
|---|---|---|
| `trim` | string \| null | Trim level |
| `mileage` | number \| null | Odometer (km) |
| `vin` | string \| null | Used for CARFAX lookup |
| `cityAuction` | string \| null | Auction city |
| `source` | string \| null | e.g. `openlane` |
| `section` | string \| null | e.g. `simulcast` |
| `titleFull` | string \| null | Full title string |
| `exteriorColor` | string \| null | |
| `engine` | string \| null | |
| `fuelType` | string \| null | |
| `drivetrain` | string \| null | e.g. `AWD`, `FWD` |
| `transmission` | string \| null | |
| `sellerName` | string \| null | |
| `doors` | integer (1–6) \| null | |
| `auctionRunTimeAt` | string \| null | ISO-8601 timestamp |

### Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-API-Key` | Your API key (omit if not required) |

> **Never include `price`, `actual_price`, or `soldPrice`** in the payload — these are training labels, not input features.

### Example API response fields

| Field | Description |
|---|---|
| `estimated_market_price` | Final estimated market value |
| `recommended_max_bid` | Conservative maximum bid |
| `confidence_level` | `high` / `medium` / `low` / `very_low` |
| `bid_safety_level` | `safe` / `moderate` / `risky` / `very_risky` |
| `model_version` | Model version string |
| `comparables_found` | Number of comparable vehicles used |
| `market_match_level` | Fallback level used for market features |
| `reason` | Array of human-readable explanation strings |

---

## Testing on OPENLANE / Velocicast

1. Load the extension (see above).
2. Navigate to your auction lane, e.g. `https://adesa.openlane.velocicast.io/`.
3. Log in and open a live or replay lane.
4. **Hover** over any vehicle row – a small blue **$ Estimate** button appears on the right side of the row.
5. **Click** the button:
   - The button shows a loading spinner while the API call runs (~1–3 s).
   - On success, a popover card appears below the row showing:
     - Estimated Market Price & Recommended Max Bid
     - Margin vs Current Auction Price with a colour-coded safety badge
     - Confidence level, Bid Safety level, Comparable count
     - Model & Calibration version strings returned by the API
   - On failure, a concise error card is shown instead (timeout / network / API error).
6. Results are **cached per VIN** for the session. Click **↻ Refresh estimate** inside the card to force a new API call.

### Batch Estimation

Click the extension toolbar icon while on an auction page to send a `BATCH_ESTIMATE_VISIBLE` message to the content script. You can also enable **Batch Estimate Enabled** in Options, which unlocks the batch flow triggered via the message listener.

The batch runner processes only visible rows, rate-limited to ~1 request per 600 ms, with a progress banner at the bottom of the screen.

---

## Debugging Selector Issues

Enable **Debug Mode** in Options. This causes the extension to:

1. Show a modal with the full extracted payload **before** each API call.
2. Log every `[AutoPluто]` prefixed entry in the browser console (DevTools → Console).
3. Show **Copy payload** button in the debug modal for easy inspection.

To inspect selectors live:

```js
// In DevTools Console on the auction page:
document.querySelectorAll('tr[data-cy-item-num]')          // vehicle rows
document.querySelectorAll('.lane-title-bar__name')          // lane title bars
document.querySelector('.lane-panel-col-right .vc-itemnum') // active run number
```

---

## Active Model Versions

| Component | Version |
|---|---|
| Pricing Model | v15.4 |
| Bid Calibration | v15.4a |

These are enforced server-side. The extension reads and displays whatever version strings the API returns.

---

## Privacy & Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Read vehicle data from the current auction tab |
| `storage` | Persist API settings via `chrome.storage.sync` |
| Host: `*.velocicast.io/*`, `*.velocicast.com/*`, `*.openlane.ca/*` | Run content script on auction pages |
| Host: `*.run.app/*` | Make pricing API calls to Cloud Run (override in manifest if self-hosting) |

No data is sent anywhere except your own configured API endpoint.
