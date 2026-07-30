// Single source of truth for date/time formatting and "what's today,"
// replacing nine near-identical copies that used to be defined locally in
// every page file. See the UTC datetime architecture doc for the full
// rationale - the short version:
//
// - Civil dates (order_date, invoice_date, payment_date...) are calendar
//   days with no time-of-day and no timezone. formatDate/todayLocal must
//   never let a Date object's implicit timezone math touch them.
// - Instants (created_at, last_login, an audit timestamp) are specific
//   moments. formatDateTime converts them to the viewer's timezone via
//   Intl.DateTimeFormat, which - unlike the old bare .toLocaleString() -
//   can be given an explicit IANA zone once a per-user preference exists.

// Civil date -> display string. Parses the "YYYY-MM-DD" parts directly
// rather than constructing a Date and calling .toLocaleDateString() on it -
// that old approach parses the string as UTC midnight, then renders it in
// the *browser's* timezone, which silently shows the wrong calendar day
// for any negative UTC offset (confirmed: 2026-07-29 rendered as 7/28/2026
// for a browser in America/Los_Angeles). Splitting the string never
// constructs an instant, so there is no timezone to get wrong.
export const formatDate = (value) => {
  if (!value) return '-';
  const datePart = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return String(value);
  const [, year, month, day] = match;
  return `${Number(month)}/${Number(day)}/${year}`;
};

// Instant -> display string, in the viewer's timezone. Omit `timeZone` to
// fall back to the browser's own zone (identical to the old bare
// .toLocaleString() behavior) - pass a per-user IANA identifier once one is
// available (see Phase 4 of the architecture doc) for a viewer-correct
// rendering regardless of which browser/host they're on.
export const formatDateTime = (value, timeZone) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone,
    }).format(parsed);
  } catch {
    // An invalid/unknown timeZone identifier (e.g. a stale value from
    // before a browser's tz database update) should degrade to the
    // browser's own zone rather than break the page.
    return parsed.toLocaleString();
  }
};

export const detectBrowserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

// The full IANA timezone database, straight from the browser rather than a
// hand-maintained list that inevitably goes stale. Intl.supportedValuesOf is
// supported in every evergreen browser this app targets; the try/catch
// exists only for older engines that lack it.
export const listTimezones = () => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
};

// The user's actual local calendar date, as "YYYY-MM-DD" - for defaulting a
// new record's date field or a report filter's "to" bound. Deliberately
// NOT new Date().toISOString().slice(0, 10), which returns UTC's calendar
// date and is wrong by a day for roughly half the world at any given
// moment (e.g. 11pm in New York is already "tomorrow" in UTC; 1am in
// Yangon is still "yesterday" in UTC).
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const firstOfMonthLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
