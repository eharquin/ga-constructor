import { createContext, useContext } from 'react';
import { useGraph } from './useGraph.js';

const GraphContext = createContext(null);

export function GraphProvider({ children }) {
  const graph = useGraph();
  return <GraphContext.Provider value={graph}>{children}</GraphContext.Provider>;
}

export function useGraphContext() {
  return useContext(GraphContext);
}
