/* ════════════════════════════════════════════════════════════
   Amazon BuyBox Pro — dashboard bridge
   Injected into the dashboard page (file:// or GitHub Pages).
   Exposes window.__bbpBridge so the dashboard can read the
   scan data stored in chrome.storage by content-seller.js.
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var STORE_KEY = 'bbp_amazon_scan';

  function getProducts() {
    return new Promise(function (resolve, reject) {
      try {
        chrome.storage.local.get(STORE_KEY, function (res) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          var scan = res[STORE_KEY] || null;
          resolve({
            products: (scan && scan.products) || [],
            lastScan: (scan && scan.lastScan) || null,
            stats: scan ? { scanned: scan.scanned, page: scan.page, totalPages: scan.totalPages } : null
          });
        });
      } catch (e) { reject(e); }
    });
  }

  function getScanState() {
    return new Promise(function (resolve, reject) {
      try {
        chrome.storage.local.get(STORE_KEY, function (res) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          var scan = res[STORE_KEY] || null;
          resolve(scan ? { page: scan.page, totalPages: scan.totalPages, scanned: scan.scanned, lastScan: scan.lastScan, hasNext: scan.hasNext } : null);
        });
      } catch (e) { reject(e); }
    });
  }

  function startScan() {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage({ type: 'BBP_START_SCAN' }, function (res) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(res || { started: true });
        });
      } catch (e) { reject(e); }
    });
  }

  function stopScan() {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage({ type: 'BBP_STOP_SCAN' }, function (res) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(res || { stopped: true });
        });
      } catch (e) { reject(e); }
    });
  }

  window.__bbpBridge = {
    getProducts: getProducts,
    getScanState: getScanState,
    startScan: startScan,
    stopScan: stopScan
  };

  // Announce presence to the page
  window.dispatchEvent(new CustomEvent('bbpBridgeReady', { detail: { version: '0.1.0' } }));
})();