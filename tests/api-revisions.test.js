'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const syllabus = require('../java-spring-backend-syllabus.json');

function makeResponse() {
  return {
    statusCode: 200, headers: {}, payload: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.payload = body; },
    json() { return JSON.parse(this.payload || '{}'); },
  };
}

function fakeCollection() {
  const records = new Map();
  return {
    records,
    async findOne(query) { return records.get(query._id) || null; },
    find(query = {}, options = {}) {
      let rows = Array.from(records.values()).filter(row => {
        if (query._id && query._id.$gt && !(row._id > query._id.$gt)) return false;
        if (query.plainText && query.plainText.$regex && !(new RegExp(query.plainText.$regex)).test(row.plainText || '')) return false;
        return true;
      });
      let max = Infinity;
      return {
        sort(spec) { const key = Object.keys(spec)[0]; const dir = spec[key]; rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * dir); return this; },
        limit(n) { max = n; return this; },
        async toArray() {
          const projection = options.projection || {};
          return rows.slice(0, max).map(row => {
            const clone = structuredClone(row);
            for (const key of Object.keys(clone)) if (projection[key] !== 1) delete clone[key];
            return clone;
          });
        },
      };
    },
    async insertOne(doc) {
      if (records.has(doc._id)) { const error = new Error('duplicate'); error.code = 11000; throw error; }
      records.set(doc._id, structuredClone(doc));
      return { acknowledged: true, insertedId: doc._id };
    },
    async updateOne(filter, update) {
      const row = records.get(filter._id);
      if (!row || row.revision !== filter.revision) return { matchedCount: 0 };
      records.set(filter._id, { ...row, ...structuredClone(update.$set) });
      return { matchedCount: 1 };
    },
  };
}

function installDbMock() {
  const collections = new Map();
  const fakeDb = {
    collection(name) {
      if (!collections.has(name)) collections.set(name, fakeCollection());
      return collections.get(name);
    },
  };
  const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: { getDb: async () => fakeDb, getClient: async () => ({ startSession() { throw new Error('not used in this test'); } }) },
  };
  return { fakeDb, collections };
}

const sampleNode = syllabus.nodes.find(n => n.canonical);
const sampleKey = sampleNode.concept_key;

test('progress route uses revisions, reports conflicts, and makes retries idempotent', async () => {
  installDbMock();
  const routePath = path.resolve(__dirname, '../api/progress/[conceptKey].js');
  delete require.cache[routePath];
  const handler = require(routePath);

  const first = makeResponse();
  await handler({ method: 'PUT', query: { conceptKey: sampleKey }, body: { status: 'learned', revision: 0, mutationId: 'progress-mutation-0001' } }, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().progress.status, 'learned');
  assert.equal(first.json().progress.revision, 1);

  const stale = makeResponse();
  await handler({ method: 'PUT', query: { conceptKey: sampleKey }, body: { status: 'needs_review', revision: 0, mutationId: 'progress-mutation-0002' } }, stale);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().current.revision, 1);
  assert.equal(stale.json().current.status, 'learned');

  const retry = makeResponse();
  await handler({ method: 'PUT', query: { conceptKey: sampleKey }, body: { status: 'learned', revision: 0, mutationId: 'progress-mutation-0001' } }, retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().idempotent, true);
  assert.equal(retry.json().progress.revision, 1);
});

test('notes route validates canonical identity and preserves cloud revision on conflict', async () => {
  installDbMock();
  const routePath = path.resolve(__dirname, '../api/notes/[conceptKey].js');
  delete require.cache[routePath];
  const handler = require(routePath);

  const delta = { ops: [{ insert: 'Notes heading\n', attributes: { header: 2 } }, { insert: 'safe docs', attributes: { link: 'https://example.com/docs' } }, { insert: '\n', attributes: { callout: 'info' } }] };
  const first = makeResponse();
  await handler({ method: 'PUT', query: { conceptKey: sampleKey }, body: { topicId: sampleNode.id, delta, revision: 0, mutationId: 'note-mutation-000001' } }, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().note.revision, 1);
  assert.match(first.json().note.plainText, /Notes heading/);

  const mismatch = makeResponse();
  const otherNode = syllabus.nodes.find(n => n.concept_key !== sampleKey);
  await handler({ method: 'PUT', query: { conceptKey: sampleKey }, body: { topicId: otherNode.id, delta, revision: 1, mutationId: 'note-mutation-000002' } }, mismatch);
  assert.equal(mismatch.statusCode, 400);

  const stale = makeResponse();
  await handler({ method: 'PUT', query: { conceptKey: sampleKey }, body: { topicId: sampleNode.id, delta, revision: 0, mutationId: 'note-mutation-000003' } }, stale);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().current.revision, 1);
  assert.match(stale.json().message, /draft has been preserved/i);
});

test('API rejects unknown keys and disallowed methods before touching the database', async () => {
  installDbMock();
  const routePath = path.resolve(__dirname, '../api/progress/[conceptKey].js');
  delete require.cache[routePath];
  const handler = require(routePath);
  const unknown = makeResponse();
  await handler({ method: 'GET', query: { conceptKey: 'unknown-key' } }, unknown);
  assert.equal(unknown.statusCode, 400);
  const method = makeResponse();
  await handler({ method: 'DELETE', query: { conceptKey: sampleKey } }, method);
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.Allow, 'GET, PUT');
});


test('notes index defaults to metadata and paginates full note content on request', async () => {
  const { fakeDb } = installDbMock();
  const collection = fakeDb.collection('notes');
  const keyA = sampleKey;
  const keyB = syllabus.nodes.find(n => n.canonical && n.concept_key !== keyA).concept_key;
  for (const [key, content] of [[keyA, 'First note\n'], [keyB, 'Second note\n']]) {
    const routePath = path.resolve(__dirname, '../api/notes/[conceptKey].js');
    delete require.cache[routePath];
    const handler = require(routePath);
    const node = syllabus.nodes.find(n => n.concept_key === key);
    const response = makeResponse();
    await handler({ method: 'PUT', query: { conceptKey: key }, body: { topicId: node.id, delta: { ops: [{ insert: content }] }, revision: 0, mutationId: `seed-note-${key.slice(0, 16)}` } }, response);
    assert.equal(response.statusCode, 200);
  }
  const routePath = path.resolve(__dirname, '../api/notes/index.js');
  delete require.cache[routePath];
  const handler = require(routePath);
  const metadata = makeResponse();
  await handler({ method: 'GET', query: { limit: '10' } }, metadata);
  assert.equal(metadata.statusCode, 200);
  assert.equal(metadata.json().notes.length, 2);
  assert.equal(Object.hasOwn(metadata.json().notes[0], 'delta'), false);
  assert.match(metadata.json().notes[0].contentHash, /^[a-f0-9]{64}$/);

  const page1 = makeResponse();
  await handler({ method: 'GET', query: { includeContent: '1', limit: '1' } }, page1);
  assert.equal(page1.statusCode, 200);
  assert.equal(page1.json().notes.length, 1);
  assert.equal(page1.json().hasMore, true);
  assert.ok(page1.json().notes[0].delta);

  const page2 = makeResponse();
  await handler({ method: 'GET', query: { includeContent: '1', limit: '1', cursor: page1.json().nextCursor } }, page2);
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().notes.length, 1);
  assert.equal(page2.json().hasMore, false);
  assert.notEqual(page1.json().notes[0].conceptKey, page2.json().notes[0].conceptKey);
});
