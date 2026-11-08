"use strict";
/* Gravellus — windanalyse per lus (puur, geen DOM).
 *
 * Conventies:
 *  - Windrichting = waar de wind VANDAAN komt (meteorologisch; 0° = noord, met de klok mee), zoals Open-Meteo.
 *  - Rijrichting β = bearing (graden) van het stukje route.
 *  - Windcomponent langs de rijrichting: h = V·cos(β − θw). h > 0 = TEGENWIND, h < 0 = meewind.
 *    Zijwind = V·|sin(β − θw)|.
 *  - Heenweg = eerste HALF_SPLIT van de afstand, terugweg = de rest. Windvoordeel = h̄_heen − h̄_terug (positief = gunstig).
 *  - Interpolatie in de tijd gebeurt met vectoren (niet met graden), zodat 350° → 10° via 0° gaat en niet via 180°.
 *
 * NB (wiskunde): voor een gesloten lus en uniforme wind hangt h̄ van een helft alleen af van de koorde van huis naar het
 * punt op 50% van de afstand. Omdraaien van de lus laat dat punt en dus h̄_heen en h̄_terug ongewijzigd; het windvoordeel
 * is daardoor invariant onder omdraaien. Wat het wél verandert is langs welke kant de helft loopt (verdeling tegenwind).
 */
(function(root){

const WCFG = {
  HALF_SPLIT: 0.5,          // heenweg = eerste 50% van de afstand (later aanpasbaar)
  HEAD_THRESHOLD: 5,        // km/u: boven dit telt een stuk als tegenwind
  CALM_KMH: 8,              // onder deze (gemiddelde) windsnelheid: "nauwelijks wind"
  NEUTRAL_KMH: 3,           // |windvoordeel| onder dit: neutraal
  GUST_WARN_KMH: 50,
  BIKE_HEIGHT_FACTOR: 0.67, // 10 m → fietshoogte, logprofiel open terrein (z0 ≈ 0,03 m)
  BEARING_WINDOW_KM: 0.1,   // rijrichting over ~100 m, om zigzagruis te dempen
  SPEEDS: {gravel:20, fastbike:27, mtb:15},   // gemiddelde snelheid per profiel (km/u)
  // kleurmodus Wind: divergerend, tegenwind (rood) ↔ zijwind (neutraal) ↔ meewind (blauw); kleurenblind-vriendelijk
  CATS: [
    {key:"tegen2", label:"Sterke tegenwind (> 15 km/u)", color:"#b2182b", min:15, max:Infinity},
    {key:"tegen1", label:"Tegenwind (5–15 km/u)",        color:"#ef8a62", min:5,  max:15},
    {key:"zij",    label:"Zijwind / windstil",           color:"#b8bdc2", min:-5, max:5},
    {key:"mee1",   label:"Meewind (5–15 km/u)",          color:"#67a9cf", min:-15, max:-5},
    {key:"mee2",   label:"Sterke meewind (> 15 km/u)",   color:"#2166ac", min:-Infinity, max:-15}
  ]
};
const rad = d => d*Math.PI/180, deg = r => r*180/Math.PI;
const norm360 = a => ((a % 360) + 360) % 360;

// Beaufort-grenzen in m/s (ondergrens van 1 t/m 12)
const BFT_MS = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
function beaufort(kmh){ const ms = kmh/3.6; let b = 0; while(b < 12 && ms >= BFT_MS[b]) b++; return b; }

const COMPASS = ["N","NO","O","ZO","Z","ZW","W","NW"];
const compass8 = a => COMPASS[Math.round(norm360(a)/45) % 8];

// wind (snelheid, richting waar hij vandaan komt) ↔ vectorcomponenten van de windsnelheid (oost u, noord v)
function toVec(speed, fromDeg){ return {u: -speed*Math.sin(rad(fromDeg)), v: -speed*Math.cos(rad(fromDeg))}; }
function fromVec(u, v){ return {speed: Math.hypot(u, v), dir: norm360(deg(Math.atan2(-u, -v)))}; }

// uurlijkse wind {t:[unix-seconden], speed:[km/u], dir:[graden], gust:[km/u]} op tijdstip tSec; lineair in vectoren; buiten bereik: dichtstbijzijnde uur
function windAt(h, tSec){
  const n = h.t.length;
  if(!n) return null;
  const outside = tSec < h.t[0] || tSec > h.t[n-1];
  let i = 0;
  if(tSec >= h.t[n-1]) i = n - 2; else if(tSec > h.t[0]){ let a = 0, b = n-1; while(b - a > 1){ const m = (a+b) >> 1; if(h.t[m] <= tSec) a = m; else b = m; } i = a; }
  if(n === 1 || i < 0) return {speed:h.speed[0], dir:h.dir[0], gust:h.gust[0], outside};
  const f = Math.min(1, Math.max(0, (tSec - h.t[i])/(h.t[i+1] - h.t[i])));
  const a = toVec(h.speed[i], h.dir[i]), b = toVec(h.speed[i+1], h.dir[i+1]);
  const w = fromVec(a.u + f*(b.u - a.u), a.v + f*(b.v - a.v));
  return {speed:w.speed, dir:w.dir, gust:h.gust[i] + f*(h.gust[i+1] - h.gust[i]), outside};
}

// initiële bearing van [lat,lon] naar [lat,lon], graden
function bearingDeg(la1, lo1, la2, lo2){
  const p1 = rad(la1), p2 = rad(la2), dl = rad(lo2 - lo1);
  return norm360(deg(Math.atan2(Math.sin(dl)*Math.cos(p2), Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl))));
}
// h > 0 = tegenwind
const headComp = (beta, thetaFrom, V) => V*Math.cos(rad(beta - thetaFrom));
const sideComp = (beta, thetaFrom, V) => V*Math.abs(Math.sin(rad(beta - thetaFrom)));

// rijrichting per stukje (bearing[k] hoort bij het stukje coords[k-1] → coords[k]; bearing[0] = bearing[1]),
// bepaald over een venster van ~windowKm rond het midden van het stukje. coords = [[lon,lat,...],...], d = cumulatieve km.
function segmentBearings(coords, d, windowKm){
  const w = windowKm == null ? WCFG.BEARING_WINDOW_KM : windowKm, n = coords.length, out = new Array(n).fill(0);
  let lo = 0, hi = 0;
  for(let k=1; k<n; k++){
    const mid = (d[k-1] + d[k])/2;
    while(lo < k-1 && d[lo] < mid - w/2) lo++;
    if(hi < k) hi = k;
    while(hi < n-1 && d[hi] < mid + w/2) hi++;
    const a = coords[lo], b = coords[hi];
    out[k] = (a[0] === b[0] && a[1] === b[1]) ? bearingDeg(coords[k-1][1], coords[k-1][0], coords[k][1], coords[k][0])
                                               : bearingDeg(a[1], a[0], b[1], b[0]);
  }
  if(n > 1) out[0] = out[1];
  return out;
}

// samenvatting van een helft: afstandsgewogen gemiddelde h, % afstand met tegenwind, langste aaneengesloten tegenwindstrook (km)
function summarizeHalf(h, len, from, to){
  let sum = 0, km = 0, head = 0, streak = 0, best = 0;
  for(let k=from; k<to; k++){
    if(!(len[k] > 0)) continue;
    sum += h[k]*len[k]; km += len[k];
    if(h[k] > WCFG.HEAD_THRESHOLD){ head += len[k]; streak += len[k]; if(streak > best) best = streak; } else streak = 0;
  }
  return {avgH: km ? sum/km : 0, pctHead: km ? head/km : 0, streakKm: best, km};
}

/* Windanalyse van één lus.
 *   route: {coords:[[lon,lat,ele]...], d:[cumulatieve km]}
 *   opt:   {hourly, startSec, speedKmh, scale (default 1), split (default HALF_SPLIT)}
 * Segment k (1..n-1) = coords[k-1] → coords[k]. */
function analyse(route, opt){
  const {coords, d} = route, n = coords.length, tot = d[n-1];
  const scale = opt.scale || 1, split = opt.split == null ? WCFG.HALF_SPLIT : opt.split;
  const beta = segmentBearings(coords, d);
  const h = new Array(n).fill(0), side = new Array(n).fill(0), V = new Array(n).fill(0), len = new Array(n).fill(0);
  let gustMax = 0, outside = false, su = 0, sv = 0, sV = 0, sL = 0, splitIdx = n;
  for(let k=1; k<n; k++){
    len[k] = d[k] - d[k-1];
    const mid = (d[k-1] + d[k])/2;
    if(splitIdx === n && mid >= split*tot) splitIdx = k;
    const w = windAt(opt.hourly, opt.startSec + mid/opt.speedKmh*3600);
    if(w.outside) outside = true;
    const v = w.speed*scale;
    V[k] = v; h[k] = headComp(beta[k], w.dir, v); side[k] = sideComp(beta[k], w.dir, v);
    gustMax = Math.max(gustMax, w.gust*scale);
    const vec = toVec(v, w.dir); su += vec.u*len[k]; sv += vec.v*len[k]; sV += v*len[k]; sL += len[k];
  }
  const heen = summarizeHalf(h, len, 1, splitIdx), terug = summarizeHalf(h, len, splitIdx, n);
  const mean = fromVec(su, sv);
  return {h, side, V, beta, splitIdx, heen, terug, advantage: heen.avgH - terug.avgH,
    meanV: sL ? sV/sL : 0, meanDir: sL ? mean.dir : 0, gustMax, outside, scale,
    kmh: opt.speedKmh, startSec: opt.startSec};
}

// oordeel voor de badge
function verdict(res){
  if(res.meanV < WCFG.CALM_KMH) return {key:"calm", icon:"🍃", label:"Nauwelijks wind"};
  if(Math.abs(res.advantage) < WCFG.NEUTRAL_KMH) return {key:"neutral", icon:"↔", label:"Neutraal"};
  return res.advantage > 0 ? {key:"good", icon:"✅", label:"Mee terug"} : {key:"bad", icon:"⚠️", label:"Tegen terug"};
}

// kleurcategorie voor windcomponent h
function catOfH(h){ return WCFG.CATS.find(c => h > c.min && h <= c.max) || WCFG.CATS.find(c => h === c.min) || WCFG.CATS[2]; }

// de lus omdraaien (alleen geometrie en classificatie; het profiel wordt in de app opnieuw opgebouwd).
// infos[k] hoort bij het stukje dat in coords[k] eindigt; in omgekeerde volgorde is dat infos[n-k] (k ≥ 1).
function reverseRoute(coords, infos){
  const n = coords.length, rc = coords.slice().reverse(), ri = new Array(n);
  for(let k=1; k<n; k++) ri[k] = infos[n-k];
  ri[0] = n > 1 ? ri[1] : infos[0];
  return {coords: rc, infos: ri};
}

// Open-Meteo-antwoord (timeformat=unixtime) → {t, speed, dir, gust}; null-waarden worden NaN
function parseOpenMeteo(j){
  const H = j && j.hourly; if(!H || !H.time) return null;
  const num = x => x == null ? NaN : +x;
  return {t:H.time.map(Number), speed:H.wind_speed_10m.map(num), dir:H.wind_direction_10m.map(num), gust:H.wind_gusts_10m.map(num)};
}
// voldoende bruikbare uren vanaf nowSec (zodat we weten of we naar best_match moeten terugvallen)?
function usableFrom(h, nowSec, hours){
  if(!h) return false;
  let ok = 0;
  for(let i=0; i<h.t.length; i++) if(h.t[i] >= nowSec - 3600 && h.t[i] <= nowSec + hours*3600 && isFinite(h.speed[i]) && isFinite(h.dir[i]) && isFinite(h.gust[i])) ok++;
  return ok >= hours*0.9;
}

root.GW = {CONFIG:WCFG, beaufort, compass8, toVec, fromVec, windAt, bearingDeg, headComp, sideComp, segmentBearings,
           analyse, verdict, catOfH, reverseRoute, parseOpenMeteo, usableFrom};
})(typeof window !== "undefined" ? window : globalThis);
