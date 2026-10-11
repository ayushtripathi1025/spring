'use strict';

const { createHash } = require('node:crypto');
const manifest = require('./syllabus-manifest.json');
const validConcepts = new Set(manifest.conceptKeys);
const validStatuses = new Set(manifest.statusValues);
const validNodeIds = new Set(manifest.nodeIds);
const nodeConcepts = manifest.nodeConcepts;
const MAX_NOTE_BYTES = 256 * 1024;
const MAX_NOTE_OPS = 10_000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  return send(res, 405, { error: 'method_not_allowed', message: `Use ${methods.join(' or ')}.` });
}

function safeError(res, error) {
  if (error && error.code === 'DATABASE_NOT_CONFIGURED') {
    return send(res, 503, { error: 'database_not_configured', message: 'Cloud storage is not configured. Add the required server environment variables.' });
  }
  // Do not leak stack traces, hostnames, connection strings, or query details.
  return send(res, 500, { error: 'server_error', message: 'The request could not be completed. Check server configuration and try again.' });
}

function getSingleParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function getConceptKey(req) {
  const key = getSingleParam(req.query && req.query.conceptKey);
  if (typeof key !== 'string' || key.length > 180 || !validConcepts.has(key)) return null;
  return key;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateMutationId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{8,120}$/.test(value);
}

function safeLink(value) {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const u = new URL(value);
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return null;
    if (u.protocol !== 'mailto:' && !u.hostname) return null;
    return value;
  } catch (_) {
    return null;
  }
}

function sanitizeAttributes(attributes) {
  if (!attributes) return {};
  if (!isObject(attributes)) throw new Error('invalid_delta_attributes');
  const clean = {};
  for (const [key, value] of Object.entries(attributes)) {
    switch (key) {
      case 'bold': case 'italic': case 'underline': case 'strike': case 'blockquote': case 'code-block':
        if (value === true) clean[key] = true;
        else if (value !== false && value != null) throw new Error('invalid_delta_attributes');
        break;
      case 'header':
        if ([1, 2, 3].includes(value)) clean.header = value;
        else throw new Error('invalid_delta_attributes');
        break;
      case 'list':
        if (['ordered', 'bullet'].includes(value)) clean.list = value;
        else throw new Error('invalid_delta_attributes');
        break;
      case 'indent':
        if (Number.isInteger(value) && value >= 1 && value <= 8) clean.indent = value;
        else throw new Error('invalid_delta_attributes');
        break;
      case 'color': case 'background':
        if (typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) clean[key] = value;
        else throw new Error('invalid_delta_attributes');
        break;
      case 'link': {
        const link = safeLink(value);
        if (!link) throw new Error('invalid_delta_link');
        clean.link = link;
        break;
      }
      case 'callout':
        if (['info', 'tip', 'warning'].includes(value)) clean.callout = value;
        else throw new Error('invalid_delta_attributes');
        break;
      default:
        // Unknown formats are deliberately rejected so stored content stays constrained.
        throw new Error('invalid_delta_attributes');
    }
  }
  return clean;
}

function sanitizeDelta(input) {
  if (!isObject(input) || !Array.isArray(input.ops) || input.ops.length > MAX_NOTE_OPS) throw new Error('invalid_delta');
  const clean = [];
  let totalChars = 0;
  for (const op of input.ops) {
    if (!isObject(op) || typeof op.insert !== 'string') throw new Error('invalid_delta_operation');
    totalChars += op.insert.length;
    if (totalChars > 100_000) throw new Error('note_too_large');
    const attributes = sanitizeAttributes(op.attributes);
    const next = { insert: op.insert };
    if (Object.keys(attributes).length) next.attributes = attributes;
    clean.push(next);
  }
  const json = JSON.stringify({ ops: clean });
  if (Buffer.byteLength(json, 'utf8') > MAX_NOTE_BYTES) throw new Error('note_too_large');
  return { ops: clean };
}

function plainTextFromDelta(delta) {
  return delta.ops.map(op => op.insert).join('').replace(/\u0000/g, '').slice(0, 100_000);
}

function noteHasContent(note) {
  return !!(note && typeof note.plainText === 'string' && note.plainText.trim());
}

function canonicalDeltaJson(delta) {
  const clean = sanitizeDelta(delta);
  return JSON.stringify({ ops: clean.ops.map(op => {
    const result = { insert: op.insert };
    if (op.attributes && Object.keys(op.attributes).length) {
      result.attributes = Object.fromEntries(Object.keys(op.attributes).sort().map(key => [key, op.attributes[key]]));
    }
    return result;
  }) });
}

function noteContentHash(delta) {
  return createHash('sha256').update(canonicalDeltaJson(delta), 'utf8').digest('hex');
}

function validateConceptKey(key) { return typeof key === 'string' && validConcepts.has(key); }
function validateStatus(status) { return validStatuses.has(status); }
function validateNodeTopic(topicId, conceptKey) {
  if (topicId == null) return null;
  if (typeof topicId !== 'string' || !validNodeIds.has(topicId) || nodeConcepts[topicId] !== conceptKey) throw new Error('invalid_topic_id');
  return topicId;
}

module.exports = {
  send, methodNotAllowed, safeError, getConceptKey, getSingleParam, isObject,
  validateMutationId, validateConceptKey, validateStatus, validateNodeTopic,
  sanitizeDelta, plainTextFromDelta, noteHasContent, noteContentHash, safeLink, MAX_NOTE_BYTES,
};
