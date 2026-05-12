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
      model_version:          raw.model_version           ?? null,
      calibration_version:    null,                         // not returned by current API
      estimated_market_price: raw.estimated_market_price  ?? raw.adjusted_price ?? null,
      recommended_max_bid:    raw.recommended_max_bid      ?? null,
      confidence_level:       raw.confidence_level         ?? raw.confidence    ?? null,
      bid_safety_level:       raw.bid_safety_level         ?? null,
      calibration_buffer:     null,                         // not returned by current API
      reason,
      comparable_count:       raw.comparables_found        ?? null,
      market_fallback_level:  raw.market_match_level       ?? null,
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
    tab.title = 'AI Price Estimate';
    tab.innerHTML = `
      <div class="autopluto-estimate-handle">
        <span class="autopluto-estimate-mini-label">AI</span>
      </div>
      <div class="autopluto-estimate-label">AI Estimate</div>
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
    const POPOVER_W = 320;
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

  function showLoadingPopover(rowEl, vehicleTitle) {
    closeActivePopover();

    const card = document.createElement('div');
    card.className = 'autopluto-card autopluto-popover';
    card.setAttribute('data-autopluto-card', 'true');
    card.innerHTML = `
      <div class="autopluto-card-header autopluto-popover-header">
        <span class="autopluto-card-title">Auction Price Estimate</span>
        <button class="autopluto-card-close autopluto-close-btn" title="Close">✕</button>
      </div>
      <div class="autopluto-card-body">
        <div class="autopluto-skeleton-vehicle">${esc(vehicleTitle || 'Loading vehicle…')}</div>
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

    const emp             = result.estimated_market_price;
    const rmb             = result.recommended_max_bid;
    const currentPrice    = vehicleData.metadata?.currentAuctionPrice;
    const hasCurrentPrice = currentPrice != null;
    const margin          = hasCurrentPrice && rmb != null ? rmb - currentPrice : null;
    const badgeInfo       = getBadgeInfo(margin, hasCurrentPrice && rmb != null);
    const bidGtEmp        = emp != null && rmb != null && rmb > emp;

    const card = document.createElement('div');
    card.className = 'autopluto-card autopluto-popover';
    card.setAttribute('data-autopluto-card', 'true');

    let marginHtml = '';
    if (hasCurrentPrice && rmb != null) {
      const sign = margin >= 0 ? '+' : '';
      marginHtml = `
        <div class="autopluto-row">
          <span class="autopluto-label">Margin to Max Bid</span>
          <span class="autopluto-badge ${badgeInfo.cls}">${sign}${fmt(margin)} – ${badgeInfo.label}</span>
        </div>`;
    }

    let warningHtml = '';
    if (bidGtEmp) {
      warningHtml = `<div class="autopluto-warning">⚠ Recommended max bid exceeds estimated market price. Review before bidding.</div>`;
    }
    if (!vehicleData.vin) {
      warningHtml += `<div class="autopluto-warning autopluto-warning-mild">⚠ VIN not detected – estimate may be less accurate.</div>`;
    }
    const missing = getMissingFields(vehicleData);
    if (missing.length) {
      warningHtml += `<div class="autopluto-warning autopluto-warning-mild">⚠ Missing fields: ${esc(missing.join(', '))}</div>`;
    }

    const confidenceCls = result.confidence_level
      ? (result.confidence_level.toLowerCase().includes('high') ? 'autopluto-badge-safe'
        : result.confidence_level.toLowerCase().includes('low') ? 'autopluto-badge-danger'
        : 'autopluto-badge-warning')
      : '';

    const safetyCls = result.bid_safety_level
      ? (result.bid_safety_level.toLowerCase().includes('safe') ? 'autopluto-badge-safe'
        : result.bid_safety_level.toLowerCase().includes('danger') || result.bid_safety_level.toLowerCase().includes('high risk') ? 'autopluto-badge-danger'
        : 'autopluto-badge-warning')
      : '';

    card.innerHTML = `
      <div class="autopluto-card-header autopluto-popover-header">
        <span class="autopluto-card-title">${esc(vehicleData.titleFull || 'Vehicle')}</span>
        <button class="autopluto-card-close autopluto-close-btn" title="Close">✕</button>
      </div>
      <div class="autopluto-card-body">
        <div class="autopluto-row autopluto-row-sub">
          <span class="autopluto-label-sm">VIN</span>
          <span class="autopluto-val-sm">${esc(vehicleData.vin || '—')}</span>
          <span class="autopluto-label-sm">Mileage</span>
          <span class="autopluto-val-sm">${fmtNum(vehicleData.mileage)}</span>
        </div>
        <div class="autopluto-prices autopluto-price-grid">
          <div class="autopluto-price-block autopluto-price-primary">
            <div class="autopluto-price-label">Est. Market Price</div>
            <div class="autopluto-price-value autopluto-price-main">${fmt(emp)}</div>
          </div>
          <div class="autopluto-price-block autopluto-price-secondary">
            <div class="autopluto-price-label">Rec. Max Bid</div>
            <div class="autopluto-price-value autopluto-price-bid">${fmt(rmb)}</div>
          </div>
          ${hasCurrentPrice ? `
          <div class="autopluto-price-block">
            <div class="autopluto-price-label">Current Price</div>
            <div class="autopluto-price-value autopluto-price-current">${fmt(currentPrice)}</div>
          </div>` : ''}
        </div>
        ${marginHtml}
        <div class="autopluto-divider"></div>
        <div class="autopluto-meta">
          ${result.confidence_level ? `<span class="autopluto-meta-item">Confidence: <span class="autopluto-badge ${confidenceCls}">${esc(result.confidence_level)}</span></span>` : ''}
          ${result.bid_safety_level ? `<span class="autopluto-meta-item">Safety: <span class="autopluto-badge ${safetyCls}">${esc(result.bid_safety_level)}</span></span>` : ''}
          ${result.comparable_count != null ? `<span class="autopluto-meta-item">Comparables: <strong>${result.comparable_count}</strong></span>` : ''}
        </div>
        <div class="autopluto-meta autopluto-meta-versions">
          ${result.model_version ? `<span class="autopluto-meta-item">Model: <strong>${esc(result.model_version)}</strong></span>` : ''}
          ${result.calibration_version ? `<span class="autopluto-meta-item">Cal: <strong>${esc(result.calibration_version)}</strong></span>` : ''}
          ${result.market_fallback_level ? `<span class="autopluto-meta-item">Fallback: <strong>${esc(result.market_fallback_level)}</strong></span>` : ''}
        </div>
        ${result.reason ? `<div class="autopluto-reason">${esc(result.reason)}</div>` : ''}
        ${warningHtml}
      </div>
      <div class="autopluto-card-footer">
        <button class="autopluto-refresh-btn">↻ Refresh</button>
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
      <div class="autopluto-card-header autopluto-popover-header">
        <span class="autopluto-card-title">⚠ ${esc(title)}</span>
        <button class="autopluto-card-close autopluto-close-btn" title="Close">✕</button>
      </div>
      <div class="autopluto-card-body">
        <p class="autopluto-error-msg">${esc(detail)}</p>
        ${detailExtra}
        ${copyPayload ? '<button class="autopluto-copy-payload-btn">Copy payload</button>' : ''}
      </div>
    `;
    card.querySelector('.autopluto-card-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeActivePopover();
    });
    if (copyPayload) {
      card.querySelector('.autopluto-copy-payload-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(copyPayload).then(() => {
          e.target.textContent = 'Copied ✓';
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
