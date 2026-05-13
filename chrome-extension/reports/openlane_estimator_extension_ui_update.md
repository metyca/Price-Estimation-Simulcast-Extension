# OPENLANE Estimator Extension — UI Update Report

**Date:** 2026-05-12 (v5 — professional dark report card UI)
**Scope:** Chrome Extension — Full popover/result card redesign
**Files modified:** `content.js`, `styles.css`

---

## 1. Summary of Changes

### v5 (this update)

Complete visual overhaul of the estimate result popover. Replaced the basic white tooltip-style card with a professional, dark-themed estimate report card. No build system added — all changes are plain CSS and vanilla JS.

---

## 2. UI Changes Made

### Overall card
- **Dark background:** `#111827` (gray-900 / Tailwind-style)
- **Width:** increased from 320 px → **400 px**
- **Border radius:** 12 px with subtle shadow `0 24px 60px rgba(0,0,0,.7)`
- **Font:** system sans-serif, better hierarchy through weight and size contrast
- **Thin scrollbar** styled for dark theme

### Header section
- **Blue gradient** `#1e3a8a → #2563eb` (dark navy to bright blue)
- **Vehicle title** — 14 px, weight 700, white
- **"AI Estimate" badge** — frosted pill, always visible
- **Model version badge** — monospace, muted frosted pill (shows when API returns `model_version`)
- **VIN line** — monospace, muted white under title
- **Mileage tag** — muted white, right of VIN
- **Close button** — hover highlights with frosted background

### Price summary grid
Three price cards in an auto-fit grid:

| Card | Style | Color |
|------|-------|-------|
| Est. Market Price | Dark blue tint `#0f1e3a` | Blue value `#93c5fd` |
| **Rec. Max Bid** | **Dark green tint `#052e16`**, emphasized | **Green value `#10b981`, 18 px** |
| Current Bid | Dark neutral `#1a1f2e` | Gray value `#9ca3af` |

When no current bid price, only 2 cards shown (auto-fit handles it).

### Decision banner
New colored banner below the price grid. Logic:

| Condition | Color | Title | Subtitle |
|-----------|-------|-------|----------|
| `margin > 1000` | Green `#052e16` | "Good room to bid" | `$X below recommended max bid` |
| `0 ≤ margin ≤ 1000` | Yellow `#1c1500` | "Close to limit" | "Only $X below max bid" |
| `margin < 0` | Red `#1f0a0a` | "Above recommended max" | `$X over max bid` |
| No current price | Neutral gray | "No current bid price" | explanation |

### Badge pills section
Replaced flat text + badge combos with pill-style items:

- **Confidence:** green/yellow/red based on high/medium/low
- **Safety:** green (safe/low risk), yellow (moderate), red (risky/high risk)
- **Comps:** blue pill showing comparable count
- **Fallback:** green (exact/local), yellow (regional/global/unknown)

### Input Coverage (Data Quality)
New 4-column grid showing which fields were captured:
`VIN · Mileage · City · Seller · Trim · Drive · Fuel · Engine`

- Green dot + label = field captured
- Gray dot + label = field missing
- "Missing: X, Y, Z" note shown if any fields absent

### Report Notes
Replaced long mashed `reason` string with structured bullet list:

```
Report Notes:
• 5 comparable vehicles found
• Market fallback used: global
• Calibration applied: v15.4a   ← or "Calibration artifact not available" if null
• Model version: catboost-v3.2
• No CARFAX / condition data included
• [any extra reason parts not already covered]
```

**Calibration fix:** `normaliseResponse` now reads `raw.calibration_version` from the API response (was hardcoded to `null`). "Calibration artifact not available" is only shown when `calibration_version` is actually null/missing from the response.

### Collapsible debug panel
Inside the popover (no separate modal):
- Toggle button "⌥ Debug Details ▶"
- Expands to show JSON: `{ vehicle: ..., result: ... }`
- Collapses by default; re-positions popover on toggle

### Footer
Two clean action buttons:

| Button | Class | Action |
|--------|-------|--------|
| ↻ Refresh | `autopluto-refresh-btn` | Force-reloads from API |
| ⎘ Copy Result | `autopluto-copy-result-btn` | Copies JSON summary to clipboard |

Copy result payload:
```json
{
  "vehicle": "2017 NISSAN MURANO SV",
  "vin": "5N1AZ2...",
  "estimated_market_price": 11311,
  "recommended_max_bid": 9954,
  "current_price": 5800,
  "margin_to_max_bid": 4154,
  "confidence": "high",
  "safety": "safe",
  "comparables": 5,
  "fallback": "global",
  "model": "catboost-v3.2"
}
```

### Loading state
Updated to match dark theme:
- Blue gradient header with "AI Estimate" badge
- Dark shimmer skeleton bars (`#1f2937 → #374151`)

### Error card
Updated to match dark theme:
- Red gradient header (same structure as success card)
- Error text in `#fca5a5` (red-300)
- Copy payload button uses new `autopluto-footer-btn--secondary` style

---

## 3. CSS Classes Added

| Class | Purpose |
|-------|---------|
| `autopluto-badge-ai` | "AI Estimate" frosted pill in header |
| `autopluto-badge-model` | Model version pill in header |
| `autopluto-header-top` | Flex row: title group + close button |
| `autopluto-header-title-group` | Flex column: title + badges |
| `autopluto-header-badges` | Badge pill row in header |
| `autopluto-header-meta` | VIN + mileage row under header title |
| `autopluto-card-vin` | Monospace VIN line in header |
| `autopluto-mileage-tag` | Mileage display in header |
| `autopluto-card-header--error` | Red gradient header for errors |
| `autopluto-price-grid` | Auto-fit grid for price cards |
| `autopluto-price-card` | Individual price card |
| `autopluto-price-card--main` | Emphasized green Rec. Max Bid card |
| `autopluto-price-card--market` | Blue Est. Market Price card |
| `autopluto-price-card--current` | Gray Current Bid card |
| `autopluto-price-card-label` | Label inside price card |
| `autopluto-price-card-value` | Number inside price card |
| `autopluto-decision-banner` | Decision result banner |
| `autopluto-decision-banner--good/caution/danger/neutral` | Color variants |
| `autopluto-decision-icon` | Emoji icon in decision banner |
| `autopluto-decision-title` | Main text in decision banner |
| `autopluto-decision-subtitle` | Sub-text in decision banner |
| `autopluto-warning-banner` | Yellow inline warning message |
| `autopluto-badges-section` | Flex wrapper for badge pills |
| `autopluto-badge-item` | Individual badge pill |
| `autopluto-badge-item--green/yellow/red/blue/gray` | Color variants |
| `autopluto-badge-item-label` | Small uppercase label in pill |
| `autopluto-badge-item-value` | Value text in pill |
| `autopluto-data-quality` | Input coverage section |
| `autopluto-data-quality-title` | Section title |
| `autopluto-data-quality-grid` | 4-column field grid |
| `autopluto-data-field` | Individual field row (dot + name) |
| `autopluto-data-field--ok/miss` | Present / missing states |
| `autopluto-data-field-dot` | Colored status dot |
| `autopluto-data-missing-note` | "Missing: X, Y" note text |
| `autopluto-report-notes` | Report notes panel |
| `autopluto-report-notes-title` | Section title |
| `autopluto-report-notes-list` | Bullet list of notes |
| `autopluto-debug-panel` | Collapsible debug container |
| `autopluto-debug-toggle` | Toggle button |
| `autopluto-debug-arrow` | ▶/▼ arrow in toggle |
| `autopluto-debug-content` | Collapsible content area |
| `autopluto-debug-open` | JS-toggled open state |
| `autopluto-footer-btn` | Base footer button style |
| `autopluto-footer-btn--primary` | Blue primary button |
| `autopluto-footer-btn--secondary` | Gray secondary button |
| `autopluto-footer-btn--ghost` | Transparent ghost button |
| `autopluto-copy-result-btn` | Copy result button |

---

## 4. Before / After Notes

| Aspect | v4 (before) | v5 (after) |
|--------|-------------|------------|
| Theme | White / Google Material | Dark (`#111827`) professional |
| Card width | 320 px | 400 px |
| Price numbers | 14 px | 15–18 px, colored by role |
| Margin display | Small badge row | Full-width colored decision banner |
| Reason text | One mashed italic sentence | Structured bullet list |
| Data quality | Not shown | 8-field input coverage grid |
| Debug panel | External modal (debug mode only) | Inline collapsible (always available) |
| Footer actions | Single "Refresh" text link | Refresh + Copy Result buttons |
| Calibration note | Always "not available" | Accurate: shows version or "not available" |
| Error card theme | White card, red border | Dark card, red gradient header |
| Loading state | White shimmer bars | Dark shimmer bars |

---

## 5. Decision Logic

```
margin = recommended_max_bid − current_auction_price

margin > 1000     → Green  "Good room to bid"
0 ≤ margin ≤ 1000 → Yellow "Close to limit"
margin < 0        → Red    "Above recommended max"
no current price  → Neutral "No current bid price"
```

---

## 6. Data Quality Logic

Fields checked: `vin`, `mileage`, `cityAuction`, `sellerName`, `trim`, `drivetrain`, `fuelType`, `engine`

- Present (`!= null && != ''`) → green dot
- Missing → gray dot
- Any missing fields listed in "Missing: X, Y, Z" note

---

## 7. Calibration Note Logic

```javascript
if (result.calibration_version) {
  // API returned e.g. "v15.4a"
  notes.push(`Calibration applied: ${result.calibration_version}`);
} else {
  // API returned null / field missing
  notes.push('Calibration artifact not available');
}
```

`normaliseResponse` now reads `raw.calibration_version ?? null` instead of hardcoding `null`.

---

## 8. Tests to Perform

| Test case | Expected |
|-----------|----------|
| Normal vehicle (good margin) | Green decision banner, all price cards |
| High price vehicle (above max bid) | Red decision banner |
| Vehicle near limit | Yellow decision banner |
| Missing VIN vehicle | Header VIN shows "not detected" warning, data quality flags VIN as missing |
| High mileage vehicle | Mileage shown in header meta |
| Sold vehicle | Shows current price card; decision calculated |
| IF (if-present) vehicle | Shows correctly regardless of IF status |
| API returns calibration_version | "Calibration applied: vX.X" shown in notes |
| API returns null calibration | "Calibration artifact not available" shown |
| Debug toggle | Opens/closes; repositions popover |
| Copy Result button | Copies JSON summary; button changes to "✓ Copied" |
| Refresh button | Forces new API call |
| Close button | Removes popover cleanly |
| Multiple row clicks | No duplicate popovers (closeActivePopover guard) |
| Near-bottom viewport | Popover shifts up (positionPopover clamp) |
| Near-right viewport | Popover shifts left |

---

## 9. Acceptance Criteria

- [x] Popup looks like a professional estimate report, not a basic tooltip
- [x] Recommended Max Bid is visually emphasized (largest number, green)
- [x] Margin decision is immediately understandable (colored banner)
- [x] Confidence/safety/fallback/comparables are easy to read (pill badges)
- [x] Missing data is clearly shown (input coverage grid)
- [x] Debug details available but hidden by default (collapsible panel)
- [x] No build system added — plain CSS + vanilla JS
- [x] Extension still loads directly in Chrome
- [x] Calibration note is accurate (reads from API response)
- [x] Reason text is structured bullet list, not one long string
