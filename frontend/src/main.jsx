import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled with the app (not loaded from Google) so they work on
// slow or filtered connections and when offline.
import '@fontsource-variable/bricolage-grotesque/wght.css'
import '@fontsource-variable/instrument-sans/wght.css'
import '@fontsource/noto-sans-myanmar/400.css'
import '@fontsource/noto-sans-myanmar/600.css'
import './index.css'
// Loaded once here (rather than per-page) so the shared modal/button/form
// styles are guaranteed to be present regardless of which page mounts first
// or whether routes get code-split later - every page currently relies on
// these rules without importing them directly.
import './styles/MasterDataManagement.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
