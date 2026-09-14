const rateLimit = require('express-rate-limit');

// Login had no throttling at all - unlimited password guesses against any
// username. 10 attempts / 15 min per IP is generous for a real user
// (including mistyped passwords) but stops naive brute-forcing; a locked-out
// legitimate user just waits out the window rather than being locked
// permanently, which needs no admin-unlock flow.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again in a few minutes.' },
});

module.exports = { loginLimiter };
