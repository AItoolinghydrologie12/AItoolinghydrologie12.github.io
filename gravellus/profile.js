"use strict";
/* Gravellus — eigen BRouter-profiel voor Gravel, client-side gegenereerd uit de gekozen opties (puur, geen DOM).
 * Wordt met POST naar https://brouter.de/brouter/profile geüpload; het antwoord is {"profileid":"custom_…"}.
 *
 * Afgeleid van "gravel.brf" (quaelnix, in abrensch/brouter, MIT) en daarvan ingekort. Afwijkingen:
 *  - weggelaten: natte-omstandighedenvarianten, verkeers-/geluids-/stads-/bos-/rivierschattingen en hoogte-opties
 *    (de publieke server rekent die toch niet allemaal door, en we hebben ze niet nodig);
 *  - nieuw: voorkeur ondergrond (asfalt duurder / onverhard goedkoper, of andersom) — zie PREF;
 *  - nieuw: zand zwaar bestraffen, klinkers/keien optioneel bestraffen (schelpen en woodchips staan niet in BRouters lookups.dat);
 *  - nieuw: primary/secondary/tertiary zonder aanliggend fietspad (cycleway=track/lane) veel duurder;
 *  - behouden: kinematisch model, eenrichtingsregels, toegangsregels, smoothness-schatting, tracktype, mtb:scale.
 */
(function(root){

// kostenfactoren per voorkeur: asph = vermenigvuldiger op asfalt/beton/paved; unp = op onverharde tracks/paden
const PREF = {
  max:      {asph:1.6,  unp:0.8},
  balanced: {asph:1.0,  unp:1.0},
  paved:    {asph:0.85, unp:1.5}
};
const DEFAULTS = {pref:"max", avoidSand:true, avoidBusy:true, allowCobbles:true, avoidTown:false};

function normalize(o){
  const r = Object.assign({}, DEFAULTS, o || {});
  if(!PREF[r.pref]) r.pref = DEFAULTS.pref;
  r.avoidSand = !!r.avoidSand; r.avoidBusy = !!r.avoidBusy; r.allowCobbles = !!r.allowCobbles; r.avoidTown = !!r.avoidTown;
  return r;
}

function build(opts){
  const o = normalize(opts), p = PREF[o.pref];
  const busy = o.avoidBusy, town = o.avoidTown;
  return `# Gravellus-gravelprofiel (gegenereerd). Opties: voorkeur=${o.pref}, vermijd zand=${o.avoidSand}, vermijd drukke wegen=${o.avoidBusy}, klinkers/schelpen=${o.allowCobbles}, vermijd bebouwde kom=${o.avoidTown}
# Afgeleid van gravel.brf (quaelnix, abrensch/brouter, MIT); zie profile.js voor de afwijkingen.

---context:global

assign turnInstructionRoundabouts true
assign considerTurnRestrictions true
assign turnInstructionMode 1
assign add_beeline false
assign pass1coefficient 4
assign validForBikes true

# kinematisch model (reistijd), ongewijzigd
assign totalMass  90
assign maxSpeed   35
assign S_C_x      0.300
assign C_r        0.005
assign bikerPower 150

# als gravel.brf: standaard worden lange stukken naar via-punten weggehaald; dat willen we niet
assign correctMisplacedViaPoints false
assign correctMisplacedViaPointsDistance 400

---context:way

assign downhillcost   0
assign downhillcutoff 1.5
assign uphillcost     0
assign uphillcutoff   1.5

# aanliggend gescheiden fietspad (links of rechts): zo'n weg telt niet als "druk"
assign sep_cycleway
    or cycleway=track|lane
    or cycleway:both=track|lane
    or cycleway:right=track|lane
       cycleway:left=track|lane

assign any_cycleway or cycleway=track|lane|shared_lane|shared
                    or and cycleway:right=track|lane|shared_lane reversedirection=
                       and cycleway:left=track|lane|shared_lane reversedirection=yes

assign any_cycleroute
    or route_bicycle_icn=yes or route_bicycle_ncn=yes or route_bicycle_rcn=yes route_bicycle_lcn=yes

assign turncost switch junction=roundabout 15 65

assign is_main_road highway=primary|primary_link|secondary|secondary_link|tertiary|tertiary_link
assign initialclassifier switch route=ferry 4 switch is_main_road 3 switch footway=crossing 2 1
assign initialcost switch route=ferry 20000 switch is_main_road 400 20

assign nobikeaccess switch bicycle= switch vehicle= access=no|private vehicle=no|private bicycle=no|private|dismount
assign nofootaccess switch foot= ( and access=no|private ( not bicycle=dismount ) ) foot=no|private

assign badoneway
    switch not reversedirection=yes     oneway=-1
        switch oneway=yes|reversible    not oneway:bicycle=no
                                        or junction=roundabout oneway:bicycle=yes

assign onewaypenalty
    switch or ( not badoneway ) ( or cycleway=opposite|opposite_lane|opposite_track oneway:bicycle=no ) 1
    switch not junction=roundabout                                                                      5
                                                                                                        20

# gladheid, als gravel.brf (droog); schat uit smoothness, anders surface, tracktype of highway
assign smoothnesspenalty
    switch smoothness=excellent         1.0
    switch smoothness=good              1.1
    switch smoothness=intermediate      1.3
    switch smoothness=bad               1.5
    switch smoothness=very_bad          3.0
    switch smoothness=horrible          8.0
    switch smoothness=very_horrible     9.4
    switch smoothness=impassable        100
        switch not cycleway:surface=
            switch cycleway:surface=asphalt                     1.1
            switch cycleway:surface=fine_gravel|compacted       1.2
            switch cycleway:surface=concrete|paving_stones      1.3
            switch cycleway:surface=paved                       1.4
            switch cycleway:surface=gravel                      1.5
            switch cycleway:surface=unpaved                     1.6
            switch cycleway:surface=cobblestone|sett            1.7
                                                                1.6
        switch surface=asphalt                              1.1
        switch concrete=plates|lanes                        1.2
        switch surface=fine_gravel|compacted                1.2
        switch surface=concrete|paving_stones               1.3
        switch surface=paved                                1.4
        switch surface=gravel                               1.5
        switch surface=wood|metal                           1.6
        switch surface=cobblestone|sett                     1.7
        switch surface=grass_paver                          1.8
        switch surface=pebblestone                          1.9
        switch highway=track
                switch tracktype=grade1    1.2
                switch tracktype=grade2    1.4
                switch tracktype=grade3    1.6
                switch tracktype=grade4    2.6
                switch tracktype=grade5    2.8
                                           3.6
        switch highway=primary|primary_link|secondary|secondary_link|tertiary|tertiary_link    1.0
        switch highway=service|unclassified|living_street|residential                          1.1
        switch highway=cycleway                                                                1.2
        switch surface=unpaved                                  1.6
        switch surface=ground|grass|dirt|earth|mud|clay|sand    2.6
                                                                1.6

# NIEUW: voorkeur ondergrond en wegdek-opties (vermenigvuldigers op de gladheidsstraf)
assign is_asphalt_like surface=asphalt|concrete|paved
assign is_unpaved_track
    and highway=track|path|cycleway
        or surface=gravel|fine_gravel|compacted|ground|dirt|earth|unpaved|pebblestone|grass|mud|clay
           and surface= highway=track

assign smoothnesspenalty
    multiply smoothnesspenalty
        switch surface=sand                                   ${o.avoidSand ? 4 : 1}
        switch surface=paving_stones|sett|cobblestone   ${o.allowCobbles ? 1 : 3}
        switch is_asphalt_like                                ${p.asph}
        switch is_unpaved_track                               ${p.unp}
                                                              1

assign footwaypenalty
    switch bicycle=yes|designated
        switch segregated=yes      1.8
                                   2.6
    switch not footway=sidewalk    3.2
                                   4.9

assign cyclewaypenalty
    switch not foot=yes|designated 1.0
        switch segregated=yes      1.2
                                   2.4

assign pathpenalty
    switch bicycle=yes|designated
        switch not foot=yes|designated    1.1
            switch segregated=yes         1.8
                                          2.4
    switch foot=designated                4.9
    switch lesser smoothnesspenalty 1.6   1.1
    switch not and surface= smoothness=   3.0
                                          4.9

assign stepspenalty
    switch ramp:stroller=yes         75
    switch ramp:bicycle=yes          150
    switch surface=paving_stones     180
                                     1000

assign tracktypepenalty
    switch tracktype=grade1    1.0
    switch tracktype=grade2    1.1
    switch tracktype=grade3    1.2
    switch tracktype=grade4    1.5
    switch tracktype=grade5    1.8
    switch highway=track       1.3
                               1.0

assign hikingpenalty
    if sac_scale=     then 1.0 else    if sac_scale=hiking    then 2.5 else 10000

assign mtbpenalty
    if mtb:scale=     then 1.0 else    if mtb:scale=0-    then 1.2 else
    if mtb:scale=0    then 1.5 else    if mtb:scale=0+    then 3.0 else 9.0

assign notcycleroutepenalty switch any_cycleroute 1.0 1.03
assign notcyclewaypenalty switch bicycle_road=yes 1.0 switch any_cycleway 1.02 1.06

assign maxspeedpenalty
    switch maxspeed=50   1.0
    switch maxspeed=60   1.1
    switch maxspeed=70   1.3
    switch maxspeed=80   1.4
    switch maxspeed=90   1.6
    switch maxspeed=100  1.8 switch highway=primary|secondary 1.8 1.0

# NIEUW: bebouwde kom vermijden. BRouter's estimated_town_class ontbreekt op de publieke server, dus we gebruiken
# aanwijzingen die in en om dorpen voorkomen: straatverlichting (lit), woonstraten, woonerven en 30-zones.
# Alleen een kostenfactor: wie in de stad begint, komt er nog gewoon uit, maar de route blijft er zo kort mogelijk.
assign townpenalty
${town ? `    multiply switch lit=yes|automatic|24/7|sunset-sunrise 1.7 1.0
    multiply switch highway=residential|living_street|service 1.6 1.0
             switch maxspeed=30 1.2 1.0` : "    1.0"}

assign costfactor
    multiply townpenalty
    multiply notcycleroutepenalty
    multiply notcyclewaypenalty multiply maxspeedpenalty
    multiply smoothnesspenalty multiply onewaypenalty
    multiply hikingpenalty multiply mtbpenalty
    multiply switch bicycle=use_sidepath 1.6 1
    multiply switch nobikeaccess 6 1
    multiply tracktypepenalty
    switch or highway=motorway|motorway_link motorroad=yes      10000
    switch    and nobikeaccess nofootaccess                     10000
    switch    highway= switch not route=ferry                   10000 2
    switch    highway=trunk|trunk_link switch any_cycleroute    20 80
    switch    highway=bridleway|raceway switch not bicycle=yes  20 5
    switch    highway=pedestrian switch not bicycle=yes         8 3
    switch    highway=primary|primary_link                      ${busy ? "switch sep_cycleway 2.6 16" : "4.8"}
    switch    highway=secondary|secondary_link                  ${busy ? "switch sep_cycleway 2.4 11" : "4.2"}
    switch    highway=tertiary|tertiary_link                    ${busy ? "switch sep_cycleway 2.0 5.0" : "3.6"}
    switch    highway=corridor                                  3.2
    switch    highway=road                                      2.8
    switch    highway=unclassified switch not any_cycleroute    2.6 1.4
    switch    highway=living_street                             2.5
    switch    highway=service switch service=                   2.4 3.0
    switch    highway=residential switch not maxspeed=30        2.2 1.8
    switch    highway=track                                     1.0
    switch    highway=path                                      pathpenalty
    switch    highway=steps                                     stepspenalty
    switch    highway=footway                                   footwaypenalty
    switch    highway=cycleway                                  cyclewaypenalty
                                                                10000

---context:node

assign nobikeaccess switch bicycle= switch vehicle= access=no|private vehicle=no|private bicycle=no|private|dismount
assign nofootaccess switch foot= ( and access=no|private ( not bicycle=dismount ) ) foot=no|private

assign barrierpenalty
    switch barrier=                0
    switch barrier=block|bollard   25
    switch barrier=gate|swing_gate 50
    switch barrier=cycle_barrier   87
                                   139

assign initialcost
    add barrierpenalty
    switch    and nobikeaccess nofootaccess    1000000
    switch    railway=level_crossing           300
    switch    nobikeaccess                     200
    switch    railway=crossing                 35
    switch    not traffic_calming=             25
    switch    highway=traffic_signals|crossing 20
                                               0
`;
}

// korte, stabiele sleutel (djb2) van de profieltekst, voor de cache van het geüploade profiel-id
function key(text){
  let h = 5381;
  for(let i=0; i<text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

root.GP = {build, key, normalize, PREF, DEFAULTS};
})(typeof window !== "undefined" ? window : globalThis);
