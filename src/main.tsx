import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register versioned Service Worker for app shell and cover cache
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Service worker registration note:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
