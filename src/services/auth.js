import crypto from "node:crypto";

const TOKEN_VERSION = "v1";

const sign = (payload, secret) =>
  crypto.createHmac("sha256", secret).update(payload).digest("base64url");

const timingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const hashPassword = (password, salt = crypto.randomBytes(16).toString("base64url")) => {
  const derived = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${derived}`;
};

export const verifyPassword = (password, configuredHash, fallbackPassword) => {
  if (configuredHash) {
    const [algorithm, salt, storedHash] = configuredHash.split(":");
    if (algorithm !== "scrypt" || !salt || !storedHash) return false;
    const calculated = hashPassword(password, salt).split(":")[2];
    return timingSafeEqual(calculated, storedHash);
  }

  return Boolean(fallbackPassword) && timingSafeEqual(password, fallbackPassword);
};

export const createSessionToken = ({ secret, ttlMinutes, user }) => {
  const expiresAt = Date.now() + Number(ttlMinutes) * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ version: TOKEN_VERSION, expiresAt, user })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
};

export const readSessionToken = (token, secret) => {
  if (!token || !secret || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = sign(payload, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.version !== TOKEN_VERSION || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
};

export const verifySessionToken = (token, secret) => Boolean(readSessionToken(token, secret));
