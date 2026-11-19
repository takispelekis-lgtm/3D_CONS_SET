# CONS_3D

Αριθμητική ανάλυση τάσεων, καθιζήσεων και χρονικής εξέλιξης της στερεοποίησης σε τρισδιάστατα γεωτεχνικά προβλήματα.

Π. Πελέκης, Αναπλ. Καθηγητής, Τμήμα Πολιτικών Μηχανικών, Πανεπιστήμιο Πατρών.

**Εφαρμογή:** https://takispelekis-lgtm.github.io/3D_CONS_SET/

**Εγχειρίδιο:** [Εγχειρίδιο CONS3D.pdf](Εγχειρίδιο%20CONS3D.pdf)

Η εφαρμογή τρέχει εξ ολοκλήρου στον browser. Τα μοντέλα αποθηκεύονται στον browser του χρήστη και μπορούν να εξαχθούν ή να φορτωθούν ως αρχεία JSON.

## Τοπική εκτέλεση (για ανάπτυξη)

Απαιτείται [Node.js](https://nodejs.org/).

```
npm install
npm run dev
```

Η εφαρμογή ανοίγει στο http://localhost:5173. Κάθε αλλαγή που ανεβαίνει στον κλάδο `main` δημοσιεύεται αυτόματα στο GitHub Pages.

## Εγχειρίδιο

Η πηγή του εγχειριδίου είναι το [docs/manual/cons3d_manual.tex](docs/manual/cons3d_manual.tex) (LuaLaTeX, γραμματοσειρές Noto Sans και, στο εξώφυλλο, Noto Serif). Στον ίδιο φάκελο βρίσκονται το λογότυπο και η εικόνα του εξωφύλλου (cover_image.png). Μεταγλώττιση με `lualatex cons3d_manual.tex` δύο φορές και αντιγραφή του PDF στη ρίζα ως «Εγχειρίδιο CONS3D.pdf».

Η έκδοση Word («Εγχειρίδιο CONS3D.docx») παράγεται από την ίδια πηγή με τα εργαλεία του [docs/manual/word_tools/](docs/manual/word_tools/), μετά τη μεταγλώττιση LaTeX (χρειάζεται το .aux για τους αριθμούς ενοτήτων, εξισώσεων και πινάκων):

1. `node tex2html.mjs cons3d_manual.tex cons3d_manual.aux manual.html` (απαιτεί `npm install katex@0.16.11`): HTML με τις εξισώσεις σε MathML. Δίπλα στο HTML μπαίνουν τα cover_image.png, upatras_logo.jpg και stencil.png.
2. `powershell -File build_docx.ps1 -Dir <φάκελος του HTML> -OutName manual.docx [-Preview 14]`: το Word εισάγει το HTML (οι εξισώσεις γίνονται κανονικές εξισώσεις Word) και μορφοποιεί εξώφυλλο, στυλ και αρίθμηση σελίδων. Το αρχείο δεν αποθηκεύεται από το Word, γιατί η αποθήκευση κολλάει όταν το Word τρέχει αυτόματα με το πρόσθετο PDFMaker του Acrobat· το περιεχόμενο εξάγεται ως XML και το [flat2docx.py](docs/manual/word_tools/flat2docx.py) το συναρμολογεί σε .docx. Με `-Preview` γράφονται και εικόνες των σελίδων για έλεγχο.

Το [test_terzaghi.mjs](docs/manual/word_tools/test_terzaghi.mjs) παράγει τους αριθμούς του πίνακα επαλήθευσης Terzaghi (§1.3.8) από τον επιλυτή της εφαρμογής.
