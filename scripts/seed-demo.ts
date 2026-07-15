/**
 * Demo seeder — two complete example businesses for Company Brain.
 *
 *   npm run seed:demo                     # seeds both demo orgs
 *   npm run seed:demo -- --email you@x.y  # attach that account as owner
 *   npm run seed:demo -- --reset          # delete + recreate the demo orgs
 *
 * Seeds "Demo Bau GmbH" (construction contractor) and "Ristorante Bella Vista"
 * (restaurant): keywords on several levels with definitions, explanations,
 * examples, synonyms and hard business rules; semantic relations; a realistic
 * dataset; metrics; and open tasks. Afterwards run `npm run vault -- --org
 * demo-bau` (or `--org demo-restaurant`) and point Claude Code at the folder.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { computeCompleteness } from '../src/lib/ontology/completeness';

function loadEnv() {
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

// ---------------------------------------------------------------------------
// Seed content
// ---------------------------------------------------------------------------

interface SeedKeyword {
  slug: string;
  title: string;
  parent?: string; // parent slug
  type?: string;
  access?: 'worker' | 'manager' | 'admin';
  definition: string;
  explanation?: string;
  examples?: string[];
  synonyms?: string[];
  rules?: string[];
}

interface SeedRelation {
  from: string;
  to: string;
  type: string;
  note?: string;
}

interface SeedBusiness {
  name: string;
  slug: string;
  industry: string;
  keywords: SeedKeyword[];
  relations: SeedRelation[];
  dataset: {
    title: string;
    description: string;
    keyword: string; // keyword slug the dataset belongs to
    table: string;
    columns: Array<{ name: string; normalized: string; type: 'text' | 'number' | 'date' | 'boolean' }>;
    rows: Array<Record<string, unknown>>;
  };
  metrics: Array<{
    name: string;
    description: string;
    aggregation: string;
    value_column: string;
    date_column?: string;
    time_grain?: string;
    formula?: string;
    caveats?: string;
    keyword: string;
  }>;
  tasks: Array<{ title: string; status: string; priority: string; keyword?: string; due_date?: string }>;
}

const CONSTRUCTION: SeedBusiness = {
  name: 'Demo Bau GmbH',
  slug: 'demo-bau',
  industry: 'construction',
  keywords: [
    {
      slug: 'projekt', title: 'Projekt', type: 'concept',
      definition: 'Ein Bauvorhaben mit eigenem Auftrag, Budget, Zeitplan und verantwortlichem Bauleiter.',
      explanation: 'Bei uns ist ein Projekt immer an genau einen Auftrag gebunden. Alles — Stunden, Material, Rechnungen, Mängel — wird auf das Projekt gebucht. Ein Projekt gilt erst als abgeschlossen, wenn die Schlussrechnung bezahlt und die Abnahme dokumentiert ist.',
      examples: ['EFH Neubau Bergstraße 12', 'Dachsanierung Kita Sonnenschein', 'Anbau Lagerhalle Weber KG'],
      synonyms: ['Bauvorhaben', 'BV'],
      rules: ['Jedes Projekt hat genau einen verantwortlichen Bauleiter', 'Keine Buchung ohne Projektnummer'],
    },
    {
      slug: 'baustelle', title: 'Baustelle', parent: 'projekt', type: 'concept', access: 'worker',
      definition: 'Der physische Ort, an dem die Bauarbeiten eines Projekts ausgeführt werden.',
      explanation: 'Ein Projekt kann mehrere Baustellen haben (z. B. Haupthaus und Garage). Auf der Baustelle gelten die Sicherheitsregeln, und dort wird das Bautagebuch geführt.',
      examples: ['Bergstraße 12, 71634 Ludwigsburg'],
      rules: ['Betreten nur mit PSA (Helm, Sicherheitsschuhe, Warnweste)'],
    },
    {
      slug: 'bauzeitplan', title: 'Bauzeitplan', parent: 'projekt', type: 'document_type', access: 'manager',
      definition: 'Der Terminplan eines Projekts mit allen Gewerken, Meilensteinen und Abhängigkeiten.',
      explanation: 'Wird vom Bauleiter gepflegt. Verzögerungen über 3 Arbeitstage müssen dem Auftraggeber schriftlich gemeldet werden.',
      synonyms: ['Terminplan'],
      rules: ['Verzug > 3 Arbeitstage schriftlich an den Auftraggeber melden'],
    },
    {
      slug: 'bautagebuch', title: 'Bautagebuch', parent: 'projekt', type: 'document_type', access: 'worker',
      definition: 'Tägliche Aufzeichnung über Wetter, anwesende Kolonnen, ausgeführte Arbeiten und besondere Vorkommnisse je Baustelle.',
      explanation: 'Das Bautagebuch ist unser wichtigstes Beweismittel bei Streit über Bauablauf, Behinderungen und Nachträge. Fotos gehören immer dazu.',
      examples: ['12.05.: Regen ab 11 Uhr, Estricharbeiten EG abgebrochen, 4 Mann vor Ort'],
      rules: ['Täglich vor Feierabend ausfüllen — auch bei Stillstand', 'Mindestens 3 Fotos pro Eintrag'],
    },
    {
      slug: 'nachtrag', title: 'Nachtrag', parent: 'projekt', type: 'process', access: 'manager',
      definition: 'Eine zusätzliche oder geänderte Leistung, die nicht im ursprünglichen Auftrag enthalten ist und gesondert beauftragt und vergütet wird.',
      explanation: 'Nachträge entstehen durch Änderungswünsche des Auftraggebers oder unvorhersehbare Umstände (z. B. Baugrund). Ohne schriftliche Beauftragung wird die Leistung nicht ausgeführt — mündliche Zusagen zählen nicht.',
      examples: ['Nachtrag 03: zusätzliche Drainage wegen Hangwasser, 4.800 € netto'],
      rules: ['Kein Nachtrag ohne schriftliche Beauftragung vor Ausführung', 'Nachtragsangebot innerhalb von 5 Arbeitstagen nach Feststellung'],
    },
    {
      slug: 'angebot', title: 'Angebot', type: 'document_type',
      definition: 'Unser schriftliches, verbindliches Preisangebot für eine angefragte Bauleistung.',
      explanation: 'Angebote kalkuliert der Bauleiter zusammen mit dem Büro auf Basis des Leistungsverzeichnisses. Gültigkeit standardmäßig 4 Wochen.',
      synonyms: ['Offerte'],
      rules: ['Angebote über 50.000 € netto gibt die Geschäftsführung frei', 'Gültigkeitsdauer immer angeben (Standard: 4 Wochen)'],
    },
    {
      slug: 'leistungsverzeichnis', title: 'Leistungsverzeichnis', parent: 'angebot', type: 'document_type', access: 'manager',
      definition: 'Die detaillierte Auflistung aller zu erbringenden Teilleistungen mit Mengen und Einheitspreisen.',
      synonyms: ['LV'],
      examples: ['Pos. 02.010: Mauerwerk KS 17,5 cm, 240 m², 68,50 €/m²'],
    },
    {
      slug: 'auftrag', title: 'Auftrag', type: 'document_type',
      definition: 'Die schriftliche Beauftragung durch den Auftraggeber auf Basis unseres Angebots.',
      explanation: 'Erst mit unterschriebenem Auftrag (oder Auftragsbestätigung) beginnen wir zu arbeiten. Der Auftrag definiert Leistung, Preis und Termine — er ist die Grundlage für alle Rechnungen und Nachträge.',
      rules: ['Kein Baubeginn ohne unterschriebenen Auftrag'],
    },
    {
      slug: 'rechnung', title: 'Rechnung', type: 'document_type',
      definition: 'Ein Dokument, mit dem wir erbrachte Leistungen gegenüber dem Auftraggeber abrechnen.',
      explanation: 'Rechnungen schreibt das Büro auf Basis des geprüften Aufmaßes. Zahlungsziel standardmäßig 14 Tage, bei Skonto-Vereinbarung 8 Tage mit 2 % Skonto.',
      synonyms: ['Faktura'],
      rules: ['Jede Rechnung referenziert Auftrag und Aufmaß', 'Zahlungsziel 14 Tage, danach Mahnlauf'],
    },
    {
      slug: 'abschlagsrechnung', title: 'Abschlagsrechnung', parent: 'rechnung', type: 'document_type',
      definition: 'Eine Zwischenrechnung über bereits erbrachte Teilleistungen während der Bauphase.',
      explanation: 'Wir stellen Abschläge monatlich nach Baufortschritt, um die Liquidität zu sichern. Grundlage ist immer ein gemeinsames Aufmaß.',
      synonyms: ['Abschlag', 'AZ'],
      rules: ['Monatlich stellen, sobald Leistung > 10.000 € aufgelaufen ist'],
    },
    {
      slug: 'schlussrechnung', title: 'Schlussrechnung', parent: 'rechnung', type: 'document_type',
      definition: 'Die finale Rechnung eines Projekts nach Abnahme, die alle Leistungen, Nachträge und bereits gezahlten Abschläge saldiert.',
      rules: ['Erst nach dokumentierter Abnahme stellen', 'Innerhalb von 10 Arbeitstagen nach Abnahme'],
    },
    {
      slug: 'eingangsrechnung', title: 'Eingangsrechnung', parent: 'rechnung', type: 'document_type', access: 'manager',
      definition: 'Eine Rechnung, die wir von Lieferanten oder Subunternehmern erhalten.',
      rules: ['Nur zahlen, wenn Lieferschein oder Leistungsnachweis vorliegt', 'Skonto nutzen, wenn angeboten — Prüfung innerhalb von 5 Tagen'],
    },
    {
      slug: 'aufmass', title: 'Aufmaß', type: 'process', access: 'worker',
      definition: 'Das Messen und Dokumentieren der tatsächlich erbrachten Leistungsmengen auf der Baustelle.',
      explanation: 'Ohne sauberes Aufmaß keine Rechnung. Gemessen wird nach VOB/C. Das Aufmaß unterschreiben idealerweise beide Seiten direkt vor Ort.',
      examples: ['Aufmaß Estrich EG: 84,3 m² am 14.05. mit Bauherr gegengezeichnet'],
      rules: ['Aufmaß vor jeder Rechnung erstellen', 'Nach VOB/C messen, Skizze + Fotos beilegen'],
    },
    {
      slug: 'mangel', title: 'Mangel', type: 'process', access: 'worker',
      definition: 'Eine Abweichung der ausgeführten Leistung vom vertraglich geschuldeten Zustand.',
      explanation: 'Mängel werden bei Begehungen oder der Abnahme festgestellt. Jeder Mangel wird mit Foto, Ort und Frist dokumentiert und einem Verantwortlichen zugewiesen. Offene Mängel blockieren die Abnahme.',
      examples: ['Riss im Estrich Flur OG', 'Fenster WC schließt nicht dicht'],
      synonyms: ['Baumangel', 'Defekt'],
      rules: ['Jeder Mangel: Foto + Ort + Frist + Verantwortlicher', 'Nachbesserung innerhalb der gesetzten Frist, sonst Eskalation an Bauleiter'],
    },
    {
      slug: 'nachbesserung', title: 'Nachbesserung', parent: 'mangel', type: 'process', access: 'worker',
      definition: 'Die Beseitigung eines festgestellten Mangels durch den Verursacher.',
      rules: ['Nach Nachbesserung Foto als Erledigungsnachweis hochladen'],
    },
    {
      slug: 'abnahme', title: 'Abnahme', type: 'process', access: 'manager',
      definition: 'Die förmliche Prüfung und Anerkennung der Bauleistung durch den Auftraggeber, dokumentiert im Abnahmeprotokoll.',
      explanation: 'Die Abnahme ist der wichtigste rechtliche Moment des Projekts: Gefahrenübergang, Beweislastumkehr und Beginn der Gewährleistung. Ohne Abnahme keine Schlussrechnung.',
      examples: ['Abnahmeprotokoll EFH Bergstraße vom 28.06. mit 2 Restmängeln'],
      rules: ['Immer schriftliches Abnahmeprotokoll mit Unterschrift beider Seiten', 'Restmängel mit Frist im Protokoll festhalten'],
    },
    {
      slug: 'gewaehrleistung', title: 'Gewährleistung', type: 'rule', access: 'manager',
      definition: 'Unsere gesetzliche Pflicht, Mängel zu beseitigen, die innerhalb der Frist nach Abnahme auftreten (VOB: 4 Jahre, BGB: 5 Jahre).',
      explanation: 'Die Frist beginnt mit der Abnahme. Deshalb werden Abnahmeprotokolle 10 Jahre archiviert. Gewährleistungsmängel laufen über denselben Mangelprozess, aber ohne neue Vergütung.',
      rules: ['Abnahmeprotokolle 10 Jahre archivieren', 'Gewährleistungsbürgschaft erst nach Fristablauf zurückgeben'],
    },
    {
      slug: 'bauleiter', title: 'Bauleiter', type: 'role', access: 'worker',
      definition: 'Die Person, die ein Projekt fachlich und organisatorisch verantwortet: Termine, Qualität, Kosten, Sicherheit.',
      synonyms: ['BL'],
      examples: ['Der Bauleiter zeichnet Aufmaße und Nachträge frei'],
    },
    {
      slug: 'polier', title: 'Polier', type: 'role', access: 'worker',
      definition: 'Der erfahrene Vorarbeiter, der die Kolonne auf der Baustelle führt und die tägliche Ausführung steuert.',
      synonyms: ['Vorarbeiter'],
    },
    {
      slug: 'subunternehmer', title: 'Subunternehmer', type: 'role', access: 'manager',
      definition: 'Ein Fremdunternehmen, das wir mit Teilleistungen (Gewerken) beauftragen.',
      explanation: 'Subunternehmer brauchen vor dem ersten Einsatz: Freistellungsbescheinigung, Betriebshaftpflicht-Nachweis und unterschriebenen Nachunternehmervertrag.',
      synonyms: ['Sub', 'Nachunternehmer'],
      rules: ['Kein Einsatz ohne Freistellungsbescheinigung + Haftpflichtnachweis'],
    },
    {
      slug: 'gewerk', title: 'Gewerk', type: 'concept',
      definition: 'Ein fachlich abgegrenzter Leistungsbereich eines Bauprojekts (z. B. Rohbau, Elektro, Sanitär).',
      examples: ['Rohbau', 'Elektro', 'Sanitär/Heizung', 'Estrich', 'Maler'],
    },
    {
      slug: 'material', title: 'Material', type: 'concept', access: 'worker',
      definition: 'Alle Baustoffe und Verbrauchsmaterialien, die auf ein Projekt gebucht werden.',
      rules: ['Materialentnahme immer mit Projektnummer buchen'],
    },
    {
      slug: 'lieferschein', title: 'Lieferschein', parent: 'material', type: 'document_type', access: 'worker',
      definition: 'Der Beleg des Lieferanten über gelieferte Materialmengen, der bei Annahme geprüft und unterschrieben wird.',
      rules: ['Bei Annahme Menge + Zustand prüfen, Abweichungen sofort notieren', 'Lieferschein noch am selben Tag fotografieren und hochladen'],
    },
    {
      slug: 'arbeitssicherheit', title: 'Arbeitssicherheit', type: 'rule', access: 'worker',
      definition: 'Alle Regeln und Maßnahmen zum Schutz der Mitarbeiter auf der Baustelle.',
      explanation: 'Die PSA-Pflicht gilt ausnahmslos. Der Polier führt die tägliche Sichtkontrolle durch; die Sicherheitsunterweisung wird quartalsweise wiederholt und dokumentiert.',
      synonyms: ['Arbeitsschutz'],
      rules: ['PSA-Pflicht: Helm, S3-Schuhe, Warnweste — ohne Ausnahme', 'Gerüste nur nach Freigabe durch befähigte Person betreten', 'Sicherheitsunterweisung quartalsweise, dokumentiert'],
    },
    {
      slug: 'unfallmeldung', title: 'Unfallmeldung', parent: 'arbeitssicherheit', type: 'process', access: 'worker',
      definition: 'Die sofortige Meldung und Dokumentation eines Arbeitsunfalls oder Beinahe-Unfalls.',
      rules: ['Jeder Unfall sofort an Bauleiter melden', 'Meldung an BG innerhalb von 3 Tagen bei > 3 Tagen Arbeitsunfähigkeit'],
    },
    {
      slug: 'skonto', title: 'Skonto', type: 'rule', access: 'manager',
      definition: 'Preisnachlass (bei uns üblich 2 %) für Zahlung innerhalb einer verkürzten Frist (üblich 8 Tage).',
      explanation: 'Skonto ist auf beiden Seiten bares Geld: Bei Eingangsrechnungen wollen wir es immer ziehen; bei Ausgangsrechnungen bieten wir es nur strategisch wichtigen Auftraggebern an.',
      rules: ['Eingangsrechnungen mit Skonto-Angebot priorisiert prüfen und fristgerecht zahlen'],
    },
  ],
  relations: [
    { from: 'angebot', to: 'auftrag', type: 'leads-to', note: 'Angenommenes Angebot wird zum Auftrag' },
    { from: 'auftrag', to: 'projekt', type: 'triggers', note: 'Mit Auftragseingang wird das Projekt angelegt' },
    { from: 'rechnung', to: 'aufmass', type: 'requires', note: 'Keine Rechnung ohne geprüftes Aufmaß' },
    { from: 'rechnung', to: 'auftrag', type: 'derived-from' },
    { from: 'schlussrechnung', to: 'abnahme', type: 'requires', note: 'Schlussrechnung erst nach Abnahme' },
    { from: 'mangel', to: 'abnahme', type: 'blocks', note: 'Wesentliche Mängel verhindern die Abnahme' },
    { from: 'abnahme', to: 'gewaehrleistung', type: 'triggers', note: 'Gewährleistungsfrist beginnt mit Abnahme' },
    { from: 'nachtrag', to: 'auftrag', type: 'part-of', note: 'Nachträge erweitern den Auftrag' },
    { from: 'eingangsrechnung', to: 'lieferschein', type: 'validated-by', note: 'Zahlung nur mit Beleg' },
    { from: 'baustelle', to: 'bauleiter', type: 'owned-by' },
    { from: 'gewerk', to: 'subunternehmer', type: 'owned-by', note: 'Gewerke können an Subs vergeben sein' },
    { from: 'aufmass', to: 'polier', type: 'owned-by', note: 'Polier misst mit dem Bauleiter auf' },
    { from: 'unfallmeldung', to: 'bautagebuch', type: 'reported-in' },
    { from: 'eingangsrechnung', to: 'skonto', type: 'uses' },
    { from: 'nachbesserung', to: 'gewaehrleistung', type: 'part-of', note: 'Auch nach Abnahme im Rahmen der Gewährleistung' },
  ],
  dataset: {
    title: 'Rechnungen 2026',
    description: 'Ausgangs- und Eingangsrechnungen des laufenden Jahres',
    keyword: 'rechnung',
    table: 'Rechnungen',
    columns: [
      { name: 'Nummer', normalized: 'nummer', type: 'text' },
      { name: 'Projekt', normalized: 'projekt', type: 'text' },
      { name: 'Typ', normalized: 'typ', type: 'text' },
      { name: 'Betrag EUR', normalized: 'betrag_eur', type: 'number' },
      { name: 'Datum', normalized: 'datum', type: 'date' },
      { name: 'Fällig', normalized: 'faellig', type: 'date' },
      { name: 'Status', normalized: 'status', type: 'text' },
      { name: 'Skonto genutzt', normalized: 'skonto_genutzt', type: 'boolean' },
    ],
    rows: [
      { nummer: 'AR-2026-014', projekt: 'EFH Bergstraße 12', typ: 'abschlag', betrag_eur: 38500, datum: '2026-03-31', faellig: '2026-04-14', status: 'bezahlt', skonto_genutzt: false },
      { nummer: 'AR-2026-019', projekt: 'EFH Bergstraße 12', typ: 'abschlag', betrag_eur: 42200, datum: '2026-04-30', faellig: '2026-05-14', status: 'bezahlt', skonto_genutzt: false },
      { nummer: 'AR-2026-025', projekt: 'EFH Bergstraße 12', typ: 'abschlag', betrag_eur: 35800, datum: '2026-05-31', faellig: '2026-06-14', status: 'offen', skonto_genutzt: false },
      { nummer: 'AR-2026-027', projekt: 'Dachsanierung Kita', typ: 'abschlag', betrag_eur: 18900, datum: '2026-06-10', faellig: '2026-06-24', status: 'offen', skonto_genutzt: false },
      { nummer: 'AR-2026-028', projekt: 'Anbau Weber KG', typ: 'schluss', betrag_eur: 61400, datum: '2026-06-15', faellig: '2026-06-29', status: 'offen', skonto_genutzt: false },
      { nummer: 'AR-2026-022', projekt: 'Carport Meier', typ: 'schluss', betrag_eur: 9800, datum: '2026-05-12', faellig: '2026-05-26', status: 'ueberfaellig', skonto_genutzt: false },
      { nummer: 'ER-2026-101', projekt: 'EFH Bergstraße 12', typ: 'eingang', betrag_eur: -12400, datum: '2026-05-05', faellig: '2026-05-13', status: 'bezahlt', skonto_genutzt: true },
      { nummer: 'ER-2026-108', projekt: 'EFH Bergstraße 12', typ: 'eingang', betrag_eur: -8600, datum: '2026-05-20', faellig: '2026-05-28', status: 'bezahlt', skonto_genutzt: false },
      { nummer: 'ER-2026-113', projekt: 'Dachsanierung Kita', typ: 'eingang', betrag_eur: -15200, datum: '2026-06-02', faellig: '2026-06-10', status: 'bezahlt', skonto_genutzt: false },
      { nummer: 'ER-2026-117', projekt: 'Anbau Weber KG', typ: 'eingang', betrag_eur: -22100, datum: '2026-06-12', faellig: '2026-06-20', status: 'bezahlt', skonto_genutzt: false },
      { nummer: 'ER-2026-121', projekt: 'Anbau Weber KG', typ: 'eingang', betrag_eur: -6800, datum: '2026-06-25', faellig: '2026-07-03', status: 'offen', skonto_genutzt: false },
      { nummer: 'AR-2026-030', projekt: 'Dachsanierung Kita', typ: 'abschlag', betrag_eur: 21300, datum: '2026-07-01', faellig: '2026-07-15', status: 'offen', skonto_genutzt: false },
    ],
  },
  metrics: [
    {
      name: 'Offene Forderungen', description: 'Summe aller offenen und überfälligen Ausgangsrechnungen',
      aggregation: 'sum', value_column: 'betrag_eur',
      formula: "sum(betrag_eur) where typ != 'eingang' and status in ('offen','ueberfaellig')",
      caveats: 'Eingangsrechnungen (negative Beträge) nicht mitzählen', keyword: 'rechnung',
    },
    {
      name: 'Skontoquote Eingangsrechnungen', description: 'Anteil der Eingangsrechnungen, bei denen Skonto gezogen wurde',
      aggregation: 'avg', value_column: 'skonto_genutzt',
      formula: "count(skonto_genutzt = true) / count(*) where typ = 'eingang'",
      caveats: 'Ziel laut Regel „Skonto": möglichst 100 %', keyword: 'skonto',
    },
  ],
  tasks: [
    { title: 'Überfällige Schlussrechnung Carport Meier anmahnen', status: 'todo', priority: 'high', keyword: 'rechnung', due_date: '2026-07-18' },
    { title: 'Restmängel EFH Bergstraße nachbessern (Frist 25.07.)', status: 'in_progress', priority: 'high', keyword: 'mangel', due_date: '2026-07-25' },
    { title: 'Sicherheitsunterweisung Q3 durchführen', status: 'todo', priority: 'medium', keyword: 'arbeitssicherheit', due_date: '2026-07-31' },
    { title: 'Nachtragsangebot Drainage Kita kalkulieren', status: 'blocked', priority: 'medium', keyword: 'nachtrag' },
  ],
};

const RESTAURANT: SeedBusiness = {
  name: 'Ristorante Bella Vista',
  slug: 'demo-restaurant',
  industry: 'gastronomy',
  keywords: [
    {
      slug: 'speisekarte', title: 'Speisekarte', type: 'concept',
      definition: 'Das aktuelle Angebot aller Gerichte und Getränke mit Preisen und Allergenkennzeichnung.',
      explanation: 'Die Karte wird saisonal überarbeitet (4× im Jahr). Preisänderungen entscheidet die Geschäftsführung; die Allergene pflegt die Küche vor Druckfreigabe.',
      synonyms: ['Karte', 'Menü'],
      rules: ['Keine Druckfreigabe ohne geprüfte Allergenkennzeichnung'],
    },
    {
      slug: 'gericht', title: 'Gericht', parent: 'speisekarte', type: 'concept',
      definition: 'Eine einzelne Speise auf der Karte mit Rezept, Zutaten, Allergenen und kalkuliertem Wareneinsatz.',
      explanation: 'Jedes Gericht hat ein hinterlegtes Rezept mit Portionsgrößen. Der Ziel-Wareneinsatz liegt bei maximal 30 % vom Verkaufspreis.',
      examples: ['Saltimbocca alla Romana', 'Risotto ai Funghi', 'Tiramisù della Casa'],
      rules: ['Wareneinsatz maximal 30 % vom Verkaufspreis'],
    },
    {
      slug: 'tagesgericht', title: 'Tagesgericht', parent: 'speisekarte', type: 'concept', access: 'worker',
      definition: 'Ein täglich wechselndes Gericht außerhalb der festen Karte, meist aus saisonaler oder überschüssiger Ware.',
      explanation: 'Das Tagesgericht hilft, Ware vor Ablauf zu verwerten und die Inventurverluste zu senken. Der Koch legt es morgens fest; das Serviceteam wird beim Briefing informiert.',
      synonyms: ['Tagesempfehlung', 'Specials'],
    },
    {
      slug: 'allergenkennzeichnung', title: 'Allergenkennzeichnung', parent: 'speisekarte', type: 'rule', access: 'worker',
      definition: 'Die gesetzlich vorgeschriebene Kennzeichnung der 14 Hauptallergene für jedes Gericht.',
      explanation: 'Jede Zutatenänderung kann die Allergene eines Gerichts ändern — deshalb wird die Kennzeichnung bei jeder Rezeptänderung neu geprüft. Das Serviceteam muss Auskunft geben können, ohne zu raten.',
      examples: ['A Gluten', 'C Eier', 'G Milch/Laktose', 'H Schalenfrüchte'],
      rules: ['Bei Zutatenänderung Allergene sofort neu prüfen', 'Service gibt niemals Auskunft „aus dem Kopf" — immer in der Allergenliste nachschlagen'],
    },
    {
      slug: 'zutat', title: 'Zutat', type: 'concept', access: 'worker',
      definition: 'Ein Rohstoff oder Lebensmittel, das in Rezepten verwendet wird und über Lieferanten bezogen wird.',
      examples: ['Büffelmozzarella', 'San-Marzano-Tomaten', 'Kalbfleisch'],
      rules: ['First in, first out: ältere Ware zuerst verbrauchen'],
    },
    {
      slug: 'lieferant', title: 'Lieferant', parent: 'zutat', type: 'entity', access: 'manager',
      definition: 'Ein Betrieb, von dem wir Waren beziehen, mit vereinbarten Konditionen und Liefertagen.',
      examples: ['Frischeparadies (Fisch, Di/Fr)', 'Metro (Trockensortiment)', 'Hofgut Klein (Gemüse, saisonal)'],
      rules: ['Neue Lieferanten nur mit Zulassungsnummer und Probelieferung'],
    },
    {
      slug: 'wareneingang', title: 'Wareneingang', parent: 'zutat', type: 'process', access: 'worker',
      definition: 'Die Annahme und Prüfung gelieferter Ware: Temperatur, Frische, Menge, Mindesthaltbarkeit.',
      explanation: 'Der Wareneingang ist ein HACCP-kritischer Punkt. Gemessene Temperaturen werden im Wareneingangsprotokoll dokumentiert. Abweichungen führen zur Annahmeverweigerung.',
      rules: ['Kühlware über 7 °C wird nicht angenommen', 'TK-Ware über −18 °C wird nicht angenommen', 'Jede Lieferung im Wareneingangsprotokoll dokumentieren'],
    },
    {
      slug: 'haccp', title: 'HACCP', type: 'rule', access: 'manager',
      definition: 'Unser Eigenkontrollsystem für Lebensmittelsicherheit: kritische Punkte identifizieren, überwachen und dokumentieren.',
      explanation: 'HACCP-Dokumentation ist Pflicht und wird bei jeder Lebensmittelkontrolle geprüft. Kritische Punkte bei uns: Wareneingang, Kühlkette, Erhitzen, Warmhalten, Reinigung.',
      synonyms: ['Eigenkontrolle'],
      rules: ['HACCP-Dokumentation 2 Jahre aufbewahren', 'Abweichungen sofort dokumentieren inkl. Korrekturmaßnahme'],
    },
    {
      slug: 'kuehlkette', title: 'Kühlkette', parent: 'haccp', type: 'rule', access: 'worker',
      definition: 'Die lückenlose Einhaltung der Temperaturgrenzen von der Anlieferung bis zum Teller.',
      examples: ['Kühlschrank Fleisch: max. 4 °C', 'Kühlschrank allgemein: max. 7 °C', 'TK: max. −18 °C'],
      rules: ['Kühltemperaturen 2× täglich messen und in die Temperaturliste eintragen', 'Bei Ausfall: Ware umlagern, Temperaturverlauf dokumentieren, Küchenchef informieren'],
    },
    {
      slug: 'reinigungsplan', title: 'Reinigungsplan', parent: 'haccp', type: 'document_type', access: 'worker',
      definition: 'Der Plan, der festlegt, wer wann welche Bereiche mit welchen Mitteln reinigt — mit Abzeichnung.',
      rules: ['Jede Reinigung wird mit Kürzel abgezeichnet', 'Fettabscheider monatlich durch Fachfirma'],
    },
    {
      slug: 'reservierung', title: 'Reservierung', type: 'process', access: 'worker',
      definition: 'Eine verbindliche Tischbuchung eines Gastes für Datum, Uhrzeit und Personenzahl.',
      explanation: 'Reservierungen laufen über das Buchungssystem oder Telefon. Ab 8 Personen gilt Gruppenregelung mit Menüvorauswahl. No-Shows werden im System vermerkt.',
      rules: ['Ab 8 Personen: Menüvorauswahl + Bestätigung per E-Mail', 'Tische werden 15 Minuten gehalten, danach Freigabe'],
    },
    {
      slug: 'gast', title: 'Gast', type: 'entity', access: 'worker',
      definition: 'Jede Person, die bei uns isst, trinkt oder reserviert — der Mittelpunkt unserer Arbeit.',
      explanation: 'Stammgäste werden im Reservierungssystem mit Vorlieben (Lieblingstisch, Unverträglichkeiten) gepflegt — das ist unser wichtigstes Bindungsinstrument.',
    },
    {
      slug: 'service', title: 'Service', type: 'concept', access: 'worker',
      definition: 'Alle Abläufe am Gast: Empfang, Beratung, Bestellung, Servieren, Abrechnung.',
      explanation: 'Servicestandard: Begrüßung innerhalb von 2 Minuten, Getränkeaufnahme sofort, Speisenempfehlung aktiv anbieten.',
    },
    {
      slug: 'schicht', title: 'Schicht', parent: 'service', type: 'concept', access: 'worker',
      definition: 'Ein geplanter Arbeitsblock eines Mitarbeiters laut Dienstplan (Früh-, Split- oder Abendschicht).',
      rules: ['Schichttausch nur mit Freigabe der Serviceleitung', 'Dienstplan hängt donnerstags für die Folgewoche'],
    },
    {
      slug: 'trinkgeld', title: 'Trinkgeld', parent: 'service', type: 'rule', access: 'worker',
      definition: 'Freiwillige Zahlung des Gastes an das Team; wird bei uns fair über den Trinkgeldpool verteilt.',
      explanation: 'Der Pool wird täglich nach Schichtende aufgeteilt: 70 % Service, 30 % Küche. Kartentrinkgeld wird über die Kasse erfasst und bar ausgezahlt.',
      rules: ['Kartentrinkgeld täglich über die Kasse erfassen', 'Aufteilung 70/30 Service/Küche'],
    },
    {
      slug: 'reklamation', title: 'Reklamation', parent: 'service', type: 'process', access: 'worker',
      definition: 'Eine Beschwerde eines Gastes über Essen, Getränke oder Service.',
      explanation: 'Reklamationen löst das Team sofort und großzügig am Tisch (neues Gericht, Getränk aufs Haus). Ab 50 € Warenwert oder bei Grundsatzthemen entscheidet die Serviceleitung. Jede Reklamation wird im Kassensystem mit Grund vermerkt.',
      rules: ['Sofort am Tisch lösen, nicht diskutieren', 'Ab 50 € Warenwert: Serviceleitung hinzuziehen', 'Grund immer im Kassensystem vermerken'],
    },
    {
      slug: 'kasse', title: 'Kasse', type: 'concept', access: 'manager',
      definition: 'Das Kassensystem, über das alle Umsätze, Stornos und Zahlarten laufen (TSE-pflichtig).',
      rules: ['Jeder Mitarbeiter bucht nur mit eigenem Kellnerschlüssel'],
    },
    {
      slug: 'tagesabschluss', title: 'Tagesabschluss', parent: 'kasse', type: 'process', access: 'manager',
      definition: 'Der tägliche Kassenabschluss: Z-Bericht, Bargeld zählen, Kartenumsätze abgleichen, Stornos prüfen.',
      explanation: 'Differenzen über 10 € werden noch am Abend geklärt und dokumentiert. Der Z-Bericht geht mit Datum ins Buchhaltungsfach.',
      rules: ['Kassendifferenz > 10 € noch am Abend klären und dokumentieren', 'Stornoliste täglich von der Serviceleitung gegenzeichnen'],
    },
    {
      slug: 'storno', title: 'Storno', parent: 'kasse', type: 'process', access: 'manager',
      definition: 'Die Rücknahme einer bereits gebuchten Position oder Rechnung im Kassensystem.',
      explanation: 'Stornos sind das wichtigste Kontrollfeld der Kasse: Häufungen bei einzelnen Mitarbeitern oder Artikeln werden wöchentlich ausgewertet.',
      rules: ['Storno nur mit Grund buchen', 'Stornos über 30 € nur durch Serviceleitung'],
    },
    {
      slug: 'inventur', title: 'Inventur', type: 'process', access: 'manager',
      definition: 'Die monatliche Zählung aller Warenbestände in Küche, Bar und Lager zur Ermittlung des Wareneinsatzes.',
      explanation: 'Die Inventur zeigt, ob Wareneinsatz und Schwund im Rahmen sind. Zielwert Küche: unter 30 %, Bar: unter 25 %.',
      rules: ['Inventur am Monatsletzten nach Küchenschluss', 'Zählung immer zu zweit'],
    },
    {
      slug: 'koch', title: 'Koch', type: 'role', access: 'worker',
      definition: 'Verantwortlich für Zubereitung, Rezepttreue, Hygiene am Posten und Warenverbrauch in der Küche.',
      synonyms: ['Küche'],
    },
    {
      slug: 'kellner', title: 'Kellner', parent: 'service', type: 'role', access: 'worker',
      definition: 'Verantwortlich für die Gäste einer Station: Beratung, Bestellung, Service und Abrechnung.',
      synonyms: ['Servicekraft'],
    },
  ],
  relations: [
    { from: 'gericht', to: 'zutat', type: 'uses', note: 'Rezepte bestehen aus Zutaten' },
    { from: 'gericht', to: 'allergenkennzeichnung', type: 'requires', note: 'Kein Gericht ohne geprüfte Allergene' },
    { from: 'tagesgericht', to: 'inventur', type: 'affects', note: 'Verwertet Ware vor Ablauf, senkt Schwund' },
    { from: 'wareneingang', to: 'kuehlkette', type: 'validated-by', note: 'Temperaturprüfung bei Annahme' },
    { from: 'wareneingang', to: 'lieferant', type: 'generated-by' },
    { from: 'zutat', to: 'wareneingang', type: 'requires', note: 'Nur geprüfte Ware kommt ins Lager' },
    { from: 'kuehlkette', to: 'haccp', type: 'part-of' },
    { from: 'reservierung', to: 'gast', type: 'belongs-to' },
    { from: 'reklamation', to: 'gast', type: 'affects', note: 'Gut gelöste Reklamation bindet Gäste' },
    { from: 'reklamation', to: 'storno', type: 'triggers', note: 'Kulanz läuft als Storno über die Kasse' },
    { from: 'storno', to: 'tagesabschluss', type: 'reported-in', note: 'Stornoliste ist Teil des Abschlusses' },
    { from: 'trinkgeld', to: 'tagesabschluss', type: 'reported-in', note: 'Kartentrinkgeld im Z-Bericht' },
    { from: 'inventur', to: 'gericht', type: 'measured-by', note: 'Wareneinsatz je Gericht aus Inventur + Verkäufen' },
    { from: 'schicht', to: 'kellner', type: 'owned-by' },
    { from: 'gericht', to: 'koch', type: 'owned-by', note: 'Rezeptverantwortung liegt in der Küche' },
  ],
  dataset: {
    title: 'Tagesumsätze Juni 2026',
    description: 'Kassendaten je Tag: Umsatz, Gäste, Stornos, Trinkgeld',
    keyword: 'tagesabschluss',
    table: 'Tagesumsaetze',
    columns: [
      { name: 'Datum', normalized: 'datum', type: 'date' },
      { name: 'Wochentag', normalized: 'wochentag', type: 'text' },
      { name: 'Umsatz EUR', normalized: 'umsatz_eur', type: 'number' },
      { name: 'Gäste', normalized: 'gaeste', type: 'number' },
      { name: 'Storno EUR', normalized: 'storno_eur', type: 'number' },
      { name: 'Trinkgeld Karte EUR', normalized: 'trinkgeld_karte_eur', type: 'number' },
    ],
    rows: [
      { datum: '2026-06-15', wochentag: 'Mo', umsatz_eur: 2180, gaeste: 64, storno_eur: 24, trinkgeld_karte_eur: 132 },
      { datum: '2026-06-16', wochentag: 'Di', umsatz_eur: 2440, gaeste: 71, storno_eur: 18, trinkgeld_karte_eur: 148 },
      { datum: '2026-06-17', wochentag: 'Mi', umsatz_eur: 2890, gaeste: 82, storno_eur: 31, trinkgeld_karte_eur: 176 },
      { datum: '2026-06-18', wochentag: 'Do', umsatz_eur: 3120, gaeste: 88, storno_eur: 22, trinkgeld_karte_eur: 195 },
      { datum: '2026-06-19', wochentag: 'Fr', umsatz_eur: 4650, gaeste: 121, storno_eur: 45, trinkgeld_karte_eur: 289 },
      { datum: '2026-06-20', wochentag: 'Sa', umsatz_eur: 5240, gaeste: 134, storno_eur: 168, trinkgeld_karte_eur: 302 },
      { datum: '2026-06-21', wochentag: 'So', umsatz_eur: 3980, gaeste: 108, storno_eur: 29, trinkgeld_karte_eur: 241 },
      { datum: '2026-06-22', wochentag: 'Mo', umsatz_eur: 1950, gaeste: 58, storno_eur: 15, trinkgeld_karte_eur: 118 },
      { datum: '2026-06-23', wochentag: 'Di', umsatz_eur: 2380, gaeste: 69, storno_eur: 26, trinkgeld_karte_eur: 139 },
      { datum: '2026-06-24', wochentag: 'Mi', umsatz_eur: 2760, gaeste: 79, storno_eur: 19, trinkgeld_karte_eur: 168 },
      { datum: '2026-06-25', wochentag: 'Do', umsatz_eur: 3340, gaeste: 92, storno_eur: 38, trinkgeld_karte_eur: 204 },
      { datum: '2026-06-26', wochentag: 'Fr', umsatz_eur: 4820, gaeste: 126, storno_eur: 52, trinkgeld_karte_eur: 296 },
      { datum: '2026-06-27', wochentag: 'Sa', umsatz_eur: 5510, gaeste: 141, storno_eur: 149, trinkgeld_karte_eur: 318 },
      { datum: '2026-06-28', wochentag: 'So', umsatz_eur: 4110, gaeste: 112, storno_eur: 33, trinkgeld_karte_eur: 252 },
    ],
  },
  metrics: [
    {
      name: 'Umsatz pro Gast', description: 'Durchschnittsbon je Gast',
      aggregation: 'avg', value_column: 'umsatz_eur', date_column: 'datum', time_grain: 'day',
      formula: 'sum(umsatz_eur) / sum(gaeste)', keyword: 'tagesabschluss',
    },
    {
      name: 'Stornoquote', description: 'Stornos im Verhältnis zum Umsatz',
      aggregation: 'sum', value_column: 'storno_eur', date_column: 'datum', time_grain: 'day',
      formula: 'sum(storno_eur) / sum(umsatz_eur)',
      caveats: 'Samstage fallen auf — Stornoliste gegenzeichnen lassen', keyword: 'storno',
    },
  ],
  tasks: [
    { title: 'Storno-Häufung an Samstagen auswerten', status: 'todo', priority: 'high', keyword: 'storno', due_date: '2026-07-20' },
    { title: 'Allergene der Sommerkarte vor Druck prüfen', status: 'in_progress', priority: 'high', keyword: 'allergenkennzeichnung', due_date: '2026-07-17' },
    { title: 'Inventur Juni abschließen', status: 'blocked', priority: 'medium', keyword: 'inventur' },
    { title: 'Neuen Fischlieferanten mit Probelieferung testen', status: 'todo', priority: 'low', keyword: 'lieferant' },
  ],
};

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedBusiness(supabase: SupabaseClient, biz: SeedBusiness, ownerId: string | null, reset: boolean) {
  const { data: existing } = await supabase.from('organizations').select('id').eq('slug', biz.slug).maybeSingle();
  if (existing) {
    if (!reset) {
      console.log(`• ${biz.name}: existiert bereits (slug "${biz.slug}") — überspringe. Mit --reset neu anlegen.`);
      return;
    }
    console.log(`• ${biz.name}: lösche vorhandene Demo-Organisation…`);
    const orgId = existing.id;
    const { data: ds } = await supabase.from('datasets').select('id, tables:dataset_tables(id)').eq('organization_id', orgId);
    for (const d of (ds ?? []) as any[]) {
      for (const t of d.tables ?? []) {
        await supabase.from('dataset_rows').delete().eq('dataset_table_id', t.id);
        await supabase.from('dataset_columns').delete().eq('dataset_table_id', t.id);
      }
      await supabase.from('dataset_tables').delete().eq('dataset_id', d.id);
    }
    await supabase.from('datasets').delete().eq('organization_id', orgId);
    for (const table of ['tasks', 'metrics', 'ai_skills', 'keyword_relations', 'keywords', 'organization_members']) {
      await supabase.from(table).delete().eq('organization_id', orgId);
    }
    await supabase.from('organizations').delete().eq('id', orgId);
  }

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({ name: biz.name, slug: biz.slug, industry: biz.industry, default_language: 'de' })
    .select()
    .single();
  if (orgError) throw orgError;

  if (ownerId) {
    await supabase.from('organization_members').insert({ organization_id: org.id, user_id: ownerId, role: 'owner' });
  }

  // Keywords (parents before children)
  const idBySlug = new Map<string, string>();
  const pending = [...biz.keywords];
  while (pending.length) {
    const ready = pending.filter((k) => !k.parent || idBySlug.has(k.parent));
    if (!ready.length) throw new Error(`Zyklus/fehlender Parent in Seed: ${pending.map((k) => k.slug).join(', ')}`);
    for (const k of ready) {
      pending.splice(pending.indexOf(k), 1);
      const { score } = computeCompleteness({
        definition: k.definition, explanation: k.explanation,
        examples: k.examples, synonyms: k.synonyms, rules: k.rules,
      });
      const { data: row, error } = await supabase
        .from('keywords')
        .insert({
          organization_id: org.id,
          title: k.title,
          slug: k.slug,
          parent_id: k.parent ? idBySlug.get(k.parent) : null,
          keyword_type: k.type ?? 'concept',
          status: 'active',
          access_level: k.access ?? 'worker',
          definition: k.definition,
          explanation: k.explanation ?? null,
          examples: k.examples ?? [],
          synonyms: k.synonyms ?? [],
          rules: k.rules ?? [],
          labels_json: {},
          completeness_score: score,
        })
        .select('id')
        .single();
      if (error) throw error;
      idBySlug.set(k.slug, row.id);
    }
  }

  // Relations
  for (const r of biz.relations) {
    const from = idBySlug.get(r.from);
    const to = idBySlug.get(r.to);
    if (!from || !to) throw new Error(`Relation verweist auf unbekannten Slug: ${r.from} → ${r.to}`);
    const { error } = await supabase.from('keyword_relations').insert({
      organization_id: org.id,
      from_keyword_id: from,
      to_keyword_id: to,
      relation_type: r.type,
      note: r.note ?? null,
    });
    if (error) throw error;
  }

  // Dataset + table + columns + rows
  const d = biz.dataset;
  const { data: dataset, error: dsError } = await supabase
    .from('datasets')
    .insert({ organization_id: org.id, title: d.title, description: d.description, keyword_id: idBySlug.get(d.keyword) })
    .select('id')
    .single();
  if (dsError) throw dsError;
  const { data: table, error: tbError } = await supabase
    .from('dataset_tables')
    .insert({ dataset_id: dataset.id, name: d.table, row_count: d.rows.length, column_count: d.columns.length })
    .select('id')
    .single();
  if (tbError) throw tbError;
  const { error: colError } = await supabase.from('dataset_columns').insert(
    d.columns.map((c) => ({
      dataset_table_id: table.id,
      name: c.name,
      normalized_name: c.normalized,
      data_type: c.type,
      sample_values: d.rows.slice(0, 3).map((r) => String(r[c.normalized] ?? '')),
    }))
  );
  if (colError) throw colError;
  const { error: rowError } = await supabase.from('dataset_rows').insert(
    d.rows.map((data, row_index) => ({ dataset_table_id: table.id, row_index, data }))
  );
  if (rowError) throw rowError;

  // Metrics
  for (const m of biz.metrics) {
    const { error } = await supabase.from('metrics').insert({
      organization_id: org.id,
      name: m.name,
      description: m.description,
      aggregation: m.aggregation,
      value_column: m.value_column,
      date_column: m.date_column ?? null,
      time_grain: m.time_grain ?? 'month',
      formula: m.formula ?? null,
      caveats: m.caveats ?? null,
      source_table_id: table.id,
      keyword_id: idBySlug.get(m.keyword) ?? null,
    });
    if (error) throw error;
  }

  // Tasks
  for (const t of biz.tasks) {
    const { error } = await supabase.from('tasks').insert({
      organization_id: org.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date ?? null,
      keyword_id: t.keyword ? idBySlug.get(t.keyword) ?? null : null,
    });
    if (error) throw error;
  }

  console.log(`✓ ${biz.name} (slug "${biz.slug}"): ${biz.keywords.length} Begriffe, ${biz.relations.length} Relationen, ${d.rows.length} Datenzeilen, ${biz.metrics.length} Kennzahlen, ${biz.tasks.length} Aufgaben`);
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }
  if (!(globalThis as any).WebSocket) {
    (globalThis as any).WebSocket = class {} as any;
  }
  const supabase = createClient(url, key);

  // Attach an owner so the demo orgs show up after login
  let ownerId: string | null = null;
  const email = arg('email');
  if (email) {
    const { data } = await supabase.from('profiles').select('id, email').eq('email', email).maybeSingle();
    if (!data) {
      console.error(`Kein Konto mit E-Mail ${email} gefunden — erst in der App registrieren.`);
      process.exit(1);
    }
    ownerId = data.id;
  } else {
    const { data } = await supabase.from('profiles').select('id, email').order('created_at').limit(1);
    ownerId = data?.[0]?.id ?? null;
    if (ownerId) console.log(`Besitzer: ${data![0].email} (ältestes Konto — mit --email überschreibbar)`);
    else console.log('Hinweis: noch kein Benutzerkonto — Orgs werden ohne Mitglied angelegt.');
  }

  const reset = hasFlag('reset');
  await seedBusiness(supabase, CONSTRUCTION, ownerId, reset);
  await seedBusiness(supabase, RESTAURANT, ownerId, reset);

  console.log('');
  console.log('Nächste Schritte:');
  console.log('  npm run vault -- --org demo-bau --out ./vault-bau');
  console.log('  npm run vault -- --org demo-restaurant --out ./vault-restaurant');
  console.log('  cd vault-bau && claude   # dann z. B. /insight-loop');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
