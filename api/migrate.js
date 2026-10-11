'use strict';
const { getDb, getClient } = require('./_lib/db');
const { send, methodNotAllowed, safeError, isObject, validateConceptKey, validateStatus, validateMutationId, validateNodeTopic, sanitizeDelta, plainTextFromDelta, noteContentHash } = require('./_lib/http');

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const body = req.body;
  if (!isObject(body) || body.schemaVersion !== 1 || !validateMutationId(body.migrationId) || !['merge', 'replace'].includes(body.mode) || !Array.isArray(body.progress) || !Array.isArray(body.notes)) {
    return send(res, 400, { error: 'invalid_migration_payload', message: 'The migration payload is invalid or uses an unsupported backup version.' });
  }
  if (body.mode === 'replace' && body.confirmReplace !== true) {
    return send(res, 400, { error: 'replace_confirmation_required', message: 'Explicit confirmation is required before replacing cloud data.' });
  }
  if (body.progress.length > 1_500 || body.notes.length > 1_500 || Buffer.byteLength(JSON.stringify(body), 'utf8') > 3_700_000) {
    return send(res, 413, { error: 'migration_too_large', message: 'This backup is too large for one migration request. Export it and reduce the number or size of notes before retrying.' });
  }

  const progressKeys = new Set();
  const noteKeys = new Set();
  const progress = [];
  const notes = [];
  try {
    for (const item of body.progress) {
      if (!isObject(item) || !validateConceptKey(item.conceptKey) || !validateStatus(item.status) || item.status === 'not_started' || progressKeys.has(item.conceptKey)) throw new Error('invalid_migration_progress');
      progressKeys.add(item.conceptKey);
      progress.push({ _id: item.conceptKey, status: item.status, revision: 1, updatedAt: new Date(), lastMutationId: `migration:${body.migrationId}` });
    }
    for (const item of body.notes) {
      if (!isObject(item) || !validateConceptKey(item.conceptKey) || noteKeys.has(item.conceptKey) || !item.delta) throw new Error('invalid_migration_note');
      noteKeys.add(item.conceptKey);
      const delta = sanitizeDelta(item.delta);
      const plainText = plainTextFromDelta(delta);
      if (!plainText.trim()) continue;
      const topicId = validateNodeTopic(item.topicId, item.conceptKey);
      notes.push({ _id: item.conceptKey, topicId: topicId || null, delta, plainText, contentHash: noteContentHash(delta), revision: 1, updatedAt: new Date(), lastMutationId: `migration:${body.migrationId}` });
    }
  } catch (_) {
    return send(res, 400, { error: 'invalid_migration_content', message: 'The backup contains an unknown concept, duplicate key, unsupported status, or invalid note format.' });
  }

  let session;
  try {
    const [db, client] = await Promise.all([getDb(), getClient()]);
    const metadata = db.collection('syncMetadata');
    const progressCollection = db.collection('progress');
    const notesCollection = db.collection('notes');
    const markerId = `migration:${body.migrationId}`;
    const alreadyDone = await metadata.findOne({ _id: markerId });
    if (alreadyDone && alreadyDone.result) return send(res, 200, { ...alreadyDone.result, alreadyApplied: true });

    session = client.startSession();
    let result;
    await session.withTransaction(async () => {
      const marker = await metadata.findOne({ _id: markerId }, { session });
      if (marker && marker.result) { result = { ...marker.result, alreadyApplied: true }; return; }

      const counts = {
        mode: body.mode,
        progressAdded: 0, progressSkipped: 0, progressConflicts: 0,
        notesAdded: 0, notesSkipped: 0, notesConflicts: 0,
      };

      if (body.mode === 'replace') {
        await progressCollection.deleteMany({}, { session });
        await notesCollection.deleteMany({}, { session });
        if (progress.length) await progressCollection.insertMany(progress, { ordered: true, session });
        if (notes.length) await notesCollection.insertMany(notes, { ordered: true, session });
        counts.progressAdded = progress.length;
        counts.notesAdded = notes.length;
      } else {
        const [existingProgress, existingNotes] = await Promise.all([
          progress.length ? progressCollection.find({ _id: { $in: progress.map(p => p._id) } }, { session }).toArray() : [],
          notes.length ? notesCollection.find({ _id: { $in: notes.map(n => n._id) } }, { session }).toArray() : [],
        ]);
        const progressByKey = new Map(existingProgress.map(p => [p._id, p]));
        const notesByKey = new Map(existingNotes.map(n => [n._id, n]));
        const progressToAdd = [];
        const notesToAdd = [];
        for (const incoming of progress) {
          const existing = progressByKey.get(incoming._id);
          if (!existing) progressToAdd.push(incoming);
          else if (existing.status === incoming.status) counts.progressSkipped++;
          else { counts.progressSkipped++; counts.progressConflicts++; }
        }
        for (const incoming of notes) {
          const existing = notesByKey.get(incoming._id);
          if (!existing) notesToAdd.push(incoming);
          else if (JSON.stringify(existing.delta) === JSON.stringify(incoming.delta)) counts.notesSkipped++;
          else { counts.notesSkipped++; counts.notesConflicts++; }
        }
        if (progressToAdd.length) await progressCollection.insertMany(progressToAdd, { ordered: true, session });
        if (notesToAdd.length) await notesCollection.insertMany(notesToAdd, { ordered: true, session });
        counts.progressAdded = progressToAdd.length;
        counts.notesAdded = notesToAdd.length;
      }

      const now = new Date();
      await metadata.updateOne({ _id: 'state' }, { $set: { schemaVersion: 1, syllabusSchemaVersion: '1.0.0', updatedAt: now } }, { upsert: true, session });
      result = { ok: true, migrationId: body.migrationId, ...counts, completedAt: now.toISOString() };
      await metadata.insertOne({ _id: markerId, result, createdAt: now }, { session });
    });
    return send(res, 200, result || { ok: true, migrationId: body.migrationId });
  } catch (error) {
    return safeError(res, error);
  } finally {
    if (session) await session.endSession().catch(() => {});
  }
};

module.exports = handler;
module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } } };
