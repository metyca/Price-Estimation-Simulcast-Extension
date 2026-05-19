# Selector Audit – OPENLANE / Velocicast Auction Page

> **Audit date:** 2026-05-12  
> **Source:** Live DOM snapshot from adesa.openlane.velocicast.io (Lane B, OPENLANE Halifax)  
> **Confirmed by:** User-supplied full-page HTML including vehicle list rows and right-panel markup

---

## 1. Vehicle Row Selector

### Primary

```css
tr[data-cy-item-num]
```

**Confirmed.** Every vehicle row carries a `data-cy-item-num` attribute equal to the run number (integer). The active/current item additionally carries the class `current-item`.

```html
<tr data-cy-item-num="83" class="current-item"> … </tr>
<tr data-cy-item-num="1"> … </tr>
```

### Fallback

```css
tbody.vc-tbdy-vehlist > tr
```

Rows are wrapped in `<tbody class="vc-tbdy-vehlist">` inside a condensed table. If `data-cy-item-num` is absent (edge case), rows that contain `.item-info-row` are treated as vehicle rows.

---

## 2. Run Number Selector

### Primary (inside row)

```css
tr[data-cy-item-num] .run-number
```

Text format: `#83` — the `#` prefix is stripped to obtain the integer run number.

```html
<span class="run-number">#83</span>
```

### Alternative (attribute on TR)

```js
rowEl.getAttribute('data-cy-item-num')  // → "83"
```

This is more reliable than text parsing.

---

## 3. Vehicle Title / Year-Make-Model-Trim Selector

### Primary

```css
tr[data-cy-item-num] .item-info-row a.vc-details > div:first-child
```

Text format: `#83- 2022 MAZDA CX-30 GX`

Parsing regex (used in `extractVehicleData.js`):

```js
/^#?\d+\s*[-–]\s*(\d{4})\s+(\S+)\s+(\S+)\s*(.*)/
// group 1 = year, group 2 = make, group 3 = model, group 4 = trim
```

Confirmed working for:
- `#1- 2025 TOYOTA PRIUS PLUG-IN HYBRID SE`
- `#18- 2023 FORD F-150 XLT CREW CAB SHORT BED`
- `#64- 2021 CHEVROLET SILVERADO 1500 RST CREW CAB SHORT BED`

---

## 4. VIN Selector

### Primary

```css
tr[data-cy-item-num] .item-vin
```

The `<span class="item-vin">` contains the label `"VIN: "`, and the VIN itself is the **next sibling text node** inside the parent `<div>`.

```html
<div><span class="item-vin">VIN: </span>3MVDMBB7XNM415065</div>
```

Extraction:

```js
const vinEl = rowEl.querySelector('.item-vin');
const vinText = vinEl?.parentElement?.textContent?.replace('VIN:', '').trim();
```

### Fallback (right panel details table)

```css
.lane-panel-col-right table td.selectable
```

The details table row `<label>VIN</label> / <td class="text-right selectable">3MVDMBB7XNM415065</td>` provides a second extraction point when the right panel shows the matching vehicle.

---

## 5. Mileage Selector

### Primary

```css
tr[data-cy-item-num] .mileage-row
```

The cell contains:
1. A `<span class="block">` holding the **colour** (e.g. `Black`)
2. A direct text node with the mileage: `\n    108,050 KM\n`

Extraction:

```js
const raw = mileageCell.childNodes[2]?.textContent  // text node after the span
            ?? mileageCell.textContent;
const km = parseInt(raw.replace(/[^0-9]/g, ''), 10);
```

Confirmed for values with and without commas: `108,050 KM`, `23,856 KM`, `293,248 KM`.

---

## 6. Exterior Colour Selector

### Primary

```css
tr[data-cy-item-num] .mileage-row .block
```

```html
<span class="block">Black</span>
```

Case varies across rows (e.g. `BLACK`, `ATLAS WHITE`, `CREAMY WHITE PEARL`). The extension stores the raw value.

---

## 7. Sale Status Selector

### Primary

```css
tr[data-cy-item-num] .badge-row
```

The cell contains only a text node. Possible values observed: `IF`, `Sold`, `No Sale`. Extracted via `textContent.trim()`.

```html
<td class="badge-row">
  IF
</td>
```

### Right Panel Alternative

```css
.lane-panel-col-right .vc-salestatus-badge
```

```html
<span class="vc-salestatus-badge alert-danger">IF</span>
```

---

## 8. Displayed Price Selector

### Primary

```css
tr[data-cy-item-num] .price-row span
```

Value examples: `$12,200`, `--` (no price). The `--` case resolves to `null`. Dollar sign and commas are stripped; result is an integer.

```html
<td class="price-row">
  <span>
    $12,200
  </span>
</td>
```

---

## 9. Right-Panel Selectors

All selectors are scoped to `.lane-panel-col-right` to avoid collisions with the left column.

| Data Point | Selector | Notes |
|---|---|---|
| Active run number | `.lane-panel-col-right .vc-itemnum` | Text: `#83` |
| Active bid / current price | `.lane-panel-col-right .vc-bid-amt.active-price` | Text: `$12,200` |
| Next bid increment | `.lane-panel-col-right .vc-bid-btn.bid-price` | Text: `$12,300` |
| Sale lights | `.lane-panel-col-right .vc-lights li.stat-active` | Classes: `stat-green`, `stat-yellow`, `stat-red`, etc. |
| Rep panel min price | `.lane-panel-col-right .vc-rep-minval` | Text: `Min Price $18,000` |
| Seller name | Details table `label:contains("Seller") + td` | e.g. `OPENLANE CANADA INC.- OPEN FLEET & LEASE CONSIGNORS` |
| Trim (right panel) | Details table `label:contains("Trim") + td` | Fallback if row trim parsing yields empty |
| Drive type | Details table `label:contains("Drive Type") + td` | e.g. `All Wheel Drive` |
| Engine | Details table `label:contains("Engine") + td` | e.g. `4G`, `6DT` |
| Fuel type | Details table `label:contains("Fuel") + td` | e.g. `Gasoline`, `Diesel` |
| Transmission | Details table `label:contains("Transmission") + td` | e.g. `AT` |
| Door count | Details table `label:contains("Door") + td` | e.g. `4` |
| Body style | Details table `label:contains("Body Style") + td` | e.g. `AWD`, `4WD CREW CAB 147"` |

The right-panel data is only merged when the panel's `vc-itemnum` matches the clicked row's run number.

---

## 10. cityAuction / Lane Selector

### Lane title bar

```css
.lane-title-bar__name
```

Text format: `Lane B - OPENLANE Halifax`

Extraction:

```js
const title = document.querySelector('.lane-title-bar__name p')?.textContent.trim();
// → "Lane B - OPENLANE Halifax"
const parts = title.split(' - ');
const lane = parts[0];           // → "Lane B"
const auctionName = parts[1];    // → "OPENLANE Halifax"
```

`cityAuction` is extracted by stripping the `OPENLANE ` prefix from `auctionName`.

### Fallback – side-nav

```css
.vc-auction h4.vc-auc-name
```

The auction chooser navigation lists auction names as `OPENLANE Halifax`, `OPENLANE Edmonton`, etc. These can be used to set `cityAuction` when the title bar is unavailable.

### Confirmed city mappings

| Auction Name | cityAuction |
|---|---|
| OPENLANE Halifax | Halifax |
| OPENLANE Edmonton | Edmonton |
| OPENLANE Toronto | Toronto |
| OPENLANE Montreal | Montreal |
| OPENLANE Quebec City | Quebec City |
| OPENLANE Calgary | Calgary |
| OPENLANE Vancouver | Vancouver |
| OPENLANE Winnipeg | Winnipeg |

---

## 11. DOM Change Strategy

The Velocicast page uses a Vue-based frontend. Vehicle lists are re-rendered when:
- A new vehicle becomes active (current-item class moves).
- The lane changes.
- The user scrolls or the list refreshes.

### Injection Guard

Each row receives the attribute `data-autopluto-estimate-injected="true"` after button injection. `injectEstimateButton()` checks for this attribute before adding a new button, preventing duplicates.

### MutationObserver

```js
observer.observe(document.body, { childList: true, subtree: true });
```

On every `addedNodes` mutation, `injectIntoRows()` is called on the added subtree. This covers:
- Full list re-renders
- Single row additions
- Right-panel replacements

---

## 12. Known Limitations / Risks

| Issue | Risk | Mitigation |
|---|---|---|
| Velocicast may update class names in a new deploy | Medium | Use `data-cy-*` attributes as primary selectors; they are more stable than utility classes |
| `tr[data-cy-item-num]` absent in a hypothetical redesign | Low | Fallback to `tbody.vc-tbdy-vehlist > tr` with `.item-info-row` presence check |
| Right-panel is for the **active** vehicle only | Expected | We only read right-panel data when run numbers match |
| Price in right panel may lag behind live bid | Low | Store only as reference; never sent as a model feature |
| Multi-lane views render multiple `lane-title-bar__name` elements | Medium | The extension scopes `cityAuction` extraction to the closest ancestor lane column of the clicked row |
