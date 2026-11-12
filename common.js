'use strict';

/* =========================================================================
 * common.js — קוד משותף לכל העמודים (דשבורד + ניתוח)
 * ========================================================================= */

/* חסימת זום — iOS Safari מתעלם מ-user-scalable=no מאז iOS 10 */
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
  document.addEventListener(ev, e => e.preventDefault(), { passive: false })
);
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

const SLEEP_GOAL_HOURS = 8;
const STEPS_GOAL = 10000;

/* צבעי סדרות — מקור אמת יחיד: משתני ה-CSS ב-style.css (עברו ולידציית
 * נגישות מול המשטח הכהה). הסקריפטים נטענים עם defer ⇒ ה-CSSOM כבר מוכן. */
const cssVar = (name, fallback) =>
  (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
const C = {
  blue: cssVar('--c-sleep', '#3987e5'),    // צבע ראשי — שינה, שינה עמוקה
  teal: cssVar('--c-teal', '#199e70'),     // שינה קלה, נשימה, משקל
  violet: cssVar('--c-violet', '#9085e9'), // REM, צעדים
  green: cssVar('--c-green', '#008300'),   // HRV
  red: cssVar('--c-red', '#e66767'),       // דופק מנוחה
  orange: cssVar('--c-orange', '#d95926'), // סטרס
  ma: cssVar('--c-ma', '#94a3b8'),         // קו ממוצע נע
  ink: cssVar('--ink', '#e8eef8'),
  ink2: cssVar('--ink-2', '#a8b5ca'),
  muted: cssVar('--muted', '#64748b'),
  grid: cssVar('--grid', 'rgba(148,163,184,.09)'),
  surface: cssVar('--surface', '#131a2a'),
};

/* =========================================================================
 * טעינה ופארסינג
 * ========================================================================= */

/* =========================================================================
 * עזרים כלליים
 * ========================================================================= */
const $ = id => document.getElementById(id);

function vals(rows, key) {
  return rows.map(r => r[key]).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
}

function avg(rows, key) {
  const v = vals(rows, key);
  if (!v.length) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function fmt(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('he-IL', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
}

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const SHORT_DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו', 'ש'];

function shortDate(iso) {
  const [, m, d] = iso.split('-');
  return `${+d}.${+m}`;
}

function longDate(iso) {
  const date = new Date(`${iso}T12:00:00`);
  return `יום ${SHORT_DAY_NAMES[date.getDay()]}, ${shortDate(iso)}`;
}

function minToHm(min) {
  if (min === null || min === undefined) return '—';
  return `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
}

/* מקדם מתאם פירסון בין שני שדות (על ימים שבהם שניהם קיימים) */
function pearson(rows, keyA, keyB) {
  const pairs = rows
    .map(r => [r[keyA], r[keyB]])
    .filter(([a, b]) => a != null && b != null && !Number.isNaN(a) && !Number.isNaN(b));
  const n = pairs.length;
  if (n < 5) return { r: null, n };
  const mean = i => pairs.reduce((s, p) => s + p[i], 0) / n;
  const ma = mean(0), mb = mean(1);
  let num = 0, da = 0, db = 0;
  for (const [a, b] of pairs) {
    num += (a - ma) * (b - mb);
    da += (a - ma) ** 2;
    db += (b - mb) ** 2;
  }
  if (da === 0 || db === 0) return { r: null, n };
  return { r: num / Math.sqrt(da * db), n };
}

/* הגדרות ברירת מחדל ל-Chart.js — מוגדרות רק כאן (לא ב-app.js) */
if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = "'Rubik', system-ui, -apple-system, 'Segoe UI', sans-serif";
  Chart.defaults.color = C.ink2;
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.animation.duration = 350;
}
