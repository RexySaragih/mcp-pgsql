import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyzeQuery,
  assertReadOnlySelect,
  formatTransactionPreview,
} from '../src/utils/sql-safety.js';
import { applyRowLimit } from '../src/utils/row-limit.js';
import { isSafeIdentifier, quoteIdent } from '../src/utils/format.js';

describe('analyzeQuery', () => {
  it('should treat plain SELECT as read-only', () => {
    const result = analyzeQuery('SELECT 1');
    assert.equal(result.isReadOnly, true);
    assert.equal(result.type, 'SELECT');
  });

  it('should not treat WITH … INSERT as read-only', () => {
    const result = analyzeQuery(
      'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x',
    );
    assert.equal(result.isReadOnly, false);
  });

  it('should ignore leading comments for DELETE', () => {
    const result = analyzeQuery('/* comment */ DELETE FROM t');
    assert.equal(result.type, 'DELETE');
    assert.equal(result.isReadOnly, false);
  });

  it('should flag FOR UPDATE soft confirmation', () => {
    const result = analyzeQuery('SELECT id FROM t FOR UPDATE');
    assert.equal(result.isReadOnly, true);
    assert.equal(result.needsSoftConfirmation, true);
  });
});

describe('assertReadOnlySelect', () => {
  it('should reject multi-statement', () => {
    const result = assertReadOnlySelect('SELECT 1; DELETE FROM t');
    assert.equal(result.ok, false);
  });

  it('should allow WITH select', () => {
    const result = assertReadOnlySelect(
      'WITH c AS (SELECT 1 AS n) SELECT * FROM c',
    );
    assert.equal(result.ok, true);
  });
});

describe('applyRowLimit', () => {
  it('should append LIMIT', () => {
    assert.equal(applyRowLimit('SELECT * FROM t', 10), 'SELECT * FROM t LIMIT 10');
  });

  it('should insert LIMIT before FOR UPDATE', () => {
    assert.equal(
      applyRowLimit('SELECT * FROM t FOR UPDATE', 5),
      'SELECT * FROM t LIMIT 5 FOR UPDATE',
    );
  });
});

describe('identifiers', () => {
  it('should quote schema.table', () => {
    assert.equal(quoteIdent('public.users'), '"public"."users"');
  });

  it('should reject unsafe identifiers', () => {
    assert.equal(isSafeIdentifier('users;drop'), false);
  });
});

describe('transaction preview', () => {
  it('should list per-statement types', () => {
    const text = formatTransactionPreview(
      'SET ROLE app; DELETE FROM users WHERE id = 1',
    );
    assert.match(text, /SET/);
    assert.match(text, /DELETE/);
    assert.match(text, /confirmed: true/);
  });
});
