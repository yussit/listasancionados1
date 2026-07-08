import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me",
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES || 480),
  minSearchLength: Number(process.env.MIN_SEARCH_LENGTH || 3),
  googleSheetsSpreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "",
  googleSheetsRange: process.env.GOOGLE_SHEETS_RANGE || "Sanciones!A:H",
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY || "",
  dataCsvUrl: process.env.DATA_CSV_URL || "",
  dataCacheTtlMs: Number(process.env.DATA_CACHE_TTL_MS || 300000),
  dataSyncIntervalMs: Number(process.env.DATA_SYNC_INTERVAL_MS || 300000),
};
