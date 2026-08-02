// Vercel entrypoint: any file under /api becomes a serverless function.
// The Express app itself already defines all real routes (/api/auth, ...),
// so this just hands every request to it - see vercel.json for the rewrite
// that funnels all paths here.
module.exports = require("../src/index.js");
