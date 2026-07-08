import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const auditPath = path.resolve(__dirname, "../../data/audit-log.ndjson");

export class AuditLog {
  async record(event) {
    const entry = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...event,
    };
    await fs.mkdir(path.dirname(auditPath), { recursive: true });
    await fs.appendFile(auditPath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  async list({ limit = 100, username = "", accessPoint = "", result = "", dateFrom = "", dateTo = "" } = {}) {
    const raw = await fs.readFile(auditPath, "utf8").catch(() => "");
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999Z`).getTime() : null;

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => {
        const time = new Date(entry.timestamp).getTime();
        if (fromTime && time < fromTime) return false;
        if (toTime && time > toTime) return false;
        if (username && !String(entry.username || "").toLowerCase().includes(username.toLowerCase())) return false;
        if (accessPoint && !String(entry.accessPoint || "").toLowerCase().includes(accessPoint.toLowerCase())) return false;
        if (result === "blocked" && !(entry.result?.blockingTotal > 0)) return false;
        if (result === "clear" && entry.type === "search" && entry.result?.blockingTotal > 0) return false;
        return true;
      })
      .slice(-limit)
      .reverse();
  }

  async stats() {
    const entries = await this.list({ limit: 5000 });
    const searches = entries.filter((entry) => entry.type === "search");
    const blocked = searches.filter((entry) => entry.result?.blockingTotal > 0);
    const byAccess = searches.reduce((summary, entry) => {
      const access = entry.accessPoint || "Sin acceso";
      summary[access] = (summary[access] || 0) + 1;
      return summary;
    }, {});

    return {
      totalEvents: entries.length,
      totalSearches: searches.length,
      blockedSearches: blocked.length,
      byAccess,
    };
  }
}
