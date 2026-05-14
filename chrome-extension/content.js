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
    const labels = container.querySelectorAll('td label');
    for (const lbl of labels) {
      if (lbl.textContent.trim().toLowerCase() === labelText.toLowerCase()) {
        const td = lbl.closest('td');
        if (td && td.nextElementSibling) {
          return td.nextElementSibling.textContent.trim() || null;
        }
      }
    }
    return null;
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

    const detailsTable = panel.querySelector('.vc-item-det table');

    const engine       = getTableValue(detailsTable, 'Engine')           || getTableValue(detailsTable, 'engine');
    const fuelType     = getTableValue(detailsTable, 'Fuel')             || getTableValue(detailsTable, 'fuel');
    const driveType    = getTableValue(detailsTable, 'Drive Type')       || getTableValue(detailsTable, 'drive type');
    const transmission = getTableValue(detailsTable, 'Transmission')     || getTableValue(detailsTable, 'transmission');
    const doorRaw      = getTableValue(detailsTable, 'Door')             || getTableValue(detailsTable, 'door');
    const doors        = doorRaw ? parseInt(doorRaw, 10) || null : null;
    const colorDetail  = getTableValue(detailsTable, 'Color')            || getTableValue(detailsTable, 'color');
    const sellerDetail = getTableValue(detailsTable, 'Seller')           || getTableValue(detailsTable, 'seller');
    const trimDetail   = getTableValue(detailsTable, 'Trim')             || getTableValue(detailsTable, 'trim');
    const vehicleLocation = getTableValue(detailsTable, 'Vehicle Location') || getTableValue(detailsTable, 'vehicle location');
    const vinDetail    = getTableValue(detailsTable, 'VIN');

    return {
      currentAuctionPrice,
      lights,
      minPrice,
      engine:               engine       || null,
      fuelType:             fuelType     || null,
      drivetrain:           driveType    || null,
      transmission:         transmission || null,
      doors,
      exteriorColorDetail:  colorDetail  || null,
      sellerName:           sellerDetail || null,
      trimDetail:           trimDetail   || null,
      vehicleLocation:      vehicleLocation || null,
      vinDetail:            vinDetail    || null,
    };
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
    const POPOVER_W = 500;
    const rect      = rowEl.getBoundingClientRect();

    let left = rect.right + 12;
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
    const fields = [
      { label: 'VIN',      val: vehicleData.vin },
      { label: 'Mileage',  val: vehicleData.mileage },
      { label: 'City',     val: vehicleData.cityAuction },
      { label: 'Seller',   val: vehicleData.sellerName },
      { label: 'Trim',     val: vehicleData.trim },
      { label: 'Drive',    val: vehicleData.drivetrain },
      { label: 'Fuel',     val: vehicleData.fuelType },
      { label: 'Engine',   val: vehicleData.engine },
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
  // EMP is the HERO. Confidence is tightly coupled with it.
  // RMB and Current Bid are visually secondary (right column).
  function buildPrimaryIntelligenceSection(emp, rmb, currentPrice, hasCurrentPrice, confidence, confColor, confPct) {
    const confHtml = confidence
      ? `<div class="autopluto-emp-conf">
           <div class="autopluto-emp-conf-meter">
             <div class="autopluto-emp-conf-fill autopluto-emp-conf-fill--${esc(confColor)}" style="width:${confPct}%"></div>
           </div>
           <span class="autopluto-emp-conf-badge autopluto-emp-conf-badge--${esc(confColor)}">${esc(confidence.replace(/_/g, ' '))}</span>
         </div>`
      : `<div class="autopluto-emp-conf">
           <span class="autopluto-emp-conf-badge autopluto-emp-conf-badge--gray">Confidence N/A</span>
         </div>`;

    return `
      <div class="autopluto-primary-intel">
        <div class="autopluto-emp-hero">
          <div class="autopluto-emp-hero-label">Estimated Market Price</div>
          <div class="autopluto-emp-hero-value">${fmt(emp)}</div>
          ${confHtml}
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
  function buildDecisionInsight(margin, canCalculate) {
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
        <span class="autopluto-insight-label">Above recommended max — consider walking away</span>
        <span class="autopluto-insight-meta"><strong>${fmt(Math.abs(margin))}</strong> over limit</span>
      </div>
    </div>`;
  }

  // ── D. Expected Market Range (premium range rail) ────────────
  function buildRangeVisualization(rangeLow, rangeHigh, emp, rmb, currentPrice) {
    if (rangeLow == null && rangeHigh == null) return '';

    const hasRange = rangeLow != null && rangeHigh != null && rangeHigh > rangeLow;
    let barHtml    = '';
    let legendHtml = '';

    if (hasRange) {
      const clampPct = (val) => val == null ? null
        : Math.max(1.5, Math.min(98.5, ((val - rangeLow) / (rangeHigh - rangeLow)) * 100));

      const markers = [];
      if (emp          != null) markers.push({ pct: clampPct(emp),          cls: 'emp',     label: 'Market Price', value: fmt(emp) });
      if (rmb          != null) markers.push({ pct: clampPct(rmb),          cls: 'rmb',     label: 'Max Bid',      value: fmt(rmb) });
      if (currentPrice != null) markers.push({ pct: clampPct(currentPrice), cls: 'current', label: 'Current Bid',  value: fmt(currentPrice) });

      const markersHtml = markers.map((m) =>
        `<div class="autopluto-rm autopluto-rm--${m.cls}" style="left:${m.pct.toFixed(1)}%" title="${esc(m.label)}: ${esc(m.value)}"></div>`
      ).join('');

      barHtml = `
        <div class="autopluto-range-viz">
          <div class="autopluto-range-track">
            <div class="autopluto-range-track-fill"></div>
            ${markersHtml}
          </div>
          <div class="autopluto-range-bounds">
            <span>${fmt(rangeLow)}</span>
            <span>${fmt(rangeHigh)}</span>
          </div>
        </div>`;

      if (markers.length > 0) {
        legendHtml = `<div class="autopluto-range-legend">
          ${markers.map((m) => `
            <div class="autopluto-range-legend-item">
              <span class="autopluto-range-legend-dot autopluto-range-legend-dot--${m.cls}"></span>
              <div class="autopluto-range-legend-info">
                <span class="autopluto-range-legend-lbl">${esc(m.label)}</span>
                <span class="autopluto-range-legend-val">${esc(m.value)}</span>
              </div>
            </div>`).join('')}
        </div>`;
      }
    } else {
      barHtml = `<div class="autopluto-range-simple">
        ${rangeLow  != null ? `<div class="autopluto-range-simple-item"><span class="autopluto-range-simple-lbl">Low</span><span class="autopluto-range-simple-val">${fmt(rangeLow)}</span></div>`  : ''}
        ${rangeHigh != null ? `<div class="autopluto-range-simple-item"><span class="autopluto-range-simple-lbl">High</span><span class="autopluto-range-simple-val">${fmt(rangeHigh)}</span></div>` : ''}
      </div>`;
    }

    return `
      <div class="autopluto-range-card">
        <div class="autopluto-range-card-title">Expected Market Range</div>
        ${barHtml}
        ${legendHtml}
      </div>`;
  }

  // ── E. Comparable Vehicles Chart (SVG scatter plot) ──────────
  function buildComparablesChart(raw, emp) {
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

    // SVG chart geometry
    const VW = 460, VH = 156;
    const ML = 56, MR = 24, MT = 16, MB = 28;
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

    // Horizontal grid + y-axis price labels
    for (let i = 0; i <= 4; i++) {
      const y     = MT + (ph / 4) * i;
      const price = yMax - (yMax - yMin) * (i / 4);
      parts.push(`<line x1="${ML}" y1="${y.toFixed(1)}" x2="${VW - MR}" y2="${y.toFixed(1)}" stroke="#1a2d48" stroke-width="1"/>`);
      parts.push(`<text x="${(ML - 5).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" fill="#374151" font-size="9" text-anchor="end" font-family="Geist Sans,Inter,sans-serif">${esc(fmtShort(Math.round(price)))}</text>`);
    }

    // EMP reference dashed line
    if (emp != null) {
      const ey = toY(emp);
      if (ey != null) {
        parts.push(`<line x1="${ML}" y1="${ey.toFixed(1)}" x2="${VW - MR}" y2="${ey.toFixed(1)}" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.7"/>`);
        parts.push(`<text x="${(VW - MR + 3).toFixed(1)}" y="${(ey + 3.5).toFixed(1)}" fill="#60a5fa" font-size="8" font-family="Geist Sans,Inter,sans-serif">EMP</text>`);
      }
    }

    // Axes
    parts.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${(MT + ph).toFixed(1)}" stroke="#1e3a5f" stroke-width="1"/>`);
    parts.push(`<line x1="${ML}" y1="${(MT + ph).toFixed(1)}" x2="${VW - MR}" y2="${(MT + ph).toFixed(1)}" stroke="#1e3a5f" stroke-width="1"/>`);

    // X-axis label
    const xLabel = hasMileage ? 'Mileage' : 'Comparable';
    parts.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${(VH - 4).toFixed(1)}" fill="#374151" font-size="8" text-anchor="middle" font-family="Geist Sans,Inter,sans-serif">${esc(xLabel)}</text>`);

    // Data points
    comps.forEach((c, i) => {
      const price = prices[i];
      const xVal  = xVals[i];
      if (price == null) return;
      const cx = toX(xVal);
      const cy = toY(price);
      if (cx == null || cy == null) return;

      const year    = c.year      || '';
      const make    = (c.make     || '').toUpperCase();
      const model   = c.model     || '';
      const trim    = c.trim      || '';
      const mileVal = c.mileage ?? c.km ?? c.odometer ?? null;
      const city    = c.city || c.location || c.auction_location || c.seller || '';
      const score   = c.similarity_score ?? c.score ?? null;

      const titleStr = [year, make, model, trim].filter(Boolean).join(' ') || `Comparable ${i + 1}`;
      const mileStr  = mileVal != null ? fmtNum(mileVal) : '';
      const scoreStr = score != null ? (typeof score.toFixed === 'function' ? score.toFixed(2) : String(score)) : '';

      parts.push(`<circle class="autopluto-comp-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" data-title="${esc(titleStr)}" data-price="${esc(fmt(price))}" data-mileage="${esc(mileStr)}" data-city="${esc(city)}" data-score="${esc(scoreStr)}"/>`);
    });

    return `
      <div class="autopluto-comps-card">
        ${headerHtml}
        <div class="autopluto-comps-chart-wrap">
          <svg class="autopluto-comps-svg" viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>
          <div class="autopluto-comp-tooltip"></div>
        </div>
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

        let rows = `<div class="autopluto-comp-tt-title">${esc(title)}</div>`;
        rows += `<div class="autopluto-comp-tt-row"><span>Price</span><strong>${esc(price)}</strong></div>`;
        if (mileage) rows += `<div class="autopluto-comp-tt-row"><span>Mileage</span><strong>${esc(mileage)}</strong></div>`;
        if (city)    rows += `<div class="autopluto-comp-tt-row"><span>Location</span><strong>${esc(city)}</strong></div>`;
        if (score)   rows += `<div class="autopluto-comp-tt-row"><span>Score</span><strong>${esc(score)}</strong></div>`;

        tip.innerHTML = rows;

        const wrapRect = wrap.getBoundingClientRect();
        const svgRect  = svg.getBoundingClientRect();
        const cx = parseFloat(dot.getAttribute('cx'));
        const cy = parseFloat(dot.getAttribute('cy'));
        const scaleX = svgRect.width  / 460;
        const scaleY = svgRect.height / 156;
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

    const chips = [];
    if (safety)        chips.push({ label: 'Safety',   value: safety.replace(/_/g, ' '),     color: getSafetyColor(safety) });
    if (comps != null) chips.push({ label: 'Comps',    value: String(comps),                  color: comps > 0 ? 'blue' : 'gray' });
    if (compQuality) {
      const qc     = compQuality.toLowerCase();
      const qColor = (qc === 'good' || qc === 'high') ? 'green' : (qc === 'unreliable' || qc === 'low') ? 'red' : 'yellow';
      chips.push({ label: 'Quality',  value: compQuality.replace(/_/g, ' '),   color: qColor });
    }
    if (fallback)      chips.push({ label: 'Fallback', value: fallback.replace(/_/g, ' '),   color: getFallbackColor(fallback) });

    if (chips.length === 0) return '';
    return `<div class="autopluto-signals-row">
      ${chips.map((ch) => `
        <div class="autopluto-signal-chip autopluto-signal-chip--${esc(ch.color)}">
          <span class="autopluto-signal-lbl">${esc(ch.label)}</span>
          <span class="autopluto-signal-val">${esc(ch.value)}</span>
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
    const primaryHtml  = buildPrimaryIntelligenceSection(emp, rmb, currentPrice, hasCurrentPrice, confidence, confColor, confPct);
    const insightHtml  = buildDecisionInsight(margin, hasCurrentPrice && rmb != null);
    const rangeHtml    = buildRangeVisualization(rangeLow, rangeHigh, emp, rmb, currentPrice);
    const compsHtml    = buildComparablesChart(raw, emp);
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
    const debugPayload = JSON.stringify({ vehicle: vehicleData, result: result._raw }, null, 2);
    const debugHtml    = buildCollapsibleBlock(
      'Debug Details',
      `<pre class="autopluto-debug-pre">${esc(debugPayload)}</pre>`,
      'muted'
    );

    // ── Assemble card HTML (v8 layout) ───────────────────────────
    card.innerHTML = `
      ${headerHtml}
      <div class="autopluto-card-body">
        ${primaryHtml}
        ${insightHtml}
        ${rangeHtml}
        ${compsHtml}
        ${signalsHtml}
        ${warningHtml}
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

    // ── Close button ─────────────────────────────────────────────
    card.querySelector('.autopluto-card-close').addEventListener('click', (e) => {
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
    if (el.tagName !== 'TR') return false;
    if (el.hasAttribute('data-cy-item-num')) return true;
    return el.querySelector('.item-info-row') && el.querySelector('.mileage-row');
  }

  function findVehicleRows(root) {
    const rows = [];
    root.querySelectorAll('tr[data-cy-item-num]').forEach((r) => rows.push(r));
    root.querySelectorAll('tbody.vc-tbdy-vehlist > tr').forEach((r) => {
      if (!r.hasAttribute('data-cy-item-num') && r.querySelector('.item-info-row')) {
        rows.push(r);
      }
    });
    return rows;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTIMATE CLICK HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async function handleEstimateClick(rowEl, tab, forceRefresh) {
    const vehicleData = extractVehicleData(rowEl);
    const settings    = await getSettings();

    if (settings.debugMode) showDebugModal(vehicleData);

    if (!forceRefresh) {
      const cached = getCache(vehicleData);
      if (cached) {
        setTabReady(tab);
        const card = showResultCard(rowEl, cached, vehicleData);
        attachRefresh(card, rowEl, tab);
        return;
      }
    }

    setTabLoading(tab);
    showLoadingPopover(rowEl, vehicleData.titleFull);

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
      const tab = row.querySelector('[data-autopluto-btn]');
      try {
        const vehicleData = extractVehicleData(row);
        if (tab) setTabLoading(tab);
        const result = await predict(vehicleData);
        setCache(vehicleData, result);
        if (tab) setTabReady(tab);
      } catch (err) {
        if (tab) setTabError(tab);
        console.warn('[AutoPluто] Batch error on row', row, err);
      }
      done++;
      showBatchProgress(done, rows.length);
      await new Promise((resolve) => setTimeout(resolve, 600));
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
