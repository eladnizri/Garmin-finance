'use strict';
/* =========================================================================
 * training.js — מעבדת האימון: מה קורה לאורך זמן, לא באימון בודד.
 *
 *   1. פלאטו לפי תרגיל — לא לוח שנה של פריודיזציה אלא זיהוי שהתרגיל *שלך*
 *      תקוע, עם עצה שתלויה בסיבה (לא מסיים סטים → דילואד; מסיים ולא עולה →
 *      להוסיף משקל או חזרות).
 *   2. חלון ההתאוששות — כמה ימים לוקח *לך* לחזור לבסיס אחרי יום קשה.
 *   3. אפקט ההפרעה — האם נפח ריצה פוגע בכוח שלך או להפך.
 *
 * ל-2 ול-3 אין עדיין מספיק נתונים, ולכן במקום לשתוק בלי הסבר הם מציגים
 * מונה: כמה עוד נדרש כדי שהמדידה תהיה אמינה. שקיפות במקום כרטיס ריק.
 * ========================================================================= */

/* =========================================================================
 * 1. פלאטו לפי תרגיל
 * ========================================================================= */
const PLATEAU_MIN_SESSIONS = 5;
const PLATEAU_MIN_DAYS = 21;
const PLATEAU_UP = 2;      // אחוז עלייה שנחשב התקדמות
const PLATEAU_DOWN = -3;   // אחוז ירידה שנחשב נסיגה

/* מגמת ה-e1rm בתרגיל: 3 האימונים האחרונים מול 3 שלפניהם */
function exerciseTrend(name) {
  const h = (typeof exerciseHistory === 'function' ? exerciseHistory(name) : [])
    .filter(x => x.best > 0);
  if (h.length < PLATEAU_MIN_SESSIONS) return { name, state: 'thin', n: h.length };
  const span = daysBetween(h[0].date, h[h.length - 1].date);
  if (span < PLATEAU_MIN_DAYS) return { name, state: 'thin', n: h.length, span };

  const recent = h.slice(-3), prior = h.slice(-6, -3);
  if (prior.length < 2) return { name, state: 'thin', n: h.length, span };
  const now = meanOf(recent.map(x => x.best));
  const was = meanOf(prior.map(x => x.best));
  if (!was) return { name, state: 'thin', n: h.length, span };
  const pct = (now - was) / was * 100;

  // שיעור השלמת הסטים קובע *איזו* עצה מתאימה, לא אם יש פלאטו
  const completion = recent.filter(x => x.complete).length / recent.length;
  const state = pct >= PLATEAU_UP ? 'up' : pct <= PLATEAU_DOWN ? 'down' : 'flat';
  const topKg = Math.max(...h[h.length - 1].entry.sets.filter(s => s.done).map(s => s.kg), 0);
  return { name, state, pct, now, was, n: h.length, span, completion, topKg,
           since: h.length >= 4 ? daysBetween(h[h.length - 4].date, todayISO()) : span };
}

function plateauAdvice(t) {
  if (t.state === 'down') {
    return t.completion < 0.5
      ? `ירידה של ${fmt(Math.abs(t.pct), 1)}% ואתה לא מסיים את הסטים — כנראה עייפות מצטברת.
         שבוע קל במשקל נמוך ב-10% בדרך כלל מחזיר את זה.`
      : `ירידה של ${fmt(Math.abs(t.pct), 1)}% למרות שאתה מסיים את הסטים — שווה לבדוק שינה ותזונה
         לפני שמשנים את התוכנית.`;
  }
  // פלאטו: העצה תלויה בשאלה אם אתה בכלל מסיים את מה שתוכנן
  return t.completion >= 0.8
    ? `אתה מסיים את כל הסטים אבל המשקל לא זז ${Math.round(t.since)} ימים —
       זה הסימן להוסיף ${fmt(STEP_KG, 1)} ק״ג${t.topKg ? ` (${fmt(t.topKg, 1)} → ${fmt(t.topKg + STEP_KG, 1)})` : ''}.`
    : `${Math.round(t.since)} ימים בלי התקדמות, ורק ${Math.round(t.completion * 100)}% מהסטים הושלמו —
       המשקל כנראה גבוה מדי. רד ב-10% ובנה משם.`;
}

/* כל התרגילים שיש להם מספיק היסטוריה, ממוינים: נסיגה → פלאטו → התקדמות */
function exerciseTrends() {
  const names = typeof allExerciseNames === 'function' ? allExerciseNames() : [];
  const order = { down: 0, flat: 1, up: 2, thin: 3 };
  return names.map(exerciseTrend)
    .filter(t => t.state !== 'thin')
    .sort((a, b) => order[a.state] - order[b.state] || Math.abs(b.pct) - Math.abs(a.pct));
}

/* =========================================================================
 * 2. חלון ההתאוששות אחרי יום קשה
 * ========================================================================= */
const RECOVERY_MIN_HARD = 18;   // ימים קשים שנדרשים למדידה אמינה

/* "יום קשה" נמדד מולך: האחוזון ה-80 של דקות האינטנסיביות שלך עצמך */
function hardDayThreshold() {
  const v = (state.data || []).map(r => r.intensity_min).filter(isNum).sort((a, b) => a - b);
  if (v.length < 30) return null;
  return v[Math.floor(v.length * 0.8)];
}

function hardDays() {
  const thr = hardDayThreshold();
  if (!thr) return [];
  return (state.data || []).filter(r => !isTagged(r.date) && isNum(r.intensity_min) && r.intensity_min >= thr);
}

/* התגובה ב-1/2/3 הימים שאחרי, ביחידות סטיית תקן אישית.
 * כל יום נבדק מול הסף הקריטי שלו — בלי זה "ההתאוששות שלך יומיים" הוא רעש. */
function recoveryCurve() {
  const hard = hardDays();
  if (hard.length < RECOVERY_MIN_HARD) {
    return { ready: false, have: hard.length, need: RECOVERY_MIN_HARD, thr: hardDayThreshold() };
  }
  const idx = dayIndex();
  const out = { ready: true, have: hard.length, thr: hardDayThreshold(), lags: [] };
  for (const k of ['hrv', 'rhr']) {
    const all = (state.data || []).map(r => r[k]).filter(isNum);
    if (all.length < 30) continue;
    const base = meanOf(all), sd = sdOf(all);
    if (!sd) continue;
    for (const lag of [1, 2, 3]) {
      const vs = hard.map(r => idx.get(shiftISO(r.date, lag))?.[k]).filter(isNum);
      if (vs.length < MIN_N) continue;
      // מובהקות: הפרש הממוצעים מול שגיאת התקן שלו
      const z = (meanOf(vs) - base) / sd;
      const se = 1 / Math.sqrt(vs.length);
      out.lags.push({ key: k, lag, mean: meanOf(vs), base, z, n: vs.length, sig: Math.abs(z) > se * 1.96 });
    }
  }
  return out;
}

/* =========================================================================
 * 3. אפקט ההפרעה — ריצה מול כוח
 * ========================================================================= */
const INTERFERENCE_MIN_WEEKS = 10;

/* נפח ריצה ונפח כוח לכל שבוע, לאותם שבועות בדיוק */
function weeklyVolumes(maxWeeks = 16) {
  const vol = typeof strengthVolumeByDate === 'function' ? strengthVolumeByDate() : new Map();
  const out = [];
  for (let back = 1; back <= maxWeeks; back++) {
    const rows = weekRows(back);
    if (rows.length < 5) continue;
    const km = typeof weekRunKm === 'function' ? weekRunKm(rows) : 0;
    let kg = 0;
    for (const r of rows) kg += vol.get(r.date) || 0;
    out.push({ km, kg });
  }
  return out;
}

function interference() {
  const w = weeklyVolumes().filter(x => x.kg > 0 || x.km > 0);
  const usable = w.filter(x => x.kg > 0 && x.km > 0);
  if (usable.length < INTERFERENCE_MIN_WEEKS) {
    return { ready: false, have: usable.length, need: INTERFERENCE_MIN_WEEKS };
  }
  const s = relate(usable.map(x => [x.km, x.kg]));
  return { ready: true, have: usable.length, rel: s };
}

/* =========================================================================
 * תצוגה — כרטיס אחד בעמוד הכוח
 * ========================================================================= */
const TREND_TAG = { down: 'נסיגה', flat: 'תקוע', up: 'מתקדם' };

function renderLab() {
  const el = $('lab-card');
  if (!el) return;
  const trends = exerciseTrends();
  const stuck = trends.filter(t => t.state !== 'up');
  const moving = trends.filter(t => t.state === 'up');

  let body = '';
  if (!trends.length) {
    const n = (typeof sessions !== 'undefined' ? sessions : []).length;
    body = `<p class="tr-empty">${n
      ? `תועדו ${n} אימונים. אחרי ${PLATEAU_MIN_SESSIONS} אימונים לתרגיל (ולפחות שלושה שבועות)
         אפשר יהיה לזהות כאן פלאטו לכל תרגיל בנפרד.`
      : 'עוד לא תועדו אימוני כוח. כל אימון שתתעד ייכנס למעקב ההתקדמות לפי תרגיל.'}</p>`;
  } else {
    body = stuck.map(t => `<div class="lab-row ${t.state}">
      <div class="lab-top"><span class="lab-tag">${TREND_TAG[t.state]}</span>
        <span class="lab-name">${t.name}</span>
        <span class="lab-pct">${t.pct > 0 ? '+' : ''}${fmt(t.pct, 1)}%</span></div>
      <p class="lab-note">${plateauAdvice(t)}</p>
    </div>`).join('');
    if (moving.length) {
      body += `<p class="lab-ok">${icon('up', 14)} מתקדמים כרגע:
        ${moving.map(t => `<b>${t.name}</b> (+${fmt(t.pct, 1)}%)`).join(', ')}.</p>`;
    }
  }

  el.innerHTML = `<article class="card">
    <div class="card-head"><h2>${icon('chart', 18)} התקדמות לפי תרגיל</h2>
      ${trends.length ? `<span class="unit">${trends.length} תרגילים</span>` : ''}</div>
    ${body}${recoveryBlock()}${interferenceBlock()}
  </article>`;
}

/* שני הבלוקים האלה עדיין מחכים לנתונים — מונה במקום שתיקה */
function recoveryBlock() {
  const rc = recoveryCurve();
  if (!rc.ready) {
    return `<div class="lab-wait"><b>חלון ההתאוששות שלך</b>
      <span>נאספו ${rc.have} מתוך ${rc.need} ימי אימון קשים${rc.thr ? ` (מעל ${fmt(rc.thr)} דק׳ אינטנסיביות)` : ''}
      — אחרי זה אפשר יהיה למדוד כמה ימים לוקח לך לחזור לבסיס.</span></div>`;
  }
  const sig = rc.lags.filter(l => l.sig);
  if (!sig.length) {
    return `<div class="lab-wait"><b>חלון ההתאוששות שלך</b>
      <span>נמדדו ${rc.have} ימים קשים ולא נמצאה תגובה מובהקת ביום שאחרי —
      או שההתאוששות שלך מהירה, או שעוד אין מספיק מקרים כדי לזהות אותה.</span></div>`;
  }
  const worst = sig.reduce((a, b) => Math.abs(b.z) > Math.abs(a.z) ? b : a);
  const d = METRICS[worst.key];
  return `<div class="lab-rec"><b>חלון ההתאוששות שלך</b>
    <span>אחרי יום קשה, ${d.label} ${worst.z > 0 ? 'גבוה' : 'נמוך'} מהרגיל עוד
    <b>${worst.lag}</b> ${worst.lag === 1 ? 'יום' : 'ימים'}
    (${fmt(worst.mean, d.dec)} מול ${fmt(worst.base, d.dec)}, ${worst.n} מקרים).</span></div>`;
}

function interferenceBlock() {
  const it = interference();
  if (!it.ready) {
    return `<div class="lab-wait"><b>ריצה מול כוח</b>
      <span>נאספו ${it.have} מתוך ${it.need} שבועות שיש בהם גם ריצה וגם אימון כוח —
      אחרי זה אפשר יהיה לבדוק אם הם מפריעים זה לזה אצלך.</span></div>`;
  }
  if (!it.rel) {
    return `<div class="lab-wait"><b>ריצה מול כוח</b>
      <span>נבדקו ${it.have} שבועות ולא נמצא קשר מובהק — נפח הריצה שלך לא פוגע בנפח הכוח.</span></div>`;
  }
  const neg = it.rel.r < 0;
  return `<div class="lab-rec"><b>ריצה מול כוח</b>
    <span>בשבועות עם יותר מ-<b>${fmt(it.rel.cut, 1)}</b> ק״מ ריצה, נפח הכוח שלך היה
    ${neg ? 'נמוך' : 'גבוה'} יותר — <b>${fmt(it.rel.hi, 0)}</b> מול <b>${fmt(it.rel.lo, 0)}</b> ק״ג
    (${it.rel.n} שבועות).${neg ? ' שווה להפריד בין הימים הכבדים לריצות הארוכות.' : ''}</span></div>`;
}
