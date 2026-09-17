'use strict';
/* =========================================================================
 * goals.js — המטרות מתעדכנות לפי מה שקורה בפועל.
 *
 *   1. קצב אישי — כל כמה ימים אתה מתאמן *באמת*, במקום יעד שנקבע פעם אחת.
 *   2. יעד אדפטיבי — יעד שעומדים בו חודשיים מציע לעלות, ויעד שאף פעם לא
 *      מושג מציע לרדת. יעד שלא מושג אינו יעד אלא דגל אדום קבוע.
 *   3. שלבי מירוץ — ככל שהמירוץ מתקרב, העדיפות זזה מנפח לחדות ואז למנוחה,
 *      בלי שצריך לעדכן שום דבר ידנית.
 *
 * נטען אחרי model.js ומשתמש בעזרים של insights.js (medianOf, shiftISO…).
 * ========================================================================= */

const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 864e5);

/* =========================================================================
 * 1. קצב אישי
 * ========================================================================= */
/* כל ימי האימון משלושת המקורות: גרמין, אימוני כוח שתועדו, וסימון ידני */
function trainingDays() {
  const s = new Set();
  for (const r of (state.data || [])) if ((r.workouts || []).length) s.add(r.date);
  for (const x of (typeof sessions !== 'undefined' ? sessions : [])) s.add(x.date);
  const checks = typeof strengthChecks !== 'undefined' ? strengthChecks : {};
  for (const d of Object.keys(checks)) if (checks[d]) s.add(d);
  return s;
}

/* הקצב שבפועל — לא כמה התכוונת, אלא כל כמה ימים אתה באמת מתאמן */
function routineStats(weeks = 8) {
  const from = shiftISO(todayISO(), -weeks * 7);
  const win = [...trainingDays()].filter(d => d >= from && d <= todayISO()).sort();
  if (win.length < 5) return null;
  const gaps = [];
  for (let i = 1; i < win.length; i++) gaps.push(daysBetween(win[i - 1], win[i]));
  return {
    n: win.length, weeks,
    rate: win.length / weeks,
    gap: gaps.length ? medianOf(gaps) : null,
    since: daysBetween(win[win.length - 1], todayISO()),
    last: win[win.length - 1],
  };
}

/* דפוס ימים קבוע — רק אם באמת קיים. אצל מי שמתאמן בפיזור אחיד זה יחזיר
 * null, וזו התשובה הנכונה: עדיף לשתוק מאשר להמציא "שגרה" שאין. */
function dowPattern() {
  const days = [...trainingDays()];
  if (days.length < 14) return null;
  const cnt = Array(7).fill(0);
  for (const d of days) cnt[new Date(`${d}T12:00:00`).getDay()]++;
  const exp = days.length / 7;
  const hot = cnt.map((c, i) => ({ i, c })).filter(x => x.c >= exp * 1.7 && x.c >= 3);
  if (!hot.length) return null;
  const covered = hot.reduce((s, x) => s + x.c, 0) / days.length;
  return covered >= 0.6 ? { days: hot.map(x => x.i).sort((a, b) => a - b), covered, n: days.length } : null;
}

/* משפט אחד על הקצב, לכרטיס הכוח */
function routineLine() {
  const rs = routineStats();
  if (!rs || rs.gap === null) return '';
  const pat = dowPattern();
  const bits = [`בשמונה השבועות האחרונים התאמנת <b>${fmt(rs.rate, 1)}</b> פעמים בשבוע בממוצע,
    כל <b>${fmt(rs.gap, 1)}</b> ימים`];
  if (pat) bits.push(`בעיקר בימי ${pat.days.map(d => DAY_NAMES[d]).join(' ו')}`);
  const late = rs.gap && rs.since > rs.gap * 2 && rs.since >= 3;
  return `<p class="goal-routine${late ? ' late' : ''}">${bits.join(', ')}.
    ${late ? `עברו <b>${rs.since}</b> ימים מאז האחרון — יותר מכפול מהקצב שלך.` : ''}</p>`;
}

/* =========================================================================
 * 2. יעד אדפטיבי
 * ========================================================================= */
const GOAL_ADAPT_KEY = 'goal_adapt_v1';
let goalAdapt = {};
function loadGoalAdapt() { goalAdapt = jsonGet(GOAL_ADAPT_KEY, {}) || {}; }
function saveGoalAdapt() { jsonSet(GOAL_ADAPT_KEY, goalAdapt); }

/* ספירת אימוני כוח בשבועות מלאים אחורה — השבוע הנוכחי לא נספר, הוא עוד רץ */
function strengthWeekCounts(n = 8) {
  const auto = autoStrengthDates();
  const out = [];
  for (let back = 1; back <= n; back++) {
    const rows = weekRows(back);
    if (rows.length < 5) continue;          // שבוע חלקי בקצה הנתונים
    out.push(strengthCountInWeek(rows, auto));
  }
  return out;
}

function goalSuggestion() {
  const goal = goalStrength();
  const counts = strengthWeekCounts(8);
  if (counts.length < 6) return null;
  const hit = counts.filter(c => c >= goal).length;
  const med = medianOf(counts);

  let s = null;
  if (hit >= counts.length - 1 && goal < 6) {
    s = { dir: 'up', from: goal, to: goal + 1, hit, of: counts.length, med };
  } else if (hit <= 1 && goal > 1 && med >= 1) {
    // med<1 פירושו שלא תועד כמעט כלום. זו בעיה של מעקב, לא של שאפתנות —
    // ולהציע במצב כזה להוריד את היעד זה לתרגם חוסר תיעוד לוויתור.
    const to = clamp(Math.round(med), 1, goal - 1);
    s = { dir: 'down', from: goal, to, hit, of: counts.length, med };
  }
  if (!s) return null;

  // הצעה שנדחתה לא חוזרת חודש — יעד שמתעקשים עליו הוא נדנוד, לא עזרה
  const seen = goalAdapt[`${s.dir}:${s.to}`];
  if (seen && daysBetween(seen, todayISO()) < 28) return null;
  return s;
}

function goalSuggestionCard() {
  const s = goalSuggestion();
  if (!s) return '';
  const body = s.dir === 'up'
    ? `עמדת ביעד של ${s.from} אימונים ב-<b>${s.hit}</b> מתוך ${s.of} השבועות האחרונים.
       אולי הגיע הזמן להעלות ל-<b>${s.to}</b>?`
    : `עמדת ביעד של ${s.from} אימונים רק ב-<b>${s.hit}</b> מתוך ${s.of} השבועות האחרונים
       (חציון: ${fmt(s.med, 0)}). יעד שלא מושג הוא לא יעד — להוריד ל-<b>${s.to}</b> ולבנות משם?`;
  return `<div class="goal-sug ${s.dir}">
    <div class="goal-sug-body">${icon(s.dir === 'up' ? 'up' : 'info', 15)} ${body}</div>
    <div class="goal-sug-actions">
      <button class="btn-ghost" data-goal="skip">לא עכשיו</button>
      <button class="btn-primary" data-goal="${s.to}">עדכן ל-${s.to}</button>
    </div></div>`;
}

/* קיבול/דחייה — נקרא מהאזנה מואצלת על כרטיס הכוח */
function applyGoalSuggestion(val) {
  const s = goalSuggestion();
  if (!s) return;
  if (val === 'skip') {
    goalAdapt[`${s.dir}:${s.to}`] = todayISO();
    saveGoalAdapt();
    toast('בסדר — נשאל שוב בעוד חודש');
  } else {
    const to = Number(val);
    if (!to) return;
    saveProfileObj({ ...profile, strengthGoal: to });
    toast(`היעד עודכן ל-${to} אימוני כוח בשבוע`);
  }
  renderAll();
}

/* =========================================================================
 * 3. שלבי מירוץ
 * ========================================================================= */
/* vol = מקדם לנפח הריצה השבועי בשלב הזה. הטייפר מוריד נפח ושומר חדות —
 * לכן בשבוע המירוץ עדיין מותר לרוץ, פשוט הרבה פחות. */
const RACE_PHASES = [
  { key: 'recovery', min: -14, max: -1,   vol: 0.5, label: 'התאוששות',    note: 'נפח נמוך ובלי עבודת איכות, עד שהגוף חוזר.' },
  { key: 'raceday',  min: 0,   max: 0,    vol: 0,   label: 'יום המירוץ',  note: 'היום רצים אותו.' },
  { key: 'raceweek', min: 1,   max: 3,    vol: 0.4, label: 'שבוע המירוץ', note: 'מנוחה קודמת לכל — בלי כוח כבד ובלי ריצות ארוכות.' },
  { key: 'taper',    min: 4,   max: 10,   vol: 0.6, label: 'טייפר',       note: 'מורידים נפח ושומרים חדות: ריצות קצרות, חלקן בקצב המירוץ.' },
  { key: 'peak',     min: 11,  max: 28,   vol: 1,   label: 'שיא',         note: 'החלון לעבודת האיכות — טמפו ואינטרוולים בקצב היעד.' },
  { key: 'build',    min: 29,  max: 70,   vol: 1,   label: 'בנייה',       note: 'בונים נפח בהדרגה, איכות אחת בשבוע.' },
  { key: 'base',     min: 71,  max: 9999, vol: 1,   label: 'בסיס',        note: 'עוד רחוק — הדגש על עקביות ונפח נוח.' },
];

function raceDaysLeft() {
  if (typeof race === 'undefined' || !race || !race.date) return null;
  return Math.ceil((new Date(`${race.date}T00:00:00`) - new Date(`${todayISO()}T00:00:00`)) / 864e5);
}

function racePhase() {
  const d = raceDaysLeft();
  if (d === null) return null;
  const p = RACE_PHASES.find(x => d >= x.min && d <= x.max);
  return p ? { ...p, daysLeft: d } : null;
}

/* יעד הריצה השבועי אחרי התאמה לשלב — שאר האפליקציה קוראת את זה
 * במקום goalRunKm() כשהיא רוצה את היעד *של השבוע הזה* */
function adjustedRunGoal() {
  const base = (typeof goalRunKm === 'function') ? goalRunKm() : null;
  if (!base) return null;
  const p = racePhase();
  if (!p || p.vol === 1) return base;
  return Math.round(base * p.vol * 10) / 10;
}

function racePhaseNote() {
  const p = racePhase();
  if (!p || p.key === 'base') return '';
  const base = (typeof goalRunKm === 'function') ? goalRunKm() : null;
  const adj = adjustedRunGoal();
  const volLine = base && adj !== null && adj !== base
    ? ` יעד הנפח השבוע מותאם ל-<b>${fmt(adj, 1)}</b> ק״מ במקום ${fmt(base, 1)}.` : '';
  return `<div class="race-phase ph-${p.key}">
    <span class="rp-tag">${p.label}</span>
    <span class="rp-note">${p.note}${volLine}</span></div>`;
}
