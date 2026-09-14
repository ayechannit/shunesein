// Fails fast at startup if JWT_SECRET isn't configured, instead of letting
// jsonwebtoken silently sign/verify tokens with a hardcoded fallback secret
// (previously 'your_jwt_secret') that anyone reading this public repo could
// use to forge an Owner-role token against a misconfigured deployment.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is not set. Refusing to start with an insecure default secret.'
  );
}

module.exports = { JWT_SECRET };
