"use strict";
const path=require("path");
const http=require("http");
const express=require("express");
const {Server}=require("socket.io");
const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.static(path.join(__dirname,"public")));

const rooms=new Map(), socketRoom=new Map();
const COLORS=["#ff6b6b","#4dabf7","#69db7c","#ffd43b","#da77f2","#ffa94d","#38d9a9","#f06595"];
const LIMIT=4, ROUND=60000;
const DEFS={
 beans:{slots:1},water:{slots:1},soap:{slots:1},tape:{slots:1},trap:{slots:1},spray:{slots:1},
 medkit:{slots:2},battery:{slots:2},flashlight:{slots:2},mask:{slots:2},axe:{slots:3},
 backpack:{slots:4},blueprint:{slots:1},toolbox:{slots:4},map:{slots:1},radio:{slots:3}
};
const BUNKER={floor:1,x:1050,y:900,w:300,h:190};

const Z={
 kitchen:[
  {floor:1,x:260,y:240},{floor:1,x:380,y:260},{floor:1,x:520,y:260},
  {floor:1,x:300,y:460},{floor:1,x:470,y:470},{floor:1,x:650,y:420}
 ],
 pantry:[{floor:1,x:720,y:260},{floor:1,x:740,y:390},{floor:1,x:670,y:520}],
 living:[{floor:1,x:1100,y:260},{floor:1,x:1300,y:300},{floor:1,x:1130,y:520},{floor:1,x:1460,y:500}],
 bathroom1:[{floor:1,x:1880,y:260},{floor:1,x:2020,y:360},{floor:1,x:1880,y:520}],
 garage:[{floor:1,x:280,y:1000},{floor:1,x:500,y:1100},{floor:1,x:760,y:1030}],
 bedroom2:[{floor:2,x:300,y:260},{floor:2,x:520,y:300},{floor:2,x:650,y:520}],
 study2:[{floor:2,x:1120,y:250},{floor:2,x:1280,y:300},{floor:2,x:1450,y:500}],
 bathroom2:[{floor:2,x:1890,y:270},{floor:2,x:2020,y:390},{floor:2,x:1880,y:520}],
 hall2:[{floor:2,x:900,y:900},{floor:2,x:1300,y:900},{floor:2,x:1650,y:900}],
 attic:[{floor:3,x:350,y:300},{floor:3,x:650,y:430},{floor:3,x:1000,y:320},{floor:3,x:1400,y:420},{floor:3,x:1850,y:340}]
};
const pick=a=>a[Math.floor(Math.random()*a.length)];
const shuffle=a=>[...a].sort(()=>Math.random()-.5);

function code(){const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let s;do{s=Array.from({length:6},()=>c[Math.floor(Math.random()*c.length)]).join("")}while(rooms.has(s));return s}
function view(r){return {code:r.code,name:r.name,maxPlayers:r.maxPlayers,hostId:r.hostId,status:r.status,players:[...r.players.values()].map(p=>({id:p.id,nickname:p.nickname,ready:p.ready,color:p.color}))}}
function list(){return [...rooms.values()].filter(r=>r.status==="waiting").map(r=>({code:r.code,name:r.name,playerCount:r.players.size,maxPlayers:r.maxPlayers}))}
function emit(r){io.to(r.code).emit("room-updated",view(r));io.emit("room-list",list())}
function slots(p){return p.hands.reduce((s,t)=>s+(DEFS[t]?.slots||1),0)}
function makeItems(){
 const out=[], add=(type,p)=>out.push({id:"i"+out.length,type,slots:DEFS[type].slots,...p,taken:false});
 let f=shuffle([...Z.kitchen,...Z.pantry]);
 ["beans","beans","beans","beans","beans","water","water","water","water","water"].forEach((t,i)=>add(t,f[i%f.length]));
 let n=shuffle([...Z.living,...Z.garage,...Z.bedroom2,...Z.study2,...Z.hall2,...Z.attic]);
 ["soap","soap","tape","tape","trap","trap","spray","spray","medkit","medkit","battery","battery","battery","flashlight","flashlight"].forEach((t,i)=>add(t,n[i%n.length]));
 add("mask",pick([...Z.bathroom1,...Z.bathroom2,{floor:1,x:1740,y:620},{floor:2,x:1740,y:620}]));
 add("axe",pick([...Z.garage,...Z.attic,{floor:1,x:1710,y:520}]));
 add("backpack",pick([...Z.bedroom2,{floor:2,x:760,y:300},{floor:2,x:980,y:520}]));
 add("blueprint",pick([{floor:2,x:1120,y:250},{floor:2,x:1270,y:250},{floor:2,x:1420,y:250}]));
 add("toolbox",pick([...Z.garage,{floor:3,x:900,y:520}]));
 add("map",pick([{floor:1,x:1280,y:360},{floor:2,x:1250,y:380},{floor:3,x:1450,y:330}]));
 add("radio",pick([{floor:1,x:1160,y:380},{floor:2,x:1430,y:380},{floor:3,x:1780,y:380}]));
 return out;
}
function leave(s){
 const c=socketRoom.get(s.id),r=rooms.get(c); if(!c||!r)return;
 socketRoom.delete(s.id);s.leave(c);r.players.delete(s.id);
 if(!r.players.size){rooms.delete(c);io.emit("room-list",list());return}
 if(r.hostId===s.id){r.hostId=r.players.keys().next().value;r.players.get(r.hostId).ready=true} emit(r)
}
function join(s,r,name,cb){
 if(r.status!=="waiting")return cb({ok:false,message:"이미 시작됨"});
 if(r.players.size>=r.maxPlayers)return cb({ok:false,message:"방이 가득 참"});
 name=String(name||"").trim().slice(0,14);if(!name)return cb({ok:false,message:"닉네임 입력"});
 const used=new Set([...r.players.values()].map(p=>p.color));
 const color=COLORS.find(c=>!used.has(c))||pick(COLORS);
 const p={id:s.id,nickname:name,ready:false,color,floor:1,x:1180,y:980,hands:[],stored:[]};
 r.players.set(s.id,p);socketRoom.set(s.id,r.code);s.join(r.code);cb({ok:true,room:view(r),myId:s.id});emit(r)
}

io.on("connection",s=>{
 s.emit("room-list",list());
 s.on("create-room",(d,cb=()=>{})=>{
  const c=code(),p={id:s.id,nickname:String(d.nickname||"").trim().slice(0,14),ready:true,color:COLORS[0],floor:1,x:1180,y:980,hands:[],stored:[]};
  if(!p.nickname||!String(d.roomName||"").trim())return cb({ok:false,message:"입력 확인"});
  const r={
    code:c,
    name:String(d.roomName).trim().slice(0,24),
    maxPlayers:Math.max(1,Math.min(8,+d.maxPlayers||4)),
    hostId:s.id,
    status:"waiting",
    players:new Map([[s.id,p]]),
    items:[],
    endsAt:0,
    day:1,
    sanity:0,
    bounty:0,
    bountyLevel:1,
    bunkerStock:{beans:0,water:0,medkit:0,battery:0,flashlight:0,mask:0,axe:0,backpack:0,blueprint:0,toolbox:0,map:0,radio:0},
    weapons:{axe:0},
    power:100,
    security:"LOCKED"
  };
  rooms.set(c,r);socketRoom.set(s.id,c);s.join(c);cb({ok:true,room:view(r),myId:s.id});emit(r)
 });
 s.on("join-room",(d,cb=()=>{})=>{const r=rooms.get(String(d.code||"").toUpperCase());if(!r)return cb({ok:false,message:"방 없음"});join(s,r,d.nickname,cb)});
 s.on("toggle-ready",(cb=()=>{})=>{const r=rooms.get(socketRoom.get(s.id));if(!r)return cb({ok:false});if(r.hostId===s.id)return cb({ok:false});const p=r.players.get(s.id);p.ready=!p.ready;cb({ok:true});emit(r)});
 s.on("start-game",(cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id));if(!r)return cb({ok:false,message:"방 없음"});if(r.hostId!==s.id)return cb({ok:false,message:"방장만 가능"});
  if([...r.players.values()].some(p=>p.id!==r.hostId&&!p.ready))return cb({ok:false,message:"준비 필요"});
  r.status="playing";r.items=makeItems();r.endsAt=Date.now()+ROUND;
  let k=0;for(const p of r.players.values()){p.floor=1;p.x=1160+(k%3)*45;p.y=970+Math.floor(k/3)*45;p.hands=[];p.stored=[];k++}
  cb({ok:true});io.to(r.code).emit("game-started",{
    endsAt:r.endsAt,
    items:r.items,
    bunker:BUNKER,
    itemDefs:DEFS,
    handLimit:LIMIT,
    day:r.day,
    sanity:r.sanity,
    bounty:r.bounty,
    bountyLevel:r.bountyLevel,
    bunkerStock:r.bunkerStock,
    weapons:r.weapons,
    power:r.power,
    security:r.security,
    players:[...r.players.values()]
  });
 });
 s.on("player-move",d=>{const r=rooms.get(socketRoom.get(s.id));if(!r)return;const p=r.players.get(s.id);if(!p)return;p.x=+d.x;p.y=+d.y;p.floor=+d.floor;s.to(r.code).emit("player-moved",{id:p.id,x:p.x,y:p.y,floor:p.floor})});
 s.on("take-item",(id,cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id),it=r?.items.find(x=>x.id===id);
  if(!r||!p||!it||it.taken||p.floor!==it.floor)return cb({ok:false,message:"획득 불가"});
  const need=DEFS[it.type].slots;if(slots(p)+need>LIMIT)return cb({ok:false,message:`손 공간 부족 (${need}칸 필요)`});
  if(Math.hypot(p.x+15-it.x,p.y+15-it.y)>85)return cb({ok:false,message:"너무 멂"});
  it.taken=true;p.hands.push(it.type);io.to(r.code).emit("item-taken",{itemId:id,playerId:p.id,hands:p.hands});cb({ok:true})
 });
 s.on("deposit-items",(cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);if(!p||p.floor!==1)return cb({ok:false,message:"1층 벙커에서 보관"});
  const x=p.x+15,y=p.y+15,inside=x>=BUNKER.x&&x<=BUNKER.x+BUNKER.w&&y>=BUNKER.y&&y<=BUNKER.y+BUNKER.h;
  if(!inside)return cb({ok:false,message:"벙커 안에서 보관"});if(!p.hands.length)return cb({ok:false,message:"빈손"});
  for(const type of p.hands){
    r.bunkerStock[type]=(r.bunkerStock[type]||0)+1;
    if(type==="axe") r.weapons.axe=(r.weapons.axe||0)+1;
  }
  p.stored.push(...p.hands);
  p.hands=[];
  io.to(r.code).emit("items-deposited",{
    playerId:p.id,
    hands:p.hands,
    stored:p.stored,
    bunkerStock:r.bunkerStock,
    weapons:r.weapons
  });
  cb({ok:true,hands:p.hands,stored:p.stored,bunkerStock:r.bunkerStock,weapons:r.weapons})
 });

 s.on("finish-scavenge",(cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p)return cb({ok:false});

  const cx=p.x+15,cy=p.y+15;
  const alive=
    p.floor===1 &&
    cx>=BUNKER.x && cx<=BUNKER.x+BUNKER.w &&
    cy>=BUNKER.y && cy<=BUNKER.y+BUNKER.h;

  if(alive){
    r.day+=1;
    r.sanity+=10;
    r.bounty=Math.min(3,r.bounty+1);
  }

  io.to(r.code).emit("scavenge-result",{
    alive,
    day:r.day,
    sanity:r.sanity,
    bounty:r.bounty,
    bountyLevel:r.bountyLevel,
    bunkerStock:r.bunkerStock,
    weapons:r.weapons,
    power:r.power,
    security:r.security
  });

  cb({ok:true,alive});
 });

 s.on("buy-sanity-item",(type,cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id));
  if(!r)return cb({ok:false,message:"방 없음"});

  const prices={
    battery:500,
    beans:800,
    water:800,
    medkit:1500,
    flashlight:2500,
    backpack:7000,
    mask:12000,
    axe:18000,
    blueprint:30000
  };

  const price=prices[type];
  if(!price)return cb({ok:false,message:"판매하지 않는 물품"});
  if(r.sanity<price)return cb({ok:false,message:"Sanity Point가 부족합니다."});

  r.sanity-=price;
  r.bunkerStock[type]=(r.bunkerStock[type]||0)+1;
  if(type==="axe")r.weapons.axe=(r.weapons.axe||0)+1;

  io.to(r.code).emit("bunker-state",{
    day:r.day,
    sanity:r.sanity,
    bounty:r.bounty,
    bountyLevel:r.bountyLevel,
    bunkerStock:r.bunkerStock,
    weapons:r.weapons,
    power:r.power,
    security:r.security
  });

  cb({ok:true,sanity:r.sanity,bunkerStock:r.bunkerStock,weapons:r.weapons});
 });
 s.on("leave-room",(cb=()=>{})=>{leave(s);cb({ok:true})});s.on("disconnect",()=>leave(s))
});
server.listen(process.env.PORT||3000,"0.0.0.0");
