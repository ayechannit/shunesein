// Backend base URL. Set VITE_API_URL in the Vercel project (or a local
// .env file) to point at the deployed backend; falls back to the local
// dev server so `npm run dev` keeps working with no setup.
export const API_ROOT = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
