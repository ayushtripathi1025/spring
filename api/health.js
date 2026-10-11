'use strict';
const { pingDatabase } = require('./_lib/db');
const { send, methodNotAllowed, safeError } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await pingDatabase();
    return send(res, 200, { ok: true, database: 'ready' });
  } catch (error) {
    if (error && error.code === 'DATABASE_NOT_CONFIGURED') return send(res, 503, { ok: false, database: 'not_configured' });
    return safeError(res, error);
  }
};
