import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config.js";
import { createSessionToken, readSessionToken } from "./services/auth.js";
import { AuditLog } from "./services/auditLog.js";
import { SanctionsRepository } from "./services/dataSource.js";
import { UsersRepository } from "./services/users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.resolve(__dirname, "../public");
const repository = new SanctionsRepository(config);
const usersRepository = new UsersRepository();
const auditLog = new AuditLog();

const app = express();
const isProduction = config.nodeEnv === "production";

if (isProduction) {
  const missingSecrets = [];
  if (!config.sessionSecret || config.sessionSecret === "dev-secret-change-me") missingSecrets.push("SESSION_SECRET");

  if (missingSecrets.length) {
    throw new Error(`Variables requeridas en produccion: ${missingSecrets.join(", ")}`);
  }
}

app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "20kb" }));
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
      },
    },
  }),
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const getCookie = (request, name) => {
  const cookieHeader = request.headers.cookie || "";
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
};

const requireSession = (request, response, next) => {
  const token = decodeURIComponent(getCookie(request, "asipona_session") || "");
  const session = readSessionToken(token, config.sessionSecret);
  if (!session?.user) {
    return response.status(401).json({ message: "Sesion requerida." });
  }
  request.user = session.user;
  return next();
};

const requireAdmin = (request, response, next) => {
  if (request.user?.role !== "admin") {
    return response.status(403).json({ message: "Permiso de administrador requerido." });
  }
  return next();
};

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "sanciones-asipona" });
});

app.post("/api/auth/login", loginLimiter, async (request, response, next) => {
  try {
    const { username, password, accessPoint } = request.body || {};
    const user = await usersRepository.authenticate(username, password);

    if (!user) {
      return response.status(401).json({ message: "Usuario o contrasena invalidos." });
    }

    const userWithLogin = await usersRepository.updateLastLogin(user.id);
    const sessionUser = {
      ...(userWithLogin || user),
      accessPoint: user.role === "admin" ? accessPoint || user.accessPoint : user.accessPoint,
      loginAt: new Date().toISOString(),
    };

    const token = createSessionToken({
      secret: config.sessionSecret,
      ttlMinutes: config.sessionTtlMinutes,
      user: sessionUser,
    });

    response.cookie("asipona_session", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: config.sessionTtlMinutes * 60 * 1000,
      path: "/",
    });

    await auditLog.record({
      type: "login",
      userId: sessionUser.id,
      username: sessionUser.username,
      role: sessionUser.role,
      accessPoint: sessionUser.accessPoint,
      result: { ok: true },
    });

    return response.json({ ok: true, user: sessionUser });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/logout", (_request, response) => {
  response.clearCookie("asipona_session", { path: "/" });
  response.json({ ok: true });
});

app.get("/api/session", requireSession, (request, response) => {
  response.json({ authenticated: true, user: request.user });
});

app.post("/api/account/password", requireSession, async (request, response) => {
  try {
    const user = await usersRepository.changePassword(request.user.id, request.body?.currentPassword, request.body?.newPassword);
    const sessionUser = {
      ...request.user,
      ...user,
      accessPoint: request.user.accessPoint,
      loginAt: request.user.loginAt,
    };
    const token = createSessionToken({
      secret: config.sessionSecret,
      ttlMinutes: config.sessionTtlMinutes,
      user: sessionUser,
    });
    response.cookie("asipona_session", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: config.sessionTtlMinutes * 60 * 1000,
      path: "/",
    });
    response.json({ user: sessionUser });
  } catch (error) {
    response.status(400).json({ message: error.message });
  }
});

app.get("/api/sanciones/search", apiLimiter, requireSession, async (request, response, next) => {
  try {
    const query = String(request.query.q || "").trim();
    if (query.length < config.minSearchLength) {
      return response.status(400).json({
        message: `Ingrese al menos ${config.minSearchLength} caracteres.`,
      });
    }

    const results = await repository.search(query);
    await auditLog.record({
      type: "search",
      userId: request.user.id,
      username: request.user.username,
      role: request.user.role,
      accessPoint: request.user.accessPoint,
      query,
      result: {
        total: results.total,
        blockingTotal: results.blockingTotal,
        firstMatch: results.results[0]
          ? {
              nombre: results.results[0].nombre,
              identificacion: results.results[0].identificacion,
              empresa: results.results[0].empresa,
              estatus: results.results[0].estatus,
              tipoSancion: results.results[0].tipoSancion,
            }
          : null,
        detectedTokens: results.detectedTokens,
      },
    });
    return response.json(results);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/users", apiLimiter, requireSession, requireAdmin, async (_request, response, next) => {
  try {
    response.json({ users: await usersRepository.listPublicUsers() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users", apiLimiter, requireSession, requireAdmin, async (request, response, next) => {
  try {
    const user = await usersRepository.createUser(request.body || {});
    await auditLog.record({
      type: "user-created",
      userId: request.user.id,
      username: request.user.username,
      accessPoint: request.user.accessPoint,
      result: { createdUser: user.username, role: user.role },
    });
    response.status(201).json({ user });
  } catch (error) {
    response.status(400).json({ message: error.message });
  }
});

app.patch("/api/admin/users/:userId", apiLimiter, requireSession, requireAdmin, async (request, response) => {
  try {
    const user = await usersRepository.updateUser(request.params.userId, request.body || {});
    await auditLog.record({
      type: "user-updated",
      userId: request.user.id,
      username: request.user.username,
      accessPoint: request.user.accessPoint,
      result: { updatedUser: user.username, role: user.role, active: user.active },
    });
    response.json({ user });
  } catch (error) {
    response.status(400).json({ message: error.message });
  }
});

app.patch("/api/admin/users/:userId/status", apiLimiter, requireSession, requireAdmin, async (request, response) => {
  try {
    if (request.params.userId === request.user.id && request.body?.active === false) {
      return response.status(400).json({ message: "No puede desactivar su propia sesion de administrador." });
    }

    const user = await usersRepository.setActive(request.params.userId, Boolean(request.body?.active));
    await auditLog.record({
      type: user.active ? "user-activated" : "user-disabled",
      userId: request.user.id,
      username: request.user.username,
      accessPoint: request.user.accessPoint,
      result: { targetUser: user.username },
    });
    response.json({ user });
  } catch (error) {
    response.status(400).json({ message: error.message });
  }
});

app.get("/api/admin/audit", apiLimiter, requireSession, requireAdmin, async (request, response, next) => {
  try {
    const limit = Number(request.query.limit || 100);
    response.json({
      events: await auditLog.list({
        limit,
        username: request.query.username,
        accessPoint: request.query.accessPoint,
        result: request.query.result,
        dateFrom: request.query.dateFrom,
        dateTo: request.query.dateTo,
      }),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/stats", apiLimiter, requireSession, requireAdmin, async (_request, response, next) => {
  try {
    const cache = await repository.getRecords();
    response.json({
      source: cache.source,
      loadedAt: cache.loadedAt,
      records: cache.records.length,
      audit: await auditLog.stats(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sanciones/refresh", apiLimiter, requireSession, async (_request, response, next) => {
  try {
    const cache = await repository.refresh();
    response.json({
      ok: true,
      source: cache.source,
      total: cache.records.length,
      loadedAt: cache.loadedAt,
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(publicPath, { maxAge: isProduction ? "1h" : 0 }));

app.use((request, response, next) => {
  if (request.path.startsWith("/api/")) return next();
  return response.sendFile(path.join(publicPath, "index.html"));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ message: "Ocurrio un error interno. Intente nuevamente." });
});

const startAutomaticSync = () => {
  repository.refresh().catch((error) => {
    console.error("No fue posible sincronizar la fuente al iniciar.", error);
  });

  if (config.dataSyncIntervalMs > 0) {
    setInterval(() => {
      repository.refresh().catch((error) => {
        console.error("No fue posible sincronizar la fuente.", error);
      });
    }, config.dataSyncIntervalMs).unref();
  }
};

app.listen(config.port, () => {
  startAutomaticSync();
  console.log(`Sistema de sanciones ASIPONA disponible en http://localhost:${config.port}`);
});
