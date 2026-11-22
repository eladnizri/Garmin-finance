'use strict';
/* =========================================================================
 * planner.js — תכנון אימונים קדימה: נפח אירובי שבועי + תוכנית יומית.
 *
 * נתונים ב-localStorage:
 *   workout_plan_v1 — { aerobic: { running: km, swimming: km, cycling: km } }
 *   aero_plan_v1 — [{ day: 0..6, sport: 'running'|'swimming'|'cycling', type: 'easy'|... }]
 * ========================================================================= */
const PLAN_KEY = 'workout_plan_v1';
const AERO_SPORTS = [
  { key: 'running',  label: 'ריצה',    typeKeys: ['running', 'treadmill_running', 'trail_running'], icon: 'run',  hasKm: true  },
  { key: 'walking',  label: 'הליכה',   typeKeys: ['walking', 'casual_walking', 'speed_walking'],    icon: 'walk', hasKm: true  },
  { key: 'swimming', label: 'שחייה',   typeKeys: ['lap_swimming', 'open_water_swimming'],           icon: 'drop', hasKm: true, meters: true },
  { key: 'cycling',  label: 'אופניים', typeKeys: ['cycling', 'road_biking', 'mountain_biking', 'indoor_cycling', 'virtual_ride', 'recumbent_cycling', 'gravel_cycling'], icon: 'bike', hasKm: true  },
  { key: 'pilates',  label: 'פילאטיס', typeKeys: ['pilates', 'yoga', 'barre'],                     icon: 'yoga', hasKm: false },
];
// שחייה: גרמין שומר ק״מ, התוכנית שומרת ק״מ — הצגה במטרים בלבד
function sportDisplayKm(sport, km) { return sport.meters ? km * 1000 : km; }
function sportDisplayUnit(sport) { return sport.meters ? 'מ׳' : 'ק״מ'; }
function sportInputToKm(sport, val) { return sport.meters ? val / 1000 : val; }
function sportKmToInput(sport, km) { return sport.meters ? Math.round(km * 1000) : km; }

function getActiveSports() {
  const selected = typeof getSelectedSports === 'function' ? getSelectedSports() : null;
  if (!selected) return AERO_SPORTS;
  const weekISO = plannerWeekStart().toISOString().slice(0, 10);
  const { targets, days } = loadWeekPlan(weekISO);
  return AERO_SPORTS.filter(s =>
    selected.includes(s.key) ||
    (targets[s.key] || 0) > 0 ||
    days.some(p => p.sport === s.key)
  );
}

const AERO_PLAN_KEY = 'aero_plan_v1';   // legacy key — read-only for migration
const AERO_PLAN_V2_KEY = 'aero_plan_v2'; // per-week: { weekISO: { targets: {}, days: [] } }
const AERO_WORKOUT_TYPES = [
  { key: 'easy',      label: 'קלה' },
  { key: 'technique', label: 'טכניקה' },
  { key: 'tempo',     label: 'טמפו' },
  { key: 'intervals', label: 'אינטרוולים' },
  { key: 'volume',    label: 'נפח' },
  { key: 'rest',      label: 'מנוחה' },
];
const AERO_RUN_TYPES = AERO_WORKOUT_TYPES;

function loadPlan() {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY)) || { aerobic: {} }; }
  catch { return { aerobic: {} }; }
}
function savePlan(p) { try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch {} }

/* --- per-week storage ---------------------------------------------------- */
function _allWeekPlans() {
  try { return JSON.parse(localStorage.getItem(AERO_PLAN_V2_KEY)) || {}; } catch { return {}; }
}
function _saveAllWeekPlans(all) { try { localStorage.setItem(AERO_PLAN_V2_KEY, JSON.stringify(all)); } catch {} }

function loadWeekPlan(weekISO) {
  const all = _allWeekPlans();
  if (all[weekISO]) return all[weekISO];

  // First-time migration: carry v1 flat plan into the current week only
  if (weekISO === weekStartISO(new Date(todayISO()))) {
    try {
      const v1Days = JSON.parse(localStorage.getItem(AERO_PLAN_KEY)) || [];
      const v1Plan = JSON.parse(localStorage.getItem(PLAN_KEY)) || { aerobic: {} };
      if (v1Days.length || Object.keys(v1Plan.aerobic || {}).length) {
        const days = v1Days.map(s => s.sport ? s : { ...s, sport: 'running' });
        const migrated = { targets: { ...v1Plan.aerobic }, days };
        all[weekISO] = migrated;
        _saveAllWeekPlans(all);
        return migrated;
      }
    } catch {}
  }
  return { targets: {}, days: [] };
}

function saveWeekPlan(weekISO, data) {
  const all = _allWeekPlans();
  all[weekISO] = data;
  _saveAllWeekPlans(all);
}

// legacy shims used elsewhere in this file
function loadAeroPlan() { return loadWeekPlan(plannerWeekStart().toISOString().slice(0, 10)).days; }
function saveAeroPlan() {} // no-op — use saveWeekPlan directly

/* =========================================================================
 * ניווט שבועי — offset מהשבוע הנוכחי
 * ========================================================================= */
let plannerWeekOffset = 0;

function plannerWeekStart() {
  const d = new Date(weekStartISO(new Date(todayISO())));
  d.setDate(d.getDate() + plannerWeekOffset * 7);
  return d;
}

/* =========================================================================
 * נפח אירובי בפועל — לשבוע נתון
 * ========================================================================= */
function weekAeroActuals(ws) {
  const wsISO = ws.toISOString().slice(0, 10);
  const weISO = new Date(ws.getTime() + 6 * 86400000).toISOString().slice(0, 10);
  const rows = (state.data || []).filter(r => r.date >= wsISO && r.date <= weISO);
  const totals = {};
  for (const sport of AERO_SPORTS) totals[sport.key] = 0;
  for (const r of rows) {
    for (const w of (r.workouts || [])) {
      for (const sport of AERO_SPORTS) {
        if (sport.typeKeys.includes(w.type_key) && w.km) totals[sport.key] += w.km;
      }
    }
  }
  return totals;
}

/* =========================================================================
 * כרטיס התוכנית השבועית — כרטיס נפרד לכל ענף ספורט פעיל
 * ========================================================================= */
function renderPlanner() {
  const el = $('planner-cards');
  if (!el) return;
  const activeSports = getActiveSports();

  // אין ספורטים פעילים — מצב ריק כללי
  if (!activeSports.length) {
    el.innerHTML = `<article class="card">
      <div class="card-head"><h2>${icon('calendar', 18)} תוכנית אירובית</h2></div>
      <p class="tr-empty">בחר סוגי ספורט בהגדרות כדי לתכנן.</p>
    </article>`;
    return;
  }

  const ws = plannerWeekStart();
  const wsISO = ws.toISOString().slice(0, 10);
  const { targets, days: aeroPlan } = loadWeekPlan(wsISO);
  const today = new Date(todayISO());
  const isCurrent = plannerWeekOffset === 0;
  const isFuture = plannerWeekOffset > 0;
  const weekEnd = new Date(ws.getTime() + 6 * 86400000);
  const fmtD = d => `${d.getDate()}/${d.getMonth() + 1}`;
  const weekRange = `${fmtD(ws)}–${fmtD(weekEnd)}`;
  const weekLabel = isCurrent ? 'שבוע נוכחי'
    : isFuture ? `שבוע +${plannerWeekOffset}`
    : plannerWeekOffset === -1 ? 'שבוע שעבר' : `שבוע ${plannerWeekOffset}`;

  const actuals = weekAeroActuals(ws);
  const garminDates = weekActivityDates(ws);

  // כפתורי ניווט שבועי — משותפים לכל הכרטיסים
  const navHtml = `<div class="planner-week-nav">
    <button class="plan-week-btn" id="plan-prev-week" aria-label="שבוע קודם">‹</button>
    <span class="plan-week-nav-label">${weekLabel} · ${weekRange}</span>
    <button class="plan-week-btn" id="plan-next-week" aria-label="שבוע הבא">›</button>
  </div>`;

  let html = navHtml;

  for (const sport of activeSports) {
    const target = targets[sport.key] || 0;
    const sportDays = aeroPlan.filter(s => s.sport === sport.key);
    const hasConfig = target > 0 || sportDays.length > 0;
    const unit = sportDisplayUnit(sport);

    let body = '';

    if (!hasConfig) {
      body = `<p class="tr-empty">לחץ עריכה כדי להגדיר תוכנית.</p>`;
    } else {
      // שורת נפח שבועי
      if (target && sport.hasKm !== false) {
        const actualKm = actuals[sport.key] || 0;
        const actual = sportDisplayKm(sport, actualKm);
        const targetDisp = sportDisplayKm(sport, target);
        const pct = Math.min(actual / targetDisp * 100, 100);
        const done = actual >= targetDisp;
        body += `<div class="plan-aero"><div class="plan-sport${done ? ' done' : ''}">
          <div class="plan-sport-top">
            <span class="plan-sport-name">נפח שבועי</span>
            <span class="plan-sport-num">${fmt(actual, sport.meters ? 0 : 1)} / ${fmt(targetDisp, 0)} ${unit}</span>
          </div>
          <div class="plan-bar"><i style="width:${Math.round(pct)}%"></i></div>
        </div></div>`;
      } else if (target && sport.hasKm === false) {
        const doneCount = [...garminDates].filter(iso => {
          const day = new Date(`${iso}T12:00:00`).getDay();
          return sportDays.some(s => s.day === day);
        }).length;
        body += `<div class="plan-aero"><div class="plan-sport">
          <div class="plan-sport-top">
            <span class="plan-sport-name">אימונים השבוע</span>
            <span class="plan-sport-num">${doneCount} / ${target}</span>
          </div>
        </div></div>`;
      }

      // גריד ימים
      if (sportDays.length) {
        const daySlots = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(ws); d.setDate(ws.getDate() + i);
          const iso = d.toISOString().slice(0, 10);
          const isToday = iso === todayISO();
          const isPast = d < today && !isToday;
          const planned = sportDays.find(s => s.day === i);
          const typeInfo = planned && AERO_WORKOUT_TYPES.find(t => t.key === planned.type);
          const done = garminDates.has(iso) && !!planned;
          const isRest = !planned;
          const cls = [done ? 'done' : '', isToday ? 'today' : '', !isPast && !isToday ? 'future' : ''].filter(Boolean).join(' ');
          const kmLabel = planned?.km
            ? `${fmt(sportDisplayKm(sport, planned.km), sport.meters ? 0 : 1)} ${unit}`
            : '';
          daySlots.push(`<div class="plan-day ${cls}">
            <small>${SHORT_DAY_NAMES[i]}</small>
            ${isRest
              ? '<span class="plan-rest">—</span>'
              : `<span class="plan-prog"><span class="plan-prog-line">${kmLabel}</span>${typeInfo?.label ? `<small>${typeInfo.label}</small>` : ''}</span>`}
            ${done ? '<i class="plan-check">✓</i>' : ''}
          </div>`);
        }
        body += `<div class="plan-aero-week"><div class="plan-week">${daySlots.join('')}</div></div>`;
      }
    }

    html += `<article class="card" data-sport="${sport.key}">
      <div class="card-head">
        <h2>${icon(sport.icon, 18)} ${sport.label}</h2>
        <button class="world-link plan-edit-btn">עריכה ‹</button>
      </div>
      ${body}
    </article>`;
  }

  el.innerHTML = html;

  // אירועי ניווט
  const prevBtn = $('plan-prev-week');
  const nextBtn = $('plan-next-week');
  if (prevBtn) prevBtn.onclick = () => { plannerWeekOffset--; renderPlanner(); };
  if (nextBtn) nextBtn.onclick = () => { plannerWeekOffset++; renderPlanner(); };
}

function weekActivityDates(ws) {
  const wsISO = (ws || new Date(todayISO())).toISOString().slice(0, 10);
  const weISO = new Date(new Date(wsISO).getTime() + 6 * 86400000).toISOString().slice(0, 10);
  const s = new Set();
  for (const r of (state.data || []).filter(r => r.date >= wsISO && r.date <= weISO))
    for (const w of (r.workouts || [])) {
      if (AERO_SPORTS.some(sp => sp.typeKeys.includes(w.type_key))) s.add(r.date);
    }
  return s;
}
// backward compat
function weekRunDates() { return weekActivityDates(); }

/* =========================================================================
 * מודאל הגדרת תוכנית
 * ========================================================================= */
function openPlanSetup(sportKey) {
  const weekStart = plannerWeekStart();
  const wsISO = weekStart.toISOString().slice(0, 10);
  const { targets, days: aeroPlan } = loadWeekPlan(wsISO);
  const todayDay = new Date(todayISO()).getDay();

  // If called without a sportKey (e.g. from the empty-state button), use first active sport
  const activeSports = getActiveSports();
  const sport = activeSports.find(s => s.key === sportKey) || activeSports[0];
  if (!sport) return;

  // Days planned for this sport only
  const sportDayPlan = aeroPlan.filter(s => s.sport === sport.key);
  const unit = sportDisplayUnit(sport);

  let dayRows = '';
  for (let i = 0; i < 7; i++) {
    const planned = sportDayPlan.find(s => s.day === i);
    const isRest = !planned;
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
    const isToday = i === todayDay;
    const showKm = sport.hasKm !== false;
    const inputVal = planned?.km ? sportKmToInput(sport, planned.km) : '';
    dayRows += `<div class="plan-day-row${isRest ? ' is-rest' : ''}">
      <div class="plan-day-badge${isToday ? ' today-badge' : ''}">${SHORT_DAY_NAMES[i]}</div>
      <div class="plan-day-body">
        <div class="plan-day-top">
          <div class="plan-day-info">
            <span>${DAY_NAMES[i]}</span>
            <small>${dateStr}</small>
          </div>
          <select name="aactive_${i}" class="plan-sport-sel">
            <option value="rest"${isRest ? ' selected' : ''}>מנוחה</option>
            <option value="active"${!isRest ? ' selected' : ''}>אימון</option>
          </select>
        </div>
        <div class="plan-day-bottom">
          <select name="atype_${i}" class="plan-type-sel">
            ${AERO_WORKOUT_TYPES.filter(t => t.key !== 'rest').map(t =>
              `<option value="${t.key}" ${planned?.type === t.key ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
          ${showKm ? `<div class="plan-km-inline">
            <input type="number" name="akm_${i}" value="${inputVal}" min="0"
              step="${sport.meters ? 50 : 0.5}" inputmode="decimal" placeholder="—" class="plan-km-input">
            <span class="plan-km-unit">${unit}</span>
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }

  const targetLabel = sport.hasKm !== false ? `${unit} בשבוע` : 'אימונים בשבוע';
  const targetKm = targets[sport.key] || 0;
  const targetVal = targetKm ? sportKmToInput(sport, targetKm) : '';

  const modal = document.createElement('div');
  modal.id = 'plan-modal';
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-backdrop"></div>
    <div class="modal-sheet tall">
      <div class="modal-head"><h2>תוכנית ${sport.label}</h2>
        <button class="close-btn" aria-label="סגירה">✕</button></div>
      <form id="plan-form">
        <div class="plan-section">
          <div class="plan-section-title">יעד שבועי</div>
          <div class="plan-grouped-list">
            <div class="plan-grouped-row">
              <label class="plan-grouped-label" for="aero_target">${sport.label} <small>${targetLabel}</small></label>
              <input type="number" id="aero_target" name="aero_target"
                value="${targetVal}" min="0" ${sport.hasKm !== false ? 'step="1"' : 'max="7" step="1"'}
                inputmode="decimal" placeholder="0">
            </div>
          </div>
        </div>
        <div class="plan-section">
          <div class="plan-section-title">אימון לפי יום</div>
          <div class="plan-grouped-list">${dayRows}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" id="plan-cancel">ביטול</button>
          <button type="submit" class="btn-primary">שמור</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.close-btn').onclick = close;
  modal.querySelector('.modal-backdrop').onclick = close;
  $('plan-cancel').onclick = close;

  for (let i = 0; i < 7; i++) {
    const sel = modal.querySelector(`[name="aactive_${i}"]`);
    if (sel) sel.addEventListener('change', () => {
      sel.closest('.plan-day-row').classList.toggle('is-rest', sel.value === 'rest');
    });
  }

  $('plan-form').onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const current = loadWeekPlan(wsISO);

    // Update target for this sport only
    const rawTarget = Number(f['aero_target']?.value);
    const targetKmNew = rawTarget > 0 ? sportInputToKm(sport, rawTarget) : 0;
    if (targetKmNew > 0) current.targets[sport.key] = targetKmNew;
    else delete current.targets[sport.key];

    // Replace only this sport's days, keep other sports' days
    const otherDays = current.days.filter(s => s.sport !== sport.key);
    const thisDays = [];
    for (let i = 0; i < 7; i++) {
      const active = f[`aactive_${i}`]?.value;
      const type = f[`atype_${i}`]?.value;
      if (active && active !== 'rest') {
        const rawKm = Number(f[`akm_${i}`]?.value);
        const entry = { day: i, sport: sport.key, type: type || 'easy' };
        if (rawKm > 0) entry.km = sportInputToKm(sport, rawKm);
        thisDays.push(entry);
      }
    }

    current.days = [...otherDays, ...thisDays];
    saveWeekPlan(wsISO, current);
    close();
    renderPlanner();
    toast('התוכנית נשמרה');
  };
}

/* =========================================================================
 * תוכנית כוח שבועית
 * ========================================================================= */
const STRENGTH_WEEK_KEY = 'strength_week_plan_v1';

function loadStrengthWeekPlan() {
  try { return JSON.parse(localStorage.getItem(STRENGTH_WEEK_KEY)) || []; }
  catch { return []; }
}
function saveStrengthWeekPlan(p) {
  try { localStorage.setItem(STRENGTH_WEEK_KEY, JSON.stringify(p)); } catch {}
}

function renderStrengthWeekCard() {
  const el = $('strength-week-card');
  if (!el) return;
  const plan = loadStrengthWeekPlan();
  const progs = (typeof programs !== 'undefined') ? programs : [];
  const todayDow = new Date(`${todayISO()}T12:00:00`).getDay();

  const weekStart = new Date(weekStartISO(new Date(todayISO())));
  const fmtD = d => `${d.getDate()}/${d.getMonth() + 1}`;
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const weekRange = `${fmtD(weekStart)}–${fmtD(weekEnd)}`;

  let body = '';
  if (!plan.length) {
    body = `<p class="tr-empty">הגדר תוכנית כוח שבועית — לכל יום תוכנית מהמאגר שלך.</p>
      <button class="btn-primary tr-wide" id="str-week-setup">הגדרת תוכנית כוח</button>`;
  } else {
    const auto = (typeof autoStrengthDates === 'function') ? autoStrengthDates() : new Set();
    body = '<div class="plan-aero-week"><div class="plan-week">';
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const isToday = i === todayDow;
      const isFuture = d > new Date(todayISO());
      const planned = plan.find(s => s.day === i);
      const prog = planned && progs.find(p => p.id === planned.programId);
      const done = (typeof strengthDone === 'function') ? strengthDone(iso, auto) : auto.has(iso);
      const isRest = !planned;
      const cls = [done ? 'done' : '', isToday ? 'today' : '', isFuture ? 'future' : ''].filter(Boolean).join(' ');
      body += `<button class="plan-day ${cls}" data-iso="${iso}" ${isFuture || isRest ? 'disabled' : ''}>
        <small>${SHORT_DAY_NAMES[i]}</small>
        ${isRest ? '<span class="plan-rest">—</span>' : `<span class="plan-prog">${prog?.name?.slice(0,8) || '?'}</span>`}
        ${done && !isRest ? '<i class="plan-check">✓</i>' : ''}
      </button>`;
    }
    body += '</div></div>';
  }

  el.innerHTML = `<article class="card">
    <div class="card-head">
      <h2>${icon('dumbbell', 18)} תוכנית כוח שבועית</h2>
      <button class="world-link" id="str-week-edit">עריכה ‹</button>
    </div>
    <div class="plan-week-header">
      <span class="plan-week-label">שבוע נוכחי</span>
      <span class="plan-week-dates">${weekRange}</span>
    </div>
    ${body}
  </article>`;

  const setupBtn = $('str-week-setup');
  if (setupBtn) setupBtn.onclick = () => openStrengthWeekSetup();
  const editBtn = $('str-week-edit');
  if (editBtn) editBtn.onclick = () => openStrengthWeekSetup();
}

function openStrengthWeekSetup() {
  const plan = loadStrengthWeekPlan();
  const progs = (typeof programs !== 'undefined') ? programs : [];
  const todayDay = new Date(todayISO()).getDay();
  const weekStart = new Date(weekStartISO(new Date(todayISO())));

  if (!progs.length) {
    if (typeof toast === 'function') toast('צור תוכנית כוח קודם בעמוד הכוח');
    return;
  }

  let dayRows = '';
  for (let i = 0; i < 7; i++) {
    const planned = plan.find(s => s.day === i);
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
    const isToday = i === todayDay;
    dayRows += `<div class="plan-day-row">
      <div class="plan-day-badge${isToday ? ' today-badge' : ''}">${SHORT_DAY_NAMES[i]}</div>
      <div class="plan-day-info">
        <span>${DAY_NAMES[i]}</span>
        <small>${dateStr}</small>
      </div>
      <select name="sprog_${i}" style="flex:1;height:36px;padding:0 8px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface);color:var(--ink);font-size:.82rem;font-family:inherit;">
        <option value="">מנוחה</option>
        ${progs.map(p => `<option value="${p.id}" ${planned?.programId === p.id ? 'selected' : ''}>${p.name || 'ללא שם'}</option>`).join('')}
      </select>
    </div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'strength-week-modal';
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-backdrop"></div>
    <div class="modal-sheet tall">
      <div class="modal-head"><h2>תוכנית כוח שבועית</h2>
        <button class="close-btn" aria-label="סגירה">✕</button></div>
      <form id="strength-week-form">
        <div class="plan-section">
          <div class="plan-section-title">בחר תוכנית לכל יום</div>
          <div class="plan-grouped-list">${dayRows}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" id="str-week-cancel">ביטול</button>
          <button type="submit" class="btn-primary">שמור</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.close-btn').onclick = close;
  modal.querySelector('.modal-backdrop').onclick = close;
  modal.querySelector('#str-week-cancel').onclick = close;

  modal.querySelector('#strength-week-form').onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const newPlan = [];
    for (let i = 0; i < 7; i++) {
      const progId = f[`sprog_${i}`]?.value;
      if (progId) newPlan.push({ day: i, programId: progId });
    }
    saveStrengthWeekPlan(newPlan);
    close();
    renderStrengthWeekCard();
    if (typeof renderToday === 'function') renderToday();
    if (typeof toast === 'function') toast('תוכנית הכוח השבועית נשמרה');
  };
}
