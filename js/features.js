/* Gone Fishin' extra features: state map, best day, wind alerts, reminders,
   and trip checklist. Loaded after the main script, so it can use
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
function waterStatus(l, month){
  if ((l.best_months || []).includes(month)) return 'best';
  if ((l.fish_months || []).includes(month)) return 'open';
  return null;
}
// Tile score: hatches count 1 (2 in peak), a water in its best months 3, an open water 1.
function stateScores(month){
  const out = {};
  DB.insects.forEach(ins => {
    if (!ins.months.includes(month)) return;
    (ins.states || []).forEach(s => { out[s] = (out[s] || 0) + 1 + (ins.peak_months.includes(month) ? 1 : 0); });
  });
  DB.lakes.forEach(l => {
    const st = waterStatus(l, month);
    if (!st) return;
    (l.states || []).forEach(s => { out[s] = (out[s] || 0) + (st === 'best' ? 3 : 1); });
  });
  return out;
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
  const waters = DB.lakes.filter(l => (l.states || []).includes(name));
  const best = waters.filter(l => waterStatus(l, month) === 'best');
  const open = waters.filter(l => waterStatus(l, month) === 'open');
  const insects = DB.insects.filter(i => (i.states || []).includes(name) && i.months.includes(month));
  const row = l => `<li><b>${esc(l.name.split(' (')[0])}</b> <span class="muted">${esc(l.type === 'stream' ? 'stream' : 'still water')}</span></li>`;
  let waterHtml;
  if (best.length) waterHtml = `<div><b>Fishing well in ${mon}</b></div><ul class="tips">${best.map(row).join('')}</ul>`;
  else if (open.length) waterHtml = `<div><b>Open in ${mon}, not in the prime window</b></div><ul class="tips">${open.map(row).join('')}</ul>`;
  else waterHtml = waters.length ? `<p class="muted">No saved water in this state is in its season in ${mon}.</p>` : '';
  if (!waters.length) waterHtml = `<p class="muted">No water notes for this state yet.</p>`;
  $('mapDetail').innerHTML = `<b style="color:var(--ink)">${esc(name)} in ${mon}</b>
    ${waterHtml}
    ${insects.length ? `<div style="margin-top:8px"><b>Hatches expected</b></div><ul class="tips">${insects.map(i => `<li><b>${esc(i.name)}</b>${i.peak_months.includes(month) ? ' <span class="pill peak">peak</span>' : ''} <span class="muted">${esc(i.time_of_day)}</span></li>`).join('')}</ul>`
      : `<p class="muted">${hasAnyData(name) ? 'No hatches are listed for this state in this month.' : 'No hatch data for this state yet.'}</p>`}`;
  if (!quiet) renderMap();
};
function hatchPeaks(lake, habitat, month, state){
  const list = activeHatches(month, habitat, null, lake ? lake.insect_ids : null, state);
  return { total: list.length, peaks: list.filter(h => h.peak).length };
}

/* ---------- best day finder ---------- */
let lastPlan = null;
async function nwsHourly(lat, lon){
  const H = { 'Accept': 'application/geo+json' };
  try {
    const pr = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: H });
    if (!pr.ok) return null;
    const hr = await fetch((await pr.json()).properties.forecastHourly, { headers: H });
    if (!hr.ok) return null;
    return (await hr.json()).properties.periods;
  } catch(e) { return null; }
}
// NWS hours for one date, same window rules as the main plan. Null if NWS has no hours for it.
function nwsDayFrom(periods, dateStr, win){
  if (!periods) return null;
  const inWin = hr => win === 'am' ? hr <= 12 : win === 'pm' ? hr >= 12 : (hr >= 6 && hr <= 20);
  const day = periods.filter(x => x.startTime.slice(0,10) === dateStr && inWin(parseInt(x.startTime.slice(11,13))));
  if (!day.length) return null;
  const mean = arr => arr.reduce((s,v) => s + v, 0) / arr.length;
  const tC = day.map(x => (x.temperature - 32) * 5 / 9);
  const kmh = day.map(x => (parseFloat(x.windSpeed) || 0) / 0.621371);
  const pops = day.map(x => x.probabilityOfPrecipitation?.value).filter(v => v != null);
  return { temp: mean(tC), wind: mean(kmh), rainChance: pops.length ? Math.max(...pops) : null };
}
async function findBestDay(){
  const btn = $('bdBtn'); const out = $('bdOut');
  if (!place) return;
  btn.disabled = true; out.innerHTML = '<p class="muted">Checking the next 10 days (National Weather Service first)…</p>';
  const lake = findLake(place);
  const saved = ELEV_M;
  ELEV_M = lake ? Math.round(lake.elevation_ft * 0.3048) : null;
  const today = iso(new Date());
  const dates = [...Array(10).keys()].map(i => shiftDay(today, i));
  const win = $('when').value;
  try {
    const usa = await nwsHourly(place.lat, place.lon);
    const rows = await Promise.all(dates.map(async d => {
      try {
        // Open-Meteo supplies cloud cover and the fallback for days NWS doesn't cover
        const f = await getForecast(place.lat, place.lon, d);
        const om = hourlyDayAverages(f, d, win);
        const n = nwsDayFrom(usa, d, win);
        const a = n ? { ...om, temp: n.temp, wind: n.wind, rainChance: n.rainChance != null ? n.rainChance : om.rainChance } : om;
        const sc = scoreDay(a);
        const hp = hatchPeaks(lake, place.habitat, parseInt(d.slice(5, 7)), place.state);
        return { d, a, sc, hp, src: n ? 'NWS' : 'Open-Meteo', ok: true };
      } catch(e) { return { d, ok: false, err: e.message }; }
    }));
    const good = rows.filter(r => r.ok);
    if (!good.length) { out.innerHTML = '<p class="warn">Forecast not available for these dates.</p>'; return; }
    good.sort((x, y) => (y.sc.s + Math.min(y.hp.peaks, 4)) - (x.sc.s + Math.min(x.hp.peaks, 4)));
    const top = good[0];
    out.innerHTML = `<p><b>Best day: ${new Date(top.d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</b>, ${top.sc.label.toLowerCase()} (score ${top.sc.s}). ${fmtWind(top.a.wind)} wind, air ${fmtTemp(top.a.temp)}, ${top.hp.peaks} hatch${top.hp.peaks === 1 ? '' : 'es'} at peak.</p>
      <table class="bd"><tr><th>Day</th><th>Score</th><th>Wind</th><th>Air</th><th>Rain</th><th>Peak hatches</th><th>Source</th></tr>` +
      good.map(r => `<tr><td>${new Date(r.d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
        <td>${r.sc.s} ${esc(r.sc.label)}</td>
        <td>${fmtWind(r.a.wind)}${r.a.wind >= 24 ? ' ⚠' : ''}</td><td>${fmtTemp(r.a.temp)}</td>
        <td>${r.a.rainChance != null ? Math.round(r.a.rainChance) + '%' : '—'}</td><td>${r.hp.peaks}</td><td class="muted">${r.src}</td></tr>`).join('') +
      `</table><p class="muted">NWS covers about the next 7 days. Later days use Open-Meteo. ${rows.length - good.length ? (rows.length - good.length) + ' day(s) had no forecast.' : ''}</p>`;
  } finally { ELEV_M = saved; btn.disabled = false; }
}

/* ---------- wind alert banner ---------- */
function windBanner(wx){
  if (!wx || !wx.a || wx.a.wind == null) return '';
  const w = wx.a.wind;
  if (w >= 24) return `<div class="alert strong"><b>Strong wind expected</b> (about ${fmtWind(w)}). Casting and drifting will be hard. Fish sheltered banks, or pick another day.</div>`;
  if (w >= 16) return `<div class="alert breezy"><b>Breezy</b> (about ${fmtWind(w)}). Look for sheltered water and heavier flies or sinking lines.</div>`;
  return '';
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
    </div>
    <div id="bdOut" style="margin-top:12px"></div>` + renderChecklist(lake, dateStr, wx);
};

/* ---------- trip checklist (built from the chosen water's notes) ---------- */
const CKEY = 'gone-fishin-checklist';
function loadChecks(){ try { return JSON.parse(localStorage.getItem(CKEY)) || {}; } catch(e) { return {}; } }
function saveChecks(o){ try { localStorage.setItem(CKEY, JSON.stringify(o)); } catch(e) {} }
function buildChecklist(lake, dateStr, wx){
  const items = [];
  const add = (g, t) => items.push({ g, t });
  add('Before you leave', 'Arizona fishing license, or the license for the state you are fishing in');
  add('Before you leave', 'Water, sun protection, and a charged phone');
  add('Before you leave', 'Tell someone where you are going and when you expect to be back');
  if (!lake) {
    add('Fishing plan', 'This place is not in the notes yet. Look up its rules and stocking schedule before you go.');
  } else {
    const type = lake.type || '';
    if (/stream|river/.test(type)) add('Gear', 'Wading boots or sandals with good grip, and check the flow before you wade');
    if (/lake|reservoir|pond|marsh/.test(type)) add('Gear', 'Float tube or boat only where the water rules allow it');
    if (lake.stocking) {
      const st = lake.stocking.status || '';
      if (st === 'stocked') add('Fishing plan', 'Fish within a few days of the latest stocking. ' + (lake.stocking.schedule || ''));
      else add('Fishing plan', 'Wild fish only. ' + (lake.stocking.summary || ''));
    }
    (lake.species || []).slice(0, 4).forEach(s => add('Target species', s.name + (s.stocking ? ' (' + s.stocking + ')' : '')));
    const bugs = (lake.insect_ids || []).map(id => DB.insects.find(i => i.id === id)).filter(Boolean);
    if (bugs.length) add('Flies to bring', 'Patterns for: ' + bugs.map(i => i.name).join(', '));
    (lake.forage || []).filter(x => x.basis === 'sourced').slice(0, 3).forEach(x => add('Flies to bring', x.item + ': ' + x.detail));
    if (lake.fishing_season_note) add('Access', lake.fishing_season_note);
    if (/verify|not set|not sourced/i.test(lake.coords_note || '')) add('Access', 'Check the access point on a map first. ' + lake.coords_note);
    (lake.notes || []).filter(n => /limit|bag|release|hook|closed|closure|permit|rule|regulation|boat|motor|license/i.test(n)).slice(0, 3).forEach(n => add('Rules', n));
  }
  if (wx) {
    add('Weather', 'Forecast for ' + dateStr + ': wind ' + fmtWind(wx.a.wind) + ', air ' + fmtTemp(wx.a.temp) + ', rain chance ' + Math.round(wx.a.rainChance) + '%');
    add('Weather', 'Recheck the forecast the morning of the trip');
  }
  return items;
}
function renderChecklist(lake, dateStr, wx){
  const items = buildChecklist(lake, dateStr, wx);
  const label = lake ? lake.name : place.name;
  const key = (lake ? lake.id : place.name) + '|' + dateStr;
  const saved = loadChecks()[key] || {};
  const groups = [];
  items.forEach((it, i) => {
    let g = groups.find(x => x.g === it.g);
    if (!g) { g = { g: it.g, list: [] }; groups.push(g); }
    g.list.push({ t: it.t, i });
  });
  return `<div id="checklist" data-key="${esc(key)}" style="margin-top:14px"><h2>Trip checklist</h2>
    <p class="muted">Built from the notes for ${esc(label)}. Checks are saved on this device.</p>` +
    groups.map(g => `<h3>${esc(g.g)}</h3>` + g.list.map(x => `<label style="display:block;margin:4px 0"><input type="checkbox" data-i="${x.i}" ${saved[x.i] ? 'checked' : ''}> ${esc(x.t)}</label>`).join('')).join('') +
    `</div>`;
}
document.addEventListener('change', e => {
  const box = e.target;
  const root = box && box.closest && box.closest('#checklist');
  if (!root || box.type !== 'checkbox') return;
  const all = loadChecks();
  all[root.dataset.key] = all[root.dataset.key] || {};
  all[root.dataset.key][box.dataset.i] = box.checked;
  saveChecks(all);
});

/* ---------- init ---------- */
renderMap();
})();
