import { useState, useEffect, useRef } from 'react';
import { GraphProvider, useGraphContext } from './GraphContext.jsx';
import { AlgebraProvider, useAlgebra } from './AlgebraContext.jsx';
import { SettingsProvider, useSettings } from './SettingsContext.jsx';
import { encodeGraph } from './urlHash.js';
import ExpressionPanel from './ExpressionPanel.jsx';
import Canvas from './Canvas.jsx';
import './App.css';

const MIN_PANEL = 220;
const MAX_PANEL = 700;

// ─── Saved-graph dev API ────────────────────────────────────────────────────

const listGraphs  = ()            => fetch('/api/graphs').then((r) => r.json()).then((j) => j.graphs || []);
const loadGraph   = (name)        => fetch(`/api/graphs/${encodeURIComponent(name)}`).then((r) => r.ok ? r.json() : Promise.reject(r));
const saveGraph   = (name, payload) => fetch(`/api/graphs/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((r) => r.json());
const deleteGraph = (name)        => fetch(`/api/graphs/${encodeURIComponent(name)}`, { method: 'DELETE' });

function SavedGraphsControls() {
  const { items, loadItems } = useGraphContext();
  const { algebra, algebraId, setAlgebraId, ALGEBRAS } = useAlgebra();
  const [open, setOpen]     = useState(false);
  const [graphs, setGraphs] = useState([]);
  const [busy, setBusy]     = useState(false);

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
      await saveGraph(trimmed, { items, algebra: algebraId, hash: encodeGraph(algebraId, items) });
      if (open) await refresh();
    } catch (e) { console.error(e); window.alert('Save failed: ' + e); }
    finally { setBusy(false); }
  };

  const handleLoad = async (name) => {
    setBusy(true);
    try {
      const data = await loadGraph(name);
      if (!Array.isArray(data.items)) throw new Error('malformed graph');
      const saveAlg = data.algebra;
      if (saveAlg && saveAlg !== algebraId) {
        const labels = Object.fromEntries(ALGEBRAS.map((a) => [a.id, a.label]));
        const ok = window.confirm(`This graph was saved as ${labels[saveAlg] ?? saveAlg}. Switch algebra and load?`);
        if (!ok) { setBusy(false); return; }
        setAlgebraId(saveAlg);
        // Defer loadItems so the algebra change propagates and the auto-reset
        // useEffect runs first; otherwise the new INITIAL_ITEMS overwrite us.
        setTimeout(() => loadItems(data.items), 50);
      } else {
        loadItems(data.items);
      }
      setOpen(false);
    } catch (e) { console.error(e); window.alert('Load failed'); }
    finally { setBusy(false); }
  };

  const handleCopyLink = async (name) => {
    setBusy(true);
    try {
      const data = await loadGraph(name);
      const hash = data.hash || encodeGraph(data.algebra, data.items);
      const url = location.origin + location.pathname + location.search + hash;
      try { await navigator.clipboard.writeText(url); }
      catch { window.prompt('Copy this URL:', url); return; }
      window.alert(`Link copied for "${name}"`);
    } catch (e) { window.alert('Failed to get link: ' + e); }
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
                        <button className="modal-btn" onClick={() => handleCopyLink(name)} disabled={busy} title="Copy shareable link">🔗</button>
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

function ShareButton() {
  const { items } = useGraphContext();
  const { algebraId } = useAlgebra();
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const hash = encodeGraph(algebraId, items);
    const url = location.origin + location.pathname + location.search + hash;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this URL:', url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      className="app-icon-btn"
      onClick={handleShare}
      title="Copy shareable link"
    >{copied ? '✓' : '🔗'}</button>
  );
}

function UndoRedoControls() {
  const { undo, redo, canUndo, canRedo } = useGraphContext();
  return (
    <>
      <button
        className="app-icon-btn"
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl/Cmd+Z)"
      >↶</button>
      <button
        className="app-icon-btn"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl/Cmd+Shift+Z)"
      >↷</button>
    </>
  );
}

function OptionsMenu() {
  const { settings, setSetting } = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const Toggle = ({ label, k }) => (
    <label className="options-row">
      <input type="checkbox" checked={!!settings[k]} onChange={(e) => setSetting(k, e.target.checked)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="options-wrapper" ref={ref}>
      <button
        className={`app-icon-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Display options"
      >⚙</button>
      {open && (
        <div className="options-popover" onClick={(e) => e.stopPropagation()}>
          <div className="options-section-label">Display</div>
          <Toggle label="Weight-scaled thickness"          k="weightThickness" />
          <Toggle label="Show MV expression below input"   k="showMvExpression" />
          <Toggle label="Show grid + axes"                 k="showGrid" />
          <Toggle label="Snap to nearby anchors on drag"   k="snapOnDrag" />
          <Toggle label="Always show anchor handles"       k="alwaysShowAnchors" />
          <label className="options-row">
            <span>Decimals</span>
            <select
              className="options-select"
              value={settings.decimals}
              onChange={(e) => setSetting('decimals', +e.target.value)}
            >
              <option value={2}>2</option>
              <option value={4}>4</option>
              <option value={6}>6</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function AlgebraSelect() {
  const { items } = useGraphContext();
  const { algebraId, setAlgebraId, ALGEBRAS } = useAlgebra();
  const onChange = (e) => {
    const next = e.target.value;
    if (next === algebraId) return;
    if (items.length > 0) {
      const labels = Object.fromEntries(ALGEBRAS.map((a) => [a.id, a.label]));
      const ok = window.confirm(`Switch to ${labels[next]}? Your current session will be replaced.`);
      if (!ok) return;
    }
    setAlgebraId(next);
  };
  return (
    <select className="app-algebra-select" value={algebraId} onChange={onChange}>
      {ALGEBRAS.map((a) => (
        <option key={a.id} value={a.id}>{a.label}</option>
      ))}
    </select>
  );
}

function AppShell() {
  const [panelWidth, setPanelWidth] = useState(300);
  const [theme, setTheme]           = useState(() => localStorage.getItem('ga-theme') || 'light');
  const { undo, redo, canUndo, canRedo } = useGraphContext();
  const dragRef = useRef(null);

  // Clear the hash after loading so the URL stays clean for subsequent edits.
  useEffect(() => {
    if (window.location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ga-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = e.target?.tagName;
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if (editable) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const toggleTheme = () => {
    document.documentElement.classList.add('theme-fade');
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
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
    <div className="app">
      <header className="app-header">
        <span className="app-title">multiVector.net</span>
        <AlgebraSelect />
        <span className="app-header-spacer" />
        <UndoRedoControls />
        <ShareButton />
        <SavedGraphsControls />
        <OptionsMenu />
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
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AlgebraProvider>
        <GraphProvider>
          <AppShell />
        </GraphProvider>
      </AlgebraProvider>
    </SettingsProvider>
  );
}
