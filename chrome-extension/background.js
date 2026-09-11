/* ════════════════════════════════════════════════════════════
   Amazon BuyBox Pro — background service worker
   Orchestrates the Manage Pricing auto-scan: finds the Seller
   Central tab, parses each page, clicks Next, repeats until done.
   ════════════════════════════════════════════════════════════ */

'use strict';

const SELLER_URLS = ['https://sellercentral.amazon.co.za/amazonsell/business'];
const MAX_PAGES = 40;          // 3000 SKUs @ 100/page = 30 pages; headroom for 4000
const PAGE_DELAY_MS = 3000;    // let the SPA render between pages

let scanState = { running: false, page: 0, totalPages: null, scanned: 0, startedAt: null, stopRequested: false };

function saveScanState() {
  chrome.storage.local.set({ bbp_amazon_scan_state: scanState });
}

async function findOrOpenSellerTab() {
  // Prefer the ACTIVE tab if it's Seller Central — the user may be sitting on
  // the Manage Pricing page while an older home-page tab also exists.
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active[0] && /sellercentral\.amazon\.co\.za/.test(active[0].url || '')) return active[0];
  const tabs = await chrome.tabs.query({ url: 'https://sellercentral.amazon.co.za/*' });
  if (tabs.length > 0) return tabs[0];
  // Try to open the Seller Central home (user may need to log in)
  const tab = await chrome.tabs.create({ url: SELLER_URLS[0], active: false });
  return tab;
}

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    return null; // content script not ready / not on pricing page
  }
}

async function runScan() {
  if (scanState.running) return { started: false, reason: 'already-running' };
  scanState = { running: true, page: 0, totalPages: null, scanned: 0, startedAt: new Date().toISOString(), stopRequested: false };
  saveScanState();

  try {
    const tab = await findOrOpenSellerTab();
    if (!tab || tab.id == null) {
      scanState.running = false;
      saveScanState();
      return { started: false, reason: 'no-tab' };
    }

    // Give the page a moment to load / render
    await sleep(2500);

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (scanState.stopRequested) break;
      scanState.page = page;
      saveScanState();

      const result = await sendToTab(tab.id, { type: 'BBP_PARSE_PAGE' });
      if (!result || !result.ok) {
        // Content script may not be injected — try injecting it
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-seller.js'] });
          await sleep(1500);
          const retry = await sendToTab(tab.id, { type: 'BBP_PARSE_PAGE' });
          if (!retry || !retry.ok) {
            scanState.running = false;
            saveScanState();
            return { started: true, stopped: true, reason: 'parse-failed', detail: retry };
          }
        } catch (e) {
          scanState.running = false;
          saveScanState();
          return { started: true, stopped: true, reason: 'inject-failed', detail: String(e) };
        }
      }

      scanState.scanned = (result && result.scanned) || 0;
      scanState.totalPages = (result && result.totalPages) || null;
      saveScanState();

      // Last page?
      const hasNext = result && result.hasNext;
      if (!hasNext || page >= MAX_PAGES) break;

      // Click Next and wait for the table to re-render
      const click = await sendToTab(tab.id, { type: 'BBP_CLICK_NEXT' });
      if (!click || !click.clicked) {
        scanState.running = false;
        saveScanState();
        return { started: true, stopped: true, reason: 'no-next-button' };
      }
      await sleep(PAGE_DELAY_MS);
    }

    scanState.running = false;
    saveScanState();
    return { started: true, done: true, pages: scanState.page, scanned: scanState.scanned };
  } catch (e) {
    scanState.running = false;
    saveScanState();
    return { started: true, stopped: true, reason: 'error', detail: String(e) };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'BBP_START_SCAN') {
    runScan().then(sendResponse);
    return true; // async
  }
  if (msg && msg.type === 'BBP_STOP_SCAN') {
    scanState.stopRequested = true;
    sendResponse({ stopped: true });
    return true;
  }
  if (msg && msg.type === 'BBP_SCAN_STATE') {
    sendResponse(scanState);
    return true;
  }
});

// Optional periodic scan — interval (minutes) stored in chrome.storage.
// 0 or unset = off. Set from the popup.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bbp_amazon_periodic_scan') {
    runScan();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('bbp_amazon_scan_interval', (res) => {
    const mins = parseInt(res.bbp_amazon_scan_interval, 10) || 0;
    if (mins > 0) {
      chrome.alarms.create('bbp_amazon_periodic_scan', { periodInMinutes: mins });
    }
  });
});