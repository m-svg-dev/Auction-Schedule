// ISO 8601 週番号ユーティリティ（YYYY-Www形式）

export function getISOWeekString(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 月曜=0 ... 日曜=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // その週の木曜日
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function getMondayOfISOWeek(weekStr) {
  const [yearStr, weekPart] = weekStr.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekPart, 10);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7; // 日曜=0を7に
  if (dow <= 4) {
    simple.setUTCDate(simple.getUTCDate() - dow + 1);
  } else {
    simple.setUTCDate(simple.getUTCDate() + 8 - dow);
  }
  return simple;
}

export function addWeeks(weekStr, n) {
  const monday = getMondayOfISOWeek(weekStr);
  monday.setUTCDate(monday.getUTCDate() + n * 7);
  return getISOWeekString(monday);
}

export function getCurrentWeek() {
  return getISOWeekString(new Date());
}

export function formatWeekRange(weekStr) {
  const monday = getMondayOfISOWeek(weekStr);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = d => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(monday)}〜${fmt(sunday)}`;
}

// オークション開催日（その週の日曜日）を「7月6日（日）」形式で返す
export function formatSunday(weekStr) {
  const monday = getMondayOfISOWeek(weekStr);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return `${sunday.getUTCMonth() + 1}月${sunday.getUTCDate()}日（日）`;
}

// テーブル用の短縮形「7/6（日）」
export function formatSundayShort(weekStr) {
  const monday = getMondayOfISOWeek(weekStr);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return `${sunday.getUTCMonth() + 1}/${sunday.getUTCDate()}（日）`;
}
