/* Amazon BuyBox Pro — popup logic */
'use strict';

const STORE_KEY = 'bbp_amazon_scan';
const DIAG_KEY = 'bbp_amazon_diag';

function $(id) { return document.getElementById(id); }

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

function showDiag() {
  chrome.storage.local.get(DIAG_KEY, (res) => {
    const arr = (res[DIAG_KEY] || []).slice(-8).reverse();
    const el = $('diag');
    if (arr.length === 0) {
      el.textContent = '— no diagnostics yet —';
      return;
    }
    el.innerHTML = arr.map((d) => {
      const t = new Date(d.t).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return '<div>[' + t + '] ' + d.msg.replace(/</g, '&lt;') + '</div>';
    }).join('');
  });
}

// Write the PROBE diagnostics line from the probe response itself — avoids the
// race where the content script's async storage write lands after showDiag reads.
// Renders directly into the popup (no storage dependency) AND persists for the dashboard.
function writeProbeDiag(probe) {
  if (!probe) return;
  const d = probe.dump || {};
  const msg = 'PROBE: title="' + (d.title || probe.title) + '" url=' + probe.url +
    ' tables=' + (d.tables ? d.tables.length : 0) +
    ' grids=' + (d.grids ? d.grids.length : 0) +
    ' clsHits={' + Object.keys(d.clsHits || {}).map((k) => k + ':' + d.clsHits[k]).join(',') + '}' +
    ' priceEls=[' + ((d.priceEls || []).join(' | ')) + ']' +
    ' skuAsinEls=[' + ((d.skuAsinEls || []).join(' | ')) + ']' +
    ' mpContext=' + (d.mpContext || 'none') +
    ' keywords=[' + ((d.keywords || []).join(',')) + ']' +
    (d.tables && d.tables.length ? ' firstTableHeaders="' + d.tables[0].headers + '"' : '') +
    (d.cardHtml ? ' cardHtml="' + d.cardHtml.replace(/"/g, "'") + '"' : '') +
    (d.priceInputs && d.priceInputs.length ? ' priceInputs=[' + d.priceInputs.join(' | ') + ']' : '') +
    ' bodySample="' + (d.bodySample || '') + '"';
  // Render directly — guaranteed visible even if storage is unavailable
  const t = new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const el = $('diag');
  el.innerHTML = '<div style="color:#f59e0b">[' + t + '] ' + msg.replace(/</g, '&lt;') + '</div>' + el.innerHTML;
  // Persist for the dashboard diagnostics panel
  chrome.storage.local.get(DIAG_KEY, (res) => {
    const arr = (res[DIAG_KEY] || []).slice(-50);
    arr.push({ t: new Date().toISOString(), msg: msg, url: probe.url });
    chrome.storage.local.set({ [DIAG_KEY]: arr });
  });
}

async function findSellerTab() {
  // Prefer the ACTIVE tab if it's Seller Central, else the first match
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active[0] && /sellercentral\.amazon\.co\.za/.test(active[0].url || '')) return active[0];
  const tabs = await chrome.tabs.query({ url: 'https://sellercentral.amazon.co.za/*' });
  return tabs.length > 0 ? tabs[0] : null;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function probeTab(tab) {
  // Seller Central is an SPA — the URL does NOT change on navigation, so we
  // probe the page CONTENT for the pricing table. Try the content script
  // first; only inject if it's missing (avoids re-injecting every 2s).
  if (!tab || !tab.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'BBP_PROBE' });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-seller.js'] });
      await sleep(600);
      return await chrome.tabs.sendMessage(tab.id, { type: 'BBP_PROBE' });
    } catch (e2) {
      return null;
    }
  }
}

function refresh() {
  chrome.storage.local.get([STORE_KEY, 'bbp_amazon_scan_state', 'bbp_amazon_scan_interval'], (res) => {
    const scan = res[STORE_KEY] || null;
    const state = res.bbp_amazon_scan_state || { running: false };
    const interval = parseInt(res.bbp_amazon_scan_interval, 10) || 0;

    $('productCount').textContent = scan ? scan.scanned : '0';
    $('lastScan').textContent = scan ? fmtTime(scan.lastScan) : '—';
    $('pageInfo').textContent = scan ? (scan.page ? 'page ' + scan.page + (scan.totalPages ? ' / ' + scan.totalPages : '') : '—') : '—';

    if (state.running) {
      $('scanState').textContent = '▶ running (page ' + (state.page || 1) + ')';
      $('scanState').className = 'val orange';
      $('scanBtn').style.display = 'none';
      $('stopBtn').style.display = 'block';
    } else {
      $('scanState').textContent = 'idle';
      $('scanState').className = 'val green';
      $('scanBtn').style.display = 'block';
      $('stopBtn').style.display = 'none';
    }

    $('intervalSel').value = String(interval);
  });

  // Content-based tab hint (SPA-safe)
  findSellerTab().then(async (tab) => {
    if (!tab) {
      $('tabHint').textContent = '⚠ No Seller Central tab open — click "Open Seller Central" below.';
      $('tabHint').style.color = '#ff4d6d';
      return;
    }
    const probe = await probeTab(tab);
    if (probe && probe.hasTable) {
      $('tabHint').textContent = '✓ Pricing table found — ' + probe.rows + ' rows, headers: ' + (probe.headers || '?') + '. Ready to scan!';
      $('tabHint').style.color = '#00e5a0';
    } else if (probe) {
      const d = probe.dump || {};
      let tbl = ' no tables on page';
      if (d.tables && d.tables.length) tbl = ' tables: ' + d.tables.map((t) => '[' + t.headers + ']').join(' ');
      else if (d.grids && d.grids.length) tbl = ' grid(s): ' + d.grids.map((g) => '[' + g.role + ' rows=' + g.rows + ' cells=' + g.cells + ']').join(' ');
      const isInv = /myinventory\/inventory/.test(probe.url);
      if (isInv) {
        const nPrice = (d.clsHits && d.clsHits.price) || 0;
        $('tabHint').textContent = '✓ On Manage All Inventory — card layout (' + nPrice + ' price elements). Parser targets this page.';
        $('tabHint').style.color = '#00e5a0';
      } else {
        $('tabHint').textContent = '⚠ On Seller Central but NO pricing table (' + (d.title || probe.title) + ') @ ' + probe.url + '.' + tbl + ' Open Products → Manage All Inventory (the page with all products + prices).';
        $('tabHint').style.color = '#ff9500';
      }
    } else {
      $('tabHint').textContent = '⚠ Cannot reach the Seller Central tab — reload it (F5) and try again.';
      $('tabHint').style.color = '#ff4d6d';
    }
    writeProbeDiag(probe); // writes the PROBE line + re-reads diagnostics
  });

  showDiag();
}

$('scanBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'BBP_START_SCAN' }, () => {
    setTimeout(refresh, 500);
  });
});

$('stopBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'BBP_STOP_SCAN' }, () => {
    setTimeout(refresh, 500);
  });
});

$('openPricingBtn').addEventListener('click', () => {
  // co.za has no /pricing/managepricing — the pricing data lives on the
  // Manage All Inventory page (all products with price / featured offer /
  // competitive price / lowest price).
  chrome.tabs.create({ url: 'https://sellercentral.amazon.co.za/myinventory/inventory?fulfilledBy=all&page=1&pageSize=100&sort=date_created_desc&status=all' });
});

$('parseBtn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id) {
    $('scanState').textContent = '✗ no active tab';
    $('scanState').className = 'val red';
    return;
  }
  // Try the content script first; if not injected (page opened before the
  // extension loaded), inject it on the fly.
  let res = null;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'BBP_PARSE_PAGE' });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-seller.js'] });
      await new Promise((r) => setTimeout(r, 1200));
      res = await chrome.tabs.sendMessage(tab.id, { type: 'BBP_PARSE_PAGE' });
    } catch (e2) {
      $('scanState').textContent = '✗ cannot reach this page (not sellercentral?)';
      $('scanState').className = 'val red';
      setTimeout(refresh, 800);
      return;
    }
  }
  if (res && res.ok) {
    $('scanState').textContent = '✓ parsed ' + res.scanned + ' rows';
    $('scanState').className = 'val green';
  } else {
    $('scanState').textContent = '✗ no pricing table on this page';
    $('scanState').className = 'val red';
  }
  setTimeout(refresh, 800);
});

$('intervalSel').addEventListener('change', () => {
  const mins = parseInt($('intervalSel').value, 10) || 0;
  chrome.storage.local.set({ bbp_amazon_scan_interval: mins });
  if (mins > 0) {
    chrome.alarms.create('bbp_amazon_periodic_scan', { periodInMinutes: mins });
  } else {
    chrome.alarms.clear('bbp_amazon_periodic_scan');
  }
});

$('copyDiagBtn').addEventListener('click', () => {
  chrome.storage.local.get(DIAG_KEY, (res) => {
    const arr = (res[DIAG_KEY] || []).slice(-50);
    const text = arr.map((d) => '[' + d.t + '] ' + d.msg).join('\n');
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    $('copyDiagBtn').textContent = ok ? '✓ copied' : '✗ copy failed';
    setTimeout(() => { $('copyDiagBtn').textContent = '📋 Copy diagnostics'; }, 1500);
  });
});

refresh();
setInterval(refresh, 2000);

// Show the extension version so we can verify which code is running
$('ver').textContent = 'v' + chrome.runtime.getManifest().version;