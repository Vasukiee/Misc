# Misc
Random small projects and experiments I want to keep safe and warm.

## CS2 Reference Sheet
Considering it's a HTML file, it's easier to preview it online and have it always updated compared to downloading it every time. Here's a good tool to do it: https://htmlpreview.github.io/?https://github.com/Vasukiee/Misc/blob/main/HTML/CS2/cs2-reference.html

## CS2 Planner
Pianificatore per Cities: Skylines II, per progettare la città prima di iniziare a costruire.

Apri online: https://htmlpreview.github.io/?https://github.com/Vasukiee/Misc/blob/main/HTML/CS2/planner/index.html

Funziona anche in locale: scarica la cartella `HTML/CS2/planner/` e apri `index.html` nel browser (niente da installare).

Cosa fa:
- **Importa la mappa**: heightmap dell'editor (PNG 4096×4096, 16 bit, anche "mappa mondo") e screenshot delle viste risorse (si indicano i 4 angoli e si campionano i colori).
- **Modifica a mano** ogni strato: elevazione (alza, abbassa, livella, liscia), acqua, terra fertile, foreste, minerali, petrolio, falda, industria prevista.
- **Vincoli**: pendenza, acqua e rive, risorse da riservare con fascia di rispetto, inquinamento sottovento; dove ha senso mettere case e industria.
- **Strade**: disegno a mano, dritte e curve, con aggancio a nodi, strade, angoli, multipli di 8 m e alla distanza giusta tra strade parallele (lotti da 6+6 celle); incroci automatici.
- **Moduli**: ogni area chiusa da strade viene analizzata a celle di 8 m (zonabile, interno sprecato, conflitti tra griglie, vincoli). Interruttore per far proporre le strade interne.
- **Piano di crescita**: fase per modulo, ordine suggerito, vista "fino alla fase", tabella per fase.
- **Export**: heightmap modificata da reimportare nell'editor (originale + modifiche, senza perdita di dettaglio), immagine guida in scala, piano in JSON.

Il progetto si salva da solo nel browser; con "Salva file" si scarica un `.cs2plan` da riaprire dopo.
La heightmap originale ad alta risoluzione resta solo nel browser: aprendo il `.cs2plan` su un altro computer, reimporta la heightmap prima di esportarla.

Test del modello dati: `node HTML/CS2/planner/tests/run.js`
