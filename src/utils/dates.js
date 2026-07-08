const parseDateParts = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };

  const latin = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (latin) return { year: Number(latin[3]), month: Number(latin[2]), day: Number(latin[1]) };

  return null;
};

export const parseLocalDate = (value) => {
  const parts = parseDateParts(value);
  if (!parts) return null;

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDate = (value) => {
  const date = parseLocalDate(value);
  if (!date) return "";

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
};

export const extractDurationDays = (value) => {
  const match = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/(\d{1,4})\s*dias?/);

  return match ? Number(match[1]) : null;
};

export const addDays = (value, days) => {
  const date = parseLocalDate(value);
  if (!date || !Number.isFinite(days)) return "";
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
};

export const isCurrentSanction = ({ startDate, endDate, explicitStatus }) => {
  const normalizedStatus = String(explicitStatus || "").toLowerCase();
  if (normalizedStatus.includes("suspend")) return true;
  if (normalizedStatus.includes("venc")) return false;
  if (normalizedStatus.includes("act")) return true;

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const start = parseLocalDate(startDate)?.getTime();
  const end = parseLocalDate(endDate)?.getTime();

  if (end && end < todayUtc) return false;
  if (start && start > todayUtc) return false;
  return true;
};

export const normalizeSanctionStatus = ({ startDate, endDate, explicitStatus }) => {
  const normalizedStatus = String(explicitStatus || "").toLowerCase();
  if (normalizedStatus.includes("suspend")) return "Suspendido";
  return isCurrentSanction({ startDate, endDate, explicitStatus }) ? "Activo" : "Vencido";
};
