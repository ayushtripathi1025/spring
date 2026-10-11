'use strict';
const { getDb } = require('../_lib/db');
const { send, methodNotAllowed, safeError, getConceptKey, validateMutationId, validateNodeTopic, isObject, sanitizeDelta, plainTextFromDelta, noteContentHash, MAX_NOTE_BYTES } = require('../_lib/http');

module.exports = async function handler(req, res) {
  const conceptKey = getConceptKey(req);
  if (!conceptKey) return send(res, 400, { error: 'invalid_concept_key', message: 'Unknown concept key.' });
  if (req.method !== 'GET' && req.method !== 'PUT') return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    const collection = (await getDb()).collection('notes');
    if (req.method === 'GET') {
      const current = await collection.findOne({ _id: conceptKey });
      return send(res, 200, { note: current ? { conceptKey, topicId: current.topicId || null, delta: current.delta, plainText: current.plainText || '', contentHash: current.contentHash || noteContentHash(current.delta), revision: current.revision || 0, updatedAt: current.updatedAt || null, lastMutationId: current.lastMutationId || null } : null });
    }
    const body = req.body;
    if (!isObject(body) || !Number.isInteger(body.revision) || body.revision < 0 || !validateMutationId(body.mutationId) || !body.delta) {
      return send(res, 400, { error: 'invalid_note_payload', message: 'Provide a note Delta, non-negative revision, and mutationId.' });
    }
    let delta, topicId;
    try {
      delta = sanitizeDelta(body.delta);
      topicId = validateNodeTopic(body.topicId, conceptKey);
    } catch (error) {
      if (error.message === 'note_too_large') return send(res, 413, { error: 'note_too_large', message: `Notes must be smaller than ${Math.round(MAX_NOTE_BYTES / 1024)} KB.` });
      return send(res, 400, { error: 'invalid_note_content', message: 'The note format or link is invalid.' });
    }
    const plainText = plainTextFromDelta(delta);
    const contentHash = noteContentHash(delta);
    const current = await collection.findOne({ _id: conceptKey });
    if (current && current.lastMutationId === body.mutationId) {
      return send(res, 200, { note: { conceptKey, topicId: current.topicId || null, delta: current.delta, plainText: current.plainText || '', contentHash: current.contentHash || noteContentHash(current.delta), revision: current.revision, updatedAt: current.updatedAt, lastMutationId: current.lastMutationId }, idempotent: true });
    }
    const currentRevision = current ? (current.revision || 0) : 0;
    if (currentRevision !== body.revision) {
      return send(res, 409, { error: 'revision_conflict', message: 'This note was changed on another device. Your local draft has been preserved.', current: current ? { conceptKey, topicId: current.topicId || null, delta: current.delta, plainText: current.plainText || '', contentHash: current.contentHash || noteContentHash(current.delta), revision: currentRevision, updatedAt: current.updatedAt || null, lastMutationId: current.lastMutationId || null } : null });
    }
    const next = { _id: conceptKey, topicId: topicId || (current && current.topicId) || null, delta, plainText, contentHash, revision: currentRevision + 1, updatedAt: new Date(), lastMutationId: body.mutationId };
    try {
      if (!current) await collection.insertOne(next);
      else {
        const result = await collection.updateOne({ _id: conceptKey, revision: currentRevision }, { $set: { topicId: next.topicId, delta: next.delta, plainText: next.plainText, contentHash: next.contentHash, revision: next.revision, updatedAt: next.updatedAt, lastMutationId: next.lastMutationId } });
        if (result.matchedCount !== 1) {
          const latest = await collection.findOne({ _id: conceptKey });
          return send(res, 409, { error: 'revision_conflict', message: 'This note was changed on another device. Your local draft has been preserved.', current: latest ? { conceptKey, topicId: latest.topicId || null, delta: latest.delta, plainText: latest.plainText || '', contentHash: latest.contentHash || noteContentHash(latest.delta), revision: latest.revision || 0, updatedAt: latest.updatedAt || null, lastMutationId: latest.lastMutationId || null } : null });
        }
      }
    } catch (error) {
      if (error && error.code === 11000) {
        const latest = await collection.findOne({ _id: conceptKey });
        return send(res, 409, { error: 'revision_conflict', message: 'This note was changed on another device. Your local draft has been preserved.', current: latest ? { conceptKey, topicId: latest.topicId || null, delta: latest.delta, plainText: latest.plainText || '', contentHash: latest.contentHash || noteContentHash(latest.delta), revision: latest.revision || 0, updatedAt: latest.updatedAt || null, lastMutationId: latest.lastMutationId || null } : null });
      }
      throw error;
    }
    return send(res, 200, { note: { conceptKey, topicId: next.topicId, delta: next.delta, plainText: next.plainText, contentHash: next.contentHash, revision: next.revision, updatedAt: next.updatedAt, lastMutationId: next.lastMutationId } });
  } catch (error) { return safeError(res, error); }
};
