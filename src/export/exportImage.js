// Export the live construction SVG to a standalone SVG / PNG / PDF.
//
// The on-screen <svg> is themed with CSS custom properties (var(--…)) and
// `currentColor`, which only resolve against the live stylesheet — a serialized
// file would lose every color. So the shared core, buildExportSvg(), clones the
// node and bakes every computed presentation style inline before serializing.
// SVG and PNG download directly; PDF goes through the browser's own print engine
// (vector, no dependency) via a hidden iframe.

// Presentation properties whose computed value we copy onto the clone so the
// exported file is self-contained (no var(--…) / currentColor left to resolve).
const STYLE_PROPS = [
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'opacity', 'color',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'letter-spacing',
];

// Walk live + clone in lockstep (cloneNode(true) preserves structure exactly) and
// copy each live element's resolved styles onto the matching clone element. We set
// them via inline style so they win over any leftover var(--…) inline values.
function inlineStyles(liveEl, cloneEl) {
  if (liveEl.nodeType === 1) {
    const cs = window.getComputedStyle(liveEl);
    for (const prop of STYLE_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v) cloneEl.style.setProperty(prop, v);
    }
  }
  const lk = liveEl.children, ck = cloneEl.children;
  for (let i = 0; i < lk.length; i++) inlineStyles(lk[i], ck[i]);
}

// Produce a standalone SVG string of the canvas view as shown (full viewport at
// the current pan/zoom), with the current theme's background and colors baked in.
export function buildExportSvg(svgEl) {
  const clone = svgEl.cloneNode(true);
  inlineStyles(svgEl, clone);

  // Fit-to-content: bbox of the geometry layer only (excludes bg rect + grid,
  // Export the canvas view exactly as shown — the full visible viewport (current
  // pan/zoom), not a crop around the objects. The background rect already spans it.
  const w = Math.round(Number(svgEl.getAttribute('width')) || svgEl.clientWidth);
  const h = Math.round(Number(svgEl.getAttribute('height')) || svgEl.clientHeight);

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  clone.removeAttribute('style'); // drop the live cursor/display inline style

  const str = new XMLSerializer().serializeToString(clone);
  return { svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + str, width: w, height: h };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(svgEl, filename = 'ga-construction.svg') {
  const { svg } = buildExportSvg(svgEl);
  triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

// Rasterize the standalone SVG into a PNG at the given pixel scale (2× / 3× for
// crisp retina output). The SVG is self-contained, so the canvas is never tainted.
export function downloadPng(svgEl, scale = 2, filename = 'ga-construction.png') {
  const { svg, width, height } = buildExportSvg(svgEl);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('PNG encode failed')); return; }
        triggerDownload(blob, filename);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')); };
    img.src = url;
  });
}

// Vector PDF with no dependency: drop the standalone SVG into a hidden iframe and
// invoke the browser's print engine. The user picks "Save as PDF".
export function printSvg(svgEl) {
  const { svg, width, height } = buildExportSvg(svgEl);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>GA construction</title>` +
    `<style>@page{size:${width}px ${height}px;margin:0}` +
    `html,body{margin:0;padding:0}svg{display:block}</style></head>` +
    `<body>${svg}</body></html>`,
  );
  doc.close();
  const win = iframe.contentWindow;
  const cleanup = () => setTimeout(() => iframe.remove(), 500);
  win.onafterprint = cleanup;
  // Give the SVG a tick to lay out before printing.
  setTimeout(() => { win.focus(); win.print(); cleanup(); }, 150);
}
