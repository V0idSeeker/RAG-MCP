// app.js — shared client-side logic for all pages

// ── Shared: load collections ────────────────────────────
async function loadCols() {
  // ingest page: colGrid chips
  const grid = document.getElementById('colGrid');
  // search page: select dropdown
  const sel  = document.getElementById('col-select');

  if (grid) grid.innerHTML = '<div class="empty"><div class="spin"></div></div>';
  if (sel)  sel.innerHTML  = '<option value="">Loading…</option>';

  try {
    const r    = await fetch('/api/collections');
    const data = await r.json();

    if (!r.ok || data.error) {
      const msg = data.error || r.status;
      if (grid) grid.innerHTML = `<div style="color:var(--red);font-size:11px">Error: ${esc(msg)}</div>`;
      if (sel)  sel.innerHTML  = `<option value="">Error: ${esc(msg)}</option>`;
      return;
    }

    const cols = Array.isArray(data) ? data : [];

    // Ingest page chips
    if (grid) {
      if (!cols.length) {
        grid.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:4px">No collections yet — create one below</div>';
      } else {
        grid.innerHTML = '';
        cols.forEach(c => {
          const chip = document.createElement('div');
          chip.className = 'chip';
          chip.dataset.name = c.name;
          const cnt = (c.count != null && !isNaN(c.count)) ? Number(c.count).toLocaleString() : '?';
          chip.innerHTML =
            `<span class="chip-name">${esc(c.name)}</span>` +
            `<span class="chip-count">${cnt} chunks</span>` +
            `<span class="chip-del" title="Delete">✕</span>`;
          chip.querySelector('.chip-del').addEventListener('click', e => {
            e.stopPropagation();
            deleteColByName(c.name);
          });
          chip.addEventListener('click', () => pickCol(c.name));
          grid.appendChild(chip);
        });
      }
    }

    // Search page dropdown
    if (sel) {
      if (!cols.length) {
        sel.innerHTML = '<option value="">No collections yet</option>';
      } else {
        sel.innerHTML = cols.map(c => {
          const cnt = (c.count != null && !isNaN(c.count)) ? Number(c.count).toLocaleString() : '?';
          return `<option value="${esc(c.name)}">${esc(c.name)} (${cnt} chunks)</option>`;
        }).join('');
      }
    }

  } catch (e) {
    if (grid) grid.innerHTML = `<div style="color:var(--red);font-size:11px">ChromaDB unreachable</div>`;
    if (sel)  sel.innerHTML  = `<option value="">ChromaDB unreachable</option>`;
    console.error('loadCols:', e);
  }
}

// ── Ingest page ──────────────────────────────────────────
function pickCol(name) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  const chip = document.querySelector(`.chip[data-name="${CSS.escape(name)}"]`);
  if (chip) chip.classList.add('on');
  setActive(name);
}

function setActive(name) {
  const el = document.getElementById('active-col');
  if (!el) return;
  if (name) {
    el.textContent = name;
    el.classList.remove('empty');
    el._value = name;
  } else {
    el.textContent = '(none selected)';
    el.classList.add('empty');
    el._value = '';
  }
}

function useNew() {
  const v = (document.getElementById('new-col')?.value || '').trim();
  if (v.length < 3) return alert('Collection name must be at least 3 characters.');
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  setActive(v);
}

function startIngest() {
  const folder  = (document.getElementById('folder')?.value || '').trim().replace(/^["']+|["']+$/g, '');
  const active  = document.getElementById('active-col');
  const col     = active?._value || (document.getElementById('new-col')?.value || '').trim();

  if (!folder) return alert('Enter a folder path.');
  if (!col)    return alert('Select or create a collection.');
  if (col.length < 3) return alert('Collection name must be at least 3 characters.');

  const btn = document.getElementById('start-btn');
  btn.disabled = true;

  const log  = document.getElementById('log-body');
  const prog = document.getElementById('progress');
  log.innerHTML = '';
  setProgress(0);
  setStatus('running', 'Running…');

  let total = 0, done = 0;

  const es = new EventSource(`/api/ingest?folder=${encodeURIComponent(folder)}&collection=${encodeURIComponent(col)}`);

  es.onmessage = e => {
    const { type, message } = JSON.parse(e.data);
    if (type === 'info') { const m = message.match(/(\d+)\s+PDF/); if (m) total = +m[1]; }
    if (type === 'done_file') { done++; setProgress(total ? done / total * 100 : 50); }
    if (type === 'complete') { setProgress(100); setStatus('done', 'Complete ✓'); es.close(); btn.disabled = false; loadCols(); }
    if (type === 'exit' && message !== '0') { setStatus('error', 'Failed'); es.close(); btn.disabled = false; }
    addLog(type, message);
  };

  es.onerror = () => { setStatus('error', 'Connection lost'); es.close(); btn.disabled = false; };
}

function addLog(type, msg) {
  const log = document.getElementById('log-body');
  if (!log) return;
  // Remove empty state
  const empty = log.querySelector('.empty');
  if (empty) empty.remove();

  const tagMap = {
    info: ['t-info','INFO'], file: ['t-file','FILE'], chunks: ['t-log','CHUNK'],
    done_file: ['t-ok','DONE'], error_file: ['t-err','ERR'],
    complete: ['t-done','DONE'], embedder: ['t-mdl','MODEL'],
    log: ['t-log','LOG'], exit: ['t-log','EXIT']
  };
  const [cls, lbl] = tagMap[type] || ['t-log','LOG'];
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false });

  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML =
    `<span class="log-time">${t}</span>` +
    `<span class="log-tag ${cls}">${lbl}</span>` +
    `<span class="log-msg">${esc(msg)}</span>`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function setStatus(state, text) {
  const dot = document.getElementById('dot');
  const txt = document.getElementById('status-text');
  if (dot) dot.className = 'dot ' + state;
  if (txt) txt.textContent = text;
}

function setProgress(pct) {
  const el = document.getElementById('progress');
  if (el) el.style.width = pct + '%';
}

// ── Search page ──────────────────────────────────────────
async function doSearch() {
  const query   = (document.getElementById('query')?.value || '').trim();
  const col     = document.getElementById('col-select')?.value;
  const mode    = document.getElementById('search-mode')?.value || 'topk';
  const results = document.getElementById('results');

  if (!query) return;
  if (!col)   return alert('Select a collection first.');

  document.getElementById('search-btn').disabled = true;
  document.getElementById('searching').style.display = 'flex';
  results.innerHTML = '';

  try {
    let endpoint, body;
    
    if (mode === 'topk') {
      const n = Math.max(1, parseInt(document.getElementById('topk')?.value) || 5);
      endpoint = '/api/search';
      body = { query, collection: col, n_results: n };
    } else {
      const minScore = Math.max(0, Math.min(1, parseFloat(document.getElementById('min-score')?.value) || 0.7));
      endpoint = '/api/search-by-score';
      body = { query, collection: col, min_score: minScore };
    }

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.error) { showSearchErr(d.error, d.detail); return; }
    
    // Handle both response formats
    const items = d.results || [];
    renderResults(items, mode, d.total_found, d.min_score);
  } catch (e) {
    showSearchErr(e.message);
  } finally {
    document.getElementById('search-btn').disabled = false;
    document.getElementById('searching').style.display = 'none';
  }
}

function renderResults(items, mode, totalFound, minScore) {
  const results = document.getElementById('results');
  if (!items.length) {
    results.innerHTML = '<div class="empty"><div class="empty-icon">🤷</div><div class="empty-text">No results — try a different query</div></div>';
    return;
  }
  
  // Add header for score mode showing total found
  let headerHtml = '';
  if (mode === 'score' && totalFound !== undefined) {
    headerHtml = `<div style="padding: 8px 0; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--border); margin-bottom: 8px;">
      Found ${totalFound} result${totalFound !== 1 ? 's' : ''} with score ≥ ${minScore || 0.7}
    </div>`;
  }
  
  results.innerHTML = headerHtml;
  items.forEach((it, i) => {
    const badgeCls = it.score >= .75 ? 'badge-hi' : it.score >= .5 ? 'badge-mi' : 'badge-lo';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      `<div class="card-head" onclick="toggleCard(${i})">` +
        `<div class="card-left">` +
          `<span class="card-rank">#${i+1}</span>` +
          `<span class="card-source" title="${esc(it.source)}">${esc(it.source)}</span>` +
        `</div>` +
        `<div class="card-meta">` +
          `<span class="badge ${badgeCls}">${Math.round(it.score * 100)}% match</span>` +
          `<span class="card-chunk">chunk ${it.chunkIndex ?? '?'}</span>` +
          `<span class="card-chev" id="chev-${i}">▶</span>` +
        `</div>` +
      `</div>` +
      `<div class="card-body" id="body-${i}"><div class="card-text">${esc(it.text)}</div></div>`;
    results.appendChild(card);
  });
}

function toggleCard(i) {
  document.getElementById(`body-${i}`).classList.toggle('open');
  document.getElementById(`chev-${i}`).classList.toggle('open');
}

function showSearchErr(msg, detail) {
  const results = document.getElementById('results');
  results.innerHTML =
    `<div class="empty" style="padding:30px">` +
      `<div class="empty-icon">⚠️</div>` +
      `<div class="empty-text" style="color:var(--red)">${esc(msg)}</div>` +
      (detail ? `<pre style="margin-top:10px;font-size:10px;color:var(--muted);white-space:pre-wrap;text-align:left;max-width:600px">${esc(detail)}</pre>` : '') +
    `</div>`;
}

// ── Delete collection (shared) ────────────────────────────
async function deleteCol() {
  const sel  = document.getElementById('col-select');
  const name = sel?.value;
  if (!name) return alert('Select a collection first.');
  await deleteColByName(name);
}

async function deleteColByName(name) {
  if (!confirm(`Delete collection "${name}"?\nThis cannot be undone.`)) return;
  try {
    const r = await fetch(`/api/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const d = await r.json();
    if (d.error) return alert('Error: ' + d.error);
    // Clear active if it was the deleted one
    const active = document.getElementById('active-col');
    if (active?._value === name) setActive('');
    loadCols();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ── Utility ───────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Ask page (RLM) ───────────────────────────────────────
async function doAsk() {
  const question = (document.getElementById('question')?.value || '').trim();
  const col      = document.getElementById('col-select')?.value;
  const maxIter  = Math.max(1, parseInt(document.getElementById('max-iter')?.value) || 10);
  const results  = document.getElementById('results');
  if (!question || !col) return showSearchErr(!col ? 'Pick a collection first' : 'Type a question first');

  const btn = document.getElementById('ask-btn'), thinking = document.getElementById('thinking'), elapsed = document.getElementById('elapsed');
  btn.disabled = true; thinking.style.display = 'flex';
  const t0 = Date.now();
  const timer = setInterval(() => { elapsed.textContent = `Reasoning… ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
  results.innerHTML = '';
  try {
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, collection: col, max_iterations: maxIter }) });
    const d = await r.json();
    if (!r.ok || d.error) return showSearchErr(d.error || `HTTP ${r.status}`, d.detail);
    const tokens = Object.values(d.usage?.model_usage_summaries || {}).reduce((s, m) => s + (m.total_input_tokens || 0) + (m.total_output_tokens || 0), 0);
    results.innerHTML =
      `<div class="answer">` +
        `<div class="answer-head"><span>⏱ ${esc(d.execution_time_s)}s</span><span>📄 ${(d.context_chars || 0).toLocaleString()} chars of context</span>` +
          (tokens ? `<span>🔢 ${tokens.toLocaleString()} tokens</span>` : '') + `</div>` +
        `<div class="answer-body">${esc(d.answer || '(empty answer)')}</div>` +
        `<div class="sources">Documents loaded: ${(d.sources_loaded || []).map(esc).join(', ')}</div>` +
      `</div>`;
  } catch (e) {
    showSearchErr('Request failed', String(e));
  } finally {
    clearInterval(timer); btn.disabled = false; thinking.style.display = 'none'; elapsed.textContent = 'Reasoning…';
  }
}
