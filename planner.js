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
  { key: 'swimming', label: 'שחייה',   typeKeys: ['lap_swimming', 'open_water_swimming'],           icon: 'drop', hasKm: true  },
  { key: 'cycling',  label: 'אופניים', typeKeys: ['cycling', 'road_biking', 'mountain_biking', 'indoor_cycling'], icon: 'bike', hasKm: true  },
  { key: 'pilates',  label: 'פילאטיס', typeKeys: ['pilates', 'yoga', 'barre'],                     icon: 'yoga', hasKm: false },
];

function getActiveSports() {
  const selected = typeof getSelectedSports === 'function' ? getSelectedSports() : null;
  if (!selected) return AERO_SPORTS;
  // include sports explicitly selected + any sport that already has plan data
  const plan = loadPlan();
  const aeroPlan = loadAeroPlan();
  return AERO_SPORTS.filter(s =>
    selected.includes(s.key) ||
    plan.aerobic[s.key] > 0 ||
    aeroPlan.some(p => p.sport === s.key)
  );
}

const AERO_PLAN_KEY = 'aero_plan_v1';
const AERO_WORKOUT_TYPES = [
  { key: 'easy',      label: 'קלה' },
  { key: 'technique', label: 'טכניקה' },
  { key: 'tempo',     label: 'טמפו' },
  { key: 'intervals', label: 'אינטרוולים' },
  { key: 'volume',    label: 'נפח' },
  { key: 'rest',      label: 'מנוחה' },
];
// backward compat alias
const AERO_RUN_TYPES = AERO_WORKOUT_TYPES;

function loadPlan() {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY)) || { aerobic: {} }; }
  catch { return { aerobic: {} }; }
}
function savePlan(p) { try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch {} }

function loadAeroPlan() {
  try {
    const raw = JSON.parse(localStorage.getItem(AERO_PLAN_KEY)) || [];
    // migrate old format: { day, type } → { day, sport: 'running', type }
    return raw.map(s => s.sport ? s : { ...s, sport: 'running' });
  } catch { return []; }
}
function saveAeroPlan(p) { try { localStorage.setItem(AERO_PLAN_KEY, JSON.stringify(p)); } catch {} }

/* =========================================================================
 * נפח אירובי בפועל השבוע — מתוך workouts שגרמין שלח
 * ========================================================================= */
function weekAeroActuals() {
  const ws = weekStartISO(new Date(todayISO()));
  const rows = (state.data || []).filter(r => r.date >= ws);
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
  const plan = loadPlan();
  const aeroPlan = loadAeroPlan();
  const activeSports = getActiveSports();
  const hasAnyPlan = AERO_SPORTS.some(s => plan.aerobic[s.key] > 0) || aeroPlan.length > 0;

  if (!hasAnyPlan) {
    el.innerHTML = `<article class="card">
      <div class="card-head"><h2>${icon('calendar', 18)} תוכנית אירובית</h2></div>
      <p class="tr-empty">תכנן את השבוע: הגדר נפח אירובי לפי ענף ותוכנית שבועית.</p>
      <button class="btn-primary tr-wide" id="plan-setup">הגדרת תוכנית</button>
    </article>`;
    return;
  }

  const actuals = weekAeroActuals();
  const today = new Date(todayISO());
  const ws = new Date(weekStartISO(today));
  const weekEnd = new Date(ws); weekEnd.setDate(ws.getDate() + 6);
  const fmtD = d => `${d.getDate()}/${d.getMonth() + 1}`;
  const weekRange = `${fmtD(ws)}–${fmtD(weekEnd)}`;
  const garminDates = weekActivityDates();

  let html = '';

  for (const sport of activeSports) {
    const target = plan.aerobic[sport.key] || 0;
    const sportDays = aeroPlan.filter(s => s.sport === sport.key);

    let body = '';

    // שורת נפח שבועי
    if (target && sport.hasKm !== false) {
      const actual = actuals[sport.key] || 0;
      const pct = Math.min(actual / target * 100, 100);
      const done = actual >= target;
      body += `<div class="plan-aero"><div class="plan-sport${done ? ' done' : ''}">
        <div class="plan-sport-top">
          <span class="plan-sport-name">נפח שבועי</span>
          <span class="plan-sport-num">${fmt(actual, 1)} / ${fmt(target, 0)} ק״מ</span>
        </div>
        <div class="plan-bar"><i style="width:${Math.round(pct)}%"></i></div>
      </div></div>`;
    } else if (target && sport.hasKm === false) {
      // ספורט ללא ק״מ (פילאטיס) — ספירת ימים
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

    // גריד ימים — רק ימים שתוכננו לענף זה
    if (sportDays.length) {
      const daySlots = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws);
        d.setDate(ws.getDate() + i);
        const iso = d.toISOString().slice(0, 10);
        const isFuture = d > today;
        const isToday = iso === todayISO();
        const planned = sportDays.find(s => s.day === i);
        const typeInfo = planned && AERO_WORKOUT_TYPES.find(t => t.key === planned.type);
        const done = garminDates.has(iso) && !!planned;
        const isRest = !planned;
        const cls = [done ? 'done' : '', isToday ? 'today' : '', isFuture ? 'future' : ''].filter(Boolean).join(' ');
        daySlots.push(`<div class="plan-day ${cls}">
          <small>${SHORT_DAY_NAMES[i]}</small>
          ${isRest
            ? '<span class="plan-rest">—</span>'
            : `<span class="plan-prog"><span class="plan-prog-line">${planned?.km ? `${fmt(planned.km, 1)} ק"מ` : ''}</span>${typeInfo?.label ? `<small>${typeInfo.label}</small>` : ''}</span>`}
          ${done ? '<i class="plan-check">✓</i>' : ''}
        </div>`);
      }
      body += `<div class="plan-aero-week"><div class="plan-week">${daySlots.join('')}</div></div>`;
    }

    if (!body) body = `<p class="tr-empty">לחץ עריכה כדי להגדיר תוכנית.</p>`;

    html += `<article class="card" data-sport="${sport.key}">
      <div class="card-head">
        <h2>${icon(sport.icon, 18)} ${sport.label}</h2>
        <button class="world-link plan-edit-btn">עריכה ‹</button>
      </div>
      <div class="plan-week-header">
        <span class="plan-week-label">שבוע נוכחי</span>
        <span class="plan-week-dates">${weekRange}</span>
      </div>
      ${body}
    </article>`;
  }

  if (!html) {
    // תוכנית קיימת אבל לא לאף ענף פעיל
    html = `<article class="card">
      <div class="card-head"><h2>${icon('calendar', 18)} תוכנית אירובית</h2></div>
      <p class="tr-empty">הגדר תוכנית לסוגי הספורט שבחרת.</p>
      <button class="btn-primary tr-wide" id="plan-setup">הגדרת תוכנית</button>
    </article>`;
  }

  el.innerHTML = html;
}

function weekActivityDates() {
  const ws = weekStartISO(new Date(todayISO()));
  const s = new Set();
  for (const r of (state.data || []).filter(r => r.date >= ws))
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
  const plan = loadPlan();
  const aeroPlan = loadAeroPlan();
  const todayDay = new Date(todayISO()).getDay();
  const weekStart = new Date(weekStartISO(new Date(todayISO())));

  // If called without a sportKey (e.g. from the empty-state button), use first active sport
  const activeSports = getActiveSports();
  const sport = activeSports.find(s => s.key === sportKey) || activeSports[0];
  if (!sport) return;

  // Days planned for this sport only
  const sportDayPlan = aeroPlan.filter(s => s.sport === sport.key);

  let dayRows = '';
  for (let i = 0; i < 7; i++) {
    const planned = sportDayPlan.find(s => s.day === i);
    const isRest = !planned;
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
    const isToday = i === todayDay;
    const showKm = sport.hasKm !== false;
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
            <input type="number" name="akm_${i}" value="${planned?.km || ''}" min="0" step="0.5"
              inputmode="decimal" placeholder="—" class="plan-km-input">
            <span class="plan-km-unit">ק״מ</span>
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }

  const targetLabel = sport.hasKm !== false ? 'ק״מ בשבוע' : 'אימונים בשבוע';
  const targetVal = plan.aerobic[sport.key] || '';

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

    // Update only this sport's target, keep others
    const newPlan = loadPlan();
    const v = Number(f['aero_target']?.value);
    if (v > 0) newPlan.aerobic[sport.key] = v;
    else delete newPlan.aerobic[sport.key];

    // Replace only this sport's days in aero_plan, keep other sports' days
    const otherDays = loadAeroPlan().filter(s => s.sport !== sport.key);
    const thisDays = [];
    for (let i = 0; i < 7; i++) {
      const active = f[`aactive_${i}`]?.value;
      const type = f[`atype_${i}`]?.value;
      if (active && active !== 'rest') {
        const kmVal = Number(f[`akm_${i}`]?.value);
        const entry = { day: i, sport: sport.key, type: type || 'easy' };
        if (kmVal > 0) entry.km = kmVal;
        thisDays.push(entry);
      }
    }

    savePlan(newPlan);
    saveAeroPlan([...otherDays, ...thisDays]);
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
