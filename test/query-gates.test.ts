import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readQuery, writeQuery } from '../src/tools/query.js';
import { explainQuery } from '../src/tools/analysis.js';

describe('query tool gates (no DB)', () => {
  it('should reject mutating SQL in read_query', async () => {
    const text = await readQuery('DELETE FROM users');
    assert.match(text, /Error:/);
  });

  it('should preview FOR UPDATE without confirmed', async () => {
    const text = await readQuery('SELECT id FROM users FOR UPDATE');
    assert.match(text, /Confirmation required/);
    assert.match(text, /confirmed: true/);
  });

  it('should preview write_query without confirmed', async () => {
    const text = await writeQuery('UPDATE users SET name = 1');
    assert.match(text, /Confirmation required/);
    assert.match(text, /confirmed: true/);
    assert.match(text, /nothing executed/i);
  });

  it('should preview schema_query without confirmed', async () => {
    const { schemaQuery } = await import('../src/tools/query.js');
    const text = await schemaQuery('DROP TABLE users');
    assert.match(text, /Confirmation required/);
    assert.match(text, /schema_query/);
  });

  it('should preview EXPLAIN ANALYZE without confirmed', async () => {
    const text = await explainQuery('SELECT 1', true, 'text', false);
    assert.match(text, /EXPLAIN ANALYZE/);
    assert.match(text, /confirmed: true/);
  });
});
