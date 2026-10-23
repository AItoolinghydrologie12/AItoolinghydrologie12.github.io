# REGIS-viewer WDODelta

Webviewer voor het hydrogeologische model **REGIS II** (TNO – Geologische Dienst Nederland) in het beheergebied van Waterschap Drents Overijsselse Delta. Daarbij staan de boringen, sonderingen en peilbuizen uit de **Basisregistratie Ondergrond (BRO)**.

De viewer draait volledig in de browser; er is geen server of account nodig.

## Wat kun je ermee

- **Lagen in beeld**: de lijst links toont welke REGIS-lagen in het kaartbeeld voorkomen. Klik een laag aan om te zien waar hij voorkomt, of bekijk de top, basis, dikte, kh, kv of c.
- **Kolom**: klik op de kaart voor alle lagen op dat punt.
- **Doorsnede**: klik punten op de kaart en rond af met dubbelklik of *Klaar*. Boringen, sonderingen en peilbuizen bij de lijn worden meegetekend. Opslaan kan als SVG of PNG.
- **Boringen**: geologische boringen (inclusief het oude DINO-archief) en geotechnische boringen. Met een gekozen laag zie je alleen de boringen die tot in die laag reiken. Klik op een boring voor de boorbeschrijving naast REGIS.
- **Sonderingen**: met een klik wordt de sondering omgezet naar zand, leem, klei of veen. Dit is een indicatie op basis van qc en Rf, geen monsterbeschrijving.
- **Peilbuizen**: kies een laag, dan verschijnen de peilbuizen met een filter in die laag.
- **Gebied**: teken een rechthoek of polygoon; daarna wordt alles alleen binnen dat gebied getoond.
- **Link kopiëren**: de link bevat de kaartuitsnede, de laag, de doorsnede en het gebied. Wie de link opent, ziet precies hetzelfde.

## Inhoud

| Gegevens | Aantal |
|---|---|
| REGIS-lagen in het gebied | 56 |
| Boringen (BHR-G en BHR-GT) | 4.258 |
| Sonderingen (CPT) | 5.154 |
| Peilbuizen (GMW) | 6.565 |

Het gebied is het beheergebied van WDODelta plus 1 km. De gegevens zijn opgehaald op 24 oktober 2026. Boorbeschrijvingen en sonderingsmetingen komen live uit de BRO op het moment dat je ze opent, en zijn dus altijd actueel.

## Bestanden

```
index.html, app.js, style.css   de viewer
lib/                            Leaflet, proj4, Proj4Leaflet (met licenties)
data/                           REGIS-tegels, grens, boringen, sonderingen, peilbuizen
```

## Bronnen en licenties

- REGIS II: TNO – Geologische Dienst Nederland, via DINOloket.
- Boringen, sonderingen en peilbuizen: Basisregistratie Ondergrond (BRO), via publiek.broservices.nl.
- Grens WDODelta: Het Waterschapshuis, *Waterschappen waterschapsgrenzen IMSO*, via PDOK.
- Achtergrondkaart en luchtfoto: PDOK / Kadaster.
- Leaflet (BSD-2), proj4js (MIT), Proj4Leaflet (BSD-2): zie `lib/LICENSE-*`.

De interpretaties in deze viewer zijn hulpmiddelen voor verkenning. Ze vervangen geen geohydrologisch of geotechnisch advies.
