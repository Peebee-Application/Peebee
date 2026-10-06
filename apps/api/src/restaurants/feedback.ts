import {Hono} from "hono";
import {z} from "zod";
import {requireAuth,requireRole} from "../auth/middleware.js";
import {db} from "../db/client.js";
import {hasColumn,hasTable} from "../lib/schema.js";
import {getPlatformEnvironment} from "../lib/settings.js";
import {newId} from "../lib/ids.js";
import type {FoodItemInsight,FoodItemReview} from "@peebee/shared";

export const foodFeedbackRoutes=new Hono();
async function enabled(){return await hasTable("food_item_reviews")&&await hasColumn("list_items","source_menu_item_id");}
async function visible(id:string){return (await db.execute({sql:"SELECT id FROM restaurants WHERE id=? AND status='active' AND environment=?",args:[id,await getPlatformEnvironment()]})).rows.length>0;}
const empty:FoodItemInsight={averageRating:null,ratingCount:0,orderCount:0,recommendCount:0};
async function insight(itemId:string,environment:string):Promise<FoodItemInsight>{
 const [ratings,orders]=await Promise.all([
  db.execute({sql:"SELECT AVG(r.rating) AS average_rating,COUNT(*) AS rating_count,SUM(r.recommended) AS recommend_count FROM food_item_reviews r JOIN orders o ON o.id=r.order_id WHERE r.menu_item_id=? AND o.environment=? AND o.stage IN ('Handover','Settle')",args:[itemId,environment]}),
  db.execute({sql:"SELECT COUNT(DISTINCT o.id) AS order_count FROM list_items l JOIN orders o ON o.list_id=l.list_id WHERE l.source_menu_item_id=? AND o.environment=? AND o.stage!='Cancelled'",args:[itemId,environment]})
 ]); const row=ratings.rows[0];return {averageRating:row.average_rating==null?null:Number(row.average_rating),ratingCount:Number(row.rating_count),recommendCount:Number(row.recommend_count??0),orderCount:Number(orders.rows[0].order_count)};
}
foodFeedbackRoutes.get("/restaurants/:id/menu/insights",requireAuth,async(c)=>{
 const id=String(c.req.param("id"));if(!await visible(id))return c.json({error:"not_found"},404);
 if(!await enabled())return c.json({items:{},available:false});
 const environment=await getPlatformEnvironment();
 const items=(await db.execute({sql:"SELECT id FROM menu_items WHERE restaurant_id=? AND available=1",args:[id]})).rows;
 const result:Record<string,FoodItemInsight>={};
 for(const item of items)result[String(item.id)]={...empty};
 const [ratingRows,orderRows]=await Promise.all([
  db.execute({sql:"SELECT r.menu_item_id,AVG(r.rating) AS average_rating,COUNT(*) AS rating_count,SUM(r.recommended) AS recommend_count FROM food_item_reviews r JOIN orders o ON o.id=r.order_id JOIN menu_items m ON m.id=r.menu_item_id WHERE m.restaurant_id=? AND o.environment=? AND o.stage IN ('Handover','Settle') GROUP BY r.menu_item_id",args:[id,environment]}),
  db.execute({sql:"SELECT l.source_menu_item_id,COUNT(DISTINCT o.id) AS order_count FROM list_items l JOIN orders o ON o.list_id=l.list_id WHERE o.restaurant_id=? AND o.environment=? AND o.stage!='Cancelled' GROUP BY l.source_menu_item_id",args:[id,environment]})
 ]);
 for(const row of ratingRows.rows){const key=String(row.menu_item_id);if(result[key])result[key]={...result[key],averageRating:Number(row.average_rating),ratingCount:Number(row.rating_count),recommendCount:Number(row.recommend_count??0)};}
 for(const row of orderRows.rows){const key=String(row.source_menu_item_id);if(result[key])result[key].orderCount=Number(row.order_count);}
 return c.json({items:result,available:true});
});
foodFeedbackRoutes.get("/restaurants/:id/items/:itemId/reviews",requireAuth,async(c)=>{
 const id=String(c.req.param("id")),itemId=String(c.req.param("itemId"));
 if(!await visible(id)||(await db.execute({sql:"SELECT id FROM menu_items WHERE id=? AND restaurant_id=? AND available=1",args:[itemId,id]})).rows.length===0)return c.json({error:"not_found"},404);
 if(!await enabled())return c.json({...empty,available:false,reviews:[],myReview:null,eligibleOrderId:null});
 const environment=await getPlatformEnvironment(),customer=c.get("user").sub;
 const [metrics,rows,eligible,mine]=await Promise.all([
  insight(itemId,environment),
  db.execute({sql:"SELECT r.id,r.rating,r.comment,r.recommended,r.created_at,u.name FROM food_item_reviews r JOIN users u ON u.id=r.customer_id JOIN orders o ON o.id=r.order_id WHERE r.menu_item_id=? AND o.environment=? AND o.stage IN ('Handover','Settle') ORDER BY r.updated_at DESC,r.id DESC LIMIT 50",args:[itemId,environment]}),
  db.execute({sql:"SELECT o.id FROM orders o JOIN list_items l ON l.list_id=o.list_id WHERE o.customer_id=? AND o.restaurant_id=? AND o.environment=? AND o.stage IN ('Handover','Settle') AND l.source_menu_item_id=? ORDER BY o.created_at DESC LIMIT 1",args:[customer,id,environment,itemId]}),
  db.execute({sql:"SELECT r.id,r.rating,r.comment,r.recommended,r.created_at,u.name FROM food_item_reviews r JOIN users u ON u.id=r.customer_id JOIN orders o ON o.id=r.order_id WHERE r.menu_item_id=? AND r.customer_id=? AND o.environment=? AND o.stage IN ('Handover','Settle')",args:[itemId,customer,environment]})
 ]);
 const map=(r:Record<string,unknown>):FoodItemReview=>({id:String(r.id),rating:Number(r.rating),comment:r.comment==null?null:String(r.comment),recommended:!!r.recommended,authorName:String(r.name).split(/\s+/)[0],createdAt:String(r.created_at)});
 return c.json({...metrics,available:true,reviews:rows.rows.map(map),myReview:mine.rows[0]?map(mine.rows[0]):null,eligibleOrderId:eligible.rows[0]?.id??null});
});
foodFeedbackRoutes.put("/restaurants/:id/items/:itemId/review",requireAuth,requireRole("customer"),async(c)=>{
 if(!await enabled())return c.json({error:"reviews_unavailable",message:"Dish reviews are being enabled. Please try again shortly."},503);
 const parsed=z.object({orderId:z.string(),rating:z.number().int().min(1).max(5),comment:z.string().trim().max(2000).optional(),recommended:z.boolean()}).safeParse(await c.req.json().catch(()=>({})));
 if(!parsed.success)return c.json({error:"invalid_body"},400);
 const itemId=String(c.req.param("itemId")),restaurantId=String(c.req.param("id")),customer=c.get("user").sub,d=parsed.data;
 const purchase=await db.execute({sql:"SELECT o.id FROM orders o JOIN list_items l ON l.list_id=o.list_id JOIN menu_items m ON m.id=l.source_menu_item_id WHERE o.id=? AND o.customer_id=? AND o.restaurant_id=? AND o.environment=? AND o.stage IN ('Handover','Settle') AND l.source_menu_item_id=? AND m.restaurant_id=?",args:[d.orderId,customer,restaurantId,await getPlatformEnvironment(),itemId,restaurantId]});
 if(!purchase.rows.length)return c.json({error:"verified_purchase_required",message:"You can review this dish after receiving an order containing it."},403);
 await db.execute({sql:"INSERT INTO food_item_reviews(id,menu_item_id,order_id,customer_id,rating,comment,recommended) VALUES(?,?,?,?,?,?,?) ON CONFLICT(menu_item_id,customer_id) DO UPDATE SET order_id=excluded.order_id,rating=excluded.rating,comment=excluded.comment,recommended=excluded.recommended,updated_at=datetime('now')",args:[newId("review"),itemId,d.orderId,customer,d.rating,d.comment||null,d.recommended?1:0]});
 return c.json({ok:true});
});
