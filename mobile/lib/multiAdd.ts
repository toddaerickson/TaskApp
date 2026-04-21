/**
 * Pure helpers for the multi-add (brain-dump) task-creation flow.
 *
 * Rules:
 *   - Split on newlines (LF or CRLF).
 *   - Trim each line.
 *   - Drop empty lines.
 *   - Drop lines starting with `#` (comments — useful for paste-from-notes).
 *   - Cap at MAX_BATCH to avoid accidental 10k-line pastes.
 */

export const MAX_BATCH = 500;

export interface ParsedBatch {
  /** Parsed, trimmed titles ready for POST /tasks. */
  titles: string[];
  /** Whether the input was capped at MAX_BATCH. */
  truncated: boolean;
}

export function parseBatch(text: string): ParsedBatch {
  const lines = text.split(/\r?\n/);
  const titles: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    titles.push(trimmed);
  }
  const truncated = titles.length > MAX_BATCH;
  return { titles: truncated ? titles.slice(0, MAX_BATCH) : titles, truncated };
}

/**
 * Rebuild the textarea content from a set of remaining titles after a
 * partial-success batch. Preserves the "one per line" shape so the user
 * can edit and retry without re-typing. Comments/blanks aren't
 * reconstructed — we lost them during parse — but that's acceptable in
 * a retry-only flow.
 */
export function titlesToText(titles: string[]): string {
  return titles.join('\n');
}
