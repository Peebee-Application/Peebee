import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireAuth,requireRole } from "../auth/middleware.js";
import { requirePermission } from "../admin/permissions.js";
import { db } from "../db/client.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { baseMimeType,extensionForMime } from "../lib/mime.js";
import { getR2Bucket,uploadResponseHeaders } from "../storage/r2.js";
import { newId } from "../lib/ids.js";

export const logoRoutes=new Hono();
logoRoutes.post("/restaurants/me/logo",requireAuth,requireRole("customer"),bodyLimit({maxSize:4*1024*1024+64*1024,onError:(c)=>c.json({error:"file_too_large"},413)}),async(c)=>{
  const business=(await db.execute({sql:"SELECT id FROM restaurants WHERE owner_id=?",args:[c.get("user").sub]})).rows[0];
  if(!business)return c.json({error:"not_found"},404);
  const form=await c.req.formData().catch(()=>null),file=form?.get("file");
  if(!(file instanceof File))return c.json({error:"missing_file"},400);
  if(!["image/jpeg","image/png","image/webp"].includes(baseMimeType(file.type)))return c.json({error:"unsupported_file_type"},400);
  if(!file.size||file.size>4*1024*1024)return c.json({error:"file_too_large"},400);
  // Unique object names keep cover replacement fresh in client image caches.
  const key=`restaurants/${business.id}/logos/${newId("logo")}.${extensionForMime(file.type,"jpg")}`;
  await getR2Bucket().put(key,await file.arrayBuffer(),{httpMetadata:{contentType:baseMimeType(file.type)}});
  await db.execute({sql:"UPDATE restaurants SET logo_key=? WHERE id=? AND owner_id=?",args:[key,String(business.id),c.get("user").sub]});
  return c.json({ok:true,logoKey:key});
});
logoRoutes.get("/restaurants/:id/logo",requireAuth,async(c,next)=>{
  if(c.get("user").role==="admin")return requirePermission("restaurants.view")(c,next);
  await next();
},async(c)=>{
  const business=(await db.execute({sql:"SELECT owner_id,status,environment,logo_key FROM restaurants WHERE id=?",args:[String(c.req.param("id"))]})).rows[0];
  if(!business)return c.json({error:"not_found"},404);
  if(c.get("user").role!=="admin"&&business.owner_id!==c.get("user").sub&&(business.status!=="active"||business.environment!==await getPlatformEnvironment()))return c.json({error:"forbidden"},403);
  if(!business.logo_key)return c.json({error:"not_found"},404);
  const object=await getR2Bucket().get(String(business.logo_key));
  if(!object)return c.json({error:"not_found"},404);
  return new Response(object.body,{headers:{...uploadResponseHeaders(object.httpMetadata?.contentType,"image/jpeg"),"Cache-Control":"private, no-store"}});
});
