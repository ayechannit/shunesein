// Nearly every controller does `catch (error) { res.status(500).json({ error:
// error.message }) }` (or the `{ message: ... }` variant) - across ~150 call
// sites, that sends raw Postgres error text (constraint names, column names,
// sometimes query fragments) straight to the client. Rewriting every call
// site is high-risk for the value; this wraps res.json once instead, so any
// 5xx JSON response gets its message replaced with a generic one right
// before it leaves the server, while the real error still gets logged
// server-side. 4xx responses (validation errors, HttpError's intentional
// user-facing messages like "Insufficient stock") are untouched - only 5xx
// (unexpected/internal failures) ever carried leakable detail.
module.exports = function sanitizeErrors(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === 'object') {
      console.error(`[${req.method} ${req.originalUrl}] ${res.statusCode}:`, body.error || body.message || body);
      const sanitized = { ...body };
      if ('error' in sanitized) sanitized.error = 'Internal server error';
      if ('message' in sanitized) sanitized.message = 'Internal server error';
      return originalJson(sanitized);
    }
    return originalJson(body);
  };
  next();
};
