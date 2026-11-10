'use strict';
/* =========================================================================
 * planner.js — תכנון אימונים קדימה: נפח אירובי שבועי + תוכנית כוח ליום.
 *
 * נתונים ב-localStorage:
 *   workout_plan_v1 — { aerobic: { running: km, swimming: km, cycling: km },
 *                       strength: [{ day: 0..6, programId }] }
 * ========================================================================= */
const PLAN_KEY = 'workout_plan_v1';
const AERO_SPORTS = [
  { key: 'running',  label: 'ריצה',    typeKeys: ['running', 'treadmill_running', 'trail_running'], icon: 'run' },
  { key: 'swimming', label: 'שחייה',   typeKeys: ['lap_swimming', 'open_water_swimming'],           icon: 'swim' },
  { key: 'cycling',  label: 'אופניים', typeKeys: ['cycling', 'road_biking', 'mountain_biking', 'indoor_cycling'], icon: 'bike' },
];

function loadPlan() {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY)) || { aerobic: {}, strength: [] }; }
  catch { return { aerobic: {}, strength: [] }; }
}
function savePlan(p) { try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch {} }

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
  const hasAero = AERO_SPORTS.some(s => plan.aerobic[s.key] > 0);
  const hasStrength = plan.strength.length > 0;

  if (!hasAero && !hasStrength) {
    el.innerHTML = `<article class="card">
      <div class="card-head"><h2>${icon('calendar', 18)} תוכנית שבועית</h2></div>
      <p class="tr-empty">תכנן את השבוע: הגדר נפח אירובי לפי ענף, ושבץ אימוני כוח לפי יום.</p>
      <button class="btn-primary tr-wide" id="plan-setup">הגדרת תוכנית</button>
    </article>`;
    return;
  }

  let body = '';

  // אירובי — נפח שבועי: יעד מול ביצוע
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

  // כוח — שיבוץ לפי יום
  if (hasStrength) {
    const today = new Date(todayISO());
    const ws = new Date(weekStartISO(today));
    const auto = typeof autoStrengthDates === 'function' ? autoStrengthDates() : new Set();
    body += '<div class="plan-strength">';
    const daySlots = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws);
      d.setDate(ws.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const isFuture = d > today;
      const isToday = iso === todayISO();
      const planned = plan.strength.find(s => s.day === i);
      const prog = planned && programs.find(p => p.id === planned.programId);
      const done = typeof strengthDone === 'function' && strengthDone(iso, auto);
      const cls = [done ? 'done' : '', isToday ? 'today' : '', isFuture ? 'future' : ''].filter(Boolean).join(' ');
      daySlots.push(`<div class="plan-day ${cls}">
        <small>${DAY_NAMES[i][0]}</small>
        ${prog ? `<span class="plan-prog">${prog.name}</span>` : '<span class="plan-rest">—</span>'}
        ${done ? '<i class="plan-check">✓</i>' : ''}
      </div>`);
    }
    body += `<div class="plan-week">${daySlots.join('')}</div></div>`;
  }

  el.innerHTML = `<article class="card">
    <div class="card-head"><h2>${icon('calendar', 18)} תוכנית שבועית</h2>
      <button class="world-link" id="plan-edit">עריכה ‹</button></div>
    ${body}
  </article>`;
}

/* =========================================================================
 * מודאל הגדרת תוכנית
 * ========================================================================= */
function openPlanSetup() {
  const plan = loadPlan();
  const progs = typeof programs !== 'undefined' ? programs : [];

  let aeroFields = '';
  for (const sport of AERO_SPORTS) {
    aeroFields += `<div class="plan-field">
      <label>${sport.label} (ק״מ בשבוע)</label>
      <input type="number" name="aero_${sport.key}" value="${plan.aerobic[sport.key] || ''}"
        min="0" step="1" inputmode="decimal" placeholder="0">
    </div>`;
  }

  let strengthFields = '';
  if (progs.length) {
    for (let i = 0; i < 7; i++) {
      const planned = plan.strength.find(s => s.day === i);
      strengthFields += `<div class="plan-field plan-day-field">
        <label>${DAY_NAMES[i]}</label>
        <select name="str_${i}">
          <option value="">מנוחה</option>
          ${progs.map(p => `<option value="${p.id}" ${planned?.programId === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>`;
    }
  } else {
    strengthFields = '<p class="tr-empty">צור תוכנית אימוני כוח קודם, ואז תוכל לשבץ אותה לימים.</p>';
  }

  const modal = document.createElement('div');
  modal.id = 'plan-modal';
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-backdrop"></div>
    <div class="modal-sheet tall">
      <div class="modal-head"><h2>תוכנית שבועית</h2>
        <button class="close-btn" aria-label="סגירה">✕</button></div>
      <form id="plan-form">
        <h3>נפח אירובי שבועי</h3>
        ${aeroFields}
        <h3>אימוני כוח לפי יום</h3>
        ${strengthFields}
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
    const newPlan = { aerobic: {}, strength: [] };
    for (const sport of AERO_SPORTS) {
      const v = Number(f[`aero_${sport.key}`]?.value);
      if (v > 0) newPlan.aerobic[sport.key] = v;
    }
    for (let i = 0; i < 7; i++) {
      const pid = f[`str_${i}`]?.value;
      if (pid) newPlan.strength.push({ day: i, programId: pid });
    }
    savePlan(newPlan);
    close();
    renderPlanner();
    toast('התוכנית נשמרה');
  };
}
