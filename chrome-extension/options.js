/* global document, chrome */
'use strict';

const DEFAULTS = {
  apiBaseUrl: '',
  apiEndpoint: '/v1/predict',
  apiKey: '',
  requestTimeout: 15000,
  defaultSource: 'openlane',
  defaultSection: 'simulcast',
  debugMode: false,
  showCopyButtons: true,
  batchEnabled: false,
};

// ─── DOM refs ────────────────────────────────────────────────────────────────

const fields = {
  apiBaseUrl:      document.getElementById('apiBaseUrl'),
  apiEndpoint:     document.getElementById('apiEndpoint'),
  apiKey:          document.getElementById('apiKey'),
  requestTimeout:  document.getElementById('requestTimeout'),
  defaultSource:   document.getElementById('defaultSource'),
  defaultSection:  document.getElementById('defaultSection'),
  debugMode:       document.getElementById('debugMode'),
  showCopyButtons: document.getElementById('showCopyButtons'),
  batchEnabled:    document.getElementById('batchEnabled'),
};

const btnSave   = document.getElementById('btnSave');
const btnReset  = document.getElementById('btnReset');
const btnTest   = document.getElementById('btnTest');
const statusMsg = document.getElementById('statusMsg');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showStatus(msg, type = 'success') {
  statusMsg.textContent = msg;
  statusMsg.className = `status ${type}`;
  setTimeout(() => { statusMsg.className = 'status'; }, 4000);
}

function readForm() {
  return {
    apiBaseUrl:      fields.apiBaseUrl.value.trim().replace(/\/$/, ''),
    apiEndpoint:     fields.apiEndpoint.value.trim() || '/v1/predict',
    apiKey:          fields.apiKey.value.trim(),
    requestTimeout:  parseInt(fields.requestTimeout.value, 10) || 15000,
    defaultSource:   fields.defaultSource.value.trim() || 'openlane',
    defaultSection:  fields.defaultSection.value.trim() || 'simulcast',
    debugMode:       fields.debugMode.checked,
    showCopyButtons: fields.showCopyButtons.checked,
    batchEnabled:    fields.batchEnabled.checked,
  };
}

function populateForm(settings) {
  fields.apiBaseUrl.value      = settings.apiBaseUrl      ?? DEFAULTS.apiBaseUrl;
  fields.apiEndpoint.value     = settings.apiEndpoint     ?? DEFAULTS.apiEndpoint;
  fields.apiKey.value          = settings.apiKey          ?? DEFAULTS.apiKey;
  fields.requestTimeout.value  = settings.requestTimeout  ?? DEFAULTS.requestTimeout;
  fields.defaultSource.value   = settings.defaultSource   ?? DEFAULTS.defaultSource;
  fields.defaultSection.value  = settings.defaultSection  ?? DEFAULTS.defaultSection;
  fields.debugMode.checked     = settings.debugMode       ?? DEFAULTS.debugMode;
  fields.showCopyButtons.checked = settings.showCopyButtons ?? DEFAULTS.showCopyButtons;
  fields.batchEnabled.checked  = settings.batchEnabled    ?? DEFAULTS.batchEnabled;
}

// ─── Load saved settings on open ─────────────────────────────────────────────

chrome.storage.sync.get(DEFAULTS, (stored) => {
  populateForm(stored);
});

// ─── Save ────────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', () => {
  const data = readForm();

  // Basic validation
  if (!data.apiBaseUrl) {
    fields.apiBaseUrl.classList.add('error');
    showStatus('API Base URL is required.', 'error');
    return;
  }
  fields.apiBaseUrl.classList.remove('error');

  if (data.requestTimeout < 1000 || data.requestTimeout > 60000) {
    fields.requestTimeout.classList.add('error');
    showStatus('Timeout must be between 1000 and 60000 ms.', 'error');
    return;
  }
  fields.requestTimeout.classList.remove('error');

  chrome.storage.sync.set(data, () => {
    if (chrome.runtime.lastError) {
      showStatus('Failed to save: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showStatus('Settings saved successfully.');
    }
  });
});

// ─── Reset ───────────────────────────────────────────────────────────────────

btnReset.addEventListener('click', () => {
  if (!confirm('Reset all settings to defaults?')) return;
  chrome.storage.sync.set(DEFAULTS, () => {
    populateForm(DEFAULTS);
    showStatus('Settings reset to defaults.');
  });
});

// ─── Test Connection ─────────────────────────────────────────────────────────

btnTest.addEventListener('click', async () => {
  const data = readForm();

  if (!data.apiBaseUrl) {
    showStatus('Enter an API Base URL first.', 'error');
    return;
  }

  btnTest.disabled = true;
  btnTest.textContent = 'Testing…';
  hideDebugPanel();

  const url = data.apiBaseUrl + data.apiEndpoint;
  const headers = { 'Content-Type': 'application/json' };
  if (data.apiKey) headers['X-API-Key'] = data.apiKey;

  // Minimal valid VehicleInput (matches PredictRequest schema exactly)
  const vehicle = {
    year: 2022,
    make: 'MAZDA',
    model: 'CX-30',
    trim: 'GX',
    mileage: 108050,
    vin: '3MVDMBB7XNM415065',
    cityAuction: 'Halifax',
    source: data.defaultSource || 'openlane',
    section: data.defaultSection || 'simulcast',
    titleFull: '2022 MAZDA CX-30 GX',
    exteriorColor: 'Black',
    sellerName: null,
    engine: null,
    fuelType: null,
    drivetrain: null,
    transmission: null,
    auctionRunTimeAt: null,
  };

  // API requires { "vehicle": { ... } } wrapper
  const requestBody = { vehicle };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), data.requestTimeout);

  let res, json;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timer);
    json = await res.json().catch(() => null);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      showStatus('Connection timed out. Check the URL or increase timeout.', 'error');
    } else {
      showStatus('Connection failed: ' + err.message, 'error');
    }
    btnTest.disabled = false;
    btnTest.textContent = 'Test Connection';
    return;
  }

  // Show result
  if (res.ok) {
    const model = json?.model_version || '—';
    showStatus(`Connection successful (HTTP ${res.status}). Model: ${model}`);
  } else if (res.status === 422 && Array.isArray(json?.detail)) {
    const errors = json.detail.map((e) => {
      const loc = (e.loc || []).slice(1).join(' → ');
      return (loc ? `${loc}: ` : '') + e.msg;
    }).join('\n• ');
    showStatus(`Validation Error (422) – see details below.`, 'error');
    showDebugPanel(url, headers, data.apiKey, requestBody, res.status, json);
  } else {
    showStatus(`Server returned HTTP ${res.status}. Check your URL / key.`, 'error');
    if (json) showDebugPanel(url, headers, data.apiKey, requestBody, res.status, json);
  }

  // Always show debug panel when debug mode is on
  if (data.debugMode && res) {
    showDebugPanel(url, headers, data.apiKey, requestBody, res.status, json);
  }

  btnTest.disabled = false;
  btnTest.textContent = 'Test Connection';
});

// ─── Debug panel helpers ──────────────────────────────────────────────────────

function showDebugPanel(url, headers, apiKey, payload, status, body) {
  const panel  = document.getElementById('debugPanel');
  const output = document.getElementById('debugOutput');
  if (!panel || !output) return;

  const safeHeaders = Object.assign({}, headers);
  if (apiKey) safeHeaders['X-API-Key'] = '[REDACTED]';

  output.textContent = JSON.stringify({
    request: { url, method: 'POST', headers: safeHeaders, body: payload },
    response: { status, body },
  }, null, 2);
  panel.style.display = 'block';
}

function hideDebugPanel() {
  const panel = document.getElementById('debugPanel');
  if (panel) panel.style.display = 'none';
}
