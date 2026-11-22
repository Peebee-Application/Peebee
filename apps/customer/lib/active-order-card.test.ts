import assert from "node:assert/strict";
import test from "node:test";
import type { OrderRow } from "@peebee/shared";
import {activeOrderCard} from "./active-order-card";
import {publishActiveOrder,readActiveOrder,subscribeActiveOrder} from "./active-order-store";
const base={id:"o",customer_id:"c",type:"shopping",is_ride:0,restaurant_id:null,store_id:null,stage:"Shop",rider_id:"r",rider_name:"Kato M.",pin_code:"1234",payment_rail:"float",destination_area:"Namate"} as OrderRow;
test("each active order category has a distinct label and real stage copy",()=>{
  assert.equal(activeOrderCard({...base,is_ride:1,type:"parcel",stage:"Deliver"}).title,"Ride · Pickup");
  assert.equal(activeOrderCard({...base,is_ride:1,type:"parcel",stage:"Deliver"}).status,"Kato is coming to you");
  assert.equal(activeOrderCard({...base,is_ride:1,type:"parcel",stage:"Arrived"}).kind,"ride-pickup");
  assert.equal(activeOrderCard({...base,is_ride:1,type:"parcel",stage:"PickedUp"}).title,"Ride · Drop-off");
  assert.equal(activeOrderCard({...base,is_ride:1,stage:"PickedUp"}).status,"On the way to Namate");
  assert.equal(activeOrderCard({...base,type:"parcel",stage:"Deliver"}).status,"Your parcel is on the way");
  assert.equal(activeOrderCard({...base,item_count:8}).status,"Your rider is shopping · 8 items");
  assert.equal(activeOrderCard({...base,store_id:"s",store_name:"City Electronics"}).status,"City Electronics · Packing");
  assert.equal(activeOrderCard({...base,restaurant_id:"f",restaurant_name:"Pearl Kitchen"}).status,"Pearl Kitchen · Preparing");
});
test("missing riders never fabricate identity, enable contact or reveal a PIN",()=>{
  const model=activeOrderCard({...base,rider_id:null,rider_name:null,stage:"Match"});
  assert.equal(model.status,"Finding your rider…");assert.equal(model.pin,null);assert.equal(model.contactAvailable,false);
  assert.equal(activeOrderCard({...base,stage:"Fund"}).pin,null);
  assert.equal(activeOrderCard({...base,stage:"Cancelled"}).contactAvailable,false);
});
test("unpaid matches retain the existing payment action and trip progress advances after pickup",()=>{
  const model=activeOrderCard({...base,stage:"Match",payment_rail:"escrow"});
  assert.equal(model.needsPayment,true);assert.equal(model.href,"/orders/o/pay");assert.equal(model.status,"Payment needed to start");
  const progress=["Shop","Deliver","Arrived","PickedUp","Handover","Settle"].map(stage=>activeOrderCard({...base,is_ride:1,stage}).progress);
  assert.deepEqual([...progress].sort((a,b)=>a-b),progress);
});
test("shared active-order updates do not cross accounts or live/practice scopes",()=>{
  let updates=0;const unsubscribe=subscribeActiveOrder(()=>updates++);
  publishActiveOrder("c:live",base);assert.equal(readActiveOrder("c:live"),base);assert.equal(readActiveOrder("other:live"),undefined);assert.equal(readActiveOrder("c:practice"),undefined);
  publishActiveOrder("c:live",null);assert.equal(readActiveOrder("c:live"),null);assert.equal(updates,2);
  unsubscribe();publishActiveOrder("c:practice",base);assert.equal(updates,2);assert.equal(readActiveOrder("c:live"),undefined);
});
