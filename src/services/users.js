import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const usersPath = path.resolve(__dirname, "../../data/users.json");
const usersExamplePath = path.resolve(__dirname, "../../data/users.example.json");

const publicUser = ({ passwordHash, ...user }) => user;

export class UsersRepository {
  async ensureUsersFile() {
    try {
      await fs.access(usersPath);
    } catch {
      const example = await fs.readFile(usersExamplePath, "utf8");
      await fs.mkdir(path.dirname(usersPath), { recursive: true });
      await fs.writeFile(usersPath, example, "utf8");
    }
  }

  async listUsers() {
    await this.ensureUsersFile();
    const raw = await fs.readFile(usersPath, "utf8");
    return JSON.parse(raw);
  }

  async listPublicUsers() {
    const users = await this.listUsers();
    return users.map(publicUser);
  }

  async authenticate(username, password) {
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const users = await this.listUsers();
    const user = users.find((item) => item.username.toLowerCase() === normalizedUsername && item.active);
    if (!user || !verifyPassword(password || "", user.passwordHash)) return null;
    return publicUser(user);
  }

  async createUser({ username, name, role, accessPoint, password }) {
    const users = await this.listUsers();
    const normalizedUsername = String(username || "").trim().toLowerCase();
    if (!normalizedUsername || !password) {
      throw new Error("Usuario y contrasena son requeridos.");
    }

    if (users.some((user) => user.username.toLowerCase() === normalizedUsername)) {
      throw new Error("El usuario ya existe.");
    }

    const newUser = {
      id: `usr-${Date.now()}`,
      username: normalizedUsername,
      name: String(name || normalizedUsername).trim(),
      role: role === "admin" ? "admin" : "operator",
      accessPoint: String(accessPoint || "Sin acceso asignado").trim(),
      passwordHash: hashPassword(password),
      active: true,
      forcePasswordChange: true,
      lastLoginAt: null,
    };

    users.push(newUser);
    await fs.writeFile(usersPath, `${JSON.stringify(users, null, 2)}\n`, "utf8");
    return publicUser(newUser);
  }

  async updateUser(userId, { username, name, role, accessPoint, password, active, forcePasswordChange }) {
    const users = await this.listUsers();
    const index = users.findIndex((user) => user.id === userId);
    if (index === -1) throw new Error("Usuario no encontrado.");

    const normalizedUsername = String(username || "").trim().toLowerCase();
    if (!normalizedUsername) throw new Error("Usuario es requerido.");

    const duplicate = users.some((user) => user.id !== userId && user.username.toLowerCase() === normalizedUsername);
    if (duplicate) throw new Error("El usuario ya existe.");

    users[index] = {
      ...users[index],
      username: normalizedUsername,
      name: String(name || normalizedUsername).trim(),
      role: role === "admin" ? "admin" : "operator",
      accessPoint: String(accessPoint || "Sin acceso asignado").trim(),
      active: typeof active === "boolean" ? active : users[index].active,
      forcePasswordChange: typeof forcePasswordChange === "boolean" ? forcePasswordChange : users[index].forcePasswordChange,
      ...(password ? { passwordHash: hashPassword(password) } : {}),
    };

    await fs.writeFile(usersPath, `${JSON.stringify(users, null, 2)}\n`, "utf8");
    return publicUser(users[index]);
  }

  async setActive(userId, active) {
    const users = await this.listUsers();
    const user = users.find((item) => item.id === userId);
    if (!user) throw new Error("Usuario no encontrado.");
    user.active = Boolean(active);
    await fs.writeFile(usersPath, `${JSON.stringify(users, null, 2)}\n`, "utf8");
    return publicUser(user);
  }

  async updateLastLogin(userId) {
    const users = await this.listUsers();
    const user = users.find((item) => item.id === userId);
    if (!user) return null;
    user.lastLoginAt = new Date().toISOString();
    await fs.writeFile(usersPath, `${JSON.stringify(users, null, 2)}\n`, "utf8");
    return publicUser(user);
  }

  async changePassword(userId, currentPassword, newPassword) {
    const users = await this.listUsers();
    const user = users.find((item) => item.id === userId);
    if (!user) throw new Error("Usuario no encontrado.");
    if (!newPassword || String(newPassword).length < 6) throw new Error("La nueva contrasena debe tener al menos 6 caracteres.");
    if (!verifyPassword(currentPassword || "", user.passwordHash)) throw new Error("La contrasena actual no es correcta.");

    user.passwordHash = hashPassword(newPassword);
    user.forcePasswordChange = false;
    await fs.writeFile(usersPath, `${JSON.stringify(users, null, 2)}\n`, "utf8");
    return publicUser(user);
  }
}
