/* Ty Bufala Mobile — deterministic, disjoint herd categories; no network requests. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TyBufalaHerdOverview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const CATEGORIES = Object.freeze([
    {id:'lactating', label:'En lactation', hint:'État confirmé'},
    {id:'dry', label:'Taries', hint:'État confirmé'},
    {id:'heifers', label:'Génisses', hint:'N’ayant jamais vêlé, confirmé'},
    {id:'youngFemales', label:'Jeunes femelles', hint:'Moins de 12 mois'},
    {id:'youngMales', label:'Jeunes mâles', hint:'Moins de 24 mois'},
    {id:'breedingBulls', label:'Taureaux', hint:'Reproducteurs confirmés'},
    {id:'adultMales', label:'Autres mâles adultes', hint:'Non classés reproducteurs'},
    {id:'femaleUnknown', label:'Femelles à préciser', hint:'Statut de lactation / reproduction inconnu'},
    {id:'unknown', label:'Autres à préciser', hint:'Sexe ou âge manquant'},
  ]);
  const CATEGORICAL = new Set(CATEGORIES.map(x=>x.id));
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const y=Number(s.slice(0,4)),m=Number(s.slice(5,7)),d=Number(s.slice(8));
    const x=new Date(Date.UTC(y,m-1,d));
    return x.getUTCFullYear()===y && x.getUTCMonth()===m-1 && x.getUTCDate()===d;
  }
  function ageMonths(birth, today) {
    if (!validDate(birth) || !validDate(today) || birth>today) return null;
    let months=(+today.slice(0,4)- +birth.slice(0,4))*12+(+today.slice(5,7)- +birth.slice(5,7));
    if (+today.slice(8) < +birth.slice(8)) months--;
    return months;
  }
  function classify(animal, today) {
    if (!animal || animal.status!=='present') return null;
    const age=ageMonths(animal.birthDate, today);
    if (animal.sex==='F') {
      if (age!==null && age<12) return 'youngFemales';
      if (animal.productionStatus==='lactating') return 'lactating';
      if (animal.productionStatus==='dry') return 'dry';
      if (animal.reproductiveStatus==='heifer' && !animal.lastCalving) return 'heifers';
      return 'femaleUnknown';
    }
    if (animal.sex==='M') {
      if (age!==null && age<24) return 'youngMales';
      if (animal.maleRole==='breeding_bull') return 'breedingBulls';
      return age===null && !animal.maleRole ? 'unknown' : 'adultMales';
    }
    return 'unknown';
  }
  function summarize(animals, today) {
    const counts=Object.fromEntries(CATEGORIES.map(c=>[c.id,0]));
    const members=Object.fromEntries(CATEGORIES.map(c=>[c.id,[]]));
    let total=0;
    for(const animal of animals||[]) {
      const group=classify(animal,today);
      if (!CATEGORICAL.has(group)) continue;
      total++;
      counts[group]++;
      members[group].push(animal.id);
    }
    return {total,counts,members,unclassified:counts.femaleUnknown+counts.adultMales+counts.unknown};
  }
  function validateAnimalCategory(a, today) {
    if (!a || typeof a!=='object') return 'Fiche animal invalide.';
    const production=a.productionStatus||'', repro=a.reproductiveStatus||'', role=a.maleRole||'';
    if(!['','lactating','dry'].includes(production)) return 'État de lactation non reconnu.';
    if(!['','heifer','calved'].includes(repro)) return 'Statut de reproduction non reconnu.';
    if(!['','breeding_bull','other'].includes(role)) return 'Rôle du mâle non reconnu.';
    if (a.sex!=='F' && (production || repro)) return 'Lactation ou génisse : sélectionner une femelle.';
    if (a.sex!=='M' && role) return 'Le statut de taureau concerne seulement les mâles.';
    if (repro==='heifer' && (production || a.lastCalving)) return 'Une génisse ne peut pas être déclarée en lactation, tarie ou avoir déjà vêlé.';
    const age=ageMonths(a.birthDate,today);
    if (age!==null && age<12 && production) return 'Un jeune animal de moins de 12 mois ne peut pas être déclaré en lactation ou tari.';
    if (a.productionStatusDate && !validDate(a.productionStatusDate)) return 'Date du statut de lactation incorrecte.';
    return '';
  }
  return {CATEGORIES,ageMonths,classify,summarize,validateAnimalCategory};
});