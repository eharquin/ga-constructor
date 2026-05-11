import { useState, useEffect, useRef } from 'react';
import { GraphProvider } from './GraphContext.jsx';
import ExpressionPanel from './ExpressionPanel.jsx';
import Canvas from './Canvas.jsx';
import './App.css';

const MIN_PANEL = 220;
const MAX_PANEL = 700;

const ALGEBRAS = [
  { id: 'pga201', label: 'PGA(2,0,1)' },
  { id: 'cga410', label: 'CGA(4,1,0)' },
];

export default function App() {
  const [panelWidth, setPanelWidth] = useState(300);
  const [algebra, setAlgebra]       = useState('pga201');
  const dragRef = useRef(null); // { startX, startW } while dragging

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
