import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../../lib/shared/src/writing-core.ts';
import corpus from './fixtures/proofing-corpus.json' with { type: 'json' };

test('local Harper returns bounded original UTF-16 edits and preserves clean controls', async () => {
  const path = '../../lib/shared/src/writing-harper.ts';
  const adapter = await import(path).catch(() => ({}));
  assert.equal(typeof adapter.createHarperChecker, 'function', 'worker adapter must be available');
  const { checker } = await import('./fixtures/harper-checker.ts');
  const settings = core.writingSettingsSchema.parse({});
  const wins: string[] = [], losses: string[] = [];
  for (const row of corpus) {
    const result = await checker.check(row.text, settings);
    assert.equal(result.complete, true);
    for (const i of result.issues) assert.equal(row.text.slice(i.from,i.to), i.original);
    if (!row.gold) assert.deepEqual(result.issues, [], row.id);
    else if(result.issues.some(i=> i.replacements.length && core.applyWritingEdit(row.text,i,i.replacements[0]) === row.gold)) wins.push(row.id);
    else if(row.legacyFirst) losses.push(row.id);
  }
  assert.deepEqual(losses, []);
  assert.ok(wins.length >= 25, wins.join(','));
});
