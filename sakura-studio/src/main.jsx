import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Fehler lokal protokollieren (Hilfe › Fehlerprotokoll öffnen)
if (window.native && window.native.logError) {
  window.addEventListener('error', (e) => window.native.logError('Fehler: ' + (e.error && e.error.stack || e.message)));
  window.addEventListener('unhandledrejection', (e) => window.native.logError('Promise: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
}
