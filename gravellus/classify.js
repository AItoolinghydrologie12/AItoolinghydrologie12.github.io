"use strict";
/* Gravellus — classificatie van BRouter-wegsecties (puur, geen DOM).
 *
 * Een BRouter-message-rij beschrijft een sectie: de WayTags gelden vanaf het vorige message-punt tot dit punt
 * (Distance = lengte in meter). Per sectie leiden we twee labels af:
 *   - ondergrond (surf): asfalt, verhard, halfverhard, gravel, onverhard, zand, onbekend
 *   - wegtype (road):    singletrack, fietspad, ... drukke weg
 * Alle mappings staan in GC_CONFIG hieronder; pas die aan, niet de functies.
 * Prioriteit ondergrond: surface > tracktype > highway. `derived` = true als surface ontbrak.
 */
(function(root){

const GC_CONFIG = {
  // Weergavevolgorde = volgorde in deze lijst. color = vaste kleuren (kaarttegels zijn altijd licht);
  // palet is getoetst op onderscheid voor rood-groenkleurenblindheid (donker/licht, oker/oranje/bruin/geel verschillen ook in helderheid).
  surfaces: [
    {key:"asfalt",      label:"Asfalt",                 color:"#3f4650"},
    {key:"verhard",     label:"Klinkers / beton",       color:"#a7afb8"},
    {key:"halfverhard", label:"Halfverhard / compact",  color:"#c9a227"},
    {key:"gravel",      label:"Gravel (los)",           color:"#e8702a"},
    {key:"onverhard",   label:"Onverhard / natuurpad",  color:"#7b4a2a"},
    {key:"zand",        label:"Zand ⚠️",                color:"#f3e27a"},
    {key:"onbekend",    label:"Onbekend",               color:"#8d948b", dashed:true}
  ],
  // OSM surface=* → ondergrondcategorie
  surfaceMap: {
    asfalt:      ["asphalt","chipseal"],
    verhard:     ["paving_stones","sett","cobblestone","unhewn_cobblestone","concrete","concrete:plates","concrete:lanes",
                  "bricks","paved","metal","wood"],
    halfverhard: ["compacted","fine_gravel"],
    gravel:      ["gravel","pebblestone","shells","rock"],
    onverhard:   ["unpaved","ground","dirt","earth","grass","grass_paver","woodchips","mud","clay"],
    zand:        ["sand"]
  },
  // zonder surface: highway → asfalt (afgeleid)
  asphaltHighways: ["trunk","primary","secondary","tertiary","unclassified","residential","living_street","road","cycleway"],
  // tracktype → categorie (afgeleid)
  tracktypeMap: {grade1:"verhard", grade2:"halfverhard", grade3:"onverhard", grade4:"onverhard", grade5:"onverhard"},
  trackWithoutType: "onverhard",
  // "Gravel-aandeel" in de app = deze categorieën opgeteld (zand telt bewust niet mee)
  GRAVEL_SURFACES: ["halfverhard","gravel","onverhard"],
  SAND_WARN_KM: 1,           // waarschuwing als een lus meer zand bevat dan dit

  roads: [
    {key:"singletrack",        label:"Singletrack",          color:"#7b4a2a"},
    {key:"fietspad",           label:"Fietspad",             color:"#1b8a5a"},
    {key:"fietspad_langs_weg", label:"Fietspad langs weg",   color:"#76c893"},
    {key:"fietsstraat",        label:"Fietsstraat",          color:"#2a78d6"},
    {key:"pad",                label:"Pad",                  color:"#a0522d"},
    {key:"veldweg",            label:"Veld-/bosweg",         color:"#e8702a"},
    {key:"straat",             label:"Straat",               color:"#8d99ae"},
    {key:"rustig",             label:"Rustige weg",          color:"#56a0d3"},
    {key:"provinciaal",        label:"Provinciale weg",      color:"#e0a000"},
    {key:"druk",               label:"Drukke weg",           color:"#c0392b"},
    {key:"overig",             label:"Overig / onbekend",    color:"#8d948b", dashed:true}
  ],
  pathHighways: ["path","footway","bridleway","pedestrian","steps","corridor"],
  streetHighways: ["residential","living_street","service"],
  quietHighways: ["unclassified","tertiary"],
  provincialHighways: ["secondary","primary"],
  busyHighways: ["trunk","motorway"],
  busyMaxspeed: 80,                      // primary met maxspeed ≥ dit → drukke weg
  withBikePathHighways: ["unclassified","tertiary","secondary","primary","trunk"],  // krijgen "Fietspad langs weg" bij aanliggend pad
  bikePathValues: ["track","lane","separate"],
  // wegtypen die tellen als "drukke weg" voor de gravel-score (zonder fietspad ernaast)
  BUSY_ROADS: ["provinciaal","druk"],
  // singletrack: smal pad (width < dit, in meter) op onverhard
  narrowWidth: 1
};

function parseTags(wayTags){
  const t = {};
  String(wayTags || "").split(" ").forEach(kv => { const i = kv.indexOf("="); if(i > 0) t[kv.slice(0,i)] = kv.slice(i+1); });
  return t;
}

// omgekeerde index: surface-waarde → categorie
const SURF_LOOKUP = {};
for(const [cat, vals] of Object.entries(GC_CONFIG.surfaceMap)) vals.forEach(v => { SURF_LOOKUP[v] = cat; });

// ondergrond van één sectie → {key, derived}
function classifySurface(t){
  const s = t.surface || t["cycleway:surface"];
  if(s && SURF_LOOKUP[s]) return {key:SURF_LOOKUP[s], derived:false};          // 1. surface
  const hw = (t.highway || "").replace(/_link$/, "");
  if(t.tracktype && GC_CONFIG.tracktypeMap[t.tracktype])                        // 2. tracktype
    return {key:GC_CONFIG.tracktypeMap[t.tracktype], derived:true};
  if(hw === "track") return {key:GC_CONFIG.trackWithoutType, derived:true};
  if(GC_CONFIG.asphaltHighways.includes(hw)) return {key:"asfalt", derived:true}; // 3. highway
  return {key:"onbekend", derived:false};
}

// wegtype van één sectie; surfKey is de al bepaalde ondergrond (nodig voor 'smal pad op onverhard')
function classifyRoad(t, surfKey){
  const hw = (t.highway || "").replace(/_link$/, ""), C = GC_CONFIG;
  const mtb = parseFloat(t["mtb:scale"]);
  const width = parseFloat(t.width);
  if(hw === "path" && (mtb >= 1 || (surfKey === "onverhard" && width < C.narrowWidth))) return "singletrack";
  if(hw === "cycleway" || (hw === "path" && t.bicycle === "designated")) return "fietspad";
  if(t.cyclestreet === "yes" || t.bicycle_road === "yes") return "fietsstraat";
  if(C.pathHighways.includes(hw)) return "pad";
  if(hw === "track") return "veldweg";
  // wegen met een aanliggend fietspad: nooit als "gevaarlijk" tellen
  const bp = [t.cycleway, t["cycleway:right"], t["cycleway:left"], t["cycleway:both"]].some(v => C.bikePathValues.includes(v));
  if(bp && C.withBikePathHighways.includes(hw)) return "fietspad_langs_weg";
  if(C.streetHighways.includes(hw)) return "straat";
  if(C.busyHighways.includes(hw)) return "druk";
  if(hw === "primary" && parseFloat(t.maxspeed) >= C.busyMaxspeed) return "druk";
  if(C.quietHighways.includes(hw)) return "rustig";
  if(C.provincialHighways.includes(hw)) return "provinciaal";
  return "overig";
}

// eenrichtingsweg voor fietsers? (relevant bij omdraaien van een lus)
function isOnewayForBikes(t){
  if(t["oneway:bicycle"] === "no") return false;
  if(/^opposite/.test(t.cycleway || "")) return false;
  const ow = t["oneway:bicycle"] || t.oneway;
  return ow === "yes" || ow === "-1" || ow === "true" || ow === "1" || (t.junction === "roundabout" && !t.oneway);
}

// rijdt de route tegen de eenrichting in (voor fietsers)? reversedirection=yes betekent: tegen de tekenrichting van de OSM-weg in
function isAgainstOneway(t){
  if(t["oneway:bicycle"] === "no" || /^opposite/.test(t.cycleway || "")) return false;
  const ow = t["oneway:bicycle"] || t.oneway, rev = t.reversedirection === "yes";
  return rev ? (ow === "yes" || ow === "true" || ow === "1") : ow === "-1";
}

const _cache = new Map();
// WayTags-string → {surf, road, derived, ow, bad} (resultaat wordt gecachet en gedeeld; niet muteren)
function classify(wayTags){
  const key = String(wayTags || "");
  let r = _cache.get(key);
  if(!r){
    const t = parseTags(key), s = classifySurface(t);
    r = {surf:s.key, derived:s.derived, road:classifyRoad(t, s.key), ow:isOnewayForBikes(t), bad:isAgainstOneway(t)};
    _cache.set(key, r);
  }
  return r;
}

// afronden naar gehele procenten die exact 100 opleveren; de grootste categorie vangt het restant op
function roundTo100(values){
  const tot = values.reduce((a,b) => a+b, 0);
  if(!(tot > 0)) return values.map(() => 0);
  const r = values.map(v => Math.round(v/tot*100));
  const diff = 100 - r.reduce((a,b) => a+b, 0);
  if(diff){ let big = 0; values.forEach((v,i) => { if(v > values[big]) big = i; }); r[big] += diff; }
  return r;
}

// secties [{m, surf, road, derived, ow}] → totalen per categorie (m, %), afgeleid-aandeel, gravel-aandeel, zand, drukke wegen
function aggregate(secs){
  const C = GC_CONFIG;
  const m = {surf:{}, road:{}};
  C.surfaces.forEach(s => m.surf[s.key] = 0);
  C.roads.forEach(r => m.road[r.key] = 0);
  let total = 0, derived = 0, ow = 0, bad = 0;
  for(const s of secs){
    m.surf[s.surf] += s.m; m.road[s.road] += s.m; total += s.m;
    if(s.derived) derived += s.m;
    if(s.ow) ow += s.m;
    if(s.bad) bad += s.m;
  }
  const pack = (list, mm) => {
    const pcts = roundTo100(list.map(x => mm[x.key]));
    return list.map((x,i) => ({key:x.key, label:x.label, color:x.color, dashed:!!x.dashed, m:mm[x.key], km:mm[x.key]/1000, pct:pcts[i]}));
  };
  const frac = keys => total ? keys.reduce((a,k) => a + m.surf[k], 0)/total : 0;
  return {
    totalM: total,
    surf: pack(C.surfaces, m.surf),
    road: pack(C.roads, m.road),
    derivedPct: total ? derived/total : 0,
    gravel: frac(C.GRAVEL_SURFACES),
    asfalt: frac(["asfalt"]),
    sandKm: m.surf.zand/1000,
    busy: total ? C.BUSY_ROADS.reduce((a,k) => a + m.road[k], 0)/total : 0,
    onewayKm: ow/1000,
    badKm: bad/1000
  };
}

// Gravel-score (hoger = beter): +gravel-%, −asfalt-%, −drukke wegen zonder fietspad, −zand-km, kleine straf voor afstandsafwijking.
// Gewichten in SCORE_W zodat ze makkelijk aan te passen zijn. Opties (zand/drukke wegen vermijden) schalen de straffen.
const SCORE_W = {gravel:100, asfalt:30, busy:150, sandKm:10, dev:50};
function gravelScore(st, km, targetKm, opt){
  const o = Object.assign({avoidSand:true, avoidBusy:true}, opt || {});
  const dev = targetKm ? Math.abs(km/targetKm - 1) : 0;
  return SCORE_W.gravel*st.gravel - SCORE_W.asfalt*st.asfalt - (o.avoidBusy ? SCORE_W.busy : 30)*st.busy
       - (o.avoidSand ? SCORE_W.sandKm : 2)*st.sandKm - SCORE_W.dev*dev;
}

root.GC = {CONFIG:GC_CONFIG, parseTags, classifySurface, classifyRoad, classify, aggregate, roundTo100, isOnewayForBikes, gravelScore};
})(typeof window !== "undefined" ? window : globalThis);
