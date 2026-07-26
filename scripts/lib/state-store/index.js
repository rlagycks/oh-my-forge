'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');

const { applyMigrations, getAppliedMigrations } = require('./migrations');
const { createQueryApi } = require('./queries');
const { assertValidEntity, validateEntity } = require('./schema');

const DEFAULT_STATE_STORE_RELATIVE_PATH = path.join('.claude', 'ecc', 'state.db');

function resolveStateStorePath(options = {}) {
  if (options.dbPath) {
    if (options.dbPath === ':memory:') {
      return options.dbPath;
    }
    return path.resolve(options.dbPath);
  }

  const homeDir = options.homeDir || process.env.HOME || os.homedir();
  return path.join(homeDir, DEFAULT_STATE_STORE_RELATIVE_PATH);
}

/**
 * Wraps a sql.js Database with a better-sqlite3-compatible API surface so
 * that the rest of the state-store code (migrations.js, queries.js) can
 * operate without knowing which driver is in use.
 *
 * IMPORTANT: sql.js db.export() implicitly ends any active transaction, so
 * we must defer all disk writes until after the transaction commits.
 */
function wrapSqlJsDatabase(rawDb, dbPath, { readOnly = false } = {}) {
  let inTransaction = false;

  function saveToDisk() {
    if (readOnly || dbPath === ':memory:' || inTransaction) {
      return;
    }
    const data = rawDb.export();
    const buffer = Buffer.from(data);
    const temporaryPath = `${dbPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, buffer, { mode: 0o600 });
      fs.renameSync(temporaryPath, dbPath);
    } finally {
      if (fs.existsSync(temporaryPath)) {
        try { fs.unlinkSync(temporaryPath); } catch (_error) { /* best effort */ }
      }
    }
  }

  const db = {
    exec(sql) {
      if (readOnly) throw new Error('State store is read-only');
      rawDb.run(sql);
      saveToDisk();
    },

    pragma(pragmaStr) {
      try {
        rawDb.run(`PRAGMA ${pragmaStr}`);
      } catch (_error) {
        // Ignore unsupported pragmas (e.g. WAL for in-memory databases).
      }
    },

    prepare(sql) {
      return {
        all(...positionalArgs) {
          const stmt = rawDb.prepare(sql);
          if (positionalArgs.length === 1 && typeof positionalArgs[0] !== 'object') {
            stmt.bind([positionalArgs[0]]);
          } else if (positionalArgs.length > 1) {
            stmt.bind(positionalArgs);
          }

          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        },

        get(...positionalArgs) {
          const stmt = rawDb.prepare(sql);
          if (positionalArgs.length === 1 && typeof positionalArgs[0] !== 'object') {
            stmt.bind([positionalArgs[0]]);
          } else if (positionalArgs.length > 1) {
            stmt.bind(positionalArgs);
          }

          let row = null;
          if (stmt.step()) {
            row = stmt.getAsObject();
          }
          stmt.free();
          return row;
        },

        run(namedParams) {
          if (readOnly) throw new Error('State store is read-only');
          const stmt = rawDb.prepare(sql);
          if (namedParams && typeof namedParams === 'object' && !Array.isArray(namedParams)) {
            const sqlJsParams = {};
            for (const [key, value] of Object.entries(namedParams)) {
              sqlJsParams[`@${key}`] = value === undefined ? null : value;
            }
            stmt.bind(sqlJsParams);
          }
          stmt.step();
          stmt.free();
          saveToDisk();
        },
      };
    },

    transaction(fn) {
      return (...args) => {
        if (readOnly) throw new Error('State store is read-only');
        rawDb.run('BEGIN');
        inTransaction = true;
        try {
          const result = fn(...args);
          rawDb.run('COMMIT');
          inTransaction = false;
          saveToDisk();
          return result;
        } catch (error) {
          try {
            rawDb.run('ROLLBACK');
          } catch (_rollbackError) {
            // Transaction may already be rolled back.
          }
          inTransaction = false;
          throw error;
        }
      };
    },

    close() {
      saveToDisk();
      rawDb.close();
    },
  };

  return db;
}

async function openDatabase(SQL, dbPath, { readOnly = false } = {}) {
  if (!readOnly && dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  if (readOnly && (dbPath === ':memory:' || !fs.existsSync(dbPath))) {
    throw new Error('Read-only state store database is unavailable');
  }

  let rawDb;
  if (dbPath !== ':memory:' && fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    rawDb = new SQL.Database(fileBuffer);
  } else {
    rawDb = new SQL.Database();
  }

  const db = wrapSqlJsDatabase(rawDb, dbPath, { readOnly });
  db.pragma('foreign_keys = ON');
  try {
    db.pragma('journal_mode = WAL');
  } catch (_error) {
    // Some SQLite environments reject WAL for in-memory or readonly contexts.
  }
  return db;
}

function getReadOnlyAppliedMigrations(db) {
  return db
    .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC')
    .all()
    .map(row => ({ version: row.version, name: row.name, appliedAt: row.applied_at }));
}

async function createStateStore(options = {}) {
  const dbPath = resolveStateStorePath(options);
  const readOnly = options.readOnly === true;
  const SQL = await initSqlJs();
  const db = await openDatabase(SQL, dbPath, { readOnly });
  const appliedMigrations = readOnly ? getReadOnlyAppliedMigrations(db) : applyMigrations(db);
  const queryApi = createQueryApi(db);

  return {
    dbPath,
    readOnly,
    close() {
      db.close();
    },
    getAppliedMigrations() {
      return readOnly ? [...appliedMigrations] : getAppliedMigrations(db);
    },
    validateEntity,
    assertValidEntity,
    ...queryApi,
    _database: db,
    _migrations: appliedMigrations,
  };
}

module.exports = {
  DEFAULT_STATE_STORE_RELATIVE_PATH,
  createStateStore,
  resolveStateStorePath,
};
