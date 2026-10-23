/* REGIS-viewer — toont REGIS II-lagen per tegel, met lagen-in-beeld, kolom en doorsnede.
 * Data komt uit ./data (aan te maken met prepare_regis.py). Een andere map kan met ?data=pad.
 */
'use strict';
(() => {
  // ------------------------------------------------------------------ //
  // Basis: RD-projectie en kaart
  // ------------------------------------------------------------------ //
  const DATA = (new URLSearchParams(location.search).get('data') || 'data').replace(/\/$/, '');

  const RD = new L.Proj.CRS(
    'EPSG:28992',
    '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 ' +
      '+ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs',
    {
      resolutions: [3440.64, 1720.32, 860.16, 430.08, 215.04, 107.52, 53.76, 26.88, 13.44, 6.72, 3.36, 1.68, 0.84, 0.42, 0.21],
      bounds: L.bounds([-285401.92, 22598.08], [595401.92, 903401.92]),
      origin: [-285401.92, 903401.92],
    }
  );
  const rd2ll = (x, y) => RD.unproject(L.point(x, y));
  const ll2rd = (ll) => RD.project(ll);

  const map = L.map('kaart', {
    crs: RD, center: rd2ll(155000, 463000), zoom: 3, minZoom: 1, maxZoom: 13,
    zoomControl: true, attributionControl: false,
  });
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  const ACHTERGRONDEN = {
    grijs: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:28992/{z}/{x}/{y}.png',
    standaard: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:28992/{z}/{x}/{y}.png',
    luchtfoto: 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:28992/{z}/{x}/{y}.jpeg',
  };
  const BRO_BHRG = 'https://publiek.broservices.nl/sr/bhrg/v3/objects/';
  // hoofdgrondsoort (NEN 5104) -> kleur in boorstaten
  const BRO_CPT = 'https://publiek.broservices.nl/sr/cpt/v1/objects/';
  const BRO_BHRGT = 'https://publiek.broservices.nl/sr/bhrgt/v2/objects/';
  // 'siltig zand' komt alleen uit de interpretatie van sonderingen
  const GROND = { zand: '#f6d55c', 'siltig zand': '#d9c27a', klei: '#5b8c3a', leem: '#c8a96b', veen: '#6b4423', grind: '#e8913a', silt: '#b8c47f', overig: '#cfd4da' };

  // ------------------------------------------------------------------ //
  // Toestand
  // ------------------------------------------------------------------ //
  const S = {
    meta: null,
    lagen: [],               // meta.lagen, aangevuld
    perCode: new Map(),
    sel: null,               // geselecteerde laagcode
    modus: 'verbreiding',
    bereik: null,            // [lo, hi] in plotruimte (log10 voor log-modi)
    bereikHand: false,
    dekking: 0.8,
    diepte: 'alles',         // dieptebereik paneel: 'alles' of meters onder maaiveld
    overzicht: [],           // Uint8Array per laag (gepakte bits)
    cache: new Map(),        // key -> Promise<Int16Array>
    klaar: new Map(),        // key -> Int16Array
    overlay: null,
    renderToken: 0,
    achtergrond: null,
    boringen: null,          // kaartlaag met boringen als die aan staat
    peilbuizen: null,        // idem voor peilbuizen
    gebied: null,            // getekend gebied: {pts (RD), laag, fijn/grof: celmaskers}
    dsBuffer: 250,           // boringen in de doorsnede: max. afstand tot de lijn (m), 0 = uit
    teken: null,
    doorsnede: null,         // {pts, samples, lagen, mv, L}
    kolom: null,             // {x, y}
    paneelLagen: [],         // markers/lijnen bij paneel
    inBeeld: new Map(),      // code -> fractie
  };
  const ND = -32768;

  // ------------------------------------------------------------------ //
  // Namen en kleuren van REGIS-eenheden
  // ------------------------------------------------------------------ //
  const FORMATIES = {
    HL: 'Holoceen', BX: 'Boxtel', KR: 'Kreftenheye', BE: 'Beegden', KW: 'Koewacht', WB: 'Woudenberg',
    EE: 'Eem', DR: 'Drenthe', PE: 'Peelo', UR: 'Urk', ST: 'Sterksel', AP: 'Appelscha', SY: 'Stramproy',
    PZWA: 'Peize-Waalre', PZ: 'Peize', WA: 'Waalre', MS: 'Maassluis', KI: 'Kiezeloöliet', OO: 'Oosterhout',
    IE: 'Inden', BR: 'Breda', VE: 'Veldhoven', RU: 'Rupel', TO: 'Tongeren', DO: 'Dongen', LA: 'Landen',
    HT: 'Heijenrath', MT: 'Maastricht', GU: 'Gulpen', VA: 'Vaals', AK: 'Aken', VI: 'Ville', DN: 'Drachten',
    'PZ-WA': 'Peize-Waalre',
  };
  // laagpakketten (2 letters achter de formatiecode, bijv. KRZU = Kreftenheye, Laagpakket van Zutphen)
  const LEDEN = {
    ZU: 'Zutphen', TW: 'Twello', WY: 'Wijchen', GI: 'Gieten', UI: 'Uitdam', SC: 'Schaarsbergen',
    KO: 'Kootwijk', SI: 'Singraven', WI: 'Wierden', DE: 'Delwijnen', TY: 'Tynje', EL: 'Ell',
  };
  // eenheden zonder formatiecode
  const SPECIAAL = { hlc: 'Holocene afzettingen – complex', gsc: 'Gestuwd complex' };
  const LITHO = { z: 'zand', k: 'klei', c: 'complex', v: 'veen', b: 'bruinkool' };

  // REGIS-code ontleden; nieuwere versies zetten 'NU' voor de code (NUKRZUk1, NUPZ-WAz2, NUhlc)
  function ontleed(code) {
    const c = code.replace(/^NU(?=[A-Za-z])/, '');
    const m = /^([A-Z]+(?:-[A-Z]+)*)?([a-z]+)(\d*)$/.exec(c);
    if (!m) return { form: c, lid: '', litho: '', nr: '' };
    const [, hoofd, kl, nr] = m;
    if (!hoofd) return { form: kl.toUpperCase(), lid: '', litho: kl.slice(-1), nr, speciaal: SPECIAAL[kl] };
    let form = hoofd, lid = '';
    if (!FORMATIES[hoofd] && /^[A-Z]{4}$/.test(hoofd) && FORMATIES[hoofd.slice(0, 2)]) { form = hoofd.slice(0, 2); lid = hoofd.slice(2); }
    return { form, lid, litho: kl.slice(-1), nr };
  }
  function laagNaam(code) {
    const o = ontleed(code);
    if (o.speciaal) return o.speciaal + (o.nr ? ' ' + o.nr : '');
    let f = FORMATIES[o.form] || o.form;
    if (o.lid) f += ` (${LEDEN[o.lid] || o.lid})`;
    const l = LITHO[o.litho];
    return l ? `${f} – ${l}${o.nr ? ' ' + o.nr : ''}` : f;
  }
  function isScheidend(code) { const l = ontleed(code).litho; return l === 'k' || l === 'c' || l === 'v' || l === 'b'; }

  function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function hsl2rgb(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }
  // Conventie: watervoerend (zand) geel/oranje, scheidend (klei) groen, complex grijsblauw, veen bruin.
  function laagKleur(code) {
    const o = ontleed(code), h = hash(o.form), n = parseInt(o.nr || '1', 10);
    let H, Sa, Li;
    switch (o.litho) {
      case 'z': H = 34 + (h % 24); Sa = 68 + (h >> 4) % 22; Li = 64 - ((h >> 8) % 12) - (n - 1) * 6; break;
      case 'k': H = 88 + (h % 70); Sa = 30 + (h >> 4) % 25; Li = 44 + ((h >> 8) % 12) - (n - 1) * 4; break;
      case 'c': H = 205 + (h % 60); Sa = 14 + (h >> 4) % 16; Li = 58 + ((h >> 8) % 10); break;
      case 'v': H = 28; Sa = 42; Li = 30; break;
      case 'b': H = 22; Sa = 28; Li = 22; break;
      default: H = h % 360; Sa = 25; Li = 60;
    }
    Li = Math.max(22, Math.min(80, Li));
    const rgb = hsl2rgb(H, Sa, Li);
    return { rgb, css: `rgb(${rgb.join(',')})` };
  }

  // ------------------------------------------------------------------ //
  // Kleurschalen
  // ------------------------------------------------------------------ //
  function lutStops(hexes) {
    const c = hexes.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (c.length - 1), j = Math.min(Math.floor(t), c.length - 2), f = t - j;
      for (let k = 0; k < 3; k++) lut[i * 3 + k] = c[j][k] + (c[j + 1][k] - c[j][k]) * f;
    }
    return lut;
  }
  function lutTurbo() {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
      const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
      const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
      lut[i * 3] = r * 255; lut[i * 3 + 1] = g * 255; lut[i * 3 + 2] = b * 255;
    }
    return lut;
  }
  const LUT = {
    turbo: lutTurbo(),
    viridis: lutStops(['#440154', '#482878', '#3e4a89', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725']),
    magma: lutStops(['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf']),
  };

  // Weergavemodi. Waarden komen als ruwe int16 uit de tegel (zie prepare_regis.py).
  const MODI = {
    verbreiding: { eenheid: '' },
    top: { eenheid: 'm NAP', lut: 'turbo', log: false },
    basis: { eenheid: 'm NAP', lut: 'turbo', log: false },
    dikte: { eenheid: 'm', lut: 'viridis', log: false },
    kh: { eenheid: 'm/d', lut: 'viridis', log: true },
    kv: { eenheid: 'm/d', lut: 'viridis', log: true },
    c: { eenheid: 'd', lut: 'magma', log: true },
  };
  // waarde in plotruimte (log10 voor log-modi), of NaN
  function plotWaarde(modus, t, k, N) {
    const top = t[k];
    if (top === ND) return NaN;
    switch (modus) {
      case 'top': return top / 10;
      case 'basis': return (top - t[N + k]) / 10;
      case 'dikte': return t[N + k] / 10;
      case 'kh': return t[2 * N + k] === ND ? NaN : t[2 * N + k] / 1000;
      case 'kv': return t[3 * N + k] === ND ? NaN : t[3 * N + k] / 1000;
      case 'c': {
        const kv = t[3 * N + k], d = t[N + k];
        return kv === ND || d <= 0 ? NaN : Math.log10(d / 10) - kv / 1000;
      }
    }
    return NaN;
  }
  function celWaarden(t, k, N) {
    const top = t[k];
    if (top === ND) return null;
    const dik = t[N + k] / 10, kh = t[2 * N + k], kv = t[3 * N + k];
    const o = { top: top / 10, dikte: dik, basis: top / 10 - dik,
      kh: kh === ND ? null : 10 ** (kh / 1000), kv: kv === ND ? null : 10 ** (kv / 1000) };
    o.c = o.kv ? dik / o.kv : null;
    return o;
  }

  // ------------------------------------------------------------------ //
  // Opmaak
  // ------------------------------------------------------------------ //
  const nf1 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
  const fm = (v) => (v == null || !isFinite(v) ? '–' : nf1.format(v));
  const fmNAP = (v) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + nf1.format(v));
  function fmK(v) {
    if (v == null || !isFinite(v)) return '–';
    if (v >= 100) return nf0.format(v);
    if (v >= 1) return new Intl.NumberFormat('nl-NL', { maximumSignificantDigits: 3 }).format(v);
    return new Intl.NumberFormat('nl-NL', { maximumSignificantDigits: 2 }).format(v);
  }
  const fmRD = (v) => nf0.format(Math.round(v));
  function fmModus(modus, plotv) {
    if (!isFinite(plotv)) return '–';
    const m = MODI[modus];
    if (m.log) return `${fmK(10 ** plotv)} ${m.eenheid}`;
    return modus === 'dikte' ? `${fm(plotv)} m` : `${fmNAP(plotv)} m NAP`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const $ = (id) => document.getElementById(id);
  function melding(html, ms = 0) {
    const el = $('melding');
    el.innerHTML = html; el.hidden = false;
    clearTimeout(melding.t);
    if (ms) melding.t = setTimeout(() => (el.hidden = true), ms);
  }
  function voortgang(f) {
    const el = $('voortgang');
    if (f == null || f >= 1) { el.firstElementChild.style.width = '100%'; setTimeout(() => (el.hidden = true), 200); return; }
    el.hidden = false; el.firstElementChild.style.width = Math.max(4, f * 100) + '%';
  }

  // ------------------------------------------------------------------ //
  // Data laden
  // ------------------------------------------------------------------ //
  async function ontpak(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0x1f && u8[1] === 0x8b) {
      const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    return u8; // server heeft al uitgepakt (Content-Encoding)
  }
  // omkering van codeer_tegel(): byte-split ongedaan maken en rij-delta optellen (modulo 2^16)
  function decodeerTegel(u8, T) {
    const n = u8.length >> 1, out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const d = ((u8[i] | (u8[n + i] << 8)) << 16) >> 16;
      out[i] = i % T === 0 ? d : out[i - 1] + d;
    }
    return out;
  }
  function laadTegel(code, tx, ty) {
    const key = `${code}/${tx}_${ty}`;
    if (S.cache.has(key)) return S.cache.get(key);
    const p = fetch(`${DATA}/l/${encodeURIComponent(code)}/${tx}_${ty}.bin.gz`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status} ${key}`); return r.arrayBuffer(); })
      .then(ontpak)
      .then((u8) => { const t = decodeerTegel(u8, S.meta.tegel); S.klaar.set(key, t); return t; })
      .catch((e) => { S.cache.delete(key); throw e; });
    S.cache.set(key, p);
    return p;
  }
  async function pool(items, n, fn, opVoortgang) {
    const res = new Array(items.length); let i = 0, klaar = 0;
    async function werker() {
      while (i < items.length) {
        const j = i++;
        try { res[j] = await fn(items[j]); } catch (e) { res[j] = null; console.warn(e); }
        klaar++; if (opVoortgang) opVoortgang(klaar / items.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, werker));
    return res;
  }

  // rastercoördinaten
  const kolomVan = (x) => Math.floor((x - S.meta.x0) / S.meta.cel);
  const rijVan = (y) => Math.floor((S.meta.y0 - y) / S.meta.cel);
  const binnen = (c, r) => c >= 0 && r >= 0 && c < S.meta.nx && r < S.meta.ny;
  function overzichtBit(i, c, r) {
    const G = S.meta.grof, cc = Math.floor(c / G), rr = Math.floor(r / G), idx = rr * S.meta.cnx + cc;
    return (S.overzicht[i][idx >> 3] >> (7 - (idx & 7))) & 1;
  }
  function laagOpCel(laag, c, r) {
    const b = laag.bbox;
    return c >= b[0] && c < b[2] && r >= b[1] && r < b[3] && overzichtBit(laag.i, c, r) &&
      laag.tegelSet.has(`${Math.floor(c / S.meta.tegel)}_${Math.floor(r / S.meta.tegel)}`);
  }
  // waarden van een laag in een cel; tegel moet al geladen zijn
  function celUitCache(code, c, r) {
    const T = S.meta.tegel, t = S.klaar.get(`${code}/${Math.floor(c / T)}_${Math.floor(r / T)}`);
    if (!t) return undefined;
    return celWaarden(t, (r % T) * T + (c % T), T * T);
  }

  // ------------------------------------------------------------------ //
  // Laag tekenen
  // ------------------------------------------------------------------ //
  // kleurbereik (2–98 percentiel); met een gebied alleen over de cellen daarbinnen
  function berekenBereik(modus, tegels, coords) {
    const T = S.meta.tegel, N = T * T, nx = S.meta.nx, ny = S.meta.ny, vals = [], gmask = S.gebied?.fijn;
    const stap = Math.max(1, Math.floor((tegels.length * N) / 60000));
    tegels.forEach((t, n) => {
      if (!t) return;
      const [tx, ty] = coords[n];
      for (let k = 0; k < N; k += stap) {
        if (gmask) {
          const r = ty * T + Math.floor(k / T), c = tx * T + (k % T);
          if (r >= ny || c >= nx || !gmask[r * nx + c]) continue;
        }
        const v = plotWaarde(modus, t, k, N);
        if (isFinite(v)) vals.push(v);
      }
    });
    if (!vals.length) return [0, 1];
    vals.sort((a, b) => a - b);
    let lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.98))];
    if (!MODI[modus].log) { lo = Math.floor(lo); hi = Math.ceil(hi); }
    if (hi - lo < 1e-6) { lo -= MODI[modus].log ? 0.5 : 1; hi += MODI[modus].log ? 0.5 : 1; }
    return [lo, hi];
  }

  async function tekenLaag() {
    const token = ++S.renderToken;
    const laag = S.perCode.get(S.sel);
    if (!laag) {
      if (S.overlay) { map.removeLayer(S.overlay); S.overlay = null; }
      werkLegendaBij();
      tekenBoringen(); tekenPeilbuizen();
      return;
    }
    const { tegel: T, cel, x0, y0 } = S.meta, N = T * T, modus = S.modus;
    const tegels = await pool(laag.tegels, 6, ([tx, ty]) => laadTegel(laag.code, tx, ty), voortgang);
    voortgang(1);
    if (token !== S.renderToken) return;
    if (tegels.some((t) => t === null)) melding('Niet alle tegels konden worden geladen; zie de console.', 5000);

    if (modus !== 'verbreiding' && !S.bereikHand) S.bereik = berekenBereik(modus, tegels, laag.tegels);
    werkLegendaBij();
    tekenBoringen(); tekenPeilbuizen();
    if (S.doorsnede?.putten.length) tekenDoorsnede();  // filtermarkering hangt af van de nu geladen tegels

    const [b0, b1, b2, b3] = laag.bbox, w = b2 - b0, h = b3 - b1;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), px = img.data;
    const lut = modus === 'verbreiding' ? null : LUT[MODI[modus].lut];
    const [lo, hi] = S.bereik || [0, 1], schaal = 255 / (hi - lo || 1);
    const kl = laag.kleur.rgb, gmask = S.gebied?.fijn;
    laag.tegels.forEach(([tx, ty], n) => {
      const t = tegels[n];
      if (!t) return;
      for (let r = 0; r < T; r++) {
        const rij = ty * T + r - b1;
        if (rij < 0 || rij >= h) continue;
        for (let c = 0; c < T; c++) {
          const kol = tx * T + c - b0;
          if (kol < 0 || kol >= w) continue;
          const k = r * T + c;
          if (t[k] === ND || (gmask && !gmask[(ty * T + r) * S.meta.nx + tx * T + c])) continue;
          const o = (rij * w + kol) * 4;
          if (!lut) { px[o] = kl[0]; px[o + 1] = kl[1]; px[o + 2] = kl[2]; px[o + 3] = 255; continue; }
          const v = plotWaarde(modus, t, k, N);
          if (!isFinite(v)) { px[o] = 160; px[o + 1] = 160; px[o + 2] = 160; px[o + 3] = 150; continue; }
          const li = Math.max(0, Math.min(255, Math.round((v - lo) * schaal))) * 3;
          px[o] = lut[li]; px[o + 1] = lut[li + 1]; px[o + 2] = lut[li + 2]; px[o + 3] = 255;
        }
      }
    });
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((res) => cv.toBlob(res));
    if (token !== S.renderToken) return;
    const url = URL.createObjectURL(blob);
    const bounds = L.bounds([x0 + b0 * cel, y0 - b3 * cel], [x0 + b2 * cel, y0 - b1 * cel]);
    if (S.overlay) { const oud = S.overlay._url; map.removeLayer(S.overlay); URL.revokeObjectURL(oud); }
    S.overlay = L.Proj.imageOverlay(url, bounds, { opacity: S.dekking, className: 'raster', interactive: false }).addTo(map);
    S.overlay.bringToFront();
  }

  function werkLegendaBij() {
    const leg = $('legenda');
    if (!S.sel || S.modus === 'verbreiding' || !S.bereik) { leg.hidden = true; return; }
    leg.hidden = false;
    const m = MODI[S.modus], lut = LUT[m.lut], cv = $('legenda-balk'), ctx = cv.getContext('2d');
    for (let i = 0; i < 256; i++) { ctx.fillStyle = `rgb(${lut[i * 3]},${lut[i * 3 + 1]},${lut[i * 3 + 2]})`; ctx.fillRect(i, 0, 1, 12); }
    const naarTekst = (v) => (m.log ? +(10 ** v).toPrecision(2) : +v.toFixed(1));
    $('leg-min').value = naarTekst(S.bereik[0]);
    $('leg-max').value = naarTekst(S.bereik[1]);
    $('leg-eenheid').textContent = m.eenheid + (m.log ? ' (log)' : '');
  }

  // ------------------------------------------------------------------ //
  // Lagenlijst
  // ------------------------------------------------------------------ //
  function berekenInBeeld() {
    if (S.gebied) return berekenInGebied();
    const m = S.meta, G = m.grof, b = map.getBounds();
    const ps = [b.getNorthWest(), b.getNorthEast(), b.getSouthWest(), b.getSouthEast()].map(ll2rd);
    const xmin = Math.min(...ps.map((p) => p.x)), xmax = Math.max(...ps.map((p) => p.x));
    const ymin = Math.min(...ps.map((p) => p.y)), ymax = Math.max(...ps.map((p) => p.y));
    const gc = m.cel * G;
    const c0 = Math.max(0, Math.floor((xmin - m.x0) / gc)), c1 = Math.min(m.cnx - 1, Math.floor((xmax - m.x0) / gc));
    const r0 = Math.max(0, Math.floor((m.y0 - ymax) / gc)), r1 = Math.min(m.cny - 1, Math.floor((m.y0 - ymin) / gc));
    S.inBeeld.clear();
    if (c1 < c0 || r1 < r0) return;
    const totaal = (c1 - c0 + 1) * (r1 - r0 + 1);
    for (const laag of S.lagen) {
      const bb = laag.bbox;
      if (bb[2] / G < c0 || bb[0] / G > c1 + 1 || bb[3] / G < r0 || bb[1] / G > r1 + 1) continue;
      const bits = S.overzicht[laag.i];
      let n = 0;
      for (let r = r0; r <= r1; r++) {
        let idx = r * m.cnx + c0;
        for (let c = c0; c <= c1; c++, idx++) n += (bits[idx >> 3] >> (7 - (idx & 7))) & 1;
      }
      if (n) S.inBeeld.set(laag.code, n / totaal);
    }
  }

  // als berekenInBeeld, maar over de grove cellen binnen het getekende gebied
  function berekenInGebied() {
    const { grof, nGrof } = S.gebied;
    S.inBeeld.clear();
    for (const laag of S.lagen) {
      const bits = S.overzicht[laag.i];
      let n = 0;
      for (let idx = 0; idx < grof.length; idx++) if (grof[idx] && (bits[idx >> 3] >> (7 - (idx & 7))) & 1) n++;
      if (n) S.inBeeld.set(laag.code, n / nGrof);
    }
  }

  function tekenLijst() {
    const ol = $('lagen'), q = $('zoek').value.trim().toLowerCase(), alleen = $('alleen-in-beeld').checked;
    const items = S.lagen.filter((l) => {
      if (q && !(l.code.toLowerCase().includes(q) || l.naam.toLowerCase().includes(q))) return false;
      if (alleen && !S.inBeeld.has(l.code) && l.code !== S.sel) return false;
      return true;
    });
    $('lagen-teller').textContent = `${S.inBeeld.size} in ${S.gebied ? 'gebied' : 'beeld'} / ${S.lagen.length}`;
    ol.replaceChildren(...items.map((l) => {
      const f = S.inBeeld.get(l.code) || 0;
      const li = document.createElement('li');
      li.className = 'laag' + (f ? '' : ' buiten');
      li.tabIndex = 0;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', l.code === S.sel ? 'true' : 'false');
      li.dataset.code = l.code;
      li.title = `${l.code} — ${l.naam}\n${f ? Math.round(f * 100) + (S.gebied ? '% van het gebied' : '% van het kaartbeeld') : S.gebied ? 'niet in het gebied' : 'niet in beeld'}`;
      li.innerHTML = `<span class="kleur" style="background:${l.kleur.css}"></span>
        <span class="code">${esc(l.code)}</span><span class="naam">${esc(l.naam)}</span>
        <span class="dek"><i style="width:${Math.max(f ? 4 : 0, Math.round(f * 100))}%"></i></span>`;
      return li;
    }));
    if (!items.length) ol.innerHTML = `<li class="leeg">${q ? 'Geen lagen gevonden.' : S.gebied ? 'Geen lagen in dit gebied.' : 'Geen lagen in dit kaartbeeld.'}</li>`;
  }

  function kiesLaag(code) {
    S.sel = S.sel === code ? null : code;
    S.bereikHand = false;
    tekenLijst();
    tekenLaag();
    if (S.doorsnede) tekenDoorsnede();
    if (S.kolom?.rijen) tekenKolom();  // rode band van de gekozen laag verplaatsen
    schrijfHash();
  }

  // ------------------------------------------------------------------ //
  // Paneel
  // ------------------------------------------------------------------ //
  function openPaneel(titel, acties, inhoud) {
    $('paneel-titel').innerHTML = titel;
    $('paneel-acties').replaceChildren(...acties);
    $('paneel-inhoud').replaceChildren(inhoud);
    $('paneel').hidden = false;
  }
  function wisPaneelLagen() { S.paneelLagen.forEach((l) => map.removeLayer(l)); S.paneelLagen = []; }
  function sluitPaneel() {
    $('paneel').hidden = true;
    wisPaneelLagen();
    S.doorsnede = null; S.kolom = null;
    $('tip').hidden = true;
    schrijfHash();
  }
  // doel: kolom of doorsnede met boringen; dan is 'tot einde boring' de standaard en geldt de keuze alleen daarvoor
  function diepteKeuze(opWijzig, doel, tekst = 'tot einde boring') {
    const lab = document.createElement('label');
    lab.innerHTML = `Diepte <select>${doel ? `<option value="boring">${tekst}</option>` : ''}
      <option value="alles">alles</option>${[300, 150, 100, 75, 50, 30, 10, 5].map((d) => `<option value="${d}">tot ${d} m –mv</option>`).join('')}</select>`;
    const sel = lab.querySelector('select');
    sel.value = doel ? doel.diepte || 'boring' : S.diepte;
    sel.onchange = () => { if (doel) doel.diepte = sel.value; else S.diepte = sel.value; opWijzig(); };
    return lab;
  }
  function niceTicks(lo, hi, n) {
    const ruw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(ruw));
    const stap = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= ruw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / stap) * stap; v <= hi + 1e-9; v += stap) out.push(+v.toFixed(6));
    return out;
  }
  function svgEl(tag, attrs, ouder) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (ouder) ouder.appendChild(el);
    return el;
  }
  function toonTip(html, ev) {
    const tip = $('tip'), hoofd = $('hoofd').getBoundingClientRect();
    tip.innerHTML = html; tip.hidden = false;
    let x = ev.clientX - hoofd.left + 14, y = ev.clientY - hoofd.top + 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > hoofd.width - 8) x = ev.clientX - hoofd.left - w - 14;
    if (y + h > hoofd.height - 8) y = ev.clientY - hoofd.top - h - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  // ------------------------------------------------------------------ //
  // Kolom op een punt
  // ------------------------------------------------------------------ //
  // extra: { boring } of { put } om een boring of peilbuis naast de REGIS-kolom te tonen; terug = punten van de doorsnede
  async function toonKolom(x, y, extra = {}) {
    const c = kolomVan(x), r = rijVan(y);
    if (!binnen(c, r)) { melding('Dit punt ligt buiten het gebied met REGIS-data.', 3000); return; }
    S.doorsnede = null;
    wisPaneelLagen();
    const xc = S.meta.x0 + (c + 0.5) * S.meta.cel, yc = S.meta.y0 - (r + 0.5) * S.meta.cel;
    const kolom = S.kolom = extra.boring || extra.put ? { x, y, ...extra } : { x: xc, y: yc };
    const kleur = extra.boring ? '#d6336c' : extra.put ? PEIL : '#18212b';
    const mk = L.circleMarker(rd2ll(x, y), { radius: 6, color: '#fff', weight: 2, fillColor: kleur, fillOpacity: 1, pane: 'boringen' }).addTo(map);
    S.paneelLagen.push(mk);
    schrijfHash();
    if (extra.boring) {
      laadProfielVan(extra.boring).then((p) => p, (e) => ({ fout: e.message })).then((p) => {
        kolom.profiel = p;
        if (S.kolom === kolom && kolom.rijen) tekenKolom();
      });
    }

    const kand = S.lagen.filter((l) => laagOpCel(l, c, r));
    const T = S.meta.tegel;
    await Promise.all([
      pool(kand, 8, (l) => laadTegel(l.code, Math.floor(c / T), Math.floor(r / T))),
      S.meta.boringen ? laadBoringen().catch(() => null) : null,
      S.meta.sonderingen && SON.groep ? laadSonderingen().catch(() => null) : null,
      S.meta.peilbuizen ? laadPeilbuizen().catch(() => null) : null,
    ]);
    if (S.kolom !== kolom) return;
    kolom.rijen = kand.map((l) => ({ laag: l, v: celUitCache(l.code, c, r) })).filter((o) => o.v);
    tekenKolom();
  }

  function tekenKolom() {
    const { x, y, rijen, boring: b, put, profiel } = S.kolom;
    const wrap = document.createElement('div');
    wrap.className = 'kolom-wrap';
    const tabelDiv = document.createElement('div');
    tabelDiv.className = 'kolom-tabel';
    const mv = rijen.length ? Math.max(...rijen.map((o) => o.v.top)) : null;
    const acties = [diepteKeuze(tekenKolom, (b || put) && S.kolom, put ? 'tot diepste filter' : b && isCpt(b) ? 'tot einde sondering' : undefined)];
    if (S.kolom.terug) {
      const pts = S.kolom.terug;
      const k = Object.assign(document.createElement('button'), { className: 'knop klein licht', textContent: '← Doorsnede' });
      k.onclick = () => maakDoorsnede(pts);
      acties.unshift(k);
    }
    openPaneel(b
      ? `${isCpt(b) ? 'Sondering' : isGt(b) ? 'Geotechnische boring' : 'Boring'} ${esc(b.id)} <span style="color:var(--zacht);font-weight:400">· ${fmRD(x)}, ${fmRD(y)} (RD) · maaiveld ${fmNAP(b.mv)} m NAP · ${fm(b.diepte)} m diep${b.jaar ? ' · ' + b.jaar : ''}</span>`
      : put
        ? `Peilbuis ${esc(putNaam(put))} <span style="color:var(--zacht);font-weight:400">· ${fmRD(x)}, ${fmRD(y)} (RD) · maaiveld ${fmNAP(put.mv)} m NAP · ${put.filters.length} filter${put.filters.length === 1 ? '' : 's'}</span>`
        : `Kolom op ${fmRD(x)}, ${fmRD(y)} <span style="color:var(--zacht);font-weight:400">(RD) · maaiveld ${fmNAP(mv)} m NAP · ${rijen.length} lagen</span>`,
    acties, wrap);
    // linkerkolom: boorstaat of peilbuis, van bTop tot bBasis (m NAP)
    const bTop = b ? b.mv : put ? put.mv ?? mv ?? Math.max(...put.filters.map((f) => f.top)) : null;
    const bBasis = b ? b.basis : put ? put.basis : null;
    if (!rijen.length && bTop == null) { wrap.innerHTML = '<div class="leeg">Geen REGIS-lagen op dit punt.</div>'; return; }

    // SVG-kolom; bij een boring of peilbuis staat die links van REGIS, bij een sondering met de qc/Rf-grafiek ertussen
    const gw = b && isCpt(b) ? 92 : 0, gx = 48 + 30 + 6;  // grafiek: breedte en linkerrand
    const H = Math.max(160, $('paneel-inhoud').clientHeight || 300), W = (bTop != null ? 214 : 170) + gw;
    const xr = (bTop != null ? 86 : 48) + gw, wr = bTop != null ? 64 : 76, xb = 48, wb = 30;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    svg.style.flex = `0 0 ${W}px`;
    wrap.append(svg, tabelDiv);
    const diepte = b || put ? S.kolom.diepte || 'boring' : S.diepte;
    const ztop = Math.max(...[mv, bTop].filter((v) => v != null));
    let zbodem = Math.min(...[...rijen.map((o) => o.v.basis), bBasis].filter((v) => v != null));
    if (diepte === 'boring' && bBasis != null) zbodem = Math.max(zbodem, bBasis - Math.max(5, (bTop - bBasis) * 0.25));
    else if (diepte !== 'alles' && diepte !== 'boring') zbodem = Math.max(zbodem, ztop - +diepte);
    if (!(ztop > zbodem)) zbodem = ztop - 10;
    const m = { t: bTop != null ? 22 : 12, b: 12 }, sy = (z) => m.t + ((ztop - z) / (ztop - zbodem)) * (H - m.t - m.b);
    const as = svgEl('g', {}, svg);
    for (const z of niceTicks(zbodem, ztop, 6)) {
      svgEl('line', { x1: 44, x2: xr + wr + 4, y1: sy(z), y2: sy(z), stroke: '#e3e7ec' }, as);
      const t = svgEl('text', { x: 40, y: sy(z) + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: '#5a6675', 'font-family': 'system-ui, sans-serif' }, as);
      t.textContent = (z > 0 ? '+' : '') + z;
    }
    if (bTop != null) {
      const koppen = [[xb + wb / 2, put ? 'put' : b && isCpt(b) ? 'interpr.' : 'boring', '#5a6675'], [xr + wr / 2, 'REGIS', '#5a6675']];
      if (gw) koppen.push([gx + 20, 'qc 0–20', '#18212b'], [gx + 64, 'Rf 0–10', '#e03131']);
      for (const [tx, tekst, kleur] of koppen) {
        Object.assign(svgEl('text', { x: tx, y: 13, 'text-anchor': 'middle', 'font-size': gw && tekst.includes('–') ? 9.5 : 10.5, fill: kleur, 'font-family': 'system-ui, sans-serif' }, svg), { textContent: tekst });
      }
    }
    const clip = svgEl('clipPath', { id: 'kclip' }, svgEl('defs', {}, svg));
    svgEl('rect', { x: 0, y: m.t, width: W, height: H - m.t - m.b }, clip);
    const g = svgEl('g', { 'clip-path': 'url(#kclip)' }, svg);
    if (put) {
      svgEl('line', { x1: xb + wb / 2, x2: xb + wb / 2, y1: sy(bTop), y2: sy(bBasis), stroke: '#8a96a3', 'stroke-width': 2 }, g);
      for (const f of put.filters) {
        const y1 = sy(f.top), y2 = sy(f.bot);
        const rect = svgEl('rect', { x: xb + 7, y: y1, width: wb - 14, height: Math.max(2, y2 - y1), fill: PEIL, stroke: '#0b4f8a', 'stroke-width': 0.8 }, g);
        rect.addEventListener('mousemove', (ev) => toonTip(`<b>filter ${f.nr}</b><br>${fmNAP(f.top)} tot ${fmNAP(f.bot)} m NAP`, ev));
        rect.addEventListener('mouseleave', () => ($('tip').hidden = true));
        if (put.filters.length > 1) {
          Object.assign(svgEl('text', { x: xb + 2, y: (y1 + y2) / 2 + 3.5, 'text-anchor': 'end', 'font-size': 9.5, fill: PEIL, 'font-family': 'system-ui, sans-serif' }, g), { textContent: f.nr });
        }
      }
    } else if (bTop != null) {
      const lagen = profiel?.lagen;
      if (lagen) {
        for (const l of lagen) {
          const y1 = sy(bTop - l.van), y2 = sy(bTop - l.tot);
          const rect = svgEl('rect', { x: xb, y: y1, width: wb, height: Math.max(0.6, y2 - y1), fill: GROND[l.hoofd] }, g);
          rect.addEventListener('mousemove', (ev) => toonTip(`${esc(leesbaar(l.naam) || 'onbekend')}<br><span class="grijs">${fm(l.van)}–${fm(l.tot)} m –mv · ${fmNAP(bTop - l.van)} tot ${fmNAP(bTop - l.tot)} m NAP</span>`, ev));
          rect.addEventListener('mouseleave', () => ($('tip').hidden = true));
        }
      }
      svgEl('rect', { x: xb, y: sy(bTop), width: wb, height: sy(bBasis) - sy(bTop), fill: lagen ? 'none' : '#eef1f4',
        stroke: '#18212b', 'stroke-width': 1, 'stroke-dasharray': lagen ? '' : '3 2', 'pointer-events': 'none' }, g);
      // sondering: qc (0–20 MPa, zwart) en Rf (0–10 %, rood) als lijnen
      if (gw && profiel?.meting?.length) {
        const gb = gw - 12;
        svgEl('rect', { x: gx, y: sy(bTop), width: gb, height: sy(bBasis) - sy(bTop), fill: '#fafbfc', stroke: '#dfe3e8' }, g);
        for (const f of [0.25, 0.5, 0.75]) svgEl('line', { x1: gx + gb * f, x2: gx + gb * f, y1: sy(bTop), y2: sy(bBasis), stroke: '#eef1f4' }, g);
        const lijn = (veld, max) => profiel.meting.map((q, i) => `${i ? 'L' : 'M'}${(gx + Math.min(1, q[veld] / max) * gb).toFixed(1)},${sy(bTop - q.z).toFixed(1)}`).join('');
        svgEl('path', { d: lijn('qc', 20), fill: 'none', stroke: '#18212b', 'stroke-width': 1 }, g);
        svgEl('path', { d: lijn('rf', 10), fill: 'none', stroke: '#e03131', 'stroke-width': 1 }, g);
        const vang = svgEl('rect', { x: gx, y: sy(bTop), width: gb, height: sy(bBasis) - sy(bTop), fill: 'transparent' }, g);
        vang.addEventListener('mousemove', (ev) => {
          const z = ztop - ((ev.clientY - svg.getBoundingClientRect().top - m.t) / (H - m.t - m.b)) * (ztop - zbodem), q = cptOpDiepte(profiel, bTop - z);
          if (q) toonTip(`${fm(q.z)} m –mv (${fmNAP(bTop - q.z)} m NAP)<br>qc ${fm(q.qc)} MPa · Rf ${fm(q.rf)} %<br><span class="grijs">${esc(CPT_NAAM[cptKlasse(q.qc, q.rf)])} (interpretatie)</span>`, ev);
        });
        vang.addEventListener('mouseleave', () => ($('tip').hidden = true));
      }
    }
    for (const o of rijen) {
      const y1 = sy(o.v.top), y2 = sy(o.v.basis);
      if (y1 > H - m.b) continue;
      const rect = svgEl('rect', { x: xr, y: y1, width: wr, height: Math.max(0.6, y2 - y1), fill: o.laag.kleur.css,
        stroke: o.laag.code === S.sel ? '#111' : 'rgba(255,255,255,.8)', 'stroke-width': o.laag.code === S.sel ? 1.6 : 0.6, 'data-code': o.laag.code }, g);
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => kiesLaag(o.laag.code));
      rect.addEventListener('mousemove', (ev) => toonTip(`<b>${esc(o.laag.code)}</b> ${esc(o.laag.naam)}<br>${fmNAP(o.v.top)} tot ${fmNAP(o.v.basis)} m NAP`, ev));
      rect.addEventListener('mouseleave', () => ($('tip').hidden = true));
      if (y2 - y1 > 13) {
        const t = svgEl('text', { x: xr + wr + 8, y: (Math.max(y1, m.t) + Math.min(y2, H - m.b)) / 2 + 4, 'font-size': 10.5, 'font-family': 'ui-monospace, monospace', fill: '#18212b' }, g);
        t.textContent = o.laag.code;
      }
    }
    // gekozen laag: rode band over boring/put en REGIS, met minimale hoogte zodat dunne lagen opvallen
    const selRij = rijen.find((o) => o.laag.code === S.sel);
    if (selRij) {
      const ROOD = '#e03131', MIN = 5;
      let y1 = sy(selRij.v.top), y2 = sy(selRij.v.basis);
      if (y2 - y1 < MIN) { const mid = (y1 + y2) / 2; y1 = mid - MIN / 2; y2 = mid + MIN / 2; }
      const band = svgEl('g', { 'pointer-events': 'none' }, g);
      // strepen alleen waar de boring/put de laag doorsnijdt
      const s1 = bTop != null ? Math.max(y1, sy(bTop)) : 0, s2 = bTop != null ? Math.min(y2, sy(bBasis)) : 0;
      if (s2 > s1) {
        const pat = svgEl('pattern', { id: 'kstreep', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg.querySelector('defs'));
        svgEl('rect', { width: 2.2, height: 6, fill: ROOD }, pat);
        svgEl('rect', { x: xb, y: s1, width: wb, height: s2 - s1, fill: 'url(#kstreep)', stroke: ROOD, 'stroke-width': 2 }, band);
      }
      for (const yy of [y1, y2]) {
        svgEl('line', { x1: bTop != null ? xb - 4 : xr - 4, x2: xr + wr + 4, y1: yy, y2: yy, stroke: ROOD, 'stroke-width': 1.5, 'stroke-dasharray': '4 2' }, band);
      }
      svgEl('rect', { x: xr, y: y1, width: wr, height: y2 - y1, fill: 'none', stroke: ROOD, 'stroke-width': 2 }, band);
    }

    // tabel
    const heeftK = S.meta.heeft_k;
    tabelDiv.innerHTML = `<table><thead><tr><th>Laag</th><th>Naam</th><th>Top</th><th>Basis</th><th>Dikte</th>
      ${heeftK ? '<th>kh (m/d)</th><th>kv (m/d)</th><th>c (d)</th>' : ''}</tr></thead><tbody>${rijen.map((o) => `
      <tr class="klik" data-code="${esc(o.laag.code)}">
        <td class="code"><span class="kleur" style="background:${o.laag.kleur.css}"></span>${esc(o.laag.code)}</td>
        <td>${esc(o.laag.naam)}</td><td class="num">${fmNAP(o.v.top)}</td><td class="num">${fmNAP(o.v.basis)}</td>
        <td class="num">${fm(o.v.dikte)}</td>
        ${heeftK ? `<td class="num">${fmK(o.v.kh)}</td><td class="num">${fmK(o.v.kv)}</td><td class="num">${isScheidend(o.laag.code) ? fmK(o.v.c) : '<span style="color:#aab">' + fmK(o.v.c) + '</span>'}</td>` : ''}
      </tr>`).join('')}</tbody></table>`;
    if (b) tabelDiv.insertAdjacentHTML('afterbegin', isCpt(b) ? sonderingHtml(b, profiel) : boorstaatHtml(b, profiel));
    else if (put) tabelDiv.insertAdjacentHTML('afterbegin', putHtml(put, rijen));
    else tabelDiv.insertAdjacentHTML('beforeend', boringenBijHtml(x, y));
    tabelDiv.querySelectorAll('tr.klik[data-code]').forEach((tr) => tr.addEventListener('click', () => kiesLaag(tr.dataset.code)));
    tabelDiv.querySelectorAll('tr.klik[data-bor]').forEach((tr) => tr.addEventListener('click', () => toonBoring(zoekBoorpunt(tr.dataset.bor))));
    tabelDiv.querySelectorAll('tr.klik[data-put]').forEach((tr) => tr.addEventListener('click', () => toonPut(P.perId.get(tr.dataset.put))));
    markeerKolomRij();
  }
  function markeerKolomRij() {
    document.querySelectorAll('.kolom-tabel tr.klik[data-code]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.code === S.sel));
    document.querySelectorAll('.kolom-wrap rect[data-code]').forEach((r) => {
      const s = r.dataset.code === S.sel;
      r.setAttribute('stroke', s ? '#111' : 'rgba(255,255,255,.8)'); r.setAttribute('stroke-width', s ? 1.6 : 0.6);
    });
  }

  // ------------------------------------------------------------------ //
  // BRO-boringen (BHR-G) en -sonderingen (CPT): lijst uit data/*.json, profiel live uit de BRO.
  // Beide gebruiken dezelfde kaartweergave en laagfilter; sonderingen zijn driehoekjes.
  // ------------------------------------------------------------------ //
  map.createPane('boringen').style.zIndex = 450;
  const bron = (soort, bestand, el) => ({ soort, bestand, el, min: 10, alleenLaag: true, lijst: null, perId: new Map(), laden: null, profielen: new Map(), groep: null });
  const B = bron('bhr', 'boringen', { knop: 'btn-boringen', blok: 'boringen-blok', teller: 'boringen-teller', laag: 'bor-laag', legenda: 'bor-legenda' });
  const SON = bron('cpt', 'sonderingen', { knop: 'btn-sonderingen', blok: 'sonderingen-blok', teller: 'son-teller', laag: 'son-laag', legenda: 'son-legenda' });
  B.renderer = L.canvas({ pane: 'boringen', padding: 0.3 });
  const isCpt = (b) => b.soort === 'cpt';
  const bronVan = (b) => (isCpt(b) ? SON : B);

  // hoofdgrondsoort = laatste woord, na weglaten van een toevoeging als 'MetGrind' (BHR-GT: kleiigZandMetGrind -> zand)
  const hoofdGrond = (naam) => (/(grind|zand|leem|klei|veen|silt)$/i.exec((naam || '').replace(/Met[A-Z]\w*$/, ''))?.[1].toLowerCase()) || 'overig';
  const leesbaar = (s) => (s || '').replace(/NEN5104/g, '').replace(/([A-Z])/g, ' $1').toLowerCase().trim();

  function laadBron(br) {
    if (!br.laden) {
      br.laden = fetch(`${DATA}/${br.bestand}.json`)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((j) => {
          // type (alleen boringen): 'g' = geologisch (BHR-G), 'gt' = geotechnisch (BHR-GT)
          br.lijst = j[br.bestand].map(([id, x, y, mv, diepte, jaar, type]) => ({ id, x, y, mv, diepte, jaar, type, soort: br.soort, basis: mv == null ? null : mv - diepte }));
          br.lijst.forEach((b) => br.perId.set(b.id, b));
          return br.lijst;
        })
        .catch((e) => { br.laden = null; throw e; });
    }
    return br.laden;
  }
  const laadBoringen = () => laadBron(B), laadSonderingen = () => laadBron(SON);
  const laadProfielVan = (b) => (isCpt(b) ? laadSondering(b.id) : laadProfiel(b));
  const isGt = (b) => b.type === 'gt';
  const boorUrl = (b) => (isGt(b) ? BRO_BHRGT : BRO_BHRG) + encodeURIComponent(b.id);
  const soortNaam = (b) => (isCpt(b) ? 'sondering' : isGt(b) ? 'geotechnische boring' : 'geologische boring');
  const zoekBoorpunt = (id) => B.perId.get(id) || SON.perId.get(id);

  // boorbeschrijving van een BHR-G of BHR-GT. BHR-G nest <layer><Layer>…, BHR-GT heeft direct <layer>…;
  // BHR-G gebruikt soilNameNEN5104, BHR-GT geotechnicalSoilName (NEN-EN-ISO 14688).
  function laadProfiel(b) {
    const id = b.id;
    if (!B.profielen.has(id)) {
      B.profielen.set(id, fetch(boorUrl(b))
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then((t) => {
          const doc = new DOMParser().parseFromString(t, 'application/xml');
          const tekst = (el, n) => el.getElementsByTagNameNS('*', n)[0]?.textContent ?? null;
          const log = doc.getElementsByTagNameNS('*', 'DescriptiveBoreholeLog')[0] || doc.getElementsByTagNameNS('*', 'descriptiveBoreholeLog')[0];
          const lagenEl = log ? [...log.getElementsByTagNameNS('*', 'Layer')] : [];
          if (log && !lagenEl.length) lagenEl.push(...log.getElementsByTagNameNS('*', 'layer'));
          const lagen = lagenEl.map((el) => {
            const naam = tekst(el, 'soilNameNEN5104') || tekst(el, 'geotechnicalSoilName') || '';
            return { van: parseFloat(tekst(el, 'upperBoundary')), tot: parseFloat(tekst(el, 'lowerBoundary')), naam, hoofd: hoofdGrond(naam),
              mediaan: tekst(el, 'sandMedianClass'), kleur: tekst(el, 'colour') };
          }).filter((l) => isFinite(l.van) && isFinite(l.tot) && l.tot > l.van);
          return { nitg: tekst(doc, 'NITGCode'), lagen };
        })
        .catch((e) => { B.profielen.delete(id); throw e; }));
    }
    return B.profielen.get(id);
  }

  // --- sonderingen: meetreeks ophalen en omzetten naar grondsoort ---
  // Grondsoortgedrag per meting volgens Robertson (2010), niet-genormaliseerd: Isbt uit qc en Rf.
  // Nederlandse slappe lagen: Rf ≥ 5 % en qc ≤ 1,5 MPa geldt als veen (Robertson herkent veen hier slecht).
  const CPT_NAAM = { zand: 'zand', 'siltig zand': 'siltig/kleiig zand', leem: 'leem / siltige klei', klei: 'klei', veen: 'veen' };
  function cptKlasse(qc, rf) {
    if (rf >= 5 && qc <= 1.5) return 'veen';
    const i = Math.hypot(3.47 - Math.log10(qc / 0.1), Math.log10(rf) + 1.22);
    return i < 2.05 ? 'zand' : i < 2.6 ? 'siltig zand' : i < 2.95 ? 'leem' : i < 3.6 ? 'klei' : 'veen';
  }
  // klasse per meting -> gladstrijken (meest voorkomende klasse binnen ±0,15 m) -> lagen; lagen < 0,2 m opgaan in de dikste buur
  function cptLagen(m) {
    if (!m.length) return [];
    const k = m.map((p) => cptKlasse(p.qc, p.rf));
    const glad = m.map((p, i) => {
      const tel = {};
      for (let j = i; j >= 0 && p.z - m[j].z <= 0.15; j--) tel[k[j]] = (tel[k[j]] || 0) + 1;
      for (let j = i + 1; j < m.length && m[j].z - p.z <= 0.15; j++) tel[k[j]] = (tel[k[j]] || 0) + 1;
      return Object.entries(tel).sort((a, b) => b[1] - a[1])[0][0];
    });
    const lagen = [];
    glad.forEach((kl, i) => {
      const laatste = lagen[lagen.length - 1];
      if (laatste && laatste.kl === kl) { laatste.tot = m[i].z; laatste.n.push(i); } else {
        if (laatste) laatste.tot = m[i].z;
        lagen.push({ kl, van: m[i].z, tot: m[i].z, n: [i] });
      }
    });
    const voegBurenSamen = () => {
      for (let j = 1; j < lagen.length; j++) {
        if (lagen[j].kl === lagen[j - 1].kl) { lagen[j - 1].tot = lagen[j].tot; lagen[j - 1].n.push(...lagen[j].n); lagen.splice(j--, 1); }
      }
    };
    while (lagen.length > 1) {
      let i = -1, min = 0.2;
      lagen.forEach((l, j) => { if (l.tot - l.van < min) { min = l.tot - l.van; i = j; } });
      if (i < 0) break;
      const a = lagen[i - 1], b = lagen[i + 1], doel = !a ? b : !b ? a : a.tot - a.van >= b.tot - b.van ? a : b;
      if (doel === a) a.tot = lagen[i].tot; else b.van = lagen[i].van;
      doel.n.push(...lagen[i].n);
      lagen.splice(i, 1);
      voegBurenSamen();
    }
    const gem = (n, veld) => n.reduce((s, i) => s + m[i][veld], 0) / n.length;
    return lagen.filter((l) => l.tot > l.van).map((l) => ({ van: l.van, tot: l.tot, hoofd: l.kl, naam: CPT_NAAM[l.kl], qc: gem(l.n, 'qc'), rf: gem(l.n, 'rf') }));
  }
  function laadSondering(id) {
    if (!SON.profielen.has(id)) {
      SON.profielen.set(id, fetch(BRO_CPT + encodeURIComponent(id))
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then((t) => {
          const doc = new DOMParser().parseFromString(t, 'application/xml');
          const waarden = doc.getElementsByTagNameNS('*', 'values')[0]?.textContent || '';
          // vaste kolomvolgorde BRO-CPT: 0 sondeertrajectlengte, 1 diepte, 3 conusweerstand (MPa), 18 plaatselijke wrijving (MPa), 24 wrijvingsgetal (%)
          const meting = [];
          for (const rij of waarden.split(';')) {
            const v = rij.split(',');
            if (v.length < 25) continue;
            const z = +v[1] > -9999 ? +v[1] : +v[0], qc = +v[3], fs = +v[18];
            let rf = +v[24];
            if (!(rf > 0) && fs > 0 && qc > 0) rf = (fs / qc) * 100;
            if (z >= 0 && qc > 0 && rf > 0 && rf < 30) meting.push({ z, qc, rf });
          }
          meting.sort((a, b) => a.z - b.z);
          // voor de grafiek: gemiddelde per 0,1 m
          const grafiek = [];
          for (const p of meting) {
            const vak = Math.floor(p.z * 10), g = grafiek[grafiek.length - 1];
            if (g && g.vak === vak) { g.qc += p.qc; g.rf += p.rf; g.n++; } else grafiek.push({ vak, z: p.z, qc: p.qc, rf: p.rf, n: 1 });
          }
          return { lagen: cptLagen(meting), meting: grafiek.map((g) => ({ z: g.z, qc: g.qc / g.n, rf: g.rf / g.n })) };
        })
        .catch((e) => { SON.profielen.delete(id); throw e; }));
    }
    return SON.profielen.get(id);
  }
  // meetwaarde van een sondering op diepte d (m –mv), uit de grafiekreeks
  const cptOpDiepte = (p, d) => p?.meting?.reduce((best, q) => (!best || Math.abs(q.z - d) < Math.abs(best.z - d) ? q : best), null);

  // ligging van een boring/sondering t.o.v. een laag; null als de laag daar niet voorkomt of de tegel nog niet geladen is
  function boringInLaag(b, code) {
    const l = S.perCode.get(code), c = kolomVan(b.x), r = rijVan(b.y);
    if (!l || b.basis == null || !binnen(c, r) || !laagOpCel(l, c, r)) return null;
    const v = celUitCache(code, c, r);
    if (!v) return null;
    return { v, bereikt: b.basis < v.top, door: b.basis <= v.basis };
  }
  function boringTip(b, t) {
    let s = `<b>${esc(b.id)}</b> · ${soortNaam(b)}, ${fm(b.diepte)} m diep${b.jaar ? ' · ' + b.jaar : ''}<br>` +
      `<span class="grijs">maaiveld ${fmNAP(b.mv)}, einde ${fmNAP(b.basis)} m NAP</span>`;
    if (t) s += `<br>${t.door ? 'gaat door' : 'eindigt in'} <b>${esc(S.sel)}</b> (${fmNAP(t.v.top)} tot ${fmNAP(t.v.basis)} m NAP)`;
    return s + `<br><span class="grijs">klik voor de ${isCpt(b) ? 'sondering' : 'boorstaat'}</span>`;
  }

  // driehoek met de punt naar beneden (symbool voor een sondering), op de canvas-renderer
  const Driehoek = L.CircleMarker.extend({
    _updatePath() {
      const r = this._renderer, p = this._point, s = this._radius * 1.3;
      if (!r._drawing || this._empty()) return;
      const ctx = r._ctx;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + s); ctx.lineTo(p.x + s * 0.95, p.y - s * 0.65); ctx.lineTo(p.x - s * 0.95, p.y - s * 0.65); ctx.closePath();
      r._fillStroke(ctx, this);
    },
  });

  function tekenBron(br) {
    if (!br.groep || !br.lijst) return;
    br.groep.clearLayers();
    const filter = S.sel && br.alleenLaag, Vorm = br === SON ? Driehoek : L.CircleMarker;
    let n = 0, nDoor = 0;
    for (const b of br.lijst) {
      if (b.diepte < br.min || !inGebied(b.x, b.y)) continue;
      const t = S.sel ? boringInLaag(b, S.sel) : null, bereikt = !!(t && t.bereikt);
      if (filter && !bereikt) continue;
      n++; if (bereikt && t.door) nDoor++;
      const mk = new Vorm(rd2ll(b.x, b.y), {
        renderer: B.renderer, pane: 'boringen', radius: 3 + Math.min(5, Math.sqrt(b.diepte) * 0.55), color: '#fff', weight: 1.5,
        fillColor: bereikt ? (t.door ? '#d6336c' : '#f08c00') : '#18212b', fillOpacity: S.sel && !bereikt ? 0.35 : 0.95, bubblingMouseEvents: false,
      });
      mk.bindTooltip(() => boringTip(b, bereikt ? t : null), { direction: 'top', offset: [0, -4], className: 'boring-tip' });
      mk.on('click', () => { if (S.teken) voegPuntToe(rd2ll(b.x, b.y)); else toonBoring(b); });
      mk.addTo(br.groep);
    }
    const vorm = br === SON ? ' class="drie"' : '';
    $(br.el.teller).textContent = S.sel ? `${n} (${nDoor} erdoor)` : `${n}`;
    $(br.el.laag).disabled = !S.sel;
    $(br.el.legenda).innerHTML = S.sel
      ? `<span><i${vorm} style="background:#d6336c"></i>door ${esc(S.sel)} heen</span><span><i${vorm} style="background:#f08c00"></i>eindigt in ${esc(S.sel)}</span>` +
        (filter ? '' : `<span><i${vorm} style="background:#18212b;opacity:.35"></i>bereikt de laag niet</span>`)
      : `<span><i${vorm} style="background:#18212b"></i>grootte = diepte</span><span class="zacht">kies een laag om te filteren</span>`;
  }
  // tekent boringen én sonderingen (beide hangen af van de gekozen laag en het gebied)
  function tekenBoringen() { tekenBron(B); tekenBron(SON); }

  async function zetBron(br, aan) {
    $(br.el.knop).setAttribute('aria-pressed', aan ? 'true' : 'false');
    $(br.el.blok).hidden = !aan;
    if (aan && !br.groep) {
      br.groep = L.featureGroup().addTo(map);
      try { await laadBron(br); } catch (e) {
        melding(`Geen ${br.bestand} gevonden (<code>data/${br.bestand}.json</code>). Draai <code>prepare_regis.py</code> opnieuw, zonder <code>--zonder-${br.bestand}</code>.`, 6000);
        zetBron(br, false);
        return;
      }
      tekenBron(br);
    } else if (!aan && br.groep) { map.removeLayer(br.groep); br.groep = null; }
    if (br === SON && S.doorsnede) zoekDoorsnedeBoringen(S.doorsnede).then(() => tekenDoorsnede());
    schrijfHash();
  }
  const zetBoringen = (aan) => zetBron(B, aan), zetSonderingen = (aan) => zetBron(SON, aan);
  function toonBoring(b, terug) { if (b) toonKolom(b.x, b.y, { boring: b, terug }); }

  function boorstaatHtml(b, p) {
    const link = `<a href="${esc(boorUrl(b))}" target="_blank" rel="noopener">BRO-gegevens (XML)</a>`;
    const kop = `<h3>Boorbeschrijving ${isGt(b) ? 'geotechnisch (NEN-EN-ISO 14688)' : 'geologisch (NEN 5104)'}${p?.nitg ? ` · ${esc(p.nitg)}` : ''} · ${link}</h3>`;
    if (!p) return `<div class="boring-blok">${kop}<div class="zacht">Boorbeschrijving laden uit de BRO…</div></div>`;
    if (p.fout) return `<div class="boring-blok">${kop}<div style="color:var(--waarschuw)">Boorbeschrijving kon niet worden opgehaald (${esc(p.fout)}).</div></div>`;
    if (!p.lagen.length) return `<div class="boring-blok">${kop}<div class="zacht">Deze boring heeft geen beschreven lagen.</div></div>`;
    return `<div class="boring-blok">${kop}</div><table class="boorstaat"><thead><tr><th>Van (m –mv)</th><th>Tot</th><th>Top (m NAP)</th><th>Grondsoort</th><th>Zandmediaan</th><th>Kleur</th></tr></thead><tbody>${p.lagen.map((l) => `
      <tr><td class="num">${fm(l.van)}</td><td class="num">${fm(l.tot)}</td><td class="num">${b.mv == null ? '–' : fmNAP(b.mv - l.van)}</td>
      <td><span class="kleur" style="background:${GROND[l.hoofd]}"></span>${esc(leesbaar(l.naam) || 'onbekend')}</td>
      <td>${esc(leesbaar(l.mediaan) || '')}</td><td>${esc(leesbaar(l.kleur) || '')}</td></tr>`).join('')}</tbody></table>`;
  }
  function sonderingHtml(b, p) {
    const link = `<a href="${BRO_CPT}${esc(b.id)}" target="_blank" rel="noopener">BRO-gegevens (XML)</a>`;
    const kop = `<h3>Interpretatie sondering · ${link}</h3>`;
    if (!p) return `<div class="boring-blok">${kop}<div class="zacht">Sondering laden uit de BRO…</div></div>`;
    if (p.fout) return `<div class="boring-blok">${kop}<div style="color:var(--waarschuw)">Sondering kon niet worden opgehaald (${esc(p.fout)}).</div></div>`;
    if (!p.lagen.length) return `<div class="boring-blok">${kop}<div class="zacht">Deze sondering heeft geen bruikbare qc/Rf-waarden.</div></div>`;
    return `<div class="boring-blok">${kop}<div class="zacht">Indicatief: grondsoortgedrag afgeleid uit qc en Rf (Robertson 2010; veen bij Rf ≥ 5 % en qc ≤ 1,5 MPa), lagen dunner dan 0,2 m samengevoegd. Dit is geen monsterbeschrijving.</div></div>` +
      `<table class="boorstaat"><thead><tr><th>Van (m –mv)</th><th>Tot</th><th>Top (m NAP)</th><th>Grondsoort (interpretatie)</th><th>qc gem. (MPa)</th><th>Rf gem. (%)</th></tr></thead><tbody>${p.lagen.map((l) => `
      <tr><td class="num">${fm(l.van)}</td><td class="num">${fm(l.tot)}</td><td class="num">${b.mv == null ? '–' : fmNAP(b.mv - l.van)}</td>
      <td><span class="kleur" style="background:${GROND[l.hoofd]}"></span>${esc(l.naam)}</td>
      <td>${fm(l.qc)}</td><td>${fm(l.rf)}</td></tr>`).join('')}</tbody></table>`;
  }
  // boringen, sonderingen en peilbuizen binnen 250 m van een punt (en binnen het gebied, als dat er is)
  function boringenBijHtml(x, y) {
    let html = '';
    for (const [br, titel, kolom] of [[B, 'BRO-boringen', 'Boring'], [SON, 'Sonderingen', 'Sondering']]) {
      if (!br.lijst || (br === SON && !SON.groep)) continue;
      const bij = br.lijst.filter((b) => inGebied(b.x, b.y)).map((b) => ({ b, a: Math.hypot(b.x - x, b.y - y) }))
        .filter((o) => o.a <= 250).sort((p, q) => p.a - q.a).slice(0, 10);
      html += `<div class="boring-blok"><h3>${titel} binnen 250 m</h3>${bij.length ? '' : '<div class="zacht">Geen.</div>'}</div>` +
        (bij.length ? `<table><thead><tr><th>${kolom}</th><th>Afstand</th><th>Diepte</th><th>Jaar</th></tr></thead><tbody>${bij.map(({ b, a }) => `
        <tr class="klik${b.diepte < br.min ? ' ondiep' : ''}" data-bor="${esc(b.id)}"><td class="code">${esc(b.id)}${isGt(b) ? ' <span class="zacht">GT</span>' : ''}</td><td class="num">${nf0.format(a)} m</td>
        <td class="num">${fm(b.diepte)} m</td><td>${b.jaar || ''}</td></tr>`).join('')}</tbody></table>` : '');
    }
    if (P.lijst) {
      const bij = P.lijst.filter((p) => inGebied(p.x, p.y)).map((p) => ({ p, a: Math.hypot(p.x - x, p.y - y) }))
        .filter((o) => o.a <= 250).sort((p, q) => p.a - q.a).slice(0, 10);
      html += `<div class="boring-blok"><h3>Peilbuizen binnen 250 m</h3>${bij.length ? '' : '<div class="zacht">Geen.</div>'}</div>` +
        (bij.length ? `<table><thead><tr><th>Put</th><th>Afstand</th><th>Filters (m NAP)</th><th></th></tr></thead><tbody>${bij.map(({ p, a }) => `
        <tr class="klik" data-put="${esc(p.id)}"><td class="code">${esc(putNaam(p))}</td><td class="num">${nf0.format(a)} m</td>
        <td class="num">${p.filters.map((f) => `${fmNAP(f.top)}/${fmNAP(f.bot)}`).join(' · ')}</td><td></td></tr>`).join('')}</tbody></table>` : '');
    }
    return html;
  }

  // ------------------------------------------------------------------ //
  // BRO-peilbuizen (GMW): putten met filterdieptes uit data/peilbuizen.json
  // ------------------------------------------------------------------ //
  const BRO_GMW = 'https://publiek.broservices.nl/gm/gmw/v1/objects/';
  const PEIL = '#1c7ed6';
  const P = { lijst: null, perId: new Map(), laden: null, alleenLaag: true };
  const putNaam = (p) => p.code || p.id;

  function laadPeilbuizen() {
    if (!P.laden) {
      P.laden = fetch(`${DATA}/peilbuizen.json`)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((j) => {
          P.lijst = j.peilbuizen.map(([id, code, x, y, mv, filters]) => ({ id, code, x, y, mv,
            filters: filters.map(([nr, top, bot]) => ({ nr, top, bot })), basis: Math.min(...filters.map((f) => f[2])) }));
          P.lijst.forEach((p) => P.perId.set(p.id, p));
          return P.lijst;
        })
        .catch((e) => { P.laden = null; throw e; });
    }
    return P.laden;
  }
  // filters van een put die een laag raken (overlap filter–laag op die plek); null als de laag er niet is
  function filtersInLaag(p, code) {
    const l = S.perCode.get(code), c = kolomVan(p.x), r = rijVan(p.y);
    if (!l || !binnen(c, r) || !laagOpCel(l, c, r)) return null;
    const v = celUitCache(code, c, r);
    if (!v) return null;
    return { v, filters: p.filters.filter((f) => f.top > v.basis && f.bot < v.top) };
  }
  function putTip(p, t) {
    const fs = p.filters.map((f) => {
      const raak = t && t.filters.includes(f);
      return `<span${raak ? ' class="in-laag"' : ''}>filter ${f.nr}: ${fmNAP(f.top)} tot ${fmNAP(f.bot)} m NAP</span>`;
    }).join('<br>');
    return `<b>${esc(putNaam(p))}</b> <span class="grijs">· maaiveld ${fmNAP(p.mv)} m NAP</span><br>${fs}` +
      (t && t.filters.length ? `<br>${t.filters.length === 1 ? 'filter' : 'filters'} in <b>${esc(S.sel)}</b> (${fmNAP(t.v.top)} tot ${fmNAP(t.v.basis)} m NAP)` : '') +
      '<br><span class="grijs">klik voor de kolom</span>';
  }

  function tekenPeilbuizen() {
    if (!S.peilbuizen || !P.lijst) return;
    S.peilbuizen.clearLayers();
    const filter = P.alleenLaag;  // zonder gekozen laag dan geen putten
    let n = 0, nRaak = 0;
    for (const p of P.lijst) {
      if (!inGebied(p.x, p.y)) continue;
      const t = S.sel ? filtersInLaag(p, S.sel) : null, raak = !!(t && t.filters.length);
      if (filter && !raak) continue;
      n++; if (raak) nRaak++;
      const vaag = S.sel && !raak;
      const mk = L.circleMarker(rd2ll(p.x, p.y), {
        renderer: B.renderer, pane: 'boringen', radius: raak ? 6 : 4.5, color: raak ? '#fff' : PEIL, weight: raak ? 1.5 : 2,
        fillColor: raak ? PEIL : '#fff', fillOpacity: vaag ? 0.4 : 1, opacity: vaag ? 0.4 : 1, bubblingMouseEvents: false,
      });
      mk.bindTooltip(() => putTip(p, t), { direction: 'top', offset: [0, -4], className: 'boring-tip' });
      mk.on('click', () => { if (S.teken) voegPuntToe(rd2ll(p.x, p.y)); else toonPut(p); });
      mk.addTo(S.peilbuizen);
    }
    $('peil-teller').textContent = S.sel ? `${n} (${nRaak} in laag)` : `${n}`;
    $('peil-legenda').innerHTML = S.sel
      ? `<span><i style="background:${PEIL}"></i>filter in ${esc(S.sel)}</span>` +
        (filter ? '' : `<span><i style="background:#fff;box-shadow:0 0 0 2px ${PEIL};opacity:.5"></i>geen filter in de laag</span>`)
      : P.alleenLaag
        ? '<span class="zacht">Kies een laag: de peilbuizen met een filter in die laag verschijnen dan op de kaart en in de doorsnede.</span>'
        : `<span><i style="background:#fff;box-shadow:0 0 0 2px ${PEIL}"></i>peilbuis</span>`;
  }

  async function zetPeilbuizen(aan) {
    $('btn-peilbuizen').setAttribute('aria-pressed', aan ? 'true' : 'false');
    $('peilbuizen-blok').hidden = !aan;
    if (aan && !S.peilbuizen) {
      S.peilbuizen = L.featureGroup().addTo(map);
      try { await laadPeilbuizen(); } catch (e) {
        melding('Geen peilbuizen gevonden (<code>data/peilbuizen.json</code>). Draai <code>prepare_regis.py</code> opnieuw, zonder <code>--zonder-peilbuizen</code>.', 6000);
        zetPeilbuizen(false);
        return;
      }
      tekenPeilbuizen();
    } else if (!aan && S.peilbuizen) { map.removeLayer(S.peilbuizen); S.peilbuizen = null; }
    schrijfHash();
  }
  function toonPut(p, terug) { if (p) toonKolom(p.x, p.y, { put: p, terug }); }

  function putHtml(p, rijen) {
    const link = `<a href="${BRO_GMW}${esc(p.id)}" target="_blank" rel="noopener">BRO-gegevens (XML)</a>`;
    return `<div class="boring-blok"><h3>Filters · ${esc(p.id)} · ${link}</h3></div><table class="boorstaat"><thead><tr><th>Filter</th><th>Bovenkant (m NAP)</th><th>Onderkant</th><th>REGIS-laag</th></tr></thead><tbody>${p.filters.map((f) => {
      const lagen = rijen.filter((o) => f.top > o.v.basis && f.bot < o.v.top);
      return `<tr><td class="num">${f.nr}</td><td class="num">${fmNAP(f.top)}</td><td class="num">${fmNAP(f.bot)}</td>
        <td>${lagen.map((o) => `<span class="kleur" style="background:${o.laag.kleur.css}"></span><b class="code">${esc(o.laag.code)}</b> ${esc(o.laag.naam)}`).join('<br>') || '–'}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  // ------------------------------------------------------------------ //
  // Doorsnede
  // ------------------------------------------------------------------ //
  const PUNTLABELS = (n) => (n === 2 ? ['A', "A'"] : Array.from({ length: n }, (_, i) => String.fromCharCode(65 + (i % 26))));

  // soort: 'doorsnede' (lijn), 'polygoon' of 'rechthoek' (gebied)
  function startTekenen(soort = 'doorsnede') {
    const was = S.teken?.soort;
    if (S.teken) stopTekenen();
    if (was === soort) return;
    if (soort === 'doorsnede') sluitPaneel();
    const kleur = soort === 'doorsnede' ? '#18212b' : '#7048e8';
    S.teken = { soort, pts: [], lijn: L.polyline([], { color: kleur, weight: 2.5 }).addTo(map),
      voor: L.polyline([], { color: kleur, weight: 1.5, dashArray: '5 5' }).addTo(map), markers: [], kleur };
    map.doubleClickZoom.disable();
    $('kaart').classList.add('kaart-teken');
    $(soort === 'doorsnede' ? 'btn-doorsnede' : 'btn-gebied').setAttribute('aria-pressed', 'true');
    $('tekenhulp').hidden = false;
    $('gebied-keuze').hidden = soort === 'doorsnede';
    $('gebied-keuze').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.soort === soort ? 'true' : 'false'));
    werkTekenhulpBij();
  }
  function werkTekenhulpBij() {
    const n = S.teken.pts.length, soort = S.teken.soort;
    $('tekenhulp-tekst').textContent =
      soort === 'rechthoek' ? (n === 0 ? 'Klik de eerste hoek van het gebied' : 'Klik de tegenoverliggende hoek') :
      soort === 'polygoon' ? (n < 3 ? 'Klik de hoekpunten van het gebied' : 'Klik meer punten, of dubbelklik / Klaar om te sluiten') :
      n === 0 ? 'Klik het beginpunt van de doorsnede' : n === 1 ? 'Klik het volgende punt' : 'Klik meer punten, of dubbelklik / Klaar om af te ronden';
    $('btn-klaar').hidden = soort === 'rechthoek';
    $('btn-klaar').disabled = n < (soort === 'polygoon' ? 3 : 2);
  }
  function stopTekenen() {
    if (!S.teken) return;
    map.removeLayer(S.teken.lijn); map.removeLayer(S.teken.voor);
    S.teken.markers.forEach((m) => map.removeLayer(m));
    S.teken = null;
    map.doubleClickZoom.enable();
    $('kaart').classList.remove('kaart-teken');
    $('btn-doorsnede').setAttribute('aria-pressed', 'false');
    $('btn-gebied').setAttribute('aria-pressed', S.gebied ? 'true' : 'false');
    $('tekenhulp').hidden = true;
  }
  function voegPuntToe(ll) {
    const p = ll2rd(ll), pts = S.teken.pts, laatste = pts[pts.length - 1];
    if (laatste && Math.hypot(laatste[0] - p.x, laatste[1] - p.y) < 1) return;
    pts.push([p.x, p.y]);
    S.teken.lijn.addLatLng(ll);
    S.teken.markers.push(L.circleMarker(ll, { radius: 4, color: S.teken.kleur, fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(map));
    if (S.teken.soort === 'rechthoek' && pts.length === 2) { rondTekenenAf(); return; }
    werkTekenhulpBij();
  }
  // voorbeeldlijn naar de muis tijdens het tekenen
  function tekenVoorbeeld(ll) {
    const pts = S.teken.pts;
    if (!pts.length) return;
    if (S.teken.soort === 'rechthoek') {
      const p = ll2rd(ll), [x0, y0] = pts[0];
      S.teken.voor.setLatLngs([[x0, y0], [p.x, y0], [p.x, p.y], [x0, p.y], [x0, y0]].map(([x, y]) => rd2ll(x, y)));
    } else if (S.teken.soort === 'polygoon' && pts.length > 1) {
      S.teken.voor.setLatLngs([rd2ll(...pts[pts.length - 1]), ll, rd2ll(...pts[0])]);
    } else {
      S.teken.voor.setLatLngs([rd2ll(...pts[pts.length - 1]), ll]);
    }
  }
  function rondTekenenAf() {
    if (!S.teken) return;
    const { soort } = S.teken, pts = S.teken.pts.slice();
    if (pts.length < (soort === 'polygoon' ? 3 : 2)) return;
    stopTekenen();
    if (soort === 'doorsnede') maakDoorsnede(pts);
    else if (soort === 'rechthoek') {
      const [[xa, ya], [xb, yb]] = pts;
      zetGebied([[xa, ya], [xb, ya], [xb, yb], [xa, yb]], true);
    } else zetGebied(pts, true);
  }

  // ------------------------------------------------------------------ //
  // Gebied: alleen binnen een getekende rechthoek of polygoon tonen
  // ------------------------------------------------------------------ //
  // cellen waarvan het middelpunt binnen de polygoon ligt (scanline), voor een raster met celgrootte cel
  function rasteriseer(pts, cel, nx, ny) {
    const { x0, y0 } = S.meta, mask = new Uint8Array(nx * ny);
    let n = 0;
    for (let r = 0; r < ny; r++) {
      const y = y0 - (r + 0.5) * cel, xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - x0) / cel - 0.5)), c1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cel - 0.5));
        for (let c = c0; c <= c1; c++) { mask[r * nx + c] = 1; n++; }
      }
    }
    return { mask, n };
  }
  const inGebied = (x, y) => {
    if (!S.gebied) return true;
    const c = kolomVan(x), r = rijVan(y);
    return binnen(c, r) && S.gebied.fijn[r * S.meta.nx + c] === 1;
  };

  function zetGebied(pts, inzoomen) {
    if (S.gebied) { map.removeLayer(S.gebied.laag); S.gebied = null; }
    if (pts) {
      const m = S.meta, fijn = rasteriseer(pts, m.cel, m.nx, m.ny), grof = rasteriseer(pts, m.cel * m.grof, m.cnx, m.cny);
      if (!fijn.n) { melding('Het getekende gebied ligt buiten de REGIS-data.', 4000); pts = null; }
      else {
        // grijs masker buiten het gebied, met het gebied als gat
        const xa = m.x0 - 50000, xb = m.x0 + m.nx * m.cel + 50000, ya = m.y0 - m.ny * m.cel - 50000, yb = m.y0 + 50000;
        const buiten = [[xa, ya], [xb, ya], [xb, yb], [xa, yb]].map(([x, y]) => rd2ll(x, y));
        const laag = L.polygon([buiten, pts.map(([x, y]) => rd2ll(x, y))], {
          color: '#7048e8', weight: 2.5, dashArray: '6 4', fillColor: '#18212b', fillOpacity: 0.18, interactive: false,
        }).addTo(map);
        S.gebied = { pts, laag, fijn: fijn.mask, grof: grof.mask, nGrof: grof.n };
        if (inzoomen) map.fitBounds(L.latLngBounds(pts.map(([x, y]) => rd2ll(x, y))), { padding: [30, 30] });
      }
    }
    $('btn-gebied').setAttribute('aria-pressed', S.gebied ? 'true' : 'false');
    $('btn-gebied-tekst').textContent = S.gebied ? 'Gebied wissen' : 'Gebied';
    $('alleen-in-beeld-tekst').textContent = S.gebied ? 'alleen in gebied' : 'alleen in beeld';
    berekenInBeeld(); tekenLijst();
    if (S.sel) tekenLaag(); else { tekenBoringen(); tekenPeilbuizen(); }
    schrijfHash();
  }

  async function maakDoorsnede(pts) {
    wisPaneelLagen();
    S.kolom = null;
    const m = S.meta, stap = m.cel / 2;
    // monsterpunten langs de lijn
    const samples = []; let cum = 0; const knikken = [0];
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, ay] = pts[s], [bx, by] = pts[s + 1], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len / stap));
      for (let i = 0; i < n; i++) samples.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n, d: cum + (len * i) / n });
      cum += len; knikken.push(cum);
    }
    samples.push({ x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], d: cum });
    if (samples.length > 6000) { melding('Deze doorsnede is erg lang; teken een kortere lijn (max. ~300 km).', 5000); return; }

    // lijn op de kaart
    const lls = pts.map(([x, y]) => rd2ll(x, y));
    S.paneelLagen.push(L.polyline(lls, { color: '#18212b', weight: 3, opacity: 0.9 }).addTo(map));
    const labels = PUNTLABELS(pts.length);
    lls.forEach((ll, i) => {
      const mk = L.circleMarker(ll, { radius: 4, color: '#18212b', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(map);
      mk.bindTooltip(labels[i], { permanent: true, direction: 'top', className: 'punt-label', offset: [0, -6] });
      S.paneelLagen.push(mk);
    });
    const volg = L.circleMarker(lls[0], { radius: 5, color: '#fff', weight: 2, fillColor: '#d6336c', fillOpacity: 1, opacity: 0 }).addTo(map);
    S.paneelLagen.push(volg);

    // benodigde tegels
    const T = m.tegel, nodig = new Map();
    for (const s of samples) {
      s.c = kolomVan(s.x); s.r = rijVan(s.y);
      if (!binnen(s.c, s.r)) continue;
      for (const l of S.lagen) if (laagOpCel(l, s.c, s.r)) {
        const tx = Math.floor(s.c / T), ty = Math.floor(s.r / T), key = `${l.code}/${tx}_${ty}`;
        if (!nodig.has(key)) nodig.set(key, [l.code, tx, ty]);
      }
    }
    openPaneel('Doorsnede laden…', [], document.createElement('div'));
    await pool([...nodig.values()], 8, ([code, tx, ty]) => laadTegel(code, tx, ty), voortgang);
    voortgang(1);

    const lagen = [];
    for (const l of S.lagen) {
      const top = new Float32Array(samples.length).fill(NaN), bot = new Float32Array(samples.length).fill(NaN);
      let iets = false;
      samples.forEach((s, i) => {
        if (!binnen(s.c, s.r) || !laagOpCel(l, s.c, s.r)) return;
        const v = celUitCache(l.code, s.c, s.r);
        if (v) { top[i] = v.top; bot[i] = v.basis; iets = true; }
      });
      if (iets) lagen.push({ laag: l, top, bot });
    }
    const mv = new Float32Array(samples.length).fill(NaN);
    for (const o of lagen) o.top.forEach((v, i) => { if (isFinite(v) && !(v <= mv[i])) mv[i] = v; });
    const D = S.doorsnede = { pts, samples, lagen, mv, L: cum, knikken, labels, volg, stap, boringen: [], putten: [] };
    schrijfHash();
    tekenDoorsnede();
    await zoekDoorsnedeBoringen(D);
    if (S.doorsnede === D) tekenDoorsnede();
  }

  // punten binnen buf m van de lijn, met positie langs de lijn (d) en afstand tot de lijn
  function projecteer(D, lijst, buf, ok, MAX = 80) {
    const xs = D.pts.map((p) => p[0]), ys = D.pts.map((p) => p[1]), uit = [];
    const xa = Math.min(...xs) - buf, xb = Math.max(...xs) + buf, ya = Math.min(...ys) - buf, yb = Math.max(...ys) + buf;
    for (const o of lijst) {
      if (o.x < xa || o.x > xb || o.y < ya || o.y > yb || !ok(o)) continue;
      let best = Infinity, d = 0;
      for (let s = 0; s < D.pts.length - 1; s++) {
        const [ax, ay] = D.pts[s], [bx, by] = D.pts[s + 1], vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((o.x - ax) * vx + (o.y - ay) * vy) / len2));
        const a = Math.hypot(ax + t * vx - o.x, ay + t * vy - o.y);
        if (a < best) { best = a; d = D.knikken[s] + t * Math.sqrt(len2); }
      }
      if (best <= buf) uit.push({ o, d, afstand: best });
    }
    if (uit.length > MAX) {
      melding(`${uit.length} objecten binnen ${buf} m; alleen de ${MAX} dichtst bij de lijn worden getoond.`, 5000);
      uit.sort((p, q) => p.afstand - q.afstand).length = MAX;
    }
    return uit.sort((p, q) => p.d - q.d);
  }

  // boringen (met boorbeschrijving) en peilbuizen binnen S.dsBuffer m van de lijn
  async function zoekDoorsnedeBoringen(D) {
    D.boringen = []; D.putten = [];
    if (D.borLaag) { map.removeLayer(D.borLaag); D.borLaag = null; }
    if (!S.dsBuffer) return;
    // sonderingen alleen als die aanstaan (ze zijn talrijk en elke meetreeks is ~170 kB); alles alleen binnen het gebied
    const [bl, sl, pl] = await Promise.all([
      S.meta.boringen ? laadBoringen().catch(() => null) : null,
      S.meta.sonderingen && SON.groep ? laadSonderingen().catch(() => null) : null,
      S.meta.peilbuizen ? laadPeilbuizen().catch(() => null) : null,
    ]);
    const ok = (br) => (b) => b.diepte >= br.min && b.mv != null && inGebied(b.x, b.y);
    D.boringen = [...(bl ? projecteer(D, bl, S.dsBuffer, ok(B)) : []), ...(sl ? projecteer(D, sl, S.dsBuffer, ok(SON), 60) : [])]
      .sort((p, q) => p.d - q.d).map(({ o, d, afstand }) => ({ b: o, d, afstand, profiel: null }));
    if (pl) D.putten = projecteer(D, pl, S.dsBuffer, (p) => inGebied(p.x, p.y), 300).map(({ o, d, afstand }) => ({ p: o, d, afstand }));
    D.borLaag = L.layerGroup(D.boringen.map((o) => L.circleMarker(rd2ll(o.b.x, o.b.y),
      { pane: 'boringen', radius: 7, color: '#d6336c', weight: 2, fill: false, interactive: false }))).addTo(map);
    S.paneelLagen.push(D.borLaag);
    await pool(D.boringen, 6, async (o) => { try { o.profiel = await laadProfielVan(o.b); } catch (e) { o.profiel = { fout: e.message }; } }, voortgang);
    voortgang(1);
  }

  function tekenDoorsnede() {
    const D = S.doorsnede;
    if (!D) return;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;inset:0';
    const vo = document.createElement('span');
    const knopSvg = Object.assign(document.createElement('button'), { className: 'knop klein licht', textContent: 'SVG' });
    const knopPng = Object.assign(document.createElement('button'), { className: 'knop klein licht', textContent: 'PNG' });
    knopSvg.title = 'Doorsnede opslaan als SVG'; knopPng.title = 'Doorsnede opslaan als PNG';
    // met een gekozen laag (en het vinkje aan) alleen putten met een filter in die laag, net als op de kaart
    const putten = S.sel && P.alleenLaag ? D.putten.filter((o) => filtersInLaag(o.p, S.sel)?.filters.length) : D.putten;
    const nb = D.boringen.length, np = putten.length, ns = D.boringen.filter((o) => isCpt(o.b)).length;
    const titel = `Doorsnede ${D.labels[0]}–${D.labels[D.labels.length - 1]} <span style="color:var(--zacht);font-weight:400">· ${nf1.format(D.L / 1000)} km · ${D.lagen.length} lagen` +
      `${nb - ns ? ` · ${nb - ns} boring${nb - ns === 1 ? '' : 'en'}` : ''}${ns ? ` · ${ns} sondering${ns === 1 ? '' : 'en'}` : ''}` +
      `${np ? ` · ${np} peilbuis${np === 1 ? '' : 'zen'}` : ''}</span>`;
    const acties = [vo, diepteKeuze(tekenDoorsnede, (nb || np) && D, 'tot einde boring/filter')];
    if (S.meta.boringen || S.meta.peilbuizen) {
      const lab = document.createElement('label');
      lab.title = `Boringen en sonderingen (als die aanstaan, met hun min. diepte) en peilbuizen binnen deze afstand van de lijn`;
      lab.innerHTML = `Afstand tot lijn <select><option value="0">uit</option><option value="100">≤ 100 m</option><option value="250">≤ 250 m</option>
        <option value="500">≤ 500 m</option><option value="1000">≤ 1 km</option></select>`;
      const sel = lab.querySelector('select');
      sel.value = S.dsBuffer;
      sel.onchange = async () => { S.dsBuffer = +sel.value; schrijfHash(); await zoekDoorsnedeBoringen(D); if (S.doorsnede === D) tekenDoorsnede(); };
      acties.push(lab);
    }
    openPaneel(titel, [...acties, knopSvg, knopPng], box);
    if (!D.lagen.length) { box.innerHTML = '<div class="leeg">Geen REGIS-lagen langs deze lijn.</div>'; return; }

    const W = Math.max(300, box.clientWidth), H = Math.max(160, box.clientHeight);
    const m = { l: 56, r: 16, t: nb || np ? 30 : 18, b: 28 };
    const ph = H - m.t - m.b;
    const mvMax = Math.max(...Array.from(D.mv).filter(isFinite));
    let zmin = Infinity;
    for (const o of D.lagen) for (const v of o.bot) if (v < zmin) zmin = v;
    const diepte = nb || np ? D.diepte || 'boring' : S.diepte;
    if (diepte === 'boring') {
      const bodem = Math.min(...D.boringen.map((o) => o.b.basis), ...putten.map((o) => o.p.basis));
      zmin = Math.max(zmin, bodem - Math.max(10, (mvMax - bodem) * 0.25));
    } else if (diepte !== 'alles') zmin = Math.max(zmin, mvMax - +diepte);
    const zmax = mvMax + Math.max(2, (mvMax - zmin) * 0.04);
    // legenda rechts: REGIS-lagen die binnen het dieptebereik in beeld zijn, in kolommen naast de figuur
    const legLagen = D.lagen.filter((o) => o.top.some((t, i) => isFinite(t) && t > zmin && o.bot[i] < zmax));
    const LW = 182, RH = 14, rijen = Math.max(1, Math.floor((ph - 4) / RH));
    const legKol = Math.min(Math.ceil(legLagen.length / rijen), Math.max(0, Math.floor((W - m.l - 16 - 360) / LW)));
    if (legKol) m.r = 16 + legKol * LW;
    const pw = W - m.l - m.r;
    const sx = (d) => m.l + (d / D.L) * pw, sy = (z) => m.t + ((zmax - z) / (zmax - zmin)) * ph;
    vo.textContent = `vert. overdrijving ×${nf0.format((ph / (zmax - zmin)) / (pw / D.L))}`;

    const svg = svgEl('svg', { class: 'doorsnede-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, xmlns: 'http://www.w3.org/2000/svg' });
    box.appendChild(svg);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }, svg);
    const font = { 'font-family': 'system-ui, -apple-system, Segoe UI, Arial, sans-serif', 'font-size': 11, fill: '#5a6675' };
    const as = svgEl('g', {}, svg);
    for (const z of niceTicks(zmin, zmax, Math.max(3, Math.floor(ph / 45)))) {
      svgEl('line', { x1: m.l, x2: W - m.r, y1: sy(z), y2: sy(z), stroke: z === 0 ? '#b9c2cc' : '#e9edf1', 'stroke-dasharray': z === 0 ? '3 3' : '' }, as);
      Object.assign(svgEl('text', { x: m.l - 6, y: sy(z) + 4, 'text-anchor': 'end', ...font }, as), { textContent: (z > 0 ? '+' : '') + z });
    }
    for (const d of niceTicks(0, D.L / 1000, Math.max(3, Math.floor(pw / 90)))) {
      Object.assign(svgEl('text', { x: sx(d * 1000), y: H - 9, 'text-anchor': 'middle', ...font }, as), { textContent: nf1.format(d).replace(/,0$/, '') + ' km' });
    }
    Object.assign(svgEl('text', { x: 12, y: m.t + ph / 2, transform: `rotate(-90 12 ${m.t + ph / 2})`, 'text-anchor': 'middle', ...font }, as), { textContent: 'm NAP' });

    const clipId = 'dclip' + Math.random().toString(36).slice(2, 7);
    svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph }, svgEl('clipPath', { id: clipId }, svgEl('defs', {}, svg)));
    const g = svgEl('g', { 'clip-path': `url(#${clipId})` }, svg);

    const s = D.samples, half = D.stap / 2;
    const paden = [];
    for (const o of D.lagen) {
      let dPad = '';
      let i = 0;
      while (i < s.length) {
        if (!isFinite(o.top[i])) { i++; continue; }
        let j = i;
        while (j + 1 < s.length && isFinite(o.top[j + 1])) j++;
        const xa = Math.max(0, s[i].d - half), xb = Math.min(D.L, s[j].d + half);
        let p = `M${sx(xa).toFixed(1)},${sy(o.top[i]).toFixed(1)}`;
        for (let k = i; k <= j; k++) p += `L${sx(s[k].d).toFixed(1)},${sy(o.top[k]).toFixed(1)}`;
        p += `L${sx(xb).toFixed(1)},${sy(o.top[j]).toFixed(1)}L${sx(xb).toFixed(1)},${sy(o.bot[j]).toFixed(1)}`;
        for (let k = j; k >= i; k--) p += `L${sx(s[k].d).toFixed(1)},${sy(o.bot[k]).toFixed(1)}`;
        p += `L${sx(xa).toFixed(1)},${sy(o.bot[i]).toFixed(1)}Z`;
        dPad += p;
        i = j + 1;
      }
      const sel = o.laag.code === S.sel;
      const pad = svgEl('path', { d: dPad, fill: o.laag.kleur.css, stroke: sel ? '#111111' : 'rgba(255,255,255,0.75)', 'stroke-width': sel ? 1.6 : 0.6, 'stroke-linejoin': 'round' }, g);
      paden.push({ pad, o });
    }
    // geselecteerde laag bovenop, zodat de omlijning zichtbaar is
    const selPad = paden.find((p) => p.o.laag.code === S.sel);
    if (selPad) g.appendChild(selPad.pad);
    // boringen als smalle boorstaten op hun eigen maaiveld
    const BW = 9;
    for (const o of D.boringen) {
      const x = sx(o.d) - BW / 2, b = o.b;
      for (const l of o.profiel?.lagen || []) {
        svgEl('rect', { x, y: sy(b.mv - l.van), width: BW, height: Math.max(0.5, sy(b.mv - l.tot) - sy(b.mv - l.van)), fill: GROND[l.hoofd] }, g);
      }
      svgEl('rect', { x, y: sy(b.mv), width: BW, height: sy(b.basis) - sy(b.mv), fill: o.profiel?.lagen?.length ? 'none' : '#eef1f4',
        stroke: '#18212b', 'stroke-width': 0.8 }, g);
    }
    // peilbuizen: buis vanaf maaiveld, filters als blauwe blokjes
    const putTop = (p) => p.mv ?? Math.max(...p.filters.map((f) => f.top));
    for (const o of putten) {
      const x = sx(o.d), p = o.p;
      svgEl('line', { x1: x, x2: x, y1: sy(putTop(p)), y2: sy(p.basis), stroke: '#0b4f8a', 'stroke-width': 1.2 }, g);
      const inLaag = S.sel ? filtersInLaag(p, S.sel)?.filters || [] : null;
      for (const f of p.filters) {
        const raak = inLaag?.includes(f);
        const h = Math.max(raak ? 5 : 2, sy(f.bot) - sy(f.top)), w = BW + (raak ? 6 : 0);
        svgEl('rect', { x: x - w / 2, y: (sy(f.top) + sy(f.bot)) / 2 - h / 2, width: w, height: h,
          fill: inLaag && !raak ? '#a5c8ef' : PEIL, stroke: raak ? '#111' : '#0b4f8a', 'stroke-width': raak ? 1.4 : 0.8 }, g);
      }
    }
    if (nb || np) {
      const gebruikt = new Set(D.boringen.flatMap((o) => (o.profiel?.lagen || []).map((l) => l.hoofd)));
      const items = Object.keys(GROND).filter((k) => gebruikt.has(k)).map((k) => [k, GROND[k]]);
      if (np) items.push([S.sel ? `filter in ${S.sel}` : 'peilbuisfilter', PEIL]);
      let lx = W - m.r;
      for (const [k, kleur] of items.reverse()) {
        const t = svgEl('text', { x: lx, y: 12, 'text-anchor': 'end', ...font }, svg);
        t.textContent = k;
        lx -= t.getComputedTextLength() + 4;
        svgEl('rect', { x: lx - 9, y: 3, width: 9, height: 10, fill: kleur, stroke: '#18212b', 'stroke-width': 0.5 }, svg);
        lx -= 18;
      }
      Object.assign(svgEl('text', { x: lx + 3, y: 12, 'text-anchor': 'end', ...font, 'font-weight': 600 }, svg), { textContent: [nb - ns && 'boring', ns && 'sondering', np && 'put'].filter(Boolean).join('/') + ':' });
    }
    if (legKol) {
      const x0 = W - m.r + 14, leg = svgEl('g', {}, svg);
      Object.assign(svgEl('text', { x: x0, y: m.t - 5, ...font, 'font-weight': 600 }, leg), { textContent: 'REGIS-lagen' });
      const passen = legKol * rijen, toon = legLagen.slice(0, legLagen.length > passen ? passen - 1 : passen);
      toon.forEach((o, n) => {
        const kx = x0 + Math.floor(n / rijen) * LW, ky = m.t + 2 + (n % rijen) * RH, sel = o.laag.code === S.sel;
        const item = svgEl('g', {}, leg);
        item.style.cursor = 'pointer';
        svgEl('rect', { x: kx, y: ky, width: 12, height: 10, fill: o.laag.kleur.css, stroke: sel ? '#e03131' : 'rgba(0,0,0,.35)', 'stroke-width': sel ? 2 : 0.6 }, item);
        const code = svgEl('text', { x: kx + 17, y: ky + 9, 'font-family': 'ui-monospace, Consolas, monospace', 'font-size': 10.5, 'font-weight': 700, fill: '#18212b' }, item);
        code.textContent = o.laag.code;
        const naam = svgEl('text', { x: kx + 23 + code.getComputedTextLength(), y: ky + 9, ...font, 'font-size': 10.5, 'font-weight': sel ? 700 : 400 }, item);
        naam.textContent = o.laag.naam;
        const ruimte = LW - 30 - code.getComputedTextLength();
        while (naam.textContent.length > 3 && naam.getComputedTextLength() > ruimte) naam.textContent = naam.textContent.slice(0, -2) + '…';
        const pad = paden.find((p) => p.o === o)?.pad;
        item.addEventListener('mouseenter', (ev) => {
          pad?.setAttribute('stroke', '#e03131'); pad?.setAttribute('stroke-width', 2);
          toonTip(`<b>${esc(o.laag.code)}</b> ${esc(o.laag.naam)}<br><span class="grijs">klik om te kiezen</span>`, ev);
        });
        item.addEventListener('mouseleave', () => {
          pad?.setAttribute('stroke', sel ? '#111111' : 'rgba(255,255,255,0.75)'); pad?.setAttribute('stroke-width', sel ? 1.6 : 0.6);
          $('tip').hidden = true;
        });
        item.addEventListener('click', () => kiesLaag(o.laag.code));
      });
      if (toon.length < legLagen.length) {
        const n = toon.length;
        Object.assign(svgEl('text', { x: x0 + Math.floor(n / rijen) * LW, y: m.t + 11 + (n % rijen) * RH, ...font, 'font-style': 'italic' }, leg),
          { textContent: `+ ${legLagen.length - n} meer (kies een kleinere diepte)` });
      }
    }
    // maaiveld (bovenkant REGIS)
    let mvPad = '';
    s.forEach((p, i) => { if (isFinite(D.mv[i])) mvPad += `${mvPad && isFinite(D.mv[i - 1]) ? 'L' : 'M'}${sx(p.d).toFixed(1)},${sy(D.mv[i]).toFixed(1)}`; });
    svgEl('path', { d: mvPad, fill: 'none', stroke: '#2c3a46', 'stroke-width': 1.2 }, g);
    // knikpunten en labels
    D.knikken.forEach((d, i) => {
      if (i > 0 && i < D.knikken.length - 1) svgEl('line', { x1: sx(d), x2: sx(d), y1: m.t, y2: m.t + ph, stroke: '#6b7684', 'stroke-dasharray': '4 3' }, svg);
      Object.assign(svgEl('text', { x: sx(d), y: m.t - 5, 'text-anchor': i === 0 ? 'start' : i === D.knikken.length - 1 ? 'end' : 'middle',
        'font-family': font['font-family'], 'font-size': 12, 'font-weight': 700, fill: '#18212b' }, svg), { textContent: D.labels[i] });
    });
    svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'none', stroke: '#c5ccd5' }, svg);

    // interactie
    const gids = svgEl('line', { y1: m.t, y2: m.t + ph, stroke: '#111', 'stroke-dasharray': '2 3', visibility: 'hidden', 'pointer-events': 'none' }, svg);
    const vang = svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' }, svg);
    vang.style.cursor = 'crosshair';
    const raak = (ev) => {
      const pt = svg.getBoundingClientRect(), mx = ev.clientX - pt.left, my = ev.clientY - pt.top;
      const d = ((mx - m.l) / pw) * D.L, z = zmax - ((my - m.t) / ph) * (zmax - zmin);
      let i = 0, best = Infinity;
      for (let k = 0; k < s.length; k++) { const a = Math.abs(s[k].d - d); if (a < best) { best = a; i = k; } }
      const hit = D.lagen.find((o) => isFinite(o.top[i]) && z <= o.top[i] && z >= o.bot[i]);
      const bor = D.boringen.find((o) => Math.abs(sx(o.d) - mx) <= BW / 2 + 2 && my >= sy(o.b.mv) - 3 && my <= sy(o.b.basis) + 3);
      const put = bor ? null : putten.find((o) => Math.abs(sx(o.d) - mx) <= BW / 2 + 2 && my >= sy(putTop(o.p)) - 3 && my <= sy(o.p.basis) + 3);
      return { i, d, z, hit, mx, bor, put };
    };
    vang.addEventListener('mousemove', (ev) => {
      const { i, d, z, hit, mx, bor, put } = raak(ev);
      vang.style.cursor = bor || put ? 'pointer' : 'crosshair';
      if (put) {
        const p = put.p, f = p.filters.find((f) => z <= f.top + 0.5 && z >= f.bot - 0.5);
        let k = 0;
        for (let j = 1; j < s.length; j++) if (Math.abs(s[j].d - put.d) < Math.abs(s[k].d - put.d)) k = j;
        const zf = f && (f.top + f.bot) / 2;
        const laag = f && D.lagen.find((o) => isFinite(o.top[k]) && zf <= o.top[k] && zf >= o.bot[k]);
        gids.setAttribute('visibility', 'hidden');
        D.volg.setLatLng(rd2ll(p.x, p.y)); D.volg.setStyle({ opacity: 1, fillOpacity: 1 });
        toonTip(`<b>${esc(putNaam(p))}</b><br>` +
          (f ? `filter ${f.nr}: ${fmNAP(f.top)} tot ${fmNAP(f.bot)} m NAP${laag ? ` · in <b>${esc(laag.laag.code)}</b> <span class="grijs">(REGIS op de lijn)</span>` : ''}<br>` : '') +
          `<span class="grijs">${p.filters.length} filter${p.filters.length === 1 ? '' : 's'} · ${nf0.format(put.afstand)} m van de lijn · klik voor de kolom</span>`, ev);
        return;
      }
      if (bor) {
        const b = bor.b, l = bor.profiel?.lagen?.find((l) => z <= b.mv - l.van && z >= b.mv - l.tot);
        gids.setAttribute('visibility', 'hidden');
        D.volg.setLatLng(rd2ll(b.x, b.y)); D.volg.setStyle({ opacity: 1, fillOpacity: 1 });
        const q = isCpt(b) ? cptOpDiepte(bor.profiel, b.mv - z) : null;
        toonTip(`<b>${esc(b.id)}</b> <span class="grijs">${soortNaam(b)}</span>${bor.profiel?.nitg ? ` <span class="grijs">${esc(bor.profiel.nitg)}</span>` : ''}<br>` +
          (l ? `${esc(leesbaar(l.naam) || 'onbekend')}${isCpt(b) ? ' (interpretatie)' : ''} <span class="grijs">(${fm(l.van)}–${fm(l.tot)} m –mv)</span><br>` : '') +
          (q ? `qc ${fm(q.qc)} MPa · Rf ${fm(q.rf)} %<br>` : '') +
          `<span class="grijs">${fm(b.diepte)} m diep${b.jaar ? ' · ' + b.jaar : ''} · ${nf0.format(bor.afstand)} m van de lijn · klik voor ${isCpt(b) ? 'de sondering' : 'boorstaat'}</span>`, ev);
        return;
      }
      gids.setAttribute('x1', mx); gids.setAttribute('x2', mx); gids.setAttribute('visibility', 'visible');
      D.volg.setLatLng(rd2ll(s[i].x, s[i].y)); D.volg.setStyle({ opacity: 1, fillOpacity: 1 });
      const kop = `<span class="grijs">${nf1.format(d / 1000)} km · ${fmNAP(z)} m NAP · mv ${fmNAP(D.mv[i])}</span>`;
      toonTip(hit ? `<b>${esc(hit.laag.code)}</b> ${esc(hit.laag.naam)}<br>${fmNAP(hit.top[i])} tot ${fmNAP(hit.bot[i])} m NAP (${fm(hit.top[i] - hit.bot[i])} m)<br>${kop}` : kop, ev);
    });
    vang.addEventListener('mouseleave', () => { gids.setAttribute('visibility', 'hidden'); $('tip').hidden = true; D.volg.setStyle({ opacity: 0, fillOpacity: 0 }); });
    vang.addEventListener('click', (ev) => {
      const { hit, bor, put } = raak(ev);
      if (bor) { $('tip').hidden = true; toonBoring(bor.b, D.pts); } else if (put) { $('tip').hidden = true; toonPut(put.p, D.pts); } else if (hit) kiesLaag(hit.laag.code);
    });

    const naam = `doorsnede_${Math.round(D.pts[0][0])}_${Math.round(D.pts[0][1])}`;
    const svgTekst = () => {
      const kloon = svg.cloneNode(true);
      kloon.querySelectorAll('rect[fill="transparent"]').forEach((r) => r.remove());
      kloon.querySelector('line[visibility]')?.remove();
      return new XMLSerializer().serializeToString(kloon);
    };
    knopSvg.onclick = () => download(new Blob([svgTekst()], { type: 'image/svg+xml' }), naam + '.svg');
    knopPng.onclick = () => {
      const img = new Image();
      img.onload = () => {
        const cv = Object.assign(document.createElement('canvas'), { width: W * 2, height: H * 2 });
        const ctx = cv.getContext('2d'); ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
        cv.toBlob((b) => download(b, naam + '.png'));
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgTekst());
    };
  }
  function download(blob, naam) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: naam });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ //
  // Deelbare URL
  // ------------------------------------------------------------------ //
  function schrijfHash() {
    if (!S.meta || schrijfHash.uit) return;
    const c = ll2rd(map.getCenter()), d = [`x=${Math.round(c.x)}`, `y=${Math.round(c.y)}`, `z=${map.getZoom()}`];
    if (S.sel) d.push(`laag=${encodeURIComponent(S.sel)}`);
    if (S.modus !== 'verbreiding') d.push(`weergave=${S.modus}`);
    if (S.doorsnede) d.push(`ds=${S.doorsnede.pts.map((p) => p.map(Math.round).join(',')).join(';')}`);
    if (S.kolom?.boring) d.push(`bor=${S.kolom.boring.id}`);
    else if (S.kolom?.put) d.push(`put=${S.kolom.put.id}`);
    else if (S.kolom) d.push(`p=${Math.round(S.kolom.x)},${Math.round(S.kolom.y)}`);
    if (B.groep) d.push('boringen=1');
    if (SON.groep) d.push('sonderingen=1');
    if (SON.min !== 10) d.push(`smin=${SON.min}`);
    if (!S.peilbuizen && S.meta.peilbuizen) d.push('peilbuizen=0');
    if (B.min !== 10) d.push(`bmin=${B.min}`);
    if (S.dsBuffer !== 250) d.push(`bbuf=${S.dsBuffer}`);
    if (S.gebied) d.push(`gebied=${S.gebied.pts.map((p) => p.map(Math.round).join(',')).join(';')}`);
    if (S.achtergrondNaam && S.achtergrondNaam !== 'grijs') d.push(`kaart=${S.achtergrondNaam}`);
    history.replaceState(null, '', '#' + d.join('&'));
  }
  function leesHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    return Object.fromEntries(h.entries());
  }

  // ------------------------------------------------------------------ //
  // Achtergrond
  // ------------------------------------------------------------------ //
  function zetAchtergrond(naam) {
    if (S.achtergrond) map.removeLayer(S.achtergrond);
    S.achtergrond = null; S.achtergrondNaam = naam;
    $('achtergrond').value = naam;
    if (ACHTERGRONDEN[naam]) {
      S.achtergrond = L.tileLayer(ACHTERGRONDEN[naam], { minZoom: 0, maxZoom: 14, noWrap: true, zIndex: 0 }).addTo(map);
    }
    schrijfHash();
  }

  // ------------------------------------------------------------------ //
  // Bediening
  // ------------------------------------------------------------------ //
  function koppelBediening() {
    $('lagen').addEventListener('click', (e) => { const li = e.target.closest('.laag'); if (li) kiesLaag(li.dataset.code); });
    $('lagen').addEventListener('keydown', (e) => {
      const li = e.target.closest('.laag');
      if (!li) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kiesLaag(li.dataset.code); }
      if (e.key === 'ArrowDown') { e.preventDefault(); li.nextElementSibling?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); li.previousElementSibling?.focus(); }
    });
    $('zoek').addEventListener('input', tekenLijst);
    $('alleen-in-beeld').addEventListener('change', tekenLijst);
    $('modus').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      S.modus = b.dataset.m; S.bereikHand = false;
      $('modus').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      tekenLaag(); schrijfHash();
    });
    const zetBereik = () => {
      const m = MODI[S.modus];
      let lo = parseFloat($('leg-min').value), hi = parseFloat($('leg-max').value);
      if (!isFinite(lo) || !isFinite(hi) || lo === hi) return;
      if (m.log) { if (lo <= 0 || hi <= 0) return; lo = Math.log10(lo); hi = Math.log10(hi); }
      S.bereik = [lo, hi]; S.bereikHand = true; tekenLaag();
    };
    $('leg-min').addEventListener('change', zetBereik);
    $('leg-max').addEventListener('change', zetBereik);
    $('leg-auto').addEventListener('click', () => { S.bereikHand = false; tekenLaag(); });
    $('dekking').addEventListener('input', (e) => { S.dekking = +e.target.value; if (S.overlay) S.overlay.setOpacity(S.dekking); });
    $('btn-doorsnede').addEventListener('click', () => startTekenen('doorsnede'));
    $('btn-gebied').addEventListener('click', () => {
      if (S.gebied && S.teken?.soort !== 'polygoon' && S.teken?.soort !== 'rechthoek') zetGebied(null);
      else startTekenen(S.teken?.soort === 'polygoon' ? 'polygoon' : 'rechthoek');
    });
    $('gebied-keuze').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-soort]');
      if (b && S.teken?.soort !== b.dataset.soort) startTekenen(b.dataset.soort);
    });
    $('btn-klaar').addEventListener('click', rondTekenenAf);
    $('btn-annuleer').addEventListener('click', stopTekenen);
    $('btn-boringen').addEventListener('click', () => zetBoringen(!B.groep));
    $('bor-min').addEventListener('change', (e) => { B.min = +e.target.value; tekenBron(B); schrijfHash(); });
    $('bor-laag').addEventListener('change', (e) => { B.alleenLaag = e.target.checked; tekenBron(B); });
    $('btn-sonderingen').addEventListener('click', () => zetSonderingen(!SON.groep));
    $('son-min').addEventListener('change', (e) => { SON.min = +e.target.value; tekenBron(SON); schrijfHash(); });
    $('son-laag').addEventListener('change', (e) => { SON.alleenLaag = e.target.checked; tekenBron(SON); });
    $('btn-peilbuizen').addEventListener('click', () => zetPeilbuizen(!S.peilbuizen));
    $('peil-laag').addEventListener('change', (e) => { P.alleenLaag = e.target.checked; tekenPeilbuizen(); if (S.doorsnede) tekenDoorsnede(); });
    $('achtergrond').addEventListener('change', (e) => zetAchtergrond(e.target.value));
    $('paneel-sluit').addEventListener('click', sluitPaneel);
    $('btn-link').addEventListener('click', async () => {
      schrijfHash();
      try { await navigator.clipboard.writeText(location.href); $('btn-link').textContent = 'Gekopieerd ✓'; }
      catch { prompt('Kopieer deze link:', location.href); }
      setTimeout(() => ($('btn-link').textContent = 'Link kopiëren'), 1600);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (S.teken) stopTekenen(); else if (!$('paneel').hidden) sluitPaneel(); }
    });

    map.on('click', (e) => {
      if (S.teken) { voegPuntToe(e.latlng); return; }
      const p = ll2rd(e.latlng);
      toonKolom(p.x, p.y);
    });
    map.on('dblclick', () => { if (S.teken) rondTekenenAf(); });
    let rafId = 0, laatsteMuis = null;
    map.on('mousemove', (e) => {
      laatsteMuis = e;
      if (S.teken) tekenVoorbeeld(e.latlng);
      if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; cursorInfo(laatsteMuis); });
    });
    map.on('mouseout', () => ($('cursor-info').hidden = true));
    map.on('moveend', () => { berekenInBeeld(); tekenLijst(); schrijfHash(); });
    new ResizeObserver(() => {
      if ($('paneel').hidden) return;
      clearTimeout(koppelBediening.rt);
      koppelBediening.rt = setTimeout(() => { if (S.doorsnede) tekenDoorsnede(); else if (S.kolom?.rijen) tekenKolom(); }, 120);
    }).observe($('hoofd'));
  }

  function cursorInfo(e) {
    if (!S.meta || !e) return;
    const p = ll2rd(e.latlng), c = kolomVan(p.x), r = rijVan(p.y), el = $('cursor-info');
    let t = `RD ${fmRD(p.x)}, ${fmRD(p.y)}`;
    if (S.sel && binnen(c, r)) {
      const v = celUitCache(S.sel, c, r);
      if (v === null || v === undefined) t += ` · ${S.sel}: afwezig`;
      else if (S.modus === 'verbreiding') t += ` · ${S.sel}: ${fmNAP(v.top)} tot ${fmNAP(v.basis)} m NAP`;
      else {
        const T = S.meta.tegel, tile = S.klaar.get(`${S.sel}/${Math.floor(c / T)}_${Math.floor(r / T)}`);
        t += ` · ${S.sel} ${S.modus}: ${fmModus(S.modus, plotWaarde(S.modus, tile, (r % T) * T + (c % T), T * T))}`;
      }
    }
    el.textContent = t; el.hidden = false;
  }

  // ------------------------------------------------------------------ //
  // Start
  // ------------------------------------------------------------------ //
  async function start() {
    koppelBediening();
    const h = leesHash();
    zetAchtergrond(h.kaart && (ACHTERGRONDEN[h.kaart] || h.kaart === 'geen') ? h.kaart : 'grijs');

    if (location.protocol === 'file:') {
      melding('Open de viewer via een webserver, niet als los bestand. In de projectmap: <code>python -m http.server</code> en ga naar <code>http://localhost:8000</code>.');
      return;
    }
    try {
      const r = await fetch(`${DATA}/meta.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      S.meta = await r.json();
      const ov = await ontpak(await (await fetch(`${DATA}/overview.bin.gz`)).arrayBuffer());
      const n = Math.ceil((S.meta.cnx * S.meta.cny) / 8);
      S.meta.lagen.forEach((l, i) => {
        l.i = i; l.naam = laagNaam(l.code); l.kleur = laagKleur(l.code);
        l.tegelSet = new Set(l.tegels.map(([a, b]) => `${a}_${b}`));
        S.overzicht.push(ov.subarray(i * n, (i + 1) * n));
        S.perCode.set(l.code, l);
      });
      S.lagen = S.meta.lagen.slice().sort((a, b) => a.volgorde - b.volgorde);
    } catch (e) {
      melding(`Geen REGIS-data gevonden in <code>${esc(DATA)}/</code>. Draai eerst <code>uv run prepare_regis.py …</code> (zie README).`);
      console.error(e);
      return;
    }

    const m = S.meta;
    $('gebied').textContent = `${m.naam} · ${m.lagen.length} lagen · ${m.nx}×${m.ny} cellen`;
    $('bron').textContent = `Bron: ${m.bron} · verwerkt ${m.aangemaakt}`;
    if (!m.heeft_k) $('modus').querySelectorAll('.k').forEach((b) => (b.disabled = true));

    // rand van het datagebied; met een grens (bijv. het beheergebied) is dat de begrenzing en wordt het daarbuiten lichtgrijs
    const xa = m.x0, xb = m.x0 + m.nx * m.cel, ya = m.y0 - m.ny * m.cel, yb = m.y0;
    let startBeeld = L.latLngBounds(rd2ll(xa, ya), rd2ll(xb, yb));
    let grensGetekend = false;
    if (m.grens) {
      try {
        const gj = await (await fetch(`${DATA}/grens.geojson`)).json();
        const ringen = [];
        const verzamel = (c, diepte) => (diepte === 0 ? ringen.push(c.map(([x, y]) => rd2ll(x, y))) : c.forEach((d) => verzamel(d, diepte - 1)));
        verzamel(gj.geometry.coordinates, gj.geometry.type === 'MultiPolygon' ? 2 : 1);
        const ver = 60000, buiten = [[xa - ver, ya - ver], [xb + ver, ya - ver], [xb + ver, yb + ver], [xa - ver, yb + ver]].map(([x, y]) => rd2ll(x, y));
        L.polygon([buiten, ...ringen], { stroke: false, fillColor: '#5a6675', fillOpacity: 0.12, interactive: false }).addTo(map);
        const lijn = L.geoJSON(gj, { coordsToLatLng: (c) => rd2ll(c[0], c[1]), style: { color: '#18212b', weight: 2, fill: false }, interactive: false }).addTo(map);
        startBeeld = lijn.getBounds();
        grensGetekend = true;
      } catch (e) { console.warn('grens', e); }
    }
    if (!grensGetekend) {
      L.polygon([[xa, ya], [xb, ya], [xb, yb], [xa, yb]].map(([x, y]) => rd2ll(x, y)),
        { color: '#5a6675', weight: 1, dashArray: '3 4', fill: false, interactive: false }).addTo(map);
    }

    schrijfHash.uit = true;
    if (h.x && h.y) map.setView(rd2ll(+h.x, +h.y), +h.z || 6);
    else map.fitBounds(startBeeld, { padding: [20, 20] });
    if (h.weergave && MODI[h.weergave] && !(MODI[h.weergave].log && !m.heeft_k)) {
      S.modus = h.weergave;
      $('modus').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.m === S.modus ? 'true' : 'false'));
    }
    if (h.laag && S.perCode.has(h.laag)) S.sel = h.laag;
    if (h.bmin && isFinite(+h.bmin)) { B.min = +h.bmin; $('bor-min').value = h.bmin; }
    if (h.bbuf && isFinite(+h.bbuf)) S.dsBuffer = +h.bbuf;
    if (h.gebied) {
      const pts = h.gebied.split(';').map((p) => p.split(',').map(Number)).filter((p) => p.length === 2 && p.every(isFinite));
      if (pts.length >= 3) zetGebied(pts, !(h.x && h.y));
    }
    if (!m.boringen) $('btn-boringen').title = 'Geen boringen in deze data; draai prepare_regis.py opnieuw';
    if (!m.peilbuizen) $('btn-peilbuizen').title = 'Geen peilbuizen in deze data; draai prepare_regis.py opnieuw';
    if (h.smin && isFinite(+h.smin)) { SON.min = +h.smin; $('son-min').value = h.smin; }
    if (!m.sonderingen) $('btn-sonderingen').title = 'Geen sonderingen in deze data; draai prepare_regis.py opnieuw';
    if (h.boringen) zetBoringen(true);
    if (h.sonderingen || h.bor?.startsWith('CPT')) zetSonderingen(true);
    if (m.peilbuizen && h.peilbuizen !== '0') zetPeilbuizen(true);  // standaard aan
    schrijfHash.uit = false;

    berekenInBeeld();
    tekenLijst();
    if (S.sel) tekenLaag();
    if (h.ds) {
      const pts = h.ds.split(';').map((p) => p.split(',').map(Number)).filter((p) => p.length === 2 && p.every(isFinite));
      if (pts.length >= 2) maakDoorsnede(pts);
    } else if (h.bor && (m.boringen || m.sonderingen)) {
      laadBron(h.bor.startsWith('CPT') ? SON : B).then(() => toonBoring(zoekBoorpunt(h.bor)), (e) => console.warn('boringen', e));
    } else if (h.put && m.peilbuizen) {
      laadPeilbuizen().then(() => toonPut(P.perId.get(h.put)), (e) => console.warn('peilbuizen', e));
    } else if (h.p) {
      const [x, y] = h.p.split(',').map(Number);
      if (isFinite(x) && isFinite(y)) toonKolom(x, y);
    }
    schrijfHash();
  }

  start();
})();
