import express from "express";
import mqtt from "mqtt";
import Database from "better-sqlite3";

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 90;

const db = new Database(process.env.DB_PATH || "/data/readings.db");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    temperature REAL,
    humidity REAL,
    battery INTEGER,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_readings_name_ts ON readings(name, ts);
`);

const insert = db.prepare(
  "INSERT INTO readings (name, temperature, humidity, battery, ts) VALUES (?, ?, ?, ?, ?)"
);

const app = express();
const state = new Map();   // friendlyName -> latest reading
const clients = new Set(); // connected SSE browsers

// Hydrate latest values from DB so the dashboard isn't blank after a restart
for (const r of db.prepare(`
  SELECT r.name, r.temperature, r.humidity, r.battery, r.ts AS updated
  FROM readings r
  JOIN (SELECT name, MAX(ts) ts FROM readings GROUP BY name) m
    ON r.name = m.name AND r.ts = m.ts
`).all()) {
  state.set(r.name, r);
}

const client = mqtt.connect(process.env.MQTT_URL || "mqtt://localhost:1883");
client.on("connect", () => client.subscribe("zigbee2mqtt/+"));

client.on("message", (topic, payload) => {
  const name = topic.split("/")[1];
  if (name === "bridge") return; // ignore Z2M status topics
  let data;
  try { data = JSON.parse(payload.toString()); } catch { return; }
  if (data.temperature == null && data.humidity == null) return;

  const now = Date.now();
  const reading = {
    name,
    temperature: data.temperature,
    humidity: data.humidity,
    battery: data.battery,
    updated: now,
  };
  state.set(name, reading);
  insert.run(name, data.temperature, data.humidity, data.battery ?? null, now);

  const line = `data: ${JSON.stringify(reading)}\n\n`;
  for (const res of clients) res.write(line);
});

app.use(express.static("public"));

// All sensors, latest values
app.get("/api/state", (_req, res) => res.json([...state.values()]));

// One sensor, latest value
app.get("/api/sensors/:name", (req, res) => {
  const r = state.get(req.params.name);
  if (!r) return res.status(404).json({ error: "unknown sensor" });
  res.json(r);
});

// One sensor, history (default 24h, max 90 days)
app.get("/api/sensors/:name/history", (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 24 * 90);
  const since = Date.now() - hours * 3600 * 1000;
  const rows = db.prepare(
    "SELECT temperature, humidity, battery, ts FROM readings WHERE name = ? AND ts >= ? ORDER BY ts"
  ).all(req.params.name, since);
  res.json(rows);
});

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, sensors: state.size, mqtt: client.connected })
);

// Live updates
app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

// Prune old readings on boot and every 6h
function prune() {
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  db.prepare("DELETE FROM readings WHERE ts < ?").run(cutoff);
}
prune();
setInterval(prune, 6 * 3600 * 1000);

app.listen(3000, () => console.log("Dashboard on :3000"));
