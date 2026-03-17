const Database = require("better-sqlite3");

const { env } = require("../utils/env");

let db;

function parseJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function initDatabase() {
  if (db) {
    return db;
  }

  db = new Database(env.databasePath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_type TEXT NOT NULL,
      file_name TEXT,
      file_hash TEXT,
      mime_type TEXT,
      file_size INTEGER,
      file_pages INTEGER,
      config_json TEXT,
      roi_json TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

function getDb() {
  if (!db) {
    initDatabase();
  }

  return db;
}

function listPresetRecords() {
  return getDb()
    .prepare("SELECT * FROM presets ORDER BY updated_at DESC")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      config: parseJson(row.config_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

function createPresetRecord({ name, description, config }) {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `
        INSERT INTO presets (name, description, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
    )
    .run(name, description || "", JSON.stringify(config || {}), now, now);

  return result.lastInsertRowid;
}

function updatePresetRecord(id, { name, description, config }) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `
        UPDATE presets
        SET name = ?, description = ?, config_json = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(name, description || "", JSON.stringify(config || {}), now, id);
}

function deletePresetRecord(id) {
  getDb().prepare("DELETE FROM presets WHERE id = ?").run(id);
}

function addHistoryEntry({
  runType,
  fileName,
  fileHash,
  mimeType,
  fileSize,
  filePages,
  config,
  roi,
  result,
}) {
  const now = new Date().toISOString();
  const insert = getDb()
    .prepare(
      `
        INSERT INTO history (
          run_type,
          file_name,
          file_hash,
          mime_type,
          file_size,
          file_pages,
          config_json,
          roi_json,
          result_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      runType,
      fileName,
      fileHash,
      mimeType,
      fileSize,
      filePages,
      JSON.stringify(config || {}),
      JSON.stringify(roi || null),
      JSON.stringify(result || {}),
      now
    );

  return insert.lastInsertRowid;
}

function listHistoryEntries(limit = 20) {
  return getDb()
    .prepare("SELECT * FROM history ORDER BY created_at DESC LIMIT ?")
    .all(limit)
    .map((row) => ({
      id: row.id,
      runType: row.run_type,
      fileName: row.file_name,
      fileHash: row.file_hash,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      filePages: row.file_pages,
      config: parseJson(row.config_json, {}),
      roi: parseJson(row.roi_json, null),
      result: parseJson(row.result_json, {}),
      createdAt: row.created_at,
    }));
}

module.exports = {
  initDatabase,
  listPresetRecords,
  createPresetRecord,
  updatePresetRecord,
  deletePresetRecord,
  addHistoryEntry,
  listHistoryEntries,
};
