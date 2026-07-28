const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSellingPrice } = require('../src/utils/pricing');

test('calculates fixed markup selling price', () => {
  assert.equal(calculateSellingPrice({ costPrice: 100, markupType: 'fixed', markupValue: 20 }), 120);
});

test('calculates percentage markup selling price', () => {
  assert.equal(calculateSellingPrice({ costPrice: 100, markupType: 'percentage', markupValue: 10 }), 90);
});
