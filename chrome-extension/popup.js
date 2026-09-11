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
  // probe the page CONTENT for the pricing table. Auto-inject the content
  // script first (tabs opened before the extension loaded have no script).
  if (!tab || !tab.id) return null;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-seller.js'] });
  } catch (e) { /* already injected or not injectable */ }
  await sleep(600);
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'BBP_PROBE' });
  } catch (e) {
    return null;
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
      $('tabHint').textContent = '⚠ On Seller Central but NO pricing table on this page (' + probe.title + '). Navigate: Pricing → Manage Pricing (or Inventory → Manage Inventory → Manage Pricing link).';
      $('tabHint').style.color = '#ff9500';
    } else {
      $('tabHint').textContent = '⚠ Cannot reach the Seller Central tab — reload it (F5) and try again.';
      $('tabHint').style.color = '#ff4d6d';
    }
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
  // amazon.co.za doesn't expose /pricing/managepricing directly — open the
  // Seller Central home; the user clicks Pricing → Manage Pricing in the menu.
  chrome.tabs.create({ url: 'https://sellercentral.amazon.co.za/amazonsell/business' });
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

refresh();
setInterval(refresh, 2000);