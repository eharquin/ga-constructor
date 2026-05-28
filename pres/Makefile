DECK := slides

.PHONY: all clean watch view

all: $(DECK).pdf

$(DECK).pdf: $(DECK).tex
	latexmk -pdf -interaction=nonstopmode $(DECK).tex

watch:
	latexmk -pdf -pvc -interaction=nonstopmode $(DECK).tex

view: $(DECK).pdf
	@xdg-open $(DECK).pdf >/dev/null 2>&1 || open $(DECK).pdf

clean:
	latexmk -C
	rm -f *.aux *.log *.nav *.out *.snm *.toc *.vrb *.fdb_latexmk *.fls
