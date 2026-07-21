// Shared (client + server) types for the structured capture system.
// Forms are derived from dataset_columns — no separate form schema exists.

export type CaptureFieldAuto = 'today' | 'now' | 'user' | 'weekday' | 'evidence' | null;

export interface CaptureField {
  /** normalized column name — key in the submitted values object */
  field: string;
  /** dataset_columns.id — needed to extend the curated option list */
  column_id?: string | null;
  /** display label (original column name) */
  label: string;
  data_type: 'text' | 'number' | 'date' | 'boolean' | 'json';
  semantic: string | null;
  required: boolean;
  description: string | null;
  /**
   * Dropdown choices. Curated options from validation_rules.options win;
   * otherwise harvested from existing rows (2–12 distinct values).
   */
  options: string[] | null;
  /** true when curated options exist → the list is editable ("+ Neu") */
  curated?: boolean;
  /** multi-select: several values per record, stored joined with " | " */
  multiple?: boolean;
  min: number | null;
  max: number | null;
  /**
   * Auto-fill behavior:
   *  today    → default to today's date (editable)
   *  now      → default to current time (editable)
   *  user     → filled server-side with the capturing user (hidden)
   *  weekday  → computed server-side from the business date (hidden)
   *  evidence → filled server-side with the attached photo/file reference (hidden)
   */
  auto: CaptureFieldAuto;
}

export interface OwnRecord {
  id: string;
  row_index: number;
  data: Record<string, unknown>;
  created_at: string;
}

export interface CaptureFormDef {
  dataset_table_id: string;
  table_name: string;
  dataset_title: string;
  keyword_id: string;
  row_count: number;
  fields: CaptureField[];
  /** The current member's latest records in this table ("Meine Einträge"). */
  recent_own?: OwnRecord[];
}

export interface CaptureSubmission {
  dataset_table_id: string;
  values: Record<string, unknown>;
  evidence_asset_id?: string | null;
}
