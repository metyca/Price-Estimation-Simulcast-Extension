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
    const POPOVER_W = 460;
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
        <span class="autopluto-decision-icon">💰</span>
        <div>
          <div class="autopluto-decision-title">No current bid price</div>
          <div class="autopluto-decision-subtitle">Cannot calculate margin to max bid</div>
        </div>
      </div>`;
    }
    if (margin > 1000) {
      return `<div class="autopluto-decision-banner autopluto-decision-banner--good">
        <span class="autopluto-decision-icon">✅</span>
        <div>
          <div class="autopluto-decision-title">Good room to bid</div>
          <div class="autopluto-decision-subtitle">${fmt(margin)} below recommended max bid</div>
        </div>
      </div>`;
    }
    if (margin >= 0) {
      return `<div class="autopluto-decision-banner autopluto-decision-banner--caution">
        <span class="autopluto-decision-icon">⚠️</span>
        <div>
          <div class="autopluto-decision-title">Close to limit</div>
          <div class="autopluto-decision-subtitle">Only ${fmt(margin)} below max bid</div>
        </div>
      </div>`;
    }
    return `<div class="autopluto-decision-banner autopluto-decision-banner--danger">
      <span class="autopluto-decision-icon">🚫</span>
      <div>
        <div class="autopluto-decision-title">Above recommended max</div>
        <div class="autopluto-decision-subtitle">${fmt(Math.abs(margin))} over max bid</div>
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

    return `<div class="autopluto-data-quality">
      <div class="autopluto-data-quality-title">Input Coverage</div>
      <div class="autopluto-data-quality-grid">${fieldHtml}</div>
      ${missingNote}
    </div>`;
  }

  function buildReportNotes(result) {
    const raw = result._raw || {};

    // Use the original reason array; fall back to splitting the joined string
    const reasonArr = Array.isArray(raw.reason)
      ? raw.reason
      : (raw.reason ? raw.reason.split(' · ') : []);

    const apiWarnings = Array.isArray(raw.warnings) ? raw.warnings : [];

    // Build notes from structured metadata + overflow reason items
    const notes = [];

    if (result.comparable_count != null) {
      notes.push(`${result.comparable_count} comparable vehicle${result.comparable_count !== 1 ? 's' : ''} found`);
    }
    if (result.market_fallback_level) {
      notes.push(`Market fallback: ${result.market_fallback_level}`);
    }
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

    let html = `
      <div class="autopluto-report-section">
        <div class="autopluto-section-title">Report Notes</div>
        <ul class="autopluto-report-list">
          ${notes.map((n) => `<li>${esc(n)}</li>`).join('')}
        </ul>
      </div>`;

    if (apiWarnings.length > 0) {
      const warnItems = apiWarnings.map((w) => {
        const text = typeof w === 'string' ? w
          : (w && typeof w === 'object' ? (w.message || w.msg || w.text || JSON.stringify(w)) : String(w));
        return `<li>${esc(text)}</li>`;
      }).join('');
      html += `
        <div class="autopluto-report-section autopluto-report-section--warn">
          <div class="autopluto-section-title autopluto-section-title--warn">API Warnings</div>
          <ul class="autopluto-report-list autopluto-report-list--warn">
            ${warnItems}
          </ul>
        </div>`;
    }

    return html;
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

    const card = document.createElement('div');
    card.className = 'autopluto-card autopluto-popover';
    card.setAttribute('data-autopluto-card', 'true');

    // ── Current price card ───────────────────────────────────────
    const currentPriceCard = hasCurrentPrice ? `
      <div class="autopluto-price-card autopluto-price-card--current">
        <div class="autopluto-price-card-label">Current Bid</div>
        <div class="autopluto-price-card-value">${fmt(currentPrice)}</div>
      </div>` : '';

    // ── Secondary prices sub-grid ────────────────────────────────
    const secondaryPrices = `
      <div class="autopluto-secondary-prices">
        <div class="autopluto-secondary-metric">
          <span class="autopluto-secondary-label">Model Price</span>
          <span class="autopluto-secondary-value">${modelPrice != null ? fmt(modelPrice) : '—'}</span>
        </div>
        <div class="autopluto-secondary-metric">
          <span class="autopluto-secondary-label">Calibrated</span>
          <span class="autopluto-secondary-value">${calibratedPrice != null ? fmt(calibratedPrice) : '—'}</span>
        </div>
        <div class="autopluto-secondary-metric">
          <span class="autopluto-secondary-label">Adjusted</span>
          <span class="autopluto-secondary-value">${adjustedPrice != null ? fmt(adjustedPrice) : '—'}</span>
        </div>
        <div class="autopluto-secondary-metric">
          <span class="autopluto-secondary-label">Comp Median</span>
          <span class="autopluto-secondary-value">${compMedian != null ? fmt(compMedian) : '—'}</span>
        </div>
      </div>`;

    // ── Decision banner ──────────────────────────────────────────
    const decisionHtml = buildDecisionBanner(margin, hasCurrentPrice && rmb != null);

    // ── Expected range ───────────────────────────────────────────
    const rangeHtml = (rangeLow != null || rangeHigh != null) ? `
      <div class="autopluto-range-card">
        <span class="autopluto-range-label">Expected Market Range</span>
        <span class="autopluto-range-value">${rangeLow != null ? fmt(rangeLow) : '?'} — ${rangeHigh != null ? fmt(rangeHigh) : '?'}</span>
      </div>` : '';

    // ── Badge pills ──────────────────────────────────────────────
    let badgesHtml = '';
    if (result.confidence_level) {
      badgesHtml += buildBadgeItem('Confidence', result.confidence_level.replace(/_/g, ' '), getConfidenceColor(result.confidence_level));
    }
    if (result.bid_safety_level) {
      badgesHtml += buildBadgeItem('Safety', result.bid_safety_level.replace(/_/g, ' '), getSafetyColor(result.bid_safety_level));
    }
    if (result.comparable_count != null) {
      badgesHtml += buildBadgeItem('Comps', String(result.comparable_count), result.comparable_count > 0 ? 'blue' : 'gray');
    }
    if (compQuality) {
      const qc = compQuality.toLowerCase();
      const qColor = (qc === 'good' || qc === 'high') ? 'green'
        : (qc === 'unreliable' || qc === 'low') ? 'red' : 'yellow';
      badgesHtml += buildBadgeItem('Quality', compQuality.replace(/_/g, ' '), qColor);
    }
    if (result.market_fallback_level) {
      badgesHtml += buildBadgeItem('Fallback', result.market_fallback_level.replace(/_/g, ' '), getFallbackColor(result.market_fallback_level));
    }
    if (manualReview) {
      badgesHtml += buildBadgeItem('Review', 'Required', 'red');
    }

    // ── Manual review warning box ────────────────────────────────
    const manualReviewHtml = manualReview ? `
      <div class="autopluto-manual-review-box">
        <span class="autopluto-manual-review-icon">⚠</span>
        <div>
          <div class="autopluto-manual-review-title">Manual Review Required</div>
          <div class="autopluto-manual-review-sub">Do not rely on this estimate without additional review.</div>
        </div>
      </div>` : '';

    // ── General warnings ─────────────────────────────────────────
    let warningHtml = '';
    if (bidGtEmp) {
      warningHtml += `<div class="autopluto-warning-banner">⚠ Recommended max bid exceeds estimated market price. Review before bidding.</div>`;
    }
    if (!vehicleData.vin) {
      warningHtml += `<div class="autopluto-warning-banner">⚠ VIN not detected — estimate may be less accurate.</div>`;
    }

    // ── Header badges ────────────────────────────────────────────
    const modelBadge = result.model_version
      ? `<span class="autopluto-badge-model">${esc(result.model_version)}</span>` : '';
    const calibBadge = result.calibration_version
      ? `<span class="autopluto-badge-calib">${esc(result.calibration_version)}</span>` : '';

    // ── Vehicle identity tags ────────────────────────────────────
    const cityTag   = vehicleData.cityAuction
      ? `<span class="autopluto-identity-tag">📍 ${esc(vehicleData.cityAuction)}</span>` : '';
    const sellerTag = vehicleData.sellerName
      ? `<span class="autopluto-identity-tag">🏢 ${esc(vehicleData.sellerName)}</span>` : '';
    const trimTag   = vehicleData.trim
      ? `<span class="autopluto-identity-tag">✦ ${esc(vehicleData.trim)}</span>` : '';

    // ── Adjustment details accordion ─────────────────────────────
    const adjustItems = [];
    if (riskPct     != null) adjustItems.push({ label: 'Risk Adjustment',    value: `${riskPct}%` });
    if (discountPct != null) adjustItems.push({ label: 'Effective Discount',  value: `${discountPct}%` });
    if (blendReason)         adjustItems.push({ label: 'Blend Reason',        value: blendReason.replace(/_/g, ' ') });
    if (blendWeight != null) adjustItems.push({ label: 'Model Blend',         value: `${(blendWeight * 100).toFixed(0)}%` });

    const adjustHtml = (adjustItems.length > 0 || riskReasons.length > 0) ? `
      <div class="autopluto-debug-panel">
        <button class="autopluto-debug-toggle">
          <span>Adjustment Details</span>
          <span class="autopluto-debug-arrow">▶</span>
        </button>
        <div class="autopluto-debug-content">
          <div class="autopluto-adjust-grid">
            ${adjustItems.map((i) => `
              <div class="autopluto-adjust-item">
                <span class="autopluto-adjust-label">${esc(i.label)}</span>
                <span class="autopluto-adjust-value">${esc(i.value)}</span>
              </div>`).join('')}
          </div>
          ${riskReasons.length > 0 ? `
            <div class="autopluto-adjust-reasons-title">Risk Adjustment Reasons</div>
            <ul class="autopluto-report-list autopluto-report-list--muted">
              ${riskReasons.map((r) => `<li>${esc(typeof r === 'string' ? r : JSON.stringify(r))}</li>`).join('')}
            </ul>` : ''}
        </div>
      </div>` : '';

    // ── Debug payload ────────────────────────────────────────────
    const debugPayload = JSON.stringify({ vehicle: vehicleData, result: result._raw }, null, 2);

    card.innerHTML = `
      <div class="autopluto-card-header">
        <div class="autopluto-header-top">
          <div class="autopluto-header-title-group">
            <div class="autopluto-card-title">${esc(vehicleData.titleFull || 'Vehicle')}</div>
            <div class="autopluto-header-badges">
              <span class="autopluto-badge-ai">Estimate Report</span>
              ${modelBadge}${calibBadge}
            </div>
          </div>
          <button class="autopluto-card-close" title="Close">✕</button>
        </div>
        <div class="autopluto-header-meta">
          ${vehicleData.vin
            ? `<span class="autopluto-card-vin">VIN: ${esc(vehicleData.vin)}</span>`
            : '<span class="autopluto-card-vin autopluto-vin-missing">VIN: not detected</span>'}
          ${vehicleData.mileage ? `<span class="autopluto-mileage-tag">◎ ${fmtNum(vehicleData.mileage)}</span>` : ''}
          ${cityTag}${sellerTag}${trimTag}
        </div>
      </div>

      <div class="autopluto-card-body">

        <div class="autopluto-price-grid">
          <div class="autopluto-price-card autopluto-price-card--market">
            <div class="autopluto-price-card-label">Est. Market Price</div>
            <div class="autopluto-price-card-value">${fmt(emp)}</div>
          </div>
          <div class="autopluto-price-card autopluto-price-card--main">
            <div class="autopluto-price-card-label">Rec. Max Bid</div>
            <div class="autopluto-price-card-value">${fmt(rmb)}</div>
          </div>
          ${currentPriceCard}
        </div>

        ${secondaryPrices}

        ${decisionHtml}

        ${rangeHtml}

        ${badgesHtml ? `<div class="autopluto-badges-section">${badgesHtml}</div>` : ''}

        ${manualReviewHtml}

        ${warningHtml}

        ${buildReportNotes(result)}

        ${adjustHtml}

        ${buildDataQuality(vehicleData)}

        <div class="autopluto-debug-panel">
          <button class="autopluto-debug-toggle">
            <span>⌥ Debug Details</span>
            <span class="autopluto-debug-arrow">▶</span>
          </button>
          <div class="autopluto-debug-content">
            <pre class="autopluto-debug-pre">${esc(debugPayload)}</pre>
          </div>
        </div>

      </div>

      <div class="autopluto-card-footer">
        <button class="autopluto-footer-btn autopluto-footer-btn--primary autopluto-refresh-btn">↻ Refresh</button>
        <button class="autopluto-footer-btn autopluto-footer-btn--secondary autopluto-copy-result-btn">⎘ Copy Result</button>
      </div>
    `;

    // ── Close ─────────────────────────────────────────────────────
    card.querySelector('.autopluto-card-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeActivePopover();
    });

    // ── All accordion toggles (debug + adjustment) ────────────────
    card.querySelectorAll('.autopluto-debug-toggle').forEach((toggle) => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel   = toggle.closest('.autopluto-debug-panel');
        const content = panel && panel.querySelector('.autopluto-debug-content');
        const arrow   = panel && panel.querySelector('.autopluto-debug-arrow');
        if (content) {
          const open = content.classList.toggle('autopluto-debug-open');
          if (arrow) arrow.textContent = open ? '▼' : '▶';
          positionPopover(card, rowEl);
        }
      });
    });

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
        setTimeout(() => { btn.textContent = '⎘ Copy Result'; }, 2000);
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
