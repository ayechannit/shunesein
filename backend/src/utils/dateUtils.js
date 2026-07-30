// Single source of truth for "what date is it" on the server side, replacing
// three independently-written (and inconsistent) copies of this logic that
// used to live in ReportController, AuditController, and DashboardController.
//
// Every function here is server-scoped: it answers "what's today from the
// server's point of view," which is UTC (see backend/src/index.js, which
// pins process.env.TZ = 'UTC' as the very first thing that runs). That is
// the right default for anything with no per-user viewer yet. Once a
// request carries the viewer's own timezone (see the ?tz= parameter added
// to report endpoints in Phase 4), resolveDateRange accepts it and computes
// "today"/"the 1st of this month" in that zone instead.

const pad2 = (n) => String(n).padStart(2, '0');

// The server's own current UTC calendar date, as YYYY-MM-DD. Used only for
// genuinely server-scoped defaults (e.g. "no date given, use right now") -
// never for anything that should reflect a specific user's local day.
const todayUtcIsoDate = () => new Date().toISOString().slice(0, 10);

// Resolves the {year, month, day} of "now" in a given IANA timezone, using
// Intl.DateTimeFormat - the same mechanism the browser uses, so server and
// client agree on what a given timezone identifier means, DST included.
const nowPartsInTimeZone = (timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(lookup.year), month: Number(lookup.month), day: Number(lookup.day) };
};

// Defaults to the current calendar month when no range is given - every
// report accepts optional from/to (YYYY-MM-DD) query params. When a `tz`
// (IANA identifier) is supplied, "today" and "the 1st" are computed in that
// timezone rather than the server's UTC day, so a report's default period
// matches the viewer's own calendar, not the server's.
const resolveDateRange = (from, to, tz) => {
  let year, month, day;
  if (tz) {
    ({ year, month, day } = nowPartsInTimeZone(tz));
  } else {
    const now = new Date();
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
    day = now.getUTCDate();
  }
  const defaultFrom = `${year}-${pad2(month)}-01`;
  const defaultTo = `${year}-${pad2(month)}-${pad2(day)}`;
  return { from: from || defaultFrom, to: to || defaultTo };
};

// The period immediately preceding [from, to], of the same length - used by
// every report's optional ?compare=true period-over-period comparison.
// from/to are plain YYYY-MM-DD civil dates, so this deliberately does all
// its arithmetic in UTC (via the Z suffix) rather than any local timezone -
// a civil date has no timezone of its own, and this must produce the same
// "previous period" for every viewer regardless of where they are.
const resolvePreviousRange = (from, to) => {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const lengthMs = Math.max(toDate.getTime() - fromDate.getTime(), 0);
  const prevTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - lengthMs);
  const fmt = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return { from: fmt(prevFrom), to: fmt(prevTo) };
};

// The last `count + 1` months (current month plus `count` back) as
// "YYYY-MM" keys, oldest first - for building month-by-month chart buckets
// against results already GROUP BY-ed by month in SQL.
const monthBuckets = (count) => {
  const buckets = [];
  const now = new Date();
  for (let i = count; i >= 0; i -= 1) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() - i;
    // New Date(year, month, 1) normalizes an out-of-range month (negative
    // or >11) by rolling the year - exactly what's needed to walk backwards
    // across a year boundary without special-casing it.
    const d = new Date(Date.UTC(year, month, 1));
    buckets.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`);
  }
  return buckets;
};

module.exports = { todayUtcIsoDate, resolveDateRange, resolvePreviousRange, monthBuckets, nowPartsInTimeZone };
