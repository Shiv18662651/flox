/**
 * Server-side re-export of email parsing utilities.
 * The actual implementation is in email-parser.ts (shared module).
 * This file exists for backward compatibility with existing server-side imports.
 */
export { parseAndValidateEmails, isValidEmail } from "./email-parser";
export type { ParsedEmails } from "./email-parser";
