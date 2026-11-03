import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDocument } from '../shared/pricing.mjs';
import { validateRecord } from '../server/validation.mjs';
test('document totals round per currency and apply tax after discount', () => {
  const d = calculateDocument(
    [{ description: 'Design', quantity: 2, rate: 100.05 }],
    'USD',
    10,
    15,
  );
  assert.equal(d.subtotal, 200.1);
  assert.equal(d.discount, 20.01);
  assert.equal(d.tax, 27.01);
  assert.equal(d.total, 207.1);
  assert.equal(
    calculateDocument([{ description: 'Work', quantity: 1, rate: 1.234 }], 'KWD').total,
    1.234,
  );
  assert.throws(
    () => calculateDocument([{ description: 'Work', quantity: 1, rate: 1.5 }], 'JPY'),
    /0 decimal/,
  );
});
test('server recalculates document totals instead of trusting the browser', () => {
  const result = validateRecord('proposals', {
    title: 'Brand design',
    status: 'Draft',
    data: {
      client: 'Client',
      amount: '0.01',
      currency: 'USD',
      lineItems: JSON.stringify([{ description: 'Design', quantity: 2, rate: 100.05 }]),
      discountPercent: '10',
      taxPercent: '15',
    },
  });
  assert.equal(result.data.amount, '207.1');
  assert.equal(result.data.taxPercent, '15');
});
test('invalid financial input cannot create misleading totals', () => {
  for (const line of [
    { description: '', quantity: 1, rate: 100 },
    { description: 'Work', quantity: 0, rate: 100 },
    { description: 'Work', quantity: 1, rate: -1 },
    { description: 'Work', quantity: 1, rate: Infinity },
  ])
    assert.throws(() => calculateDocument([line]));
  assert.throws(
    () => calculateDocument([{ description: 'Work', quantity: 1, rate: 10 }], 'USD', 101),
    /between/,
  );
  assert.throws(() => calculateDocument([], 'USD'), /line items/);
});
