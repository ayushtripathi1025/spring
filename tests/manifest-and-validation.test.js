'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const syllabus = require('../java-spring-backend-syllabus.json');
const manifest = require('../api/_lib/syllabus-manifest.json');
const http = require('../api/_lib/http');

const root = path.resolve(__dirname, '..');

test('syllabus remains the source of truth and manifest covers every node/concept', () => {
  assert.equal(syllabus.index.node_count, 1001);
  assert.equal(syllabus.nodes.length, 1001);
  assert.equal(new Set(syllabus.nodes.map(n => n.concept_key)).size, 997);
  assert.deepEqual(manifest.nodeIds, syllabus.nodes.map(n => n.id));
  assert.deepEqual(new Set(manifest.conceptKeys), new Set(syllabus.nodes.map(n => n.concept_key)));
  for (const node of syllabus.nodes) {
    assert.equal(manifest.nodeConcepts[node.id], node.concept_key, `concept mapping for ${node.id}`);
  }
  assert.deepEqual(manifest.statusValues, syllabus.index.status_values);
});

test('concept keys and status values use only syllabus-defined IDs/enums', () => {
  const canonical = syllabus.nodes.find(n => n.canonical);
  assert.ok(canonical);
  assert.equal(http.validateConceptKey(canonical.concept_key), true);
  assert.equal(http.validateConceptKey('../progress'), false);
  for (const status of syllabus.index.status_values) assert.equal(http.validateStatus(status), true);
  assert.equal(http.validateStatus('done'), false);
});

test('topic IDs must actually map to the supplied canonical concept key', () => {
  const node = syllabus.nodes.find(n => n.canonical);
  assert.equal(http.validateNodeTopic(node.id, node.concept_key), node.id);
  assert.equal(http.validateNodeTopic(null, node.concept_key), null);
  const other = syllabus.nodes.find(n => n.concept_key !== node.concept_key);
  assert.throws(() => http.validateNodeTopic(node.id, other.concept_key), /invalid_topic_id/);
  assert.throws(() => http.validateNodeTopic('not-a-real-topic', node.concept_key), /invalid_topic_id/);
});

test('rich-text validation keeps expected formatting and accepts only safe link schemes', () => {
  const delta = http.sanitizeDelta({ ops: [
    { insert: 'Heading\n', attributes: { header: 2, color: '#abc' } },
    { insert: 'Example\n', attributes: { 'code-block': true } },
    { insert: 'docs', attributes: { link: 'https://example.com/docs', underline: true } },
    { insert: '\n', attributes: { callout: 'tip' } },
  ] });
  assert.equal(delta.ops.length, 4);
  assert.equal(http.plainTextFromDelta(delta), 'Heading\nExample\ndocs\n');
  assert.equal(http.safeLink('https://example.com'), 'https://example.com');
  assert.equal(http.safeLink('mailto:learner@example.com'), 'mailto:learner@example.com');
  assert.equal(http.safeLink('javascript:alert(1)'), null);
  assert.throws(() => http.sanitizeDelta({ ops: [{ insert: 'x', attributes: { link: 'javascript:alert(1)' } }] }), /invalid_delta_link/);
  assert.throws(() => http.sanitizeDelta({ ops: [{ insert: 'x', attributes: { onload: 'alert(1)' } }] }), /invalid_delta_attributes/);
  assert.throws(() => http.sanitizeDelta({ ops: [{ insert: { malicious: true } }] }), /invalid_delta_operation/);
});

test('large or malformed note content is rejected', () => {
  assert.throws(() => http.sanitizeDelta({ ops: Array.from({ length: 10_001 }, () => ({ insert: 'x' })) }), /invalid_delta/);
  assert.throws(() => http.sanitizeDelta({ ops: [{ insert: 'x'.repeat(100_001) }] }), /note_too_large/);
});

test('HTTP helpers use safe structured responses without exposing errors', () => {
  const response = {
    headers: {}, statusCode: 0, payload: '',
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.payload = value; },
  };
  http.safeError(response, Object.assign(new Error('mongodb://user:password@secret-host'), { stack: 'private stack' }));
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.doesNotMatch(response.payload, /password|secret-host|private stack/);
  const denied = { ...response, headers: {}, statusCode: 0, payload: '', setHeader: response.setHeader, end: response.end };
  http.methodNotAllowed(denied, ['GET', 'PUT']);
  assert.equal(denied.statusCode, 405);
  assert.equal(denied.headers.Allow, 'GET, PUT');
});

test('front-end and deployment guardrails are present', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.match(html, /quill@2\.0\.3/);
  assert.match(html, /exportPdfBtn/);
  assert.match(app, /spring-atlas:v1/);
  assert.match(app, /spring-atlas:notes:v1/);
  assert.match(app, /revision_conflict|conflict/);
  assert.deepEqual(vercel, { functions: { 'api/**/*.js': { maxDuration: 10 } } });
});


test('local dev command cannot recursively invoke Vercel CLI', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const devServer = fs.readFileSync(path.join(root, 'scripts', 'dev-server.js'), 'utf8');
  assert.equal(packageJson.scripts.dev, 'node scripts/dev-server.js');
  assert.doesNotMatch(packageJson.scripts.dev, /vercel\s+dev/);
  assert.match(devServer, /const HOST = '127\.0\.0\.1'/);
  assert.match(devServer, /const publicFiles = new Map/);
  const publicFileMap = devServer.slice(devServer.indexOf('const publicFiles'), devServer.indexOf('const mimeTypes'));
  assert.doesNotMatch(publicFileMap, /\.env|api\//);
});
