export const normalizeText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export const compactSpaces = (value = "") => String(value).replace(/\s+/g, " ").trim();

export const normalizeHeader = (value = "") =>
  normalizeText(value)
    .replace(/[^a-z0-9]/g, "");
