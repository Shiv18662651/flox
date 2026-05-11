/**
 * Environment variable validation module.
 * Validates all required environment variables at startup and exits
 * with a descriptive error if any are missing.
 */

const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "DATABASE_URL",
  "REDIS_URL",
  "MEILISEARCH_URL",
  "MEILISEARCH_MASTER_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_SENDER_NAME",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "SENTRY_DSN",
  "SESSION_SECRET",
] as const;

export type EnvVarName = (typeof REQUIRED_ENV_VARS)[number];

export interface AppEnv {
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_APP_URL: string;
  SCOPES: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  MEILISEARCH_URL: string;
  MEILISEARCH_MASTER_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
  BREVO_API_KEY: string;
  BREVO_SENDER_EMAIL: string;
  BREVO_SENDER_NAME: string;
  GROQ_API_KEY: string;
  GROQ_MODEL: string;
  SENTRY_DSN: string;
  SESSION_SECRET: string;
  NODE_ENV: string;
  PORT: string;
}

/**
 * Validates that all required environment variables are present.
 * Returns the missing variable names if any are absent.
 */
export function getMissingEnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter(
    (varName) => !process.env[varName] || process.env[varName]!.trim() === ""
  );
}

/**
 * Validates secret length requirements.
 * Returns an array of error messages for secrets that don't meet minimum length.
 * Requirements: 16.5, 16.12
 */
export function getSecretLengthErrors(): string[] {
  const errors: string[] = [];

  const sessionSecret = process.env.SESSION_SECRET || "";
  if (sessionSecret.length > 0 && sessionSecret.length < 32) {
    errors.push(
      `SESSION_SECRET must be at least 32 characters (currently ${sessionSecret.length})`
    );
  }

  const meilisearchKey = process.env.MEILISEARCH_MASTER_KEY || "";
  if (meilisearchKey.length > 0 && meilisearchKey.length < 16) {
    errors.push(
      `MEILISEARCH_MASTER_KEY must be at least 16 characters (currently ${meilisearchKey.length})`
    );
  }

  return errors;
}

/**
 * Validates all required environment variables at startup.
 * Exits the process with a descriptive error if any are missing.
 * Also validates secret length requirements (Req 16.5, 16.12).
 */
export function validateEnv(): AppEnv {
  const missing = getMissingEnvVars();

  if (missing.length > 0) {
    console.error(
      `\n❌ Missing required environment variables:\n\n` +
        missing.map((v) => `  • ${v}`).join("\n") +
        `\n\nPlease set these variables in your .env file or environment.\n` +
        `See .env.example for reference.\n`
    );
    process.exit(1);
  }

  // Validate secret length requirements
  const secretErrors = getSecretLengthErrors();
  if (secretErrors.length > 0) {
    console.error(
      `\n❌ Secret length validation failed:\n\n` +
        secretErrors.map((e) => `  • ${e}`).join("\n") +
        `\n\nPlease update your secrets to meet minimum length requirements.\n`
    );
    process.exit(1);
  }

  return {
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY!,
    SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET!,
    SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL!,
    SCOPES: process.env.SCOPES!,
    DATABASE_URL: process.env.DATABASE_URL!,
    REDIS_URL: process.env.REDIS_URL!,
    MEILISEARCH_URL: process.env.MEILISEARCH_URL!,
    MEILISEARCH_MASTER_KEY: process.env.MEILISEARCH_MASTER_KEY!,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY!,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME!,
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL!,
    BREVO_API_KEY: process.env.BREVO_API_KEY!,
    BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL!,
    BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME!,
    GROQ_API_KEY: process.env.GROQ_API_KEY!,
    GROQ_MODEL: process.env.GROQ_MODEL!,
    SENTRY_DSN: process.env.SENTRY_DSN!,
    SESSION_SECRET: process.env.SESSION_SECRET!,
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: process.env.PORT || "3000",
  };
}

/** Exported list of required env var names for testing */
export { REQUIRED_ENV_VARS };
