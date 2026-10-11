/* Spring Atlas — personal Java + Spring Boot knowledge map.
   Vanilla JS, no build step. The JSON is the source of truth; only the learner's
   status per concept_key is stored. Progress and readiness are always derived. */
(() => {
  'use strict';

  const DATA_URL = 'java-spring-backend-syllabus.json';
  const STORE_KEY = 'spring-atlas:v1';
  const NOTES_KEY = 'spring-atlas:notes:v1';
  const SYNC_KEY = 'spring-atlas:sync:v1';
  const BACKUP_SCHEMA_VERSION = 1;
  const NOTE_SAVE_DELAY = 750;
  const SYNC_INTERVAL_MS = 60_000;

  const STATUSES = [
    { id: 'not_started', label: 'Not started', icon: '○' },
    { id: 'in_progress', label: 'In progress', icon: '◐' },
    { id: 'learned', label: 'Learned', icon: '●' },
    { id: 'needs_review', label: 'Needs review', icon: '↻' },
    { id: 'skip_for_now', label: 'Skip for now', icon: '⤼' },
  ];
  const STATUS_IDS = STATUSES.map(s => s.id);
  const IMPORTANCE_LABEL = {
    CORE: 'Core', IMPORTANT: 'Important', SHOULD_KNOW: 'Should know', ADVANCED: 'Advanced', LATER: 'Later',
  };
  const IMPORTANCE_ORDER = ['CORE', 'IMPORTANT', 'SHOULD_KNOW', 'ADVANCED', 'LATER'];
  const DIFFICULTY_ORDER = ['Beginner', 'Intermediate', 'Advanced'];
  const ACRONYMS = { jvm: 'JVM', api: 'API', db: 'DB', devops: 'DevOps', mvc: 'MVC' };

  const PROMPT_TEMPLATE = `You are teaching me one topic from my Java/Spring Boot backend engineering syllabus.

Topic: {{title}}
Path: {{path}}
Importance: {{importance}}
Difficulty: {{difficulty}}
Prerequisites I have learned: {{learned_prereqs}}
Prerequisites I have not learned: {{missing_prereqs}}

Learner background:
- CS graduate
- Comfortable with C++
- Familiar with Java OOP
- Comfortable with SQL
- Goal: become comfortable building and understanding professional Spring Boot backends
- Study style: random-topic exploration

Teach this topic for professional backend development.

Rules:
1. Start from the prerequisites I have marked learned.
2. Do not reteach known material unnecessarily.
3. Explain the concept, then show practical Java/Spring/backend examples where applicable.
4. Explain internals only to the depth useful for backend work.
5. Explain how this appears in real Spring Boot codebases.
6. Include common mistakes and misconceptions.
7. Distinguish must-understand from nice-to-know details.
8. Mention closely related concepts without derailing into unrelated subjects.
9. Give a compact knowledge check at the end.
10. Do not assume a linear course order.`;

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssId = s => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/"/g, '\\"');
  const sectionTitle = id => id.replace(/^\d+-/, '').split('-').map(w => ACRONYMS[w] || (w[0].toUpperCase() + w.slice(1))).join(' ');
  const statusMeta = id => STATUSES.find(s => s.id === id) || STATUSES[0];
  const makeId = prefix => `${prefix}:${(window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
  const safeJsonParse = value => { try { return JSON.parse(value); } catch (_) { return null; } };
  const emptyDelta = () => ({ ops: [{ insert: '\n' }] });
  const noteText = delta => (delta && Array.isArray(delta.ops) ? delta.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join('') : '').replace(/\u0000/g, '');
  const noteHasContent = delta => noteText(delta).trim().length > 0;
  function canonicalDeltaJson(delta) {
    const safe = cleanDelta(delta || emptyDelta());
    return JSON.stringify({ ops: safe.ops.map(op => {
      const result = { insert: op.insert };
      if (op.attributes && Object.keys(op.attributes).length) result.attributes = Object.fromEntries(Object.keys(op.attributes).sort().map(key => [key, op.attributes[key]]));
      return result;
    }) });
  }
  async function deltaHash(delta) {
    if (!window.crypto || !window.crypto.subtle) return null;
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalDeltaJson(delta)));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }
  const validLink = value => { try { const u = new URL(value); return ['http:', 'https:', 'mailto:'].includes(u.protocol) && (u.protocol === 'mailto:' || !!u.hostname); } catch (_) { return false; } };

  function cleanDelta(input) {
    if (!input || !Array.isArray(input.ops) || input.ops.length > 10000) return emptyDelta();
    const ops = []; let chars = 0;
    const allowed = new Set(['bold', 'italic', 'underline', 'strike', 'color', 'background', 'header', 'list', 'blockquote', 'code-block', 'link', 'indent', 'callout']);
    for (const raw of input.ops) {
      if (!raw || typeof raw.insert !== 'string') continue;
      chars += raw.insert.length; if (chars > 100000) break;
      const op = { insert: raw.insert }; const attrs = {};
      for (const [k, v] of Object.entries(raw.attributes || {})) {
        if (!allowed.has(k)) continue;
        if (['bold', 'italic', 'underline', 'strike', 'blockquote', 'code-block'].includes(k) && v === true) attrs[k] = true;
        else if (k === 'header' && [1, 2, 3].includes(v)) attrs[k] = v;
        else if (k === 'list' && ['ordered', 'bullet'].includes(v)) attrs[k] = v;
        else if (k === 'indent' && Number.isInteger(v) && v >= 1 && v <= 8) attrs[k] = v;
        else if (['color', 'background'].includes(k) && typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) attrs[k] = v;
        else if (k === 'link' && typeof v === 'string' && validLink(v)) attrs.link = v;
        else if (k === 'callout' && ['info', 'tip', 'warning'].includes(v)) attrs.callout = v;
      }
      if (Object.keys(attrs).length) op.attributes = attrs;
      ops.push(op);
    }
    if (!ops.length || !ops.some(op => op.insert.endsWith('\n'))) ops.push({ insert: '\n' });
    return { ops };
  }

  /* ---------- storage (always guarded) ---------- */
  let memoryStore = null;
  let embeddedLegacyNotes = {};
  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj.status === 'object') {
          embeddedLegacyNotes = obj.notes || obj.richNotes || obj.notesByConcept || {};
          return { status: obj.status || {} };
        }
      }
    } catch (e) { /* ignore */ }
    return memoryStore || { status: {} };
  }
  function saveState() {
    memoryStore = state;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, status: state.status })); }
    catch (e) { /* storage unavailable: keep in memory */ }
  }

  function loadNoteCache() {
    try {
      const raw = safeJsonParse(localStorage.getItem(NOTES_KEY));
      if (raw && raw.notes && typeof raw.notes === 'object') return { ...embeddedLegacyNotes, ...raw.notes };
    } catch (_) { /* storage unavailable */ }
    return { ...embeddedLegacyNotes };
  }
  function saveNoteCache() {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify({ v: 1, notes: notesCache })); }
    catch (_) { /* memory cache remains available for this session */ }
  }
  function loadSyncQueue() {
    try {
      const raw = safeJsonParse(localStorage.getItem(SYNC_KEY));
      return raw && Array.isArray(raw.progressQueue) ? raw.progressQueue : [];
    } catch (_) { return []; }
  }
  function loadCloudLinked() {
    try { const raw = safeJsonParse(localStorage.getItem(SYNC_KEY)); return !!(raw && raw.cloudLinked === true); }
    catch (_) { return false; }
  }
  function saveSyncQueue() {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify({ v: 1, cloudLinked, progressQueue })); }
    catch (_) { /* queue remains in memory when storage is unavailable */ }
  }

  /* ---------- model ---------- */
  let nodes = [], byId = new Map(), groups = new Map(), children = new Map();
  let unlocksOf = new Map(), sectionOrder = [], sectionGroups = new Map(), roots = new Map();
  let state = loadState();
  const open = new Set();              // expanded ids ("sec:xx" or node id)
  const ui = { search: '', importance: '', difficulty: '', status: '', ready: '', core30: false };
  let visible = null;                  // Set of node ids shown when search/filter active
  let navStack = [];                   // detail dialog history
  let lastTrigger = null;
  let notesCache = loadNoteCache();
  let cloudNoteMetadata = {};
  let progressQueue = loadSyncQueue();
  let cloudLinked = loadCloudLinked();
  let progressRevisions = {};
  let cloudAvailable = false;
  let cloudWritesEnabled = false;
  let cloudLoaded = false;
  let syncBusy = false;
  let syncTimer = null;
  let noteSaveTimer = null;
  let editor = null;
  let editorConceptKey = null;
  let pendingNoteConflict = null;
  let pendingLocalSnapshot = null;
  let pendingImportSnapshot = null;
  let pendingImportCounts = null;
  let migrationReason = '';
  let migrationPaused = false;
  let notesSyncBusy = new Set();

  function buildModel(data) {
    nodes = data.nodes;
    byId = new Map(nodes.map(n => [n.id, n]));
    groups = new Map(); children = new Map(); unlocksOf = new Map();
    sectionGroups = new Map(); roots = new Map();
    sectionOrder = (data.index && data.index.sections) || [...new Set(nodes.map(n => n.section))];

    for (const n of nodes) {
      n.prerequisites = (n.prerequisites || []).filter(p => byId.has(p));
      n.aliases = n.aliases || []; n.tags = n.tags || [];
      let g = groups.get(n.concept_key);
      if (!g) { g = { key: n.concept_key, ids: [], core: false, core30: false }; groups.set(n.concept_key, g); }
      g.ids.push(n.id);
      if (n.importance === 'CORE') g.core = true;
      if (n.core30) g.core30 = true;
      if (!sectionGroups.has(n.section)) sectionGroups.set(n.section, new Set());
      sectionGroups.get(n.section).add(n.concept_key);

      if (n.parent_id && byId.has(n.parent_id)) {
        if (!children.has(n.parent_id)) children.set(n.parent_id, []);
        children.get(n.parent_id).push(n.id);
      } else {
        if (!roots.has(n.section)) roots.set(n.section, []);
        roots.get(n.section).push(n.id);
      }
      n._hay = [n.title, n.id, n.section, sectionTitle(n.section), ...n.aliases, ...n.tags, ...(n.path || [])]
        .join(' \u0001 ').toLowerCase();
    }
    // reverse edges recomputed from prerequisites (the JSON's own `unlocks` is ignored)
    for (const n of nodes) for (const p of n.prerequisites) {
      if (!unlocksOf.has(p)) unlocksOf.set(p, []);
      unlocksOf.get(p).push(n.id);
    }
    // drop stored state for concepts that no longer exist
    for (const k of Object.keys(state.status)) if (!groups.has(k) || !STATUS_IDS.includes(state.status[k])) delete state.status[k];
    for (const k of Object.keys(notesCache)) {
      if (!groups.has(k)) { delete notesCache[k]; continue; }
      const raw = notesCache[k];
      if (!raw || typeof raw !== 'object' || !raw.delta || !Array.isArray(raw.delta.ops)) {
        const normalized = normalizeImportedNote(typeof raw === 'string' ? { content: raw } : (raw || {}), k);
        if (normalized) notesCache[k] = { ...raw, ...normalized, dirty: !!raw?.dirty, localOnly: true };
        else notesCache[k] = { conceptKey: k, delta: emptyDelta(), plainText: '', revision: 0, dirty: false, localOnly: true };
      } else {
        raw.conceptKey = k; raw.delta = cleanDelta(raw.delta); raw.plainText = noteText(raw.delta);
        raw.revision = Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0;
      }
    }
    discoverLegacyNotes();
    saveNoteCache();
  }

  const statusOf = n => state.status[n.concept_key] || 'not_started';
  const isLearned = n => statusOf(n) === 'learned';
  function readiness(n) {
    const learned = [], missing = [];
    for (const p of n.prerequisites) (isLearned(byId.get(p)) ? learned : missing).push(byId.get(p));
    return { learned, missing, ready: missing.length === 0 };
  }
  const uniqueByConcept = list => { const seen = new Set(); return list.filter(n => !seen.has(n.concept_key) && seen.add(n.concept_key)); };
  const unlockNodes = n => uniqueByConcept((unlocksOf.get(n.id) || []).map(i => byId.get(i)));
  const groupLearned = g => state.status[g.key] === 'learned';

  function stats() {
    let learned = 0, core = 0, coreTotal = 0, c30 = 0, c30Total = 0;
    for (const g of groups.values()) {
      const l = groupLearned(g);
      if (l) learned++;
      if (g.core) { coreTotal++; if (l) core++; }
      if (g.core30) { c30Total++; if (l) c30++; }
    }
    return { learned, total: groups.size, core, coreTotal, c30, c30Total };
  }
  function sectionStats(sec) {
    const set = sectionGroups.get(sec) || new Set();
    let l = 0;
    for (const k of set) if (state.status[k] === 'learned') l++;
    return { learned: l, total: set.size };
  }

  /* ---------- search / filter ---------- */
  function filtersActive() {
    return !!(ui.search || ui.importance || ui.difficulty || ui.status || ui.ready || ui.core30);
  }
  function matches(n) {
    if (ui.importance && n.importance !== ui.importance) return false;
    if (ui.difficulty && n.difficulty !== ui.difficulty) return false;
    if (ui.status && statusOf(n) !== ui.status) return false;
    if (ui.core30 && !n.core30) return false;
    if (ui.ready) {
      const r = readiness(n);
      if (ui.ready === 'ready' && !r.ready) return false;
      if (ui.ready === 'partial' && r.ready) return false;
    }
    if (ui.search) {
      const terms = ui.search.toLowerCase().split(/\s+/).filter(Boolean);
      for (const t of terms) if (!n._hay.includes(t)) return false;
    }
    return true;
  }
  function computeVisible() {
    if (!filtersActive()) { visible = null; return 0; }
    visible = new Set();
    let hits = 0;
    for (const n of nodes) {
      if (!matches(n)) continue;
      hits++;
      let cur = n;
      while (cur && !visible.has(cur.id)) { visible.add(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
    }
    n_hits = hits;
    return hits;
  }
  let n_hits = 0;

  /* ---------- rendering: header / tiles ---------- */
  function renderHeader() {
    const s = stats();
    const pct = s.total ? (s.learned / s.total) * 100 : 0;
    $('#pct').textContent = pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct);
    const meter = $('#meter');
    meter.setAttribute('aria-valuenow', Math.round(pct));
    $('#meterFill').style.width = pct + '%';
    $('#counters').innerHTML =
      `<span><b>${s.learned}</b> learned of <b>${s.total}</b> concepts</span>` +
      `<span>Core <b>${s.core}</b>/${s.coreTotal}</span>` +
      `<span>Core 30 <b>${s.c30}</b>/${s.c30Total}</span>`;
  }

  function renderTiles() {
    $('#tiles').innerHTML = sectionOrder.map(sec => {
      const st = sectionStats(sec);
      const p = st.total ? (st.learned / st.total) * 100 : 0;
      return `<li><button type="button" class="tile${p === 100 ? ' done' : ''}" data-section="${esc(sec)}" aria-label="${esc(sectionTitle(sec))}: ${st.learned} of ${st.total} learned. Go to section.">
        <span class="tile-num">${esc(sec.slice(0, 2))}</span>
        <span class="tile-name">${esc(sectionTitle(sec))}</span>
        <span class="tile-bar"><i style="width:${p}%"></i></span>
        <span class="tile-count">${st.learned}/${st.total}</span>
      </button></li>`;
    }).join('');
  }

  /* ---------- rendering: tree ---------- */
  function badge(cls, text, title) {
    return `<span class="badge ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
  }
  function nodeRow(id, depth) {
    const n = byId.get(id);
    const kids = (children.get(id) || []).filter(k => !visible || visible.has(k));
    const hasKids = kids.length > 0;
    const isOpen = hasKids && (visible ? true : open.has(id));
    const st = statusOf(n);
    const meta = statusMeta(st);
    const r = readiness(n);
    const nu = unlockNodes(n).length;
    const g = groups.get(n.concept_key);
    const shared = g.ids.length > 1;
    const hasNotes = noteHasContent(notesCache[n.concept_key] && notesCache[n.concept_key].delta) || !!(cloudNoteMetadata[n.concept_key] && cloudNoteMetadata[n.concept_key].hasContent);
    const total = n.prerequisites.length;

    let h = `<li class="node st-${st}" data-id="${esc(id)}" style="--d:${depth}">
      <div class="row">`;
    h += hasKids
      ? `<button type="button" class="twisty" data-toggle="${esc(id)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Collapse' : 'Expand'} ${esc(n.title)}"><span aria-hidden="true">▸</span></button>`
      : `<span class="twisty none" aria-hidden="true"></span>`;
    h += `<input type="checkbox" class="chk" data-check="${esc(id)}" ${st === 'learned' ? 'checked' : ''} aria-label="Mark ${esc(n.title)} as learned">`;
    h += `<button type="button" class="ttl" data-open="${esc(id)}">${esc(n.title)}</button>`;
    if (hasNotes) h += `<span class="has-notes" title="This concept has notes" aria-label="Has notes">✎</span>`;
    h += `<span class="meta">`;
    if (st !== 'not_started' && st !== 'learned') h += `<span class="chip s-${st}" title="${esc(meta.label)}"><span aria-hidden="true">${meta.icon}</span> ${esc(meta.label)}</span>`;
    if (total) h += `<span class="ind ${r.ready ? 'ok' : 'warn'}" title="${r.learned.length} of ${total} prerequisites learned">⛓ ${r.learned.length}/${total}<span class="sr"> prerequisites learned</span></span>`;
    if (nu) h += `<span class="ind" title="Unlocks ${nu} topic${nu > 1 ? 's' : ''}">→ ${nu}<span class="sr"> topics unlocked</span></span>`;
    if (shared) h += `<span class="ind" title="Shared concept: appears in ${g.ids.length} places and shares progress">⇄ ${g.ids.length}<span class="sr"> shared places</span></span>`;
    if (n.core30) h += `<span class="ind star" title="Core 30"><span aria-hidden="true">★</span><span class="sr">Core 30</span></span>`;
    h += badge('imp-' + n.importance, IMPORTANCE_LABEL[n.importance] || n.importance);
    h += badge('dif-' + n.difficulty, n.difficulty);
    h += `</span></div>`;
    if (isOpen) h += `<ul class="kids" role="list">${kids.map(k => nodeRow(k, depth + 1)).join('')}</ul>`;
    return h + '</li>';
  }

  function renderTree() {
    const hits = computeVisible();
    const out = [];
    for (const sec of sectionOrder) {
      const rootIds = (roots.get(sec) || []).filter(i => !visible || visible.has(i));
      if (visible && !rootIds.length) continue;
      const sid = 'sec:' + sec;
      const isOpen = visible ? true : open.has(sid);
      const st = sectionStats(sec);
      const p = st.total ? (st.learned / st.total) * 100 : 0;
      out.push(`<section class="sec" id="sec-${esc(sec)}" aria-labelledby="h-${esc(sec)}">
        <h3 id="h-${esc(sec)}"><button type="button" class="sec-btn" data-toggle="${esc(sid)}" aria-expanded="${isOpen}">
          <span class="twisty" aria-hidden="true">▸</span>
          <span class="sec-num">${esc(sec.slice(0, 2))}</span>
          <span class="sec-name">${esc(sectionTitle(sec))}</span>
          <span class="sec-prog"><span class="sec-bar"><i style="width:${p}%"></i></span><span>${st.learned}/${st.total}</span></span>
        </button></h3>
        ${isOpen ? `<ul class="kids root" role="list">${rootIds.map(i => nodeRow(i, 0)).join('')}</ul>` : ''}
      </section>`);
    }
    $('#tree').innerHTML = out.join('') || `<p class="empty">No topics match. Try fewer filters or a different search.</p>`;
    $('#resultInfo').textContent = visible ? `${hits} match${hits === 1 ? '' : 'es'}` : `${nodes.length} topics · ${groups.size} concepts`;
    const fc = ['importance', 'difficulty', 'status', 'ready', 'core30'].filter(k => ui[k]).length;
    const pill = $('#filterCount');
    pill.hidden = !fc; pill.textContent = fc;
  }

  function refresh(focusSel, updateDetail = true) {
    renderHeader(); renderTiles(); renderTree();
    if (focusSel) { const el = $(focusSel); if (el) el.focus({ preventScroll: true }); }
    if (updateDetail && $('#detail').open && navStack.length) renderDetail();
    else if ($('#detail').open && navStack.length) syncDetailStatus();
  }

  function syncDetailStatus() {
    if (!navStack.length) return;
    const n = byId.get(navStack[navStack.length - 1]);
    if (!n) return;
    const st = statusOf(n);
    for (const label of $$('.seg label', $('#detail'))) {
      const radio = $('input[name="status"]', label);
      if (!radio) continue;
      radio.checked = radio.value === st;
      label.classList.toggle('on', radio.checked);
    }
  }

  /* ---------- status changes ---------- */
  function setStatus(n, st) {
    if (st === 'not_started') delete state.status[n.concept_key];
    else state.status[n.concept_key] = st;
    saveState();
    if (cloudWritesEnabled || (cloudLinked && !migrationPaused)) {
      progressQueue.push({ conceptKey: n.concept_key, status: st, mutationId: makeId('progress'), queuedAt: new Date().toISOString() });
      saveSyncQueue();
      if (cloudAvailable && cloudWritesEnabled) {
        setSyncStatus('Syncing…', 'pending');
        flushProgressQueue();
      } else {
        setSyncStatus(navigator.onLine ? 'Cloud unavailable — changes queued' : 'Offline — changes pending', 'pending');
      }
    }
  }

  /* ---------- rich notes ---------- */
  function registerNoteBlots() {
    if (!window.Quill || registerNoteBlots.done) return;
    try {
      const Block = Quill.import('blots/block');
      class CalloutBlot extends Block {
        static create(value) {
          const node = super.create();
          const valid = ['info', 'tip', 'warning'].includes(value) ? value : 'info';
          node.setAttribute('data-callout', valid);
          return node;
        }
        static formats(node) { return node.getAttribute('data-callout') || false; }
        format(name, value) {
          if (name === 'callout') {
            if (['info', 'tip', 'warning'].includes(value)) this.domNode.setAttribute('data-callout', value);
            else this.domNode.removeAttribute('data-callout');
          } else super.format(name, value);
        }
      }
      CalloutBlot.blotName = 'callout';
      CalloutBlot.tagName = 'DIV';
      CalloutBlot.className = 'ql-callout';
      Quill.register(CalloutBlot, true);
      registerNoteBlots.done = true;
    } catch (_) { /* editor still works with the built-in formats if a custom blot is unavailable */ }
  }

  function getNote(key) {
    if (!notesCache[key] || typeof notesCache[key] !== 'object') {
      notesCache[key] = { conceptKey: key, delta: emptyDelta(), plainText: '', revision: 0, dirty: false };
    }
    const note = notesCache[key];
    note.delta = cleanDelta(note.delta || emptyDelta());
    note.plainText = typeof note.plainText === 'string' ? note.plainText : noteText(note.delta);
    note.revision = Number.isInteger(note.revision) && note.revision >= 0 ? note.revision : 0;
    return note;
  }

  function updateNoteState(text, stateName) {
    const el = $('#noteSaveState');
    if (el) { el.textContent = text; el.dataset.state = stateName || 'saved'; }
  }

  function captureActiveDraft(markDirty = true) {
    if (!editorConceptKey) return;
    const note = getNote(editorConceptKey);
    let delta;
    if (editor) delta = cleanDelta(editor.getContents());
    else if (editorFallback) delta = cleanDelta({ ops: [{ insert: editorFallback.value + '\n' }] });
    else return;
    note.delta = delta;
    note.plainText = noteText(delta);
    if (markDirty) note.dirty = true;
    note.localOnly = !cloudWritesEnabled || !cloudAvailable;
    notesCache[editorConceptKey] = note;
    saveNoteCache();
    if (markDirty) {
      updateNoteState('Unsaved changes', 'pending');
      clearTimeout(noteSaveTimer);
      const key = editorConceptKey;
      noteSaveTimer = setTimeout(() => saveNote(key), NOTE_SAVE_DELAY);
    }
  }

  function initNoteEditor(n) {
    editor = null; editorFallback = null; editorConceptKey = n.concept_key;
    const mount = $('#noteEditor');
    if (!mount) return;
    const note = getNote(n.concept_key);
    if (window.Quill) {
      registerNoteBlots();
      try {
        editor = new Quill(mount, {
          theme: 'snow',
          placeholder: 'Capture the idea, a code example, gotchas, and questions to revisit…',
          modules: {
            toolbar: {
              container: '#noteToolbar',
              handlers: {
                callout(value) {
                  const range = this.quill.getSelection(true);
                  if (!range) return;
                  const current = this.quill.getFormat(range).callout;
                  this.quill.formatLine(range.index, Math.max(range.length, 1), 'callout', current === value ? false : value, 'user');
                },
                undo() { this.quill.history.undo(); },
                redo() { this.quill.history.redo(); },
              },
            },
            history: { delay: 1000, maxStack: 100, userOnly: true },
          },
        });
        editor.setContents(cleanDelta(note.delta || emptyDelta()), 'silent');
        editor.on('text-change', () => captureActiveDraft(true));
      } catch (_) {
        editor = null;
      }
    }
    if (!editor) {
      mount.innerHTML = `<textarea id="noteFallback" class="plain-note-fallback" rows="10" aria-label="Plain-text note for ${esc(n.title)}" placeholder="Write your notes here. Rich formatting requires the pinned editor script to load."></textarea>`;
      editorFallback = $('#noteFallback');
      editorFallback.value = noteText(note.delta).replace(/\n$/, '');
      editorFallback.addEventListener('input', () => captureActiveDraft(true));
    }
    if (note.conflict) updateNoteState('Conflict — draft preserved', 'conflict');
    else if (note.dirty) updateNoteState('Unsaved changes', 'pending');
    else updateNoteState(cloudWritesEnabled && cloudAvailable ? 'Saved to cloud' : 'Saved on this device', 'saved');
  }

  let editorFallback = null;

  async function flushCurrentNote() {
    if (editorConceptKey) captureActiveDraft(false);
    clearTimeout(noteSaveTimer);
    if (editorConceptKey) await saveNote(editorConceptKey, { flush: true });
  }

  async function saveNote(key, options = {}) {
    clearTimeout(noteSaveTimer);
    const note = getNote(key);
    if (note.conflict && !options.force) {
      updateNoteState('Conflict — draft preserved', 'conflict');
      return false;
    }
    if (!note.dirty && !note.localOnly && !options.force) {
      if (key === editorConceptKey) updateNoteState(noteHasContent(note.delta) ? (cloudWritesEnabled && cloudAvailable ? 'Saved to cloud' : 'Saved on this device') : 'No notes yet', 'saved');
      return true;
    }
    if (!noteHasContent(note.delta) && note.revision === 0 && !note.dirty) {
      updateNoteState(cloudWritesEnabled && cloudAvailable ? 'No notes yet' : 'Saved on this device', 'saved');
      return true;
    }
    if (!cloudAvailable || !cloudWritesEnabled) {
      note.dirty = false;
      note.localOnly = true;
      saveNoteCache();
      if (key === editorConceptKey) updateNoteState('Saved on this device', 'saved');
      return true;
    }
    if (!navigator.onLine) {
      note.dirty = true;
      saveNoteCache();
      if (key === editorConceptKey) updateNoteState('Offline — draft saved locally', 'pending');
      setSyncStatus('Offline — changes pending', 'pending');
      return false;
    }
    const submittedDelta = cleanDelta(note.delta);
    const submittedText = noteText(submittedDelta);
    const submittedJSON = JSON.stringify(submittedDelta);
    if (notesSyncBusy.has(key)) return false;
    note.pendingMutationId = note.pendingMutationId || makeId('note');
    notesSyncBusy.add(key);
    if (key === editorConceptKey) updateNoteState('Syncing note…', 'pending');
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(key)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ topicId: note.topicId || (groups.get(key) && groups.get(key).ids[0]) || null, delta: submittedDelta, revision: note.revision || 0, mutationId: note.pendingMutationId }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409) {
        note.dirty = true;
        note.conflict = true;
        note.pendingMutationId = null;
        note.conflictDraft = submittedDelta;
        note.conflictText = submittedText;
        note.cloudVersion = data.current || null;
        notesCache[key] = note; saveNoteCache();
        pendingNoteConflict = { key, local: submittedDelta, cloud: data.current || null };
        openNoteConflict(pendingNoteConflict);
        return false;
      }
      if (!response.ok || !data.note) throw new Error(data.message || 'Note sync failed');
      const saved = data.note;
      const latest = getNote(key);
      latest.revision = saved.revision;
      latest.updatedAt = saved.updatedAt;
      latest.lastMutationId = saved.lastMutationId;
      latest.contentHash = saved.contentHash || await deltaHash(submittedDelta);
      cloudNoteMetadata[key] = { conceptKey: key, topicId: saved.topicId || latest.topicId, hasContent: noteHasContent(submittedDelta), contentHash: latest.contentHash, revision: saved.revision, updatedAt: saved.updatedAt || null, lastMutationId: saved.lastMutationId || null };
      latest.pendingMutationId = null;
      latest.topicId = saved.topicId || latest.topicId;
      if (JSON.stringify(cleanDelta(latest.delta)) === submittedJSON) {
        latest.delta = submittedDelta;
        latest.plainText = submittedText;
        latest.dirty = false;
        latest.localOnly = false;
        latest.conflict = false;
      } else {
        latest.dirty = true;
      }
      notesCache[key] = latest; saveNoteCache();
      if (key === editorConceptKey) updateNoteState(latest.dirty ? 'Newer draft pending' : 'Saved to cloud', latest.dirty ? 'pending' : 'saved');
      setSyncStatus(progressQueue.length ? 'Syncing…' : 'Synced', progressQueue.length ? 'pending' : 'synced');
      renderTree();
      if (latest.dirty) { clearTimeout(noteSaveTimer); noteSaveTimer = setTimeout(() => saveNote(key), NOTE_SAVE_DELAY); }
      return true;
    } catch (_) {
      note.dirty = true; saveNoteCache();
      if (key === editorConceptKey) updateNoteState('Sync error — draft preserved', 'error');
      setSyncStatus(navigator.onLine ? 'Sync error — changes pending' : 'Offline — changes pending', 'error');
      return false;
    } finally {
      notesSyncBusy.delete(key);
    }
  }

  function downloadObject(filename, object) {
    const blob = new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function openNoteConflict(conflict) {
    if (!conflict) return;
    const dlg = $('#noteConflictDialog');
    const topic = byId.get(groups.get(conflict.key)?.ids[0]);
    $('#noteConflictSummary').textContent = `“${topic ? topic.title : conflict.key}” has a newer cloud revision. Your local draft is preserved on this device. Download it before switching versions, or explicitly overwrite the cloud version.`;
    if (!dlg.open) dlg.showModal();
  }

  async function resolveNoteConflict(choice) {
    const conflict = pendingNoteConflict;
    if (!conflict) return;
    const note = getNote(conflict.key);
    if (choice === 'download') {
      downloadObject(`spring-atlas-note-conflict-${conflict.key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`, { app: 'spring-atlas', schemaVersion: BACKUP_SCHEMA_VERSION, conceptKey: conflict.key, topicId: note.topicId || null, delta: conflict.local || note.delta, plainText: noteText(conflict.local || note.delta), savedAt: new Date().toISOString() });
      return;
    }
    if (choice === 'cloud') {
      if (conflict.cloud) notesCache[conflict.key] = { ...conflict.cloud, conceptKey: conflict.key, delta: cleanDelta(conflict.cloud.delta), dirty: false, localOnly: false, conflict: false };
      else delete notesCache[conflict.key];
      saveNoteCache(); pendingNoteConflict = null;
      $('#noteConflictDialog').close();
      if (navStack.length && byId.get(navStack[navStack.length - 1])?.concept_key === conflict.key) renderDetail();
      renderTree(); toast('Cloud note loaded'); return;
    }
    if (choice === 'overwrite') {
      note.revision = conflict.cloud ? (conflict.cloud.revision || 0) : 0;
      note.dirty = true; note.conflict = false; note.delta = cleanDelta(conflict.local || note.delta); note.plainText = noteText(note.delta);
      note.cloudVersion = null; notesCache[conflict.key] = note; saveNoteCache();
      const saved = await saveNote(conflict.key, { force: true });
      if (saved) { pendingNoteConflict = null; $('#noteConflictDialog').close(); toast('Local draft saved to cloud'); }
    }
  }

  /* ---------- cloud sync, migration and durable progress queue ---------- */
  function setSyncStatus(message, stateName = 'neutral') {
    const el = $('#syncStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.state = stateName;
  }

  function activeStatusMap(records) {
    const status = {};
    for (const record of records || []) {
      if (groups.has(record.conceptKey) && STATUS_IDS.includes(record.status) && record.status !== 'not_started') status[record.conceptKey] = record.status;
    }
    return status;
  }

  function makeSnapshot(status = state.status, noteMap = notesCache) {
    const safeStatus = {};
    for (const [key, value] of Object.entries(status || {})) if (groups.has(key) && STATUS_IDS.includes(value) && value !== 'not_started') safeStatus[key] = value;
    const notes = [];
    for (const [key, raw] of Object.entries(noteMap || {})) {
      if (!groups.has(key) || !raw || !raw.delta) continue;
      const delta = cleanDelta(raw.delta);
      if (!noteHasContent(delta)) continue;
      const topicId = raw.topicId && byId.has(raw.topicId) && byId.get(raw.topicId).concept_key === key ? raw.topicId : (groups.get(key).ids[0] || null);
      notes.push({ conceptKey: key, topicId, delta, plainText: noteText(delta), revision: Number.isInteger(raw.revision) ? raw.revision : 0 });
    }
    return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(), status: safeStatus, notes };
  }

  function snapshotHasData(snapshot) {
    return !!snapshot && (Object.keys(snapshot.status || {}).length > 0 || (snapshot.notes || []).length > 0 || progressQueue.length > 0);
  }

  async function snapshotsEqual(a, b) {
    const as = a && a.status || {}, bs = b && b.status || {};
    const keys = new Set([...Object.keys(as), ...Object.keys(bs)]);
    for (const key of keys) if ((as[key] || 'not_started') !== (bs[key] || 'not_started')) return false;
    const localNotes = new Map();
    for (const note of (a && a.notes) || []) localNotes.set(note.conceptKey, await deltaHash(note.delta));
    const remoteNotes = new Map(((b && b.notes) || []).map(note => [note.conceptKey, note.contentHash || null]));
    const noteKeys = new Set([...localNotes.keys(), ...remoteNotes.keys()]);
    for (const key of noteKeys) {
      const localHash = localNotes.get(key);
      const remoteHash = remoteNotes.get(key);
      if (!localHash || !remoteHash || localHash !== remoteHash) return false;
    }
    return true;
  }

  function remoteSnapshot(bootstrap, noteRows) {
    return {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      status: activeStatusMap(bootstrap.progress || []),
      notes: (noteRows || []).filter(row => groups.has(row.conceptKey) && row.hasContent !== false).map(row => ({
        conceptKey: row.conceptKey,
        topicId: row.topicId || (groups.get(row.conceptKey)?.ids[0] || null),
        contentHash: row.contentHash || null,
        revision: row.revision || 0,
        updatedAt: row.updatedAt || null,
        hasContent: true,
      })),
    };
  }

  async function fetchCloudSnapshot() {
    const healthResponse = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' });
    const health = await healthResponse.json().catch(() => ({}));
    if (!healthResponse.ok || !health.ok) {
      const error = new Error(health.message || 'Cloud storage is not ready');
      error.status = healthResponse.status;
      throw error;
    }
    const [bootstrapResponse, notesResponse] = await Promise.all([
      fetch('/api/bootstrap', { cache: 'no-store', credentials: 'same-origin' }),
      fetch('/api/notes?limit=1000', { cache: 'no-store', credentials: 'same-origin' }),
    ]);
    const bootstrap = await bootstrapResponse.json().catch(() => ({}));
    const notes = await notesResponse.json().catch(() => ({}));
    if (!bootstrapResponse.ok || !notesResponse.ok || !Array.isArray(bootstrap.progress) || !Array.isArray(notes.notes) || notes.hasMore) throw new Error('Cloud data could not be loaded');
    return { bootstrap, notes: notes.notes };
  }

  async function applyCloudSnapshot(cloud, preserveDrafts = true) {
    progressRevisions = {};
    for (const p of cloud.bootstrap.progress || []) progressRevisions[p.conceptKey] = p.revision || 0;
    state.status = activeStatusMap(cloud.bootstrap.progress || []);
    for (const pending of progressQueue) {
      if (!groups.has(pending.conceptKey) || !STATUS_IDS.includes(pending.status)) continue;
      if (pending.status === 'not_started') delete state.status[pending.conceptKey];
      else state.status[pending.conceptKey] = pending.status;
    }
    saveState();

    cloudNoteMetadata = {};
    for (const row of cloud.notes || []) {
      if (!groups.has(row.conceptKey) || row.hasContent === false) continue;
      cloudNoteMetadata[row.conceptKey] = {
        conceptKey: row.conceptKey, topicId: row.topicId || groups.get(row.conceptKey).ids[0],
        hasContent: true, contentHash: row.contentHash || null, revision: row.revision || 0,
        updatedAt: row.updatedAt || null, lastMutationId: row.lastMutationId || null,
      };
    }

    const next = {};
    for (const [key, local] of Object.entries(notesCache)) {
      if (!groups.has(key) || !local || !local.delta) continue;
      const remote = cloudNoteMetadata[key];
      const localHash = noteHasContent(local.delta) ? await deltaHash(local.delta) : null;
      const hasLocalDraft = !!(local.dirty || local.conflict || local.localOnly);
      if (preserveDrafts && hasLocalDraft) {
        if (remote && localHash && remote.contentHash && localHash === remote.contentHash) {
          local.revision = remote.revision;
          local.updatedAt = remote.updatedAt;
          local.lastMutationId = remote.lastMutationId;
          local.contentHash = remote.contentHash;
          local.dirty = false; local.localOnly = false; local.conflict = false;
        }
        next[key] = local;
        continue;
      }
      if (remote && localHash && remote.contentHash && localHash === remote.contentHash) {
        local.revision = remote.revision;
        local.updatedAt = remote.updatedAt;
        local.lastMutationId = remote.lastMutationId;
        local.contentHash = remote.contentHash;
        local.dirty = false; local.localOnly = false; local.conflict = false;
        next[key] = local;
      } else if (preserveDrafts && editorConceptKey === key) {
        // Keep an open clean editor stable during polling until its latest cloud Delta is fetched.
        next[key] = local;
      }
      // Other clean stale cache entries are discarded; full notes load lazily by topic.
    }
    notesCache = next;
    saveNoteCache();
    renderTree();
  }

  async function loadCloudNote(key) {
    if (!groups.has(key) || !cloudAvailable || !cloudWritesEnabled || !navigator.onLine) return false;
    const cached = notesCache[key];
    if (cached && (cached.dirty || cached.conflict || cached.localOnly)) return false;
    const meta = cloudNoteMetadata[key];
    if (cached && meta && cached.contentHash && meta.contentHash && cached.contentHash === meta.contentHash) {
      cached.revision = meta.revision;
      cached.updatedAt = meta.updatedAt;
      cached.lastMutationId = meta.lastMutationId;
      return true;
    }
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(key)}`, { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return false;
      if (!data.note) {
        delete notesCache[key];
        delete cloudNoteMetadata[key];
      } else {
        const saved = data.note;
        const delta = cleanDelta(saved.delta || emptyDelta());
        notesCache[key] = {
          conceptKey: key, topicId: saved.topicId || groups.get(key).ids[0], delta,
          plainText: saved.plainText || noteText(delta), contentHash: saved.contentHash || await deltaHash(delta),
          revision: saved.revision || 0, updatedAt: saved.updatedAt || null, lastMutationId: saved.lastMutationId || null,
          dirty: false, localOnly: false,
        };
        cloudNoteMetadata[key] = { conceptKey: key, topicId: saved.topicId || groups.get(key).ids[0], hasContent: noteHasContent(delta), contentHash: notesCache[key].contentHash, revision: saved.revision || 0, updatedAt: saved.updatedAt || null, lastMutationId: saved.lastMutationId || null };
      }
      saveNoteCache(); renderTree();
      if ($('#detail').open && navStack.length && byId.get(navStack[navStack.length - 1])?.concept_key === key && !notesCache[key]?.dirty) {
        // Discard the clean editor instance before rendering so it cannot recapture stale contents.
        editor = null; editorFallback = null; editorConceptKey = null;
        renderDetail();
      }
      return true;
    } catch (_) { return false; }
  }

  async function fetchAllCloudNotes() {
    const result = new Map();
    let cursor = null;
    do {
      const params = new URLSearchParams({ includeContent: '1', limit: '10' });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/notes?${params.toString()}`, { cache: 'no-store', credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.notes)) throw new Error('Cloud notes could not be exported');
      for (const note of body.notes) result.set(note.conceptKey, note);
      cursor = body.hasMore ? body.nextCursor : null;
    } while (cursor);
    return result;
  }

  function showMigrationDialog(snapshot, reason, cloud) {
    pendingLocalSnapshot = snapshot;
    migrationReason = reason;
    const dlg = $('#migrationDialog');
    const localProgress = Object.keys(snapshot.status || {}).length;
    const localNotes = (snapshot.notes || []).length;
    const remote = cloud || { status: {}, notes: [] };
    const remoteProgress = Object.keys(remote.status || {}).length;
    const remoteNotes = (remote.notes || []).length;
    $('#migrationSummary').textContent = reason === 'empty-cloud'
      ? 'This browser has existing progress or notes, but the cloud database is empty. Import them only after reviewing the counts below.'
      : 'Both this browser and cloud storage have data. Choose how to reconcile it; nothing will be overwritten without your explicit choice.';
    $('#migrationCounts').textContent = `This browser: ${localProgress} progress marks, ${localNotes} non-empty notes. Cloud: ${remoteProgress} progress marks, ${remoteNotes} non-empty notes.`;
    $('#migrationMergeBtn').textContent = reason === 'empty-cloud' ? 'Import local data to cloud' : 'Merge local-only items';
    $('#migrationReplaceBtn').hidden = reason === 'empty-cloud' && !remoteProgress && !remoteNotes;
    $('#migrationResult').textContent = '';
    if (!dlg.open) dlg.showModal();
  }

  async function initializeCloudSync() {
    const localSnapshot = makeSnapshot();
    const localHasData = snapshotHasData(localSnapshot);
    setSyncStatus('Loading cloud data…', 'neutral');
    try {
      const cloud = await fetchCloudSnapshot();
      cloudAvailable = true;
      cloudLoaded = true;
      const remote = remoteSnapshot(cloud.bootstrap, cloud.notes);
      const cloudHasData = (cloud.bootstrap.syncMetadata?.progressCount || 0) > 0 || (cloud.bootstrap.syncMetadata?.notesCount || 0) > 0;
      if (localHasData && !cloudHasData) {
        pendingLocalSnapshot = localSnapshot;
        cloudWritesEnabled = false;
        migrationPaused = true;
        setSyncStatus('Local data awaiting import', 'pending');
        refresh(null, false);
        showMigrationDialog(localSnapshot, 'empty-cloud', remote);
      } else {
        const hasDiff = localHasData && !(await snapshotsEqual(localSnapshot, remote));
        if (hasDiff && !cloudLinked) {
          // Keep browser data untouched until the learner chooses merge or replace.
          cloudWritesEnabled = false;
          migrationPaused = true;
          setSyncStatus('Review local/cloud differences', 'pending');
          refresh(null, false);
          showMigrationDialog(localSnapshot, 'cloud-existing', remote);
        } else {
          await applyCloudSnapshot(cloud, cloudLinked);
          cloudWritesEnabled = true;
          migrationPaused = false;
          cloudLinked = true; saveSyncQueue();
          if ($('#detail').open && navStack.length) await loadCloudNote(byId.get(navStack[navStack.length - 1])?.concept_key);
          setSyncStatus(progressQueue.length ? 'Syncing…' : 'Synced', progressQueue.length ? 'pending' : 'synced');
          refresh(null, false);
          flushProgressQueue();
          for (const [key, note] of Object.entries(notesCache)) if (note.dirty) saveNote(key);
        }
      }
      syncTimer = setInterval(() => revalidateCloud(), SYNC_INTERVAL_MS);
    } catch (_) {
      cloudAvailable = false;
      cloudWritesEnabled = false;
      setSyncStatus(navigator.onLine ? 'Local only — cloud not ready' : 'Offline — local changes retained', 'pending');
      refresh(null, false);
    }
  }

  async function revalidateCloud() {
    if (syncBusy || !cloudWritesEnabled || !cloudAvailable || document.hidden || !navigator.onLine) return;
    syncBusy = true;
    try {
      const cloud = await fetchCloudSnapshot();
      await applyCloudSnapshot(cloud, true);
      if ($('#detail').open && navStack.length) await loadCloudNote(byId.get(navStack[navStack.length - 1])?.concept_key);
      setSyncStatus(progressQueue.length ? 'Syncing…' : 'Synced', progressQueue.length ? 'pending' : 'synced');
      refresh(null, false);
      for (const [key, note] of Object.entries(notesCache)) if (note.dirty && !note.conflict) saveNote(key);
    } catch (_) {
      setSyncStatus(navigator.onLine ? 'Sync error — changes pending' : 'Offline — changes pending', 'error');
    } finally { syncBusy = false; if (progressQueue.length) flushProgressQueue(); }
  }

  async function flushProgressQueue() {
    if (syncBusy || !cloudAvailable || !cloudWritesEnabled || !navigator.onLine || !progressQueue.length) return;
    syncBusy = true;
    setSyncStatus('Syncing…', 'pending');
    try {
      while (progressQueue.length && cloudAvailable && cloudWritesEnabled && navigator.onLine) {
        const item = progressQueue[0];
        if (!groups.has(item.conceptKey) || !STATUS_IDS.includes(item.status)) { progressQueue.shift(); saveSyncQueue(); continue; }
        let attempts = 0;
        let done = false;
        while (attempts < 2 && !done) {
          attempts++;
          const revision = progressRevisions[item.conceptKey] || 0;
          const response = await fetch(`/api/progress/${encodeURIComponent(item.conceptKey)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ status: item.status, revision, mutationId: item.mutationId }),
          });
          const data = await response.json().catch(() => ({}));
          if (response.status === 409 && data.current && attempts < 2) {
            // Same-concept conflict policy: replay this user's queued action against the newest revision.
            // Other concept keys are never replaced by a stale full-browser snapshot.
            progressRevisions[item.conceptKey] = data.current.revision || 0;
            continue;
          }
          if (!response.ok || !data.progress) throw new Error('Progress sync failed');
          progressRevisions[item.conceptKey] = data.progress.revision || 0;
          progressQueue.shift(); saveSyncQueue(); done = true;
        }
      }
      setSyncStatus(progressQueue.length ? 'Offline — changes pending' : 'Synced', progressQueue.length ? 'pending' : 'synced');
    } catch (_) {
      setSyncStatus(navigator.onLine ? 'Sync error — changes pending' : 'Offline — changes pending', 'error');
    } finally {
      syncBusy = false;
      if (progressQueue.length && cloudAvailable && cloudWritesEnabled && navigator.onLine && !syncBusy) {
        // One bounded follow-up lets a queue continue after a brief race without a tight retry loop.
        if (progressQueue[0] && progressQueue[0].retryAfter) return;
      }
    }
  }

  async function performMigration(mode, sourceSnapshot = pendingLocalSnapshot) {
    if (!sourceSnapshot) return;
    if (mode === 'replace') {
      if (!confirm('Replace all cloud progress and notes with this browser’s backup? Download the current data first if you may need it later.')) return;
      await exportBackup();
    }
    try {
      const archiveKey = `spring-atlas:pre-migration:${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { localStorage.setItem(archiveKey, JSON.stringify(sourceSnapshot)); } catch (_) { /* still continue with the downloaded backup path */ }
      $('#migrationMergeBtn').disabled = true; $('#migrationReplaceBtn').disabled = true;
      $('#migrationResult').textContent = 'Applying the selected migration…';
      const response = await fetch('/api/migrate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ schemaVersion: 1, migrationId: makeId('migration'), mode, confirmReplace: mode === 'replace', progress: Object.entries(sourceSnapshot.status || {}).map(([conceptKey, status]) => ({ conceptKey, status })), notes: (sourceSnapshot.notes || []).map(n => ({ conceptKey: n.conceptKey, topicId: n.topicId || null, delta: cleanDelta(n.delta) })) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'Migration failed');
      const cloud = await fetchCloudSnapshot();
      await applyCloudSnapshot(cloud, false);
      cloudAvailable = true; cloudLoaded = true; cloudWritesEnabled = true; migrationPaused = false; cloudLinked = true; saveSyncQueue(); pendingLocalSnapshot = null; migrationReason = '';
      if ($('#detail').open && navStack.length) await loadCloudNote(byId.get(navStack[navStack.length - 1])?.concept_key);
      $('#migrationDialog').close();
      refresh(null, false);
      setSyncStatus('Synced', 'synced');
      toast(`Migration complete: ${result.progressAdded} progress marks and ${result.notesAdded} notes added`);
      flushProgressQueue();
    } catch (_) {
      $('#migrationResult').textContent = 'Migration failed. Local data is still saved on this device. Download a backup and check the API/database configuration before retrying.';
      setSyncStatus('Sync error — local data retained', 'error');
    } finally {
      $('#migrationMergeBtn').disabled = false; $('#migrationReplaceBtn').disabled = false;
    }
  }

  function keepMigrationLocal() {
    const dlg = $('#migrationDialog');
    migrationPaused = true;
    dlg.close();
    if (migrationReason === 'empty-cloud') {
      cloudWritesEnabled = false;
      setSyncStatus('Local only — import postponed', 'pending');
    } else {
      cloudWritesEnabled = false;
      setSyncStatus('Local only — differences retained; sync paused', 'pending');
    }
    pendingLocalSnapshot = null;
    migrationReason = '';
  }

  /* ---------- detail dialog ---------- */
  function buildPrompt(n) {
    const r = readiness(n);
    const titles = list => list.length ? uniqueByConcept(list).map(x => x.title).join(', ') : 'None';
    const pathStr = [sectionTitle(n.section), ...(n.path && n.path.length ? n.path : [n.title])].join(' > ');
    const map = {
      title: n.title, path: pathStr,
      importance: IMPORTANCE_LABEL[n.importance] || n.importance, difficulty: n.difficulty,
      learned_prereqs: n.prerequisites.length ? titles(r.learned) : 'None (no explicit prerequisites)',
      missing_prereqs: n.prerequisites.length ? titles(r.missing) : 'None (no explicit prerequisites)',
    };
    return PROMPT_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? '');
  }

  function linkItem(n, extra = '') {
    const st = statusOf(n), m = statusMeta(st);
    return `<li><button type="button" class="link-item" data-goto="${esc(n.id)}">
      <span class="dot s-${st}" title="${esc(m.label)}" aria-hidden="true">${m.icon}</span>
      <span class="li-main"><span class="li-title">${esc(n.title)}</span><span class="li-sub">${esc(sectionTitle(n.section))}${extra}</span></span>
      <span class="sr">${esc(m.label)}</span>
    </button></li>`;
  }

  function renderDetail() {
    if (editor && editorConceptKey) captureActiveDraft(false);
    editor = null; editorConceptKey = null;
    const id = navStack[navStack.length - 1];
    const n = byId.get(id);
    if (!n) return;
    const r = readiness(n);
    const st = statusOf(n);
    const g = groups.get(n.concept_key);
    const ul = unlockNodes(n);
    const trail = [sectionTitle(n.section), ...(n.path && n.path.length ? n.path : [n.title])];
    const prompt = buildPrompt(n);
    const others = g.ids.filter(i => i !== n.id).map(i => byId.get(i));
    const hasPre = n.prerequisites.length > 0;

    let h = `<div class="d-bar">
      <button type="button" class="btn ghost small" data-back ${navStack.length > 1 ? '' : 'hidden'}>← Back</button>
      <button type="button" class="btn ghost small" data-reveal="${esc(n.id)}">Show in syllabus</button>
      <button type="button" class="btn ghost small close" data-close aria-label="Close">✕</button>
    </div>
    <p class="crumbs">${trail.map((t, i) => i === trail.length - 1 ? `<b>${esc(t)}</b>` : esc(t)).join(' <span aria-hidden="true">›</span> ')}</p>
    <h2 id="dTitle" tabindex="-1">${esc(n.title)}</h2>
    <p class="d-badges">${badge('imp-' + n.importance, IMPORTANCE_LABEL[n.importance] || n.importance)}${badge('dif-' + n.difficulty, n.difficulty)}${n.core30 ? badge('c30', '★ Core 30') : ''}<code class="id">${esc(n.id)}</code></p>

    <div class="ready ${r.ready ? 'ok' : 'warn'}">
      <strong>${r.ready ? 'Ready' : 'Partially ready'}</strong>
      <span>${!hasPre ? 'No explicit prerequisites. Jump right in.' : r.ready ? 'All prerequisites are learned.' : `${r.learned.length} of ${n.prerequisites.length} prerequisites learned. You can still open this topic.`}</span>
    </div>

    <fieldset class="status-set"><legend>Status</legend>
      <div class="seg">${STATUSES.map(s => `<label class="${st === s.id ? 'on' : ''}"><input type="radio" name="status" value="${s.id}" ${st === s.id ? 'checked' : ''}><span><span aria-hidden="true">${s.icon}</span> ${esc(s.label)}</span></label>`).join('')}</div>
    </fieldset>`;

    if (others.length) {
      h += `<p class="note shared">⇄ Shared concept. Progress is shared with ${others.length} other occurrence${others.length > 1 ? 's' : ''}: ${others.map(o => `<button type="button" class="inline" data-goto="${esc(o.id)}">${esc([sectionTitle(o.section), ...(o.path || [])].join(' › '))}</button>`).join(', ')}.</p>`;
    }
    if (n.notes) h += `<p class="note">${esc(n.notes)}</p>`;

    h += `<div class="cols">
      <section><h3>Prerequisites ${hasPre ? `<span class="count">${n.prerequisites.length}</span>` : ''}</h3>`;
    if (!hasPre) h += `<p class="muted">None listed.</p>`;
    else {
      if (r.missing.length) h += `<p class="sub warn-t">Not yet learned (${r.missing.length})</p><ul class="links">${r.missing.map(x => linkItem(x)).join('')}</ul>`;
      if (r.learned.length) h += `<p class="sub ok-t">Learned (${r.learned.length})</p><ul class="links">${r.learned.map(x => linkItem(x)).join('')}</ul>`;
    }
    h += `</section><section><h3>Unlocks ${ul.length ? `<span class="count">${ul.length}</span>` : ''}</h3>`;
    h += ul.length ? `<ul class="links">${ul.map(x => linkItem(x)).join('')}</ul>` : `<p class="muted">Nothing lists this as a prerequisite.</p>`;
    h += `</section></div>`;

    const terms = [...n.aliases, ...n.tags];
    if (terms.length) h += `<section><h3>Also searchable as</h3><p class="terms">${terms.map(t => `<span class="term">${esc(t)}</span>`).join('')}</p></section>`;

    const currentNote = notesCache[n.concept_key] || {};
    const saveLabel = currentNote.dirty ? 'Unsaved changes' : (cloudWritesEnabled && cloudAvailable ? 'Saved to cloud' : 'Saved on this device');
    h += `<section class="notes-section" aria-labelledby="notesHeading">
      <div class="notes-head"><h3 id="notesHeading">Notes</h3><div class="notes-head-actions">${currentNote.conflict ? '<button type="button" class="btn ghost small" data-resolve-note-conflict>Resolve conflict</button>' : ''}<span class="note-save-state" id="noteSaveState" data-state="${currentNote.dirty ? 'pending' : 'saved'}">${esc(saveLabel)}</span></div></div>
      <p class="note-help">Topic-specific rich notes. Changes save automatically; cloud sync is available when the app is deployed with storage configured.</p>
      <div class="note-toolbar" id="noteToolbar" role="toolbar" aria-label="Note formatting">
        <span class="ql-formats"><select class="ql-header" aria-label="Heading"><option selected></option><option value="1">H1</option><option value="2">H2</option><option value="3">H3</option></select></span>
        <span class="ql-formats"><button type="button" class="ql-bold" aria-label="Bold" title="Bold"></button><button type="button" class="ql-italic" aria-label="Italic" title="Italic"></button><button type="button" class="ql-underline" aria-label="Underline" title="Underline"></button><button type="button" class="ql-strike" aria-label="Strikethrough" title="Strikethrough"></button></span>
        <span class="ql-formats"><select class="ql-color" aria-label="Text color"><option selected></option><option value="#b91c1c"></option><option value="#c2410c"></option><option value="#b7791f"></option><option value="#15803d"></option><option value="#0369a1"></option><option value="#6d28d9"></option><option value="#1d231f"></option><option value="#7a847c"></option></select><select class="ql-background" aria-label="Highlight color"><option selected></option><option value="#fee2e2"></option><option value="#ffedd5"></option><option value="#fef3c7"></option><option value="#dcfce7"></option><option value="#dbeafe"></option><option value="#ede9fe"></option></select></span>
        <span class="ql-formats"><button type="button" class="ql-list" value="bullet" aria-label="Bulleted list" title="Bulleted list"></button><button type="button" class="ql-list" value="ordered" aria-label="Numbered list" title="Numbered list"></button><button type="button" class="ql-indent" value="-1" aria-label="Decrease indent" title="Decrease indent"></button><button type="button" class="ql-indent" value="+1" aria-label="Increase indent" title="Increase indent"></button></span>
        <span class="ql-formats"><button type="button" class="ql-blockquote" aria-label="Blockquote" title="Blockquote"></button><button type="button" class="ql-code-block" aria-label="Code block" title="Code block"></button><button type="button" class="ql-link" aria-label="Insert link" title="Insert link"></button></span>
        <span class="ql-formats"><button type="button" class="ql-callout" value="info" data-label="Info" aria-label="Info callout" title="Info callout">Info</button><button type="button" class="ql-callout" value="tip" data-label="Tip" aria-label="Tip callout" title="Tip callout">Tip</button><button type="button" class="ql-callout" value="warning" data-label="Warn" aria-label="Warning callout" title="Warning callout">Warn</button></span>
        <span class="ql-formats"><button type="button" class="ql-undo" aria-label="Undo" title="Undo">↶</button><button type="button" class="ql-redo" aria-label="Redo" title="Redo">↷</button><button type="button" class="ql-clean" aria-label="Clear formatting" title="Clear formatting"></button></span>
      </div>
      <div class="note-editor-wrap"><div id="noteEditor" class="note-editor" aria-label="Notes for ${esc(n.title)}"></div></div>
    </section>`;

    h += `<section><h3>AI study prompt</h3>
      <p class="muted small-t">Reflects your current progress. Paste into any AI chat.</p>
      <textarea class="prompt" readonly rows="10" aria-label="Generated AI study prompt">${esc(prompt)}</textarea>
      <div class="prompt-actions"><button type="button" class="btn" data-copy>Copy prompt</button></div>
    </section>`;

    const body = $('#detailBody');
    const keepScroll = body.parentElement.scrollTop;
    body.innerHTML = h;
    body.parentElement.scrollTop = keepScroll;
    initNoteEditor(n);
  }

  async function openDetail(id, push = true) {
    if (!byId.has(id)) return;
    const target = byId.get(id);
    if (editorConceptKey && editorConceptKey !== target.concept_key) await flushCurrentNote();
    if (editorConceptKey !== target.concept_key) await loadCloudNote(target.concept_key);
    const dlg = $('#detail');
    if (!dlg.open) { navStack = []; lastTrigger = document.activeElement; }
    if (push) navStack.push(id); else navStack = [id];
    renderDetail();
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    const t = $('#dTitle'); if (t) t.focus({ preventScroll: true });
    try { history.replaceState(null, '', '#' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
  }

  async function revealInTree(id) {
    let n = byId.get(id);
    if (!n) return;
    await flushCurrentNote();
    // clear filters that would hide it
    if (visible && !visible.has(id)) clearFilters(true);
    open.add('sec:' + n.section);
    let p = n.parent_id ? byId.get(n.parent_id) : null;
    while (p) { open.add(p.id); p = p.parent_id ? byId.get(p.parent_id) : null; }
    const dlg = $('#detail'); if (dlg.open) dlg.close();
    renderTree();
    const row = $(`.node[data-id="${cssId(id)}"] > .row`);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.add('flash');
      const b = $('.ttl', row); if (b) b.focus({ preventScroll: true });
      setTimeout(() => row.classList.remove('flash'), 1800);
    }
  }

  /* ---------- misc UI ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function clearFilters(silent) {
    Object.assign(ui, { search: '', importance: '', difficulty: '', status: '', ready: '', core30: false });
    $('#search').value = ''; $('#fImportance').value = ''; $('#fDifficulty').value = '';
    $('#fStatus').value = ''; $('#fReady').value = ''; $('#fCore30').checked = false;
    if (!silent) renderTree();
  }

  function randomTopic() {
    const cand = nodes.filter(n => { const s = statusOf(n); return s !== 'learned' && s !== 'skip_for_now'; });
    if (!cand.length) return toast('Nothing left to pick. Everything is learned or skipped.');
    const ready = cand.filter(n => readiness(n).ready);
    const core = ready.filter(n => n.importance === 'CORE');
    const pool = core.length ? core : ready.length ? ready : cand;
    openDetail(pool[Math.floor(Math.random() * pool.length)].id, false);
  }

  async function exportBackup(snapshot = null) {
    await flushCurrentNote();
    let source = snapshot || makeSnapshot();
    if (!snapshot && cloudAvailable && cloudWritesEnabled && navigator.onLine) {
      try {
        const merged = await fetchAllCloudNotes();
        for (const note of source.notes || []) {
          const cached = notesCache[note.conceptKey];
          if ((cached && (cached.dirty || cached.localOnly || cached.conflict)) || !merged.has(note.conceptKey)) merged.set(note.conceptKey, note);
        }
        source = { ...source, notes: Array.from(merged.values()).filter(n => noteHasContent(n.delta)) };
      } catch (_) { toast('Cloud backup could not be confirmed; exporting local cache and drafts'); }
    }
    const payload = {
      app: 'spring-atlas', schemaVersion: BACKUP_SCHEMA_VERSION,
      syllabusSchemaVersion: '1.0.0', exportedAt: new Date().toISOString(),
      progress: { status: source.status || {} },
      // Legacy status field remains for compatibility with existing progress-only exports.
      status: source.status || {},
      notes: (source.notes || []).map(n => ({ conceptKey: n.conceptKey, topicId: n.topicId || null, delta: cleanDelta(n.delta), plainText: noteText(n.delta), revision: n.revision || 0 })),
    };
    downloadObject('spring-atlas-backup.json', payload);
    return payload;
  }

  function normalizeImportedNote(item, conceptKey) {
    if (!item || typeof item !== 'object') return null;
    let delta = null;
    if (item.delta && Array.isArray(item.delta.ops)) delta = cleanDelta(item.delta);
    else if (typeof item.text === 'string') delta = cleanDelta({ ops: [{ insert: item.text.endsWith('\n') ? item.text : item.text + '\n' }] });
    else if (typeof item.content === 'string') {
      // Legacy HTML/string notes are converted to text only; untrusted HTML is never injected.
      const parser = new DOMParser();
      const text = parser.parseFromString(item.content, 'text/html').body.textContent || item.content;
      delta = cleanDelta({ ops: [{ insert: text.endsWith('\n') ? text : text + '\n' }] });
    }
    if (!delta || !noteHasContent(delta) || !groups.has(conceptKey)) return null;
    const topicId = item.topicId && byId.has(item.topicId) && byId.get(item.topicId).concept_key === conceptKey ? item.topicId : groups.get(conceptKey).ids[0];
    return { conceptKey, topicId, delta, plainText: noteText(delta), revision: Number.isInteger(item.revision) && item.revision >= 0 ? item.revision : 0 };
  }

  function discoverLegacyNotes() {
    let keys = [];
    try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); }
    catch (_) { return; }
    for (const storageKey of keys) {
      if (!storageKey || storageKey === NOTES_KEY || !/spring[-_:]?atlas.*notes?|notes?.*spring[-_:]?atlas/i.test(storageKey)) continue;
      const rawText = (() => { try { return localStorage.getItem(storageKey); } catch (_) { return null; } })();
      const parsed = safeJsonParse(rawText);
      if (!parsed || typeof parsed !== 'object') continue;
      let entries = null;
      const nested = parsed.notes || parsed.richNotes || parsed.notesByConcept || parsed.topicNotes || parsed.data;
      if (Array.isArray(nested)) entries = nested.map(item => [item && (item.conceptKey || item.key || item.topicId), item]);
      else if (nested && typeof nested === 'object') entries = Object.entries(nested);
      else if (Object.keys(parsed).some(k => groups.has(k))) entries = Object.entries(parsed);
      if (!entries) continue;
      for (const [key, value] of entries) {
        if (!groups.has(key) || notesCache[key] && noteHasContent(notesCache[key].delta)) continue;
        const shaped = typeof value === 'string' ? { content: value } : (value || {});
        const normalized = normalizeImportedNote(shaped, key);
        if (normalized) notesCache[key] = { ...normalized, dirty: false, localOnly: true, legacySource: storageKey };
      }
    }
  }

  function parseBackupFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const obj = JSON.parse(reader.result);
        const rawStatus = obj && (obj.progress && obj.progress.status || obj.status);
        if (!rawStatus || typeof rawStatus !== 'object' || Array.isArray(rawStatus)) throw new Error('bad_progress');
        const status = {};
        let skippedProgress = 0;
        for (const [key, value] of Object.entries(rawStatus)) {
          if (groups.has(key) && STATUS_IDS.includes(value) && value !== 'not_started') status[key] = value;
          else skippedProgress++;
        }
        const rawNotes = Array.isArray(obj.notes) ? obj.notes : (obj.notes && typeof obj.notes === 'object' ? Object.entries(obj.notes).map(([conceptKey, value]) => ({ conceptKey, ...(typeof value === 'string' ? { content: value } : value) })) : []);
        const notes = [];
        let skippedNotes = 0;
        const seen = new Set();
        for (const item of rawNotes) {
          const key = item && (item.conceptKey || item.key);
          const note = normalizeImportedNote(item, key);
          if (!note || seen.has(key)) { skippedNotes++; continue; }
          seen.add(key); notes.push(note);
        }
        const incoming = { schemaVersion: BACKUP_SCHEMA_VERSION, status, notes };
        const current = makeSnapshot();
        const currentNoteMap = new Map(current.notes.map(n => [n.conceptKey, n]));
        const incomingNoteMap = new Map(notes.map(n => [n.conceptKey, n]));
        const counts = { progressAdds: 0, progressReplacements: 0, progressConflicts: 0, progressSkips: skippedProgress, noteAdds: 0, noteReplacements: 0, noteConflicts: 0, noteSkips: skippedNotes };
        for (const [key, value] of Object.entries(status)) {
          if (!current.status[key]) counts.progressAdds++;
          else if (current.status[key] === value) counts.progressSkips++;
          else { counts.progressReplacements++; counts.progressConflicts++; }
        }
        for (const [key, value] of incomingNoteMap) {
          const old = currentNoteMap.get(key);
          const localDraft = notesCache[key] && (notesCache[key].dirty || notesCache[key].localOnly || notesCache[key].conflict);
          const remote = cloudAvailable && cloudWritesEnabled && !localDraft ? cloudNoteMetadata[key] : null;
          if (remote) {
            const importedHash = await deltaHash(value.delta);
            if (remote.contentHash && importedHash && remote.contentHash === importedHash) counts.noteSkips++;
            else { counts.noteReplacements++; counts.noteConflicts++; }
          } else if (!old) {
            if (cloudAvailable && cloudWritesEnabled && !localDraft && !cloudNoteMetadata[key]) counts.noteAdds++;
            else if (localDraft) { counts.noteReplacements++; counts.noteConflicts++; }
            else counts.noteAdds++;
          } else if (JSON.stringify(cleanDelta(old.delta)) === JSON.stringify(cleanDelta(value.delta))) counts.noteSkips++;
          else { counts.noteReplacements++; counts.noteConflicts++; }
        }
        pendingImportSnapshot = incoming;
        pendingImportCounts = counts;
        $('#importPreviewSummary').textContent = `Backup contains ${Object.keys(status).length} valid progress marks and ${notes.length} non-empty notes. ${obj.schemaVersion || obj.v ? `Backup schema: ${obj.schemaVersion || obj.v}.` : 'Legacy progress backup detected.'}`;
        $('#importPreviewCounts').textContent = `Progress: ${counts.progressAdds} new, ${counts.progressReplacements} changed, ${counts.progressSkips} skipped. Notes: ${counts.noteAdds} new, ${counts.noteReplacements} changed, ${counts.noteSkips} skipped.`;
        $('#importPreviewDialog').showModal();
      } catch (_) { toast('That file is not a valid Spring Atlas backup'); }
    };
    reader.onerror = () => toast('Could not read the selected file');
    reader.readAsText(file);
  }

  async function applyBackup(mode) {
    if (!pendingImportSnapshot) return;
    const incoming = pendingImportSnapshot;
    if (mode === 'replace' && !confirm('Replace all current progress and notes with this backup? A backup of current data will be downloaded first.')) return;
    if (mode === 'replace') await exportBackup();
    if (cloudAvailable && cloudWritesEnabled) {
      $('#importMergeBtn').disabled = true; $('#importReplaceBtn').disabled = true;
      try {
        const response = await fetch('/api/migrate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ schemaVersion: 1, migrationId: makeId('backup-import'), mode, confirmReplace: mode === 'replace', progress: Object.entries(incoming.status).map(([conceptKey, status]) => ({ conceptKey, status })), notes: incoming.notes.map(n => ({ conceptKey: n.conceptKey, topicId: n.topicId, delta: n.delta })) }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.message || 'Import failed');
        const cloud = await fetchCloudSnapshot(); await applyCloudSnapshot(cloud, false);
        cloudLinked = true; migrationPaused = false; cloudWritesEnabled = true; cloudAvailable = true; saveSyncQueue();
        if ($('#detail').open && navStack.length) await loadCloudNote(byId.get(navStack[navStack.length - 1])?.concept_key);
        setSyncStatus('Synced', 'synced'); toast('Backup applied to cloud');
      } catch (_) { toast('Import failed. Current data and the selected backup are still available.'); }
      finally { $('#importMergeBtn').disabled = false; $('#importReplaceBtn').disabled = false; }
    } else {
      const current = makeSnapshot();
      if (mode === 'replace') {
        state.status = { ...incoming.status };
        notesCache = Object.fromEntries(incoming.notes.map(n => [n.conceptKey, { ...n, dirty: false, localOnly: true }]));
      } else {
        state.status = { ...current.status, ...Object.fromEntries(Object.entries(incoming.status).filter(([key]) => !current.status[key])) };
        for (const n of incoming.notes) if (!notesCache[n.conceptKey]) notesCache[n.conceptKey] = { ...n, dirty: false, localOnly: true };
      }
      saveState(); saveNoteCache(); refresh(); setSyncStatus('Local only — backup applied', 'pending'); toast('Backup applied locally');
    }
    $('#importPreviewDialog').close(); pendingImportSnapshot = null; pendingImportCounts = null;
  }

  function safeRenderedNoteHtml(delta) {
    if (!window.Quill) {
      return `<p>${esc(noteText(delta)).replace(/\n/g, '<br>')}</p>`;
    }
    registerNoteBlots();
    const host = document.createElement('div');
    host.style.position = 'fixed'; host.style.left = '-10000px'; host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    let html = '';
    try {
      const view = new Quill(host, { readOnly: true, theme: 'snow', modules: { toolbar: false } });
      view.setContents(cleanDelta(delta), 'silent');
      html = sanitizeRenderedHtml(view.root.innerHTML);
    } finally { host.remove(); }
    return html;
  }

  function sanitizeRenderedHtml(raw) {
    const allowedTags = new Set(['P', 'H1', 'H2', 'H3', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SPAN', 'OL', 'UL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'DIV', 'BR', 'HR', 'SUB', 'SUP']);
    const parser = new DOMParser();
    const parsed = parser.parseFromString(`<div id="root">${raw}</div>`, 'text/html');
    const root = parsed.getElementById('root');
    function render(node) {
      if (node.nodeType === Node.TEXT_NODE) return esc(node.nodeValue);
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName;
      const children = Array.from(node.childNodes).map(render).join('');
      if (!allowedTags.has(tag)) return children;
      let attrs = '';
      if (tag === 'A') {
        const href = node.getAttribute('href');
        if (href && validLink(href)) attrs += ` href="${esc(href)}" rel="noopener noreferrer"`;
      }
      const style = node.getAttribute('style') || '';
      const styleBits = [];
      for (const declaration of style.split(';')) {
        const [key, value] = declaration.split(':').map(part => (part || '').trim());
        if (!value) continue;
        if (['color', 'background-color'].includes(key) && (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) || /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(value))) styleBits.push(`${key}:${value}`);
        if (key === 'margin-left' && /^(?:[0-9.]+)(?:px|em|rem)$/.test(value)) styleBits.push(`${key}:${value}`);
      }
      if (styleBits.length) attrs += ` style="${esc(styleBits.join(';'))}"`;
      const classes = (node.getAttribute('class') || '').split(/\s+/).filter(c => /^ql-(?:callout|code-block|code-block-container|indent-[1-8]|syntax)$/.test(c));
      if (classes.length) attrs += ` class="${esc(classes.join(' '))}"`;
      const callout = node.getAttribute('data-callout');
      if (classes.includes('ql-callout') && ['info', 'tip', 'warning'].includes(callout)) attrs += ` data-callout="${callout}"`;
      return `<${tag.toLowerCase()}${attrs}>${children}</${tag.toLowerCase()}>`;
    }
    return Array.from(root.childNodes).map(render).join('');
  }

  async function exportNotesPdf() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast('Allow pop-ups to open the print view'); return; }
    await flushCurrentNote();
    let source = makeSnapshot();
    if (cloudAvailable && cloudWritesEnabled && navigator.onLine) {
      try {
        const merged = await fetchAllCloudNotes();
        for (const note of source.notes) {
          const cached = notesCache[note.conceptKey];
          if ((cached && (cached.dirty || cached.localOnly || cached.conflict)) || !merged.has(note.conceptKey)) merged.set(note.conceptKey, note);
        }
        source = { ...source, notes: Array.from(merged.values()).filter(n => noteHasContent(n.delta)) };
      } catch (_) { toast('Using the latest local cache/draft; cloud could not be confirmed'); }
    } else if (!cloudAvailable || !cloudWritesEnabled || Object.values(notesCache).some(n => n.dirty)) {
      toast('Using local cache/drafts; cloud sync could not be confirmed');
    }
    const canonicalOrder = new Map();
    for (const n of nodes) if (!canonicalOrder.has(n.concept_key)) canonicalOrder.set(n.concept_key, n);
    const noteMap = new Map((source.notes || []).map(n => [n.conceptKey, n]));
    const ordered = Array.from(noteMap.entries()).map(([key, note]) => ({ node: canonicalOrder.get(key), note })).filter(x => x.node && noteHasContent(x.note.delta)).sort((a, b) => nodes.indexOf(a.node) - nodes.indexOf(b.node));
    if (!ordered.length) {
      printWindow.close(); toast('No saved notes to export yet'); return;
    }
    const items = ordered.map(({ node, note }, index) => {
      const path = [sectionTitle(node.section), ...(node.path && node.path.length ? node.path : [node.title])];
      return { index: index + 1, title: node.title, path, html: safeRenderedNoteHtml(note.delta) };
    });
    const toc = items.map(item => `<li><a href="#note-${item.index}">${esc(item.path.join(' › '))}</a></li>`).join('');
    const bodyHtml = items.map(item => `<section class="print-note" id="note-${item.index}"><h2>${esc(item.title)}</h2><p class="print-path">${esc(item.path.join(' › '))}</p><div class="print-content">${item.html}</div></section>`).join('');
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spring Atlas — Notes</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css"><style>
      @page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}body{margin:0;color:#191919;font:10.5pt/1.55 Georgia,serif}.print-cover{page-break-after:always;padding-top:20mm}.print-title{font:700 27pt/1.1 Georgia,serif;margin:0 0 6pt}.print-subtitle{color:#555;margin:0 0 24pt}.print-toc{page-break-after:always}.print-toc h2{font-size:19pt}.print-toc li{margin:3pt 0;overflow-wrap:anywhere}.print-toc a{color:#222;text-decoration:none}.print-note{margin-bottom:1.2cm;break-inside:auto}.print-note h2{font:700 17pt/1.2 Georgia,serif;margin:0 0 5pt;break-after:avoid}.print-path{font:8.5pt/1.4 Arial,sans-serif;color:#555;margin:0 0 12pt;overflow-wrap:anywhere}.print-content h1{font-size:18pt;break-after:avoid}.print-content h2{font-size:15pt;break-after:avoid}.print-content h3{font-size:12pt;break-after:avoid}.print-content pre,.print-content .ql-code-block-container,.print-content .ql-code-block{white-space:pre-wrap!important;overflow-wrap:anywhere;word-break:normal;font:8.5pt/1.4 Consolas,monospace;background:#f2f2f2!important;color:#111!important;border:1px solid #ddd;padding:5pt}.print-content blockquote{border-left:3px solid #888;margin-left:0;padding-left:10pt;color:#444}.print-content .ql-callout{display:block;padding:7pt 9pt;margin:8pt 0;border-left:3px solid #888;background:#f6f6f6!important;break-inside:avoid}.print-content .ql-callout[data-callout="info"]{border-color:#5383bc}.print-content .ql-callout[data-callout="tip"]{border-color:#2f7d4f}.print-content .ql-callout[data-callout="warning"]{border-color:#a8571a}.print-content a{color:#111;overflow-wrap:anywhere}.print-content ol,.print-content ul{padding-left:20pt}.print-content img{max-width:100%}@media print{a{color:inherit}}
      </style></head><body><header class="print-cover"><h1 class="print-title">Spring Atlas</h1><p class="print-subtitle">Java + Spring Boot Backend Engineering · Notes export · ${esc(new Date().toLocaleDateString())}</p><p>${items.length} note${items.length === 1 ? '' : 's'} included.</p></header><nav class="print-toc"><h2>Contents</h2><ol>${toc}</ol></nav>${bodyHtml}<script>window.addEventListener('load',()=>{window.focus();window.print();});</script></body></html>`);
    printWindow.document.close();
    toast(`Prepared ${items.length} notes for print-to-PDF`);
  }

  /* ---------- events ---------- */
  function wire() {
    const tree = $('#tree');
    tree.addEventListener('click', e => {
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const id = tg.dataset.toggle;
        open.has(id) ? open.delete(id) : open.add(id);
        renderTree();
        const again = $(`[data-toggle="${cssId(id)}"]`); if (again) again.focus({ preventScroll: true });
        return;
      }
      const op = e.target.closest('[data-open]');
      if (op) openDetail(op.dataset.open, false);
    });
    tree.addEventListener('change', e => {
      const c = e.target.closest('[data-check]');
      if (!c) return;
      const n = byId.get(c.dataset.check);
      setStatus(n, c.checked ? 'learned' : 'not_started');
      refresh(`[data-check="${cssId(n.id)}"]`);
    });

    $('#tiles').addEventListener('click', e => {
      const t = e.target.closest('[data-section]'); if (!t) return;
      const sec = t.dataset.section;
      if (visible) clearFilters(true);
      open.add('sec:' + sec);
      renderTree();
      const el = $('#sec-' + cssId(sec));
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); const b = $('.sec-btn', el); if (b) b.focus({ preventScroll: true }); }
    });

    const dlg = $('#detail');
    dlg.addEventListener('click', e => {
      if (e.target === dlg) { flushCurrentNote().finally(() => { if (dlg.open) dlg.close(); }); return; }
      const t = e.target;
      if (t.closest('[data-close]')) { flushCurrentNote().finally(() => { if (dlg.open) dlg.close(); }); return; }
      if (t.closest('[data-back]')) { flushCurrentNote().finally(() => { navStack.pop(); renderDetail(); const h = $('#dTitle'); if (h) h.focus(); }); return; }
      if (t.closest('[data-resolve-note-conflict]')) {
        const n = byId.get(navStack[navStack.length - 1]);
        if (n) { const note = getNote(n.concept_key); pendingNoteConflict = { key: n.concept_key, local: note.conflictDraft || note.delta, cloud: note.cloudVersion || null }; openNoteConflict(pendingNoteConflict); }
        return;
      }
      const go = t.closest('[data-goto]');
      if (go) return openDetail(go.dataset.goto, true);
      const rv = t.closest('[data-reveal]');
      if (rv) return revealInTree(rv.dataset.reveal);
      if (t.closest('[data-copy]')) {
        const ta = $('.prompt', dlg);
        const done = () => toast('Prompt copied');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); document.execCommand('copy'); done(); });
        else { ta.select(); document.execCommand('copy'); done(); }
      }
    });
    dlg.addEventListener('change', e => {
      if (e.target.name !== 'status') return;
      const n = byId.get(navStack[navStack.length - 1]);
      setStatus(n, e.target.value);
      refresh(null, false);
      const r = $('input[name="status"]:checked', dlg); if (r) r.focus();
    });
    dlg.addEventListener('cancel', e => {
      e.preventDefault();
      flushCurrentNote().finally(() => { if (dlg.open) dlg.close(); });
    });
    dlg.addEventListener('close', () => {
      navStack = [];
      editor = null; editorFallback = null; editorConceptKey = null;
      clearTimeout(noteSaveTimer);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
      if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus({ preventScroll: true });
    });

    let timer;
    $('#search').addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(() => { ui.search = e.target.value.trim(); renderTree(); }, 120);
    });
    for (const [id, key] of [['fImportance', 'importance'], ['fDifficulty', 'difficulty'], ['fStatus', 'status'], ['fReady', 'ready']])
      $('#' + id).addEventListener('change', e => { ui[key] = e.target.value; renderTree(); });
    $('#fCore30').addEventListener('change', e => { ui.core30 = e.target.checked; renderTree(); });
    $('#clearFilters').addEventListener('click', () => clearFilters());
    $('#filters').addEventListener('submit', e => e.preventDefault());
    $('#filterToggle').addEventListener('click', e => {
      const f = $('#filters'); const show = f.hidden;
      f.hidden = !show; e.currentTarget.setAttribute('aria-expanded', String(show));
    });

    $('#expandAll').addEventListener('click', () => {
      for (const sec of sectionOrder) open.add('sec:' + sec);
      for (const [pid] of children) open.add(pid);
      renderTree();
    });
    $('#collapseAll').addEventListener('click', () => { open.clear(); renderTree(); });

    $('#randomBtn').addEventListener('click', randomTopic);
    $('#exportBtn').addEventListener('click', () => { exportBackup(); $('.menu').open = false; });
    $('#importBtn').addEventListener('click', () => { $('#importFile').click(); $('.menu').open = false; });
    $('#exportPdfBtn').addEventListener('click', () => { $('.menu').open = false; exportNotesPdf(); });
    $('#importFile').addEventListener('change', e => { if (e.target.files[0]) parseBackupFile(e.target.files[0]); e.target.value = ''; });
    $('#resetBtn').addEventListener('click', () => {
      $('.menu').open = false;
      if (!confirm('Reset ALL progress? This clears every learned/in-progress/skipped mark and cannot be undone.')) return;
      const resetKeys = Object.keys(state.status);
      state.status = {}; saveState();
      if (cloudWritesEnabled || (cloudLinked && !migrationPaused)) {
        for (const conceptKey of resetKeys) progressQueue.push({ conceptKey, status: 'not_started', mutationId: makeId('progress'), queuedAt: new Date().toISOString() });
        saveSyncQueue();
        if (cloudAvailable && cloudWritesEnabled) flushProgressQueue();
        else setSyncStatus(navigator.onLine ? 'Cloud unavailable — changes queued' : 'Offline — changes pending', 'pending');
      }
      refresh(); toast('Progress reset');
    });

    $('#migrationMergeBtn').addEventListener('click', () => performMigration('merge'));
    $('#migrationReplaceBtn').addEventListener('click', () => performMigration('replace'));
    $('#migrationBackupBtn').addEventListener('click', () => exportBackup(pendingLocalSnapshot || makeSnapshot()));
    $('#migrationDialog').addEventListener('click', e => { if (e.target.closest('[data-keep-local]')) keepMigrationLocal(); });
    $('#migrationDialog').addEventListener('cancel', e => { e.preventDefault(); keepMigrationLocal(); });
    $('#importMergeBtn').addEventListener('click', () => applyBackup('merge'));
    $('#importReplaceBtn').addEventListener('click', () => applyBackup('replace'));
    $('#importPreviewDialog').addEventListener('click', e => { if (e.target.closest('[data-import-cancel]')) { $('#importPreviewDialog').close(); pendingImportSnapshot = null; } });
    $('#noteConflictDownloadBtn').addEventListener('click', () => resolveNoteConflict('download'));
    $('#noteConflictCloudBtn').addEventListener('click', () => resolveNoteConflict('cloud'));
    $('#noteConflictOverwriteBtn').addEventListener('click', () => resolveNoteConflict('overwrite'));
    $('#noteConflictDialog').addEventListener('click', e => { if (e.target.closest('[data-conflict-dismiss]')) { pendingNoteConflict = null; $('#noteConflictDialog').close(); } });
    $('#noteConflictDialog').addEventListener('close', () => { pendingNoteConflict = null; });
    $('#noteConflictDialog').addEventListener('cancel', e => { e.preventDefault(); pendingNoteConflict = null; $('#noteConflictDialog').close(); });
    window.addEventListener('online', () => {
      if (!cloudAvailable) { initializeCloudSync(); return; }
      if (cloudWritesEnabled) { setSyncStatus('Syncing…', 'pending'); revalidateCloud(); flushProgressQueue(); for (const [key, note] of Object.entries(notesCache)) if (note.dirty && !note.conflict) saveNote(key); }
    });
    window.addEventListener('focus', () => revalidateCloud());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revalidateCloud(); });
    document.addEventListener('click', e => { const m = $('.menu'); if (m.open && !m.contains(e.target)) m.open = false; });
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !$('#detail').open) { e.preventDefault(); $('#search').focus(); }
      if (e.key === 'Escape' && document.activeElement === $('#search') && $('#search').value) { $('#search').value = ''; ui.search = ''; renderTree(); }
    });
  }

  function fillSelect(id, values, labeler) {
    $(id).insertAdjacentHTML('beforeend', values.map(v => `<option value="${esc(v)}">${esc(labeler ? labeler(v) : v)}</option>`).join(''));
  }

  async function init() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      buildModel(await res.json());
    } catch (err) {
      $('#tree').innerHTML = `<p class="empty">Could not load <code>${DATA_URL}</code>. If you opened index.html directly from disk, serve the folder over HTTP instead (for example <code>python3 -m http.server</code>).</p>`;
      return;
    }
    fillSelect('#fImportance', IMPORTANCE_ORDER, v => IMPORTANCE_LABEL[v]);
    fillSelect('#fDifficulty', DIFFICULTY_ORDER);
    fillSelect('#fStatus', STATUS_IDS, v => statusMeta(v).label);
    wire();
    refresh();
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && byId.has(hash)) openDetail(hash, false);
    initializeCloudSync();
  }

  init();
})();
