import test from 'node:test';
import assert from 'node:assert/strict';
import {syncOrderPage} from '../lib/shopeeSync.js';
import {historyWindows} from '../lib/historyDates.js';
const from=1793404800,to=from+604799;
function fixture(overrides={}){
 const rows=new Map(),calls=[];
 const options={connection:{shop_id:1},timeFrom:from,timeTo:to,
 get:async(path,params)=>{calls.push({path,params});return path.endsWith('get_order_list')?{order_list:[{order_sn:'A'}],more:false}:{order_list:[{order_sn:'A',create_time:from,order_status:'COMPLETED'}]};},
 save:async list=>{for(const row of list)rows.set(row.shop_id+':'+row.order_sn,{...rows.get(row.shop_id+':'+row.order_sn),...row});},
 verify:async ids=>ids.filter(id=>rows.has(options.connection.shop_id+':'+id)).length,...overrides};
 return {options,rows,calls};
}
test('hydrates list without dates and repairs existing null date without losing finance',async()=>{
 const f=fixture();f.rows.set('1:A',{create_time:null,escrow_amount:90});
 assert.equal((await syncOrderPage(f.options)).stored,1);
 assert.equal(f.rows.get('1:A').create_time,new Date(from*1000).toISOString());
 assert.equal(f.rows.get('1:A').escrow_amount,90);
 assert.equal(f.calls[1].params.order_sn_list,'A');
 await syncOrderPage(f.options);assert.equal(f.rows.size,1);
});
test('isolates both shops',async()=>{const f=fixture();await syncOrderPage(f.options);f.options.connection={shop_id:2};await syncOrderPage(f.options);assert.equal(f.rows.size,2)});
test('rejects missing detail dates and never saves',async()=>{const f=fixture({get:async()=>({order_list:[{order_sn:'A'}]})});await assert.rejects(syncOrderPage(f.options),/data de criação/);assert.equal(f.rows.size,0)});
test('rejects malformed list rather than reporting empty success',async()=>{const f=fixture({get:async()=>({})});await assert.rejects(syncOrderPage(f.options),/lista/)});
test('rejects stuck cursor before writing',async()=>{const f=fixture({cursor:'same',get:async()=>({order_list:[],more:true,next_cursor:'same'})});await assert.rejects(syncOrderPage(f.options),/paginação/)});
test('passes advancing cursor',async()=>{const f=fixture({cursor:'one',get:async()=>({order_list:[],more:true,next_cursor:'two'})});assert.deepEqual(await syncOrderPage(f.options),{queried:0,stored:0,processed:0,cursor:'two',more:true})});
test('does not claim storage success when persistence fails',async()=>{const f=fixture({save:async()=>{throw Error('database failure')}});await assert.rejects(syncOrderPage(f.options),/database failure/)});
test('detects readback mismatch',async()=>{const f=fixture({verify:async()=>0});await assert.rejects(syncOrderPage(f.options),/confirmar/)});
test('rejects orders outside requested range',async()=>{const f=fixture({get:async path=>({order_list:[{order_sn:'A',create_time:to+1}]})});await assert.rejects(syncOrderPage(f.options),/fora do período/)});
test('seven day UTC windows are inclusive and adjacent',()=>{const w=historyWindows('2026-10-01','2026-10-14');assert.equal(w.length,2);assert.equal(w[0].timeTo-w[0].timeFrom,604799);assert.equal(w[1].timeFrom,w[0].timeTo+1)});
