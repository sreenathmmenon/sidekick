import { DatabaseSync } from "node:sqlite";
import { eventFromRow } from "./domain.js";
import { NullCipher } from "./crypto.js";

// Preflight: node:sqlite ships behind --experimental-sqlite. Rather than let the
// process die with a cryptic native error if the runtime can't provide it, fail
// fast with an actionable message naming the exact requirement.
function assertSqliteAvailable() {
  if (typeof DatabaseSync !== "function") {
    throw new Error(
      "SQLite runtime unavailable. Sidekick requires Node >= 22.5.0 started with " +
      "--experimental-sqlite (the npm scripts set this). Run `node --version` and use `npm start`."
    );
  }
}

export class TimelineStore {
  constructor(dbPath, cipher = new NullCipher()) {
    assertSqliteAvailable();
    this.db = new DatabaseSync(dbPath);
    this.cipher = cipher;
    this.migrate();
    this.statements = this.prepareStatements();
  }

  // Runs fn inside a single SQLite transaction so multi-row units (an event plus
  // its derived commitments/lessons/memory) commit all-or-nothing. A throw rolls
  // back, so a crash mid-derivation can never leave orphaned/partial rows.
  // Real readiness probe: confirms the DB is reachable AND that the cipher can
  // decrypt existing data (catches a key/salt mismatch). Returns {ok, detail}.
  healthCheck() {
    try {
      this.db.prepare("SELECT 1").get();
    } catch (error) {
      return { ok: false, detail: "database unreachable: " + error.message };
    }
    try {
      // Decrypt-smoke-test one real row if any exist; a key mismatch throws here.
      const row = this.db.prepare("SELECT summary FROM events WHERE deleted_at IS NULL LIMIT 1").get();
      if (row) this.dec(row.summary);
    } catch (error) {
      return { ok: false, detail: "decryption failed (key/salt mismatch): " + error.message };
    }
    return { ok: true };
  }

  transaction(fn) {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw error;
    }
  }

  enc(value) {
    return this.cipher.encrypt(value);
  }

  dec(value) {
    return this.cipher.decrypt(value);
  }

  migrate() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        ref_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        project TEXT,
        confidence REAL NOT NULL,
        origin TEXT NOT NULL,
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
      CREATE INDEX IF NOT EXISTS idx_events_deleted ON events(deleted_at);

      CREATE TABLE IF NOT EXISTS commitments (
        id TEXT PRIMARY KEY,
        source_event_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        what TEXT NOT NULL,
        who TEXT NOT NULL,
        due TEXT,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        provenance_ref_json TEXT NOT NULL,
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(source_event_id) REFERENCES events(id)
      );

      CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status);
      CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments(due);

      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        insight TEXT NOT NULL,
        source_refs_json TEXT NOT NULL,
        source_event_ids_json TEXT NOT NULL DEFAULT '[]',
        created_ts TEXT NOT NULL,
        last_surfaced_ts TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_lessons_topic ON lessons(topic);

      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        topic TEXT NOT NULL,
        content TEXT NOT NULL,
        source_event_ids_json TEXT NOT NULL,
        source_refs_json TEXT NOT NULL,
        embedding_ref TEXT,
        persistence_policy TEXT NOT NULL,
        privacy_level TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_ts TEXT NOT NULL,
        updated_ts TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory_records(kind);
      CREATE INDEX IF NOT EXISTS idx_memory_topic ON memory_records(topic);

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        focus TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        attention_mode TEXT NOT NULL,
        started_ts TEXT NOT NULL,
        ends_ts TEXT NOT NULL,
        completed_ts TEXT,
        status TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_focus_sessions_status ON focus_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_focus_sessions_started ON focus_sessions(started_ts);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        action TEXT NOT NULL,
        details_json TEXT NOT NULL
      );
    `);

    this.ensureColumn("lessons", "source_event_ids_json", "TEXT NOT NULL DEFAULT '[]'");
    // Inspectability columns: which engine derived a commitment and the phrase that justified it.
    this.ensureColumn("commitments", "extractor", "TEXT NOT NULL DEFAULT 'regex'");
    this.ensureColumn("commitments", "match_reason", "TEXT");
  }

  ensureColumn(table, column, ddl) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
    if (!columns.includes(column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
    }
  }

  prepareStatements() {
    return {
      insertEvent: this.db.prepare(`
        INSERT INTO events (
          id, ts, source, kind, ref_json, summary, project, confidence, origin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      recentEvents: this.db.prepare(`
        SELECT id, ts, source, kind, ref_json, summary, project, confidence, origin
        FROM events
        WHERE deleted_at IS NULL
        ORDER BY ts DESC
        LIMIT ?
      `),
      listEvents: this.db.prepare(`
        SELECT id, ts, source, kind, ref_json, summary, project, confidence, origin
        FROM events
        WHERE deleted_at IS NULL
          AND (? IS NULL OR source = ?)
        ORDER BY ts DESC
        LIMIT ?
      `),
      deleteBySource: this.db.prepare(`
        UPDATE events
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE deleted_at IS NULL AND source = ?
      `),
      upsertCommitment: this.db.prepare(`
        INSERT INTO commitments (
          id, source_event_id, direction, what, who, due, status, confidence, provenance_ref_json,
          extractor, match_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          direction = excluded.direction,
          what = excluded.what,
          who = excluded.who,
          due = excluded.due,
          extractor = excluded.extractor,
          match_reason = excluded.match_reason,
          -- Preserve a user decision: once a commitment is confirmed or dismissed,
          -- re-deriving the same source event must NOT reset it back to 'proposed'.
          status = CASE WHEN commitments.status IN ('confirmed', 'dismissed')
                        THEN commitments.status ELSE excluded.status END,
          confidence = excluded.confidence,
          provenance_ref_json = excluded.provenance_ref_json,
          updated_at = CURRENT_TIMESTAMP,
          -- Do not resurrect a dismissed commitment via re-derivation.
          deleted_at = CASE WHEN commitments.status = 'dismissed'
                            THEN commitments.deleted_at ELSE NULL END
      `),
      listCommitments: this.db.prepare(`
        SELECT id, source_event_id, direction, what, who, due, status, confidence, provenance_ref_json,
               extractor, match_reason
        FROM commitments
        WHERE deleted_at IS NULL
          AND (? IS NULL OR status = ?)
        ORDER BY
          CASE WHEN due IS NULL THEN 1 ELSE 0 END,
          due ASC,
          confidence DESC
        LIMIT ?
      `),
      upsertLesson: this.db.prepare(`
        INSERT INTO lessons (
          id, topic, insight, source_refs_json, source_event_ids_json, created_ts, last_surfaced_ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          topic = excluded.topic,
          insight = excluded.insight,
          source_refs_json = excluded.source_refs_json,
          source_event_ids_json = excluded.source_event_ids_json,
          last_surfaced_ts = excluded.last_surfaced_ts,
          deleted_at = NULL
      `),
      listLessons: this.db.prepare(`
        SELECT id, topic, insight, source_refs_json, source_event_ids_json, created_ts, last_surfaced_ts
        FROM lessons
        WHERE deleted_at IS NULL
          AND (? IS NULL OR lower(topic) LIKE lower(?))
        ORDER BY created_ts DESC
        LIMIT ?
      `),
      deleteCommitmentById: this.db.prepare(`
        UPDATE commitments
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE deleted_at IS NULL AND id = ?
      `),
      setCommitmentStatus: this.db.prepare(`
        UPDATE commitments
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `),
      deleteLessonById: this.db.prepare(`
        UPDATE lessons
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE deleted_at IS NULL AND id = ?
      `),
      deleteMemoryById: this.db.prepare(`
        UPDATE memory_records
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE deleted_at IS NULL AND id = ?
      `),
      eventIdsBySource: this.db.prepare(`
        SELECT id
        FROM events
        WHERE deleted_at IS NULL
          AND source = ?
      `),
      upsertMemory: this.db.prepare(`
        INSERT INTO memory_records (
          id, kind, topic, content, source_event_ids_json, source_refs_json, embedding_ref,
          persistence_policy, privacy_level, confidence, created_ts, updated_ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          topic = excluded.topic,
          content = excluded.content,
          source_event_ids_json = excluded.source_event_ids_json,
          source_refs_json = excluded.source_refs_json,
          embedding_ref = excluded.embedding_ref,
          persistence_policy = excluded.persistence_policy,
          privacy_level = excluded.privacy_level,
          confidence = excluded.confidence,
          updated_ts = excluded.updated_ts,
          deleted_at = NULL
      `),
      listMemory: this.db.prepare(`
        SELECT id, kind, topic, content, source_event_ids_json, source_refs_json, embedding_ref,
          persistence_policy, privacy_level, confidence, created_ts, updated_ts
        FROM memory_records
        WHERE deleted_at IS NULL
          AND (? IS NULL OR kind = ?)
        ORDER BY updated_ts DESC
        LIMIT ?
      `),
      activeFocusSession: this.db.prepare(`
        SELECT id, focus, duration_minutes, attention_mode, started_ts, ends_ts, completed_ts, status, summary_json
        FROM focus_sessions
        WHERE status = 'active'
        ORDER BY started_ts DESC
        LIMIT 1
      `),
      insertFocusSession: this.db.prepare(`
        INSERT INTO focus_sessions (
          id, focus, duration_minutes, attention_mode, started_ts, ends_ts, completed_ts, status, summary_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      updateFocusSessionStatus: this.db.prepare(`
        UPDATE focus_sessions
        SET status = ?, completed_ts = ?, summary_json = ?
        WHERE id = ?
      `),
      listFocusSessions: this.db.prepare(`
        SELECT id, focus, duration_minutes, attention_mode, started_ts, ends_ts, completed_ts, status, summary_json
        FROM focus_sessions
        ORDER BY started_ts DESC
        LIMIT ?
      `),
      audit: this.db.prepare(`
        INSERT INTO audit_log (action, details_json)
        VALUES (?, ?)
      `),
      listAudit: this.db.prepare(`
        SELECT id, ts, action, details_json
        FROM audit_log
        ORDER BY id DESC
        LIMIT ?
      `)
    };
  }

  listAudit({ limit = 50 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.statements.listAudit.all(boundedLimit).map((row) => ({
      id: row.id,
      ts: row.ts,
      action: row.action,
      details: JSON.parse(row.details_json)
    }));
  }

  appendEvent(event) {
    this.statements.insertEvent.run(
      event.id,
      event.ts,
      event.source,
      event.kind,
      this.enc(JSON.stringify(event.ref)),
      this.enc(event.summary),
      event.project,
      event.confidence,
      event.origin
    );
    this.audit("append_event", { eventId: event.id, source: event.source, kind: event.kind });
    return event;
  }

  upsertCommitment(commitment) {
    this.statements.upsertCommitment.run(
      commitment.id,
      commitment.source_event_id,
      commitment.direction,
      this.enc(commitment.what),
      this.enc(commitment.who),
      commitment.due ?? null,
      commitment.status,
      commitment.confidence,
      this.enc(JSON.stringify(commitment.provenance_ref)),
      commitment.extractor || "regex",
      commitment.match_reason ? this.enc(commitment.match_reason) : null
    );
    this.audit("upsert_commitment", { id: commitment.id, sourceEventId: commitment.source_event_id });
    return commitment;
  }

  listCommitments({ status = null, limit = 100 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.statements.listCommitments.all(status, status, boundedLimit).map((row) => ({
      id: row.id,
      source_event_id: row.source_event_id,
      direction: row.direction,
      what: this.dec(row.what),
      who: this.dec(row.who),
      due: row.due,
      status: row.status,
      confidence: row.confidence,
      provenance_ref: JSON.parse(this.dec(row.provenance_ref_json)),
      extractor: row.extractor || "regex",
      match_reason: row.match_reason ? this.dec(row.match_reason) : null
    }));
  }

  upsertLesson(lesson) {
    this.statements.upsertLesson.run(
      lesson.id,
      lesson.topic,
      this.enc(lesson.insight),
      this.enc(JSON.stringify(lesson.source_refs)),
      JSON.stringify(lesson.source_event_ids),
      lesson.created_ts,
      lesson.last_surfaced_ts ?? null
    );
    this.audit("upsert_lesson", { id: lesson.id, topic: lesson.topic });
    return lesson;
  }

  listLessons({ topic = null, limit = 100 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const pattern = topic ? `%${topic}%` : null;
    return this.statements.listLessons.all(topic, pattern, boundedLimit).map((row) => ({
      id: row.id,
      topic: row.topic,
      insight: this.dec(row.insight),
      source_refs: JSON.parse(this.dec(row.source_refs_json)),
      source_event_ids: JSON.parse(row.source_event_ids_json),
      created_ts: row.created_ts,
      last_surfaced_ts: row.last_surfaced_ts
    }));
  }

  deleteCommitmentById(id) {
    const result = this.statements.deleteCommitmentById.run(id);
    this.audit("delete_commitment", { id, deleted: result.changes });
    return result.changes;
  }

  // Records a user decision on a proposed commitment. 'dismissed' hides a false
  // positive; 'confirmed' locks it in. Both survive re-derivation (see upsert guard).
  setCommitmentStatus(id, status) {
    const result = this.statements.setCommitmentStatus.run(status, id);
    this.audit("set_commitment_status", { id, status, changed: result.changes });
    return result.changes;
  }

  deleteLessonById(id) {
    const result = this.statements.deleteLessonById.run(id);
    this.audit("delete_lesson", { id, deleted: result.changes });
    return result.changes;
  }

  deleteMemoryById(id) {
    const result = this.statements.deleteMemoryById.run(id);
    this.audit("delete_memory", { id, deleted: result.changes });
    return result.changes;
  }

  upsertMemory(record) {
    this.statements.upsertMemory.run(
      record.id,
      record.kind,
      record.topic,
      this.enc(record.content),
      JSON.stringify(record.source_event_ids),
      this.enc(JSON.stringify(record.source_refs)),
      record.embedding_ref ?? null,
      record.persistence_policy,
      record.privacy_level,
      record.confidence,
      record.created_ts,
      record.updated_ts
    );
    this.audit("upsert_memory", { id: record.id, topic: record.topic, kind: record.kind });
    return record;
  }

  listMemory({ kind = null, limit = 100 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.statements.listMemory.all(kind, kind, boundedLimit).map((row) => ({
      id: row.id,
      kind: row.kind,
      topic: row.topic,
      content: this.dec(row.content),
      source_event_ids: JSON.parse(row.source_event_ids_json),
      source_refs: JSON.parse(this.dec(row.source_refs_json)),
      embedding_ref: row.embedding_ref,
      persistence_policy: row.persistence_policy,
      privacy_level: row.privacy_level,
      confidence: row.confidence,
      created_ts: row.created_ts,
      updated_ts: row.updated_ts
    }));
  }

  activeFocusSession() {
    const row = this.statements.activeFocusSession.get();
    return row ? focusSessionFromRow(row) : null;
  }

  insertFocusSession(session) {
    this.statements.insertFocusSession.run(
      session.id,
      session.focus,
      session.duration_minutes,
      session.attention_mode,
      session.started_ts,
      session.ends_ts,
      session.completed_ts ?? null,
      session.status,
      JSON.stringify(session.summary)
    );
    this.audit("start_focus_session", { id: session.id, focus: session.focus });
    return session;
  }

  updateFocusSessionStatus(id, status, summary = {}) {
    const completedTs = new Date().toISOString();
    this.statements.updateFocusSessionStatus.run(status, completedTs, JSON.stringify(summary), id);
    this.audit("update_focus_session", { id, status });
    return this.listFocusSessions({ limit: 20 }).find((session) => session.id === id) ?? null;
  }

  listFocusSessions({ limit = 20 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.statements.listFocusSessions.all(boundedLimit).map(focusSessionFromRow);
  }

  decryptEventRow(row) {
    return { ...row, ref_json: this.dec(row.ref_json), summary: this.dec(row.summary) };
  }

  recentEvents(limit) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 500);
    return this.statements.recentEvents.all(boundedLimit).map((row) => eventFromRow(this.decryptEventRow(row)));
  }

  listEvents({ limit = 50, source = null } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.statements.listEvents.all(source, source, boundedLimit)
      .map((row) => eventFromRow(this.decryptEventRow(row)));
  }

  deleteEventsBySource(source) {
    const eventIds = this.statements.eventIdsBySource.all(source).map((row) => row.id);
    const result = this.statements.deleteBySource.run(source);
    const cascaded = this.deleteDerivedForEventIds(eventIds);
    this.audit("delete_events_by_source", { source, deleted: result.changes, cascaded });
    return result.changes;
  }

  deleteDerivedForEventIds(eventIds) {
    const ids = new Set(eventIds);
    let commitments = 0;
    let lessons = 0;
    let memory = 0;

    for (const commitment of this.listCommitments({ limit: 500 })) {
      if (ids.has(commitment.source_event_id)) {
        commitments += this.deleteCommitmentById(commitment.id);
      }
    }

    for (const lesson of this.listLessons({ limit: 500 })) {
      if ((lesson.source_event_ids || []).some((id) => ids.has(id))) {
        lessons += this.deleteLessonById(lesson.id);
      }
    }

    for (const record of this.listMemory({ limit: 500 })) {
      if ((record.source_event_ids || []).some((id) => ids.has(id))) {
        memory += this.deleteMemoryById(record.id);
      }
    }

    this.audit("cascade_delete", { eventIds: [...ids], commitments, lessons, memory });
    return { commitments, lessons, memory };
  }

  audit(action, details) {
    this.statements.audit.run(action, JSON.stringify(details));
  }

  close() {
    try {
      // Flush the WAL into the main DB file so a fresh start sees a clean checkpoint.
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // ignore checkpoint errors during shutdown
    }
    this.db.close();
  }
}

function focusSessionFromRow(row) {
  return {
    id: row.id,
    focus: row.focus,
    duration_minutes: row.duration_minutes,
    attention_mode: row.attention_mode,
    started_ts: row.started_ts,
    ends_ts: row.ends_ts,
    completed_ts: row.completed_ts,
    status: row.status,
    summary: JSON.parse(row.summary_json)
  };
}
