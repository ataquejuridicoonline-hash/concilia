import test from 'node:test';
import assert from 'node:assert/strict';
import {compareShopeeAmounts as compare} from '../lib/shopeeComparison.js';
test('compares actual wallet receipt with adjusted expectation',()=>{assert.equal(compare({escrow_after_adjustment:100,released_amount:90}).difference,-10);assert.equal(compare({escrow_after_adjustment:100,released_amount:110}).difference,10)});
test('zero is an available financial value',()=>{assert.equal(compare({escrow_after_adjustment:0,released_amount:0}).status,'confere');assert.equal(compare({escrow_after_adjustment:10,released_amount:0}).difference,-10)});
test('does not invent missing values or use unadjusted escrow as proof',()=>{for(const missing of [null,undefined,'',NaN]){assert.equal(compare({escrow_after_adjustment:missing,escrow_amount:10,released_amount:10}).difference,null);assert.equal(compare({escrow_after_adjustment:10,released_amount:missing}).difference,null)}});
test('five cent tolerance uses integer cents',()=>{assert.equal(compare({escrow_after_adjustment:10,released_amount:9.95}).status,'confere');assert.equal(compare({escrow_after_adjustment:10,released_amount:9.94}).status,'divergente')});
