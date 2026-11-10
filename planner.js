'use strict';
/* =========================================================================
 * planner.js — תכנון אימונים קדימה: נפח אירובי שבועי + תוכנית כוח ליום.
 *
 * נתונים ב-localStorage:
 *   workout_plan_v1 — { aerobic: { running: km, swimming: km, cycling: km } }
 *   aero_plan_v1 — [{ day: 0..6, type: 'easy'|'tempo'|'intervals'|'long' }]
 * ========================================================================= */
const PLAN_KEY = 'workout_plan_v1';
const AERO_SPORTS = [
  { key: 'running',  label: 'ריצה',    typeKeys: ['running', 'treadmill_running', 'trail_running'], icon: 'run' },
  { key: 'swimming', label: 'שחייה',   typeKeys: ['lap_swimming', 'open_water_swimming'],           icon: 'swim' },
  { key: 'cycling',  label: 'אופניים', typeKeys: ['cycling', 'road_biking', 'mountain_biking', 'indoor_cycling'], icon: 'bike' },
];

const AERO_PLAN_KEY = 'aero_plan_v1';
const AERO_RUN_TYPES = [
  { key: 'easy',      label: 'קלה' },
  { key: 'tempo',     label: 'טמפו' },
  { key: 'intervals', label: 'אינטרוולים' },
  { key: 'long',      label: 'ריצה ארוכה' },
  { key: 'rest',      label: 'מנוחה' },
];

function loadPlan() {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY)) || { aerobic: {} }; }
  catch { return { aerobic: {} }; }
}
function savePlan(p) { try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch {} }

function loadAeroPlan() {
  try { return JSON.parse(localStorage.getItem(AERO_PLAN_KEY)) || []; } catch { return []; }
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
 * כרטיס התוכנית השבועית
 * ========================================================================= */
function renderPlanner() {
  const el = $('planner-card');
  if (!el) return;
  const plan = loadPlan();
  const aeroPlan = loadAeroPlan();
  const hasAero = AERO_SPORTS.some(s => plan.aerobic[s.key] > 0);
  const hasAeroPlan = aeroPlan.length > 0;

  if (!hasAero && !hasAeroPlan) {
    el.innerHTML = `<article class="card">
      <div class="card-head"><h2>${icon('calendar', 18)} תוכנית אירובית</h2></div>
      <p class="tr-empty">תכנן את השבוע: הגדר נפח אירובי לפי ענף ותוכנית ריצות שבועית.</p>
      <button class="btn-primary tr-wide" id="plan-setup">הגדרת תוכנית</button>
    </article>`;
    return;
  }

  let body = '';

  // נפח שבועי: יעד מול ביצוע
  if (hasAero) {
    const actuals = weekAeroActuals();
    body += '<div class="plan-aero">';
    for (const sport of AERO_SPORTS) {
      const target = plan.aerobic[sport.key] || 0;
      if (!target) continue;
      const actual = actuals[sport.key] || 0;
      const pct = Math.min(actual / target * 100, 100);
      const done = actual >= target;
      body += `<div class="plan-sport${done ? ' done' : ''}">
        <div class="plan-sport-top">
          <span class="plan-sport-name">${sport.label}</span>
          <span class="plan-sport-num">${fmt(actual, 1)} / ${fmt(target, 0)} ק״מ</span>
        </div>
        <div class="plan-bar"><i style="width:${Math.round(pct)}%"></i></div>
      </div>`;
    }
    body += '</div>';
  }

  // תוכנית ריצות שבועית — סוג ריצה לכל יום
  if (hasAeroPlan) {
    const today = new Date(todayISO());
    const ws = new Date(weekStartISO(today));
    const garminRuns = weekRunDates();
    body += '<div class="plan-aero-week">';
    const daySlots = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws);
      d.setDate(ws.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const isFuture = d > today;
      const isToday = iso === todayISO();
      const planned = aeroPlan.find(s => s.day === i);
      const typeInfo = planned && AERO_RUN_TYPES.find(t => t.key === planned.type);
      const done = garminRuns.has(iso);
      const isRest = !planned || planned.type === 'rest';
      const cls = [done ? 'done' : '', isToday ? 'today' : '', isFuture ? 'future' : ''].filter(Boolean).join(' ');
      daySlots.push(`<div class="plan-day ${cls}">
        <small>${DAY_NAMES[i][0]}</small>
        ${isRest ? '<span class="plan-rest">—</span>' : `<span class="plan-prog">${typeInfo?.label || ''}</span>`}
        ${done && !isRest ? '<i class="plan-check">✓</i>' : ''}
      </div>`);
    }
    body += `<div class="plan-week">${daySlots.join('')}</div></div>`;
  }

  el.innerHTML = `<article class="card">
    <div class="card-head"><h2>${icon('calendar', 18)} תוכנית אירובית</h2>
      <button class="world-link" id="plan-edit">עריכה ‹</button></div>
    ${body}
  </article>`;
}

function weekRunDates() {
  const ws = weekStartISO(new Date(todayISO()));
  const s = new Set();
  for (const r of (state.data || []).filter(r => r.date >= ws))
    for (const w of (r.workouts || [])) if (w.type_key === 'running') s.add(r.date);
  return s;
}

/* =========================================================================
 * מודאל הגדרת תוכנית
 * ========================================================================= */
function openPlanSetup() {
  const plan = loadPlan();
  const aeroPlan = loadAeroPlan();

  let aeroFields = '';
  for (const sport of AERO_SPORTS) {
    aeroFields += `<div class="plan-field">
      <label>${sport.label} (ק״מ בשבוע)</label>
      <input type="number" name="aero_${sport.key}" value="${plan.aerobic[sport.key] || ''}"
        min="0" step="1" inputmode="decimal" placeholder="0">
    </div>`;
  }

  let weekFields = '';
  for (let i = 0; i < 7; i++) {
    const planned = aeroPlan.find(s => s.day === i);
    weekFields += `<div class="plan-field plan-day-field">
      <label>${DAY_NAMES[i]}</label>
      <select name="aday_${i}">
        <option value="rest">מנוחה</option>
        ${AERO_RUN_TYPES.filter(t => t.key !== 'rest').map(t =>
          `<option value="${t.key}" ${planned?.type === t.key ? 'selected' : ''}>${t.label}</option>`).join('')}
      </select>
    </div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'plan-modal';
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-backdrop"></div>
    <div class="modal-sheet tall">
      <div class="modal-head"><h2>תוכנית אירובית</h2>
        <button class="close-btn" aria-label="סגירה">✕</button></div>
      <form id="plan-form">
        <h3>נפח שבועי</h3>
        ${aeroFields}
        <h3>סוג ריצה לפי יום</h3>
        ${weekFields}
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

  $('plan-form').onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const newPlan = { aerobic: {} };
    for (const sport of AERO_SPORTS) {
      const v = Number(f[`aero_${sport.key}`]?.value);
      if (v > 0) newPlan.aerobic[sport.key] = v;
    }
    const newAeroPlan = [];
    for (let i = 0; i < 7; i++) {
      const type = f[`aday_${i}`]?.value;
      if (type && type !== 'rest') newAeroPlan.push({ day: i, type });
    }
    savePlan(newPlan);
    saveAeroPlan(newAeroPlan);
    close();
    renderPlanner();
    toast('התוכנית נשמרה');
  };
}
