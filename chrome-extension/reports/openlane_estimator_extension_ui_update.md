# OPENLANE Estimator Extension — UI Update Report

**Date:** 2026-05-12  
**Scope:** Chrome Extension — Estimate trigger UI + result popover redesign  
**Files modified:** `content.js`, `styles.css`

---

## 1. Old UI Issue

The previous implementation injected a blue `<button class="autopluto-estimate-btn">$ Estimate</button>` directly into each vehicle row (`tr[data-cy-item-num]`).

**Problems:**
- Floating button overlapped the vehicle title, VIN, mileage, sale status, and price columns.
- Visually inconsistent with OPENLANE/Velocicast auction UI.
- Button text `$ Estimate` was visible mid-row, cluttering the list.
- The result card was appended inside the table row (`rowEl.appendChild(card)`), which caused clipping due to table overflow and z-index issues.
- No loading skeleton — UI felt unresponsive while the API was in-flight.

---

## 2. New Tab Design

### Trigger: Vertical Right-Edge Tab

| Property | Value |
|----------|-------|
| Element | `<div class="autopluto-estimate-tab">` |
| Position | `position: absolute; top: 0; right: 0; height: 100%` |
| Collapsed width | `10px` |
| Expanded width | `76px` (on hover) |
| Background | Linear gradient `#1a73e8 → #0d5cbf` |
| Border radius | `6px 0 0 6px` (left-rounded, flush to right edge) |
| Default opacity | `0` — invisible until row hover |
| Row hover opacity | `1` — appears on `tr[data-cy-item-num]:hover` |
| Tab hover | Expands to `76px`, shows "ESTIMATE" label |
| Transition | `opacity 0.15s, width 0.2s ease` — smooth |
| Z-index | `9000` |
| Shadow | `-1px 0 6px rgba(0,0,0,.15)` — soft depth cue |

### Tab Label

```html
<span class="autopluto-tab-label">Estimate</span>
```

- Hidden (`opacity: 0`) when collapsed.
- Fades in (`opacity: 1`) with `0.06s` delay when tab expands.
- Font: 9px, uppercase, letter-spacing 0.6px, white.

### Tab States

| Class | Meaning | Style |
|-------|---------|-------|
| *(default)* | Ready to click | Blue gradient |
| `autopluto-tab-loading` | API call in-flight | Gray-blue, pulsing animation |
| `autopluto-tab-done` | Result received | Green gradient, 55% opacity at rest |
| `autopluto-tab-error` | API error | Red gradient |

---

## 3. CSS Classes Added

### Tab
- `autopluto-estimate-tab` — outer tab strip
- `autopluto-tab-label` — "Estimate" text inside tab
- `autopluto-tab-loading` — loading pulse state
- `autopluto-tab-done` — success state
- `autopluto-tab-error` — error state

### Popover
- `autopluto-popover` — alias class on `.autopluto-card` for semantic clarity
- `autopluto-popover-header` — alias on `.autopluto-card-header`
- `autopluto-price-grid` — alias on `.autopluto-prices`
- `autopluto-price-primary` — alias on market price block
- `autopluto-price-secondary` — alias on max bid block
- `autopluto-close-btn` — alias on `.autopluto-card-close`
- `autopluto-badge-safe` — green badge (maps to `autopluto-badge-green`)
- `autopluto-badge-warning` — yellow badge (maps to `autopluto-badge-yellow`)
- `autopluto-badge-danger` — red badge (maps to `autopluto-badge-red`)

### Loading Skeleton
- `autopluto-skeleton-vehicle` — vehicle title in loading state
- `autopluto-skeleton-status` — status text ("Fetching estimate…")
- `autopluto-skeleton-bar` — animated shimmer bar (full width)
- `autopluto-skeleton-bar-sm` — shimmer bar at 68% width
- `autopluto-skeleton-bar-xs` — shimmer bar at 42% width

### Error / Debug
- `autopluto-copy-payload-btn` — "Copy payload" button in 422 error cards

---

## 4. Placement Logic

### Tab injection (`injectEstimateTab`)

```javascript
const tab = document.createElement('div');
tab.className = 'autopluto-estimate-tab';
tab.setAttribute('data-autopluto-btn', 'true');
tab.innerHTML = '<span class="autopluto-tab-label">Estimate</span>';
rowEl.appendChild(tab);
```

- Sets `position: relative` on the row only if its computed position is `static`.
- Uses `data-autopluto-estimate-injected="true"` marker to prevent duplicate injection.
- Appended as the last child of the `tr` — sits on the far right edge.

### Popover portal (`showResultCard`, `showErrorCard`, `showLoadingPopover`)

All popovers are appended directly to `document.body` as `position: fixed` elements — not inside the table. This avoids all table clipping, overflow, and stacking context issues.

A single global reference `_activePopover` / `_activePopoverRow` tracks the open popover. Opening a new popover automatically closes the previous one.

---

## 5. Collision Handling

```javascript
function positionPopover(popover, rowEl) {
  const POPOVER_W = 320;
  const rect      = rowEl.getBoundingClientRect();

  // Place to the right of the row
  let left = rect.right + 12;
  if (left + POPOVER_W > window.innerWidth - 16) {
    left = window.innerWidth - POPOVER_W - 16;  // clamp to viewport
  }
  left = Math.max(16, left);

  // Align top to row, clamp bottom to viewport
  const popoverH = popover.offsetHeight || 420;
  let top = rect.top;
  if (top + popoverH > window.innerHeight - 16) {
    top = window.innerHeight - popoverH - 16;
  }
  top = Math.max(16, top);

  popover.style.left = `${left}px`;
  popover.style.top  = `${top}px`;
}
```

**Rules:**
- Primary placement: `rect.right + 12px` (to the right of the row).
- If no space on right: clamps to `window.innerWidth - 320 - 16`.
- Vertical: aligns with row top; clamps if popover would overflow viewport bottom.
- Always at least `16px` from any edge.

---

## 6. Loading State

When the tab is clicked and no cached result exists:

1. Tab switches to `autopluto-tab-loading` (pulsing blue-gray animation).
2. `showLoadingPopover(rowEl, vehicleTitle)` opens immediately at the row position showing:
   - Header: "Auction Price Estimate"
   - Extracted vehicle title
   - Status: "Fetching estimate…"
   - 4 animated shimmer skeleton bars
3. On API success: loading popover is replaced by the full result card (`showResultCard`).
4. On API error: loading popover is replaced by the error card (`showErrorCard`).

---

## 7. Error State

On API failure:

- Tab turns red (`autopluto-tab-error`).
- Error popover opens fixed-position to the right of the row.
- For HTTP 422: validation errors rendered as a `<ul>` list with field paths.
- For HTTP 422 and other API errors: "Copy payload" button appears (`autopluto-copy-payload-btn`) — copies raw error JSON to clipboard.
- Timeout and network errors show specific human-readable messages.

---

## 8. Duplicate Prevention

The `data-autopluto-estimate-injected="true"` attribute prevents re-injection:

```javascript
if (rowEl.getAttribute('data-autopluto-estimate-injected') === 'true') return;
rowEl.setAttribute('data-autopluto-estimate-injected', 'true');
```

The `MutationObserver` fires `injectIntoRows` on newly added nodes. Because the marker is set on first injection, re-renders and scroll-based lazy loads do not produce duplicate tabs.

---

## 9. Tests Performed / Acceptance Checklist

| Test | Expected | Status |
|------|----------|--------|
| Tab attaches to each `tr[data-cy-item-num]` | Tab div present as last child | ✅ Code path verified |
| Tab invisible on non-hover | `opacity: 0` default | ✅ CSS confirmed |
| Tab visible on row hover | CSS `:hover` rule activates | ✅ CSS confirmed |
| Tab expands on hover | `width: 76px` on `.autopluto-estimate-tab:hover` | ✅ CSS confirmed |
| Tab height matches row | `height: 100%` + row is positioned container | ✅ CSS confirmed |
| No floating `$ Estimate` button | Old `injectEstimateButton` removed | ✅ Replaced in code |
| No duplicate tabs after scroll | `data-autopluto-estimate-injected` guard | ✅ Code path confirmed |
| Popover opens to the right | `rect.right + 12` placement | ✅ `positionPopover()` |
| Popover doesn't cover row text | Fixed portal on `document.body` | ✅ Not inside table |
| Viewport collision handled | Clamp logic in `positionPopover()` | ✅ Code confirmed |
| Loading skeleton shown | `showLoadingPopover` on click | ✅ Code path confirmed |
| Result replaces skeleton | `closeActivePopover()` → append result | ✅ Code path confirmed |
| Error card with copy button | 422 → `autopluto-copy-payload-btn` | ✅ Code path confirmed |
| Dark mode compatible | `@media prefers-color-scheme: dark` | ✅ Updated in CSS |

---

## 10. Before / After Summary

| Aspect | Before | After |
|--------|--------|-------|
| Trigger element | `<button class="autopluto-estimate-btn">$ Estimate</button>` | `<div class="autopluto-estimate-tab">` |
| Trigger position | Floating center-right of row, overlapping text | Far right edge strip, full row height |
| Default visibility | Hidden (`display: none`) | Hidden (`opacity: 0`) |
| Hover reveal | Jumps in with `display: inline-block` | Smooth opacity fade in |
| Expanded state | N/A | 76px wide, label visible |
| Result card anchor | `rowEl.appendChild(card)` — inside table row | `document.body.appendChild(card)` — fixed portal |
| Loading feedback | None — button text changed to "⏳ Loading…" | Immediate skeleton popover with shimmer bars |
| Confidence badges | Plain text in meta row | Color-coded badges (`autopluto-badge-safe/warning/danger`) |
| Error copy button | Not available | "Copy payload" in 422 errors |
| Duplicate guard | `data-autopluto-estimate-injected` | Same (unchanged) |
| Dark mode | Partial | Full coverage including skeleton and copy button |
