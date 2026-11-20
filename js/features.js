/* Gone Fishin' extra features: state map, best day, wind alerts, reminders,
   compare, and fishing journal. Loaded after the main script, so it can use
   its globals (DB, $, place, ELEV_M, getForecast, scoreDay, ...). */
(() => {

/* ---------- state tile map (tile-grid layout, [abbr, name, column, row]) ---------- */
const STATE_TILES = [
  ["AK","Alaska",0,0],["ME","Maine",11,0],
  ["WI","Wisconsin",5,1],["VT","Vermont",10,1],["NH","New Hampshire",11,1],
  ["WA","Washington",0,2],["ID","Idaho",1,2],["MT","Montana",2,2],["ND","North Dakota",3,2],["MN","Minnesota",4,2],["IL","Illinois",5,2],["MI","Michigan",6,2],["NY","New York",9,2],["MA","Massachusetts",10,2],
  ["OR","Oregon",0,3],["NV","Nevada",1,3],["WY","Wyoming",2,3],["SD","South Dakota",3,3],["IA","Iowa",4,3],["IN","Indiana",5,3],["OH","Ohio",6,3],["PA","Pennsylvania",7,3],["NJ","New Jersey",8,3],["CT","Connecticut",9,3],["RI","Rhode Island",10,3],
  ["CA","California",0,4],["UT","Utah",1,4],["CO","Colorado",2,4],["NE","Nebraska",3,4],["MO","Missouri",4,4],["KY","Kentucky",5,4],["WV","West Virginia",6,4],["VA","Virginia",7,4],["MD","Maryland",8,4],["DE","Delaware",9,4],
  ["AZ","Arizona",1,5],["NM","New Mexico",2,5],["KS","Kansas",3,5],["AR","Arkansas",4,5],["TN","Tennessee",5,5],["NC","North Carolina",6,5],["SC","South Carolina",7,5],
  ["OK","Oklahoma",3,6],["LA","Louisiana",4,6],["MS","Mississippi",5,6],["AL","Alabama",6,6],["GA","Georgia",7,6],
  ["HI","Hawaii",0,7],["TX","Texas",3,7],["FL","Florida",8,7]
];
let mapSel = null;

// Hatch count per state for a month. Peak months count double.
function stateScores(month){
  const out = {};
  DB.insects.forEach(ins => {
    if (!ins.months.includes(month)) return;
    (ins.states || []).forEach(s => { out[s] = (out[s] || 0) + 1 + (ins.peak_months.includes(month) ? 1 : 0); });
  });
  return out;
}
function hasAnyData(name){
  return DB.insects.some(i => (i.states || []).includes(name)) || DB.lakes.some(l => (l.states || []).includes(name));
}
function levelFor(score, name){
  if (!hasAnyData(name)) return 'nodata';
  if (!score) return 'lv0';
  if (score >= 10) return 'lv4';
  if (score >= 6) return 'lv3';
  if (score >= 3) return 'lv2';
  return 'lv1';
}
function fillMonths(){
  const sel = $('mapMonth');
  if (!sel || sel.options.length) return;
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  names.forEach((n, i) => sel.add(new Option(n, i + 1)));
  sel.value = parseInt(($('date').value || iso(new Date())).slice(5, 7));
}
function renderMap(){
  fillMonths();
  const month = parseInt($('mapMonth').value);
  const scores = stateScores(month);
  $('mapGrid').innerHTML = STATE_TILES.map(([abbr, name, c, r]) => {
    const lv = levelFor(scores[name] || 0, name);
    return `<button class="tile ${lv}${mapSel === name ? ' sel' : ''}" style="grid-column:${c+1};grid-row:${r+1}" title="${esc(name)}" onclick="showState('${name}')">${abbr}</button>`;
  }).join('');
  if (mapSel) showState(mapSel, true);
}
window.showState = function(name, quiet){
  mapSel = name;
  const month = parseInt($('mapMonth').value);
  const mon = new Date(2026, month - 1, 1).toLocaleString(undefined, { month: 'long' });
  const insects = DB.insects.filter(i => (i.states || []).includes(name) && i.months.includes(month));
  const lakes = DB.lakes.filter(l => (l.states || []).includes(name));
  $('mapDetail').innerHTML = `<b style="color:var(--ink)">${esc(name)} in ${mon}</b>
    ${insects.length ? `<ul class="tips">${insects.map(i => `<li><b>${esc(i.name)}</b>${i.peak_months.includes(month) ? ' <span class="pill peak">peak</span>' : ''} <span class="muted">${esc(i.time_of_day)}</span></li>`).join('')}</ul>`
      : `<p class="muted">${hasAnyData(name) ? 'No hatches are listed for this state in this month.' : 'No hatch data for this state yet.'}</p>`}
    ${lakes.length ? `<div>Waters with notes: ${lakes.map(l => esc(l.name.split(' (')[0])).join(', ')}</div>` : ''}`;
  if (!quiet) renderMap();
};

/* ---------- wind alerts ---------- */
function windBanner(wx){
  if (!wx || !wx.a || wx.a.wind == null) return '';
  const w = wx.a.wind;
  if (w >= 24) return `<div class="alert strong"><b>Strong wind expected</b> (about ${fmtWind(w)}). Casting and drifting will be hard. Fish sheltered banks, or pick another day.</div>`;
  if (w >= 16) return `<div class="alert breezy"><b>Breezy</b> (about ${fmtWind(w)}). Look for sheltered water and heavier flies or sinking lines.</div>`;
  return '';
}

/* ---------- hatch count for a place and date ---------- */
function hatchPeaks(lake, habitat, month, state){
  const list = activeHatches(month, habitat, null, lake ? lake.insect_ids : null, state);
  return { total: list.length, peaks: list.filter(h => h.peak).length };
}

/* ---------- best day finder ---------- */
let lastPlan = null;
async function findBestDay(){
  const btn = $('bdBtn'); const out = $('bdOut');
  if (!place) return;
  btn.disabled = true; out.innerHTML = '<p class="muted">Checking the next 10 days…</p>';
  const lake = findLake(place);
  const saved = ELEV_M;
  ELEV_M = lake ? Math.round(lake.elevation_ft * 0.3048) : null;
  const today = iso(new Date());
  const dates = [...Array(10).keys()].map(i => shiftDay(today, i));
  const win = $('when').value;
  try {
    const rows = await Promise.all(dates.map(async d => {
      try {
        const f = await getForecast(place.lat, place.lon, d);
        const a = hourlyDayAverages(f, d, win);
        const sc = scoreDay(a);
        const month = parseInt(d.slice(5, 7));
        const hp = hatchPeaks(lake, place.habitat, month, place.state);
        return { d, a, sc, hp, ok: true };
      } catch(e) { return { d, ok: false, err: e.message }; }
    }));
    const good = rows.filter(r => r.ok);
    if (!good.length) { out.innerHTML = '<p class="warn">Forecast not available for these dates.</p>'; return; }
    good.sort((x, y) => (y.sc.s + Math.min(y.hp.peaks, 4)) - (x.sc.s + Math.min(x.hp.peaks, 4)));
    const top = good[0];
    out.innerHTML = `<p><b>Best day: ${new Date(top.d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</b>, ${top.sc.label.toLowerCase()} (score ${top.sc.s}). ${fmtWind(top.a.wind)} wind, air ${fmtTemp(top.a.temp)}, ${top.hp.peaks} hatch${top.hp.peaks === 1 ? '' : 'es'} at peak.</p>
      <table class="bd"><tr><th>Day</th><th>Score</th><th>Wind</th><th>Air</th><th>Rain</th><th>Peak hatches</th></tr>` +
      good.map(r => `<tr><td>${new Date(r.d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
        <td>${r.sc.s} ${esc(r.sc.label)}</td>
        <td>${fmtWind(r.a.wind)}${r.a.wind >= 24 ? ' ⚠' : ''}</td><td>${fmtTemp(r.a.temp)}</td>
        <td>${Math.round(r.a.rainChance)}%</td><td>${r.hp.peaks}</td></tr>`).join('') +
      `</table><p class="muted">Based on the Open-Meteo forecast. ${rows.length - good.length ? (rows.length - good.length) + ' day(s) had no forecast.' : ''}</p>`;
  } finally { ELEV_M = saved; btn.disabled = false; }
}

/* ---------- reminders (Google Calendar) ---------- */
function reminderLink(dateStr){
  const prev = shiftDay(dateStr, -1).replace(/-/g, '');
  const text = `Check forecast: ${place.name}`;
  const details = `Check the forecast the day before your trip.\n${shareLink()}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(text)}&dates=${prev}T180000/${prev}T183000&details=${encodeURIComponent(details)}&location=${encodeURIComponent(place.name)}`;
}

/* ---------- hook from runPlan ---------- */
window.afterPlan = function({ wx, lake, dateStr, win, habitat }){
  lastPlan = { name: place.name, date: dateStr, state: place.state, score: wx ? scoreDay(wx.a) : null, wind: wx ? wx.a.wind : null, temp: wx ? wx.a.temp : null, habitat };
  $('windAlert').innerHTML = windBanner(wx);
  $('extras').innerHTML = `<h2>Plan ahead</h2>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <button class="btn" id="bdBtn" onclick="findBestDay()">Find the best day (next 10 days)</button>
      <a class="link" target="_blank" rel="noopener" href="${reminderLink(dateStr)}">Remind me the day before →</a>
      <button class="ghost" onclick="jPrefill()">Log this trip in the journal</button>
    </div>
    <div id="bdOut" style="margin-top:12px"></div>`;
  fillJournalDate(dateStr);
  fillCompare();
};

/* ---------- compare ---------- */
function placeOptions(){
  const opts = [];
  if (place) opts.push({ label: `Current: ${place.name}`, value: 'current' });
  loadSaved().forEach((p, i) => opts.push({ label: p.name, value: String(i) }));
  return opts;
}
function fillCompare(){
  const opts = placeOptions();
  ['cmpA', 'cmpB'].forEach((id, k) => {
    const sel = $(id); if (!sel) return;
    sel.innerHTML = opts.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('');
    if (opts[k]) sel.value = opts[k].value;
  });
}
function resolvePlace(v){
  if (v === 'current') return place;
  return loadSaved()[parseInt(v)] || null;
}
async function evalPlace(p, dateStr, win){
  const lake = findLake(p);
  const saved = ELEV_M;
  ELEV_M = lake ? Math.round(lake.elevation_ft * 0.3048) : null;
  try {
    const f = await getForecast(p.lat, p.lon, dateStr);
    const a = hourlyDayAverages(f, dateStr, win);
    const sc = scoreDay(a);
    const hp = hatchPeaks(lake, p.habitat, parseInt(dateStr.slice(5, 7)), p.state || '');
    return { ok: true, a, sc, hp };
  } catch(e) { return { ok: false, err: e.message }; }
  finally { ELEV_M = saved; }
}
window.runCompare = async function(){
  const pa = resolvePlace($('cmpA').value), pb = resolvePlace($('cmpB').value);
  if (!pa || !pb) { $('cmpOut').innerHTML = '<p class="warn">Pick two places. Save a place by searching for it first.</p>'; return; }
  const dateStr = $('date').value || iso(new Date());
  if (daysFromToday(dateStr) < 0 || daysFromToday(dateStr) > 15) { $('cmpOut').innerHTML = '<p class="warn">Choose a date within the next 15 days.</p>'; return; }
  $('cmpOut').innerHTML = '<p class="muted">Comparing…</p>';
  const win = $('when').value;
  const [A, B] = await Promise.all([evalPlace(pa, dateStr, win), evalPlace(pb, dateStr, win)]);
  const rowsDef = [
    ['Score', r => r.sc.s, r => `${r.sc.s} ${esc(r.sc.label)}`, true],
    ['Wind', r => r.a.wind, r => fmtWind(r.a.wind), false],
    ['Air temperature', r => r.a.temp, r => fmtTemp(r.a.temp), null],
    ['Rain chance', r => r.a.rainChance, r => Math.round(r.a.rainChance) + '%', false],
    ['Peak hatches', r => r.hp.peaks, r => `${r.hp.peaks} of ${r.hp.total}`, true],
  ];
  const head = `<tr><th></th><th>${esc(pa.name)}</th><th>${esc(pb.name)}</th></tr>`;
  const body = rowsDef.map(([label, get, fmt, hi]) => {
    let winA = false, winB = false;
    if (A.ok && B.ok && hi !== null) { const x = get(A), y = get(B); if (x !== y) { winA = hi ? x > y : x < y; winB = !winA; } }
    return `<tr><th>${label}</th>
      <td class="${winA ? 'win' : ''}">${A.ok ? fmt(A) : 'no forecast'}</td>
      <td class="${winB ? 'win' : ''}">${B.ok ? fmt(B) : 'no forecast'}</td></tr>`;
  }).join('');
  $('cmpOut').innerHTML = `<table class="cmp">${head}${body}</table>
    <p class="muted">Highlighted values are the better ones for that row. Uses the Open-Meteo forecast for both places.</p>`;
};

/* ---------- journal ---------- */
const JKEY = 'gone-fishin-journal';
function loadJournal(){ try { return JSON.parse(localStorage.getItem(JKEY)) || []; } catch(e) { return []; } }
function saveJournal(list){ try { localStorage.setItem(JKEY, JSON.stringify(list)); } catch(e) {} }
function fillJournalDate(d){ if ($('jDate') && !$('jDate').value) $('jDate').value = d; }
window.jPrefill = function(){
  if (!lastPlan) return;
  $('jDate').value = lastPlan.date;
  $('jWater').value = lastPlan.name;
  const bits = [];
  if (lastPlan.score) bits.push(`${lastPlan.score.s} ${lastPlan.score.label}`);
  if (lastPlan.temp != null) bits.push(`air ${fmtTemp(lastPlan.temp)}`);
  if (lastPlan.wind != null) bits.push(`wind ${fmtWind(lastPlan.wind)}`);
  $('jCond').value = bits.join(', ');
  $('jMsg').textContent = 'Filled in from the plan. Add your catch and save.';
  $('journalCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.addJournal = function(){
  const entry = {
    id: Date.now(),
    date: $('jDate').value || iso(new Date()),
    water: $('jWater').value.trim(),
    count: parseInt($('jCount').value) || 0,
    species: $('jSpecies').value.trim(),
    flies: $('jFlies').value.trim(),
    conditions: $('jCond').value.trim(),
    notes: $('jNotes').value.trim()
  };
  if (!entry.water) { $('jMsg').textContent = 'Add the water name first.'; return; }
  const list = loadJournal(); list.unshift(entry); saveJournal(list);
  ['jWater','jSpecies','jFlies','jCond','jNotes'].forEach(id => $(id).value = '');
  $('jCount').value = 0;
  $('jMsg').textContent = 'Saved.';
  renderJournal();
};
window.delJournal = function(id){
  saveJournal(loadJournal().filter(e => e.id !== id)); renderJournal();
};
function renderJournal(){
  const list = loadJournal();
  if (!list.length) { $('jList').innerHTML = '<p class="muted">No entries yet.</p>'; return; }
  const total = list.reduce((s, e) => s + (e.count || 0), 0);
  $('jList').innerHTML = `<p class="muted">${list.length} trip${list.length === 1 ? '' : 's'} logged, ${total} fish in total.</p>` +
    list.map(e => `<div class="jentry">
      <button class="ghost" onclick="delJournal(${e.id})">Delete</button>
      <b>${esc(e.water)}</b> <span class="muted">${esc(e.date)}</span><br>
      <span>${e.count} fish${e.species ? ' · ' + esc(e.species) : ''}${e.flies ? ' · ' + esc(e.flies) : ''}</span>
      ${e.conditions ? `<div class="muted">${esc(e.conditions)}</div>` : ''}
      ${e.notes ? `<div>${esc(e.notes)}</div>` : ''}
    </div>`).join('');
}
window.exportJournal = function(){
  const list = loadJournal();
  if (!list.length) { $('jMsg').textContent = 'Nothing to export yet.'; return; }
  const cols = ['date','water','count','species','flies','conditions','notes'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(',')].concat(list.map(e => cols.map(c => q(e[c])).join(','))).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = 'gone-fishin-journal.csv';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};

/* ---------- init ---------- */
renderMap();
fillCompare();
renderJournal();
})();
