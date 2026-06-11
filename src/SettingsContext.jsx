import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'ga-settings';

export const DEFAULTS = {
  weightThickness:    false,  // user asked: off by default
  showMvExpression:   true,   // user asked: on by default
  showGrades:         false,  // show present grades [..] next to the type label
  showGrid:           true,
  snapOnDrag:         true,
  alwaysShowAnchors:  true,
  decimals:           4,
  cgaNullBasisDisplay: true,  // CGA: show MV using e0/einf instead of raw e3/e4
};

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { ...DEFAULTS, ...stored };
    } catch { return { ...DEFAULTS }; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);

  const setSetting = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

  return (
    <SettingsContext.Provider value={{ settings, setSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext) ?? { settings: DEFAULTS, setSetting: () => {} };
}
