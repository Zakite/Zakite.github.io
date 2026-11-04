/* Local editor for the homepage. It only does anything when the page is served
   by tools/edit_server.py. On the published site the status check fails, so
   nothing is added and nothing else changes.

   Click "Last updated 2026" in the footer: an "edit" button appears. Edit any
   text in the list and press "Save and push". */
(function () {
  var sig = document.querySelector('.signoff');
  if (!sig) return;

  var state = { sha: '' };

  fetch('/api/status', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) { if (s && s.ok) attach(); })
    .catch(function () {});

  function attach() {
    style();
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'edit-open';
    btn.textContent = 'edit';
    btn.hidden = true;
    sig.insertAdjacentElement('afterend', btn);
    sig.style.cursor = 'pointer';
    sig.title = 'click to show the editor';
    sig.addEventListener('click', function () { btn.hidden = !btn.hidden; });
    btn.addEventListener('click', openPanel);
  }

  function style() {
    var s = document.createElement('style');
    s.textContent = [
      '.edit-open { margin-left: .6rem; padding: .15rem .55rem; background: transparent;',
      '  color: #3FD9CB; border: 1px solid rgba(63,217,203,.5); border-radius: 4px;',
      '  font: 11px ui-monospace, Consolas, monospace; letter-spacing: .04em; cursor: pointer; }',
      '.edit-open:hover { background: rgba(63,217,203,.14); }',
      '#edit-panel { position: fixed; inset: 0; z-index: 1000; overflow: auto; padding: 1rem 1.2rem 3rem;',
      '  background: rgba(7,11,17,.97); color: #DCE8F0; font: 13px ui-monospace, Consolas, monospace; }',
      '#edit-panel .ep-bar { position: sticky; top: 0; display: flex; flex-wrap: wrap; gap: .6rem 1rem;',
      '  align-items: center; padding: .5rem 0 .8rem; background: rgba(7,11,17,.97); }',
      '#edit-panel .ep-status { color: #8FA5B8; flex: 1 1 260px; }',
      '#edit-panel button { font: inherit; padding: .35rem .8rem; border-radius: 4px; cursor: pointer;',
      '  background: transparent; color: #DCE8F0; border: 1px solid #3a4a5c; }',
      '#edit-panel button.primary { background: #3FD9CB; color: #07101a; border-color: #3FD9CB; font-weight: 700; }',
      '#edit-panel button:disabled { opacity: .45; cursor: default; }',
      '#edit-panel .ep-row { margin: 0 0 1rem; padding: .6rem .7rem; border: 1px solid #1d2a38; border-radius: 6px; }',
      '#edit-panel .ep-row.changed { border-color: #3FD9CB; }',
      '#edit-panel .ep-label { color: #8FA5B8; font-size: 11px; margin-bottom: .35rem; letter-spacing: .03em; }',
      '#edit-panel textarea { width: 100%; box-sizing: border-box; min-height: 2.6em; resize: vertical;',
      '  background: #0d141d; color: #DCE8F0; border: 1px solid #26323F; border-radius: 4px; padding: .5rem;',
      '  font: 13px/1.5 ui-monospace, Consolas, monospace; }'
    ].join('\n');
    document.head.appendChild(s);
  }

  function node(tag, props, text) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) { n[k] = props[k]; });
    if (text != null) n.textContent = text;
    return n;
  }

  function openPanel() {
    if (document.getElementById('edit-panel')) return;
    var panel = node('div');
    panel.id = 'edit-panel';

    var bar = node('div');
    bar.className = 'ep-bar';
    var title = node('strong', null, 'Edit index.html');
    var status = node('span', null, 'loading…');
    status.className = 'ep-status';
    var save = node('button', { className: 'primary', disabled: true }, 'Save and push');
    var close = node('button', { type: 'button' }, 'Close');
    bar.append(title, status, save, close);

    var list = node('div');
    panel.append(bar, list);
    document.body.appendChild(panel);

    function onKey(e) { if (e.key === 'Escape') done(); }
    function done() {
      document.removeEventListener('keydown', onKey);
      panel.remove();
    }
    close.addEventListener('click', done);
    document.addEventListener('keydown', onKey);

    function changedRows() {
      return Array.prototype.filter.call(list.querySelectorAll('textarea'), function (ta) {
        return ta.value !== ta.dataset.orig;
      });
    }
    function refreshSave() {
      var n = changedRows().length;
      save.disabled = n === 0;
      status.textContent = n ? n + ' block' + (n === 1 ? '' : 's') + ' changed' : 'no changes yet';
    }

    function load() {
      return fetch('/api/blocks', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          state.sha = data.sha;
          list.replaceChildren();
          data.blocks.forEach(function (b) {
            var row = node('div');
            row.className = 'ep-row';
            var raw = b.raw.replace(/\r\n/g, '\n');
            var preview = b.text.length > 70 ? b.text.slice(0, 70) + '…' : b.text;
            var label = node('div', null, (b.label || 'page') + ' · ' + b.tag + ' · ' + preview);
            label.className = 'ep-label';
            var ta = node('textarea');
            ta.value = raw;
            ta.dataset.id = String(b.id);
            ta.dataset.orig = raw;
            ta.rows = Math.min(10, Math.max(2, Math.ceil(raw.length / 95) + raw.split('\n').length - 1));
            ta.addEventListener('input', function () {
              row.classList.toggle('changed', ta.value !== ta.dataset.orig);
              refreshSave();
            });
            row.append(label, ta);
            list.appendChild(row);
          });
          refreshSave();
        });
    }

    save.addEventListener('click', function () {
      var edits = changedRows().map(function (ta) {
        return { id: Number(ta.dataset.id), new: ta.value };
      });
      save.disabled = true;
      status.textContent = 'saving and pushing…';
      fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Edit': '1' },
        body: JSON.stringify({ sha: state.sha, edits: edits })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok && res.j.ok) {
            var reload = node('button', { className: 'primary', type: 'button' }, 'Reload page');
            reload.addEventListener('click', function () { location.reload(); });
            bar.insertBefore(reload, close);
            // the list is rebuilt from the saved file; set the message after it
            return load().then(function () {
              status.textContent = res.j.message + '. Reload the page to see it on the site.';
            });
          }
          status.textContent = 'Not saved: ' + (res.j.error || 'error') +
            (res.j.detail ? ' — ' + res.j.detail : '');
          refreshSave();
        })
        .catch(function (err) {
          status.textContent = 'Not saved: ' + err;
          refreshSave();
        });
    });

    load().catch(function (err) { status.textContent = 'Could not load the page: ' + err; });
  }
})();
