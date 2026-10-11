'use strict';
const { getDb } = require('../_lib/db');
const { send, methodNotAllowed, safeError, validateConceptKey } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const db = await getDb();
    const docs = await db.collection('progress').find({}, { projection: { _id: 1, status: 1, revision: 1, updatedAt: 1, lastMutationId: 1 } }).toArray();
    return send(res, 200, { progress: docs.map(p => ({ conceptKey: p._id, status: p.status, revision: p.revision || 0, updatedAt: p.updatedAt || null, lastMutationId: p.lastMutationId || null })) });
  } catch (error) { return safeError(res, error); }
};
