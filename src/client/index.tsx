import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

const el = document.getElementById('root');
if (!el) throw new Error('No #root element');
createRoot(el).render(<App />);
