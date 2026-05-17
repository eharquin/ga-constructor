import { createContext, useContext, useMemo, useState } from 'react';
import { ALGEBRAS, DEFAULT_ALGEBRA_ID, getAlgebra } from './algebras/index.js';

const AlgebraContext = createContext(null);

export function AlgebraProvider({ children, initialId = DEFAULT_ALGEBRA_ID }) {
  const [algebraId, setAlgebraId] = useState(initialId);
  const algebra = useMemo(() => getAlgebra(algebraId), [algebraId]);
  return (
    <AlgebraContext.Provider value={{ algebra, algebraId, setAlgebraId, ALGEBRAS }}>
      {children}
    </AlgebraContext.Provider>
  );
}

export function useAlgebra() {
  return useContext(AlgebraContext);
}
