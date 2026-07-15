/**
 * Request payload guards — the cheap protections that keep a small-business
 * deployment healthy: bounded uploads (memory + storage cost) and bounded
 * text fields (DB, AI context, and vault stay lean).
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // Whisper input cap is 25 MB

/** Returns a bilingual error message, or null when the file is acceptable. */
export function fileSizeError(file: { size: number }, maxBytes: number = MAX_UPLOAD_BYTES): string | null {
  if (file.size === 0) return 'Leere Datei · Empty file';
  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / 1024 / 1024);
    return `Datei zu groß (max. ${maxMb} MB) · File too large (max ${maxMb} MB)`;
  }
  return null;
}

const KEYWORD_TEXT_LIMITS: Record<string, number> = {
  title: 200,
  definition: 2_000,
  explanation: 10_000,
  icon: 100,
  color: 30,
};

const LIST_FIELDS = ['examples', 'synonyms', 'rules'] as const;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_LENGTH = 500;
const MAX_LABELS = 20;
const MAX_LABEL_LENGTH = 200;

/**
 * Validate keyword payload sizes. Returns a bilingual error message or null.
 * Mutates nothing — routes keep their own field whitelisting.
 */
export function keywordPayloadError(body: Record<string, unknown>): string | null {
  for (const [field, max] of Object.entries(KEYWORD_TEXT_LIMITS)) {
    const value = body[field];
    if (typeof value === 'string' && value.length > max) {
      return `Feld „${field}" ist zu lang (max. ${max} Zeichen) · Field "${field}" too long (max ${max} chars)`;
    }
  }
  for (const field of LIST_FIELDS) {
    const value = body[field];
    if (Array.isArray(value)) {
      if (value.length > MAX_LIST_ITEMS) {
        return `Zu viele Einträge in „${field}" (max. ${MAX_LIST_ITEMS}) · Too many items in "${field}"`;
      }
      if (value.some((item) => typeof item === 'string' && item.length > MAX_LIST_ITEM_LENGTH)) {
        return `Ein Eintrag in „${field}" ist zu lang (max. ${MAX_LIST_ITEM_LENGTH} Zeichen) · An item in "${field}" is too long`;
      }
    }
  }
  const labels = body.labels_json;
  if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
    const entries = Object.entries(labels as Record<string, unknown>);
    if (entries.length > MAX_LABELS) {
      return `Zu viele Sprachlabels (max. ${MAX_LABELS}) · Too many labels`;
    }
    if (entries.some(([k, v]) => k.length > 10 || (typeof v === 'string' && v.length > MAX_LABEL_LENGTH))) {
      return `Ein Sprachlabel ist zu lang · A label is too long`;
    }
  }
  return null;
}
