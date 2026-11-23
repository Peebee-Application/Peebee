import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, addUser, app } from "../test-support/db.js";

test("busy riders are not offered jobs, claims resume safely, and cash checkout opens after assignment", async () => {
  const db = await freshDatabase();
  try {
    const customer = await addUser(db, "checkout-customer");
    const rider = await addUser(db, "checkout-rider", "rider");
    await db.execute("INSERT INTO riders(user_id,verified,is_online) VALUES('checkout-rider',1,1)");
    await db.execute("INSERT INTO lists(id,customer_id,title,environment) VALUES('checkout-list','checkout-customer','List','live')");
    await db.execute("INSERT INTO orders(id,list_id,customer_id,rider_id,stage,type,environment,matching_mode,estimated_total,delivery_fee) VALUES('previous','checkout-list','checkout-customer','checkout-rider','Shop','parcel','live','first_to_claim',3000,3000),('new-list','checkout-list','checkout-customer',NULL,'Create','shopping','live','first_to_claim',38500,3000)");
    const call = (token: string, path: string, body?: object) => app.request('/v1' + path, {method: body ? 'POST' : 'GET', headers: {Authorization: `Bearer ${token}`, 'Content-Type':'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
    assert.deepEqual((await (await call(rider, '/riders/jobs/available')).json()).jobs, []);
    const blocked = await call(rider, '/orders/new-list/claim', {});
    assert.equal(blocked.status,409);
    assert.equal((await blocked.json()).error,'rider_busy');
    assert.equal((await call(customer, '/orders/new-list/fund', {paymentMethod:'cash',acceptedAmount:38500})).status,409);
    await db.execute("UPDATE orders SET stage='Cancelled' WHERE id='previous'");
    assert.ok((await (await call(rider, '/riders/jobs/available')).json()).jobs.some((job: {id: string}) => job.id === 'new-list'));
    assert.equal((await call(rider, '/orders/new-list/claim', {})).status,200);
    assert.equal((await call(rider, '/orders/new-list/claim', {})).status,200,"retry returns the rider's own assignment");
    const paid = await call(customer, '/orders/new-list/fund', {paymentMethod:'cash',acceptedAmount:38500});
    assert.equal(paid.status,200,await paid.clone().text());
    const result = await paid.json();
    assert.equal(result.order.stage,'Shop');
    assert.equal(result.order.payment_rail,'float');
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM payments WHERE order_id='new-list'")).rows[0].n,0,'cash confirmation never creates a money transfer');
  } finally { db.close(); }
});
