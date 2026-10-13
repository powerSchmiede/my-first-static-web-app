// Katalog der Rechte in Fremdsystemen (zunächst DATEV). Diese Rechte werden nicht in
// KanzleiMind wirksam, sondern in DATEV gesetzt. KanzleiMind organisiert Vorbefüllung durch
// die Kanzlei, Freigabe durch den Mandanten und dokumentiert den freigegebenen Stand.
//
// Aufbau wie in der Rechte-Übersicht der Kanzlei: Bereich (1. Ebene) → Recht (2. Ebene).
// Weitere Rechte oder Systeme werden hier ergänzt; Oberfläche und Prüfungen übernehmen sie.

const { HttpError } = require('./errors');

const SYSTEMS = [
  {
    key: 'datev',
    title: 'DATEV',
    areas: [
      {
        key: 'belege_personal',
        title: 'Belege Personal',
        rights: [
          { key: 'lohn_unterlagen', title: 'DATEV Lohn-Unterlagen', description: 'Auf Belege zugreifen, die für die Digitale Personalakte in den Lohnprogrammen bestimmt sind.' },
          { key: 'reisekosten_belege', title: 'DATEV Reisekosten-Belege', description: 'Auf Reisekosten-Belege zugreifen, die für die Digitale Personalakte in den Lohnprogrammen bestimmt sind.' },
        ],
      },
      {
        key: 'bank',
        title: 'Bank €',
        rights: [
          { key: 'lohn_auftrag_senden', title: 'Lohn (Auftrag anzeigen/senden)', description: 'Aus den DATEV Lohn-Anwendungen erstellte Zahlungsaufträge anzeigen und senden.' },
          { key: 'lohn_auftrag_bearbeiten', title: 'Lohn (Auftrag bearbeiten/Vorlagen)', description: 'Aus den DATEV Lohn-Anwendungen erstellte Zahlungsaufträge bearbeiten.' },
          { key: 'kontoumsaetze', title: 'Kontoumsätze', description: 'Kontostand und Kontoumsätze anzeigen und bearbeiten.' },
        ],
      },
      {
        key: 'auswertungen_personal',
        title: 'Auswertungen Personal',
        rights: [
          { key: 'detailrechte', title: 'Detailrechte', description: 'Anzeigen, Drucken und Exportieren verschiedener Personalwirtschafts-Auswertungen. Zum Teil sind Personalnummern-Intervalle freizugeben.' },
        ],
      },
      {
        key: 'personalwirtschaft',
        title: 'Personalwirtschaft',
        rights: [
          { key: 'lohnimportdatenservice', title: 'Lohnimportdatenservice', description: 'ASCII-Importdateien mit Stamm- bzw. Bewegungsdaten aus einem Vorsystem an das DATEV-Rechenzentrum übertragen und in das Lohnprogramm importieren.' },
          { key: 'lohnauswertungsdatenservice', title: 'Lohnauswertungsdatenservice', description: 'Lohnauswertungen automatisch im DATEV-Rechenzentrum für den Abruf durch ein Fremdanbieter-System bereitstellen (Auswertungsrechte Personal zwingend erforderlich).' },
          { key: 'lohnaustauschdatenservice', title: 'Lohnaustauschdatenservice', description: 'Daten über das Rechenzentrum zwischen einem Fremdanbieter-System und LODAS oder Lohn und Gehalt austauschen.' },
          { key: 'lohnergebnisdatenservice', title: 'Lohnergebnisdatenservice', description: 'Lohnergebnisdaten automatisch im DATEV-Rechenzentrum für den Abruf durch ein Fremdanbieter-System bereitstellen.' },
          { key: 'personaldaten', title: 'Personaldaten', description: 'Vorerfassungslösung für die Zusammenarbeit zwischen steuerlichem Berater, Mandant und Mitarbeiter.' },
        ],
      },
    ],
  },
];

// Vollständiger Schlüssel eines Rechts: "<system>.<bereich>.<recht>", z. B. "datev.bank.kontoumsaetze"
const RIGHTS = SYSTEMS.flatMap(system => system.areas.flatMap(area => area.rights.map(right => ({
  key: `${system.key}.${area.key}.${right.key}`,
  system: system.key,
  area: area.title,
  title: right.title,
  description: right.description,
}))));
const RIGHT_KEYS = new Set(RIGHTS.map(r => r.key));

function catalog(systemKey) {
  const system = SYSTEMS.find(s => s.key === systemKey);
  if (!system) throw new HttpError(404, 'Unbekanntes System.');
  return {
    key: system.key,
    title: system.title,
    areas: system.areas.map(area => ({
      key: area.key,
      title: area.title,
      rights: area.rights.map(right => ({ key: `${system.key}.${area.key}.${right.key}`, title: right.title, description: right.description })),
    })),
  };
}

function validateRights(systemKey, value) {
  if (!SYSTEMS.some(s => s.key === systemKey)) throw new HttpError(400, 'Unbekanntes System.');
  if (!Array.isArray(value) || value.length > 500 || value.some(k => typeof k !== 'string' || !RIGHT_KEYS.has(k) || !k.startsWith(`${systemKey}.`))) {
    throw new HttpError(400, 'Unbekanntes Recht.');
  }
  return RIGHTS.filter(r => value.includes(r.key)).map(r => r.key);
}

function title(key) {
  const right = RIGHTS.find(r => r.key === key);
  return right ? `${right.area} › ${right.title}` : key;
}

module.exports = { SYSTEMS, RIGHTS, catalog, validateRights, title };
