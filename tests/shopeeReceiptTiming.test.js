import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptTiming as calc} from '../lib/shopeeReceiptTiming.js';
test('averages elapsed time including fractions of days',()=>{const r=calc([{order_sn:'a',released_amount:10,released_at:'2026-09-11T12:00:00Z'},{order_sn:'b',released_amount:20,released_at:'2026-09-16T00:00:00Z'}],[{order_sn:'a',create_time:'2026-09-01T00:00:00Z'},{order_sn:'b',create_time:'2026-09-01T00:00:00Z'}]);assert.equal(r.meanDays,12.75);assert.equal(r.medianDays,12.75);assert.equal(r.sample,2)});
test('excludes missing dates, negative durations and debits without inventing dates',()=>{const r=calc([{order_sn:'missing',released_amount:10,released_at:'2026-09-01'},{order_sn:'bad',released_amount:10,released_at:'2026-09-01'},{order_sn:'debit',released_amount:-1,released_at:'2026-09-01'}],[{order_sn:'bad',create_time:'2026-09-02'}]);assert.equal(r.meanDays,null);assert.equal(r.missingDates,1);assert.equal(r.invalidDates,1);assert.equal(r.nonPositive,1)});
test('empty sample has no estimate',()=>{assert.equal(calc([],[]).meanDays,null)});
