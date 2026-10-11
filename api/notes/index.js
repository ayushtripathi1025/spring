'use strict';
const { getDb } = require('../_lib/db');
const { send, methodNotAllowed, safeError, validateConceptKey, noteContentHash } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const includeContent = req.query && req.query.includeContent === '1';
    const defaultLimit = includeContent ? 10 : 1000;
    const rawLimit = (req.query && req.query.limit) || String(defaultLimit);
    const requestedLimit = /^\d+$/.test(String(rawLimit)) ? Number(rawLimit) : NaN;
    const maxLimit = includeContent ? 10 : 1500;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > maxLimit) {
      return send(res, 400, { error: 'invalid_limit', message: `limit must be between 1 and ${maxLimit}.` });
    }
    const cursor = req.query && (req.query.cursor || req.query.after);
    if (cursor && !validateConceptKey(Array.isArray(cursor) ? cursor[0] : cursor)) {
      return send(res, 400, { error: 'invalid_cursor', message: 'The pagination cursor is invalid.' });
    }
    const after = Array.isArray(cursor) ? cursor[0] : cursor;
    const query = { plainText: { $regex: '\\S' } };
    if (after) query._id = { $gt: after };
    // Read Delta server-side so legacy documents can be hashed even when contentHash is absent.
    // Metadata responses deliberately omit the large Delta from the wire payload.
    const projection = { _id: 1, topicId: 1, delta: 1, plainText: 1, revision: 1, updatedAt: 1, lastMutationId: 1, contentHash: 1 };
    const docs = await (await getDb()).collection('notes')
      .find(query, { projection })
      .sort({ _id: 1 })
      .limit(requestedLimit + 1)
      .toArray();
    const hasMore = docs.length > requestedLimit;
    const page = docs.slice(0, requestedLimit);
    const notes = page.map(n => {
      const item = {
        conceptKey: n._id,
        topicId: n.topicId || null,
        hasContent: true,
        contentHash: n.contentHash || (n.delta ? noteContentHash(n.delta) : null),
        revision: n.revision || 0,
        updatedAt: n.updatedAt || null,
        lastMutationId: n.lastMutationId || null,
      };
      if (includeContent) {
        item.delta = n.delta;
        item.plainText = n.plainText || '';
      }
      return item;
    });
    return send(res, 200, { notes, hasMore, nextCursor: hasMore && page.length ? page[page.length - 1]._id : null });
  } catch (error) { return safeError(res, error); }
};
