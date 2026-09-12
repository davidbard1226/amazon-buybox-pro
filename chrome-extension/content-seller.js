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
    // 1) Known pricing table id
    var byId = document.getElementById('pricing-table');
    if (byId) return byId;
    var tables = Array.prototype.slice.call(document.querySelectorAll('table'));
    // 2) Header row contains SKU / ASIN
    for (var i = 0; i < tables.length; i++) {
      var ths = tables[i].querySelectorAll('thead th, thead td');
      var txt = '';
      for (var j = 0; j < ths.length; j++) txt += ' ' + norm(ths[j].textContent);
      if (txt.indexOf('sku') !== -1 || txt.indexOf('asin') !== -1) return tables[i];
    }
    // 3) Any table with pricing keywords in its header cells
    for (var k = 0; k < tables.length; k++) {
      var hdrs = tables[k].querySelectorAll('th, td');
      var htxt = '';
      for (var m = 0; m < hdrs.length; m++) htxt += ' ' + norm(hdrs[m].textContent);
      if (htxt.indexOf('your price') !== -1 || htxt.indexOf('buy box') !== -1 || htxt.indexOf('lowest price') !== -1) return tables[k];
    }
    return null;
  }

  // Visible text only — strips scripts/styles so we see what's actually displayed
  function visibleText() {
    var clone = document.body ? document.body.cloneNode(true) : null;
    if (!clone) return '';
    var kills = clone.querySelectorAll('script, style, noscript, svg, canvas, iframe');
    for (var i = 0; i < kills.length; i++) kills[i].parentNode.removeChild(kills[i]);
    return norm(clone.textContent);
  }

  // Full page structure dump — used to tune selectors per marketplace.
  function dumpPage() {
    var tables = Array.prototype.slice.call(document.querySelectorAll('table'));
    var tinfo = tables.slice(0, 10).map(function (t) {
      var hdrs = Array.prototype.slice.call(t.querySelectorAll('thead th, thead td')).map(function (c) { return norm(c.textContent); });
      if (hdrs.length === 0) {
        var firstRow = t.querySelector('tr');
        if (firstRow) hdrs = Array.prototype.slice.call(firstRow.querySelectorAll('th, td')).map(function (c) { return norm(c.textContent); });
      }
      return {
        id: t.id || '',
        cls: String(t.className || ''),
        headers: hdrs.join(' | '),
        rows: t.querySelectorAll('tbody tr').length
      };
    });
    // Div-based grids — the newer Seller Central UI has NO <table> elements
    var grids = Array.prototype.slice.call(document.querySelectorAll('[role="grid"], [role="table"], [role="rowgroup"]'));
    var gridInfo = grids.slice(0, 5).map(function (g) {
      return {
        role: g.getAttribute('role'),
        cls: String(g.className || '').slice(0, 80),
        rows: g.querySelectorAll('[role="row"]').length,
        cells: g.querySelectorAll('[role="gridcell"], [role="cell"]').length
      };
    });
    // Class-name hints for div-based product rows
    var clsHits = {};
    ['sku', 'asin', 'price', 'product', 'buybox', 'buy-box', 'offer'].forEach(function (kw) {
      var els = document.querySelectorAll('[class*="' + kw + '"]');
      if (els.length) clsHits[kw] = els.length;
    });
    // Sample the price-class elements (what are they?)
    var priceEls = Array.prototype.slice.call(document.querySelectorAll('[class*="price"]')).slice(0, 5).map(function (el) {
      return el.tagName + '.' + String(el.className || '').slice(0, 60) + '="' + norm(el.textContent).slice(0, 60) + '"';
    });
    // Elements whose text is exactly SKU / ASIN (column headers?)
    var skuAsinEls = Array.prototype.slice.call(document.querySelectorAll('*')).filter(function (el) {
      var t = norm(el.textContent);
      return t === 'sku' || t === 'asin';
    }).slice(0, 10).map(function (el) { return el.tagName + '.' + String(el.className || '').slice(0, 40); });
    // Where does "manage pricing" text live?
    var mpContext = null;
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length && !mpContext; i++) {
      var t = norm(all[i].textContent);
      if (t.indexOf('manage pricing') !== -1 && t.length < 200) mpContext = all[i].tagName + '.' + String(all[i].className || '').slice(0, 60);
    }
    var containers = Array.prototype.slice.call(document.querySelectorAll('body > div')).slice(0, 8).map(function (d) { return d.tagName + '.' + String(d.className || '').slice(0, 50); });
    // First product card: element containing both ASIN and SKU labels — dump its
    // outerHTML (truncated) so we can see the exact card structure to parse
    var cardHtml = null;
    for (var c = 0; c < all.length && !cardHtml; c++) {
      var ct = norm(all[c].textContent);
      if (ct.indexOf('asin:') !== -1 && ct.indexOf('sku:') !== -1 && ct.length < 4000) {
        var node = all[c];
        for (var up = 0; up < 3 && node.parentElement; up++) node = node.parentElement;
        cardHtml = node.outerHTML.slice(0, 2000);
      }
    }
    var visText = visibleText();
    var keywords = ['manage pricing', 'buy box', 'your price', 'lowest price', 'sku', 'asin', 'pricing', 'inventory'];
    var found = keywords.filter(function (kw) { return visText.indexOf(kw) !== -1; });
    return {
      title: document.title,
      url: location.href,
      tables: tinfo,
      grids: gridInfo,
      clsHits: clsHits,
      priceEls: priceEls,
      skuAsinEls: skuAsinEls,
      mpContext: mpContext,
      containers: containers,
      cardHtml: cardHtml,
      keywords: found,
      bodyLen: visText.length,
      bodySample: visText.slice(0, 500)
    };
  }

  function getHeaderMap(table) {
    var thead = table.querySelector('thead');
    var cells;
    if (thead) {
      cells = thead.querySelectorAll('th, td');
    } else {
      // No thead: treat the first row's cells as the header row
      var firstRow = table.querySelector('tr');
      if (!firstRow) return null;
      cells = firstRow.querySelectorAll('th, td');
    }
    var map = {};
    for (var i = 0; i < cells.length; i++) {
      var t = norm(cells[i].textContent);
      if (!t) continue;
      if (t === 'sku' || t.indexOf('sku') === 0) map.sku = i;
      else if (t === 'asin' || t.indexOf('asin') === 0) map.asin = i;
      else if (t.indexOf('product name') !== -1 || t.indexOf('title') !== -1) map.title = i;
      else if (t.indexOf('your price') !== -1 || t === 'price') map.yourPrice = i;
      else if (t.indexOf('buy box price') !== -1 || t.indexOf('buybox price') !== -1) map.buyboxPrice = i;
      else if (t.indexOf('lowest') !== -1) map.lowestPrice = i;
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
    var rows;
    if (tbody) {
      rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    } else {
      // No tbody — the first row is the header row
      rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
      rows.shift();
    }
    // Drop a leading header row (all <th> cells) if present — e.g. an
    // implicit tbody that includes the header row
    if (rows.length) {
      var first = rows[0];
      var cells = first.querySelectorAll('th, td');
      if (cells.length && first.querySelectorAll('th').length === cells.length) rows.shift();
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
      var dump = dumpPage();
      logDiag('PROBE: title="' + dump.title + '" url=' + dump.url +
        ' tables=' + dump.tables.length +
        ' keywords=[' + dump.keywords.join(',') + ']' +
        (dump.tables.length ? ' firstTableHeaders="' + dump.tables[0].headers + '"' : ''));
      sendResponse({
        url: location.href,
        hasTable: !!table,
        headers: map ? Object.keys(map).join(',') : null,
        rows: table ? getBodyRows(table).length : 0,
        title: document.title,
        dump: dump
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

  if (isPricingPage() && /sellercentral\.amazon\.(co\.za|com)/i.test(location.href)) {
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