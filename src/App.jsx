import { useState, useEffect, useRef } from 'react';
import { GraphProvider, useGraphContext } from './GraphContext.jsx';
import ExpressionPanel from './ExpressionPanel.jsx';
import Canvas from './Canvas.jsx';
import './App.css';

const MIN_PANEL = 220;
const MAX_PANEL = 700;

const ALGEBRAS = [
  { id: 'pga201', label: 'PGA 2D' },
  { id: 'cga410', label: 'CGA(4,1,0)' },
];

// ─── Saved-graph dev API (vite plugin in vite.config.js) ─────────────────────

const listGraphs   = ()              => fetch('/api/graphs').then(r => r.json()).then(j => j.graphs || []);
const loadGraph    = (name)          => fetch(`/api/graphs/${encodeURIComponent(name)}`).then(r => r.ok ? r.json() : Promise.reject(r));
const saveGraph    = (name, items)   => fetch(`/api/graphs/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }).then(r => r.json());
const deleteGraph  = (name)          => fetch(`/api/graphs/${encodeURIComponent(name)}`, { method: 'DELETE' });

function SavedGraphsControls() {
  const { items, loadItems } = useGraphContext();
  const [open, setOpen]       = useState(false);
  const [graphs, setGraphs]   = useState([]);
  const [busy, setBusy]       = useState(false);

  const refresh = async () => {
    try { setGraphs(await listGraphs()); }
    catch (e) { console.error(e); }
  };

  useEffect(() => { if (open) refresh(); }, [open]);

  const handleSave = async () => {
    const name = window.prompt('Save current graph as:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await saveGraph(trimmed, items);
      if (open) await refresh();
    } catch (e) { console.error(e); window.alert('Save failed: ' + e); }
    finally { setBusy(false); }
  };

  const handleLoad = async (name) => {
    setBusy(true);
    try {
      const data = await loadGraph(name);
      if (!Array.isArray(data.items)) throw new Error('malformed graph');
      loadItems(data.items);
      setOpen(false);
    } catch (e) { console.error(e); window.alert('Load failed'); }
    finally { setBusy(false); }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete saved graph "${name}"?`)) return;
    setBusy(true);
    try { await deleteGraph(name); await refresh(); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button className="app-icon-btn" onClick={handleSave} disabled={busy} title="Save current graph">💾</button>
      <button className="app-icon-btn" onClick={() => setOpen(true)} disabled={busy} title="Open saved graph">📂</button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal saved-graphs-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <span>Saved graphs</span>
              <button className="modal-close" onClick={() => setOpen(false)} title="Close">×</button>
            </header>
            <div className="modal-body">
              {graphs.length === 0 ? (
                <div className="modal-empty">No saved graphs yet. Click 💾 to save the current one.</div>
              ) : (
                <ul className="saved-graphs-list">
                  {graphs.map((name) => (
                    <li key={name} className="saved-graphs-row">
                      <span className="saved-graphs-name">{name}</span>
                      <span className="saved-graphs-actions">
                        <button className="modal-btn" onClick={() => handleLoad(name)} disabled={busy}>Load</button>
                        <button className="modal-btn modal-btn-danger" onClick={() => handleDelete(name)} disabled={busy} title="Delete">🗑</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [panelWidth, setPanelWidth] = useState(300);
  const [algebra, setAlgebra]       = useState('pga201');
  const [theme, setTheme]           = useState(() => localStorage.getItem('ga-theme') || 'light');
  const dragRef = useRef(null); // { startX, startW } while dragging

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ga-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    document.documentElement.classList.add('theme-fade');
    setTheme(t => t === 'dark' ? 'light' : 'dark');
    setTimeout(() => document.documentElement.classList.remove('theme-fade'), 350);
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      setPanelWidth(Math.max(MIN_PANEL, Math.min(MAX_PANEL, dragRef.current.startW + dx)));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, []);

  return (
    <GraphProvider>
      <div className="app">
        <header className="app-header">
          <span className="app-title">GA Constructor</span>
          <select
            className="app-algebra-select"
            value={algebra}
            onChange={(e) => setAlgebra(e.target.value)}
          >
            {ALGEBRAS.map(a => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
          <span className="app-header-spacer" />
          <SavedGraphsControls />
          <button
            className="app-theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >{theme === 'dark' ? '☀' : '☾'}</button>
        </header>
        <div className="workspace">
          <div className="panel-wrapper" style={{ width: panelWidth }}>
            <ExpressionPanel />
          </div>
          <div
            className="panel-resize"
            onMouseDown={(e) => {
              dragRef.current = { startX: e.clientX, startW: panelWidth };
              e.preventDefault();
            }}
          />
          <div className="canvas-area">
            <Canvas />
          </div>
        </div>
      </div>
    </GraphProvider>
  );
}
