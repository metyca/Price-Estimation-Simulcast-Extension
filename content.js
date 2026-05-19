/* global chrome, window, document, navigator */
'use strict';

(function () {

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS  (storage keys match options.js exactly)
  // ═══════════════════════════════════════════════════════════════════════════

  const DEFAULT_SETTINGS = {
    apiBaseUrl:      'https://catboost-100027963480.northamerica-northeast2.run.app',
    apiEndpoint:     '/v1/predict',
    apiKey:          '',
    requestTimeout:  15000,
    defaultSource:   'openlane',
    defaultSection:  'simulcast',
    debugMode:       false,
    showCopyButtons: true,
    batchEnabled:    false,
  };

  let _settings = null;

  function getSettings() {
    if (_settings) return Promise.resolve(_settings);
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        _settings = { ...DEFAULT_SETTINGS, ...items };
        resolve(_settings);
      });
    });
  }

  chrome.storage.onChanged.addListener(() => { _settings = null; });

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACT VEHICLE DATA
  // ═══════════════════════════════════════════════════════════════════════════

  function getText(el, selector) {
    const node = selector ? el.querySelector(selector) : el;
    return node ? node.textContent.trim() : null;
  }

  function getTableValue(container, labelText) {
    if (!container) return null;
    const lower = labelText.toLowerCase();

    // Strategy 1: <label> inside a <td>/<th>
    for (const lbl of container.querySelectorAll('td label, th label')) {
      if (lbl.textContent.trim().toLowerCase() === lower) {
        const cell = lbl.closest('td, th');
        if (cell && cell.nextElementSibling) {
          return cell.nextElementSibling.textContent.trim() || null;
        }
      }
    }

    // Strategy 2: plain <td>/<th> whose full text matches the label
    for (const cell of container.querySelectorAll('td, th')) {
      if (cell.textContent.trim().toLowerCase() === lower && cell.nextElementSibling) {
        return cell.nextElementSibling.textContent.trim() || null;
      }
    }

    // Strategy 3: any leaf element matching the label (div/flex/span layouts)
    for (const el of container.querySelectorAll('span, div, dt, label')) {
      if (el.querySelector('span, div, dt, label')) continue; // skip non-leaf
      if (el.textContent.trim().toLowerCase() !== lower) continue;
      const next = el.nextElementSibling;
      if (next) { const v = next.textContent.trim(); if (v) return v; }
      const pNext = el.parentElement && el.parentElement.nextElementSibling;
      if (pNext) { const v = pNext.textContent.trim(); if (v) return v; }
    }

    return null;
  }

  /** Watches `root` for a matching element; resolves null on timeout. */
  function waitForElement(root, selector, timeoutMs) {
    return new Promise((resolve) => {
      const existing = root.querySelector(selector);
      if (existing) return resolve(existing);
      const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
      const observer = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) { clearTimeout(timer); observer.disconnect(); resolve(el); }
      });
      observer.observe(root, { childList: true, subtree: true });
    });
  }

  function parseTitle(rawTitle) {
    if (!rawTitle) return {};
    const withoutRun = rawTitle.replace(/^#\d+\s*-\s*/, '').trim();
    const yearMatch = withoutRun.match(/^(\d{4})\s+(.+)$/);
    if (!yearMatch) return { titleFull: withoutRun };

    const year = parseInt(yearMatch[1], 10);
    const rest = yearMatch[2].trim();

    const knownMakes = [
      'LAND ROVER', 'ALFA ROMEO', 'ASTON MARTIN', 'ROLLS ROYCE', 'MERCEDES-BENZ',
      'GENESIS', 'RAM', 'GMC', 'KIA', 'BMW', 'AUDI', 'VOLKSWAGEN',
      'TOYOTA', 'HONDA', 'NISSAN', 'MAZDA', 'FORD', 'CHEVROLET', 'DODGE',
      'JEEP', 'HYUNDAI', 'SUBARU', 'MITSUBISHI', 'CHRYSLER', 'BUICK',
      'CADILLAC', 'LINCOLN', 'INFINITI', 'LEXUS', 'ACURA', 'VOLVO', 'SAAB',
      'FIAT', 'MINI', 'SMART', 'PORSCHE', 'JAGUAR', 'BENTLEY', 'MASERATI',
    ];

    let make = null;
    let afterMake = rest;

    for (const m of knownMakes.sort((a, b) => b.length - a.length)) {
      if (rest.toUpperCase().startsWith(m)) {
        make = m;
        afterMake = rest.slice(m.length).trim();
        break;
      }
    }

    if (!make) {
      const parts = rest.split(' ');
      make = parts[0];
      afterMake = parts.slice(1).join(' ');
    }

    const modelParts = afterMake.split(' ');
    const model = modelParts[0] || null;
    const trim = modelParts.slice(1).join(' ') || null;

    return {
      year,
      make,
      model,
      trim: trim || null,
      titleFull: `${year} ${make} ${afterMake}`.trim(),
    };
  }

  function parseMileage(raw) {
    if (!raw) return null;
    const km = parseInt(raw.replace(/[^0-9]/g, ''), 10);
    return isNaN(km) ? null : km;
  }

  function parsePrice(raw) {
    if (!raw || raw.trim() === '--') return null;
    const n = parseInt(raw.replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? null : n;
  }

  function extractLaneContext(laneColumn) {
    const titleBar = laneColumn.querySelector('.lane-title-bar__name');
    const raw = (titleBar && (titleBar.title || titleBar.textContent)) || '';
    const match = raw.trim().match(/^(.+?)\s*-\s*(.+)$/);
    if (match) {
      return {
        lane: match[1].trim(),
        auctionName: match[2].trim(),
        cityAuction: match[2].trim().replace(/^OPENLANE\s*/i, '').trim(),
      };
    }
    return { lane: null, auctionName: raw.trim() || null, cityAuction: null };
  }

  function extractPageContext() {
    let auctionName = null;
    let cityAuction = null;
    let lane = null;

    const activeLaneTitleBars = document.querySelectorAll('.lane-title-bar__name');
    for (const bar of activeLaneTitleBars) {
      const text = (bar.title || bar.textContent || '').trim();
      if (text && text.includes('-')) {
        const m = text.match(/^(.+?)\s*-\s*(.+)$/);
        if (m) {
          lane = m[1].trim();
          auctionName = m[2].trim();
          cityAuction = auctionName.replace(/^OPENLANE\s*/i, '').trim();
          break;
        }
      }
    }

    if (!auctionName) {
      const saleEl = document.querySelector('.vc-auc-name, h4.vc-auc-name');
      if (saleEl) {
        const text = saleEl.textContent.trim();
        auctionName = text;
        cityAuction = text.replace(/^OPENLANE\s*/i, '').trim();
      }
    }

    if (!auctionName) {
      const helpTitle = document.querySelector('#vc-cust-help-cont h5.item-info-title');
      if (helpTitle) {
        auctionName = helpTitle.textContent.trim();
        cityAuction = auctionName.replace(/^OPENLANE\s*/i, '').trim();
      }
    }

    return {
      source: 'openlane',
      section: 'simulcast',
      auctionName: auctionName || null,
      cityAuction: cityAuction || null,
      lane: lane || null,
      pageUrl: window.location.href,
      extractionSource: 'chrome-extension',
    };
  }

  function extractRightPanelData(expectedRunNumber, laneColumn) {
    const panel = laneColumn
      ? laneColumn.querySelector('.lane-panel-col-right')
      : document.querySelector('.lane-panel-col-right');

    if (!panel) return {};

    const panelRunEl = panel.querySelector('.vc-itemnum');
    const panelRunRaw = panelRunEl ? panelRunEl.textContent.trim().replace(/^#/, '') : null;
    if (panelRunRaw && String(expectedRunNumber) !== panelRunRaw) return {};

    const bidAmtEl = panel.querySelector('.vc-bid-amt.active-price');
    const currentAuctionPrice = bidAmtEl ? parsePrice(bidAmtEl.textContent) : null;

    const lights = {};
    const lightEls = panel.querySelectorAll('.vc-lights .stat-sign');
    for (const li of lightEls) {
      ['green', 'yellow', 'orange', 'red', 'blue', 'white'].forEach((color) => {
        if (li.classList.contains(`stat-${color}`)) {
          lights[color] = li.classList.contains('stat-active');
        }
      });
    }

    const minValEl = panel.querySelector('.vc-rep-minval');
    const minPrice = minValEl ? parsePrice(minValEl.textContent) : null;

    // Try progressively broader selectors for the details container
    const detailsTable =
      panel.querySelector('.vc-item-det table') ||
      panel.querySelector('.vc-item-det')       ||
      panel.querySelector('[class*="item-det"]') ||
      panel.querySelector('[class*="item-details"]') ||
      null;

    // Use detailsTable when available, otherwise fall back to entire panel
    const detSrc = detailsTable || panel;

    const engine       = getTableValue(detSrc, 'Engine')           || getTableValue(detSrc, 'engine');
    const fuelType     = getTableValue(detSrc, 'Fuel')             || getTableValue(detSrc, 'fuel');
    const driveType    = getTableValue(detSrc, 'Drive Type')       || getTableValue(detSrc, 'drive type');
    const transmission = getTableValue(detSrc, 'Transmission')     || getTableValue(detSrc, 'transmission');
    const doorRaw      = getTableValue(detSrc, 'Door')             || getTableValue(detSrc, 'door');
    const doors        = doorRaw ? parseInt(doorRaw, 10) || null : null;
    const colorDetail  = getTableValue(detSrc, 'Color')            || getTableValue(detSrc, 'color');
    const interiorDetail = getTableValue(detSrc, 'Interior')       || getTableValue(detSrc, 'interior');
    const bodyStyle    = getTableValue(detSrc, 'Body Style')       || getTableValue(detSrc, 'body style');
    const sellerDetail = getTableValue(detSrc, 'Seller')           || getTableValue(detSrc, 'seller');
    const trimDetail   = getTableValue(detSrc, 'Trim')             || getTableValue(detSrc, 'trim');
    const vehicleLocation = getTableValue(detSrc, 'Vehicle Location') || getTableValue(detSrc, 'vehicle location');
    const vinDetail    = getTableValue(detSrc, 'VIN')              || getTableValue(detSrc, 'vin');

    return {
      currentAuctionPrice,
      lights,
      minPrice,
      engine:               engine         || null,
      fuelType:             fuelType       || null,
      drivetrain:           driveType      || null,
      transmission:         transmission   || null,
      doors,
      exteriorColorDetail:  colorDetail    || null,
      interiorColor:        interiorDetail || null,
      bodyStyle:            bodyStyle      || null,
      sellerName:           sellerDetail   || null,
      trimDetail:           trimDetail     || null,
      vehicleLocation:      vehicleLocation || null,
      vinDetail:            vinDetail      || null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POPUP DATA EXTRACTION  v2
  // Two-stage flow: open popup → VIN-verify → extract all fields → close.
  // ─────────────────────────────────────────────────────────────────────────

  // Global guard: only one popup operation at a time (critical for batch mode)
  let _popupOperationActive = false;

  /** Returns true when an element is in the DOM and visually present. */
  function isElementVisible(el) {
    if (!el || !document.contains(el)) return false;
    // Velocicast uses "out" class for inactive slide panes
    if (el.classList && el.classList.contains('out')) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none') return false;
    if (st.visibility === 'hidden') return false;
    if (parseFloat(st.opacity) === 0) return false;
    if (el.getClientRects().length === 0) return false;
    // position:fixed elements have offsetParent===null but are still visible
    if (st.position !== 'fixed' && el.offsetParent === null) return false;
    return true;
  }

  /**
   * Multi-variant label→value lookup.
   * Tries each label string in order and returns the first non-null hit.
   */
  function getTableLabelValue(container, labelVariants) {
    const list = Array.isArray(labelVariants) ? labelVariants : [labelVariants];
    for (const v of list) {
      const result = getTableValue(container, v);
      if (result) return result;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POPUP DETECTION  –  module-scope helpers used by extractWithPopup
  // ─────────────────────────────────────────────────────────────────────────

  const POPUP_SEL = '.vc-item-popup.item-detail-popup, .item-detail-popup, .vc-item-popup';

  /** Search the whole document for a currently visible vehicle detail popup. */
  function findVisiblePopup() {
    for (const p of document.querySelectorAll(POPUP_SEL)) {
      if (isElementVisible(p)) return p;
    }
    return null;
  }

  /**
   * Normalize a label string for stable comparison:
   * lowercase, trim, strip trailing punctuation, collapse whitespace.
   */
  function normalizeLabel(text) {
    return (text || '')
      .toLowerCase()
      .trim()
      .replace(/[.:*]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Find the best visible + populated details container inside the popup.
   * Prefers slide panes with class "in" (active); avoids "out" panes.
   */
  function findVisibleDetailsContainer(popupEl) {
    // Prefer explicitly "in" (active) slide panes
    const activeSelectors = [
      '.slidePane-item.in .item-detail-inner',
      '.vc-slide-cont.in .item-detail-inner',
      '.item-tabbed.in .item-detail-inner',
      '.tab-pane.active .item-detail-inner',
      '.in > .item-detail-inner',
    ];
    for (const sel of activeSelectors) {
      const el = popupEl.querySelector(sel);
      if (el && isElementVisible(el) && el.querySelectorAll('tr, td, th').length > 0) return el;
    }

    // Fall back: all .item-detail-inner — pick the one with most content
    let best = null;
    let bestScore = -1;
    for (const inner of popupEl.querySelectorAll('.item-detail-inner')) {
      if (inner.classList.contains('out')) continue;
      const score = inner.querySelectorAll('tr, td, th, label').length;
      if (score > bestScore) { bestScore = score; best = inner; }
    }
    if (best && bestScore > 0) return best;

    // Last resort
    return (
      popupEl.querySelector('.vc-pop-inner') ||
      popupEl.querySelector('.vc-item-inner') ||
      popupEl
    );
  }

  /**
   * Parse ALL visible label→value pairs from the popup's details section.
   * Returns a plain object keyed by normalizeLabel(label).
   * Three strategies handle table-row, flex/div-row, and leaf-sibling layouts.
   */
  function parseVisiblePopupFields(popupEl) {
    const fieldMap = {};
    const container = findVisibleDetailsContainer(popupEl);

    const record = (rawLabel, rawValue) => {
      const key = normalizeLabel(rawLabel);
      const val = (rawValue || '').trim();
      // Reject empty values and cells whose label === value (header-only rows)
      if (key && val && normalizeLabel(rawLabel) !== normalizeLabel(rawValue) && !fieldMap[key]) {
        fieldMap[key] = val;
      }
    };

    // ── Strategy 1: <table> rows (most common in Velocicast) ─────────────────
    for (const table of container.querySelectorAll('table')) {
      for (const tr of table.querySelectorAll('tr')) {
        const cells = tr.querySelectorAll('td, th');
        if (cells.length < 2) continue;
        const labelCell = cells[0];
        const valueCell = cells[cells.length - 1]; // last cell = value
        if (labelCell === valueCell) continue;

        // Label may be wrapped in <label>
        const labelEl = labelCell.querySelector('label');
        const rawLabel = ((labelEl || labelCell).textContent || '').trim();
        const rawValue = (valueCell.textContent || '').trim();
        if (rawLabel && rawValue) record(rawLabel, rawValue);
      }
    }

    // ── Strategy 2: flex/div label-value rows (non-table layouts) ────────────
    for (const row of container.querySelectorAll(
      '.detail-row, .spec-row, [class*="detail-row"], [class*="spec-row"], [class*="item-row"]'
    )) {
      const kids = Array.from(row.children).filter((k) => k.textContent.trim());
      if (kids.length < 2) continue;
      const rawLabel = (kids[0].textContent || '').trim();
      const rawValue = (kids[kids.length - 1].textContent || '').trim();
      if (rawLabel && rawValue) record(rawLabel, rawValue);
    }

    // ── Strategy 3: leaf-element sibling pairs (div/span/dt layouts) ─────────
    for (const el of container.querySelectorAll('span, div, dt, label')) {
      if (el.querySelector('span, div, dt, label')) continue; // skip non-leaf
      const rawLabel = (el.textContent || '').trim();
      if (!rawLabel || rawLabel.length > 50) continue;

      const tryValue = (candidate) => {
        if (!candidate) return false;
        const rawValue = (candidate.textContent || '').trim();
        if (rawValue && rawValue !== rawLabel) { record(rawLabel, rawValue); return true; }
        return false;
      };

      if (!tryValue(el.nextElementSibling)) {
        tryValue(el.parentElement && el.parentElement.nextElementSibling);
      }
    }

    return fieldMap;
  }

  /**
   * Map a parsed fieldMap (normalized keys) to standard vehicle data fields.
   * Also extracts equipment and high-value options from popup sections.
   */
  function mapPopupFieldsToData(fieldMap, popupEl) {
    const get = (...labels) => {
      for (const lbl of labels) {
        const val = fieldMap[normalizeLabel(lbl)];
        if (val) return val;
      }
      return null;
    };

    const doorRaw = get('door', 'doors');

    // ── Equipment list ────────────────────────────────────────────────────────
    const equipment = [];
    const equipSection = popupEl.querySelector('.item-equipment, [class*="equipment"]');
    if (equipSection) {
      equipSection.querySelectorAll('li, [class*="item"]').forEach((el) => {
        const t = el.textContent.trim();
        if (t) equipment.push(t);
      });
    }
    if (!equipment.length) {
      for (const hdr of popupEl.querySelectorAll('h3, h4, h5, .section-title, th')) {
        if (/^equipment$/i.test(hdr.textContent.trim())) {
          const cont = hdr.closest('tr') ? hdr.closest('table') : hdr.nextElementSibling;
          if (cont) {
            cont.querySelectorAll('li, td, span').forEach((el) => {
              const t = el.textContent.trim();
              if (t && t.toLowerCase() !== 'equipment') equipment.push(t);
            });
          }
          break;
        }
      }
    }

    // ── High Value Options list ───────────────────────────────────────────────
    const highValueOptions = [];
    const hvoSection = popupEl.querySelector('.item-hvo, [class*="high-value"], [class*="hvo-"]');
    if (hvoSection) {
      hvoSection.querySelectorAll('li, [class*="option"]').forEach((el) => {
        const t = el.textContent.trim();
        if (t) highValueOptions.push(t);
      });
    }
    if (!highValueOptions.length) {
      for (const hdr of popupEl.querySelectorAll('h3, h4, h5, .section-title, th')) {
        if (/high.value.options/i.test(hdr.textContent)) {
          const cont = hdr.closest('tr') ? hdr.closest('table') : hdr.nextElementSibling;
          if (cont) {
            cont.querySelectorAll('li, td, span').forEach((el) => {
              const t = el.textContent.trim();
              if (t && !/high.value.options/i.test(t)) highValueOptions.push(t);
            });
          }
          break;
        }
      }
    }

    return {
      vin:                get('vin'),
      trimDetail:         get('trim'),
      sellerName:         get('seller'),
      engine:             get('engine'),
      fuelType:           get('fuel', 'fuel type'),
      drivetrain:         get('drive type', 'drivetrain', 'drive'),
      transmission:       get('transmission', 'trans', 'trans.'),
      doors:              doorRaw ? (parseInt(doorRaw, 10) || null) : null,
      exteriorColor:      get('color', 'colour', 'exterior color', 'exterior colour'),
      interiorColor:      get('interior', 'interior color'),
      bodyStyle:          get('body style', 'style'),
      vehicleLocation:    get('vehicle location'),
      processingLocation: get('processing location'),
      frontLineReady:     get('front line ready'),
      titlePresent:       get('title present'),
      equipment,
      highValueOptions,
    };
  }

  /**
   * Click the Details tab inside the popup if it is not already active.
   * Returns true when a tab was actually clicked.
   */
  function clickDetailsTab(popup) {
    const candidates = [
      popup.querySelector('a[data-toggle="details"]'),
      popup.querySelector('[data-toggle="details"]'),
      popup.querySelector('.vc-tabs a:first-child'),
      popup.querySelector('.item-tabs a:first-child'),
      popup.querySelector('.nav-tabs a:first-child'),
    ].filter(Boolean);

    for (const el of candidates) {
      if (!el.classList.contains('active')) {
        el.click();
        return true;
      }
    }
    return false;
  }

  /** Click the popup's close button; fall back to Escape key. */
  function closePopupEl(popup) {
    if (!popup) return;
    const btn = popup.querySelector(
      '.vc-pop-close, [class*="pop-close"], button.close, ' +
      '[aria-label="close"], [aria-label="Close"], [title="Close"]'
    );
    if (btn) {
      btn.click();
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    }
  }

  /**
   * Extract every spec field from the open vehicle detail popup.
   * Delegates to parseVisiblePopupFields + mapPopupFieldsToData for robust extraction.
   */
  function extractFromPopup(popupEl) {
    const fieldMap = parseVisiblePopupFields(popupEl);
    return mapPopupFieldsToData(fieldMap, popupEl);
  }

  /**
   * Merge popup fields over base (row+panel) data.  Popup wins when present.
   * Optional fieldMap (raw parsed labels) is stored in metadata.popupFieldMap.
   */
  function mergeWithPopup(base, popup, fieldMap) {
    if (!popup) return base;
    return {
      ...base,
      vin:           popup.vin            || base.vin,
      trim:          popup.trimDetail     || base.trim,
      engine:        popup.engine         || base.engine,
      fuelType:      popup.fuelType       || base.fuelType,
      drivetrain:    popup.drivetrain     || base.drivetrain,
      transmission:  popup.transmission   || base.transmission,
      doors:         popup.doors          != null ? popup.doors : base.doors,
      exteriorColor: popup.exteriorColor  || base.exteriorColor,
      sellerName:    popup.sellerName     || base.sellerName,
      metadata: {
        ...base.metadata,
        vehicleLocation:    popup.vehicleLocation    || base.metadata?.vehicleLocation    || null,
        processingLocation: popup.processingLocation || base.metadata?.processingLocation || null,
        interiorColor:      popup.interiorColor      || base.metadata?.interiorColor      || null,
        bodyStyle:          popup.bodyStyle          || base.metadata?.bodyStyle          || null,
        frontLineReady:     popup.frontLineReady     || base.metadata?.frontLineReady     || null,
        titlePresent:       popup.titlePresent       || base.metadata?.titlePresent       || null,
        highValueOptions:   popup.highValueOptions?.length
                              ? popup.highValueOptions
                              : (base.metadata?.highValueOptions || []),
        equipment:          popup.equipment?.length
                              ? popup.equipment
                              : (base.metadata?.equipment || []),
        popupFieldMap:      fieldMap || {},
      },
    };
  }

  /**
   * Two-stage enrichment  v3:
   * 1. Open vehicle detail popup (multiple click targets, document-wide search)
   * 2. Wait for popup to appear and populate (retry loop, up to 5 s)
   * 3. Click the Details tab if not already active
   * 4. Verify popup belongs to this row (VIN > run-number > title)
   * 5. Extract all spec fields via parseVisiblePopupFields + mapPopupFieldsToData
   * 6. Close popup if we opened it
   * 7. Merge popup fields over base data
   *
   * Returns { vehicleData, popupData, popupFieldMap, extractionStatus }
   */
  async function extractWithPopup(rowEl, baseData) {
    const extractionStatus = {
      opened:            false,
      visiblePopupFound: false,
      detailsTabClicked: false,
      vinMatched:        false,
      runNumberMatched:  false,
      sourceUsed:        'row',
      warnings:          [],
    };

    if (_popupOperationActive) {
      extractionStatus.warnings.push('Popup operation already in progress — using row+panel data only.');
      return { vehicleData: baseData, popupData: null, popupFieldMap: {}, extractionStatus };
    }
    _popupOperationActive = true;

    try {
      // ── 1. Check for already-visible popup (document-wide) ────────────────
      let popup = findVisiblePopup();
      const popupWasAlreadyOpen = !!popup;

      if (!popupWasAlreadyOpen) {
        // Try multiple click targets in order of specificity
        const clickTargets = [
          rowEl.querySelector('a.vc-details'),
          rowEl.querySelector('.vc-details'),
          rowEl.querySelector('[data-cy-item-num]'),
          rowEl.querySelector('.item-info-row'),
          rowEl,
        ].filter(Boolean);

        for (const target of clickTargets) {
          target.click();
          await new Promise((r) => setTimeout(r, 200));
          popup = findVisiblePopup();
          if (popup) { extractionStatus.opened = true; break; }
        }
      }

      // ── 2. Wait up to 5 s for popup to appear ────────────────────────────
      if (!popup) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 150));
          popup = findVisiblePopup();
          if (popup) { extractionStatus.opened = true; break; }
        }
      }

      if (!popup) {
        extractionStatus.warnings.push('Popup did not appear — using row+panel data only.');
        return { vehicleData: baseData, popupData: null, popupFieldMap: {}, extractionStatus };
      }

      extractionStatus.visiblePopupFound = true;

      // ── 3. Click details tab if not already active ────────────────────────
      if (clickDetailsTab(popup)) {
        extractionStatus.detailsTabClicked = true;
        await new Promise((r) => setTimeout(r, 350));
      }

      // ── 4. Retry loop: wait for popup content + verify row match ──────────
      const rowVin       = (baseData.vin || '').trim().toUpperCase();
      const rowRunNumber = String(baseData.metadata?.runNumber || '');
      const rowTitle     = (baseData.titleFull || '').toLowerCase().trim();

      let fieldMap = {};
      let verified  = false;
      let lastVinSeen = '';
      const contentDeadline = Date.now() + 5000;

      while (Date.now() < contentDeadline) {
        // Re-acquire popup in case the DOM element changed
        if (!isElementVisible(popup)) {
          const fresh = findVisiblePopup();
          if (fresh) { popup = fresh; }
          else { await new Promise((r) => setTimeout(r, 200)); continue; }
        }

        fieldMap = parseVisiblePopupFields(popup);
        if (Object.keys(fieldMap).length === 0) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        // ── VIN check (most reliable) ────────────────────────────────────
        const popupVin = (fieldMap[normalizeLabel('VIN')] || '').trim().toUpperCase();
        lastVinSeen = popupVin;

        if (rowVin && popupVin) {
          if (popupVin === rowVin) {
            extractionStatus.vinMatched = true;
            verified = true;
            break;
          }
          // VIN mismatch — popup may be stale from previous vehicle; keep waiting
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        // ── Run-number check ─────────────────────────────────────────────
        if (rowRunNumber) {
          const popupText = popup.textContent || '';
          const runMatch  = popupText.match(/#(\d+)/);
          if (runMatch && runMatch[1] === rowRunNumber) {
            extractionStatus.runNumberMatched = true;
            verified = true;
            break;
          }
        }

        // ── Title year overlap check ──────────────────────────────────────
        if (rowTitle) {
          const yearM = rowTitle.match(/\d{4}/);
          if (yearM) {
            const titleEl = popup.querySelector(
              '.item-title, .vc-item-title, h3, h4, h5, [class*="item-title"]'
            );
            if (titleEl && titleEl.textContent.includes(yearM[0])) {
              verified = true;
              break;
            }
          }
        }

        // Cannot verify ownership — proceed with a warning
        extractionStatus.warnings.push('Cannot verify popup belongs to this row — proceeding with available data.');
        verified = true;
        break;
      }

      if (!verified) {
        const msg = (rowVin && lastVinSeen && lastVinSeen !== rowVin)
          ? `Popup VIN mismatch (expected ${rowVin}, got ${lastVinSeen}) — timed out, skipping enrichment.`
          : 'Popup content did not load in time — using row+panel data only.';
        extractionStatus.warnings.push(msg);
        console.warn('[AutoPluто]', msg);
        if (extractionStatus.opened && !popupWasAlreadyOpen) closePopupEl(popup);
        return { vehicleData: baseData, popupData: null, popupFieldMap: fieldMap, extractionStatus };
      }

      if (Object.keys(fieldMap).length === 0) {
        extractionStatus.warnings.push('Popup was visible but contained no parseable fields.');
        if (extractionStatus.opened && !popupWasAlreadyOpen) closePopupEl(popup);
        return { vehicleData: baseData, popupData: null, popupFieldMap: {}, extractionStatus };
      }

      // ── 5. Map fields to vehicle data ─────────────────────────────────────
      const popupData = mapPopupFieldsToData(fieldMap, popup);
      extractionStatus.sourceUsed = 'popup';

      // ── 6. Close popup if we triggered it ────────────────────────────────
      if (extractionStatus.opened && !popupWasAlreadyOpen) {
        closePopupEl(popup);
        await new Promise((r) => setTimeout(r, 150));
      }

      // ── 7. Merge popup over base data, store fieldMap in metadata ─────────
      const vehicleData = mergeWithPopup(baseData, popupData, fieldMap);

      // Derive cityAuction from vehicleLocation if still missing
      if (!vehicleData.cityAuction && popupData.vehicleLocation) {
        vehicleData.cityAuction = popupData.vehicleLocation
          .replace(/^OPENLANE\s*/i, '').trim();
      }

      return { vehicleData, popupData, popupFieldMap: fieldMap, extractionStatus };

    } finally {
      _popupOperationActive = false;
    }
  }

  function extractVehicleData(rowEl) {
    const runNumberEl  = rowEl.querySelector('.run-number');
    const runNumberRaw = runNumberEl ? runNumberEl.textContent.trim().replace(/^#/, '') : null;
    const runNumber    = runNumberRaw || rowEl.getAttribute('data-cy-item-num') || null;

    const detailsLink = rowEl.querySelector('.vc-details');
    let rawTitleText = null;
    if (detailsLink) {
      const titleDiv = detailsLink.querySelector('div:first-child');
      rawTitleText = titleDiv ? titleDiv.textContent.trim() : null;
    }
    const parsed = parseTitle(rawTitleText);

    let vin = null;
    const vinSpan = rowEl.querySelector('.item-vin');
    if (vinSpan && vinSpan.nextSibling) {
      vin = vinSpan.nextSibling.textContent.trim() || null;
    }
    if (!vin && detailsLink) {
      const vinDiv = detailsLink.querySelector('div:nth-child(2)');
      if (vinDiv) {
        const vinText = vinDiv.textContent.replace(/VIN\s*:\s*/i, '').trim();
        vin = vinText || null;
      }
    }

    const mileageRow = rowEl.querySelector('.mileage-row');
    let exteriorColor = null;
    let mileage = null;
    if (mileageRow) {
      const colorEl = mileageRow.querySelector('.block');
      exteriorColor = colorEl ? colorEl.textContent.trim() : null;
      let mileageText = mileageRow.textContent;
      if (colorEl) mileageText = mileageText.replace(colorEl.textContent, '');
      mileage = parseMileage(mileageText.trim());
    }

    const badgeRow   = rowEl.querySelector('.badge-row');
    const saleStatus = badgeRow ? badgeRow.textContent.trim().replace(/\s+/g, ' ') : null;

    const priceRow     = rowEl.querySelector('.price-row span');
    const displayedPrice = priceRow ? parsePrice(priceRow.textContent) : null;

    const laneColumn = rowEl.closest('.lane-column') || null;
    const laneCtx    = laneColumn ? extractLaneContext(laneColumn) : extractPageContext();
    const panelData  = extractRightPanelData(runNumber, laneColumn || document);

    let cityAuction = laneCtx.cityAuction;
    if (!cityAuction && panelData.vehicleLocation) {
      cityAuction = panelData.vehicleLocation.replace(/^OPENLANE\s*/i, '').trim();
    }

    return {
      year:          parsed.year  || null,
      make:          parsed.make  || null,
      model:         parsed.model || null,
      trim:          panelData.trimDetail || parsed.trim || null,
      titleFull:     parsed.titleFull || rawTitleText || null,
      mileage,
      vin:           panelData.vinDetail || vin,
      cityAuction,
      source:        laneCtx.source   || 'openlane',
      section:       laneCtx.section  || 'simulcast',
      exteriorColor: panelData.exteriorColorDetail || exteriorColor,
      sellerName:    panelData.sellerName  || null,
      engine:        panelData.engine      || null,
      fuelType:      panelData.fuelType    || null,
      drivetrain:    panelData.drivetrain  || null,
      transmission:  panelData.transmission || null,
      doors:         panelData.doors       || null,
      auctionRunTimeAt: null,
      metadata: {
        runNumber,
        saleStatus,
        currentAuctionPrice: panelData.currentAuctionPrice || displayedPrice,
        displayedPrice,
        auctionName:     laneCtx.auctionName || null,
        lane:            laneCtx.lane        || null,
        lights:          panelData.lights    || {},
        minPrice:        panelData.minPrice  || null,
        vehicleLocation: panelData.vehicleLocation || null,
        pageUrl:         laneCtx.pageUrl || window.location.href,
        extractionSource: 'chrome-extension',
      },
    };
  }

  function getMissingFields(payload) {
    const required = ['year', 'make', 'model', 'mileage', 'vin', 'cityAuction'];
    return required.filter((f) => !payload[f]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API CLIENT
  // ═══════════════════════════════════════════════════════════════════════════

  async function predict(payload) {
    const settings = await getSettings();
    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}${settings.apiEndpoint}`;

    // Build VehicleInput with only schema-accepted fields; exclude metadata / UI context
    const vehicle = {
      year:             payload.year            != null ? payload.year   : null,
      make:             payload.make            || null,
      model:            payload.model           || null,
      trim:             payload.trim            || null,
      mileage:          payload.mileage         != null ? payload.mileage : null,
      fuelType:         payload.fuelType        || null,
      drivetrain:       payload.drivetrain      || null,
      transmission:     payload.transmission    || null,
      engine:           payload.engine          || null,
      exteriorColor:    payload.exteriorColor   || null,
      doors:            payload.doors           != null ? payload.doors  : null,
      titleFull:        payload.titleFull       || null,
      cityAuction:      payload.cityAuction     || null,
      auctionRunTimeAt: payload.auctionRunTimeAt || null,
      source:           settings.defaultSource  || payload.source  || null,
      section:          settings.defaultSection || payload.section || null,
      sellerName:       payload.sellerName      || null,
      vin:              payload.vin             || null,
    };

    // API expects { "vehicle": { ... } }  (PredictRequest wrapper)
    const requestBody = { vehicle };

    if (settings.debugMode) {
      console.group('[AutoPluто] API Request');
      console.log('URL:', url);
      console.log('Payload:', JSON.stringify(requestBody, null, 2));
      console.groupEnd();
    }

    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers['X-API-Key'] = settings.apiKey;

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), settings.requestTimeout);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw Object.assign(new Error('Request timed out'), { type: 'timeout' });
      }
      throw Object.assign(err, { type: 'network' });
    }
    clearTimeout(timeoutId);

    let data;
    try {
      data = await response.json();
    } catch {
      throw Object.assign(
        new Error(`Non-JSON response (HTTP ${response.status})`),
        { type: 'parse', status: response.status }
      );
    }

    if (!response.ok) {
      let msg = data?.message || data?.error || `HTTP ${response.status}`;
      if (response.status === 422 && Array.isArray(data?.detail)) {
        msg = data.detail.map((e) => {
          const loc = (e.loc || []).slice(1).join(' → ');
          return loc ? `${loc}: ${e.msg}` : e.msg;
        }).join('; ');
      }
      throw Object.assign(new Error(msg), { type: 'api', status: response.status, data });
    }

    if (settings.debugMode) {
      console.group('[AutoPluто] API Response');
      console.log('Status:', response.status);
      console.log('Data:', JSON.stringify(data, null, 2));
      console.groupEnd();
    }

    return normaliseResponse(data);
  }

  function normaliseResponse(raw) {
    // reason is string[] | null in the API; join for display
    const reasonRaw = raw.reason ?? null;
    const reason = Array.isArray(reasonRaw) ? reasonRaw.join(' · ') : (reasonRaw || null);

    return {
      model_version:          raw.model_version                    ?? null,
      calibration_version:    raw.calibration_version              ?? null,
      estimated_market_price: raw.estimated_market_price           ?? raw.adjusted_price ?? null,
      recommended_max_bid:    raw.recommended_max_bid              ?? null,
      confidence_level:       raw.confidence_level                 ?? raw.confidence    ?? null,
      bid_safety_level:       raw.bid_safety_level                 ?? null,
      calibration_buffer:     raw.calibration_buffer               ?? null,
      reason,
      comparable_count:       raw.comparables_found                ?? null,
      market_fallback_level:  raw.market_match_level               ?? null,
      _raw: raw,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POPOVER STATE  (single fixed-position portal on document.body)
  // ═══════════════════════════════════════════════════════════════════════════

  let _activePopover    = null;
  let _activePopoverRow = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // UI HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function fmt(num) {
    if (num == null) return 'N/A';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(num);
  }

  function fmtNum(num) {
    if (num == null) return 'N/A';
    return new Intl.NumberFormat('en-CA').format(num) + ' KM';
  }

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function injectGeistFont() {
    const id = 'autopluto-geist-font';
    if (document.getElementById(id)) return;
    try {
      const link = document.createElement('link');
      link.id   = id;
      link.rel  = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&display=swap';
      (document.head || document.documentElement).appendChild(link);
    } catch (_e) { /* font injection blocked by page CSP — fallback font stack is used */ }
  }

  function getBadgeInfo(margin, hasCurrentPrice) {
    if (!hasCurrentPrice) return { color: 'gray', label: 'No current price', cls: 'autopluto-badge-gray' };
    if (margin > 1000)    return { color: 'green',  label: 'Below max bid',   cls: 'autopluto-badge-green' };
    if (margin >= 0)      return { color: 'yellow', label: 'Close to max bid',cls: 'autopluto-badge-yellow' };
    return                       { color: 'red',    label: 'Above max bid',   cls: 'autopluto-badge-red' };
  }

  // ── Portal tab infrastructure ──────────────────────────────────────────────
  // Tabs are rendered on document.body (fixed position) so they appear OUTSIDE
  // the table/list container and are never clipped by table overflow.

  let _tabPortal = null;
  const _portalTabs = new Map(); // rowEl → tabEl

  function getTabPortal() {
    if (!_tabPortal || !document.contains(_tabPortal)) {
      _tabPortal = document.createElement('div');
      _tabPortal.id = 'autopluto-tab-portal';
      document.body.appendChild(_tabPortal);
    }
    return _tabPortal;
  }

  function syncTabPosition(rowEl, tab) {
    const rect = rowEl.getBoundingClientRect();
    if (rect.height === 0) return;
    tab.style.top    = `${rect.top}px`;
    tab.style.left   = `${rect.right}px`;
    tab.style.height = `${rect.height}px`;
    // Hide tabs that have scrolled completely out of the viewport
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    tab.style.visibility = inView ? '' : 'hidden';
  }

  function syncAllTabPositions() {
    for (const [rowEl, tab] of _portalTabs) {
      if (!document.contains(rowEl)) {
        tab.remove();
        _portalTabs.delete(rowEl);
      } else {
        syncTabPosition(rowEl, tab);
      }
    }
  }

  function injectEstimateTab(rowEl, onClickCallback) {
    if (rowEl.getAttribute('data-autopluto-estimate-injected') === 'true') return;
    rowEl.setAttribute('data-autopluto-estimate-injected', 'true');

    const tab = document.createElement('div');
    tab.className = 'autopluto-estimate-tab';
    tab.setAttribute('data-autopluto-btn', 'true');
    tab.title = 'Estimate price';
    tab.innerHTML = `
      <div class="autopluto-estimate-handle">
        <span class="autopluto-estimate-dollar">$</span>
      </div>
      <div class="autopluto-estimate-label">Estimate</div>
    `;

    tab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClickCallback(rowEl, tab);
    });

    // Mirror row hover onto the tab so opacity and state transitions work
    rowEl.addEventListener('mouseenter', () => tab.classList.add('autopluto-tab-row-hover'));
    rowEl.addEventListener('mouseleave', () => {
      if (!tab.matches(':hover')) tab.classList.remove('autopluto-tab-row-hover');
    });
    tab.addEventListener('mouseleave', () => {
      if (!rowEl.matches(':hover')) tab.classList.remove('autopluto-tab-row-hover');
    });

    syncTabPosition(rowEl, tab);
    getTabPortal().appendChild(tab);
    _portalTabs.set(rowEl, tab);
  }

  function setTabLoading(tab) {
    tab.classList.add('autopluto-tab-loading');
    tab.classList.remove('autopluto-tab-done', 'autopluto-tab-error');
  }

  function setTabReady(tab) {
    tab.classList.remove('autopluto-tab-loading');
    tab.classList.add('autopluto-tab-done');
  }

  function setTabError(tab) {
    tab.classList.remove('autopluto-tab-loading');
    tab.classList.add('autopluto-tab-error');
  }

  function closeActivePopover() {
    if (_activePopover) {
      _activePopover.remove();
      _activePopover    = null;
      _activePopoverRow = null;
    }
  }

  function removeExistingCard() {
    closeActivePopover();
  }

  function positionPopover(popover, rowEl) {
    const POPOVER_W  = 500;
    const TAB_W      = 26; // handle width — must stay fully visible
    const rect       = rowEl.getBoundingClientRect();

    let left = rect.right + TAB_W + 10; // clear the blue $ handle entirely
    if (left + POPOVER_W > window.innerWidth - 16) {
      left = window.innerWidth - POPOVER_W - 16;
    }
    left = Math.max(16, left);

    const popoverH = popover.offsetHeight || 420;
    let top = rect.top;
    if (top + popoverH > window.innerHeight - 16) {
      top = window.innerHeight - popoverH - 16;
    }
    top = Math.max(16, top);

    popover.style.left = `${left}px`;
    popover.style.top  = `${top}px`;
  }

  // ── UI builder helpers ──────────────────────────────────────

  function buildDecisionBanner(margin, hasCurrentPrice) {
    if (!hasCurrentPrice || margin === null) {
      return `<div class="autopluto-decision-banner autopluto-decision-banner--neutral">
        <div class="autopluto-decision-left">
          <div class="autopluto-decision-pill autopluto-decision-pill--neutral">No Current Bid</div>
          <div class="autopluto-decision-sub">Cannot calculate margin — no active bid price</div>
        </div>
        <div class="autopluto-decision-right">
          <div class="autopluto-decision-amount autopluto-decision-amount--neutral">—</div>
          <div class="autopluto-decision-amount-label">bid margin</div>
        </div>
      </div>`;
    }
    if (margin > 1000) {
      return `<div class="autopluto-decision-banner autopluto-decision-banner--good">
        <div class="autopluto-decision-left">
          <div class="autopluto-decision-pill autopluto-decision-pill--good">Good Room to Bid</div>
          <div class="autopluto-decision-sub">Current bid is comfortably below your limit</div>
        </div>
        <div class="autopluto-decision-right">
          <div class="autopluto-decision-amount autopluto-decision-amount--good">${fmt(margin)}</div>
          <div class="autopluto-decision-amount-label">below max bid</div>
        </div>
      </div>`;
    }
    if (margin >= 0) {
      return `<div class="autopluto-decision-banner autopluto-decision-banner--caution">
        <div class="autopluto-decision-left">
          <div class="autopluto-decision-pill autopluto-decision-pill--caution">Close to Limit</div>
          <div class="autopluto-decision-sub">Approaching your recommended maximum bid</div>
        </div>
        <div class="autopluto-decision-right">
          <div class="autopluto-decision-amount autopluto-decision-amount--caution">${fmt(margin)}</div>
          <div class="autopluto-decision-amount-label">below max bid</div>
        </div>
      </div>`;
    }
    return `<div class="autopluto-decision-banner autopluto-decision-banner--danger">
      <div class="autopluto-decision-left">
        <div class="autopluto-decision-pill autopluto-decision-pill--danger">Above Recommended Max</div>
        <div class="autopluto-decision-sub">Current bid exceeds your limit — consider walking away</div>
      </div>
      <div class="autopluto-decision-right">
        <div class="autopluto-decision-amount autopluto-decision-amount--danger">${fmt(Math.abs(margin))}</div>
        <div class="autopluto-decision-amount-label">over max bid</div>
      </div>
    </div>`;
  }

  function buildBadgeItem(label, value, color) {
    return `<div class="autopluto-badge-item autopluto-badge-item--${esc(color)}">
      <span class="autopluto-badge-item-label">${esc(label)}</span>
      <span class="autopluto-badge-item-value">${esc(String(value))}</span>
    </div>`;
  }

  function getConfidenceColor(level) {
    if (!level) return 'gray';
    const l = level.toLowerCase();
    if (l.includes('high'))   return 'green';
    if (l.includes('low'))    return 'red';
    return 'yellow';
  }

  function getSafetyColor(level) {
    if (!level) return 'gray';
    const l = level.toLowerCase();
    if ((l.includes('safe') || l === 'low risk') && !l.includes('very') && !l.includes('un')) return 'green';
    if (l.includes('moderate') || l.includes('medium') || l === 'medium risk') return 'yellow';
    if (l.includes('risky') || l.includes('danger') || l.includes('high risk') || l.includes('very')) return 'red';
    return 'yellow';
  }

  function getFallbackColor(level) {
    if (!level) return 'gray';
    const l = level.toLowerCase();
    if (l === 'exact' || l === 'local')    return 'green';
    if (l === 'regional')                  return 'yellow';
    if (l === 'global' || l === 'unknown') return 'yellow';
    return 'gray';
  }

  function buildDataQuality(vehicleData) {
    const meta = vehicleData.metadata || {};
    const fields = [
      { label: 'VIN',        val: vehicleData.vin },
      { label: 'Mileage',    val: vehicleData.mileage },
      { label: 'City',       val: vehicleData.cityAuction },
      { label: 'Trim',       val: vehicleData.trim },
      { label: 'Seller',     val: vehicleData.sellerName },
      { label: 'Color',      val: vehicleData.exteriorColor },
      { label: 'Drivetrain', val: vehicleData.drivetrain },
      { label: 'Fuel',       val: vehicleData.fuelType },
      { label: 'Engine',     val: vehicleData.engine },
      { label: 'Trans.',     val: vehicleData.transmission },
      { label: 'Doors',      val: vehicleData.doors },
      { label: 'Interior',   val: meta.interiorColor },
      { label: 'Location',   val: meta.vehicleLocation },
      { label: 'Processing', val: meta.processingLocation },
      { label: 'FrontLine',  val: meta.frontLineReady },
      { label: 'Title',      val: meta.titlePresent },
    ];

    const fieldHtml = fields.map((f) => {
      const ok = f.val != null && f.val !== '';
      return `<div class="autopluto-data-field autopluto-data-field--${ok ? 'ok' : 'miss'}">
        <span class="autopluto-data-field-dot"></span>
        <span>${esc(f.label)}</span>
      </div>`;
    }).join('');

    const missing = fields.filter((f) => !f.val).map((f) => f.label);
    const missingNote = missing.length
      ? `<div class="autopluto-data-missing-note">Missing: ${esc(missing.join(', '))}</div>`
      : '';

    return `<div class="autopluto-data-quality-grid">${fieldHtml}</div>${missingNote}`;
  }

  function normalizeReasonList(result) {
    const raw = result._raw || {};
    const reasonArr = Array.isArray(raw.reason)
      ? raw.reason
      : (raw.reason ? raw.reason.split(' · ') : []);

    const notes = [];
    if (result.comparable_count != null) {
      notes.push(`${result.comparable_count} comparable vehicle${result.comparable_count !== 1 ? 's' : ''} found`);
    }
    if (result.market_fallback_level) notes.push(`Market fallback: ${result.market_fallback_level}`);
    if (result.calibration_version) {
      notes.push(`Calibration applied: ${result.calibration_version}`);
    } else {
      notes.push('Calibration artifact not available');
    }

    const skip = ['comparable', 'fallback', 'calibration', 'carfax', 'condition', 'no carfax'];
    reasonArr
      .map((s) => s.trim())
      .filter((s) => s && !skip.some((k) => s.toLowerCase().includes(k)))
      .forEach((s) => notes.push(s));

    notes.push('No CARFAX / condition data included');
    return notes;
  }

  function normalizeWarningList(result) {
    const raw = result._raw || {};
    const apiWarnings = Array.isArray(raw.warnings) ? raw.warnings : [];
    return apiWarnings.map((w) =>
      typeof w === 'string' ? w
        : (w && typeof w === 'object' ? (w.message || w.msg || w.text || JSON.stringify(w)) : String(w))
    );
  }

  function buildCollapsibleBlock(title, innerHtml, tone) {
    if (!innerHtml) return '';
    const toneClass = tone === 'warning' ? ' autopluto-details--warning' : '';
    return `<details class="autopluto-details${toneClass}">
      <summary class="autopluto-details-summary">
        <span class="autopluto-details-title">${esc(title)}</span>
        <span class="autopluto-details-arrow">▶</span>
      </summary>
      <div class="autopluto-details-body">${innerHtml}</div>
    </details>`;
  }

  function buildCollapsibleSection(title, items, tone) {
    if (!items || items.length === 0) return '';
    const listClass = tone === 'muted' ? ' autopluto-details-list--muted' : '';
    const itemsHtml = `<ul class="autopluto-details-list${listClass}">
      ${items.map((item) => `<li>${esc(typeof item === 'string' ? item : JSON.stringify(item))}</li>`).join('')}
    </ul>`;
    return buildCollapsibleBlock(`${title} (${items.length})`, itemsHtml, tone);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODULAR UI BUILDER FUNCTIONS  (premium redesign v8)
  // ══════════════════════════════════════════════════════════════════════════

  /** Compact price label: $32.5k */
  function fmtShort(num) {
    if (num == null) return 'N/A';
    if (Math.abs(num) >= 1000) return '$' + (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(num);
  }

  /** Map confidence level string → percentage for meter */
  function getConfidencePercent(level) {
    if (!level) return 0;
    const l = level.toLowerCase();
    if (l.includes('very_high') || l.includes('very high')) return 95;
    if (l.includes('high'))   return 82;
    if (l.includes('medium') || l.includes('moderate')) return 54;
    if (l.includes('low'))    return 22;
    return 40;
  }

  /** Scan raw API response for a comparable-vehicle list */
  function parseComparables(raw) {
    const candidates = [
      raw.comparable_vehicles, raw.comparables, raw.comparable_list,
      raw.comp_vehicles, raw.similar_vehicles, raw.market_comparables,
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c;
    }
    return null;
  }

  // ── A. Header ────────────────────────────────────────────────
  function buildHeaderSection(vehicleData, result) {
    const modelBadge = result.model_version
      ? `<span class="autopluto-badge-model">${esc(result.model_version)}</span>` : '';

    const metaTags = [];
    if (vehicleData.vin) {
      metaTags.push(`<span class="autopluto-meta-tag autopluto-meta-tag--mono">◈ ${esc(vehicleData.vin)}</span>`);
    } else {
      metaTags.push(`<span class="autopluto-meta-tag autopluto-meta-tag--warn">◈ VIN not detected</span>`);
    }
    if (vehicleData.mileage) {
      metaTags.push(`<span class="autopluto-meta-tag">◎ ${fmtNum(vehicleData.mileage)}</span>`);
    }
    if (vehicleData.cityAuction) {
      metaTags.push(`<span class="autopluto-meta-tag">📍 ${esc(vehicleData.cityAuction)}</span>`);
    }
    if (vehicleData.trim) {
      metaTags.push(`<span class="autopluto-meta-tag">✦ ${esc(vehicleData.trim)}</span>`);
    }

    return `
      <div class="autopluto-card-header">
        <div class="autopluto-header-top">
          <div class="autopluto-header-title-group">
            <div class="autopluto-card-title">${esc(vehicleData.titleFull || 'Vehicle')}</div>
            <div class="autopluto-header-badges">
              <span class="autopluto-badge-ai">Estimate Report</span>
              ${modelBadge}
            </div>
          </div>
          <button class="autopluto-card-close" title="Close">✕</button>
        </div>
        <div class="autopluto-header-meta">${metaTags.join('')}</div>
      </div>`;
  }

  // ── B. Primary Intelligence Section ─────────────────────────
  // EMP is the HERO. Confidence (with explicit label) tightly coupled.
  // Quality appears below Confidence within the EMP hero card.
  // RMB and Current Bid are secondary (right column).
  function buildPrimaryIntelligenceSection(emp, rmb, currentPrice, hasCurrentPrice, confidence, confColor, confPct, compQuality) {
    // Confidence row with explicit "Confidence" label
    const confRowHtml = confidence
      ? `<div class="autopluto-emp-conf-row">
           <span class="autopluto-emp-conf-key">Confidence</span>
           <div class="autopluto-emp-conf-meter">
             <div class="autopluto-emp-conf-fill autopluto-emp-conf-fill--${esc(confColor)}" style="width:${confPct}%"></div>
           </div>
           <span class="autopluto-emp-conf-badge autopluto-emp-conf-badge--${esc(confColor)}">${esc(confidence.replace(/_/g, ' '))}</span>
         </div>`
      : `<div class="autopluto-emp-conf-row">
           <span class="autopluto-emp-conf-key">Confidence</span>
           <span class="autopluto-emp-conf-badge autopluto-emp-conf-badge--gray">N/A</span>
         </div>`;

    // Quality row — visually secondary, below Confidence
    let qualityRowHtml = '';
    if (compQuality) {
      const qc     = compQuality.toLowerCase();
      const qColor = (qc === 'good' || qc === 'high') ? 'green'
        : (qc === 'unreliable' || qc === 'low')       ? 'red'
        : 'yellow';
      qualityRowHtml = `
        <div class="autopluto-emp-quality-row">
          <span class="autopluto-emp-conf-key autopluto-emp-conf-key--dim">Quality</span>
          <span class="autopluto-emp-quality-badge autopluto-emp-quality-badge--${esc(qColor)}">${esc(compQuality.replace(/_/g, ' '))}</span>
        </div>`;
    }

    return `
      <div class="autopluto-primary-intel">
        <div class="autopluto-emp-hero">
          <div class="autopluto-emp-hero-label">Estimated Market Price</div>
          <div class="autopluto-emp-hero-value">${fmt(emp)}</div>
          <div class="autopluto-emp-conf">
            ${confRowHtml}
            ${qualityRowHtml}
          </div>
        </div>
        <div class="autopluto-right-stack">
          <div class="autopluto-rmb-mini">
            <div class="autopluto-rmb-mini-label">Rec. Max Bid</div>
            <div class="autopluto-rmb-mini-value">${fmt(rmb)}</div>
            <div class="autopluto-rmb-mini-sub">Your ceiling</div>
          </div>
          <div class="autopluto-bid-mini">
            <div class="autopluto-bid-mini-label">Current Bid</div>
            <div class="autopluto-bid-mini-value${!hasCurrentPrice ? ' autopluto-bid-mini-value--none' : ''}">${hasCurrentPrice ? fmt(currentPrice) : '—'}</div>
          </div>
        </div>
      </div>`;
  }

  // ── C. Decision Insight Bar (compact secondary status) ───────
  function buildDecisionInsight(margin, canCalculate, currentPrice, emp) {
    if (!canCalculate || margin === null) {
      return `<div class="autopluto-insight-bar autopluto-insight-bar--neutral">
        <span class="autopluto-insight-dot"></span>
        <div class="autopluto-insight-content">
          <span class="autopluto-insight-label">No active bid</span>
          <span class="autopluto-insight-meta">Cannot calculate margin — awaiting auction price</span>
        </div>
      </div>`;
    }
    if (margin > 1000) {
      return `<div class="autopluto-insight-bar autopluto-insight-bar--good">
        <span class="autopluto-insight-dot"></span>
        <div class="autopluto-insight-content">
          <span class="autopluto-insight-label">Good room to bid</span>
          <span class="autopluto-insight-meta"><strong>${fmt(margin)}</strong> below max bid</span>
        </div>
      </div>`;
    }
    if (margin >= 0) {
      return `<div class="autopluto-insight-bar autopluto-insight-bar--caution">
        <span class="autopluto-insight-dot"></span>
        <div class="autopluto-insight-content">
          <span class="autopluto-insight-label">Approaching limit</span>
          <span class="autopluto-insight-meta"><strong>${fmt(margin)}</strong> below max bid</span>
        </div>
      </div>`;
    }
    return `<div class="autopluto-insight-bar autopluto-insight-bar--danger">
      <span class="autopluto-insight-dot"></span>
      <div class="autopluto-insight-content">
        <span class="autopluto-insight-label">Above Recommended Max — consider walking away</span>
        <span class="autopluto-insight-meta"><strong>${fmt(Math.abs(margin))}</strong> over max bid</span>
      </div>
    </div>`;
  }

  // ── D. Expected Market Range ──────────────────────────────────
  function buildRangeVisualization(rangeLow, rangeHigh, emp, rmb, currentPrice) {
    if (rangeLow == null && rangeHigh == null) return '';

    const spread = (rangeLow != null && rangeHigh != null) ? rangeHigh - rangeLow : null;

    const toPct = (v) => {
      if (v == null || rangeLow == null || rangeHigh == null || rangeHigh <= rangeLow) return null;
      return Math.min(96, Math.max(4, ((v - rangeLow) / (rangeHigh - rangeLow)) * 100));
    };

    const empPct = toPct(emp);
    const rmbPct = toPct(rmb);
    const bidPct = toPct(currentPrice);

    const empMarkerHtml = empPct != null
      ? `<div class="autopluto-range-emp-marker" style="left:${empPct.toFixed(1)}%">
           <div class="autopluto-range-emp-dot"></div>
           <div class="autopluto-range-emp-label">EMP</div>
         </div>`
      : '';

    const rmbMarkerHtml = rmbPct != null
      ? `<div class="autopluto-range-rmb-marker" style="left:${rmbPct.toFixed(1)}%">
           <div class="autopluto-range-rmb-dot"></div>
           <div class="autopluto-range-rmb-label">MAX</div>
         </div>`
      : '';

    const bidMarkerHtml = bidPct != null
      ? `<div class="autopluto-range-bid-marker" style="left:${bidPct.toFixed(1)}%">
           <div class="autopluto-range-bid-dot"></div>
           <div class="autopluto-range-bid-label">BID</div>
         </div>`
      : '';

    const spreadPill = spread != null
      ? `<span class="autopluto-range-spread-pill">${fmt(spread)} spread</span>`
      : '';

    // Legend below track — only show items with actual values
    const legendItems = [];
    if (emp != null) {
      legendItems.push(`<div class="autopluto-range-legend-item">
        <div class="autopluto-range-legend-dot autopluto-range-legend-dot--emp"></div>
        <div class="autopluto-range-legend-info">
          <span class="autopluto-range-legend-lbl">Est. Market Price</span>
          <span class="autopluto-range-legend-val autopluto-range-legend-val--emp">${fmt(emp)}</span>
        </div>
      </div>`);
    }
    if (rmb != null) {
      legendItems.push(`<div class="autopluto-range-legend-item">
        <div class="autopluto-range-legend-dot autopluto-range-legend-dot--rmb"></div>
        <div class="autopluto-range-legend-info">
          <span class="autopluto-range-legend-lbl">Rec. Max Bid</span>
          <span class="autopluto-range-legend-val autopluto-range-legend-val--rmb">${fmt(rmb)}</span>
        </div>
      </div>`);
    }
    if (currentPrice != null) {
      legendItems.push(`<div class="autopluto-range-legend-item">
        <div class="autopluto-range-legend-dot autopluto-range-legend-dot--current"></div>
        <div class="autopluto-range-legend-info">
          <span class="autopluto-range-legend-lbl">Current Bid</span>
          <span class="autopluto-range-legend-val autopluto-range-legend-val--current">${fmt(currentPrice)}</span>
        </div>
      </div>`);
    }
    const legendHtml = legendItems.length > 0
      ? `<div class="autopluto-range-legend${legendItems.length < 3 ? ' autopluto-range-legend--compact' : ''}">${legendItems.join('')}</div>`
      : '';

    return `
      <div class="autopluto-range-card">
        <div class="autopluto-range-card-header">
          <span class="autopluto-range-card-title">Expected Market Range</span>
          ${spreadPill}
        </div>
        <div class="autopluto-range-endpoints">
          <div class="autopluto-range-endpoint autopluto-range-endpoint--low">
            <div class="autopluto-range-endpoint-lbl">Low</div>
            <div class="autopluto-range-endpoint-val">${rangeLow != null ? fmt(rangeLow) : '—'}</div>
          </div>
          <div class="autopluto-range-endpoint autopluto-range-endpoint--high">
            <div class="autopluto-range-endpoint-lbl">High</div>
            <div class="autopluto-range-endpoint-val">${rangeHigh != null ? fmt(rangeHigh) : '—'}</div>
          </div>
        </div>
        <div class="autopluto-range-track-wrap">
          <div class="autopluto-range-track-v2">
            <div class="autopluto-range-track-fill-v2"></div>
            <div class="autopluto-range-track-low-cap"></div>
            <div class="autopluto-range-track-high-cap"></div>
            ${rmbMarkerHtml}
            ${empMarkerHtml}
            ${bidMarkerHtml}
          </div>
        </div>
        ${legendHtml}
      </div>`;
  }

  // ── E2. Comparable Vehicles Table ────────────────────────────
  function buildComparableTable(comps, emp) {
    if (!comps || comps.length === 0) return '';

    const rows = comps.map((c, i) => {
      const price    = c.price ?? c.sale_price ?? c.listing_price ?? c.market_price ?? null;
      const mileage  = c.mileage ?? c.km ?? c.odometer ?? null;
      const location = c.city || c.cityAuction || c.location || c.auction_location || '';
      const score    = c.similarity_score ?? c.score ?? null;
      const vehicle  = [c.year, c.make, c.model, c.trim].filter(Boolean).join(' ') || `#${i + 1}`;
      const vShort   = vehicle.length > 22 ? vehicle.slice(0, 22) + '\u2026' : vehicle;
      const locShort = location.length > 14 ? location.slice(0, 14) + '\u2026' : location;

      let diffHtml = `<span class="autopluto-comp-na">\u2014</span>`;
      if (price != null && emp != null) {
        const diff = price - emp;
        const pct  = ((diff / emp) * 100).toFixed(1);
        const sign = diff >= 0 ? '+' : '';
        const cls  = diff < 0 ? 'neg' : 'pos';
        diffHtml   = `<span class="autopluto-comp-diff autopluto-comp-diff--${cls}">${sign}${pct}%</span>`;
      }

      const scoreHtml = score != null
        ? `<span class="autopluto-comp-score">${typeof score.toFixed === 'function' ? score.toFixed(2) : score}</span>`
        : `<span class="autopluto-comp-na">\u2014</span>`;

      return `<tr class="autopluto-comp-row">
        <td class="autopluto-comp-td autopluto-comp-td--vehicle" title="${esc(vehicle)}">${esc(vShort)}</td>
        <td class="autopluto-comp-td autopluto-comp-td--price">${price != null ? esc(fmt(price)) : `<span class="autopluto-comp-na">\u2014</span>`}</td>
        <td class="autopluto-comp-td autopluto-comp-td--mileage">${mileage != null ? esc(fmtNum(mileage)) : `<span class="autopluto-comp-na">\u2014</span>`}</td>
        <td class="autopluto-comp-td autopluto-comp-td--diff">${diffHtml}</td>
        <td class="autopluto-comp-td autopluto-comp-td--location" title="${esc(location)}">${location ? esc(locShort) : `<span class="autopluto-comp-na">\u2014</span>`}</td>
        <td class="autopluto-comp-td autopluto-comp-td--score">${scoreHtml}</td>
      </tr>`;
    }).join('');

    return `
      <div class="autopluto-comp-table-wrap">
        <table class="autopluto-comp-table">
          <thead>
            <tr>
              <th class="autopluto-comp-th">Vehicle</th>
              <th class="autopluto-comp-th">Price</th>
              <th class="autopluto-comp-th">Mileage</th>
              <th class="autopluto-comp-th">Vs Est.</th>
              <th class="autopluto-comp-th">Location</th>
              <th class="autopluto-comp-th">Score</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── E. Comparable Vehicles Chart (SVG scatter plot) ──────────
  function buildComparablesChart(raw, emp, rmb) {
    const comps     = parseComparables(raw);
    const compCount = raw.comparables_found ?? (comps ? comps.length : null);

    const headerHtml = `
      <div class="autopluto-comps-header">
        <div class="autopluto-comps-title">Comparable Vehicles</div>
        ${compCount != null ? `<span class="autopluto-comps-count-badge">${compCount} used</span>` : ''}
      </div>`;

    if (!comps || comps.length === 0) {
      const emptyMsg = (compCount != null && compCount > 0)
        ? `${compCount} comparable${compCount !== 1 ? 's' : ''} contributed to estimate — detailed vehicle data not in response.`
        : 'No comparable vehicle data available for visualization.';
      return `
        <div class="autopluto-comps-card">
          ${headerHtml}
          <div class="autopluto-comps-empty">
            <span class="autopluto-comps-empty-icon">◎</span>
            <span class="autopluto-comps-empty-text">${esc(emptyMsg)}</span>
          </div>
        </div>`;
    }

    const prices = comps.map((c) =>
      c.price ?? c.sale_price ?? c.listing_price ?? c.market_price ?? c.value ?? null
    );
    const validPrices = prices.filter((p) => p != null);

    if (validPrices.length === 0) {
      return `
        <div class="autopluto-comps-card">
          ${headerHtml}
          <div class="autopluto-comps-empty">
            <span class="autopluto-comps-empty-icon">◎</span>
            <span class="autopluto-comps-empty-text">Comparable vehicles found — no price data available in response.</span>
          </div>
        </div>`;
    }

    // SVG chart geometry — taller, wider margins for readability
    const VW = 460, VH = 188;
    const ML = 62, MR = 20, MT = 18, MB = 34;
    const pw = VW - ML - MR;
    const ph = VH - MT - MB;

    const mileages  = comps.map((c) => c.mileage ?? c.km ?? c.odometer ?? c.miles ?? null);
    const hasMileage = mileages.some((m) => m != null && m > 0);

    const xVals = comps.map((c, i) => {
      if (hasMileage) return c.mileage ?? c.km ?? c.odometer ?? c.miles ?? i;
      return i;
    });

    const validX = xVals.filter((v) => v != null);
    const xMin   = hasMileage ? Math.min(...validX) : 0;
    const xMax   = hasMileage ? Math.max(...validX) : Math.max(comps.length - 1, 1);

    const allPY  = [...validPrices];
    if (emp != null) allPY.push(emp);
    const rawYMin = Math.min(...allPY);
    const rawYMax = Math.max(...allPY);
    const yPad    = (rawYMax - rawYMin) * 0.12 || rawYMax * 0.08;
    const yMin    = Math.max(0, rawYMin - yPad);
    const yMax    = rawYMax + yPad;

    const toX = (v) => {
      if (v == null) return null;
      const r = xMax - xMin;
      return ML + (r === 0 ? pw / 2 : ((v - xMin) / r) * pw);
    };
    const toY = (v) => {
      if (v == null) return null;
      const r = yMax - yMin;
      return MT + ph - (r === 0 ? ph / 2 : ((v - yMin) / r) * ph);
    };

    const parts = [];

    // Horizontal grid + y-axis price labels — brighter for readability
    for (let i = 0; i <= 4; i++) {
      const y     = MT + (ph / 4) * i;
      const price = yMax - (yMax - yMin) * (i / 4);
      parts.push(`<line x1="${ML}" y1="${y.toFixed(1)}" x2="${VW - MR}" y2="${y.toFixed(1)}" stroke="#243a56" stroke-width="0.8"/>`);
      parts.push(`<text x="${(ML - 6).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" fill="#93a8c4" font-size="10" text-anchor="end" font-family="Geist Sans,Inter,sans-serif">${esc(fmtShort(Math.round(price)))}</text>`);
    }

    // EMP reference dashed line — more prominent
    if (emp != null) {
      const ey = toY(emp);
      if (ey != null) {
        parts.push(`<line x1="${ML}" y1="${ey.toFixed(1)}" x2="${VW - MR}" y2="${ey.toFixed(1)}" stroke="#3b82f6" stroke-width="2.5" stroke-dasharray="5,3" opacity="0.95"/>`);
        parts.push(`<text x="${(VW - MR + 4).toFixed(1)}" y="${(ey + 3.5).toFixed(1)}" fill="#60a5fa" font-size="10" font-weight="700" font-family="Geist Sans,Inter,sans-serif">EMP</text>`);
      }
    }

    // RMB reference dashed line — green
    if (rmb != null) {
      const ry = toY(rmb);
      if (ry != null) {
        parts.push(`<line x1="${ML}" y1="${ry.toFixed(1)}" x2="${VW - MR}" y2="${ry.toFixed(1)}" stroke="#10b981" stroke-width="1.8" stroke-dasharray="4,4" opacity="0.8"/>`);
        parts.push(`<text x="${(VW - MR + 4).toFixed(1)}" y="${(ry + 3.5).toFixed(1)}" fill="#34d399" font-size="10" font-weight="700" font-family="Geist Sans,Inter,sans-serif">MAX</text>`);
      }
    }

    // Axes — more visible
    parts.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${(MT + ph).toFixed(1)}" stroke="#3d5a82" stroke-width="1.5"/>`);
    parts.push(`<line x1="${ML}" y1="${(MT + ph).toFixed(1)}" x2="${VW - MR}" y2="${(MT + ph).toFixed(1)}" stroke="#3d5a82" stroke-width="1.5"/>`);

    // X-axis label — brighter
    const xLabel = hasMileage ? 'Mileage (KM)' : 'Comparable #';
    parts.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${(VH - 5).toFixed(1)}" fill="#93a8c4" font-size="9.5" text-anchor="middle" font-family="Geist Sans,Inter,sans-serif">${esc(xLabel)}</text>`);

    // Data points — larger and brighter
    comps.forEach((c, i) => {
      const price = prices[i];
      const xVal  = xVals[i];
      if (price == null) return;
      const cx = toX(xVal);
      const cy = toY(price);
      if (cx == null || cy == null) return;

      const year     = c.year      || '';
      const make     = (c.make     || '').toUpperCase();
      const model    = c.model     || '';
      const trim     = c.trim      || '';
      const mileVal  = c.mileage ?? c.km ?? c.odometer ?? null;
      const city     = c.city || c.cityAuction || c.location || c.auction_location || c.seller || '';
      const score    = c.similarity_score ?? c.score ?? null;
      const saleDate = c.auctionRunTimeAt || c.sale_date || '';

      const titleStr = [year, make, model, trim].filter(Boolean).join(' ') || `Comparable ${i + 1}`;
      const mileStr  = mileVal != null ? fmtNum(mileVal) : '';
      const scoreStr = score != null ? (typeof score.toFixed === 'function' ? score.toFixed(2) : String(score)) : '';

      parts.push(`<circle class="autopluto-comp-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" data-title="${esc(titleStr)}" data-price="${esc(fmt(price))}" data-mileage="${esc(mileStr)}" data-city="${esc(city)}" data-score="${esc(scoreStr)}" data-date="${esc(saleDate)}"/>`);
    });

    return `
      <div class="autopluto-comps-card">
        ${headerHtml}
        <div class="autopluto-comps-chart-wrap">
          <svg class="autopluto-comps-svg" viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${parts.join('')}</svg>
          <div class="autopluto-comp-tooltip"></div>
        </div>
        ${buildComparableTable(comps, emp)}
      </div>`;
  }

  /** Attach hover tooltips to comparable chart dots — call after innerHTML is set */
  function attachComparableTooltips(card) {
    const svg  = card.querySelector('.autopluto-comps-svg');
    const tip  = card.querySelector('.autopluto-comp-tooltip');
    const wrap = card.querySelector('.autopluto-comps-chart-wrap');
    if (!svg || !tip || !wrap) return;

    svg.querySelectorAll('.autopluto-comp-dot').forEach((dot) => {
      dot.addEventListener('mouseenter', () => {
        const title   = dot.getAttribute('data-title')   || 'Comparable';
        const price   = dot.getAttribute('data-price')   || 'N/A';
        const mileage = dot.getAttribute('data-mileage') || '';
        const city    = dot.getAttribute('data-city')    || '';
        const score   = dot.getAttribute('data-score')   || '';
        const date    = dot.getAttribute('data-date')    || '';

        let rows = `<div class="autopluto-comp-tt-title">${esc(title)}</div>`;
        rows += `<div class="autopluto-comp-tt-row"><span>Price</span><strong>${esc(price)}</strong></div>`;
        if (mileage) rows += `<div class="autopluto-comp-tt-row"><span>Mileage</span><strong>${esc(mileage)}</strong></div>`;
        if (city)    rows += `<div class="autopluto-comp-tt-row"><span>Location</span><strong>${esc(city)}</strong></div>`;
        if (score)   rows += `<div class="autopluto-comp-tt-row"><span>Score</span><strong>${esc(score)}</strong></div>`;
        if (date)    rows += `<div class="autopluto-comp-tt-row"><span>Date</span><strong>${esc(date)}</strong></div>`;

        tip.innerHTML = rows;

        const wrapRect = wrap.getBoundingClientRect();
        const svgRect  = svg.getBoundingClientRect();
        const cx = parseFloat(dot.getAttribute('cx'));
        const cy = parseFloat(dot.getAttribute('cy'));
        const scaleX = svgRect.width  / 460;
        const scaleY = svgRect.height / 188;
        const dotLeft = svgRect.left - wrapRect.left + cx * scaleX;
        const dotTop  = svgRect.top  - wrapRect.top  + cy * scaleY;
        const tipW = 172;
        let left = dotLeft + 14;
        let top  = dotTop  - 10;
        if (left + tipW > wrapRect.width - 4) left = dotLeft - tipW - 8;
        if (left < 4) left = 4;
        if (top < 4)  top  = dotTop + 16;
        tip.style.cssText = `display:block !important;left:${left}px;top:${top}px;`;
      });

      dot.addEventListener('mouseleave', () => {
        tip.style.cssText = 'display:none !important;';
      });
    });
  }

  // ── F. Supporting Risk & Quality Signals ─────────────────────
  function buildSupportingSignals(result, compQuality) {
    const safety   = result.bid_safety_level;
    const comps    = result.comparable_count;
    const fallback = result.market_fallback_level;

    const items = [];

    if (safety) {
      items.push({
        key:   'Bid Safety',
        value: safety.replace(/_/g, ' '),
        color: getSafetyColor(safety),
      });
    }

    if (compQuality) {
      const qc     = compQuality.toLowerCase();
      const qColor = (qc === 'good' || qc === 'high') ? 'green'
        : (qc === 'unreliable' || qc === 'low')       ? 'red'
        : 'yellow';
      items.push({
        key:   'Data Quality',
        value: compQuality.replace(/_/g, ' '),
        color: qColor,
      });
    }

    if (comps != null) {
      items.push({
        key:   'Comparables',
        value: String(comps),
        color: comps > 3 ? 'blue' : comps > 0 ? 'yellow' : 'gray',
      });
    }

    if (fallback) {
      items.push({
        key:   'Market Fallback',
        value: fallback.replace(/_/g, ' '),
        color: getFallbackColor(fallback),
      });
    }

    if (items.length === 0) return '';

    return `<div class="autopluto-status-grid">
      ${items.map((it) => `
        <div class="autopluto-status-item autopluto-status-item--${esc(it.color)}">
          <span class="autopluto-status-label">${esc(it.key)}</span>
          <div class="autopluto-status-value-row">
            <span class="autopluto-status-dot"></span>
            <span class="autopluto-status-value">${esc(it.value)}</span>
          </div>
        </div>`).join('')}
    </div>`;
  }

  // ── G. Manual Review Warning ─────────────────────────────────
  function buildWarningCard(manualReview) {
    if (!manualReview) return '';
    return `
      <div class="autopluto-manual-review-box">
        <span class="autopluto-manual-review-icon">⚠</span>
        <div>
          <div class="autopluto-manual-review-title">Manual Review Required</div>
          <div class="autopluto-manual-review-sub">Do not rely on this estimate without additional review.</div>
        </div>
      </div>`;
  }

  // ── H. Footer Actions ────────────────────────────────────────
  function buildFooterActions() {
    return `
      <div class="autopluto-card-footer">
        <button class="autopluto-footer-btn autopluto-footer-btn--secondary autopluto-refresh-btn">↻ Refresh</button>
        <button class="autopluto-footer-btn autopluto-footer-btn--ghost autopluto-copy-result-btn">⎘ Copy</button>
        <button class="autopluto-footer-btn autopluto-footer-btn--close autopluto-close-footer-btn">✕ Close</button>
      </div>`;
  }

  function showLoadingPopover(rowEl, vehicleTitle) {
    closeActivePopover();

    const card = document.createElement('div');
    card.className = 'autopluto-card autopluto-popover';
    card.setAttribute('data-autopluto-card', 'true');
    card.innerHTML = `
      <div class="autopluto-card-header">
        <div class="autopluto-header-top">
          <div class="autopluto-header-title-group">
            <div class="autopluto-card-title">${esc(vehicleTitle || 'Auction Price Estimate')}</div>
            <div class="autopluto-header-badges">
              <span class="autopluto-badge-ai">Estimate Report</span>
            </div>
          </div>
          <button class="autopluto-card-close" title="Close">✕</button>
        </div>
      </div>
      <div class="autopluto-card-body">
        <div class="autopluto-skeleton-status">Fetching estimate…</div>
        <div class="autopluto-skeleton-bar"></div>
        <div class="autopluto-skeleton-bar autopluto-skeleton-bar-sm"></div>
        <div class="autopluto-skeleton-bar"></div>
        <div class="autopluto-skeleton-bar autopluto-skeleton-bar-xs"></div>
      </div>
    `;
    card.querySelector('.autopluto-card-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeActivePopover();
    });

    document.body.appendChild(card);
    _activePopover    = card;
    _activePopoverRow = rowEl;
    positionPopover(card, rowEl);
    return card;
  }

  function showResultCard(rowEl, result, vehicleData) {
    closeActivePopover();

    const raw             = result._raw || {};
    const emp             = result.estimated_market_price;
    const rmb             = result.recommended_max_bid;
    const currentPrice    = vehicleData.metadata?.currentAuctionPrice;
    const hasCurrentPrice = currentPrice != null;
    const margin          = hasCurrentPrice && rmb != null ? rmb - currentPrice : null;
    const bidGtEmp        = emp != null && rmb != null && rmb > emp;

    // ── Extended raw fields ──────────────────────────────────────
    const modelPrice      = raw.model_price              ?? null;
    const calibratedPrice = raw.calibrated_model_price   ?? null;
    const adjustedPrice   = raw.adjusted_price           ?? null;
    const compMedian      = raw.comparable_median_price  ?? null;
    const rangeLow        = raw.expected_range_low       ?? null;
    const rangeHigh       = raw.expected_range_high      ?? null;
    const riskPct         = raw.risk_adjustment_pct      ?? null;
    const discountPct     = raw.effective_bid_discount_pct ?? null;
    const riskReasons     = Array.isArray(raw.risk_adjustment_reasons) ? raw.risk_adjustment_reasons : [];
    const blendReason     = raw.blend_reason             ?? null;
    const blendWeight     = raw.model_blend_weight       ?? null;
    const manualReview    = raw.manual_review_required   ?? false;
    const compQuality     = raw.comparable_quality       ?? null;

    // ── Confidence data for EMP hero ─────────────────────────────
    const confidence = result.confidence_level;
    const confColor  = getConfidenceColor(confidence);
    const confPct    = getConfidencePercent(confidence);

    const card = document.createElement('div');
    card.className = 'autopluto-card autopluto-popover';
    card.setAttribute('data-autopluto-card', 'true');

    // ── Section builders (new v8 layout) ─────────────────────────
    const headerHtml   = buildHeaderSection(vehicleData, result);
    const primaryHtml  = buildPrimaryIntelligenceSection(emp, rmb, currentPrice, hasCurrentPrice, confidence, confColor, confPct, compQuality);
    const insightHtml  = buildDecisionInsight(margin, hasCurrentPrice && rmb != null, currentPrice, emp);
    const rangeHtml    = buildRangeVisualization(rangeLow, rangeHigh, emp, rmb, hasCurrentPrice ? currentPrice : null);
    const compsHtml    = buildComparablesChart(raw, emp, rmb);
    const signalsHtml  = buildSupportingSignals(result, compQuality);
    const warningHtml  = buildWarningCard(manualReview);

    // ── General inline warnings ──────────────────────────────────
    let inlineWarnings = '';
    if (bidGtEmp) {
      inlineWarnings += `<div class="autopluto-warning-banner">⚠ Recommended max bid exceeds estimated market price. Review before bidding.</div>`;
    }
    if (!vehicleData.vin) {
      inlineWarnings += `<div class="autopluto-warning-banner">⚠ VIN not detected — estimate may be less accurate.</div>`;
    }

    // ── Collapsible: Report Notes ────────────────────────────────
    const reportNotesHtml = buildCollapsibleSection('Report Notes', normalizeReasonList(result), 'default');

    // ── Collapsible: API Warnings ────────────────────────────────
    const apiWarningsHtml = buildCollapsibleSection('API Warnings', normalizeWarningList(result), 'warning');

    // ── Collapsible: Adjustment Details ─────────────────────────
    const priceRows = [
      { label: 'Model Price',   value: modelPrice      != null ? fmt(modelPrice)      : null },
      { label: 'Calibrated',    value: calibratedPrice != null ? fmt(calibratedPrice) : null },
      { label: 'Adjusted',      value: adjustedPrice   != null ? fmt(adjustedPrice)   : null },
      { label: 'Comp Median',   value: compMedian      != null ? fmt(compMedian)      : null },
      { label: 'Risk Adj.',     value: riskPct         != null ? `${riskPct}%`        : null },
      { label: 'Eff. Discount', value: discountPct     != null ? `${discountPct}%`    : null },
      { label: 'Blend Reason',  value: blendReason     ? blendReason.replace(/_/g, ' ') : null },
      { label: 'Model Blend',   value: blendWeight     != null ? `${(blendWeight * 100).toFixed(0)}%` : null },
    ].filter((r) => r.value != null);

    let adjustInnerHtml = '';
    if (priceRows.length > 0) {
      adjustInnerHtml += `<div class="autopluto-adjust-grid">
        ${priceRows.map((r) => `<div class="autopluto-adjust-item">
          <span class="autopluto-adjust-label">${esc(r.label)}</span>
          <span class="autopluto-adjust-value">${esc(r.value)}</span>
        </div>`).join('')}
      </div>`;
    }
    if (riskReasons.length > 0) {
      adjustInnerHtml += `<div class="autopluto-adjust-reasons-title">Risk Adjustment Reasons</div>
        <ul class="autopluto-details-list autopluto-details-list--muted">
          ${riskReasons.map((r) => `<li>${esc(typeof r === 'string' ? r : JSON.stringify(r))}</li>`).join('')}
        </ul>`;
    }
    const adjustHtml = adjustInnerHtml
      ? buildCollapsibleBlock('Adjustment Details', adjustInnerHtml, 'muted')
      : '';

    // ── Collapsible: Input Coverage ──────────────────────────────
    const inputCoverageHtml = buildCollapsibleBlock('Input Coverage', buildDataQuality(vehicleData), 'muted');

    // ── Collapsible: Debug Details ───────────────────────────────
    const dbg = vehicleData._extractionDebug || {};

    // Mirror exactly what predict() sends to /v1/predict
    const finalPayloadSentToApi = {
      year:             vehicleData.year,
      make:             vehicleData.make,
      model:            vehicleData.model,
      trim:             vehicleData.trim,
      mileage:          vehicleData.mileage,
      vin:              vehicleData.vin,
      fuelType:         vehicleData.fuelType,
      drivetrain:       vehicleData.drivetrain,
      transmission:     vehicleData.transmission,
      engine:           vehicleData.engine,
      exteriorColor:    vehicleData.exteriorColor,
      doors:            vehicleData.doors,
      titleFull:        vehicleData.titleFull,
      cityAuction:      vehicleData.cityAuction,
      sellerName:       vehicleData.sellerName,
      source:           vehicleData.source,
      section:          vehicleData.section,
      auctionRunTimeAt: vehicleData.auctionRunTimeAt,
    };

    const debugPayload = {
      extractionStatus: dbg.extractionStatus || {
        sourceUsed: 'row', opened: false, visiblePopupFound: false,
        detailsTabClicked: false, vinMatched: false, runNumberMatched: false, warnings: [],
      },
      rowData:              dbg.prePopupData  || null,
      rightPanelData:       null,
      popupData:            dbg.popupData     || null,
      popupFieldMap:        dbg.popupFieldMap || {},
      finalPayloadSentToApi,
      apiResult:            result._raw,
    };
    const debugHtml = buildCollapsibleBlock(
      'Debug Details',
      `<pre class="autopluto-debug-pre">${esc(JSON.stringify(debugPayload, null, 2))}</pre>`,
      'muted'
    );

    // ── Assemble card HTML (v8 layout) ───────────────────────────
    card.innerHTML = `
      ${headerHtml}
      <div class="autopluto-card-body">
        ${primaryHtml}
        ${insightHtml}
        ${warningHtml}
        ${rangeHtml}
        ${compsHtml}
        ${signalsHtml}
        ${inlineWarnings}
        <div class="autopluto-collapsibles">
          ${reportNotesHtml}
          ${apiWarningsHtml}
          ${adjustHtml}
          ${inputCoverageHtml}
          ${debugHtml}
        </div>
      </div>
      ${buildFooterActions()}
    `;

    // ── Close buttons (header ✕ + footer Close) ──────────────────
    card.querySelector('.autopluto-card-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeActivePopover();
    });
    card.querySelector('.autopluto-close-footer-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeActivePopover();
    });

    // ── <details> toggle → reposition popover ───────────────────
    card.querySelectorAll('details.autopluto-details').forEach((det) => {
      det.addEventListener('toggle', () => positionPopover(card, rowEl));
    });

    // ── Comparable chart tooltips ────────────────────────────────
    attachComparableTooltips(card);

    // ── Copy result ───────────────────────────────────────────────
    card.querySelector('.autopluto-copy-result-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const summary = {
        vehicle:                vehicleData.titleFull    || null,
        vin:                    vehicleData.vin           || null,
        mileage_km:             vehicleData.mileage       || null,
        estimated_market_price: emp,
        recommended_max_bid:    rmb,
        current_price:          currentPrice             || null,
        margin_to_max_bid:      margin,
        expected_range_low:     rangeLow,
        expected_range_high:    rangeHigh,
        confidence:             result.confidence_level  || null,
        safety:                 result.bid_safety_level  || null,
        comparables:            result.comparable_count,
        comparable_quality:     compQuality,
        fallback:               result.market_fallback_level || null,
        manual_review_required: manualReview,
        model:                  result.model_version     || null,
      };
      navigator.clipboard.writeText(JSON.stringify(summary, null, 2)).then(() => {
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = '⎘ Copy'; }, 2000);
      });
    });

    document.body.appendChild(card);
    _activePopover    = card;
    _activePopoverRow = rowEl;
    positionPopover(card, rowEl);
    return card;
  }

  function showErrorCard(rowEl, error) {
    closeActivePopover();

    let title       = 'Estimate Failed';
    let detail      = error.message || 'Unknown error';
    let detailExtra = '';
    let copyPayload = null;

    if (error.type === 'timeout') {
      title  = 'Request Timed Out';
      detail = 'The API did not respond in time. Check your connection or try again.';
    } else if (error.type === 'network') {
      title  = 'Network Error';
      detail = 'Could not reach the API. Verify the API URL in extension settings.';
    } else if (error.type === 'api') {
      title = `API Error (${error.status})`;
      if (error.status === 422 && Array.isArray(error.data?.detail)) {
        detail = 'Request payload failed validation:';
        detailExtra = '<ul class="autopluto-validation-errors">' +
          error.data.detail.map((e) => {
            const loc = (e.loc || []).slice(1).join(' → ');
            return `<li>${esc(loc ? `${loc}: ${e.msg}` : e.msg)}</li>`;
          }).join('') +
          '</ul>';
        copyPayload = JSON.stringify(error.data, null, 2);
      }
    } else if (error.type === 'parse') {
      title = 'Response Parse Error';
    }

    const card = document.createElement('div');
    card.className = 'autopluto-card autopluto-popover autopluto-card-error';
    card.setAttribute('data-autopluto-card', 'true');
    card.innerHTML = `
      <div class="autopluto-card-header autopluto-card-header--error">
        <div class="autopluto-header-top">
          <div class="autopluto-header-title-group">
            <div class="autopluto-card-title">⚠ ${esc(title)}</div>
            <div class="autopluto-header-badges">
              <span class="autopluto-badge-ai">AI Estimate</span>
            </div>
          </div>
          <button class="autopluto-card-close" title="Close">✕</button>
        </div>
      </div>
      <div class="autopluto-card-body">
        <p class="autopluto-error-msg">${esc(detail)}</p>
        ${detailExtra}
        ${copyPayload ? '<button class="autopluto-footer-btn autopluto-footer-btn--secondary autopluto-copy-payload-btn" style="margin-top:6px;">Copy payload</button>' : ''}
      </div>
    `;
    card.querySelector('.autopluto-card-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeActivePopover();
    });
    if (copyPayload) {
      card.querySelector('.autopluto-copy-payload-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        navigator.clipboard.writeText(copyPayload).then(() => {
          btn.textContent = 'Copied ✓';
        });
      });
    }

    document.body.appendChild(card);
    _activePopover    = card;
    _activePopoverRow = rowEl;
    positionPopover(card, rowEl);
    return card;
  }

  function showDebugModal(payload) {
    const existing = document.getElementById('autopluto-debug-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'autopluto-debug-modal';
    modal.className = 'autopluto-debug-modal';
    modal.innerHTML = `
      <div class="autopluto-debug-inner">
        <div class="autopluto-debug-header">
          <strong>AutoPluто Debug – Payload</strong>
          <button id="autopluto-debug-close">✕</button>
        </div>
        <pre class="autopluto-debug-pre">${esc(JSON.stringify(payload, null, 2))}</pre>
        <button id="autopluto-debug-copy">Copy payload</button>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('autopluto-debug-close').addEventListener('click', () => modal.remove());
    document.getElementById('autopluto-debug-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
        document.getElementById('autopluto-debug-copy').textContent = 'Copied ✓';
      });
    });
  }

  function showBatchProgress(current, total) {
    let banner = document.getElementById('autopluto-batch-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'autopluto-batch-banner';
      banner.className = 'autopluto-batch-banner';
      document.body.appendChild(banner);
    }
    if (current >= total) {
      banner.textContent = `✓ Batch complete – ${total} vehicles estimated.`;
      setTimeout(() => banner.remove(), 3000);
    } else {
      banner.textContent = `Estimating vehicles… ${current}/${total}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION CACHE
  // ═══════════════════════════════════════════════════════════════════════════

  const _cache = new Map();

  function cacheKey(payload) {
    if (payload.vin) return `vin:${payload.vin}`;
    return `run:${payload.metadata?.runNumber || '?'}|${payload.titleFull || '?'}|${payload.mileage || '?'}`;
  }

  function getCache(payload) { return _cache.get(cacheKey(payload)) || null; }
  function setCache(payload, result) { _cache.set(cacheKey(payload), result); }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROW DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  function isVehicleRow(el) {
    if (el.nodeType !== 1) return false;

    // Table-view rows
    if (el.tagName === 'TR') {
      if (el.hasAttribute('data-cy-item-num')) return true;
      return !!(el.querySelector('.item-info-row') && el.querySelector('.mileage-row'));
    }

    // Lane/kanban-view item cards — must not be the popup itself
    if (el.classList.contains('vc-item-popup') || el.classList.contains('item-detail-popup')) return false;
    if (el.closest && el.closest('.vc-item-popup, .item-detail-popup')) return false;
    return !!(
      (el.querySelector('.vc-details, .run-number, .item-info-row')) &&
      el.closest && el.closest('.lane-content, .lane-panel-col')
    );
  }

  function findVehicleRows(root) {
    const rows = [];
    const seen = new Set();
    const add  = (el) => { if (!seen.has(el)) { seen.add(el); rows.push(el); } };

    // ── Table view ────────────────────────────────────────────
    root.querySelectorAll('tr[data-cy-item-num]').forEach(add);
    root.querySelectorAll('tbody.vc-tbdy-vehlist > tr').forEach((r) => {
      if (!r.hasAttribute('data-cy-item-num') && r.querySelector('.item-info-row')) add(r);
    });

    // ── Lane / kanban view ─────────────────────────────────────
    // Items live as direct children of .lane-content; skip the popup overlay.
    root.querySelectorAll('.lane-content > div, .lane-content > li').forEach((el) => {
      if (el.classList.contains('vc-item-popup') || el.classList.contains('item-detail-popup')) return;
      if (el.querySelector('.vc-details, .run-number, .item-info-row')) add(el);
    });

    // Also capture explicitly-classed vc-item cards anywhere in the subtree
    root.querySelectorAll('div.vc-item, [class*="vc-item-card"]').forEach((el) => {
      if (!el.closest('.vc-item-popup') && !el.closest('.item-detail-popup')) add(el);
    });

    return rows;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTIMATE CLICK HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async function handleEstimateClick(rowEl, tab, forceRefresh) {
    const settings = await getSettings();

    // Stage 1: extract basic row + right-panel data
    const baseData = extractVehicleData(rowEl);

    // Show loading state immediately so the user has feedback while popup opens
    setTabLoading(tab);
    showLoadingPopover(rowEl, baseData.titleFull || 'Vehicle');

    // Stage 2: popup enrichment (open popup → verify → extract → close → merge)
    const { vehicleData, popupData, popupFieldMap, extractionStatus } =
      await extractWithPopup(rowEl, baseData);

    // Attach extraction debug — never sent to the API
    vehicleData._extractionDebug = {
      extractionStatus,
      prePopupData: {
        vin:             baseData.vin,
        trim:            baseData.trim,
        mileage:         baseData.mileage,
        engine:          baseData.engine,
        fuelType:        baseData.fuelType,
        drivetrain:      baseData.drivetrain,
        transmission:    baseData.transmission,
        doors:           baseData.doors,
        exteriorColor:   baseData.exteriorColor,
        sellerName:      baseData.sellerName,
        cityAuction:     baseData.cityAuction,
        vehicleLocation: baseData.metadata?.vehicleLocation,
      },
      popupData:    popupData    || null,
      popupFieldMap: popupFieldMap || {},
    };

    if (settings.debugMode) showDebugModal(vehicleData);

    if (!forceRefresh) {
      const cached = getCache(vehicleData);
      if (cached) {
        setTabReady(tab);
        closeActivePopover(); // dismiss the loading card we showed
        const card = showResultCard(rowEl, cached, vehicleData);
        attachRefresh(card, rowEl, tab);
        return;
      }
    }

    try {
      const result = await predict(vehicleData);
      setCache(vehicleData, result);
      setTabReady(tab);
      const card = showResultCard(rowEl, result, vehicleData);
      attachRefresh(card, rowEl, tab);
    } catch (err) {
      setTabError(tab);
      showErrorCard(rowEl, err);
      console.error('[AutoPluто] Predict error:', err);
    }
  }

  function attachRefresh(card, rowEl, tab) {
    const refreshBtn = card.querySelector('.autopluto-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleEstimateClick(rowEl, tab, true);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROW INJECTION
  // ═══════════════════════════════════════════════════════════════════════════

  function injectIntoRows(root) {
    findVehicleRows(root).forEach((row) => {
      injectEstimateTab(row, (rowEl, tab) => {
        handleEstimateClick(rowEl, tab, false);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MUTATION OBSERVER
  // ═══════════════════════════════════════════════════════════════════════════

  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (isVehicleRow(node)) {
            injectIntoRows(node.parentElement || node);
          } else if (node.querySelectorAll) {
            injectIntoRows(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH ESTIMATION
  // ═══════════════════════════════════════════════════════════════════════════

  async function batchEstimateVisible() {
    const rows = Array.from(document.querySelectorAll('tr[data-cy-item-num]')).filter((r) => {
      const rect = r.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight + 200;
    });

    if (!rows.length) {
      alert('[AutoPluто] No visible vehicle rows found.');
      return;
    }

    if (!confirm(`[AutoPluто] Estimate ${rows.length} visible vehicles? This will make ${rows.length} API calls.`)) return;

    let done = 0;
    showBatchProgress(0, rows.length);

    for (const row of rows) {
      const tab = _portalTabs.get(row) || null;
      try {
        const baseData = extractVehicleData(row);
        if (tab) setTabLoading(tab);
        // Sequential popup enrichment — _popupOperationActive guards overlap
        const { vehicleData } = await extractWithPopup(row, baseData);
        const result = await predict(vehicleData);
        setCache(vehicleData, result);
        if (tab) setTabReady(tab);
      } catch (err) {
        if (tab) setTabError(tab);
        console.warn('[AutoPluто] Batch error on row', row, err);
      }
      done++;
      showBatchProgress(done, rows.length);
      // Slightly longer gap between rows to let popup open/close settle
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE LISTENER  (batch trigger from popup / background)
  // ═══════════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'BATCH_ESTIMATE_VISIBLE') batchEstimateVisible();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    injectGeistFont();
    injectIntoRows(document);
    startObserver();

    // Keep portal tabs aligned as the page scrolls or resizes
    window.addEventListener('scroll', syncAllTabPositions, { passive: true, capture: true });
    window.addEventListener('resize', syncAllTabPositions, { passive: true });
    // Catch layout shifts not triggered by scroll/resize (e.g. lazy-load reflows)
    setInterval(syncAllTabPositions, 400);

    console.log('[AutoPluто] Content script initialised.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
