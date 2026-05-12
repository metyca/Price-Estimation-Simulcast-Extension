# Implementation Report – Auction Pricing Assistant Chrome Extension

> **Date:** 2026-05-12  
> **Model version:** v15.4  
> **Calibration version:** v15.4a  
> **Target platform:** OPENLANE / Velocicast (`adesa.openlane.velocicast.io`)

---

## 1. Overview

The Auction Pricing Assistant is a Manifest V3 Chrome extension that augments the OPENLANE Velocicast auction interface. Its purpose is to help buyers make informed bidding decisions in real time by:

1. Detecting every vehicle row in the auction list.
2. Injecting a hover-activated "Estimate" button per row.
3. Extracting structured vehicle data from the DOM when the button is clicked.
4. Sending the payload to a CatBoost pricing API.
5. Displaying estimated market price, recommended max bid, and safety assessment in a non-intrusive UI card.

---

## 2. Architecture

```
chrome-extension/
├── manifest.json           MV3 manifest, permissions, content-script registration
├── options.html / .js      Settings page (API URL, key, debug toggles)
└── src/
    ├── extractVehicleData.js  DOM → structured payload
    ├── apiClient.js           Payload → API → normalized response
    ├── ui.js                  Result card, button states, debug modal
    ├── styles.css             Scoped CSS (autopluto- prefix)
    └── contentScript.js       Orchestrator: cache, row detection, MutationObserver
```

All four `src/` files are loaded as plain content-script JavaScript in declaration order. There is no bundler or build step required.

---

## 3. Permissions

| Permission | Justification |
|---|---|
| `activeTab` | Required to interact with the current auction tab |
| `storage` | `chrome.storage.sync` for API settings persistence |
| `host_permissions: *.velocicast.io/*` | Run content scripts on OPENLANE Velocicast |
| `host_permissions: *.velocicast.com/*` | Alternate Velocicast domain |
| `host_permissions: *.openlane.ca/*` | OPENLANE Canada pages |

No `scripting`, `tabs`, or `webRequest` permissions are requested. The extension is minimal by design.

---

## 4. Data Extraction (`extractVehicleData.js`)

### Row-level fields

| Field | Source | Method |
|---|---|---|
| `runNumber` | `data-cy-item-num` attribute | `rowEl.getAttribute('data-cy-item-num')` |
| `titleFull` | `.item-info-row a.vc-details > div:first-child` textContent | Strip `#N- ` prefix |
| `year` | titleFull | Regex: first 4-digit year |
| `make` | titleFull | Second token after year |
| `model` | titleFull | Third token |
| `trim` | titleFull remainder | Everything after make+model, or right-panel fallback |
| `vin` | `.item-vin` parent textContent | `textContent.replace('VIN:', '').trim()` |
| `mileage` | `.mileage-row` text node | Strip commas and "KM", parseInt |
| `exteriorColor` | `.mileage-row .block` textContent | Raw string, case preserved |
| `saleStatus` | `.badge-row` textContent | Trimmed (IF / Sold / No Sale) |
| `displayedPrice` | `.price-row span` | Strip `$,`, parseInt; null if `--` |

### Page-level fields

| Field | Source |
|---|---|
| `auctionName` | `.lane-title-bar__name p` text, after ` - ` separator |
| `lane` | `.lane-title-bar__name p` text, before ` - ` separator |
| `cityAuction` | `auctionName` minus `OPENLANE ` prefix |
| `source` | Configurable default (stored setting, default: `openlane`) |
| `section` | Configurable default (stored setting, default: `simulcast`) |

### Right-panel enrichment (only when run numbers match)

The right panel (`.lane-panel-col-right`) always shows the **currently active** vehicle. Before merging, the panel's `.vc-itemnum` text is compared to the clicked row's run number. If they match, the following fields are overlaid:

- `currentAuctionPrice` from `.vc-bid-amt.active-price`
- `engine`, `fuelType`, `drivetrain`, `transmission`, `doors` from the details table
- `sellerName` from the `Seller` row of the details table
- `trim` (overrides row parse if non-empty)
- Sale light states from `.vc-lights li.stat-active` class names

### API Payload structure

```json
{
  "year": 2022,
  "make": "MAZDA",
  "model": "CX-30",
  "trim": "GX",
  "titleFull": "2022 MAZDA CX-30 GX",
  "mileage": 108050,
  "vin": "3MVDMBB7XNM415065",
  "cityAuction": "Halifax",
  "source": "openlane",
  "section": "simulcast",
  "exteriorColor": "Black",
  "sellerName": "OPENLANE CANADA INC.- OPEN FLEET & LEASE CONSIGNORS",
  "engine": "4G",
  "fuelType": "Gasoline",
  "drivetrain": "All Wheel Drive",
  "transmission": "AT",
  "doors": 4,
  "auctionRunTimeAt": null,
  "metadata": {
    "runNumber": "83",
    "saleStatus": "IF",
    "currentAuctionPrice": 12200,
    "displayedPrice": 12200,
    "auctionName": "OPENLANE Halifax",
    "lane": "Lane B",
    "pageUrl": "https://adesa.openlane.velocicast.io/...",
    "extractionSource": "chrome-extension"
  }
}
```

**Critical:** `currentAuctionPrice` and `displayedPrice` are placed **only inside `metadata`** and are never passed as top-level features. The model does not see them as prediction inputs.

---

## 5. API Client (`apiClient.js`)

### Settings retrieval

API settings are loaded from `chrome.storage.sync` on every request. This means changes in Options take effect immediately without needing a page reload.

### Request construction

- Method: `POST`
- Content-Type: `application/json`
- `X-API-Key` header added only when an API key is configured
- Timeout: `AbortController` with configurable timeout (default 15 s)

### Response normalisation

The client handles two common response envelope shapes:

```json
// Shape A – flat
{ "estimated_market_price": 18900, "recommended_max_bid": 15700, "model_version": "v15.4" }

// Shape B – nested
{ "prediction": { "estimated_market_price": 18900, ... }, "model_version": "v15.4" }
```

Fields normalised to a canonical object:

```js
{
  estimatedMarketPrice,   // number or null
  recommendedMaxBid,      // number or null
  confidenceLevel,        // string or null
  bidSafetyLevel,         // string or null
  calibrationBuffer,      // number or null
  reason,                 // string or null
  comparableCount,        // number or null
  marketFallbackLevel,    // string or null
  modelVersion,           // string
  calibrationVersion,     // string
  raw                     // original response object
}
```

### Error types

| Condition | Error thrown |
|---|---|
| Network failure | `"Network error: …"` |
| AbortController timeout | `"Request timed out after Nms"` |
| HTTP 4xx / 5xx | `"API error HTTP N: …"` |
| Invalid JSON body | `"Invalid JSON response"` |

---

## 6. User Interface (`ui.js` + `styles.css`)

### Button injection

`injectEstimateButton()` appends a `<td class="autopluto-td">` containing a `<button class="autopluto-estimate-btn">` to the vehicle row. The TD is positioned after the last existing cell and sits in the table flow without affecting layout.

- The button is hidden by default (`opacity: 0`) and revealed on row hover via CSS `.autopluto-estimate-tr:hover .autopluto-estimate-btn`.
- The row receives `position: relative` to enable absolute positioning fallbacks.
- Duplicate injection is prevented by the `data-autopluto-estimate-injected="true"` guard.

### Button states

| State | Visual |
|---|---|
| Default | Purple button, "Estimate ✦" label |
| Loading | Spinner animation, disabled, "..." label |
| Ready (cached) | Green background, "✓ Estimate" |
| Error | Red background, "✗ Retry" |
| Refresh | Teal background, "↻ Refresh" |

### Result card

The card is injected as an additional table row (`<tr class="autopluto-card-row">`) immediately below the vehicle row, spanning all columns. This keeps it inside the table layout and avoids z-index conflicts with bid controls.

Card sections:
1. **Vehicle header** – title, VIN, mileage
2. **Price block** – Estimated Market Price (large) + Recommended Max Bid (large) side by side
3. **Safety badge** – colour-coded margin pill
4. **Reference row** – Current Auction Price (reference only, not sent to model)
5. **Meta row** – Confidence, Safety level
6. **Model row** – Model version, Calibration version
7. **Reason block** – API explanation (collapsed by default if long)
8. **Warning block** – shown if `recommendedMaxBid > estimatedMarketPrice`
9. **Actions** – Refresh Estimate, Close (×)

### Safety badge logic

| Condition | Colour | Label |
|---|---|---|
| No current price | Gray | "No current price" |
| margin > 1000 | Green | "Below recommended max bid (+$N)" |
| margin 0–1000 | Yellow | "Close to max bid (+$N)" |
| margin < 0 | Red | "Above recommended max bid ($N)" |

where `margin = recommendedMaxBid − currentAuctionPrice`.

### Debug modal

When Debug Mode is enabled, clicking Estimate first opens a full-screen modal displaying the extracted payload as formatted JSON. Optionally, Copy Payload and Copy Response buttons are shown. The modal must be dismissed before the API call proceeds (non-blocking; the call fires immediately, and the modal is informational).

### CSS isolation

All extension styles are prefixed `autopluto-`. The stylesheet uses explicit property declarations (not `all: initial`) to avoid conflicts with Velocicast styles while maintaining isolation. High `z-index` (9000+) is used for the debug modal and batch banner only.

---

## 7. Session Cache (`contentScript.js`)

Results are stored in an in-memory `Map` keyed by:

- **Primary key:** `vin:${vin}` when a VIN is available
- **Fallback key:** `run:${runNumber}|${titleFull}|${mileage}` otherwise

The cache is never persisted to storage (session only). Cache hits are instantaneous and still show the "Refresh Estimate" option.

---

## 8. MutationObserver

The observer watches `document.body` with `{ childList: true, subtree: true }`. On each mutation batch:

1. For each added node that **is** a vehicle row → call `injectIntoRows` on its parent.
2. For each added node that **contains** vehicle rows → call `injectIntoRows` on it.

This covers full list replacements, incremental appends, and lane switches. The injection guard ensures no row is processed twice.

---

## 9. Optional Batch Processing

When enabled in Options and triggered via `chrome.runtime.onMessage` (`{ type: 'BATCH_ESTIMATE_VISIBLE' }`):

1. Collect all `tr[data-cy-item-num]` elements with a bounding rect inside the viewport (±200 px).
2. Prompt the user with a confirmation dialog showing the count.
3. Iterate rows sequentially with a 600 ms delay between requests.
4. Update button states and a fixed progress banner (`autopluto-batch-banner`) at the top of the page.

Batch mode is disabled by default and must be explicitly enabled in Options.

---

## 10. Options Page

Built with plain HTML/CSS/JS, no dependencies. Fields:

| Field | Default | Validation |
|---|---|---|
| API Base URL | _(empty)_ | Required, URL format |
| Endpoint Path | `/v1/predict` | Non-empty string |
| API Key | _(empty)_ | Optional |
| Request Timeout (ms) | `15000` | 1000–60000 |
| Default Source | `openlane` | Non-empty |
| Default Section | `simulcast` | Non-empty |
| Debug Mode | off | Boolean |
| Show Copy Buttons | on | Boolean |
| Batch Estimate Enabled | off | Boolean |

The "Test Connection" button sends a minimal probe payload with a known vehicle (2022 MAZDA CX-30 GX, VIN: TEST) and reports the HTTP status and model version returned.

---

## 11. Acceptance Criteria Checklist

| Criterion | Status |
|---|---|
| Estimate button appears beside vehicle rows on hover | ✅ Implemented |
| Button does not break auction UI or cover bid controls | ✅ Button in separate TD, card in separate TR |
| Clicking Estimate extracts vehicle data | ✅ `extractVehicleData.js` |
| API receives correct payload | ✅ `apiClient.js` with AbortController |
| `price`/current bid NOT sent as model input | ✅ Only inside `metadata` |
| Result card displays `estimated_market_price` and `recommended_max_bid` | ✅ |
| UI shows margin vs current auction price with colour badge | ✅ Safety badge with colour tiers |
| MutationObserver prevents duplicates and handles dynamic updates | ✅ `startObserver()` + injection guard |
| Extension works after lane/page refresh | ✅ MutationObserver persistent |
| Debug mode shows payload, logs, and copy buttons | ✅ |
| Session caching per VIN with refresh option | ✅ |
| Batch estimation (optional, rate-limited) | ✅ Disabled by default |
| README with install, usage, and debugging instructions | ✅ `README.md` |
| Selector audit report | ✅ `selector_audit.md` |

---

## 12. Known Limitations

1. **Right-panel enrichment is limited to the active vehicle.** If a user clicks Estimate on a non-active row, the right panel may show a different vehicle. The extension correctly detects this mismatch (by comparing run numbers) and falls back to row-only data for that row.

2. **`auctionRunTimeAt` is not reliably extractable** from the available DOM. The field defaults to `null`. If the auction start time becomes available in the DOM in a future update, the selector can be added.

3. **Multi-lane layouts** with two or more side-by-side lane columns each have their own `.lane-title-bar__name`. The extension extracts `cityAuction` from the lane column that contains the clicked row's table, avoiding cross-lane contamination.

4. **VIN fallback for pre-loaded/replayed rows.** In some replay views, `data-cy-item-num` rows are present but the VIN span is empty. In this case, the cache falls back to the composite `run:N|title|mileage` key, which remains unique per row.

5. **Extension icons** are referenced in `manifest.json` but placeholder PNGs must be added by the developer before loading unpacked.
