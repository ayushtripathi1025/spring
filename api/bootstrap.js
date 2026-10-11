'use strict';
const { getDb } = require('./_lib/db');
const { send, methodNotAllowed, safeError } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const db = await getDb();
    const [progress, progressCount, notesCount, schema] = await Promise.all([
      db.collection('progress').find({}, { projection: { _id: 1, status: 1, revision: 1, updatedAt: 1, lastMutationId: 1 } }).toArray(),
      db.collection('progress').countDocuments(),
      db.collection('notes').countDocuments({ plainText: { $regex: '\\S' } }),
      db.collection('syncMetadata').findOne({ _id: 'state' }),
    ]);
    return send(res, 200, {
      progress: progress.map(p => ({ conceptKey: p._id, status: p.status, revision: p.revision || 0, updatedAt: p.updatedAt || null, lastMutationId: p.lastMutationId || null })),
      syncMetadata: {
        schemaVersion: schema && schema.schemaVersion || 1,
        syllabusSchemaVersion: '1.0.0',
        progressCount,
        notesCount,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (error) { return safeError(res, error); }
};
