'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {runSummary} = require('../src/run-summary.cjs');

test('the Actions summary requires a real read and encrypted readback and shows only aggregate results', () => {
  const verified = {status: 'verified', actual_read: true, encrypted_readback_verified: true,
    courses: 2, added_count: 1, sequence: 2, last_success_at: '2030-10-01T12:00:00Z', title: 'private text'};
  const summary = runSummary(verified);
  assert.match(summary, /Snapshot verified/);
  assert.match(summary, /\| Courses \| 2 \|/);
  assert.doesNotMatch(summary, /private text/);
  for (const field of ['actual_read', 'encrypted_readback_verified']) {
    assert.match(runSummary({...verified, [field]: false}), /Read stopped/);
  }
  assert.equal(runSummary({status: 'ready'}), '');
  assert.match(runSummary({status: 'skipped', reason: 'window_already_covered'}), /Read skipped.*already has a snapshot/s);
  assert.doesNotMatch(runSummary({status: 'skipped', reason: 'private text'}), /private text/);
});
