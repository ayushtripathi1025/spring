'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const syllabusPath = path.join(root, 'java-spring-backend-syllabus.json');
const manifestPath = path.join(root, 'api', '_lib', 'syllabus-manifest.json');
const syllabus = JSON.parse(fs.readFileSync(syllabusPath, 'utf8'));

if (!syllabus.index || !Array.isArray(syllabus.nodes) || !Array.isArray(syllabus.index.status_values)) {
  throw new Error('The syllabus JSON is missing its expected index/nodes/status_values fields.');
}

const nodeIds = syllabus.nodes.map(node => node.id);
const conceptKeys = [...new Set(syllabus.nodes.map(node => node.concept_key))];
const nodeConcepts = Object.fromEntries(syllabus.nodes.map(node => [node.id, node.concept_key]));
if (nodeIds.some(id => typeof id !== 'string' || !id) || conceptKeys.some(key => typeof key !== 'string' || !key)) {
  throw new Error('The syllabus contains a missing topic ID or canonical concept key.');
}
if (new Set(nodeIds).size !== nodeIds.length) throw new Error('The syllabus contains duplicate topic IDs.');

const manifest = {
  schemaVersion: syllabus.index.schema_version || '1.0.0',
  nodeIds,
  conceptKeys,
  nodeConcepts,
  statusValues: syllabus.index.status_values,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
process.stdout.write(`Wrote ${path.relative(root, manifestPath)} (${nodeIds.length} topics, ${conceptKeys.length} concepts).\n`);
