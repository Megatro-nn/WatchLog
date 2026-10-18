/* Watchlog. Plain JavaScript, no frameworks. Reads data from /api/tmdb/... (the Cloudflare function) and keeps
   your list in this browser's localStorage. */
(() => {
  'use strict';

  const IMG = 'https://image.tmdb.org/t/p/';
  const REGIONS = [
    ['US', 'United States'], ['EG', 'Egypt'], ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'],
    ['GB', 'United Kingdom'], ['CA', 'Canada'], ['DE', 'Germany'], ['FR', 'France'],
    ['TR', 'Türkiye'], ['IN', 'India'], ['AU', 'Australia'],
  ];
  const STATUS = { want: 'Want to watch', watching: 'Watching', watched: 'Watched' };
  const STORE_KEY = 'watchlog.v1';

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const $q = document.getElementById('q');
  const $region = document.getElementById('region');

  /* ---------- storage ---------- */
  let db = loadDb();
  function loadDb() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d.items === 'object' && d.items) return { region: d.region || 'US', items: d.items };
      }
    } catch (e) { /* private mode or damaged data: start fresh */ }
    return { region: 'US', items: {} };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (e) { toast('This browser would not save your list. Use Export backup on the My list page.'); }
  }

  /* ---------- small helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = (type, id) => type + ':' + id;
  const regionName = () => (REGIONS.find((r) => r[0] === db.region) || [db.region, db.region])[1];
  let toastTimer;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove('show'), 3000);
  }

  const cache = new Map();
  async function api(path, params) {
    const qs = new URLSearchParams(Object.assign({ language: 'en-US' }, params || {})).toString();
    const url = '/api/tmdb/' + path + '?' + qs;
    if (cache.has(url)) return cache.get(url);
    const res = await fetch(url);
    if (!res.ok) { const err = new Error('API ' + res.status); err.status = res.status; throw err; }
    const data = await res.json();
    cache.set(url, data);
    return data;
  }

  /* ---------- cards ---------- */
  function norm(r, forcedType) {
    return {
      id: r.id, type: forcedType || r.media_type, title: r.title || r.name, poster: r.poster_path,
      year: (r.release_date || r.first_air_date || '').slice(0, 4), rating: r.vote_average || 0,
    };
  }
  function card(m, extra) {
    const it = db.items[key(m.type, m.id)];
    const chip = m.chip != null ? m.chip : (m.rating ? Number(m.rating).toFixed(1) : '');
    return '<a class="card" href="#/' + m.type + '/' + m.id + '">' +
      '<div class="poster">' +
        (m.poster ? '<img loading="lazy" src="' + IMG + 'w342' + esc(m.poster) + '" alt="">' : '<div class="noposter">' + esc(m.title) + '</div>') +
        (it ? '<span class="badge s-' + it.status + '">' + STATUS[it.status] + '</span>' : '') +
        (chip ? '<span class="rate">' + esc(chip) + '</span>' : '') +
      '</div>' +
      '<div class="ctitle">' + esc(m.title) + '</div>' +
      '<div class="cmeta">' + (m.type === 'tv' ? 'Series' : 'Movie') + (m.year ? ' · ' + esc(m.year) : '') + '</div>' +
      (extra || '') + '</a>';
  }
  const shelf = (title, list) =>
    '<div class="sect"><h2>' + esc(title) + '</h2></div><div class="rowscroll">' + list.map((m) => card(m)).join('') + '</div>';

  /* ---------- routing ---------- */
  let routeId = 0;
  let current = null;           // the title open on the detail page
  const openSeasons = new Set();
  const seasonData = new Map();
  let fStatus = 'all', fType = 'all';

  function route() {
    const rid = ++routeId;
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/');
    const head = parts[0] || '';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (head === 'list' ? 'list' : (head === '' ? '' : '__none'))));
    window.scrollTo(0, 0);
    document.title = 'Watchlog';
    current = null;
    openSeasons.clear();
    if (head === 'search') {
      let q = '';
      try { q = decodeURIComponent(parts.slice(1).join('/')); } catch (e) { q = ''; }
      if ($q.value !== q) $q.value = q;
      return searchView(q, rid);
    }
    if ((head === 'movie' || head === 'tv') && /^\d+$/.test(parts[1] || '')) return detailView(head, Number(parts[1]), rid);
    if (head === 'list') return listView();
    if ($q.value) $q.value = '';
    return discoverView(rid);
  }

  function loading(msg) { $app.innerHTML = '<p class="muted">' + esc(msg || 'Loading…') + '</p>'; }
  function fail(e) {
    const text = e && e.status === 404 ? 'That title was not found.' : 'The data service did not answer.';
    $app.innerHTML = '<div class="notice"><h2>Can’t load data</h2><p>' + text + '</p>' +
      '<p class="muted">If you just put the site online, add your TMDB key in Cloudflare (Settings, Variables and Secrets, name TMDB_KEY) and deploy again.</p>' +
      '<div><button class="btn" id="retry">Try again</button></div></div>';
    document.getElementById('retry').addEventListener('click', route);
  }

  /* ---------- discover and search ---------- */
  async function discoverView(rid) {
    loading();
    try {
      const [t, pm, pt] = await Promise.all([api('trending/all/week'), api('movie/popular'), api('tv/popular')]);
      if (rid !== routeId) return;
      $app.innerHTML =
        shelf('Trending this week', t.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv').map((r) => norm(r))) +
        shelf('Popular movies', pm.results.map((r) => norm(r, 'movie'))) +
        shelf('Popular series', pt.results.map((r) => norm(r, 'tv')));
    } catch (e) { if (rid === routeId) fail(e); }
  }

  async function searchView(q, rid) {
    if (!q.trim()) { location.hash = '#/'; return; }
    loading('Searching for “' + q + '”…');
    try {
      const r = await api('search/multi', { query: q, include_adult: 'false' });
      if (rid !== routeId) return;
      const res = r.results.filter((x) => x.media_type === 'movie' || x.media_type === 'tv').map((x) => norm(x));
      $app.innerHTML = '<h1 class="h">Results for “' + esc(q) + '”</h1>' +
        (res.length ? '<div class="grid">' + res.map((m) => card(m)).join('') + '</div>' : '<p class="muted">Nothing found. Try another spelling.</p>');
    } catch (e) { if (rid === routeId) fail(e); }
  }

  /* ---------- detail page ---------- */
  const seasonsOf = (d) => (d.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0);
  const totalEpisodes = (d) => seasonsOf(d).reduce((n, s) => n + s.episode_count, 0);

  async function detailView(type, id, rid) {
    loading();
    try {
      const d = await api(type + '/' + id, { append_to_response: 'watch/providers,credits' });
      if (rid !== routeId) return;
      current = { type, id, d };
      renderDetail();
    } catch (e) { if (rid === routeId) fail(e); }
  }

  function providersHtml(d) {
    const all = d['watch/providers'] && d['watch/providers'].results;
    const r = all && all[db.region];
    if (!r) return '<p class="muted">No streaming information for ' + esc(regionName()) + ' yet. Try another country in the top bar.</p>';
    const group = (label, arr) => (arr && arr.length)
      ? '<div class="pgroup"><span class="plabel">' + label + '</span>' + arr.map((p) =>
          '<img class="plogo" title="' + esc(p.provider_name) + '" alt="' + esc(p.provider_name) + '" src="' + IMG + 'w92' + esc(p.logo_path) + '">').join('') + '</div>'
      : '';
    const body = group('Stream', r.flatrate) + group('Rent', r.rent) + group('Buy', r.buy);
    const link = r.link ? '<p><a class="plink" href="' + esc(r.link) + '" target="_blank" rel="noopener">See every option on JustWatch</a></p>' : '';
    return (body || '<p class="muted">No streaming information for ' + esc(regionName()) + ' yet.</p>') + link;
  }

  function seasonsBlock(d) {
    const ss = seasonsOf(d);
    if (!ss.length) return '';
    return '<section class="block"><h2>Episodes</h2>' +
      '<div class="overall"><div class="bar"><i id="obar"></i></div><span id="otext" class="muted"></span></div>' +
      ss.map((s) =>
        '<details class="season" data-s="' + s.season_number + '"><summary><span>' + esc(s.name || ('Season ' + s.season_number)) + '</span>' +
        '<span class="sp" data-s="' + s.season_number + '"></span><span class="muted">' + s.episode_count + ' episodes</span></summary>' +
        '<div class="sbtns"><button class="btn sm" data-season-all="' + s.season_number + '">Mark season watched</button>' +
        '<button class="btn sm ghost" data-season-none="' + s.season_number + '">Clear</button></div><div class="eps"></div></details>').join('') +
      '</section>';
  }

  function renderDetail() {
    const { type, d } = current;
    const title = d.title || d.name || '';
    const year = (d.release_date || d.first_air_date || '').slice(0, 4);
    document.title = title + ' · Watchlog';
    let rt = '';
    if (type === 'movie' && d.runtime) rt = Math.floor(d.runtime / 60) + 'h ' + (d.runtime % 60) + 'm';
    if (type === 'tv' && d.number_of_seasons) rt = d.number_of_seasons + ' season' + (d.number_of_seasons === 1 ? '' : 's');
    const genres = (d.genres || []).map((g) => '<span class="chip">' + esc(g.name) + '</span>').join('');
    const cast = ((d.credits && d.credits.cast) || []).slice(0, 8).map((c) => esc(c.name)).join(', ');
    const bd = d.backdrop_path ? ' style="--bd:url(\'' + IMG + 'w1280' + esc(d.backdrop_path) + '\')"' : '';
    const ratingOpts = '<option value="">Not rated</option>' + [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => '<option value="' + n + '">' + n + ' / 10</option>').join('');
    $app.innerHTML =
      '<article class="detail"><div class="hero"' + bd + '><div class="hero-in">' +
        '<div class="dposter">' + (d.poster_path ? '<img src="' + IMG + 'w500' + esc(d.poster_path) + '" alt="Poster of ' + esc(title) + '">' : '<div class="noposter">' + esc(title) + '</div>') + '</div>' +
        '<div class="dinfo">' +
          '<p class="kind">' + (type === 'tv' ? 'Series' : 'Movie') + (year ? ' · ' + esc(year) : '') + (rt ? ' · ' + esc(rt) : '') + '</p>' +
          '<h1 class="dtitle">' + esc(title) + '</h1>' +
          (d.tagline ? '<p class="tag">' + esc(d.tagline) + '</p>' : '') +
          '<div class="chips">' + (d.vote_average ? '<span class="chip score">★ ' + d.vote_average.toFixed(1) + ' <small>TMDB</small></span>' : '') + genres + '</div>' +
          '<div class="actions">' +
            '<div class="seg" role="group" aria-label="Your status">' + Object.keys(STATUS).map((v) => '<button class="seg-b" data-status="' + v + '">' + STATUS[v] + '</button>').join('') + '</div>' +
            '<label class="myrate">My rating <select id="rating">' + ratingOpts + '</select></label>' +
            '<button class="btn sm ghost" id="remove" hidden>Remove from list</button>' +
          '</div>' +
        '</div></div></div>' +
        '<section class="block"><h2>Overview</h2><p>' + esc(d.overview || 'No overview yet.') + '</p>' + (cast ? '<p class="muted">Cast: ' + cast + '</p>' : '') + '</section>' +
        '<section class="block"><h2>Where to watch <span class="inline">in ' + esc(regionName()) + '</span></h2><div id="prov">' + providersHtml(d) + '</div></section>' +
        (type === 'tv' ? seasonsBlock(d) : '') +
      '</article>';
    syncDom();
  }

  /* ---------- list changes (no full re-render, so open seasons stay open) ---------- */
  function ensureItem() {
    const k = key(current.type, current.id);
    if (!db.items[k]) {
      const d = current.d;
      db.items[k] = {
        id: current.id, type: current.type, title: d.title || d.name || '', poster: d.poster_path || null,
        year: (d.release_date || d.first_air_date || '').slice(0, 4), status: 'want', rating: null,
        episodes: {}, total: current.type === 'tv' ? totalEpisodes(d) : 0, added: Date.now(), updated: Date.now(),
      };
    }
    return db.items[k];
  }
  function touch(it) { it.updated = Date.now(); save(); }
  function autoStatus(it) {
    const count = Object.keys(it.episodes).length;
    if (it.total && count >= it.total) it.status = 'watched';
    else if (count > 0 && (it.status === 'want' || it.status === 'watched')) it.status = 'watching';
  }

  function setStatus(st) {
    const it = ensureItem();
    it.status = st;
    if (current.type === 'tv' && st === 'watched') {
      seasonsOf(current.d).forEach((s) => { for (let e = 1; e <= s.episode_count; e++) it.episodes[s.season_number + 'x' + e] = true; });
    }
    touch(it); syncDom();
    toast('Saved as “' + STATUS[st] + '”');
  }
  function setRating(v) {
    const isNew = !db.items[key(current.type, current.id)];
    const it = ensureItem();
    if (isNew) it.status = current.type === 'movie' ? 'watched' : 'watching';
    it.rating = v ? Number(v) : null;
    touch(it); syncDom();
  }
  function removeItem() {
    delete db.items[key(current.type, current.id)];
    save(); syncDom(); toast('Removed from your list');
  }
  function toggleEpisode(s, e, on) {
    const it = ensureItem();
    const k = s + 'x' + e;
    if (on) it.episodes[k] = true; else delete it.episodes[k];
    autoStatus(it); touch(it); syncDom();
  }
  function markSeason(n, on) {
    const s = seasonsOf(current.d).find((x) => x.season_number === n);
    if (!s) return;
    const it = ensureItem();
    for (let e = 1; e <= s.episode_count; e++) {
      const k = n + 'x' + e;
      if (on) it.episodes[k] = true; else delete it.episodes[k];
    }
    autoStatus(it); touch(it); syncDom();
  }

  function syncDom() {
    const c = current;
    if (!c) return;
    const it = db.items[key(c.type, c.id)];
    $app.querySelectorAll('.seg-b').forEach((b) => b.classList.toggle('on', !!it && it.status === b.dataset.status));
    const rm = $app.querySelector('#remove'); if (rm) rm.hidden = !it;
    const rt = $app.querySelector('#rating'); if (rt) rt.value = it && it.rating ? String(it.rating) : '';
    if (c.type !== 'tv') return;
    $app.querySelectorAll('input[data-ep]').forEach((i) => { i.checked = !!(it && it.episodes[i.dataset.s + 'x' + i.dataset.ep]); });
    let total = 0, done = 0;
    seasonsOf(c.d).forEach((s) => {
      let n = 0;
      for (let e = 1; e <= s.episode_count; e++) if (it && it.episodes[s.season_number + 'x' + e]) n++;
      done += n; total += s.episode_count;
      const el = $app.querySelector('.sp[data-s="' + s.season_number + '"]');
      if (el) el.textContent = n + '/' + s.episode_count;
    });
    const bar = $app.querySelector('#obar'); if (bar) bar.style.width = total ? (done / total * 100) + '%' : '0';
    const ot = $app.querySelector('#otext'); if (ot) ot.textContent = done + ' of ' + total + ' episodes watched';
  }

  async function loadSeason(n) {
    const c = current;
    if (!c) return;
    const box = $app.querySelector('details.season[data-s="' + n + '"] .eps');
    if (!box || box.dataset.loaded) return;
    box.innerHTML = '<p class="muted" style="padding:6px 10px;margin:0">Loading episodes…</p>';
    try {
      const s = await api('tv/' + c.id + '/season/' + n);
      if (current !== c) return;
      box.innerHTML = (s.episodes || []).map((ep) =>
        '<label class="ep"><input type="checkbox" data-s="' + n + '" data-ep="' + ep.episode_number + '">' +
        '<span class="en">' + ep.episode_number + '</span><span class="et">' + esc(ep.name || 'Episode ' + ep.episode_number) + '</span>' +
        '<span class="ed">' + esc(ep.air_date || '') + '</span></label>').join('') || '<p class="muted" style="padding:6px 10px;margin:0">No episodes listed yet.</p>';
      box.dataset.loaded = '1';
      syncDom();
    } catch (e) { box.innerHTML = '<p class="muted" style="padding:6px 10px;margin:0">Could not load episodes. Close and open the season to try again.</p>'; }
  }

  /* ---------- my list ---------- */
  function listView() {
    const all = Object.values(db.items).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const items = all.filter((i) => (fStatus === 'all' || i.status === fStatus) && (fType === 'all' || i.type === fType));
    const cnt = (s) => all.filter((i) => s === 'all' || i.status === s).length;
    const pill = (kind, val, label) => '<button class="pill' + ((kind === 's' ? fStatus : fType) === val ? ' on' : '') + '" data-filter="' + kind + ':' + val + '">' + label + '</button>';
    const cards = items.map((it) => {
      const count = Object.keys(it.episodes || {}).length;
      const prog = it.type === 'tv' && it.total
        ? '<div class="mini"><i style="width:' + Math.min(100, count / it.total * 100) + '%"></i></div><div class="cmeta">' + count + ' of ' + it.total + ' episodes</div>' : '';
      return card({ id: it.id, type: it.type, title: it.title, poster: it.poster, year: it.year, chip: it.rating ? '★ ' + it.rating : '' }, prog);
    }).join('');
    $app.innerHTML =
      '<h1 class="h">My list</h1>' +
      (all.length
        ? '<div class="filters"><div class="pills">' + pill('s', 'all', 'All ' + cnt('all')) + pill('s', 'want', 'Want to watch ' + cnt('want')) + pill('s', 'watching', 'Watching ' + cnt('watching')) + pill('s', 'watched', 'Watched ' + cnt('watched')) + '</div>' +
          '<div class="pills">' + pill('t', 'all', 'Movies and series') + pill('t', 'movie', 'Movies') + pill('t', 'tv', 'Series') + '</div></div>' +
          (items.length ? '<div class="grid">' + cards + '</div>' : '<p class="muted">Nothing matches this filter.</p>')
        : '<div class="empty"><p><strong>Your list is empty.</strong></p><p class="muted">Open any movie or series and press “Want to watch”, “Watching” or “Watched”. It will show up here.</p><p><a class="btn primary" href="#/" style="text-decoration:none;display:inline-block">Find something to watch</a></p></div>') +
      '<section class="backup"><h2>Backup</h2><p>Your list is saved in this browser only. Export a file now and then, and import it to move your list to another phone or computer.</p>' +
      '<div class="brow"><button class="btn" id="export">Export backup</button><label class="btn" style="cursor:pointer">Import backup<input id="import" type="file" accept="application/json,.json" class="sr"></label></div></section>';
  }

  function cleanItem(v) {
    if (!v || typeof v !== 'object' || !Number.isFinite(Number(v.id)) || (v.type !== 'movie' && v.type !== 'tv')) return null;
    const eps = {};
    if (v.episodes && typeof v.episodes === 'object') Object.keys(v.episodes).forEach((k) => { if (/^\d+x\d+$/.test(k)) eps[k] = true; });
    return {
      id: Number(v.id), type: v.type, title: String(v.title || ''), poster: typeof v.poster === 'string' && /^\/[\w.-]+$/.test(v.poster) ? v.poster : null,
      year: String(v.year || '').slice(0, 4), status: STATUS[v.status] ? v.status : 'want',
      rating: v.rating >= 1 && v.rating <= 10 ? Number(v.rating) : null, episodes: eps, total: Number(v.total) || 0,
      added: Number(v.added) || Date.now(), updated: Number(v.updated) || Date.now(),
    };
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'watchlog-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importData(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || typeof d.items !== 'object') throw new Error('bad');
        let n = 0;
        Object.keys(d.items).forEach((k) => {
          const v = cleanItem(d.items[k]);
          if (!v) return;
          const kk = key(v.type, v.id);
          const cur = db.items[kk];
          if (!cur || v.updated > (cur.updated || 0)) { db.items[kk] = v; n++; }
        });
        save(); toast('Imported ' + n + ' title' + (n === 1 ? '' : 's')); listView();
      } catch (e) { toast('That file is not a Watchlog backup.'); }
    };
    r.readAsText(file);
  }

  /* ---------- events ---------- */
  $app.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.status) return setStatus(b.dataset.status);
    if (b.id === 'remove') return removeItem();
    if (b.dataset.seasonAll !== undefined) return markSeason(Number(b.dataset.seasonAll), true);
    if (b.dataset.seasonNone !== undefined) return markSeason(Number(b.dataset.seasonNone), false);
    if (b.id === 'export') return exportData();
    if (b.dataset.filter) {
      const [kind, val] = b.dataset.filter.split(':');
      if (kind === 's') fStatus = val; else fType = val;
      listView();
    }
  });
  $app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('input[data-ep]')) return toggleEpisode(Number(t.dataset.s), Number(t.dataset.ep), t.checked);
    if (t.id === 'rating') return setRating(t.value);
    if (t.id === 'import') { importData(t.files[0]); t.value = ''; }
  });
  // "toggle" does not bubble, so listen while it travels down (capture).
  $app.addEventListener('toggle', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('details.season')) return;
    const n = Number(el.dataset.s);
    if (el.open) { openSeasons.add(n); loadSeason(n); } else openSeasons.delete(n);
  }, true);

  let searchTimer;
  $q.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = $q.value.trim();
      if (v) location.hash = '#/search/' + encodeURIComponent(v);
      else if (location.hash.indexOf('#/search') === 0) location.hash = '#/';
    }, 350);
  });
  document.getElementById('searchform').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    const v = $q.value.trim();
    if (v) location.hash = '#/search/' + encodeURIComponent(v);
  });

  REGIONS.forEach(([code, name]) => { $region.insertAdjacentHTML('beforeend', '<option value="' + code + '">' + esc(name) + '</option>'); });
  $region.value = db.region;
  $region.addEventListener('change', () => {
    db.region = $region.value; save();
    const prov = $app.querySelector('#prov');
    if (current && prov) {
      prov.innerHTML = providersHtml(current.d);
      const inl = $app.querySelector('.block h2 .inline'); if (inl) inl.textContent = 'in ' + regionName();
    }
  });

  window.addEventListener('hashchange', route);
  route();
})();
