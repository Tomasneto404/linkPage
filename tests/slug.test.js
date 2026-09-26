// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Slug normalisation and validation rules (pure unit tests, no server). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSlug, isReservedSlug, MAX_SLUG_LENGTH } = require('../src/utils/slug');

describe('normalizeSlug', () => {
  test('lowercases and hyphenates words', () => {
    assert.equal(normalizeSlug('Annual Report'), 'annual-report');
    assert.equal(normalizeSlug('annual_report'), 'annual-report');
    assert.equal(normalizeSlug('Annual   Report  2026'), 'annual-report-2026');
  });

  test('strips accents rather than dropping the letter', () => {
    assert.equal(normalizeSlug('Relatório Anual'), 'relatorio-anual');
    assert.equal(normalizeSlug('Ação'), 'acao');
  });

  test('drops punctuation and collapses the gaps it leaves', () => {
    assert.equal(normalizeSlug('report(final).pdf'), 'report-final-pdf');
    assert.equal(normalizeSlug('a//b'), 'a-b');
    assert.equal(normalizeSlug('--lead--and--trail--'), 'lead-and-trail');
  });

  test('already-clean slugs pass through untouched', () => {
    assert.equal(normalizeSlug('annual-report-2026'), 'annual-report-2026');
  });

  test('truncates to the maximum length without a trailing hyphen', () => {
    const long = normalizeSlug('a'.repeat(MAX_SLUG_LENGTH + 20));
    assert.equal(long.length, MAX_SLUG_LENGTH);

    const cut = normalizeSlug(`${'a'.repeat(MAX_SLUG_LENGTH - 1)}-bbbb`);
    assert.equal(cut, 'a'.repeat(MAX_SLUG_LENGTH - 1), 'the dangling hyphen is trimmed off');
  });

  test('returns null for anything that normalises to nothing', () => {
    for (const input of ['', '   ', '---', '!!!', null, undefined, 42, {}]) {
      assert.equal(normalizeSlug(input), null, `input: ${JSON.stringify(input)}`);
    }
  });
});

describe('isReservedSlug', () => {
  test('rejects the words that collide with real routes', () => {
    for (const word of ['admin', 'api', 'uploads', 'r', 'f']) {
      assert.equal(isReservedSlug(word), true, word);
    }
  });

  test('allows ordinary words', () => {
    assert.equal(isReservedSlug('annual-report'), false);
    assert.equal(isReservedSlug('administration'), false);
  });
});
