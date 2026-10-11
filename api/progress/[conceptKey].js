'use strict';
const { getDb } = require('../_lib/db');
const { send, methodNotAllowed, safeError, getConceptKey, validateStatus, validateMutationId, isObject } = require('../_lib/http');

module.exports = async function handler(req, res) {
  const conceptKey = getConceptKey(req);
  if (!conceptKey) return send(res, 400, { error: 'invalid_concept_key', message: 'Unknown concept key.' });
  if (req.method !== 'PUT' && req.method !== 'GET') return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    const db = await getDb();
    const collection = db.collection('progress');
    if (req.method === 'GET') {
      const current = await collection.findOne({ _id: conceptKey });
      return send(res, 200, { progress: current ? { conceptKey, status: current.status, revision: current.revision || 0, updatedAt: current.updatedAt || null, lastMutationId: current.lastMutationId || null } : { conceptKey, status: 'not_started', revision: 0, updatedAt: null, lastMutationId: null } });
    }
    const body = req.body;
    if (!isObject(body) || !validateStatus(body.status) || !Number.isInteger(body.revision) || body.revision < 0 || !validateMutationId(body.mutationId)) {
      return send(res, 400, { error: 'invalid_progress_payload', message: 'Provide a supported status, non-negative revision, and mutationId.' });
    }
    const current = await collection.findOne({ _id: conceptKey });
    if (current && current.lastMutationId === body.mutationId) {
      return send(res, 200, { progress: { conceptKey, status: current.status, revision: current.revision, updatedAt: current.updatedAt, lastMutationId: current.lastMutationId }, idempotent: true });
    }
    const currentRevision = current ? (current.revision || 0) : 0;
    if (currentRevision !== body.revision) {
      return send(res, 409, { error: 'revision_conflict', message: 'This concept changed on another device.', current: current ? { conceptKey, status: current.status, revision: currentRevision, updatedAt: current.updatedAt || null, lastMutationId: current.lastMutationId || null } : { conceptKey, status: 'not_started', revision: 0, updatedAt: null, lastMutationId: null } });
    }
    const next = { _id: conceptKey, status: body.status, revision: currentRevision + 1, updatedAt: new Date(), lastMutationId: body.mutationId };
    try {
      if (!current) await collection.insertOne(next);
      else {
        const result = await collection.updateOne({ _id: conceptKey, revision: currentRevision }, { $set: { status: next.status, revision: next.revision, updatedAt: next.updatedAt, lastMutationId: next.lastMutationId } });
        if (result.matchedCount !== 1) {
          const latest = await collection.findOne({ _id: conceptKey });
          return send(res, 409, { error: 'revision_conflict', message: 'This concept changed on another device.', current: latest ? { conceptKey, status: latest.status, revision: latest.revision, updatedAt: latest.updatedAt || null, lastMutationId: latest.lastMutationId || null } : { conceptKey, status: 'not_started', revision: 0, updatedAt: null, lastMutationId: null } });
        }
      }
    } catch (error) {
      if (error && error.code === 11000) {
        const latest = await collection.findOne({ _id: conceptKey });
        return send(res, 409, { error: 'revision_conflict', message: 'This concept changed on another device.', current: latest ? { conceptKey, status: latest.status, revision: latest.revision, updatedAt: latest.updatedAt || null, lastMutationId: latest.lastMutationId || null } : { conceptKey, status: 'not_started', revision: 0, updatedAt: null, lastMutationId: null } });
      }
      throw error;
    }
    return send(res, 200, { progress: { conceptKey, status: next.status, revision: next.revision, updatedAt: next.updatedAt, lastMutationId: next.lastMutationId } });
  } catch (error) { return safeError(res, error); }
};
