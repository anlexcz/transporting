import express from 'express';
import cors from 'cors';
import { db, tx } from './db.js';
import { OsrmRoutingProvider } from './routing.js';

const app = express();
const routing = new OsrmRoutingProvider();
const timeFactor = Number(process.env.ROUTING_TIME_FACTOR ?? 1.15);
const dwellSeconds = Number(process.env.DWELL_SECONDS ?? 15);
app.use(cors());
app.use(express.json());

const periods = [
  ['Brzké ráno','04:00','06:00',15],['Ranní špička','06:00','09:00',10],['Sedlo','09:00','14:00',12],
  ['Odpolední špička','14:00','18:00',10],['Večer','18:00','22:00',15],['Noc','22:00','04:00',null]
] as const;

function stopDto(r:any){ return {id:r.id,name:r.name,latitude:Number(r.latitude),longitude:Number(r.longitude)}; }
function waypointDto(r:any){ return {id:r.id,latitude:Number(r.latitude),longitude:Number(r.longitude)}; }

async function state() {
  const [s,w,l,d,p,rp] = await Promise.all([
    db.query(`SELECT id,name,ST_Y(position::geometry) latitude,ST_X(position::geometry) longitude FROM stops ORDER BY name`),
    db.query(`SELECT id,ST_Y(position::geometry) latitude,ST_X(position::geometry) longitude FROM waypoints ORDER BY created_at`),
    db.query(`SELECT id,public_code,name,color,turnaround_a,turnaround_b FROM lines ORDER BY public_code`),
    db.query(`SELECT id,line_id,direction,distance_m,runtime_s,geometry FROM line_directions`),
    db.query(`SELECT id,line_id,name,to_char(start_time,'HH24:MI') start_time,to_char(end_time,'HH24:MI') end_time,interval_minutes,enabled,sort_order FROM service_periods ORDER BY sort_order`),
    db.query(`SELECT id,line_direction_id,sort_order,point_type,reference_id FROM route_points ORDER BY sort_order`)
  ]);
  return {stops:s.rows.map(stopDto),waypoints:w.rows.map(waypointDto),lines:l.rows.map(line=>({
    id:line.id, publicCode:line.public_code, name:line.name, color:line.color, turnaroundA:line.turnaround_a, turnaroundB:line.turnaround_b,
    directions:d.rows.filter(x=>x.line_id===line.id).map(x=>({id:x.id,lineId:x.line_id,direction:x.direction,distance:Number(x.distance_m),runtime:Number(x.runtime_s),geometry:x.geometry,points:rp.rows.filter(q=>q.line_direction_id===x.id).map(q=>({id:q.id,lineDirectionId:q.line_direction_id,order:q.sort_order,type:q.point_type,referenceId:q.reference_id}))})),
    servicePeriods:p.rows.filter(x=>x.line_id===line.id).map(x=>({id:x.id,lineId:x.line_id,name:x.name,startTime:x.start_time,endTime:x.end_time,intervalMinutes:x.interval_minutes===null?null:Number(x.interval_minutes),enabled:x.enabled}))
  }))};
}

async function reroute(directionId:string) {
  const { rows } = await db.query(`SELECT rp.sort_order,rp.point_type,rp.reference_id,
    CASE WHEN rp.point_type='stop' THEN ST_Y(s.position::geometry) ELSE ST_Y(w.position::geometry) END latitude,
    CASE WHEN rp.point_type='stop' THEN ST_X(s.position::geometry) ELSE ST_X(w.position::geometry) END longitude
    FROM route_points rp LEFT JOIN stops s ON rp.point_type='stop' AND s.id=rp.reference_id LEFT JOIN waypoints w ON rp.point_type='waypoint' AND w.id=rp.reference_id
    WHERE rp.line_direction_id=$1 ORDER BY rp.sort_order`,[directionId]);
  const stopCount = rows.filter(x=>x.point_type==='stop').length;
  if (stopCount < 2 || rows.length < 2) {
    await db.query(`UPDATE line_directions SET geometry=NULL,distance_m=0,runtime_s=0 WHERE id=$1`,[directionId]);
    return;
  }
  if (rows.some(x=>x.latitude==null || x.longitude==null)) throw new Error('Trasa obsahuje neexistující bod.');
  const result = await routing.route(rows.map(x=>({latitude:Number(x.latitude),longitude:Number(x.longitude)})));
  const intermediateStops = Math.max(0, stopCount - 2);
  const runtime = result.duration * timeFactor + intermediateStops * dwellSeconds;
  await db.query(`UPDATE line_directions SET geometry=$2::jsonb,distance_m=$3,runtime_s=$4 WHERE id=$1`,[directionId,JSON.stringify(result.geometry),result.distance,runtime]);
}

async function rerouteReferences(type:'stop'|'waypoint', id:string) {
  const {rows}=await db.query(`SELECT DISTINCT line_direction_id FROM route_points WHERE point_type=$1 AND reference_id=$2`,[type,id]);
  for (const row of rows) await reroute(row.line_direction_id);
}

app.get('/health',(_req,res)=>res.json({ok:true}));
app.get('/api/state',async(_req,res,next)=>{try{res.json(await state())}catch(e){next(e)}});

app.post('/api/stops',async(req,res,next)=>{try{
  const {name,latitude,longitude}=req.body;
  if(!name?.trim()) return res.status(400).json({error:'Zastávka musí mít název.'});
  const {rows}=await db.query(`INSERT INTO stops(name,position) VALUES($1,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) RETURNING id,name,ST_Y(position::geometry) latitude,ST_X(position::geometry) longitude`,[name.trim(),longitude,latitude]);
  res.status(201).json(stopDto(rows[0]));
}catch(e){next(e)}});
app.put('/api/stops/:id',async(req,res,next)=>{try{
  const {name,latitude,longitude}=req.body;
  const {rows}=await db.query(`UPDATE stops SET name=COALESCE($2,name), position=CASE WHEN $3::double precision IS NULL OR $4::double precision IS NULL THEN position ELSE ST_SetSRID(ST_MakePoint($4,$3),4326)::geography END WHERE id=$1 RETURNING id,name,ST_Y(position::geometry) latitude,ST_X(position::geometry) longitude`,[req.params.id,name??null,latitude??null,longitude??null]);
  if(!rows[0]) return res.status(404).json({error:'Zastávka neexistuje.'});
  await rerouteReferences('stop',req.params.id); res.json(stopDto(rows[0]));
}catch(e){next(e)}});
app.delete('/api/stops/:id',async(req,res,next)=>{try{
  const used=await db.query(`SELECT 1 FROM route_points WHERE point_type='stop' AND reference_id=$1 LIMIT 1`,[req.params.id]);
  if(used.rowCount) return res.status(409).json({error:'Zastávka je součástí linky. Nejdřív ji odeber z tras.'});
  await db.query(`DELETE FROM stops WHERE id=$1`,[req.params.id]); res.status(204).end();
}catch(e){next(e)}});

app.post('/api/waypoints',async(req,res,next)=>{try{const {latitude,longitude}=req.body; const {rows}=await db.query(`INSERT INTO waypoints(position) VALUES(ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) RETURNING id,ST_Y(position::geometry) latitude,ST_X(position::geometry) longitude`,[longitude,latitude]);res.status(201).json(waypointDto(rows[0]));}catch(e){next(e)}});
app.put('/api/waypoints/:id',async(req,res,next)=>{try{const {latitude,longitude}=req.body;const {rows}=await db.query(`UPDATE waypoints SET position=ST_SetSRID(ST_MakePoint($2,$1),4326)::geography WHERE id=$3 RETURNING id,ST_Y(position::geometry) latitude,ST_X(position::geometry) longitude`,[latitude,longitude,req.params.id]);if(!rows[0])return res.status(404).json({error:'Waypoint neexistuje.'});await rerouteReferences('waypoint',req.params.id);res.json(waypointDto(rows[0]));}catch(e){next(e)}});
app.delete('/api/waypoints/:id',async(req,res,next)=>{try{const used=await db.query(`SELECT 1 FROM route_points WHERE point_type='waypoint' AND reference_id=$1 LIMIT 1`,[req.params.id]);if(used.rowCount)return res.status(409).json({error:'Waypoint je součástí linky. Nejdřív ho odeber z trasy.'});await db.query(`DELETE FROM waypoints WHERE id=$1`,[req.params.id]);res.status(204).end();}catch(e){next(e)}});

app.post('/api/lines',async(req,res,next)=>{try{const line=await tx(async c=>{const x=await c.query(`INSERT INTO lines(public_code,name,color) VALUES($1,$2,$3) RETURNING id`,[req.body.publicCode||'1',req.body.name||null,req.body.color||'#2563eb']);const id=x.rows[0].id;await c.query(`INSERT INTO line_directions(line_id,direction) VALUES($1,'A'),($1,'B')`,[id]);for(let i=0;i<periods.length;i++){const [n,s,e,intv]=periods[i];await c.query(`INSERT INTO service_periods(line_id,name,start_time,end_time,interval_minutes,enabled,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,n,s,e,intv,intv!==null,i]);}return id;});res.status(201).json((await state()).lines.find(x=>x.id===line));}catch(e){next(e)}});
app.put('/api/lines/:id',async(req,res,next)=>{try{const {publicCode,name,color,turnaroundA,turnaroundB}=req.body;await db.query(`UPDATE lines SET public_code=COALESCE($2,public_code),name=$3,color=COALESCE($4,color),turnaround_a=COALESCE($5,turnaround_a),turnaround_b=COALESCE($6,turnaround_b) WHERE id=$1`,[req.params.id,publicCode??null,name??null,color??null,turnaroundA??null,turnaroundB??null]);res.json((await state()).lines.find(x=>x.id===req.params.id));}catch(e){next(e)}});
app.delete('/api/lines/:id',async(req,res,next)=>{try{await db.query(`DELETE FROM lines WHERE id=$1`,[req.params.id]);res.status(204).end();}catch(e){next(e)}});

app.put('/api/directions/:id/points',async(req,res,next)=>{try{const points=req.body.points as Array<{type:string,referenceId:string}>;await tx(async c=>{await c.query(`DELETE FROM route_points WHERE line_direction_id=$1`,[req.params.id]);for(let i=0;i<points.length;i++)await c.query(`INSERT INTO route_points(line_direction_id,sort_order,point_type,reference_id) VALUES($1,$2,$3,$4)`,[req.params.id,i,points[i].type,points[i].referenceId]);});await reroute(req.params.id);res.json(await state());}catch(e){next(e)}});
app.put('/api/lines/:id/service-periods',async(req,res,next)=>{try{const items=req.body.periods as Array<any>;for(const p of items){if(p.enabled && (!p.intervalMinutes || p.intervalMinutes<=0))return res.status(400).json({error:'Interval musí být větší než 0.'});await db.query(`UPDATE service_periods SET start_time=$3,end_time=$4,interval_minutes=$5,enabled=$6 WHERE id=$1 AND line_id=$2`,[p.id,req.params.id,p.startTime,p.endTime,p.intervalMinutes,p.enabled]);}res.json((await state()).lines.find(x=>x.id===req.params.id));}catch(e){next(e)}});

app.use((err:any,_req:any,res:any,_next:any)=>{console.error(err);res.status(500).json({error:err?.message || 'Neočekávaná chyba serveru.'});});
app.listen(Number(process.env.PORT??3001),()=>console.log(`Transporting API on http://localhost:${process.env.PORT??3001}`));
