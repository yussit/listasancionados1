import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { google } from "googleapis";
import { compactSpaces, normalizeHeader, normalizeText } from "../utils/normalize.js";
import { addDays, extractDurationDays, formatDate, normalizeSanctionStatus } from "../utils/dates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localCsvPath = path.resolve(__dirname, "../../data/sanciones.csv");
const exampleCsvPath = path.resolve(__dirname, "../../data/sanciones.example.csv");

const headerAliases = {
  nombre: ["nombre", "name", "persona", "trabajador"],
  identificacion: ["identificacion", "identificador", "numeroempleado", "noempleado", "empleado", "id", "numero"],
  empresa: ["empresa", "compania", "cia", "razonsocial", "proveedor", "contratista"],
  motivo: ["motivo", "motivo2", "motivodesancion", "sancion", "causa"],
  fechaInicio: ["fechainicio", "fechainicio2", "iniciodesancion", "iniciodesancion2", "inicio", "desde"],
  fechaTermino: ["fechatermino", "findesancion", "termino", "fin", "hasta", "fechafin"],
  observaciones: ["observaciones", "observacion", "comentarios", "notas"],
  estatus: ["estatus", "estado", "estado2", "status", "situacion"],
};

const resolveColumn = (row, fieldName) => {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]);
  const aliases = headerAliases[fieldName];
  const match = normalizedEntries.find(([key]) => aliases.includes(key));
  return compactSpaces(match?.[1] ?? "");
};

const classifySanctionType = (motivo = "") => {
  const text = normalizeText(motivo);
  if (/alcohol|cerveza|bebida|embriag|ebriedad|etilic/.test(text)) return "Alcohol";
  if (/velocidad|kph|km|exceso/.test(text)) return "Velocidad";
  if (/documento|credencial|identificacion|vencid/.test(text)) return "Documento";
  if (/caccs|instruccion/.test(text)) return "Instruccion CACCS";
  if (/arma|punzo|cortante/.test(text)) return "Objeto prohibido";
  return "Otro";
};

const mapRow = (row, index) => {
  const estatusFuente = resolveColumn(row, "estatus");
  const fechaInicio = resolveColumn(row, "fechaInicio");
  const fechaTermino = resolveColumn(row, "fechaTermino");
  const durationDays = extractDurationDays(estatusFuente);
  const calculatedEndDate = !fechaTermino && durationDays ? addDays(fechaInicio, durationDays) : "";

  const sanction = {
    id: `sanction-${index + 1}`,
    nombre: resolveColumn(row, "nombre"),
    identificacion: resolveColumn(row, "identificacion"),
    empresa: resolveColumn(row, "empresa"),
    motivo: resolveColumn(row, "motivo"),
    fechaInicio,
    fechaTermino: fechaTermino || calculatedEndDate,
    observaciones: resolveColumn(row, "observaciones"),
    estatusFuente,
    fechaTerminoCalculada: Boolean(calculatedEndDate),
    duracionDias: durationDays,
  };
  sanction.tipoSancion = classifySanctionType(sanction.motivo);

  const normalizedStatus = normalizeSanctionStatus({
    startDate: sanction.fechaInicio,
    endDate: sanction.fechaTermino,
    explicitStatus: sanction.estatusFuente,
  });
  const blocking = normalizedStatus === "Activo" || normalizedStatus === "Suspendido";

  return {
    ...sanction,
    fechaInicioTexto: formatDate(sanction.fechaInicio),
    fechaTerminoTexto: formatDate(sanction.fechaTermino),
    estatus: normalizedStatus,
    activo: blocking,
    bloqueante: blocking,
    searchIndex: normalizeText(`${sanction.nombre} ${sanction.identificacion} ${sanction.empresa}`),
  };
};

const parseQrTokens = (query) => {
  const raw = String(query || "").trim();
  const tokens = new Set([raw]);

  try {
    const parsed = JSON.parse(raw);
    Object.values(parsed).forEach((value) => {
      if (typeof value === "string" || typeof value === "number") tokens.add(String(value));
    });
  } catch {
    // Los QR heredados pueden venir como URL o texto plano.
  }

  try {
    const url = new URL(raw);
    url.searchParams.forEach((value) => tokens.add(value));
  } catch {
    // El QR puede no ser URL; se intenta con patrones de texto comunes.
  }

  raw
    .split(/[|,;:\n\r\t ]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const keyValue = part.match(/(?:empleado|noempleado|numempleado|id|identificacion|curp|qr)=?(.+)/i);
      tokens.add(keyValue?.[1] || part);
    });

  return [...tokens].map(normalizeText).filter((token) => token.length >= 3);
};

const parseCsv = (csvText) => {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });

  return records
    .map(mapRow)
    .filter((record) => record.nombre || record.identificacion);
};

const loadFromGoogleSheets = async (config) => {
  const privateKey = config.googlePrivateKey?.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetsSpreadsheetId,
    range: config.googleSheetsRange,
  });

  const [headers = [], ...rows] = response.data.values || [];
  const records = rows.map((row) =>
    headers.reduce((record, header, columnIndex) => {
      record[header] = row[columnIndex] ?? "";
      return record;
    }, {}),
  );

  return records.map(mapRow).filter((record) => record.nombre || record.identificacion);
};

const loadFromCsvUrl = async (url) => {
  const response = await fetch(url, { headers: { Accept: "text/csv,*/*" } });
  if (!response.ok) throw new Error(`No se pudo leer el CSV remoto: ${response.status}`);
  return parseCsv(await response.text());
};

const loadFromLocalCsv = async () => {
  try {
    return parseCsv(await fs.readFile(localCsvPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return parseCsv(await fs.readFile(exampleCsvPath, "utf8"));
  }
};

export class SanctionsRepository {
  constructor(config) {
    this.config = config;
    this.cache = { loadedAt: 0, records: [], source: "local" };
    this.refreshPromise = null;
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      if (
        this.config.googleSheetsSpreadsheetId &&
        this.config.googleServiceAccountEmail &&
        this.config.googlePrivateKey
      ) {
        this.cache = {
          loadedAt: Date.now(),
          records: await loadFromGoogleSheets(this.config),
          source: "google-sheets",
        };
        return this.cache;
      }

      if (this.config.dataCsvUrl) {
        this.cache = {
          loadedAt: Date.now(),
          records: await loadFromCsvUrl(this.config.dataCsvUrl),
          source: "csv-url",
        };
        return this.cache;
      }

      this.cache = {
        loadedAt: Date.now(),
        records: await loadFromLocalCsv(),
        source: "local-csv",
      };
      return this.cache;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async getRecords() {
    const stale = Date.now() - this.cache.loadedAt > this.config.dataCacheTtlMs;
    if (!this.cache.loadedAt || stale) await this.refresh();
    return this.cache;
  }

  async search(query) {
    const normalizedQuery = normalizeText(query);
    const queryWords = normalizedQuery.split(/\s+/).filter((token) => token.length >= 3);
    const queryTokens = parseQrTokens(query);
    const { records, source, loadedAt } = await this.getRecords();
    const exactResults = records
      .filter((record) => normalizedQuery.length >= 3 && record.searchIndex.includes(normalizedQuery))
      .map((record) => ({ record, score: 1000 }));

    const fallbackResults = exactResults.length
      ? []
      : records
          .map((record) => {
            const allWordsMatch = queryWords.length > 1 && queryWords.every((token) => record.searchIndex.includes(token));
            const tokenMatches = queryTokens.filter((token) => record.searchIndex.includes(token)).length;
            const singleTokenMatch = queryWords.length === 1 && tokenMatches > 0;
            const score = allWordsMatch ? 100 + tokenMatches : singleTokenMatch ? tokenMatches : 0;
            return { record, score };
          })
          .filter(({ score }) => score > 0);

    const results = [...exactResults, ...fallbackResults]
      .sort((left, right) => right.score - left.score || left.record.nombre.localeCompare(right.record.nombre, "es"))
      .map(({ record }) => {
        const { searchIndex, ...publicRecord } = record;
        return publicRecord;
      });

    return {
      query,
      detectedTokens: queryTokens,
      blockingTotal: results.filter((record) => record.bloqueante).length,
      total: results.length,
      source,
      loadedAt,
      results,
    };
  }
}
