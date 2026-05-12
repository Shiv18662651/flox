/**
 * Email parsing and validation utility for campaign recipients.
 * This is a SHARED module (works in both server and browser).
 * Used by the recipient resolver (server) and campaign wizard UI (client).
 *
 * Requirements: 5.2, 5.3, 5.4, 5.5
 */

export interface ParsedEmails {
  valid: string[];
  invalid: string[];
  duplicatesRemoved: number;
}

/**
 * Validates an email address against a standard format pattern.
 * Uses a practical regex that covers common email formats without being overly strict.
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Parses an input string of email addresses, validates each entry,
 * deduplicates valid entries (case-insensitive), and returns categorized results.
 *
 * - Accepts addresses separated by commas, semicolons, or newlines (Requirement 5.2)
 * - Validates each address against email format (Requirement 5.3)
 * - Deduplicates valid entries case-insensitively (Requirement 5.5)
 * - Returns count of valid unique addresses (Requirement 5.4)
 */
export function parseAndValidateEmails(input: string): ParsedEmails {
  if (!input || !input.trim()) {
    return { valid: [], invalid: [], duplicatesRemoved: 0 };
  }

  // Split by commas, semicolons, or newlines
  const entries = input.split(/[,;\n\r]+/);

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (const entry of entries) {
    const trimmed = entry.trim();

    // Skip empty entries resulting from consecutive delimiters
    if (!trimmed) {
      continue;
    }

    if (!isValidEmail(trimmed)) {
      invalid.push(trimmed);
      continue;
    }

    // Case-insensitive deduplication
    const normalized = trimmed.toLowerCase();

    if (seen.has(normalized)) {
      duplicatesRemoved++;
    } else {
      seen.add(normalized);
      valid.push(trimmed);
    }
  }

  return { valid, invalid, duplicatesRemoved };
}
