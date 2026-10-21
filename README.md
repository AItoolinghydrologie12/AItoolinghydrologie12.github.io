# Peilbuizenkaart Oldenzaal – GHG en GLG

Interactieve kaart van alle grondwatermeetbuizen (peilbuizen) binnen de gemeente Oldenzaal,
met per buis de **GHG** (Gemiddeld Hoogste Grondwaterstand) en **GLG** (Gemiddeld Laagste
Grondwaterstand).

## Wat zie je op de kaart?
- **Blauwe punten** – buizen met een meetreeks van minimaal 8 jaar. Het label toont
  GHG / GLG in meter onder maaiveld (m-mv). Klik op een punt voor details, ook in m NAP.
- **Grijze punten** – buizen met een te korte reeks of onvoldoende meetgegevens.
- Zoek een buis op BRO-ID (bijvoorbeeld `GMW000000005741`) via het zoekveld rechtsboven.

In totaal staan er 136 buizen op de kaart; voor 73 daarvan is een GHG/GLG berekend.

## Hoe is GHG/GLG berekend?
1. Meetreeksen omgezet naar halfmaandelijkse standen (de 1e en 15e van elke maand).
2. Per hydrologisch jaar (1 april – 31 maart) het gemiddelde van de 3 hoogste en 3 laagste
   standen. Jaren met minder dan 20 van de 24 standen tellen niet mee.
3. Het gemiddelde daarvan over minimaal 8 jaar levert de GHG en GLG op.
4. Omrekening naar m-mv met de maaiveldhoogte van de put.

De waarden zijn zelf berekend en indicatief; het is geen officieel product van de BRO.

## Bronnen
- Basisregistratie Ondergrond (BRO): grondwatermonitoringputten en grondwaterstanden,
  via [PDOK](https://api.pdok.nl) en [broservices.nl](https://publiek.broservices.nl). Licentie CC0.
- Gemeentegrens: Kadaster, Bestuurlijke Gebieden (PDOK).
- Ondergrond: © [OpenStreetMap](https://www.openstreetmap.org/copyright)-bijdragers.

Data opgehaald op 2 augustus 2026.
