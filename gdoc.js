/* --------------------------------------------------------------------------
   gdoc.js — mirror a Google Doc into this site's own markup.

   Shared by cv.html and piece.html. Both pages do the same thing: fetch a
   document's HTML export on every load and rewrite it, so the page always
   shows whatever the doc says right now and nothing is ever committed.

   Two facts make this possible, and both are worth knowing before changing
   anything here:

     - The export endpoint answers cross-origin requests. It reflects whatever
       Origin it is given, so a plain fetch() from a github.io page succeeds.
       This is undocumented behaviour rather than a supported API, so callers
       must handle rejection and fall back to a plain link.
     - Underneath Google's generated class names the export is ordinary
       semantic HTML. The class names are meaningless and change on every
       export, so nothing here may key off them; structure and text are the
       only stable signals. The one exception is bold, which survives *only*
       as a generated class, so the stylesheet is read to find out which
       classes carry font-weight:700.

   Nothing from the document is ever passed to innerHTML. Every node is built
   with createElement and textContent, so markup inside the document can never
   become markup on the page.

   Requires: the host page must style h2, p, ul/li, .cv-row/.cv-what/.cv-when.
-------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  function exportUrl(id) {
    return 'https://docs.google.com/document/d/' + id + '/export?format=html';
  }
  function viewUrl(id) {
    return 'https://docs.google.com/document/d/' + id + '/view';
  }

  /* A line that is nothing but capitals is a section heading (EDUCATION,
     PUBLICATIONS, ...). Testing for "has no lowercase" rather than matching a
     fixed list means a section added to the doc later is picked up without
     touching this file. Digits and punctuation pass so that
     "WORKSHOPS/PROFESSIONAL DEVELOPMENT/COURSES" still counts. */
  function isHeading(text) {
    if (text.length < 3 || text.length > 70) return false;
    if (!/[A-Z]/.test(text)) return false;
    if (/[a-z]/.test(text)) return false;
    return /^[A-Z0-9 .,'&()\/–—-]+$/.test(text);
  }

  /* Google right-aligns a date by padding with non-breaking spaces, so a run
     of whitespace followed by something date-shaped at the end of a line is a
     title/date pair rather than a sentence. The run has to be three or more,
     which is what stops an ordinary sentence that happens to end in a year
     from being torn into two columns. Anything that does not match is left
     alone. */
  var DATE_TAIL = new RegExp(
    '^(.*?)[\\s\\u00a0]{3,}(' +
      '(?:Expected\\s*[-\\u2013\\u2014]\\s*)?' +
      '(?:Spring|Summer|Fall|Winter)?\\s*' +
      '\\d{4}' +
      '(?:\\s*[-\\u2013\\u2014]\\s*(?:Present|present|\\d{4}))?' +
    ')$'
  );

  function tidy(s) { return s.replace(/[\s ]+/g, ' ').trim(); }
  function blockText(el) { return tidy(el.textContent || ''); }

  function boldClassesOf(gdoc) {
    var set = Object.create(null);
    var styles = gdoc.getElementsByTagName('style');
    for (var i = 0; i < styles.length; i++) {
      var css = styles[i].textContent || '';
      var re = /\.([\w-]+)\s*\{([^}]*)\}/g, m;
      while ((m = re.exec(css))) {
        if (/font-weight\s*:\s*(?:700|800|900|bold)/i.test(m[2])) set[m[1]] = true;
      }
    }
    return set;
  }

  function isBold(el, bolds) {
    var cls = ((el.getAttribute && el.getAttribute('class')) || '').split(/\s+/);
    for (var i = 0; i < cls.length; i++) if (cls[i] && bolds[cls[i]]) return true;
    return false;
  }

  /* Rebuild one block's inline content: text, bold runs, and links. */
  function inline(src, dest, bolds, boldCtx) {
    for (var n = src.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        var t = n.nodeValue.replace(/[\s ]+/g, ' ');
        if (!t) continue;
        if (boldCtx) {
          var b = document.createElement('strong');
          b.textContent = t;
          dest.appendChild(b);
        } else {
          dest.appendChild(document.createTextNode(t));
        }
        continue;
      }
      if (n.nodeType !== 1) continue;

      var tag = n.tagName.toLowerCase();
      if (tag === 'br') { dest.appendChild(document.createElement('br')); continue; }
      if (tag === 'img' || tag === 'style' || tag === 'script') continue;

      if (tag === 'a') {
        var href = n.getAttribute('href') || '';
        /* Google wraps outbound links in a redirector; unwrap to the target. */
        var q = href.match(/[?&]q=([^&]+)/);
        if (q) { try { href = decodeURIComponent(q[1]); } catch (e) {} }
        if (/^(https?:|mailto:)/i.test(href)) {
          var a = document.createElement('a');
          a.href = href;
          a.rel = 'noopener noreferrer';
          inline(n, a, bolds, boldCtx || isBold(n, bolds));
          if (a.textContent.trim()) { dest.appendChild(a); continue; }
        }
      }
      inline(n, dest, bolds, boldCtx || isBold(n, bolds));
    }
  }

  function renderParagraph(el, bolds, frag) {
    var raw = (el.textContent || '').replace(/ /g, ' ');
    var flat = blockText(el);
    if (!flat) return;

    if (isHeading(flat)) {
      var h = document.createElement('h2');
      h.textContent = flat;
      frag.appendChild(h);
      return;
    }

    /* A paragraph the author bulleted by hand, with a literal marker. */
    var bullet = flat.match(/^[•●▪*·-]\s+(.*)$/);
    if (bullet && bullet[1]) {
      var ul = frag.lastChild;
      if (!ul || ul.tagName !== 'UL') { ul = document.createElement('ul'); frag.appendChild(ul); }
      var li = document.createElement('li');
      li.textContent = bullet[1];
      ul.appendChild(li);
      return;
    }

    var m = raw.replace(/\s+$/, '').match(DATE_TAIL);
    if (m && tidy(m[1])) {
      var row = document.createElement('div');
      row.className = 'cv-row';
      var what = document.createElement('span');
      what.className = 'cv-what';
      what.textContent = tidy(m[1]);
      var when = document.createElement('span');
      when.className = 'cv-when';
      when.textContent = tidy(m[2]);
      row.appendChild(what);
      row.appendChild(when);
      frag.appendChild(row);
      return;
    }

    var p = document.createElement('p');
    inline(el, p, bolds, false);
    if (p.textContent.trim()) frag.appendChild(p);
  }

  function build(gdoc) {
    var bolds = boldClassesOf(gdoc);
    var frag = document.createDocumentFragment();

    (function walk(parent) {
      for (var el = parent.firstElementChild; el; el = el.nextElementSibling) {
        var tag = el.tagName.toLowerCase();

        if (tag === 'ul' || tag === 'ol') {
          var ul = document.createElement('ul');
          var items = el.getElementsByTagName('li');
          for (var i = 0; i < items.length; i++) {
            if (!blockText(items[i])) continue;
            var li = document.createElement('li');
            inline(items[i], li, bolds, false);
            if (li.textContent.trim()) ul.appendChild(li);
          }
          if (ul.childNodes.length) frag.appendChild(ul);
          continue;
        }

        if (/^h[1-6]$/.test(tag)) {
          var t = blockText(el);
          if (!t) continue;
          var h = document.createElement('h2');
          h.textContent = t;
          frag.appendChild(h);
          continue;
        }

        if (tag === 'p') { renderParagraph(el, bolds, frag); continue; }
        if (tag === 'div' || tag === 'section' || tag === 'body') { walk(el); continue; }
      }
    })(gdoc.body);

    return frag;
  }

  /* cache:'no-store' plus a changing query string, so a click really does go
     back to Google rather than to whatever the browser kept from last time. */
  function load(id) {
    return fetch(exportUrl(id) + '&_=' + Date.now(), {
      cache: 'no-store', credentials: 'omit'
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (html) {
        var frag = build(new DOMParser().parseFromString(html, 'text/html'));
        if (!frag.childNodes.length) throw new Error('empty document');
        return frag;
      });
  }

  global.GDoc = {
    exportUrl: exportUrl,
    viewUrl: viewUrl,
    build: build,
    load: load
  };
})(window);
