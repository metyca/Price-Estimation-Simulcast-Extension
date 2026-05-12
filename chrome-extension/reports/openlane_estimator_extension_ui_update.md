# OPENLANE Estimator Extension — UI Update Report

**Date:** 2026-05-12  
**Scope:** Chrome Extension — Estimate tab moved OUTSIDE vehicle listing area (portal approach)  
**Files modified:** `content.js`, `styles.css`

---

## 1. Problem History

### v1 (original)
A `<button class="autopluto-estimate-btn">$ Estimate</button>` was injected directly into each `<tr>` row, overlapping vehicle title and price columns.

### v2 (previous)
Replaced by a vertical tab `<div class="autopluto-estimate-tab">` using `position: absolute; right: 0` inside the row. This was better, but the tab still lived **inside** the row box. Table rows (`display: table-row`) do not form reliable containing blocks for absolutely-positioned children, and the table container's `overflow: hidden` clipped the tab on many layout breakpoints.

### v3 (current — this update)
The tab is now rendered as a **portal element on `document.body`**, positioned using `getBoundingClientRect()` of its associated row. It appears **outside and to the right** of the listing area, is never clipped by any table container, and expands further outward on hover.

---

## 2. New Tab Design — Portal Approach

### Trigger structure

```html
<div class="autopluto-estimate-tab">
  <div class="autopluto-estimate-handle">
    <span class="autopluto-estimate-mini-label">AI</span>
  </div>
  <div class="autopluto-estimate-label">AI Estimate</div>
</div>
```

### Layout

| Property | Value |
|----------|-------|
| Rendered in | `#autopluto-tab-portal` div on `document.body` |
| Position | `position: fixed` — placed by JS |
| Left | `rowEl.getBoundingClientRect().right` (row's right edge) |
| Top | `rowEl.getBoundingClientRect().top` |
| Height | `rowEl.getBoundingClientRect().height` |
| Collapsed width | `26px` handle only |
| Expanded width | `26px + 96px label` on hover |
| Expansion direction | Rightward (outward from listing) |
| Default opacity | `0` — invisible until row hover |
| Row hover | JS adds `autopluto-tab-row-hover` → `opacity: 1` |
| Z-index | `9001` (above page, below popover at `9100`) |

### Handle (`autopluto-estimate-handle`)
- 26px wide, full row height
- Blue gradient `#1a73e8 → #0d5cbf`
- Rounded right corners `0 4px 4px 0`
- Contains vertical "AI" mini-label
- Shadow `2px 0 6px rgba(0,0,0,.2)` for depth

### Expanded label (`autopluto-estimate-label`)
- Hidden via `max-width: 0` (no layout shift)
- On tab hover → `max-width: 96px; padding: 0 8px`
- Slides to the **right**, away from listing content
- Text "AI Estimate", uppercase, 10px, white

### Tab States

| Class | Visual |
|-------|--------|
| *(default)* | Blue handle |
| `autopluto-tab-loading` | Gray-blue pulsing animation |
| `autopluto-tab-done` | Green handle + label |
| `autopluto-tab-error` | Red handle + label |

---

## 3. Portal Infrastructure

### Portal container

```css
#autopluto-tab-portal {
  position: fixed;
  top: 0; left: 0;
  width: 0; height: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 9000;
}
```

All tabs are children of this container. The container itself has `pointer-events: none`; each tab overrides to `pointer-events: auto`.

### Position tracking (`content.js`)

```javascript
function syncTabPosition(rowEl, tab) {
  const rect = rowEl.getBoundingClientRect();
  tab.style.top    = `${rect.top}px`;
  tab.style.left   = `${rect.right}px`;
  tab.style.height = `${rect.height}px`;
  tab.style.visibility = (rect.top < window.innerHeight && rect.bottom > 0) ? '' : 'hidden';
}

function syncAllTabPositions() { /* iterates _portalTabs Map */ }
```

Position updates are triggered by:
- `window scroll` (capture phase, passive)
- `window resize`
- `setInterval(syncAllTabPositions, 400)` for lazy-load / SPA reflow

### Row → tab hover bridge

```javascript
rowEl.addEventListener('mouseenter', () => tab.classList.add('autopluto-tab-row-hover'));
rowEl.addEventListener('mouseleave', () => {
  if (!tab.matches(':hover')) tab.classList.remove('autopluto-tab-row-hover');
});
tab.addEventListener('mouseleave', () => {
  if (!rowEl.matches(':hover')) tab.classList.remove('autopluto-tab-row-hover');
});
```

Since the tab is not a DOM child of the row, CSS `:hover` cannot cascade. The `mouseenter`/`mouseleave` bridge applies the `autopluto-tab-row-hover` class manually.

---

## 4. Why `position: absolute` Inside Row Was Removed

- `<tr>` elements use `display: table-row`, which does **not** create a containing block for absolutely positioned children in the CSS spec.
- The Velocicast table wrapper applies `overflow: hidden`, which clipped any child element extending beyond the row's right boundary.
- Setting `overflow: visible` on the table wrapper risked breaking the lane-list scroll and sticky header layout.
- A fixed-position portal element is not affected by any ancestor's `overflow` setting and works reliably across all supported browsers.

---

## 5. Popover Positioning (unchanged)

All popovers continue to be appended to `document.body` as `position: fixed`. The `positionPopover()` function places them at `rect.right + 12px` from the row, clamped to the viewport.

Since the tab now sits at `rect.right`, the popover opens to the right of the tab, further outside the listing — consistent with the new visual hierarchy.

---

## 6. Classes Added / Changed

### New
- `#autopluto-tab-portal` — portal container on `document.body`
- `autopluto-estimate-handle` — 26px handle strip
- `autopluto-estimate-mini-label` — "AI" text inside handle
- `autopluto-estimate-label` — expanding label to the right
- `autopluto-tab-row-hover` — JS-applied class for row-hover opacity

### Removed
- `autopluto-tab-label` — replaced by `autopluto-estimate-mini-label` + `autopluto-estimate-label`
- `tr[data-cy-item-num]:hover .autopluto-estimate-tab` CSS rule — replaced by JS class bridge

---

## 7. Acceptance Checklist

| Test | Expected | Status |
|------|----------|--------|
| Collapsed tab is outside the listing area | Tab at `left: rect.right`, not inside row | ✅ Portal position |
| Tab never clipped by table overflow | Portal on `document.body` bypasses all containers | ✅ Architecture |
| Tab height matches row height | `height` set from `rect.height` | ✅ JS sync |
| Tab top aligns with row top | `top` set from `rect.top` | ✅ JS sync |
| Hover expands tab to the right | `max-width` animation on `.autopluto-estimate-label` | ✅ CSS confirmed |
| Expansion does NOT cover row content | Label grows rightward from `left: rect.right` | ✅ CSS layout |
| Row text / price / status not covered | Tab is completely outside row boundary | ✅ By design |
| Row hover shows tab | `mouseenter` adds `autopluto-tab-row-hover` | ✅ JS bridge |
| Tab hover keeps tab visible | CSS `:hover` on tab itself | ✅ CSS confirmed |
| Click still triggers estimate | `click` listener on portal tab element | ✅ Code path |
| Popover opens to the right of tab | `positionPopover` → `rect.right + 12` | ✅ Unchanged |
| No duplicate tabs after DOM refresh | `data-autopluto-estimate-injected` guard + Map | ✅ Code path |
| Tab repositions on scroll | `scroll` listener → `syncAllTabPositions` | ✅ Listener added |
| Tab repositions on resize | `resize` listener → `syncAllTabPositions` | ✅ Listener added |
| Out-of-viewport tabs hidden | `visibility: hidden` when `rect.bottom ≤ 0` | ✅ Code path |
| Listing layout not broken | No DOM changes inside table rows | ✅ By design |
| Right panel layout not broken | Portal is body-level, does not affect lane panels | ✅ By design |
| Loading skeleton shown | `showLoadingPopover` on click | ✅ Unchanged |
| Dark mode compatible | `@media prefers-color-scheme: dark` | ✅ CSS section |

---

## 8. Before / After Summary

| Aspect | v2 (inside row, absolute) | v3 (portal, fixed) |
|--------|--------------------------|-------------------|
| DOM parent of tab | `<tr>` row element | `#autopluto-tab-portal` on `document.body` |
| Position type | `position: absolute` | `position: fixed` |
| Position anchor | `right: 0` inside row | `left: rect.right` from `getBoundingClientRect()` |
| Overflow clipping | Affected by table `overflow: hidden` | Not affected (portal bypasses all containers) |
| Row hover detection | CSS `tr:hover .tab` | JS `mouseenter`/`mouseleave` bridge |
| Expansion direction | Leftward (inward, over row content) | Rightward (outward, away from listing) |
| Handle width | 10px strip | 26px — more clickable |
| Label content | "ESTIMATE" text only | "AI" vertical mini-label + "AI Estimate" expanding label |
| Position tracking | Static (set once at inject) | Dynamic (scroll + resize + 400ms interval) |

