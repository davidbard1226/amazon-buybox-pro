/* ════════════════════════════════════════════════════════════
   Amazon BuyBox Pro — Seller Central content script
   Parses the Manage Pricing page (your own account data) and
   stores per-SKU buybox info to chrome.storage.local.

   Works on: sellercentral.amazon.co.za/pricing/managepricing
   (and .com for testing). Robust header-based table parsing with
   a diagnostics log so selectors can be tuned per marketplace.
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var STORE_KEY = 'bbp_amazon_scan';
  var DIAG_KEY = 'bbp_amazon_diag';

  function logDiag(msg) {
    try {
      chrome.storage.local.get(DIAG_KEY, function (res) {
        var arr = (res[DIAG_KEY] || []).slice(-50);
        arr.push({ t: new Date().toISOString(), msg: msg, url: location.href });
        var obj = {};
        obj[DIAG_KEY] = arr;
        chrome.storage.local.set(obj);
      });
    } catch (e) { /* storage unavailable */ }
  }

  /* ── price parsing ──────────────────────────────────────── */
  // Handles "R 1,234.56", "R1,234.56", "1 234,56", "1234.56"
  function parsePrice(raw) {
    if (raw == null) return null;
    var s = String(raw).replace(/[^\d.,]/g, '').trim();
    if (!s) return null;
    var hasComma = s.indexOf(',') !== -1;
    var hasDot = s.indexOf('.') !== -1;
    if (hasComma && hasDot) {
      // US style: comma before dot = thousands sep
      if (s.indexOf(',') < s.indexOf('.')) s = s.replace(/,/g, '');
      else s = s.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
      // ZA uses comma as thousands separator ("1,234") — treat as thousands
      s = s.replace(/,/g, '');
    }
    var v = parseFloat(s);
    return isNaN(v) ? null : v;
  }

  /* ── DOM helpers ────────────────────────────────────────── */
  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function findPricingTable() {
    // Prefer the known pricing table id, else scan all tables for a
    // header containing SKU / ASIN.
    var byId = document.getElementById('pricing-table');
    if (byId) return byId;
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var ths = tables[i].querySelectorAll('thead th, thead td');
      var txt = '';
      for (var j = 0; j < ths.length; j++) txt += ' ' + norm(ths[j].textContent);
      if (txt.indexOf('sku') !== -1 || txt.indexOf('asin') !== -1) return tables[i];
    }
    return null;
  }

  function getHeaderMap(table) {
    var thead = table.querySelector('thead');
    if (!thead) return null;
    var cells = thead.querySelectorAll('th, td');
    var map = {};
    for (var i = 0; i < cells.length; i++) {
      var t = norm(cells[i].textContent);
      if (!t) continue;
      if (t === 'sku' || t.indexOf('sku') === 0) map.sku = i;
      else if (t === 'asin' || t.indexOf('asin') === 0) map.asin = i;
      else if (t.indexOf('product name') !== -1 || t.indexOf('title') !== -1) map.title = i;
      else if (t.indexOf('your price') !== -1) map.yourPrice = i;
      else if (t.indexOf('buy box price') !== -1 || t.indexOf('buybox price') !== -1) map.buyboxPrice = i;
      else if (t.indexOf('lowest price') !== -1) map.lowestPrice = i;
      else if (t === 'buy box' || t.indexOf('buy box') === 0 || t === 'buybox') map.buybox = i;
      else if (t === 'status' || t.indexOf('status') === 0) map.status = i;
      else if (t.indexOf('condition') !== -1) map.condition = i;
      else if (t.indexOf('quantity') !== -1) map.quantity = i;
      else if (t.indexOf('fulfillment') !== -1) map.fulfillment = i;
    }
    return map;
  }

  function getBodyRows(table) {
    var tbody = table.querySelector('tbody');
    if (tbody) return Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    // Fallback: rows after thead
    var rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    var thead = table.querySelector('thead');
    if (thead) {
      var headRow = thead.querySelector('tr');
      if (headRow) rows = rows.filter(function (r) { return r !== headRow; });
    }
    return rows;
  }

  function cellText(row, idx) {
    var cells = row.querySelectorAll('td, th');
    if (idx >= cells.length) return '';
    return cells[idx].textContent;
  }

  function cellHtml(row, idx) {
    var cells = row.querySelectorAll('td, th');
    if (idx >= cells.length) return '';
    return cells[idx].innerHTML;
  }

  function parseBuyboxStatus(row, map) {
    // Buy Box column: "You" / "Other" / "No Buy Box" (sometimes with links)
    var bb = map.buybox != null ? norm(cellText(row, map.buybox)) : '';
    if (bb.indexOf('you') !== -1 && bb.indexOf('no buy box') === -1) return 'win';
    if (bb.indexOf('other') !== -1 || (bb.indexOf('buy box') !== -1 && bb.indexOf('no') === -1)) return 'lose';
    if (bb.indexOf('no buy box') !== -1) return 'none';
    // Fallback: Status column
    var st = map.status != null ? norm(cellText(row, map.status)) : '';
    if (st.indexOf('win') !== -1 || st.indexOf('you') !== -1) return 'win';
    if (st.indexOf('lose') !== -1 || st.indexOf('other') !== -1) return 'lose';
    if (st.indexOf('no buy box') !== -1 || st.indexOf('none') !== -1) return 'none';
    return null;
  }

  /* ── main parse ─────────────────────────────────────────── */
  function parsePage() {
    var table = findPricingTable();
    if (!table) {
      logDiag('No pricing table found on ' + location.href);
      return { ok: false, reason: 'no-table' };
    }
    var map = getHeaderMap(table);
    if (!map || (map.sku == null && map.asin == null)) {
      logDiag('Pricing table found but headers not recognized');
      return { ok: false, reason: 'no-headers' };
    }

    var rows = getBodyRows(table);
    var products = [];
    var skipped = 0;
    rows.forEach(function (row) {
      var sku = map.sku != null ? String(cellText(row, map.sku)).trim() : '';
      var asin = map.asin != null ? String(cellText(row, map.asin)).trim().toUpperCase() : '';
      if (!sku && !asin) { skipped++; return; }
      var title = map.title != null ? String(cellText(row, map.title)).trim() : '';
      var yourPrice = map.yourPrice != null ? parsePrice(cellText(row, map.yourPrice)) : null;
      var buyboxPrice = map.buyboxPrice != null ? parsePrice(cellText(row, map.buyboxPrice)) : null;
      var lowestPrice = map.lowestPrice != null ? parsePrice(cellText(row, map.lowestPrice)) : null;
      var status = parseBuyboxStatus(row, map);
      if (!status) status = 'none';
      products.push({
        sku: sku, asin: asin, title: title,
        yourPrice: yourPrice, buyboxPrice: buyboxPrice, lowestPrice: lowestPrice,
        status: status, updatedAt: new Date().toISOString()
      });
    });

    // Pagination info
    var pageInfo = getPaginationInfo();

    var result = {
      ok: true,
      products: products,
      scanned: products.length,
      skipped: skipped,
      page: pageInfo.page,
      totalPages: pageInfo.totalPages,
      hasNext: pageInfo.hasNext,
      lastScan: new Date().toISOString(),
      url: location.href
    };

    // Merge into stored scan (keep previous pages' products)
    chrome.storage.local.get(STORE_KEY, function (res) {
      var prev = (res[STORE_KEY] && res[STORE_KEY].products) || [];
      var byKey = {};
      prev.forEach(function (p) {
        var k = (p.sku || p.asin || '').toUpperCase();
        if (k) byKey[k] = p;
      });
      products.forEach(function (p) {
        var k = (p.sku || p.asin || '').toUpperCase();
        if (k) byKey[k] = p;
      });
      var merged = Object.keys(byKey).map(function (k) { return byKey[k]; });
      var store = {
        products: merged,
        scanned: merged.length,
        lastScan: new Date().toISOString(),
        page: pageInfo.page,
        totalPages: pageInfo.totalPages,
        hasNext: pageInfo.hasNext,
        url: location.href
      };
      var obj = {};
      obj[STORE_KEY] = store;
      chrome.storage.local.set(obj);
      logDiag('Parsed page ' + (pageInfo.page || '?') + ': ' + products.length + ' rows, ' + merged.length + ' total stored');
    });

    return result;
  }

  function getPaginationInfo() {
    var info = { page: 1, totalPages: null, hasNext: false };
    // Common Amazon pagination: .a-pagination with .a-last / .a-selected
    var pag = document.querySelector('.a-pagination');
    if (pag) {
      var sel = pag.querySelector('.a-selected');
      if (sel) info.page = parseInt(sel.textContent, 10) || 1;
      var last = pag.querySelector('.a-last a, .a-last button');
      info.hasNext = !!last;
      var items = pag.querySelectorAll('li');
      var maxPage = 1;
      items.forEach(function (li) {
        var n = parseInt(li.textContent, 10);
        if (!isNaN(n) && n > maxPage) maxPage = n;
      });
      if (maxPage > 1) info.totalPages = maxPage;
    }
    // Fallback: "Next" button anywhere
    if (!info.hasNext) {
      var nextBtn = document.querySelector('button[data-testid*="next"], a[data-testid*="next"], button:not([disabled])');
      // Only claim next if a next-ish control exists
      var allBtns = Array.prototype.slice.call(document.querySelectorAll('button, a'));
      info.hasNext = allBtns.some(function (b) {
        var t = norm(b.textContent);
        return (t === 'next' || t.indexOf('next page') !== -1) && !b.disabled;
      });
    }
    return info;
  }

  /* ── messaging ──────────────────────────────────────────── */
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'BBP_PARSE_PAGE') {
      var result = parsePage();
      sendResponse(result);
      return true;
    }
    if (msg && msg.type === 'BBP_CLICK_NEXT') {
      var clicked = clickNext();
      sendResponse({ clicked: clicked });
      return true;
    }
    if (msg && msg.type === 'BBP_GET_STORED') {
      chrome.storage.local.get(STORE_KEY, function (res) {
        sendResponse(res[STORE_KEY] || null);
      });
      return true;
    }
    if (msg && msg.type === 'BBP_PROBE') {
      // Content-based detection: Seller Central is an SPA, the URL does NOT
      // change when you navigate to Manage Pricing — only the table matters.
      var table = findPricingTable();
      var map = table ? getHeaderMap(table) : null;
      sendResponse({
        url: location.href,
        hasTable: !!table,
        headers: map ? Object.keys(map).join(',') : null,
        rows: table ? getBodyRows(table).length : 0,
        title: document.title
      });
      return true;
    }
  });

  function clickNext() {
    // Try Amazon's .a-pagination .a-last link first
    var last = document.querySelector('.a-pagination .a-last a, .a-pagination .a-last button');
    if (last) { last.click(); return true; }
    // Then any visible "Next" control
    var all = Array.prototype.slice.call(document.querySelectorAll('button, a'));
    for (var i = 0; i < all.length; i++) {
      var t = norm(all[i].textContent);
      if ((t === 'next' || t.indexOf('next page') !== -1) && !all[i].disabled) {
        all[i].click();
        return true;
      }
    }
    return false;
  }

  /* ── auto-parse on load if this is the pricing page ─────── */
  function isPricingPage() {
    // URL match OR content match — Seller Central is an SPA, so the URL often
    // stays on /amazonsell/business even when Manage Pricing is displayed.
    if (/\/pricing\/managepricing/i.test(location.href)) return true;
    if (/\/pricing\/pricing/i.test(location.href)) return true;
    return !!findPricingTable();
  }

  if (isPricingPage()) {
    // Wait for the table to render (SPA)
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var table = findPricingTable();
      if (table || tries > 20) {
        clearInterval(timer);
        if (table) parsePage();
        else logDiag('Pricing page loaded but no table after ' + tries + ' tries');
      }
    }, 500);
  }

  logDiag('Content script loaded on ' + location.href);
})();