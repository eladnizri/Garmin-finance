'use strict';
/* =========================================================================
 * insights.js — מנוע התובנות האישיות.
 *
 * שלוש שכבות מעל הנתונים הגולמיים:
 *   1. מנוע קורלציות — מה *הנתונים שלך* מלמדים, עם בדיקת מובהקות.
 *   2. כרטיס "היום" — המלצה אחת שמצליבה מוכנות עם המטרות שהוגדרו בפועל.
 *   3. פוקוס שבועי — הפער היחיד שהכי שווה לסגור בשבוע הקרוב.
 *
 * העיקרון שמנחה את הכול: עדיף לשתוק מאשר להציג רעש כתובנה. כל מסקנה כאן
 * נגזרת מההיסטוריה של המשתמש, עוברת סף מובהקות, והטקסט הוא תבנית שממולאת
 * במספרים אמיתיים — לא משפט קבוע שנבחר מתוך מאגר.
 * ========================================================================= */

/* =========================================================================
 * סטטיסטיקה
 * ========================================================================= */

/* ערכי r קריטיים ל-p<0.05 דו-צדדי לפי גודל המדגם. מתחת ל-MIN_N לא בודקים
 * כלל — במדגם קטן כל צירוף מקרים נראה כמו קשר. */
const MIN_N = 10;
const CRIT_R = [[10, .632], [12, .576], [15, .514], [20, .444], [25, .396],
                [30, .361], [40, .312], [50, .279], [60, .254], [80, .220], [100, .197]];
function critR(n) {
  if (n <= CRIT_R[0][0]) return CRIT_R[0][1];
  const last = CRIT_R[CRIT_R.length - 1];
  if (n >= last[0]) return last[1];
  for (let i = 1; i < CRIT_R.length; i++) {
    const [n1, r1] = CRIT_R[i - 1], [n2, r2] = CRIT_R[i];
    if (n <= n2) return r1 + (r2 - r1) * (n - n1) / (n2 - n1);
  }
  return last[1];
}

const isNum = v => v != null && !Number.isNaN(v) && Number.isFinite(v);
const meanOf = a => a.reduce((s, x) => s + x, 0) / a.length;
function sdOf(a) {
  if (a.length < 2) return 0;
  const m = meanOf(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}
function medianOf(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function corrOf(pairs) {
  const n = pairs.length;
  if (n < MIN_N) return { r: null, n };
  const mx = meanOf(pairs.map(p => p[0])), my = meanOf(pairs.map(p => p[1]));
  let num = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) { num += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; }
  if (!dx || !dy) return { r: null, n };
  return { r: num / Math.sqrt(dx * dy), n };
}
/* חלוקה לשתי קבוצות סביב חציון ה-x. מקדם מתאם אומר "יש קשר"; ההפרש בין
 * שתי הקבוצות אומר *כמה* — וזה מה שאפשר לקרוא כמשפט. */
function splitAt(pairs) {
  const cut = medianOf(pairs.map(p => p[0]));
  const lo = pairs.filter(p => p[0] < cut).map(p => p[1]);
  const hi = pairs.filter(p => p[0] >= cut).map(p => p[1]);
  if (lo.length < 3 || hi.length < 3) return null;
  return { cut, lo: meanOf(lo), hi: meanOf(hi), nLo: lo.length, nHi: hi.length };
}
/* הבדיקה המלאה על זוג סדרות: מובהקות + גודל אפקט ביחידות סטיית תקן */
function relate(pairs) {
  const { r, n } = corrOf(pairs);
  if (r === null || Math.abs(r) < critR(n)) return null;
  const sp = splitAt(pairs);
  if (!sp) return null;
  const sdY = sdOf(pairs.map(p => p[1]));
  if (!sdY) return null;
  return { r, n, ...sp, sdY, effect: Math.abs(sp.hi - sp.lo) / sdY };
}

/* =========================================================================
 * תיוג חריגות — יום שיש לו הסבר ידוע לא מלמד כלום על הדפוס
 * ========================================================================= */
const ANOM_TAG_KEY = 'anomaly_tags_v1';
const ANOM_REASONS = {
  travel: 'טיסה או נסיעה', alcohol: 'אלכוהול', sick: 'מחלה', stress: 'לחץ',
  hard: 'אימון קשה', late: 'לילה קצר מתוכנן', other: 'סיבה אחרת',
};
let anomTags = {};
function loadAnomTags() { try { anomTags = jsonGet(ANOM_TAG_KEY, {}) || {}; } catch { anomTags = {}; } }
function saveAnomTags() { jsonSet(ANOM_TAG_KEY, anomTags); }
const isTagged = iso => !!anomTags[iso];
const tagLabel = iso => ANOM_REASONS[anomTags[iso]] || null;

/* =========================================================================
 * בניית זוגות מהנתונים
 * ========================================================================= */
const shiftISO = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
function dayIndex() {
  const m = new Map();
  for (const r of (state.data || [])) m.set(r.date, r);
  return m;
}
/* זוגות (x ביום D, y ביום D+lag). הזיווג לפי תאריך אמיתי ולא לפי מיקום
 * במערך, כך שחור בנתונים לא יוצר זוג מזויף. ימים מתויגים יוצאים משני הצדדים. */
function pairsOf(getX, getY, lag = 0) {
  const idx = dayIndex(), out = [];
  for (const r of (state.data || [])) {
    if (isTagged(r.date)) continue;
    const to = lag ? idx.get(shiftISO(r.date, lag)) : r;
    if (!to || isTagged(to.date)) continue;
    const x = getX(r), y = getY(to);
    if (isNum(x) && isNum(y)) out.push([x, y]);
  }
  return out;
}
const field = k => r => r[k];

/* תאריכים שבהם היה אימון כלשהו — גרמין או כוח שתועד ידנית */
function workoutDates() {
  const set = new Set();
  for (const r of (state.data || [])) if ((r.workouts || []).length) set.add(r.date);
  for (const s of (typeof sessions !== 'undefined' ? sessions : [])) set.add(s.date);
  return set;
}
/* נפח אימון כוח ליום: סך המשקל×חזרות בסטים שבוצעו */
function strengthVolumeByDate() {
  const m = new Map();
  for (const s of (typeof sessions !== 'undefined' ? sessions : [])) {
    let vol = 0;
    for (const e of (s.entries || [])) for (const st of (e.sets || []))
      if (st.done && isNum(st.kg) && isNum(st.reps)) vol += st.kg * st.reps;
    if (vol > 0) m.set(s.date, (m.get(s.date) || 0) + vol);
  }
  return m;
}
/* קצב הריצה ליום (הריצה הארוכה ביותר באותו יום, כדי לא לערבב ריצות) */
function runPaceByDate() {
  const m = new Map();
  const runs = (typeof allRuns === 'function' ? allRuns() : []).filter(r => r.real && isNum(r.pace));
  for (const r of runs) {
    const cur = m.get(r.date);
    if (!cur || (r.km || 0) > cur.km) m.set(r.date, { pace: r.pace, km: r.km || 0 });
  }
  return m;
}

/* =========================================================================
 * מסקנות — כל בדיקה מחזירה ממצא או null
 * ========================================================================= */
function mk(id, group, text, s) {
  return { id, group, text, r: s.r, n: s.n, effect: s.effect };
}

/* --- שינה מול הביצועים למחרת. אצל גרמין שורת יום D כוללת את השינה של
 *     הלילה שהסתיים באותו בוקר, ולכן ההצלבה היא באותה שורה. --- */
function probeSleepVsMetric(yKey, id, phrase) {
  const s = relate(pairsOf(field('sleep_hours'), field(yKey)));
  if (!s) return null;
  const d = METRICS[yKey] || { dec: 0, label: yKey };
  return mk(id, 'sleep-perf',
    `בלילות מתחת ל־<b>${fmt(s.cut, 1)} שעות</b>, ${phrase} היה <b>${fmt(s.lo, d.dec)}</b> ` +
    `— לעומת <b>${fmt(s.hi, d.dec)}</b> בלילות הארוכים יותר.`, s);
}

/* --- מה שקורה ביום מסוים מול השינה של הלילה שאחריו (lag של יום) --- */
function probeDayVsNight(xKey, id, phrase) {
  const s = relate(pairsOf(field(xKey), field('sleep_score'), 1));
  if (!s) return null;
  const dx = METRICS[xKey] || { dec: 0 };
  return mk(id, 'sleep-quality',
    `אחרי ימים עם ${phrase} מעל <b>${fmt(s.cut, dx.dec)}</b>, ציון השינה באותו לילה היה ` +
    `<b>${fmt(s.hi, 0)}</b> — לעומת <b>${fmt(s.lo, 0)}</b> אחרי ימים שקטים יותר.`, s);
}

/* --- חלק השינה העמוקה מול המוכנות של אותו יום --- */
function probeDeepShare() {
  const deepShare = r => {
    const tot = (r.deep_min || 0) + (r.light_min || 0) + (r.rem_min || 0);
    return tot > 0 ? (r.deep_min || 0) / tot * 100 : null;
  };
  const s = relate(pairsOf(deepShare, field('readiness_score')));
  if (!s) return null;
  return mk('deep-readiness', 'sleep-quality',
    `כששינה עמוקה עברה <b>${fmt(s.cut, 0)}%</b> מהלילה, ציון המוכנות היה ` +
    `<b>${fmt(s.hi, 0)}</b> — לעומת <b>${fmt(s.lo, 0)}</b> בלילות עם פחות עומק.`, s);
}

/* --- עקביות: סטיית התקן של שעות השינה בשבוע שקדם, מול ציון השינה --- */
function probeRegularity() {
  const idx = dayIndex();
  const pairs = [];
  for (const r of (state.data || [])) {
    if (isTagged(r.date) || !isNum(r.sleep_score)) continue;
    const prev = [];
    for (let k = 1; k <= 7; k++) {
      const p = idx.get(shiftISO(r.date, -k));
      if (p && !isTagged(p.date) && isNum(p.sleep_hours)) prev.push(p.sleep_hours);
    }
    if (prev.length >= 5) pairs.push([sdOf(prev), r.sleep_score]);
  }
  const s = relate(pairs);
  if (!s) return null;
  // lo = השבועות היציבים (סטיית תקן נמוכה), hi = המקופצים. הכיוון אינו מובטח מראש.
  const gap = fmt(Math.abs(s.lo - s.hi), 0);
  return mk('regularity', 'sleep-quality', s.lo > s.hi
    ? `בתקופות שבהן שעות השינה שלך היו יציבות, ציון השינה היה <b>${fmt(s.lo, 0)}</b> — ` +
      `לעומת <b>${fmt(s.hi, 0)}</b> כשהן קפצו מלילה ללילה. העקביות שווה לך <b>${gap} נקודות</b>.`
    : `דווקא בתקופות שבהן שעות השינה שלך קפצו מלילה ללילה ציון השינה היה גבוה יותר — ` +
      `<b>${fmt(s.hi, 0)}</b> לעומת <b>${fmt(s.lo, 0)}</b>. קשר לא צפוי, שווה מעקב.`, s);
}

/* --- כמה ימי מנוחה קדמו ליום, מול ה-HRV שלו --- */
function probeRestDays() {
  const wd = workoutDates();
  const restBefore = r => {
    let n = 0;
    for (let k = 1; k <= 3; k++) if (!wd.has(shiftISO(r.date, -k))) n++;
    return n;
  };
  const s = relate(pairsOf(restBefore, field('hrv')));
  if (!s) return null;
  return mk('rest-hrv', 'training',
    `אחרי <b>${fmt(s.cut, 0)} ימי מנוחה ומעלה</b> בשלושת הימים שקדמו, ה-HRV שלך היה ` +
    `<b>${fmt(s.hi, 0)}</b> — לעומת <b>${fmt(s.lo, 0)}</b> אחרי רצף אימונים.`, s);
}

/* --- שינה מול נפח אימון הכוח באותו יום --- */
function probeSleepVsStrength() {
  const vol = strengthVolumeByDate();
  if (vol.size < MIN_N) return null;
  const pairs = [];
  for (const r of (state.data || [])) {
    if (isTagged(r.date) || !isNum(r.sleep_hours)) continue;
    const v = vol.get(r.date);
    if (isNum(v)) pairs.push([r.sleep_hours, v]);
  }
  const s = relate(pairs);
  if (!s) return null;
  // האחוז נמדד ביחס ללילות הקצרים, והכיוון נקרא מהנתונים ולא מונח מראש
  const pct = s.lo ? Math.abs(s.hi - s.lo) / s.lo * 100 : 0;
  return mk('sleep-strength', 'training',
    `אחרי לילות של <b>${fmt(s.cut, 1)} שעות ומעלה</b>, נפח אימון הכוח שלך היה ` +
    `${s.hi > s.lo ? 'גבוה' : 'נמוך'} ב־<b>${fmt(pct, 0)}%</b> בממוצע מאשר אחרי לילות קצרים יותר.`, s);
}

/* --- שינה מול קצב הריצה באותו יום (קצב נמוך = מהיר יותר) --- */
function probeSleepVsRun() {
  const byDate = runPaceByDate();
  if (byDate.size < MIN_N) return null;
  const pairs = [];
  for (const r of (state.data || [])) {
    if (isTagged(r.date) || !isNum(r.sleep_hours)) continue;
    const run = byDate.get(r.date);
    if (run) pairs.push([r.sleep_hours, run.pace]);
  }
  const s = relate(pairs);
  if (!s) return null;
  return mk('sleep-run', 'training',
    `בימים שרצת אחרי <b>${fmt(s.cut, 1)} שעות שינה ומעלה</b>, הקצב הממוצע היה ` +
    `<b>${paceTxt(s.hi)}</b> — לעומת <b>${paceTxt(s.lo)}</b> אחרי לילות קצרים.`, s);
}

/* --- יום בשבוע חריג: לא קשר בין מדדים אלא דפוס בלוח השנה --- */
const WEEKDAY_KEYS = ['sleep_hours', 'sleep_score', 'steps', 'rhr'];
function probeWeekday() {
  let best = null;
  for (const key of WEEKDAY_KEYS) {
    const byDay = Array.from({ length: 7 }, () => []);
    for (const r of (state.data || [])) {
      if (isTagged(r.date) || !isNum(r[key])) continue;
      byDay[new Date(`${r.date}T12:00:00`).getDay()].push(r[key]);
    }
    const all = byDay.flat();
    if (all.length < 21) continue;
    const sd = sdOf(all);
    if (!sd) continue;
    for (let d = 0; d < 7; d++) {
      if (byDay[d].length < 4) continue;
      const others = byDay.filter((_, i) => i !== d).flat();
      if (others.length < 10) continue;
      const delta = meanOf(byDay[d]) - meanOf(others);
      const eff = Math.abs(delta) / sd;
      if (eff < 0.8) continue;
      if (!best || eff > best.effect) {
        const def = METRICS[key];
        const worse = def.goodUp ? delta < 0 : delta > 0;
        best = {
          id: `weekday-${key}-${d}`, group: 'pattern', r: null, n: byDay[d].length, effect: eff,
          // ניסוח בשמות עצם ולא בתארים — כדי שההתאמה במין ובמספר תעבוד לכל מדד
          text: `בימי <b>${DAY_NAMES[d]}</b> יש אצלך ${delta > 0 ? 'עלייה' : 'ירידה'} של ` +
            `<b>${fmt(Math.abs(delta), def.dec)}${def.unit && !def.unit.startsWith('/') ? ' ' + def.unit : ''}</b> ` +
            `ב${def.label}, לעומת שאר ימות השבוע${worse ? ' — היום שהכי שווה לטפל בו' : ''}.`,
        };
      }
    }
  }
  return best;
}

/* --- מגמה: לאן מדד זז בשבועיים האחרונים, ובכמה --- */
const TREND_KEYS = ['rhr', 'hrv', 'sleep_hours', 'sleep_score', 'stress_avg'];
function probeTrend() {
  let best = null;
  for (const key of TREND_KEYS) {
    const rows = (state.data || []).slice(-14).filter(r => !isTagged(r.date) && isNum(r[key]));
    if (rows.length < MIN_N) continue;
    const pairs = rows.map((r, i) => [i, r[key]]);
    const { r, n } = corrOf(pairs);
    if (r === null || Math.abs(r) < critR(n)) continue;
    // ערכי ההתחלה והסוף על קו המגמה עצמו, לא הנקודות הגולמיות
    const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
    const mx = meanOf(xs), my = meanOf(ys);
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) /
                  xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const from = my + slope * (xs[0] - mx), to = my + slope * (xs[xs.length - 1] - mx);
    const sd = sdOf(ys);
    const eff = sd ? Math.abs(to - from) / sd : 0;
    if (eff < 0.8) continue;
    const def = METRICS[key];
    const good = def.goodUp ? to > from : to < from;
    if (!best || eff > best.effect) {
      best = {
        id: `trend-${key}`, group: 'pattern', r, n, effect: eff,
        text: `מגמת ${to > from ? 'עלייה' : 'ירידה'} ב${def.label} בשבועיים האחרונים — מ־` +
          `<b>${fmt(from, def.dec)}</b> ל־<b>${fmt(to, def.dec)}</b>${good ? ' — מגמה טובה' : ' — שווה תשומת לב'}.`,
      };
    }
  }
  return best;
}

/* =========================================================================
 * המנוע: מריץ הכול, מסנן, ומגוון בין נושאים
 * ========================================================================= */
/* רצף ימים באותו צד של הבסיס האישי — לא מגמה (עלייה/ירידה), אלא "תקוע" */
function probeStreak() {
  let best = null;
  for (const key of TREND_KEYS) {
    const b = typeof baselineOf === 'function' ? baselineOf(key) : null;
    if (!b || !b.sd) continue;
    const series = (state.data || []).slice(-14)
      .filter(r => !isTagged(r.date) && isNum(r[key])).map(r => r[key]);
    if (series.length < 3) continue;

    let run = 0, side = 0;
    for (let i = series.length - 1; i >= 0; i--) {
      const dev = (series[i] - b.mean) / b.sd;
      const s = dev > 0.5 ? 1 : dev < -0.5 ? -1 : 0;
      if (s === 0 || (side && s !== side)) break;
      side = s; run++;
    }
    if (run < 3) continue;

    const def = METRICS[key];
    const good = def.goodUp ? side > 0 : side < 0;
    const eff = run / 3; // רצף ארוך יותר = ממצא חזק יותר
    if (!best || eff > best.effect) {
      best = {
        id: `streak-${key}`, group: 'pattern', r: null, n: run, effect: eff,
        text: `${def.label} ${side < 0 ? 'מתחת ל' : 'מעל ה'}בסיס האישי שלך ` +
          `<b>${run} ימים ברצף</b>${good ? ' — מגמה חיובית' : ' — שווה תשומת לב'}.`,
      };
    }
  }
  return best;
}

const PROBES = [
  () => probeSleepVsMetric('rhr', 'sleep-rhr', 'דופק המנוחה'),
  () => probeSleepVsMetric('hrv', 'sleep-hrv', 'ה-HRV'),
  () => probeSleepVsMetric('readiness_score', 'sleep-readiness', 'ציון המוכנות'),
  () => probeDayVsNight('stress_avg', 'stress-sleep', 'מתח'),
  () => probeDayVsNight('intensity_min', 'load-sleep', 'דקות פעילות אינטנסיבית'),
  () => probeDayVsNight('steps', 'steps-sleep', 'צעדים'),
  probeDeepShare, probeRegularity, probeRestDays,
  probeSleepVsStrength, probeSleepVsRun, probeWeekday, probeTrend, probeStreak,
];

function allFindings() {
  const out = [];
  for (const p of PROBES) {
    try { const f = p(); if (f) out.push(f); } catch (_) { /* בדיקה אחת שנפלה לא מפילה את השאר */ }
  }
  out.sort((a, b) => b.effect - a.effect || a.id.localeCompare(b.id));
  // גיוון: קודם החזק מכל נושא, ורק אחר כך השאר לפי עוצמה
  const picked = [], seen = new Set();
  for (const f of out) if (!seen.has(f.group)) { picked.push(f); seen.add(f.group); }
  for (const f of out) if (!picked.includes(f)) picked.push(f);
  return picked;
}

const INSIGHTS_SHOWN = 3;
function renderInsights() {
  const el = $('insights-card');
  if (!el) return;
  const found = allFindings();
  if (!found.length) {
    const days = (state.data || []).length;
    el.innerHTML = `<article class="card"><div class="card-head"><h2>${icon('bulb', 18)} מה הנתונים שלך מלמדים</h2></div>
      <p class="tr-empty">${days < 20
        ? `נאספו ${days} ימי מדידה. כשיצטברו עוד, יופיעו כאן קשרים שנמצאו בנתונים שלך עצמם.`
        : 'לא נמצא כרגע אף קשר מובהק מספיק כדי להציג. זה תקין — עדיף לשתוק מאשר להמציא דפוס.'}</p></article>`;
    return;
  }
  const items = found.slice(0, INSIGHTS_SHOWN).map(f => `
    <div class="ins-row">
      <span class="ins-dot"></span>
      <div><p class="ins-txt">${f.text}</p>
        <span class="ins-meta">${f.n} ימים${f.r !== null ? ` · מתאם ${fmt(Math.abs(f.r), 2)}` : ''}</span></div>
    </div>`).join('');
  el.innerHTML = `<article class="card">
    <div class="card-head"><h2>${icon('bulb', 18)} מה הנתונים שלך מלמדים</h2>
      <span class="unit">${found.length} ממצאים</span></div>
    ${items}
    <p class="ins-note">מוצג רק מה שעבר בדיקת מובהקות סטטיסטית על ההיסטוריה שלך.</p></article>`;
}

/* =========================================================================
 * כרטיס "היום" — המלצה אחת, מוצלבת מול המטרות שהוגדרו בפועל
 * ========================================================================= */
function daysSinceLastRun() {
  const runs = (typeof allRuns === 'function' ? allRuns() : []).filter(r => r.real);
  if (!runs.length) return null;
  const last = runs[runs.length - 1].date;
  return Math.round((new Date(`${todayISO()}T12:00:00`) - new Date(`${last}T12:00:00`)) / 864e5);
}
function daysSinceQualityRun() {
  const runs = (typeof allRuns === 'function' ? allRuns() : [])
    .filter(r => r.real && (r.kind === 'tempo' || r.kind === 'intervals'));
  if (!runs.length) return null;
  const last = runs[runs.length - 1].date;
  return Math.round((new Date(`${todayISO()}T12:00:00`) - new Date(`${last}T12:00:00`)) / 864e5);
}
/* קבוצות שריר שלא קיבלו עבודה ישירה בחלון הכיסוי */
function missingMuscles() {
  if (typeof muscleCoverage !== 'function') return [];
  const cov = muscleCoverage();
  return MUSCLE_KEYS.filter(k => !cov[k].primary && !cov[k].secondary);
}

function todayPlan() {
  if (!state.data || !state.data.length) return null;
  const readiness = latest('readiness_score', 2) ?? heuristicReadiness();
  const alerts = anomalies().filter(a => a.level === 'alert');
  const watches = anomalies().filter(a => a.level === 'watch');

  const auto = autoStrengthDates();
  const cur = weekRows(0);
  const strDone = strengthCountInWeek(cur, auto), strGoal = goalStrength();
  const strLeft = Math.max(0, strGoal - strDone);
  const missing = missingMuscles();
  // כמה ימים נשארו בשבוע כולל היום
  const dow = new Date(`${todayISO()}T12:00:00`).getDay();
  const daysLeftInWeek = 7 - dow;

  const weekKm = (typeof weekRunKm === 'function') ? weekRunKm(cur) : 0;
  const kmGoal = (typeof goalRunKm === 'function') ? goalRunKm() : null;
  const sinceRun = daysSinceLastRun(), sinceQuality = daysSinceQualityRun();
  const raceDays = (typeof race !== 'undefined' && race && race.date)
    ? Math.ceil((new Date(`${race.date}T00:00:00`) - new Date(`${todayISO()}T00:00:00`)) / 864e5) : null;

  const why = [];
  const push = t => { if (t) why.push(t); };
  const muscleTxt = missing.length
    ? missing.slice(0, 2).map(k => MUSCLES[k]).join(' ו') : null;

  /* סולם ההחלטה — מהסיבה שהכי גוברת על השאר ומטה */
  let key, title, detail, tone;

  if (readiness !== null && readiness < 50) {
    key = 'rest'; tone = 'rest'; title = 'יום מנוחה';
    detail = 'הגוף עוד לא חזר — אימון היום יעלה יותר ממה שייתן.';
    push(`ציון מוכנות ${Math.round(readiness)}`);
  } else if (alerts.length) {
    key = 'easy'; tone = 'rest'; title = 'יום קל בלבד';
    detail = 'יש מדד שחורג משמעותית מהרגיל שלך — שווה לתת לו יום.';
    alerts.slice(0, 2).forEach(a => push(`${METRICS[a.key].label} ${valueText(a.key, a.value)} — ${a.text}`));
  } else if (strLeft > 0 && daysLeftInWeek <= strLeft + 1) {
    key = 'strength'; tone = 'go'; title = 'אימון כוח — ולא לדחות';
    detail = muscleTxt
      ? `נשארו ${daysLeftInWeek} ימים בשבוע ו-${strLeft} אימונים ליעד. ${muscleTxt} עוד לא עבדו.`
      : `נשארו ${daysLeftInWeek} ימים בשבוע ו-${strLeft} אימונים ליעד — אין הרבה מרווח.`;
    push(`${strDone}/${strGoal} אימוני כוח השבוע`);
  } else if (raceDays !== null && raceDays >= 0 && raceDays <= 28
             && readiness !== null && readiness >= 70
             && (sinceQuality === null || sinceQuality >= 4)) {
    key = 'quality'; tone = 'go'; title = 'ריצת איכות';
    detail = `המירוץ בעוד ${raceDays} ימים והמוכנות גבוהה — זה היום לטמפו או אינטרוולים.`;
    push(sinceQuality === null ? 'עוד לא תועדה ריצת איכות' : `${sinceQuality} ימים מאז ריצת איכות`);
    const gap = (typeof raceTargetPace === 'function') ? raceTargetPace() : null;
    if (gap) push(`קצב היעד ${paceTxt(gap)}`);
  } else if (strLeft > 0 && readiness !== null && readiness >= 60) {
    key = 'strength'; tone = 'go'; title = 'אימון כוח';
    detail = muscleTxt
      ? `${muscleTxt} לא קיבלו עבודה ב-${COVER_DAYS} הימים האחרונים.`
      : `נשאר ${strLeft === 1 ? 'אימון אחד' : `${strLeft} אימונים`} ליעד השבועי.`;
    push(`${strDone}/${strGoal} אימוני כוח השבוע`);
  } else if (kmGoal && weekKm < kmGoal && (sinceRun === null || sinceRun >= 2)) {
    key = 'volume'; tone = 'go'; title = 'ריצת נפח קלה';
    detail = `נשארו ${fmt(kmGoal - weekKm, 1)} ק״מ ליעד השבועי — בקצב נוח, לא מאמץ.`;
    push(`${fmt(weekKm, 1)}/${fmt(kmGoal, 1)} ק״מ השבוע`);
  } else if (strLeft === 0 && missing.length) {
    key = 'gap'; tone = 'go'; title = `אימון משלים — ${muscleTxt}`;
    detail = `עמדת ביעד הכוח, אבל ${muscleTxt} עדיין לא קיבלו עבודה.`;
    push(`${strDone}/${strGoal} אימוני כוח השבוע`);
  } else {
    key = 'maintain'; tone = 'easy'; title = 'יום קל או מנוחה';
    detail = 'היעדים השבועיים בדרך — אין צורך להוסיף עומס היום.';
    if (strGoal) push(`${strDone}/${strGoal} אימוני כוח`);
    if (kmGoal) push(`${fmt(weekKm, 1)}/${fmt(kmGoal, 1)} ק״מ`);
  }

  if (readiness !== null && key !== 'rest' && !alerts.length) push(`מוכנות ${Math.round(readiness)}`);
  if (watches.length && tone === 'go') push(`${METRICS[watches[0].key].label} ${watches[0].text}`);

  return { key, tone, title, detail, why, readiness };
}

const TODAY_ICON = { rest: 'yoga', easy: 'walk', strength: 'dumbbell', quality: 'bolt', volume: 'run', gap: 'dumbbell', maintain: 'yoga' };
function renderToday() {
  const el = $('today-card');
  if (!el) return;
  const p = todayPlan();
  if (!p) { el.innerHTML = ''; return; }
  el.innerHTML = `<article class="card today-card tone-${p.tone}">
    <div class="today-head">
      <span class="today-ic">${icon(TODAY_ICON[p.key] || 'bolt', 22)}</span>
      <div><span class="today-kicker">היום</span>
        <h2 class="today-title">${p.title}</h2></div>
    </div>
    <p class="today-detail">${p.detail}</p>
    ${p.why.length ? `<div class="today-why">${p.why.map(w => `<span>${w}</span>`).join('')}</div>` : ''}
  </article>`;
}

/* =========================================================================
 * פוקוס שבועי — משפט אחד שמצטרף לסיכום השבועי
 * ========================================================================= */
function weekFocus() {
  try {
    const auto = autoStrengthDates();
    const cur = weekRows(0);
    const strDone = strengthCountInWeek(cur, auto), strGoal = goalStrength();
    const missing = missingMuscles();
    const kmGoal = (typeof goalRunKm === 'function') ? goalRunKm() : null;
    const weekKm = (typeof weekRunKm === 'function') ? weekRunKm(cur) : 0;
    const trend = probeTrend();

    if (strDone < strGoal && missing.length)
      return `להשלים ${strGoal - strDone === 1 ? 'אימון כוח אחד' : `${strGoal - strDone} אימוני כוח`}, ובאחד מהם לכלול ${missing.slice(0, 2).map(k => MUSCLES[k]).join(' ו')}.`;
    if (missing.length)
      return `${missing.slice(0, 2).map(k => MUSCLES[k]).join(' ו')} לא קיבלו עבודה — כדאי לשלב אותם בתוכנית.`;
    if (trend && trend.text.includes('תשומת לב'))
      return `לעקוב אחרי המגמה שזוהתה — ${trend.text.replace(/<\/?b>/g, '')}`;
    if (kmGoal && weekKm < kmGoal * 0.8)
      return `להעלות את נפח הריצה — השבוע נסגר על ${fmt(weekKm, 1)} מתוך ${fmt(kmGoal, 1)} ק״מ.`;
    if (strDone >= strGoal && !missing.length)
      return 'לשמור על מה שעובד — היעדים נסגרו וכל קבוצות השריר קיבלו עבודה.';
    return null;
  } catch (_) { return null; }
}

/* =========================================================================
 * תיוג חריגה — למה היום הזה היה חריג
 * ========================================================================= */
let tagDate = null;
function openAnomTag(iso) {
  tagDate = iso;
  const cur = anomTags[iso] || '';
  $('tag-date').textContent = longDate(iso);
  $('tag-options').innerHTML = Object.entries(ANOM_REASONS).map(([k, label]) =>
    `<button type="button" class="tag-opt${k === cur ? ' on' : ''}" data-reason="${k}">${label}</button>`).join('');
  $('tag-clear').classList.toggle('hidden', !cur);
  $('tag-modal').classList.remove('hidden');
}
function closeAnomTag() { $('tag-modal').classList.add('hidden'); tagDate = null; }
function applyAnomTag(reason) {
  if (!tagDate) return;
  if (reason) anomTags[tagDate] = reason; else delete anomTags[tagDate];
  saveAnomTags();
  closeAnomTag();
  if (typeof renderAll === 'function') renderAll();
  toast(reason ? 'תויג — היום הזה לא ישפיע על הבסיס האישי' : 'התיוג הוסר');
}
function initInsights() {
  loadAnomTags();
  const modal = $('tag-modal');
  if (!modal) return;
  modal.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { closeAnomTag(); return; }
    const opt = e.target.closest('[data-reason]');
    if (opt) { haptic(8); applyAnomTag(opt.dataset.reason); return; }
    if (e.target.closest('#tag-clear')) applyAnomTag(null);
  });
  $('anomalies').addEventListener('click', e => {
    const row = e.target.closest('[data-anom-date]');
    if (row) { haptic(6); openAnomTag(row.dataset.anomDate); }
  });
}
