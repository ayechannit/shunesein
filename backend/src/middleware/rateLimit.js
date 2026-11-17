const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// The visitor's real IP. Behind Cloudflare, req.ip is a Cloudflare edge
// address shared by many visitors, while Cloudflare passes the true client
// address in CF-Connecting-IP. Without this, everyone reaching the site
// through the same Cloudflare edge would share one login-attempt bucket.
const clientIp = (req) => {
  const cfIp = req.headers['cf-connecting-ip'];
  return typeof cfIp === 'string' && cfIp.trim() ? cfIp.trim() : req.ip;
};

// Login had no throttling at all - unlimited password guesses against any
// username. 10 attempts / 15 min is generous for a real user (including
// mistyped passwords) but stops naive brute-forcing; a locked-out legitimate
// user just waits out the window rather than being locked permanently, which
// needs no admin-unlock flow.
//
// Keyed by IP *and* username: staff in one shop share a single public IP, so
// an IP-only key let one person's typos lock every colleague out of login.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const username = String(req.body?.username || '').trim().toLowerCase().slice(0, 100);
    return `${ipKeyGenerator(clientIp(req))}|${username}`;
  },
  message: { message: 'Too many login attempts. Please try again in a few minutes.' },
});

module.exports = { loginLimiter, clientIp };
