import { GraphProvider } from './GraphContext.jsx';
import ExpressionPanel from './ExpressionPanel.jsx';
import Canvas from './Canvas.jsx';
import './App.css';

export default function App() {
  return (
    <GraphProvider>
      <div className="app">
        <header className="app-header">
          <span className="app-title">GA Constructor</span>
          <span className="app-subtitle">PGA(2,0,1)</span>
        </header>
        <div className="workspace">
          <ExpressionPanel />
          <div className="canvas-area">
            <Canvas />
          </div>
        </div>
      </div>
    </GraphProvider>
  );
}
