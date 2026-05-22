import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ALGEBRAS, DEFAULT_ALGEBRA_ID, getAlgebra } from './algebras/index.js';

const AlgebraContext = createContext(null);

export function AlgebraProvider({ children, initialId = DEFAULT_ALGEBRA_ID }) {
  const [algebraId, setAlgebraId] = useState(
    () => localStorage.getItem('ga-algebra') || initialId
  );

  useEffect(() => {
    localStorage.setItem('ga-algebra', algebraId);
  }, [algebraId]);
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
