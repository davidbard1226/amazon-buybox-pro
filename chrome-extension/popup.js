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
  const tabs = await chrome.tabs.query({ url: 'https://sellercentral.amazon.co.za/*' });
  return tabs.length > 0 ? tabs[0] : null;
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

  // Tab hint
  findSellerTab().then((tab) => {
    $('tabHint').textContent = tab
      ? '✓ Seller Central tab found: ' + tab.url.replace('https://sellercentral.amazon.co.za', '')
      : '⚠ No Seller Central tab open — click "Open Manage Pricing" below.';
    $('tabHint').style.color = tab ? '#00e5a0' : '#ff4d6d';
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
  chrome.tabs.create({ url: 'https://sellercentral.amazon.co.za/pricing/managepricing' });
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