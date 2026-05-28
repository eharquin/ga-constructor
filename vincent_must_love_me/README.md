# Slides for Vincent

Beamer deck pitching **multiVector.net** as a thesis contribution.

## Build

```bash
make            # builds slides.pdf
make watch      # rebuilds on save (latexmk -pvc)
make view       # opens the PDF
make clean
```

Requires a TeX distribution with the `metropolis` theme
(`texlive-fonts-extra` + `texlive-latex-extra` on Debian/Ubuntu;
`mactex` on macOS already ships it).

If `metropolis` is missing:

```bash
sudo apt install texlive-fonts-extra texlive-latex-extra texlive-science
```

## What's in the deck

1. The GA tooling gap (motivation)
2. The opportunity for a community standard
3. What multiVector.net is — one screenshot, one expression block
4. The pluggable algebra-adapter architecture (the real contribution)
5. Ganja delegation: single sign convention
6. Lists as first-class values
7. Smart norms, postfix accessors
8. User-defined functions (the latest milestone)
9. Animation + direct manipulation
10. Polish: themes, persistence, share URLs, error UX
11. Why this is a platform, not a demo — academic angle
12. Concrete contributions for the thesis
13. Roadmap
14. The ask: position as a thesis contribution + target venues

## Demo

Before the meeting, start the app:

```bash
cd ..
npm run dev
# then open http://localhost:5174
```

A few one-liners to type live:

```text
P = point(1, 1)
Q = point(2, 2)
dist(A, B) = |A & B|
d = dist(P, Q)
M = exp(0.5 * e12)
Q' = M >>> P
```

Then drag `P` and watch `d`, `Q'`, and any other dependents update in real time.
