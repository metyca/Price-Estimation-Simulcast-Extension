# OpenLane Estimator Extension – UI Update Notes

## Version: v8 — Estimate Report Card Redesign
**Date:** May 2026

---

## Overview

Complete redesign of the in-page estimate popover into a polished **Auction Estimate Report Card**.
The goal was to make pricing, bid decisions, confidence, risk, and review status dramatically
clearer and more actionable, without adding any build step or changing the extension loading model.

---

## Layout Changes

The popover is now structured into clearly separated, labelled sections:

| Section | Description |
|---------|-------------|
| A — Header | Vehicle title, "Estimate Report" badge, model version badge, calibration version badge |
| B — Vehicle identity row | VIN, mileage, city, seller, trim — all shown as small tags |
| C — Main pricing grid | Est. Market Price / Rec. Max Bid / Current Bid — 3 cards |
| D — Secondary prices sub-grid | Model Price, Calibrated, Adjusted, Comp Median — compact 4-col grid |
| E — Decision banner | Green / yellow / red contextual bid-vs-max-bid decision |
| F — Expected range | `Expected Market Range   $X — $Y` — dedicated row |
| G — Badge pills | Confidence · Safety · Comps · Quality · Fallback · Manual Review |
| H — Manual review warning | Amber highlighted box when `manual_review_required = true` |
| I — General warnings | Bid > market price warning, VIN missing warning |
| J — Report Notes | Structured bullet list (reason array + calibration/fallback/comp notes) |
| K — API Warnings | Separate structured list from `warnings[]` array |
| L — Adjustment Details | Collapsible accordion: risk %, discount %, blend reason, blend weight, risk reasons |
| M — Input Coverage | Data quality grid (VIN, mileage, city, seller, trim, drive, fuel, engine) |
| N — Debug Details | Collapsible accordion with full raw JSON payload |
| O — Footer | Refresh · Copy Result buttons |

---

## New Sections Added

### Expected Market Range
Previously missing entirely. Now shown as:
```
Expected Market Range    $3,344 — $4,812
```
Fields used: `expected_range_low`, `expected_range_high`

### Secondary Prices Sub-Grid
A compact 4-column panel below the main pricing grid showing:
- `model_price`
- `calibrated_model_price`
- `adjusted_price`
- `comparable_median_price` (shows `—` when null)

### Manual Review Warning Box
When `manual_review_required = true`, a distinct amber warning box appears:
> ⚠ **Manual Review Required**
> Do not rely on this estimate without additional review.

Also reflected as a red `Review: Required` badge pill.

### Adjustment Details Accordion
Collapsible panel (collapsed by default) showing:
- `risk_adjustment_pct`
- `effective_bid_discount_pct`
- `blend_reason` (underscores replaced with spaces)
- `model_blend_weight` (shown as %)
- `risk_adjustment_reasons` (bullet list)

### API Warnings Section
When `warnings[]` is non-empty in the API response, a separate amber-accented
"API Warnings" section is rendered below Report Notes. Handles string items,
object items (`message`/`msg`/`text` keys), and raw JSON fallback.

### Calibration Version Badge
If `calibration_version` is present in the response, a purple-tinted badge
is shown next to the model version in the header.

---

## Styling Changes

### Card Width
`400px` → `460px` for improved readability of the wider layout.

### Popover Positioning
`POPOVER_W` constant updated to match (460) so off-screen clamping stays correct.

### Recommended Max Bid
Font size: `18px` → `22px`. This is the most decision-critical number and now
receives the strongest visual emphasis.

### Decision Banner Title
Font size: `12px` → `13px`, weight `700` → `800` for more immediate readability.

### Badge Pills
All `confidence_level`, `bid_safety_level`, `comparable_quality`, `market_match_level`
values now have underscores replaced with spaces before display.

Comparable count badge is now `gray` when 0 (was always `blue`).

`comparable_quality` badge color:
- `good` / `high` → green
- `unreliable` / `low` → red
- anything else → yellow

### Header Identity Row
`cityAuction`, `sellerName`, and `trim` are now shown as small `autopluto-identity-tag`
spans below VIN / mileage in the card header. Previously these were omitted from the popup.

### Report Notes → Structured Sections
`autopluto-report-notes` HTML replaced by `autopluto-report-section` pattern with a
`autopluto-section-title` header and `autopluto-report-list` bullet list.

The `reason` field is now consumed as an **array** (from `_raw.reason`) rather than the
pre-joined string from `normaliseResponse()`, so each reason appears on its own line.

---

## New CSS Classes

All classes use the `autopluto-` prefix.

| Class | Purpose |
|-------|---------|
| `autopluto-secondary-prices` | 4-col secondary price sub-grid wrapper |
| `autopluto-secondary-metric` | Individual cell in secondary grid |
| `autopluto-secondary-label` | Dim uppercase label in secondary cell |
| `autopluto-secondary-value` | Value in secondary cell |
| `autopluto-range-card` | Expected market range row |
| `autopluto-range-label` | "Expected Market Range" label |
| `autopluto-range-value` | `$X — $Y` value |
| `autopluto-manual-review-box` | Amber warning box for manual review |
| `autopluto-manual-review-icon` | ⚠ icon inside review box |
| `autopluto-manual-review-title` | Title inside review box |
| `autopluto-manual-review-sub` | Subtitle inside review box |
| `autopluto-report-section` | Report section container (blue left border) |
| `autopluto-report-section--warn` | Variant with amber left border |
| `autopluto-section-title` | Section header label |
| `autopluto-section-title--warn` | Amber variant of section title |
| `autopluto-report-list` | Bullet list inside a report section |
| `autopluto-report-list--warn` | Amber bullet variant |
| `autopluto-report-list--muted` | Muted bullet variant (adjustment reasons) |
| `autopluto-identity-tag` | Small tag for city / seller / trim in header |
| `autopluto-vin-missing` | Amber color for missing VIN label |
| `autopluto-badge-calib` | Purple-tinted calibration version badge |
| `autopluto-adjust-grid` | 2-col grid inside adjustment accordion |
| `autopluto-adjust-item` | Single item in adjustment grid |
| `autopluto-adjust-label` | Dim label in adjustment grid |
| `autopluto-adjust-value` | Value in adjustment grid |
| `autopluto-adjust-reasons-title` | Title above risk reasons list |

---

## Fields Added from API Response

Fields now surfaced in the UI that were previously unused:

| Field | Where shown |
|-------|-------------|
| `model_price` | Secondary prices sub-grid |
| `calibrated_model_price` | Secondary prices sub-grid |
| `adjusted_price` | Secondary prices sub-grid |
| `comparable_median_price` | Secondary prices sub-grid (null → `—`) |
| `expected_range_low` | Expected Market Range row |
| `expected_range_high` | Expected Market Range row |
| `risk_adjustment_pct` | Adjustment Details accordion |
| `effective_bid_discount_pct` | Adjustment Details accordion |
| `risk_adjustment_reasons` | Adjustment Details accordion |
| `blend_reason` | Adjustment Details accordion |
| `model_blend_weight` | Adjustment Details accordion |
| `manual_review_required` | Manual review warning box + badge pill |
| `comparable_quality` | Badge pill (color-coded) |
| `warnings` | API Warnings section (separate from Report Notes) |
| `calibration_version` | Purple badge in card header |
| `reason` (as array) | Report Notes bullet list (one item per line) |

The `Copy Result` clipboard output now also includes:
`expected_range_low`, `expected_range_high`, `comparable_quality`,
`manual_review_required`.

---

## Graceful Handling of Null / Missing Fields

| Condition | Behaviour |
|-----------|-----------|
| `comparable_median_price = null` | Shows `—` in secondary prices |
| `expected_range_low/high = null` | Entire range row is hidden |
| `calibration_version` absent | No calibration badge shown |
| `manual_review_required = false` | No review warning box shown |
| `warnings = []` or null | API Warnings section is omitted |
| `comparable_count = 0` | Badge shown in gray (not blue) |
| `risk_adjustment_reasons = []` | Risk reasons list omitted from accordion |
| No adjustment fields present | Adjustment Details accordion omitted entirely |
| `sellerName / cityAuction / trim = null` | Identity tag omitted from header |

---

## Before / After Notes

**Before (v7):**
- Single dense card, limited hierarchy
- No expected range visible
- `reason` shown as one joined sentence in a flat report notes block
- No manual review warning
- No adjustment details
- No secondary price breakdown
- Badge pills missing `comparable_quality`, `manual_review_required`
- VIN / mileage only in header meta; city/seller/trim not shown
- Popover width: 400px

**After (v8):**
- Clear sectioned report card layout with labelled areas
- Expected market range displayed prominently as `$X — $Y`
- Reason items shown as individual bullets in Report Notes
- API warnings shown in a separate amber-accented Warnings section
- Amber "Manual Review Required" box when `manual_review_required = true`
- Collapsible Adjustment Details panel with all risk/blend metadata
- Secondary prices sub-grid below main cards (model, calibrated, adjusted, comp median)
- More badge pills: quality, manual review status
- City, seller, trim shown as identity tags in header
- Rec. Max Bid value font size increased to 22px (primary decision number)
- Popover width: 460px

---

## Files Changed

| File | Changes |
|------|---------|
| `content.js` | `POPOVER_W` 400→460; `buildReportNotes()` redesigned; `showResultCard()` redesigned; `showLoadingPopover()` badge label updated |
| `styles.css` | Card width 400→460px; price-card--main value 18→22px; decision-title 12→13px/700→800; 26 new CSS classes added |
| `reports/openlane_estimator_extension_ui_update.md` | This file |

No other files changed. No build step added. Extension loads directly as unpacked Chrome extension.
