// Type definitions for the Company Knowledge Base

// =====================================================
// Tenancy, identity, RBAC (Milestone 1)
// =====================================================

export type OrgRole = 'owner' | 'admin' | 'manager' | 'analyst' | 'editor' | 'viewer' | 'guest';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  timezone: string;
  default_language: string;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
  updated_at: string;
  profiles?: Profile;
  organizations?: Organization;
}

export interface OrganizationInvite {
  id: string;
  organization_id: string;
  email: string;
  role: OrgRole;
  invited_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

// =====================================================
// Grounded business object layer
// =====================================================

export type TruthStatus = 'verified' | 'approved' | 'derived' | 'asserted' | 'disputed';
export type BusinessFactDataType =
  | 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'currency' | 'percentage' | 'json';
export type BusinessFactSourceType =
  | 'manual' | 'dataset' | 'document' | 'metric' | 'integration' | 'ai_extraction' | 'calculation';

export interface BusinessObject {
  id: string;
  organization_id: string;
  object_type: string;
  external_key: string | null;
  display_name: string;
  description: string | null;
  status: string;
  canonical_keyword_id: string | null;
  attributes: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  facts?: BusinessFact[];
}

export interface BusinessFact {
  id: string;
  organization_id: string;
  object_id: string;
  fact_key: string;
  value: unknown;
  data_type: BusinessFactDataType;
  unit: string | null;
  valid_from: string;
  valid_to: string | null;
  recorded_at: string;
  truth_status: TruthStatus;
  confidence: number | null;
  source_type: BusinessFactSourceType;
  source_asset_id: string | null;
  source_table_id: string | null;
  source_row_id: string | null;
  source_metric_id: string | null;
  derivation: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface BusinessEvent {
  id: string;
  organization_id: string;
  object_id: string | null;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  truth_status: TruthStatus;
  source_type: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  organization_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, any>;
  created_at: string;
  profiles?: Pick<Profile, 'email' | 'full_name'> | null;
}

export type KeywordType =
  | 'concept' | 'process' | 'metric' | 'dataset' | 'document_type' | 'role'
  | 'task_type' | 'workflow_step' | 'department' | 'entity' | 'kpi'
  | 'report_type' | 'risk' | 'rule' | 'skill';

export type KeywordStatus = 'draft' | 'active' | 'archived';

export type KeywordAccessLevel = 'worker' | 'manager' | 'admin';

export interface KeywordVersion {
  id: string;
  keyword_id: string;
  organization_id: string;
  version_no: number;
  snapshot: Record<string, any>;
  change_type: 'UPDATE' | 'DELETE';
  changed_by: string | null;
  created_at: string;
}

export interface Keyword {
  id: string;
  organization_id?: string;
  keyword_type?: KeywordType;
  status?: KeywordStatus;
  access_level?: KeywordAccessLevel;
  completeness_score?: number;
  parent_id: string | null;
  title: string;
  slug: string;
  definition: string | null;
  explanation: string | null;
  examples: string[] | null;
  synonyms: string[] | null;
  labels_json: Record<string, string>;
  rules: string[] | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Computed/joined fields
  children?: Keyword[];
  relations?: KeywordRelation[];
  assets?: Asset[];
}

export type RelationType =
  | 'is-a'
  | 'part-of'
  | 'requires'
  | 'causes'
  | 'leads-to'
  | 'owned-by'
  | 'depends-on'
  | 'related-to'
  | 'approves'
  | 'contains'
  | 'triggers'
  | 'blocks'
  | 'succeeds'
  | 'precedes'
  | 'produces'
  | 'affects'
  | 'enables'
  | 'uses'
  | 'generated-by'
  | 'measured-by'
  | 'reported-in'
  | 'calculated-from'
  | 'validated-by'
  | 'conflicts-with'
  | 'replaces'
  | 'derived-from'
  | 'belongs-to';

export interface KeywordRelation {
  id: string;
  from_keyword_id: string;
  relation_type: RelationType;
  to_keyword_id: string;
  note: string | null;
  strength: number;
  bidirectional: boolean;
  created_at: string;
  // Joined fields
  from_keyword?: Keyword;
  to_keyword?: Keyword;
}

export type AssetType = 'pdf' | 'image' | 'excel' | 'word' | 'text' | 'audio' | 'video' | 'other';

export interface Asset {
  id: string;
  file_name: string;
  file_url: string;
  file_type: AssetType;
  mime_type: string | null;
  file_size: number | null;
  extracted_text: string | null;
  meta_json: Record<string, any>;
  thumbnail_url: string | null;
  processed: boolean;
  processing_status?: 'pending' | 'processing' | 'processed' | 'failed';
  title?: string | null;
  description?: string | null;
  source?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeywordAsset {
  id: string;
  keyword_id: string;
  asset_id: string;
  relevance_score: number;
  note: string | null;
  created_at: string;
  // Joined
  asset?: Asset;
  keyword?: Keyword;
}

export interface Chunk {
  id: string;
  asset_id: string | null;
  keyword_id: string | null;
  chunk_index: number;
  chunk_text: string;
  chunk_type: string;
  embedding: number[] | null;
  token_count: number | null;
  meta_json: Record<string, any>;
  created_at: string;
}

export interface VoiceRecording {
  id: string;
  keyword_id: string;
  audio_url: string;
  transcription: string | null;
  duration_seconds: number | null;
  field_updated: 'definition' | 'explanation' | 'example';
  created_by: string | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  context_keywords: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  messages?: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources_json: Array<{
    type: 'keyword' | 'asset' | 'chunk';
    id: string;
    title?: string;
  }>;
  token_count: number | null;
  created_at: string;
}

// API Response types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

// Search/Query types
export interface SearchResult {
  chunks: Array<Chunk & { similarity: number }>;
  keywords: Keyword[];
  assets: Asset[];
}

export interface AskAIRequest {
  question: string;
  context_keyword_ids?: string[];
  include_relations?: boolean;
  include_assets?: boolean;
}

export interface AskAIResponse {
  answer: string;
  sources: Array<{
    type: 'keyword' | 'asset' | 'chunk';
    id: string;
    title: string;
    relevance: number;
  }>;
  suggested_keywords?: string[];
  keyword_suggestions?: KeywordSuggestion[];
}

// AI-suggested keyword for creation
export interface KeywordSuggestion {
  title: string;
  definition: string;
  parent_title?: string;
  parent_id?: string | null;
  children?: KeywordSuggestion[];
  examples?: string[];
  synonyms?: string[];
}

// Request to generate keyword suggestions
export interface GenerateKeywordsRequest {
  topic: string;
  context?: string;
  depth?: number; // How many levels of sub-keywords
  count?: number; // How many keywords to generate
}

// Response with generated keywords
export interface GenerateKeywordsResponse {
  keywords: KeywordSuggestion[];
  explanation: string;
}

// =====================================================
// Structured data + analytics (grounded computations)
// =====================================================

export type DatasetColumnType = 'text' | 'number' | 'date' | 'boolean' | 'json';

export interface Dataset {
  id: string;
  asset_id: string | null;
  title: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  asset?: Asset | null;
  tables?: DatasetTable[];
}

export interface DatasetTable {
  id: string;
  dataset_id: string;
  name: string;
  row_count: number;
  column_count: number;
  meta_json: Record<string, any>;
  created_at: string;
  columns?: DatasetColumn[];
}

export interface DatasetColumn {
  id: string;
  dataset_table_id: string;
  name: string;
  normalized_name: string;
  data_type: DatasetColumnType;
  sample_values: string[];
  created_at: string;
}

export interface DatasetRow {
  id: string;
  dataset_table_id: string;
  row_index: number;
  data: Record<string, any>;
  source_json: Record<string, any>;
  created_at: string;
}

export type AnalyticsFilterOp =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'contains'
  | 'between'
  | 'is_null'
  | 'not_null';

export type AnalyticsAggregateOp = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AnalyticsTableQueryFilter {
  field: string;
  op: AnalyticsFilterOp;
  value?: any;
  values?: any[];
  min?: any;
  max?: any;
}

export interface AnalyticsTableQueryMetric {
  op: AnalyticsAggregateOp;
  field?: string;
  as: string;
}

export interface AnalyticsTableQueryOrderBy {
  field: string;
  direction?: 'asc' | 'desc';
}

export interface AnalyticsTableQueryRequest {
  dataset_table_id: string;
  filters?: AnalyticsTableQueryFilter[];
  group_by?: string[];
  metrics: AnalyticsTableQueryMetric[];
  order_by?: AnalyticsTableQueryOrderBy[];
  limit?: number;
  evidence_limit?: number;
  max_rows?: number;
}

export interface AnalyticsTableQueryResponse {
  table: DatasetTable & { dataset?: Dataset | null; asset?: Asset | null };
  query: Omit<AnalyticsTableQueryRequest, 'dataset_table_id'>;
  result: {
    rows: Array<Record<string, any>>;
    stats: {
      input_rows: number;
      matched_rows: number;
      grouped_rows: number;
    };
    evidence: {
      used_row_ids: string[];
      used_row_ids_by_group?: Record<string, string[]>;
    };
  };
}

export interface AnalyticsAskRequest {
  question: string;
  dataset_table_id: string;
}

export interface AnalyticsAskResponse {
  answer: string;
  tool_results?: Array<{
    tool: string;
    input: Record<string, any>;
    output: Record<string, any>;
  }>;
}

export interface AnalyticsRecommendationRequest {
  dataset_table_id: string;
  question?: string;
  context_keyword_ids?: string[];
  top_n?: number;
  max_rows?: number;
}

export interface AnalyticsRecommendation {
  relation_id: string;
  relation_type: RelationType;
  from_keyword: { id: string; title: string };
  to_keyword: { id: string; title: string };
  impact_score: number;
  confidence: number;
  recommendation: string;
  rationale: string;
  evidence_row_ids: string[];
  stats: {
    from_mentions: number;
    to_mentions: number;
    overlap_mentions: number;
  };
}

export interface AnalyticsRecommendationResponse {
  table: {
    id: string;
    name: string;
    row_count: number;
  };
  recommendations: AnalyticsRecommendation[];
  executive_summary?: string | null;
  graph_summary: {
    considered_keywords: number;
    considered_relations: number;
    analyzed_rows: number;
    note: string;
  };
}
