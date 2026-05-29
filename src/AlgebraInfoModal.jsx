import { useMemo } from 'react';
import { useAlgebra } from './AlgebraContext.jsx';
import { cayleyTable, basisSquares } from './algebras/cayley.js';

function fmtSignature({ p, q, r }) {
  return `ℝ(${p},${q},${r})`;
}

export default function AlgebraInfoModal({ onClose }) {
  const { algebra } = useAlgebra();
  const info = algebra.info;

  // Cayley + signature derivations recompute when the algebra changes.
  const { table, squares } = useMemo(() => ({
    table:   cayleyTable(algebra),
    squares: basisSquares(algebra),
  }), [algebra]);

  if (!info) {
    return (
      <div className="help-overlay" onClick={onClose}>
        <div className="help-modal" onClick={(e) => e.stopPropagation()}>
          <div className="help-header">
            <span className="help-title">{algebra.label}</span>
            <button className="help-close" onClick={onClose}>×</button>
          </div>
          <div className="help-body">
            <p>No info defined for this algebra.</p>
          </div>
        </div>
      </div>
    );
  }

  const blades = algebra.bladeNames;

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <span className="help-title">
            {info.fullName} <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>{fmtSignature(info.signature)}</span>
          </span>
          <button className="help-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="help-body">
          {info.description && (
            <section className="help-section">
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>{info.description}</p>
            </section>
          )}

          <section className="help-section">
            <h3>Basis & metric</h3>
            <table className="algebra-info-grid">
              <thead>
                <tr>
                  {blades.map((b) => <th key={b}>{b}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {squares.map((s, i) => <td key={i} className={s === '0' ? 'algebra-info-zero' : ''}>{s}</td>)}
                </tr>
              </tbody>
            </table>
          </section>

          <section className="help-section">
            <h3>Cayley table</h3>
            <table className="algebra-info-grid algebra-info-cayley">
              <thead>
                <tr>
                  <th></th>
                  {blades.map((b) => <th key={b}>{b}</th>)}
                </tr>
              </thead>
              <tbody>
                {table.map((row, i) => (
                  <tr key={i}>
                    <th>{blades[i]}</th>
                    {row.map((cell, j) => (
                      <td key={j} className={cell === '0' ? 'algebra-info-zero' : ''}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {info.geometry && info.geometry.length > 0 && (
            <section className="help-section">
              <h3>Geometric interpretation</h3>
              <table className="help-table">
                <tbody>
                  {info.geometry.map(({ label, formula }, i) => (
                    <tr key={i}>
                      <td>{label}</td>
                      <td><code>{formula}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {algebra.KIND_COLOR && Object.keys(algebra.KIND_COLOR).length > 0 && (
            <section className="help-section">
              <h3>Object kinds (color palette)</h3>
              <table className="help-table">
                <tbody>
                  {Object.entries(algebra.KIND_COLOR).map(([kind, color]) => (
                    <tr key={kind}>
                      <td>
                        <span style={{
                          display: 'inline-block', width: 10, height: 10,
                          borderRadius: 2, background: color, marginRight: 8,
                          verticalAlign: 'middle',
                        }} />
                        {kind}
                      </td>
                      <td><code>{color}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {info.subalgebras && info.subalgebras.length > 0 && (
            <section className="help-section">
              <h3>Sub-algebras</h3>
              <table className="help-table">
                <tbody>
                  {info.subalgebras.map(({ name, blades }, i) => (
                    <tr key={i}>
                      <td>{name}</td>
                      <td><code>{blades}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {info.notes && info.notes.length > 0 && (
            <section className="help-section">
              <h3>Notes</h3>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {info.notes.map((n, i) => <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>{n}</li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
