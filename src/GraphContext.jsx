import { createContext, useContext } from 'react';
import { useGraph } from './useGraph.js';
import { useAlgebra } from './AlgebraContext.jsx';

const GraphContext = createContext(null);

export function GraphProvider({ children }) {
  const { algebra } = useAlgebra();
  const graph = useGraph(algebra);
  return <GraphContext.Provider value={graph}>{children}</GraphContext.Provider>;
}

export function useGraphContext() {
  return useContext(GraphContext);
}
