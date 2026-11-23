import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth,requireRole } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { hasColumn,hasTable } from '../lib/schema.js';
import { getCarSettings,getPlatformEnvironment,isServiceEnabled } from '../lib/settings.js';
import { getRelaySettings } from '../relay/settings.js';
import { relayReady } from '../relay/service.js';
import { customerRelayQuote } from '../relay/routes.js';
import { visibleHere,visibleInWorld } from '../practice/people.js';
import { isModuleLive } from '../lib/modules.js';
import { categoryFare,MAX_HIRE_HOURS } from '../car/service.js';
import { scheduledAvailable } from '../car/scheduled.js';
import { haversineKm } from '../lib/geo.js';
import { getRideTrackingSettings } from '../settings/ride-tracking.js';

type Row=Record<string,unknown>;
export const taxibeeServiceRoutes = new Hono();
const point=z.object({pickupLat:z.coerce.number().min(-90).max(90),pickupLng:z.coerce.number().min(-180).max(180),destinationLat:z.coerce.number().min(-90).max(90),destinationLng:z.coerce.number().min(-180).max(180)});
async function catalog() {
  const [car,relay,parcelEnabled,rideEnabled,tracking,world]=await Promise.all([getCarSettings(),getRelaySettings(),isServiceEnabled('parcel'),isServiceEnabled('ride'),getRideTrackingSettings(),getPlatformEnvironment()]);
  const relayEnabled=parcelEnabled && relay.enabled && await relayReady();
  const routes=relayEnabled ? (await db.execute('SELECT id,name,stage_a_name,stage_a_lat,stage_a_lng,stage_b_name,stage_b_lat,stage_b_lng FROM relay_routes WHERE active=1 ORDER BY name')).rows.filter(r=>visibleHere(world,String(r.id))) : [];
  const charterEnabled=rideEnabled && car.enabled && await hasTable('car_bookings');
  const luxury=await isModuleLive('ride.luxury');
  const extras=charterEnabled && await hasColumn('vehicle_categories','service_group');
  const categories=charterEnabled ? (await db.execute(`SELECT c.id,c.name,c.seats${extras ? ',c.service_group,c.rate_per_hour' : ", 'standard' AS service_group,0 AS rate_per_hour"}
    FROM vehicle_categories c WHERE c.active=1 AND c.kind='passenger' AND EXISTS(SELECT 1 FROM vehicles v WHERE v.category_id=c.id AND v.status='approved' AND ${visibleInWorld(world,'v.owner_id')}) ORDER BY c.sort,c.name`)).rows.filter(c=>c.service_group!=='ambulance' && (c.service_group!=='luxury'||luxury)) : [];
  return {parcelEnabled,relayEnabled,routes,charterEnabled,onDemandEnabled:car.onDemandEnabled,categories,maxHireHours:MAX_HIRE_HOURS,
    scheduled:charterEnabled && await scheduledAvailable(car.scheduled) ? {minLeadMinutes:car.scheduled.minLeadMinutes,maxAdvanceHours:car.scheduled.maxAdvanceHours} : null,
    tracking:{enabled:tracking.enabled,pollAfterSeconds:tracking.routeRefreshSeconds,staleAfterSeconds:tracking.staleAfterSeconds}};
}
taxibeeServiceRoutes.get('/taxibee-services/catalog',async c=>{c.header('Cache-Control','no-store');return c.json(await catalog());});
taxibeeServiceRoutes.get('/taxibee-services/parcel-quote',async c=>{
  if(!(await isServiceEnabled('parcel'))) return c.json({message:'Parcel delivery is not available right now.'},403);
  if(!point.safeParse(c.req.query()).success) return c.json({message:'Choose valid pickup and destination locations.'},400);
  c.header('Cache-Control','no-store');return customerRelayQuote(c);
});
taxibeeServiceRoutes.post('/taxibee-services/charter-quote',async c=>{
  const parsed=point.extend({categoryId:z.string().min(1),hireHours:z.number().int().min(1).max(MAX_HIRE_HOURS).optional()}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({message:'Choose a vehicle category and valid locations.'},400);
  const live=await catalog();
  const category=live.categories.find(r=>r.id===parsed.data.categoryId);
  if(!live.charterEnabled || !category) return c.json({message:'This vehicle category is not available.'},409);
  if(parsed.data.hireHours && (category.service_group!=='luxury'||!(Number(category.rate_per_hour)>0))) return c.json({message:'Hourly chauffeur hire is not offered for this category.'},400);
  const raw=(await db.execute({sql:'SELECT * FROM vehicle_categories WHERE id=? AND active=1',args:[category.id]})).rows[0] as Row;
  const distanceKm=haversineKm(parsed.data.pickupLat,parsed.data.pickupLng,parsed.data.destinationLat,parsed.data.destinationLng);
  c.header('Cache-Control','no-store');return c.json({fare:categoryFare(raw,distanceKm,parsed.data.hireHours),distanceKm:Math.round(distanceKm*10)/10});
});
taxibeeServiceRoutes.get('/taxibee-services/orders',requireAuth,requireRole('customer'),async c=>{
  const car=await hasTable('car_bookings');
  const rows=await db.execute({sql:`SELECT o.id,o.stage,o.pickup_address,o.destination_address,o.estimated_total,o.final_total,o.created_at,
    CASE WHEN o.is_ride=1 THEN 'charter' ELSE 'parcel' END AS service
    FROM orders o JOIN lists l ON l.id=o.list_id WHERE o.customer_id=? AND o.environment=? AND l.customer_hidden=0 AND o.type='parcel'
    AND (o.is_ride=0 ${car ? "OR EXISTS(SELECT 1 FROM car_bookings b WHERE b.order_id=o.id)" : ''}) ORDER BY o.created_at DESC LIMIT 50`,args:[c.get('user').sub,await getPlatformEnvironment()]});
  c.header('Cache-Control','no-store');return c.json({orders:rows.rows});
});
