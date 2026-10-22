# Peilbuizenkaart WDODelta – GHG en GLG

Interactieve kaart van het beheergebied van **Waterschap Drents Overijsselse Delta (WDODelta)**
met de grondwatermeetbuizen (peilbuizen) uit de BRO waarvoor een betrouwbare **GHG**
(Gemiddeld Hoogste Grondwaterstand) en **GLG** (Gemiddeld Laagste Grondwaterstand) te berekenen is.

## Wat zie je op de kaart?
- **Gekleurde stippen** – putten met een geldige GHG én GLG. De kleur geeft de GHG in meter
  onder maaiveld (m-mv) weer, van nat (donkerblauw, < 0,25 m-mv) tot droog (oranje, > 1,40 m-mv).
  Grijs betekent dat de maaiveldhoogte onbekend is.
- **Ringen** – putten met alleen diepe filters (bovenkant filter meer dan 5 m onder maaiveld).
  Daar gaat het om een stijghoogte, niet om de freatische grondwaterstand.
- **Klik op een put** voor de details per filter: filterdiepte, GHG en GLG (in m NAP en m-mv),
  de meetperiode, het aantal geldige jaren en de beoordelingsstatus van de metingen.
- **Zoeken** op putcode of BRO-ID (bijvoorbeeld `GMW000000013564`) via het vergrootglas linksboven.
- **Aan/uit-lagen** (rechtsboven): grens WDODelta, peilvakken (met min- en maxpeil) en primaire en
  secundaire watergangen (met bodembreedte, talud en bodemhoogte). Peilvakken en watergangen worden
  pas geladen als je ze aanvinkt.

In totaal staan er 2390 putten op de kaart, met samen 3421 filters met een berekende GHG en GLG.

## Hoe is GHG/GLG berekend?
1. Alleen reguliere metingen, zonder afgekeurde waarden. Bij overlap gaan volledig beoordeelde
   metingen vóór voorlopige. Meetreeksen worden per filter samengevoegd tot daggemiddelden.
2. Per hydrologisch jaar (1 april – 31 maart) worden de standen op of rond de 14e en 28e van de
   maand genomen (maximaal 4 dagen ernaast). Een jaar telt mee bij minimaal 16 van de 24 standen.
3. Per jaar het gemiddelde van de 3 hoogste (HG3) en 3 laagste (LG3) standen; bij minder dan
   21 standen de 2 hoogste/laagste.
4. GHG en GLG zijn het gemiddelde van HG3 en LG3 over minimaal 8 geldige jaren.
5. Omrekening naar m-mv met de maaiveldhoogte van de put uit de BRO.

De berekening is gedaan met [Pastas](https://pastas.readthedocs.io) (`ps.stats.ghg` / `ps.stats.glg`).

## Kanttekeningen
- De waarden zijn zelf berekend en indicatief. Het is geen officieel product van de BRO of van
  het waterschap.
- De definitie van GHG/GLG vraagt een periode zonder ingrepen in de waterhuishouding. Dat is niet
  gecontroleerd.
- De meetperiode verschilt per buis (zie de popup), waardoor waarden niet altijd onderling
  vergelijkbaar zijn.
- Van een deel van de watergangen zijn bodembreedte, talud of bodemhoogte niet vastgelegd in de
  legger; de popup toont dan "niet vastgelegd".

## Bronnen
- **Basisregistratie Ondergrond (BRO):** grondwatermonitoringputten en grondwaterstanden, via
  [PDOK](https://api.pdok.nl) en [publiek.broservices.nl](https://publiek.broservices.nl). Licentie CC0.
- **Waterschap Drents Overijsselse Delta, open data:** grens beheergebied, peilgebieden en de legger
  van primaire en secundaire watergangen. Licentie CC0.
- **Achtergrondkaart:** © [OpenStreetMap](https://www.openstreetmap.org/copyright)-bijdragers.

Data opgehaald op 21 en 22 oktober 2026.

## Bestanden
| Bestand | Inhoud |
|---|---|
| `index.html` | de kaart, inclusief peilbuizen en grens |
| `peilgebieden.geojson` | peilvakken met min- en maxpeil |
| `watergangen_primair.geojson`, `watergangen_secundair.geojson` | watergangen met profielgegevens |

De kaart laadt de peilvakken en watergangen met `fetch()`. Open `index.html` daarom via een
webserver (zoals GitHub Pages), niet door het bestand lokaal te openen.
