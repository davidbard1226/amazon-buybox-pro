/* Amazon BuyBox Pro — popup logic */
'use strict';

const STORE_KEY = 'bbp_amazon_scan';

function $(id) { return document.getElementById(id); }

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
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

$('parseBtn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'BBP_PARSE_PAGE' });
    if (res && res.ok) {
      $('scanState').textContent = '✓ parsed ' + res.scanned + ' rows';
      $('scanState').className = 'val green';
    } else {
      $('scanState').textContent = '✗ no pricing table on this page';
      $('scanState').className = 'val red';
    }
  } catch (e) {
    $('scanState').textContent = '✗ open Manage Pricing first';
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