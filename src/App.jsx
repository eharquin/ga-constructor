import { useState, useEffect, useRef } from 'react';
import { GraphProvider } from './GraphContext.jsx';
import ExpressionPanel from './ExpressionPanel.jsx';
import Canvas from './Canvas.jsx';
import './App.css';

const MIN_PANEL = 220;
const MAX_PANEL = 700;

export default function App() {
  const [panelWidth, setPanelWidth] = useState(300);
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
          <span className="app-subtitle">PGA(2,0,1)</span>
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
