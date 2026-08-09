"use strict";
const path=require("path");
const http=require("http");
const express=require("express");
const {Server}=require("socket.io");
const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.static(path.join(__dirname,"public")));

const rooms=new Map(), socketRoom=new Map();
const publicLobbies=Array.from({length:10},(_,i)=>({
  id:i+1,
  players:new Map(),
  messages:[]
}));
const socketLobby=new Map();
const pendingDisconnects=new Map();
const COLORS=["#ff6b6b","#4dabf7","#69db7c","#ffd43b","#da77f2","#ffa94d","#38d9a9","#f06595"];
const LIMIT=4, ROUND=60000;

// v10: DAY는 탐사 횟수가 아니라 시간으로 진행.
// 현재 2분 = 게임 내 1일. 나중에 이 숫자만 바꾸면 됨.
const DAY_LENGTH_MS=120000;
const EXPEDITION_COOLDOWN_MS=180000;
const EXPEDITION_INVITE_MS=15000;

// v16 bunker survival
const STAT_TICK_MS=10000;
const DAMAGE_TICK_MS=3000;
const VENT_MIN_DELAY_MS=120000;
const VENT_MAX_DELAY_MS=240000;
const VENT_STAGE_MS=30000;

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
function view(r){return {code:r.code,name:r.name,publicLobbyId:r.publicLobbyId,private:r.private,maxPlayers:r.maxPlayers,hostId:r.hostId,status:r.status,players:[...r.players.values()].map(p=>({id:p.id,nickname:p.nickname,ready:p.ready,color:p.color}))}}
function list(){return [...rooms.values()].filter(r=>r.status==="waiting").map(r=>({code:r.code,name:r.name,playerCount:r.players.size,maxPlayers:r.maxPlayers}))}
function emit(r){io.to(r.code).emit("room-updated",view(r));io.emit("room-list",list());if(r.publicLobbyId)emitPublicParties(r.publicLobbyId)}
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
 socketRoom.delete(s.id);
 s.leave(c);

 const leavingPlayer=r.players.get(s.id);
 if(leavingPlayer){
   io.to(c).emit("bunker-player-left",{id:s.id});
 }

 r.players.delete(s.id);

 if(!r.players.size){
   rooms.delete(c);
   io.emit("room-list",list());
   return
 }
 if(r.hostId===s.id){r.hostId=r.players.keys().next().value;r.players.get(r.hostId).ready=true} emit(r)
}
function join(s,r,name,cb,preferredColor,preferredSessionId){
 if(r.status!=="waiting")return cb({ok:false,message:"이미 시작됨"});
 if(r.players.size>=r.maxPlayers)return cb({ok:false,message:"방이 가득 참"});
 name=String(name||"").trim().slice(0,14);if(!name)return cb({ok:false,message:"닉네임 입력"});
 const used=new Set([...r.players.values()].map(p=>p.color));
 const requested=COLORS.includes(preferredColor)?preferredColor:null;
 const color=(requested&&!used.has(requested))
   ? requested
   : (COLORS.find(c=>!used.has(c))||pick(COLORS));
 const p={id:s.id,nickname:name,sessionId:String(preferredSessionId||""),ready:false,color,floor:1,x:1180,y:980,hands:[],stored:[],bunkerX:330,bunkerY:560,inBunker:false,hp:100,hunger:100,thirst:100,hygiene:100,fatigue:0,sanityStat:100,equipped:null,facingX:1,facingY:0,lastWeaponSwingAt:0,nextHallucinationAt:0,sick:false,jumping:false,jumpUntil:0,flashlightEquipped:false,inExpedition:false,expeditionX:260,expeditionY:900};
 r.players.set(s.id,p);socketRoom.set(s.id,r.code);s.join(r.code);cb({ok:true,room:view(r),myId:s.id});emit(r)
}


const GROCERY_ITEM_TYPES=["beans","water","soap","tape","battery","medkit","flashlight"];

const GROCERY_POINTS=[
 {x:250,y:180},{x:400,y:180},{x:550,y:180},{x:700,y:180},{x:850,y:180},
 {x:300,y:340},{x:470,y:340},{x:640,y:340},{x:810,y:340},{x:980,y:340},
 {x:250,y:520},{x:430,y:520},{x:610,y:520},{x:790,y:520},{x:970,y:520},
 {x:300,y:700},{x:480,y:700},{x:660,y:700},{x:840,y:700},{x:1020,y:700}
];

function makeGroceryItems(){
 const points=shuffle(GROCERY_POINTS);
 const types=[
   "beans","beans","beans","beans","beans",
   "water","water","water","water","water",
   "soap","soap",
   "tape","tape",
   "battery","battery",
   "medkit","flashlight"
 ];
 return types.map((type,i)=>({
   id:`g-${Date.now()}-${i}-${Math.random().toString(36).slice(2,6)}`,
   type,
   slots:DEFS[type]?.slots||1,
   x:points[i%points.length].x,
   y:points[i%points.length].y,
   taken:false
 }));
}

const MUTANT_SPAWN_POINTS=[
  {x:1040,y:170},
  {x:1000,y:560},
  {x:900,y:810},
  {x:560,y:610},
  {x:380,y:390},
  {x:760,y:380}
];

function makeMutants(){
  const points=shuffle(MUTANT_SPAWN_POINTS);

  return points.slice(0,4).map((point,index)=>({
    id:`mutant-${Date.now()}-${index}-${Math.random().toString(36).slice(2,6)}`,
    x:point.x,
    y:point.y,
    hp:70,
    maxHp:70,
    alive:true,
    targetId:null,
    lastAttackAt:0
  }));
}

function lobbyView(lobby){
  return {
    id:lobby.id,
    playerCount:lobby.players.size,
    players:[...lobby.players.values()].map(p=>({
      id:p.id,nickname:p.nickname,color:p.color,x:p.x,y:p.y
    }))
  };
}

function lobbyList(){
  return publicLobbies.map(l=>({id:l.id,playerCount:l.players.size}));
}

function emitLobbyList(){
  io.emit("public-lobby-list",lobbyList());
}

function leavePublicLobby(socket){
  const lobbyId=socketLobby.get(socket.id);
  if(!lobbyId)return;

  const lobby=publicLobbies[lobbyId-1];
  socketLobby.delete(socket.id);
  socket.leave(`public-lobby-${lobbyId}`);

  if(lobby){
    lobby.players.delete(socket.id);
    io.to(`public-lobby-${lobbyId}`).emit("public-lobby-player-left",{id:socket.id});
  }

  emitLobbyList();
}


function scheduleRoomDisconnect(socket){
  const roomCode=socketRoom.get(socket.id);
  if(!roomCode)return;

  const room=rooms.get(roomCode);
  const player=room?.players.get(socket.id);
  if(!room||!player)return;

  const sessionId=player.sessionId||`socket-${socket.id}`;

  if(pendingDisconnects.has(sessionId)){
    clearTimeout(pendingDisconnects.get(sessionId));
  }

  const timer=setTimeout(()=>{
    pendingDisconnects.delete(sessionId);

    const currentRoom=rooms.get(roomCode);
    if(!currentRoom)return;

    const currentPlayer=currentRoom.players.get(socket.id);
    if(!currentPlayer)return;

    currentRoom.players.delete(socket.id);
    socketRoom.delete(socket.id);

    io.to(roomCode).emit("bunker-player-left",{id:socket.id});

    if(!currentRoom.players.size){
      rooms.delete(roomCode);
      emitLobbyList();
      io.emit("room-list",list());
      return;
    }

    if(currentRoom.hostId===socket.id){
      currentRoom.hostId=currentRoom.players.keys().next().value;
      currentRoom.players.get(currentRoom.hostId).ready=true;
    }

    emit(currentRoom);
  },20000);

  pendingDisconnects.set(sessionId,timer);
}

function reconnectRoom(socket,sessionId,cb=()=>{}){
  if(!sessionId)return cb({ok:false});

  for(const room of rooms.values()){
    const entry=[...room.players.entries()].find(([,p])=>p.sessionId===sessionId);
    if(!entry)continue;

    const [oldId,player]=entry;

    if(pendingDisconnects.has(sessionId)){
      clearTimeout(pendingDisconnects.get(sessionId));
      pendingDisconnects.delete(sessionId);
    }

    room.players.delete(oldId);
    socketRoom.delete(oldId);

    player.id=socket.id;
    room.players.set(socket.id,player);
    socketRoom.set(socket.id,room.code);
    socket.join(room.code);

    if(room.hostId===oldId)room.hostId=socket.id;

    io.to(room.code).emit("player-id-rebound",{oldId,newId:socket.id,nickname:player.nickname});
    emit(room);

    return cb({
      ok:true,
      room:view(room),
      myId:socket.id,
      player:{
        inBunker:player.inBunker,
        inExpedition:player.inExpedition,
        bunkerX:player.bunkerX,
        bunkerY:player.bunkerY,
        expeditionX:player.expeditionX,
        expeditionY:player.expeditionY,
        hp:player.hp,
        hunger:player.hunger,
        thirst:player.thirst,
        hygiene:player.hygiene,
        equipped:player.equipped
      },
      expeditionItems:room.expeditionItems,
      expeditionMutants:room.expeditionMutants
    });
  }

  cb({ok:false});
}


function publicPartiesForLobby(lobbyId){
  return [...rooms.values()]
    .filter(r=>r.publicLobbyId===lobbyId && r.status==="waiting" && !r.private)
    .map(r=>({code:r.code,name:r.name,playerCount:r.players.size,maxPlayers:r.maxPlayers}));
}

function emitPublicParties(lobbyId){
  if(!lobbyId)return;
  io.to(`public-lobby-${lobbyId}`).emit(
    "public-party-list",
    publicPartiesForLobby(lobbyId)
  );
}


function resolveRoomPlayer(socket,data={}){
  let room=rooms.get(socketRoom.get(socket.id));
  let player=room?.players.get(socket.id);
  if(room&&player)return {room,player};

  const sessionId=String(data?.sessionId||"");
  const roomCode=String(data?.roomCode||"").toUpperCase();
  const nickname=String(data?.nickname||"");

  const candidates=roomCode&&rooms.has(roomCode)?[rooms.get(roomCode)]:[...rooms.values()];
  for(const candidate of candidates){
    const entry=[...candidate.players.entries()].find(([,p])=>
      (sessionId&&p.sessionId===sessionId) || (nickname&&p.nickname===nickname)
    );
    if(!entry)continue;
    const [oldId,p]=entry;
    if(oldId!==socket.id){
      candidate.players.delete(oldId);
      socketRoom.delete(oldId);
      p.id=socket.id;
      candidate.players.set(socket.id,p);
      if(candidate.hostId===oldId)candidate.hostId=socket.id;
    }
    socketRoom.set(socket.id,candidate.code);
    socket.join(candidate.code);
    return {room:candidate,player:p};
  }
  return {room:null,player:null};
}


function ventPublicState(room){
  return (room.vents||[]).map(v=>({
    id:v.id,
    closed:v.closed,
    threat:v.threat,
    stage:v.stage,
    nextEventAt:v.nextEventAt||0
  }));
}

function scheduleNextVentEvent(room,vent=null){
  const next=
    Date.now()+
    VENT_MIN_DELAY_MS+
    Math.floor(Math.random()*(VENT_MAX_DELAY_MS-VENT_MIN_DELAY_MS));

  if(vent){
    vent.nextEventAt=next;
  }else{
    for(const v of room.vents||[]){
      v.nextEventAt=
        Date.now()+
        VENT_MIN_DELAY_MS+
        Math.floor(Math.random()*(VENT_MAX_DELAY_MS-VENT_MIN_DELAY_MS));
    }
  }
}

function randomStealFromBunker(room){
  const candidates=Object.keys(room.bunkerStock||{})
    .filter(type=>(room.bunkerStock[type]||0)>0);

  const stolen={};
  const groups=1+Math.floor(Math.random()*4);

  for(let i=0;i<groups&&candidates.length;i++){
    const type=pick(candidates);
    const current=room.bunkerStock[type]||0;
    if(current<=0)continue;

    const amount=Math.min(current,1+Math.floor(Math.random()*3));
    room.bunkerStock[type]-=amount;
    stolen[type]=(stolen[type]||0)+amount;
  }

  return stolen;
}

function spawnBunkerMob(room,type,ventId,count){
  const spawn={
    ventTop:{x:480,y:110},
    ventLeft:{x:145,y:475},
    ventBottom:{x:790,y:690}
  }[ventId]||{x:500,y:350};

  for(let i=0;i<count;i++){
    const hp=type==="rat"?42:type==="spider"?52:95;
    room.bunkerMobs.push({
      id:`bm-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      type,
      x:spawn.x+(Math.random()*50-25),
      y:spawn.y+(Math.random()*50-25),
      hp,
      maxHp:hp,
      alive:true,
      lastAttackAt:0
    });
  }
}

function clearVentThreat(room,vent){
  vent.threat=null;
  vent.stage=0;
  vent.nextStageAt=0;
  scheduleNextVentEvent(room,vent);

  io.to(room.code).emit("vent-state",{
    vents:ventPublicState(room)
  });
}

function nearestBunkerPlayer(room,x,y){
  let target=null,best=Infinity;

  for(const p of room.players.values()){
    if(!p.inBunker||(p.hp??0)<=0)continue;

    const d=Math.hypot(
      (p.bunkerX+15)-x,
      (p.bunkerY+15)-y
    );

    if(d<best){
      best=d;
      target=p;
    }
  }

  return {target,distance:best};
}

function failVentThreat(room,vent){
  if(vent.threat==="ventLady"){
    const stolen=randomStealFromBunker(room);

    const loc={
      ventTop:{x:480,y:110},
      ventLeft:{x:145,y:475},
      ventBottom:{x:790,y:690}
    }[vent.id]||{x:500,y:350};

    const nearest=nearestBunkerPlayer(room,loc.x,loc.y);

    if(nearest.target){
      nearest.target.hp=Math.max(0,(nearest.target.hp??100)-25);
    }

    io.to(room.code).emit("vent-lady-attack",{
      ventId:vent.id,
      stolen,
      victimId:nearest.target?.id||null,
      damage:25,
      bunkerStock:room.bunkerStock
    });
  }else if(vent.threat==="spider"){
    spawnBunkerMob(room,"spider",vent.id,2+Math.floor(Math.random()*2));
  }else if(vent.threat==="rats"){
    spawnBunkerMob(room,"rat",vent.id,3+Math.floor(Math.random()*2));
  }else if(vent.threat==="cameraBug"){
    spawnBunkerMob(room,"fumigator",vent.id,1);
  }

  io.to(room.code).emit(
    "bunker-mobs",
    room.bunkerMobs.filter(m=>m.alive)
  );

  clearVentThreat(room,vent);
}


const HOSPITAL_POINTS=[
  {x:870,y:150},{x:1100,y:150},{x:1430,y:150},
  {x:220,y:420},{x:220,y:760},{x:500,y:680},{x:830,y:680},
  {x:1135,y:380},{x:1135,y:700},{x:1135,y:980},
  {x:1440,y:680},{x:1740,y:680},{x:2050,y:500},{x:2050,y:860},
  {x:2100,y:1060},{x:1300,y:1200},{x:1600,y:1200},
  {x:1870,y:1320},{x:1870,y:1530},{x:1650,y:1570}
];

const HOSPITAL_GLASS=[
  {x:520,y:690,r:42},
  {x:800,y:690,r:42},
  {x:1150,y:520,r:42},
  {x:1150,y:980,r:42},
  {x:1480,y:690,r:42},
  {x:1820,y:690,r:42},
  {x:2070,y:900,r:42},
  {x:1450,y:1200,r:42},
  {x:1870,y:1510,r:42}
];

const HOSPITAL_TRIPWIRES=[
  // 왼쪽 연결 복도 전체 폭
  {x1:620,y1:610,x2:620,y2:780},

  // 중앙 세로 복도 전체 폭
  {x1:1080,y1:850,x2:1270,y2:850},

  // 오른쪽 연결 복도 전체 폭
  {x1:1590,y1:610,x2:1590,y2:780},

  // 아래 출구 복도 전체 폭
  {x1:1780,y1:1370,x2:1970,y2:1370}
];

function makeHospitalItems(){
  const points=shuffle(HOSPITAL_POINTS);
  const types=[
    "medkit","medkit","medkit","medkit","medkit","medkit","medkit","medkit",
    "water","water","water","water",
    "beans","beans","beans"
  ];

  return types.map((type,i)=>({
    id:`h-${Date.now()}-${i}-${Math.random().toString(36).slice(2,6)}`,
    type,
    slots:DEFS[type]?.slots||1,
    x:points[i].x,
    y:points[i].y,
    taken:false
  }));
}

function makeHospitalAbomination(){
  return {
    id:`hospital-abomination-${Date.now()}`,
    x:1207.5,
    y:1132.5,
    targetX:null,
    targetY:null,
    alertedUntil:0,
    lingerUntil:0,
    lastAttackAt:0,
    attackWindupUntil:0,
    attacking:false,
    attackTargetId:null,
    patrolX:1207.5,
    patrolY:1132.5,
    nextPatrolAt:0,
    state:"patrol",
    patrolPhase:"center",
    nextPatrolChoiceAt:Date.now()+10000
  };
}

function expeditionReturnPoint(room){
  return room.expeditionLocation==="hospital"
    ? {x:1897.5,y:2572.5}
    : {x:250,y:850};
}


const HOSPITAL_WALKABLE_SERVER_V26=[
  {x:720,y:80,w:980,h:180},
  {x:1080,y:220,w:190,h:900},
  {x:160,y:300,w:210,h:740},
  {x:370,y:610,w:710,h:170},
  {x:1270,y:610,w:700,h:170},
  {x:1970,y:340,w:220,h:780},
  {x:1970,y:980,w:300,h:240},
  {x:1080,y:1120,w:720,h:180},
  {x:1780,y:1120,w:190,h:520},
  {x:1560,y:1500,w:220,h:140},
  {x:1010,y:540,w:140,h:310},
  {x:1200,y:540,w:140,h:310},
  {x:1700,y:1030,w:190,h:220}
,
  {x:1660,y:1430,w:340,h:230}
];

function hospitalWalkableV26(x,y,radius=16){
  return HOSPITAL_WALKABLE_SERVER_V26.some(r=>
    x-radius>=r.x &&
    x+radius<=r.x+r.w &&
    y-radius>=r.y &&
    y+radius<=r.y+r.h
  );
}

function clampHospitalMoveV30(x,y,oldX,oldY,radius=16){
  if(hospitalWalkableV26(x,y,radius))return {x,y};
  if(hospitalWalkableV26(x,oldY,radius))return {x,y:oldY};
  if(hospitalWalkableV26(oldX,y,radius))return {x:oldX,y};
  return {x:oldX,y:oldY};
}

function chooseHospitalPatrolPointV26(){
  return pick([
    {x:1150,y:170},{x:250,y:520},{x:540,y:690},
    {x:1150,y:720},{x:1570,y:690},{x:2070,y:580},
    {x:2070,y:1020},{x:1400,y:1200},{x:1870,y:1450},
    {x:1660,y:1560}
  ]);
}

function moveHospitalAbominationV26(a,targetX,targetY,speed){
  const dx=targetX-a.x,dy=targetY-a.y;
  const dist=Math.hypot(dx,dy);
  if(dist<3)return;

  const ux=dx/(dist||1),uy=dy/(dist||1);
  const tries=[
    [ux,uy],[ux,0],[0,uy],
    [-uy,ux],[uy,-ux],
    [-uy*.65,ux*.65],[uy*.65,-ux*.65]
  ];

  for(const [mx,my] of tries){
    const n=clampHospitalMoveV30(
      a.x+mx*speed,
      a.y+my*speed,
      a.x,a.y,14
    );
    if(n.x!==a.x||n.y!==a.y){
      a.x=n.x;a.y=n.y;
      return;
    }
  }
}
const HOSPITAL_WALLS_SERVER=[
  // outer world bounds
  {x:0,y:0,w:1200,h:28},{x:0,y:932,w:1200,h:28},
  {x:0,y:0,w:28,h:960},{x:1172,y:0,w:28,h:960},

  // top wide room from sketch
  {x:360,y:55,w:430,h:22},
  {x:360,y:55,w:22,h:105},
  {x:768,y:55,w:22,h:105},

  // central vertical corridor walls
  {x:500,y:160,w:22,h:500},
  {x:590,y:160,w:22,h:500},

  // left tall wing
  {x:95,y:180,w:22,h:400},
  {x:190,y:180,w:22,h:185},
  {x:190,y:425,w:22,h:155},

  // left connector, doorway intentionally open
  {x:190,y:300,w:250,h:20},
  {x:190,y:365,w:205,h:20},
  {x:430,y:300,w:20,h:30},
  {x:430,y:355,w:20,h:30},

  // right connector
  {x:612,y:300,w:280,h:20},
  {x:612,y:365,w:280,h:20},

  // right tall wing
  {x:890,y:195,w:22,h:350},
  {x:980,y:195,w:22,h:350},

  // right lower small block
  {x:890,y:545,w:110,h:20},
  {x:978,y:545,w:22,h:120},
  {x:890,y:645,w:110,h:20},

  // lower large horizontal room
  {x:500,y:660,w:285,h:20},
  {x:500,y:735,w:285,h:20},

  // return corridor / start branch
  {x:785,y:660,w:22,h:235},
  {x:865,y:735,w:22,h:160},
  {x:720,y:830,w:65,h:22}
];

function hospitalBlockedPoint(x,y,radius=18){
  return HOSPITAL_WALLS_SERVER.some(w=>
    x+radius>w.x &&
    x-radius<w.x+w.w &&
    y+radius>w.y &&
    y-radius<w.y+w.h
  );
}

function chooseHospitalPatrolPoint(){
  return pick([
    {x:620,y:115},
    {x:535,y:240},
    {x:535,y:420},
    {x:535,y:600},
    {x:280,y:335},
    {x:740,y:335},
    {x:935,y:335},
    {x:650,y:705},
    {x:830,y:800}
  ]);
}

function moveHospitalAbomination(a,targetX,targetY,speed){
  const dx=targetX-a.x;
  const dy=targetY-a.y;
  const dist=Math.hypot(dx,dy);
  if(dist<3)return;

  const ux=dx/(dist||1),uy=dy/(dist||1);

  const tries=[
    [ux,uy],
    [ux,0],
    [0,uy],
    [-uy,ux],
    [uy,-ux],
    [-uy*.7,ux*.7],
    [uy*.7,-ux*.7]
  ];

  for(const [tx,ty] of tries){
    const nx=a.x+tx*speed;
    const ny=a.y+ty*speed;
    if(!hospitalBlockedPoint(nx,ny,16)){
      a.x=nx;
      a.y=ny;
      return;
    }
  }

  // completely stuck: choose a new open patrol point instead of clipping wall
  const pt=chooseHospitalPatrolPoint();
  a.patrolX=pt.x;
  a.patrolY=pt.y;
  a.targetX=null;
  a.targetY=null;
  a.alertedUntil=0;
}

// =========================================================
// V30 HOSPITAL COLLISION MAP
// User-provided image: white = walkable, black = blocked.
// The accidental black line next to START is explicitly opened.
// =========================================================
const HOSPITAL_V30_W=2400;
const HOSPITAL_V30_H=2820;
const HOSPITAL_V30_GRID_W=160;
const HOSPITAL_V30_GRID_H=188;
const HOSPITAL_V30_RUNS=[[],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[72,88]],[[1,19],[72,87]],[[1,19],[72,87]],[[1,19],[72,87]],[[1,19],[72,87]],[[1,19],[72,87]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[70,91],[138,157]],[[1,19],[67,91],[137,157]],[[1,20],[67,91],[137,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,93],[137,157]],[[1,20],[64,93],[137,157]],[[1,19],[67,93],[137,157]],[[1,19],[67,93],[138,157]],[[1,19],[72,93],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,158]],[[1,19],[72,87],[138,158]],[[1,19],[72,87],[138,158]],[[1,19],[72,87],[138,158]],[[1,19],[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,88],[138,158]],[[72,158]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[113,144]],[]];

function hospitalWalkableV30(x,y,radius=12){
  const pts=[
    [x-radius,y-radius],[x+radius,y-radius],
    [x-radius,y+radius],[x+radius,y+radius],
    [x,y]
  ];

  for(const [px,py] of pts){
    if(px<0||py<0||px>=HOSPITAL_V30_W||py>=HOSPITAL_V30_H)return false;
    const gx=Math.max(0,Math.min(
      HOSPITAL_V30_GRID_W-1,
      Math.floor(px/HOSPITAL_V30_W*HOSPITAL_V30_GRID_W)
    ));
    const gy=Math.max(0,Math.min(
      HOSPITAL_V30_GRID_H-1,
      Math.floor(py/HOSPITAL_V30_H*HOSPITAL_V30_GRID_H)
    ));

    const runs=HOSPITAL_V30_RUNS[gy]||[];
    let ok=false;
    for(const r of runs){
      if(gx>=r[0]&&gx<=r[1]){ok=true;break;}
    }
    if(!ok)return false;
  }

  return true;
}

function clampHospitalMoveV30(x,y,oldX,oldY,radius=12){
  if(hospitalWalkableV30(x,y,radius))return {x,y};
  if(hospitalWalkableV30(x,oldY,radius))return {x,y:oldY};
  if(hospitalWalkableV30(oldX,y,radius))return {x:oldX,y};
  return {x:oldX,y:oldY};
}
io.on("connection",s=>{
 s.on("get-public-party-list",(lobbyId,cb=()=>{})=>{
  const id=Math.max(1,Math.min(10,parseInt(lobbyId)||1));
  cb({ok:true,parties:publicPartiesForLobby(id)});
 });
 s.on("reconnect-room",(sessionId,cb=()=>{})=>reconnectRoom(s,String(sessionId||""),cb));

 s.emit("public-lobby-list",lobbyList());

 s.on("join-public-lobby",(d,cb=()=>{})=>{
  leavePublicLobby(s);

  const lobbyId=Math.max(1,Math.min(10,parseInt(d?.lobbyId)||1));
  const nickname=String(d?.nickname||"").replace(/[<>]/g,"").trim().slice(0,14);
  const color=String(d?.color||COLORS[0]).slice(0,20);

  if(!nickname)return cb({ok:false,message:"닉네임을 입력하세요."});

  const lobby=publicLobbies[lobbyId-1];
  if(lobby.players.size>=24)return cb({ok:false,message:"로비가 가득 찼습니다."});

  const p={id:s.id,nickname,color,x:500+Math.random()*250,y:400+Math.random()*180};
  lobby.players.set(s.id,p);
  socketLobby.set(s.id,lobbyId);
  s.join(`public-lobby-${lobbyId}`);

  cb({ok:true,myId:s.id,lobby:lobbyView(lobby),messages:lobby.messages.slice(-100)});
  s.to(`public-lobby-${lobbyId}`).emit("public-lobby-player-joined",p);
  emitLobbyList();
 });

 s.on("public-lobby-move",(d)=>{
  const lobbyId=socketLobby.get(s.id);
  const lobby=lobbyId?publicLobbies[lobbyId-1]:null;
  const p=lobby?.players.get(s.id);
  if(!p)return;

  const x=Number(d?.x),y=Number(d?.y);
  if(!Number.isFinite(x)||!Number.isFinite(y))return;

  p.x=Math.max(30,Math.min(1470,x));
  p.y=Math.max(30,Math.min(970,y));

  s.to(`public-lobby-${lobbyId}`).emit("public-lobby-player-moved",{id:p.id,x:p.x,y:p.y});
 });

 s.on("public-lobby-message",(text,cb=()=>{})=>{
  const lobbyId=socketLobby.get(s.id);
  const lobby=lobbyId?publicLobbies[lobbyId-1]:null;
  const p=lobby?.players.get(s.id);

  if(!lobby||!p)return cb({ok:false,message:"로비 정보가 없습니다."});

  const safe=String(text??"").replace(/[<>]/g,"").trim().slice(0,180);
  if(!safe)return cb({ok:false,message:"메시지를 입력하세요."});

  const msg={
    id:`lm-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    playerId:p.id,nickname:p.nickname,text:safe,time:Date.now()
  };

  lobby.messages.push(msg);
  if(lobby.messages.length>100)lobby.messages.splice(0,lobby.messages.length-100);

  io.to(`public-lobby-${lobbyId}`).emit("public-lobby-message",msg);
  cb({ok:true});
 });

 s.emit("room-list",list());
 s.on("create-room",(d,cb=()=>{})=>{
  const originLobbyId=socketLobby.get(s.id)||parseInt(d?.publicLobbyId)||null;
  const c=code(),p={
    id:s.id,
    nickname:String(d.nickname||"").trim().slice(0,14),
    sessionId:String(d.sessionId||""),
    ready:true,
    color:(COLORS.includes(d?.color)?d.color:COLORS[0]),
    floor:1,x:1180,y:980,hands:[],stored:[],
    bunkerX:330,bunkerY:560,inBunker:false,
    hp:100,hunger:100,thirst:100,hygiene:100,fatigue:0,sanityStat:100,
    equipped:null,facingX:1,facingY:0,lastWeaponSwingAt:0,nextHallucinationAt:0,sick:false,
    inExpedition:false,expeditionX:260,expeditionY:900
  };
  if(!p.nickname||!String(d.roomName||"").trim())return cb({ok:false,message:"입력 확인"});
  const r={
    code:c,
    publicLobbyId:originLobbyId,
    private:Boolean(d?.private),
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
    weapons:{woodenStick:1,axe:0},
    power:100,
    security:"LOCKED",
    messages:[],
    dayStartedAt:Date.now(),
    expeditionCooldownUntil:0,
    expeditionInvite:null,
    expeditionLocation:"grocery",
    hospitalAbomination:null,
    expeditionItems:[],
    vents:[
      {
        id:"ventTop",closed:false,threat:null,stage:0,nextStageAt:0,
        nextEventAt:Date.now()+VENT_MIN_DELAY_MS+Math.floor(Math.random()*(VENT_MAX_DELAY_MS-VENT_MIN_DELAY_MS))
      },
      {
        id:"ventLeft",closed:false,threat:null,stage:0,nextStageAt:0,
        nextEventAt:Date.now()+VENT_MIN_DELAY_MS+Math.floor(Math.random()*(VENT_MAX_DELAY_MS-VENT_MIN_DELAY_MS))
      },
      {
        id:"ventBottom",closed:false,threat:null,stage:0,nextStageAt:0,
        nextEventAt:Date.now()+VENT_MIN_DELAY_MS+Math.floor(Math.random()*(VENT_MAX_DELAY_MS-VENT_MIN_DELAY_MS))
      }
    ],
    bunkerMobs:[]
  };
  rooms.set(c,r);socketRoom.set(s.id,c);s.join(c);cb({ok:true,room:view(r),myId:s.id});emit(r)
 });
 s.on("join-room",(d,cb=()=>{})=>{
  const requestedLobby=parseInt(d?.publicLobbyId)||null;
  const r=rooms.get(String(d.code||"").toUpperCase());
  if(!r)return cb({ok:false,message:"방 없음"});
  if(requestedLobby && r.publicLobbyId && r.publicLobbyId!==requestedLobby){
    return cb({ok:false,message:"현재 로비의 파티가 아닙니다."});
  }
  join(s,r,d.nickname,(result)=>{ if(result?.ok)emitPublicParties(requestedLobby||r.publicLobbyId); cb(result); },d.color,d.sessionId)
 });
 s.on("toggle-ready",(cb=()=>{})=>{const r=rooms.get(socketRoom.get(s.id));if(!r)return cb({ok:false});if(r.hostId===s.id)return cb({ok:false});const p=r.players.get(s.id);p.ready=!p.ready;cb({ok:true});emit(r)});
 s.on("start-game",(cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id));if(!r)return cb({ok:false,message:"방 없음"});if(r.hostId!==s.id)return cb({ok:false,message:"방장만 가능"});
  if([...r.players.values()].some(p=>p.id!==r.hostId&&!p.ready))return cb({ok:false,message:"준비 필요"});
  r.status="playing";r.items=makeItems();r.endsAt=Date.now()+ROUND;
  let k=0;for(const p of r.players.values()){p.floor=1;p.x=1160+(k%3)*45;p.y=970+Math.floor(k/3)*45;p.hands=[];p.stored=[];p.inBunker=false;p.bunkerX=330+(k%3)*38;p.bunkerY=560+Math.floor(k/3)*38;k++}
  cb({ok:true});console.log("[GAME START]",r.code,"players:",r.players.size);
  io.to(r.code).emit("game-started",{
    endsAt:r.endsAt,
    items:r.items,
    bunker:BUNKER,
    itemDefs:DEFS,
    handLimit:LIMIT,
    day:r.day,
    dayStartedAt:r.dayStartedAt,
    dayLengthMs:DAY_LENGTH_MS,
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
    // 첫 수집 종료 후 벙커에 들어와도 DAY 1 유지
    p.inBunker=true;
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




 s.on("bunker-jump",(payload={},cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;
  if(!r||!p||!p.inBunker)return cb({ok:false,message:"벙커 안이 아닙니다."});

  const now=Date.now();
  if(p.jumping&&now<p.jumpUntil)return cb({ok:false,message:"이미 점프 중입니다."});

  p.jumping=true;
  p.jumpUntil=now+520;

  io.to(r.code).emit("bunker-player-jumped",{id:p.id,jumpUntil:p.jumpUntil});

  setTimeout(()=>{
    const room=rooms.get(r.code);
    const player=room?.players.get(p.id);
    if(player){
      player.jumping=false;
      io.to(r.code).emit("bunker-player-landed",{id:player.id});
    }
  },540);

  cb({ok:true,jumpUntil:p.jumpUntil});
 });

 s.on("bunker-move",(d)=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p||!p.inBunker)return;
  const x=Number(d?.x),y=Number(d?.y);
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  p.bunkerX=Math.max(115,Math.min(895,x));
  p.bunkerY=Math.max(75,Math.min(725,y));

  const fx=Number(d?.facingX),fy=Number(d?.facingY);
  if(Number.isFinite(fx)&&Number.isFinite(fy)&&(Math.abs(fx)+Math.abs(fy)>.05)){
    const len=Math.hypot(fx,fy)||1;
    p.facingX=fx/len;
    p.facingY=fy/len;
  }

  s.to(r.code).emit("bunker-player-moved",{
    id:p.id,
    x:p.bunkerX,
    y:p.bunkerY,
    facingX:p.facingX,
    facingY:p.facingY,
    equipped:p.equipped,
    jumping:p.jumping,
    jumpUntil:p.jumpUntil,
    nickname:p.nickname,
    color:p.color
  });
 });

 s.on("get-bunker-players",(cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id));
  if(!r)return cb({ok:false,players:[]});
  cb({
    ok:true,
    players:[...r.players.values()]
      .filter(p=>p.inBunker)
      .map(p=>({id:p.id,x:p.bunkerX,y:p.bunkerY,nickname:p.nickname,color:p.color,equipped:p.equipped,facingX:p.facingX,facingY:p.facingY}))
  });
 });


 s.on("get-messages",(cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id));
  if(!r)return cb({ok:false,messages:[],
    dayStartedAt:Date.now(),
    expeditionCooldownUntil:0,
    expeditionInvite:null,
    expeditionLocation:"grocery",
    hospitalAbomination:null,
    expeditionItems:[],
    vents:[
      {
        id:"ventTop",closed:false,threat:null,stage:0,nextStageAt:0,
        nextEventAt:Date.now()+VENT_MIN_DELAY_MS+Math.floor(Math.random()*(VENT_MAX_DELAY_MS-VENT_MIN_DELAY_MS))
      },
      {
        id:"ventLeft",closed:false,threat:null,stage:0,nextStageAt:0,
        nextEventAt:Date.now()+VENT_MIN_DELAY_MS+Math.floor(Math.random()*(VENT_MAX_DELAY_MS-VENT_MIN_DELAY_MS))
      },
      {
        id:"ventBottom",closed:false,threat:null,stage:0,nextStageAt:0,
        nextEventAt:Date.now()+VENT_MIN_DELAY_MS+Math.floor(Math.random()*(VENT_MAX_DELAY_MS-VENT_MIN_DELAY_MS))
      }
    ],
    bunkerMobs:[]});

  cb({
    ok:true,
    messages:r.messages.slice(-100)
  });
 });

 s.on("send-message",(text,cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id));
  const p=r?.players.get(s.id);

  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});

  const safe=String(text??"")
    .replace(/[<>]/g,"")
    .trim()
    .slice(0,180);

  if(!safe)return cb({ok:false,message:"메시지를 입력하세요."});

  const message={
    id:`m-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    playerId:p.id,
    nickname:p.nickname,
    text:safe,
    time:Date.now()
  };

  r.messages.push(message);

  if(r.messages.length>100){
    r.messages.splice(0,r.messages.length-100);
  }

  io.to(r.code).emit("team-message",message);
  cb({ok:true});
 });




 s.on("request-expedition",(payload={},cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});
  if(!p.inBunker)return cb({ok:false,message:"벙커 안에서만 탐사를 시작할 수 있습니다."});

  const now=Date.now();
  if(now<r.expeditionCooldownUntil){
    return cb({ok:false,message:`탐사 쿨타임 ${Math.ceil((r.expeditionCooldownUntil-now)/1000)}초`});
  }

  if(r.expeditionInvite){
    return cb({ok:false,message:"이미 탐사 모집이 진행 중입니다."});
  }

  const hasMap=(r.bunkerStock.map||0)>0;
  let location=String(payload?.location||"");

  if(hasMap){
    if(!["grocery","hospital"].includes(location))location="grocery";
  }else{
    location=pick(["grocery","hospital"]);
  }

  r.expeditionInvite={
    leaderId:s.id,
    participants:new Set([s.id]),
    declined:new Set(),
    endsAt:now+EXPEDITION_INVITE_MS,
    location
  };

  io.to(r.code).emit("expedition-invite",{
    leaderId:s.id,
    leaderName:p.nickname,
    endsAt:r.expeditionInvite.endsAt,
    location
  });

  cb({ok:true,location,random:!hasMap});

  setTimeout(()=>{
    const room=rooms.get(r.code);
    if(!room?.expeditionInvite)return;
    if(room.expeditionInvite.leaderId!==s.id)return;

    const participants=[...room.expeditionInvite.participants];
    const location=room.expeditionInvite.location||"grocery";

    room.expeditionLocation=location;
    room.expeditionItems=
      location==="hospital"
        ? makeHospitalItems()
        : makeGroceryItems();

    room.expeditionMutants=
      location==="hospital"
        ? []
        : makeMutants();

    room.hospitalAbomination=
      location==="hospital"
        ? makeHospitalAbomination()
        : null;

    const returnPoint=expeditionReturnPoint(room);
    const handLimit=(room.bunkerStock.backpack||0)>0 ? 8 : 4;
    const hasGasMask=(room.bunkerStock.mask||0)>0;
    const hasFlashlight=(room.bunkerStock.flashlight||0)>0;

    participants.forEach((id,index)=>{
      const player=room.players.get(id);
      if(!player)return;

      player.inBunker=false;
      player.inExpedition=true;
      player.expeditionX=returnPoint.x+(index%3)*38;
      player.expeditionY=returnPoint.y+Math.floor(index/3)*38;
      player.hands=[];
      player.sick=!hasGasMask;
      player.flashlightEquipped=hasFlashlight;
      player.jumping=false;
      player.jumpUntil=0;
    });

    room.expeditionCooldownUntil=Date.now()+EXPEDITION_COOLDOWN_MS;
    room.expeditionInvite=null;

    io.to(room.code).emit("expedition-started",{
      participantIds:participants,
      location,
      items:room.expeditionItems,
      mutants:room.expeditionMutants,
      hospitalAbomination:room.hospitalAbomination,
      hospitalGlass:location==="hospital"?HOSPITAL_GLASS:[],
      hospitalTripwires:location==="hospital"?HOSPITAL_TRIPWIRES:[],
      returnPoint,
      handLimit,
      hasGasMask,
      hasFlashlight,
      cooldownUntil:room.expeditionCooldownUntil
    });
  },EXPEDITION_INVITE_MS);
 });

 s.on("respond-expedition",(accept,cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p||!r.expeditionInvite)return cb({ok:false,message:"진행 중인 탐사 모집이 없습니다."});

  if(accept){
    r.expeditionInvite.participants.add(s.id);
    r.expeditionInvite.declined.delete(s.id);
  }else{
    r.expeditionInvite.declined.add(s.id);
    r.expeditionInvite.participants.delete(s.id);
  }

  io.to(r.code).emit("expedition-invite-updated",{
    participants:[...r.expeditionInvite.participants],
    declined:[...r.expeditionInvite.declined],
    endsAt:r.expeditionInvite.endsAt
  });

  cb({ok:true});
 });



 s.on("expedition-jump",(payload={},cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;

  if(!r||!p||!p.inExpedition){
    return cb({ok:false,message:"탐사 중이 아닙니다."});
  }

  const now=Date.now();
  if(p.jumping && now<p.jumpUntil){
    return cb({ok:false,message:"이미 점프 중입니다."});
  }

  p.jumping=true;
  p.jumpUntil=now+520;

  io.to(r.code).emit("expedition-player-jumped",{
    id:p.id,
    jumpUntil:p.jumpUntil
  });

  setTimeout(()=>{
    const room=rooms.get(r.code);
    const player=room?.players.get(p.id);
    if(player){
      player.jumping=false;
      io.to(r.code).emit("expedition-player-landed",{id:player.id});
    }
  },540);

  cb({ok:true,jumpUntil:p.jumpUntil});
 });

 s.on("expedition-move",(d)=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p||!p.inExpedition)return;

  const x=Number(d?.x),y=Number(d?.y);
  if(!Number.isFinite(x)||!Number.isFinite(y))return;

  const prevX=p.expeditionX,prevY=p.expeditionY;

  if(r.expeditionLocation==="hospital"){
    const n=clampHospitalMoveV30(x,y,p.expeditionX,p.expeditionY,15);
    p.expeditionX=n.x;
    p.expeditionY=n.y;
  }else{
    p.expeditionX=Math.max(35,Math.min(1165,x));
    p.expeditionY=Math.max(35,Math.min(925,y));
  }

  const fx=Number(d?.facingX),fy=Number(d?.facingY);
  if(Number.isFinite(fx)&&Number.isFinite(fy)&&(Math.abs(fx)+Math.abs(fy)>.05)){
    const len=Math.hypot(fx,fy)||1;
    p.facingX=fx/len;
    p.facingY=fy/len;
  }

  // Hospital Abomination: 감지 반경은 화면에 표시하지 않음.
  // 반경 안에서 움직이거나 함정을 밟으면 소리를 듣고 추격.
  if(r.expeditionLocation==="hospital" && r.hospitalAbomination){
    const a=r.hospitalAbomination;
    const moved=Math.hypot(p.expeditionX-prevX,p.expeditionY-prevY);
    const distance=Math.hypot(
      (p.expeditionX+15)-(a.x+18),
      (p.expeditionY+15)-(a.y+18)
    );

    const detectionRadius=250;

    if(moved>1.0 && distance<detectionRadius){
      a.targetX=p.expeditionX;
      a.targetY=p.expeditionY;
      a.alertedUntil=Date.now()+4500;
      a.state="chase";
    }

    if(!p.jumping){
      for(const g of HOSPITAL_GLASS){
        if(Math.hypot((p.expeditionX+15)-g.x,(p.expeditionY+15)-g.y)<30){
          a.targetX=p.expeditionX;
          a.targetY=p.expeditionY;
          a.alertedUntil=Date.now()+6500;
          a.state="chase";
        }
      }

      for(const w of HOSPITAL_TRIPWIRES){
        const cx=(w.x1+w.x2)/2,cy=(w.y1+w.y2)/2;
        if(Math.hypot((p.expeditionX+15)-cx,(p.expeditionY+15)-cy)<38){
          a.targetX=p.expeditionX;
          a.targetY=p.expeditionY;
          a.alertedUntil=Date.now()+7500;
          a.state="chase";
        }
      }
    }
  }

  s.to(r.code).emit("expedition-player-moved",{
    id:p.id,x:p.expeditionX,y:p.expeditionY,
    facingX:p.facingX,facingY:p.facingY,
    jumping:p.jumping,
    flashlightEquipped:p.flashlightEquipped,
    nickname:p.nickname,color:p.color
  });
 });

 s.on("take-expedition-item",(itemId,cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p||!p.inExpedition)return cb({ok:false,message:"탐사 중이 아닙니다."});

  const item=r.expeditionItems.find(i=>i.id===itemId);
  if(!item||item.taken)return cb({ok:false,message:"이미 가져간 아이템입니다."});

  const used=p.hands.reduce((sum,type)=>sum+(DEFS[type]?.slots||1),0);
  const need=DEFS[item.type]?.slots||1;
  const expeditionLimit=(r.bunkerStock.backpack||0)>0 ? 8 : 4;
  if(used+need>expeditionLimit){
    return cb({ok:false,message:`손 공간 부족 (${need}칸 필요 · ${expeditionLimit}칸)`});
  }

  if(Math.hypot((p.expeditionX+15)-item.x,(p.expeditionY+15)-item.y)>85){
    return cb({ok:false,message:"아이템과 너무 멉니다."});
  }

  item.taken=true;
  p.hands.push(item.type);

  io.to(r.code).emit("expedition-item-taken",{
    itemId:item.id,
    playerId:p.id,
    hands:p.hands
  });

  cb({ok:true,hands:p.hands});
 });


 s.on("attack-mutant",(data,cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p||!p.inExpedition)return cb({ok:false,message:"탐사 중이 아닙니다."});
  if(!p.equipped)return cb({ok:false,message:"무기를 장착하세요."});

  const weaponCooldown={
    woodenStick:700,
    axe:1100
  };

  const cooldown=weaponCooldown[p.equipped]||800;
  const now=Date.now();
  const elapsed=now-(p.lastWeaponSwingAt||0);

  if(elapsed<cooldown){
    return cb({
      ok:false,
      cooldown:true,
      remaining:cooldown-elapsed
    });
  }

  const fx=Number(data?.facingX),fy=Number(data?.facingY);
  if(Number.isFinite(fx)&&Number.isFinite(fy)&&(Math.abs(fx)+Math.abs(fy)>.05)){
    const len=Math.hypot(fx,fy)||1;
    p.facingX=fx/len;
    p.facingY=fy/len;
  }

  p.lastWeaponSwingAt=now;

  const mutant=r.expeditionMutants.find(m=>m.id===data?.mutantId);
  if(!mutant||!mutant.alive)return cb({ok:false,message:"대상이 없습니다."});

  const distance=Math.hypot(
    (p.expeditionX+15)-(mutant.x+18),
    (p.expeditionY+15)-(mutant.y+18)
  );

  if(distance>125)return cb({ok:false,message:"공격 범위 밖입니다."});

  const dx=(mutant.x+18)-(p.expeditionX+15);
  const dy=(mutant.y+18)-(p.expeditionY+15);
  const len=Math.hypot(dx,dy)||1;
  const dot=(dx/len)*(p.facingX||1)+(dy/len)*(p.facingY||0);

  if(dot<-0.18)return cb({ok:false,message:"공격 방향 밖입니다."});

  const damage=p.equipped==="axe" ? 45 : 24;
  mutant.hp=Math.max(0,mutant.hp-damage);

  if(mutant.hp<=0){
    mutant.alive=false;
  }

  io.to(r.code).emit("mutant-hit",{
    id:mutant.id,
    hp:mutant.hp,
    maxHp:mutant.maxHp,
    alive:mutant.alive,
    attackerId:p.id,
    damage
  });

  cb({
    ok:true,
    damage,
    killed:!mutant.alive,
    hp:mutant.hp,
    cooldown
  });
 });

 s.on("return-from-expedition",(d,cb=()=>{})=>{
  let r=rooms.get(socketRoom.get(s.id));
  let p=r?.players.get(s.id);

  if(!r||!p){
    const requestedCode=String(d?.roomCode||"").toUpperCase();
    const requestedRoom=rooms.get(requestedCode);

    if(requestedRoom){
      const match=[...requestedRoom.players.values()].find(player=>
        player.sessionId===String(d?.sessionId||"") ||
        player.nickname===String(d?.nickname||"")
      );

      if(match){
        const oldEntry=[...requestedRoom.players.entries()].find(([,player])=>player===match);
        const oldId=oldEntry?.[0];

        if(oldId){
          requestedRoom.players.delete(oldId);
          socketRoom.delete(oldId);
        }

        match.id=s.id;
        requestedRoom.players.set(s.id,match);
        socketRoom.set(s.id,requestedRoom.code);
        s.join(requestedRoom.code);

        if(requestedRoom.hostId===oldId)requestedRoom.hostId=s.id;

        r=requestedRoom;
        p=match;
      }
    }
  }

  if(!r||!p){
    for(const candidate of rooms.values()){
      if(candidate.players.has(s.id)){
        r=candidate;
        p=candidate.players.get(s.id);
        socketRoom.set(s.id,r.code);
        s.join(r.code);
        break;
      }
    }
  }

  if(!r||!p||!p.inExpedition)return cb({ok:false,message:"탐사 상태를 찾을 수 없습니다."});

  const returnPoint=expeditionReturnPoint(r);
  const returnDistance=Math.hypot(
    (p.expeditionX+15)-returnPoint.x,
    (p.expeditionY+15)-returnPoint.y
  );

  if(returnDistance>95){
    return cb({ok:false,message:"탐사 시작 지점으로 돌아가야 합니다."});
  }

  for(const type of p.hands){
    r.bunkerStock[type]=(r.bunkerStock[type]||0)+1;
    if(type==="axe")r.weapons.axe=(r.weapons.axe||0)+1;
  }

  p.stored.push(...p.hands);
  p.hands=[];
  p.inExpedition=false;
  p.inBunker=true;
  p.bunkerX=330;
  p.bunkerY=560;

  // 중요: 귀환 자체로 DAY는 증가하지 않음
  io.to(r.code).emit("expedition-player-left",{id:p.id});

  cb({
    ok:true,
    day:r.day,
    bunkerStock:r.bunkerStock,
    weapons:r.weapons,
    stats:{hp:p.hp,hunger:p.hunger,thirst:p.thirst,hygiene:p.hygiene,sick:p.sick},
    player:{x:p.bunkerX,y:p.bunkerY}
  });
 });

 s.on("equip-weapon",(weapon,cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});

  const allowed=new Set(["woodenStick","axe"]);
  if(!allowed.has(weapon))return cb({ok:false,message:"장착할 수 없는 무기입니다."});

  if((r.weapons[weapon]||0)<=0){
    return cb({ok:false,message:"무기고에 해당 무기가 없습니다."});
  }

  p.equipped=weapon;

  io.to(r.code).emit("player-equipped",{id:p.id,weapon});
  cb({ok:true,weapon});
 });


 s.on("sleep-in-bed",(payload,cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;

  if(!r||!p)return cb({ok:false,message:"방 정보를 찾을 수 없습니다."});
  if(!p.inBunker)return cb({ok:false,message:"벙커 안에서만 잘 수 있습니다."});

  p.fatigue=0;
  p.sanityStat=100;
  p.hp=Math.min(100,(p.hp??100)+10);
  p.hunger=Math.max(0,(p.hunger??100)-8);
  p.thirst=Math.max(0,(p.thirst??100)-10);
  p.nextHallucinationAt=Date.now()+60000;

  cb({
    ok:true,
    stats:{
      hp:p.hp,
      hunger:p.hunger,
      thirst:p.thirst,
      hygiene:p.hygiene,
      fatigue:p.fatigue,
      sanityStat:p.sanityStat
    }
  });
 });

 s.on("get-vent-state",(payload,cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room;

  if(!r)return cb({ok:false,message:"방 정보를 찾을 수 없습니다."});

  cb({
    ok:true,
    vents:ventPublicState(r),
    bunkerMobs:(r.bunkerMobs||[]).filter(m=>m.alive)
  });
 });

 s.on("vent-action",(payload,cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;

  if(!r||!p)return cb({ok:false,message:"방 정보를 찾을 수 없습니다."});
  if(!p.inBunker)return cb({ok:false,message:"벙커 안에서만 가능합니다."});

  const vent=(r.vents||[]).find(v=>v.id===payload?.ventId);
  if(!vent)return cb({ok:false,message:"환풍구가 없습니다."});

  const action=payload?.action;

  if(action==="toggle"){
    vent.closed=!vent.closed;

    // 위협이 있을 때 닫아도 즉시 사라지지 않는다.
    // 다음 단계 전환 시점에 차단 성공으로 처리한다.
    io.to(r.code).emit("vent-state",{
      vents:ventPublicState(r)
    });

    return cb({ok:true,closed:vent.closed});
  }

  if(!vent.threat){
    return cb({ok:false,message:"현재 이 환풍구에는 위협이 없습니다."});
  }

  if(action==="spray"){
    if(!["spider","cameraBug"].includes(vent.threat)){
      return cb({ok:false,message:"스프레이로 처리할 수 없는 위협입니다."});
    }

    if((r.bunkerStock.spray||0)<=0){
      return cb({ok:false,message:"버그 스프레이가 없습니다."});
    }

    r.bunkerStock.spray-=1;
    clearVentThreat(r,vent);

    io.to(r.code).emit("bunker-state",{
      bunkerStock:r.bunkerStock
    });

    return cb({ok:true,message:"스프레이로 처리했습니다."});
  }

  if(action==="trap"){
    if(vent.threat!=="rats"){
      return cb({ok:false,message:"쥐덫으로 처리할 수 없는 위협입니다."});
    }

    if((r.bunkerStock.trap||0)<=0){
      return cb({ok:false,message:"쥐덫이 없습니다."});
    }

    r.bunkerStock.trap-=1;
    clearVentThreat(r,vent);

    io.to(r.code).emit("bunker-state",{
      bunkerStock:r.bunkerStock
    });

    return cb({ok:true,message:"쥐덫으로 처리했습니다."});
  }

  cb({ok:false,message:"알 수 없는 행동입니다."});
 });

 s.on("swing-weapon",(payload={},cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;

  if(!r||!p||!p.equipped){
    return cb({ok:false,message:"장착한 무기가 없습니다."});
  }

  const weaponCooldown={
    woodenStick:700,
    axe:1100
  };

  const cooldown=weaponCooldown[p.equipped]||800;
  const now=Date.now();
  const elapsed=now-(p.lastWeaponSwingAt||0);

  if(elapsed<cooldown){
    return cb({
      ok:false,
      cooldown:true,
      remaining:cooldown-elapsed
    });
  }

  p.lastWeaponSwingAt=now;

  const fx=Number(payload?.facingX),fy=Number(payload?.facingY);
  if(Number.isFinite(fx)&&Number.isFinite(fy)&&(Math.abs(fx)+Math.abs(fy)>.05)){
    const len=Math.hypot(fx,fy)||1;
    p.facingX=fx/len;
    p.facingY=fy/len;
  }

  const damage=p.equipped==="axe"?45:24;

  if(p.inBunker){
    let best=null,bestDist=125;

    for(const mob of r.bunkerMobs||[]){
      if(!mob.alive)continue;

      const dx=(mob.x+16)-(p.bunkerX+15);
      const dy=(mob.y+16)-(p.bunkerY+15);
      const dist=Math.hypot(dx,dy);

      if(dist<=0||dist>bestDist)continue;

      const dot=(dx/dist)*(p.facingX||1)+(dy/dist)*(p.facingY||0);
      if(dot<-0.18)continue;

      best=mob;
      bestDist=dist;
    }

    if(best){
      best.hp=Math.max(0,best.hp-damage);
      if(best.hp<=0)best.alive=false;

      io.to(r.code).emit("bunker-mob-hit",{
        id:best.id,
        hp:best.hp,
        maxHp:best.maxHp,
        alive:best.alive,
        damage,
        attackerId:p.id
      });
    }
  }

  io.to(r.code).emit("weapon-swung",{
    id:p.id,
    weapon:p.equipped,
    time:Date.now(),
    cooldown,
    facingX:p.facingX,
    facingY:p.facingY
  });

  cb({ok:true});
 });

 s.on("consume-bunker-item",(payload,cb=()=>{})=>{
  const type=typeof payload==="string"?payload:payload?.type;
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보를 복구하지 못했습니다."});

  const consumable=new Set(["water","beans","medkit","soap"]);
  if(!consumable.has(type))return cb({ok:false,message:"사용할 수 없는 물품입니다."});

  const count=r.bunkerStock[type]||0;
  if(count<=0)return cb({ok:false,message:"재고가 없습니다."});

  r.bunkerStock[type]=count-1;

  if(type==="water")p.thirst=Math.min(100,(p.thirst??100)+70);
  if(type==="beans")p.hunger=Math.min(100,(p.hunger??100)+50);
  if(type==="medkit")p.hp=100;
  if(type==="soap"){
    p.hygiene=100;
    p.sick=false;
  }

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

  cb({
    ok:true,
    type,
    bunkerStock:r.bunkerStock,
    stats:{hp:p.hp,hunger:p.hunger,thirst:p.thirst,hygiene:p.hygiene,sick:p.sick}
  });
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
 s.on("leave-room",(cb=()=>{})=>{leave(s);cb({ok:true})});s.on("disconnect",()=>{leavePublicLobby(s);scheduleRoomDisconnect(s)})
});



// =========================================================
// 지속 스탯: DAY와 무관하게 계속 감소
// =========================================================
setInterval(()=>{
  for(const r of rooms.values()){
    for(const p of r.players.values()){
      if(!p.inBunker || (p.hp??0)<=0)continue;

      p.hunger=Math.max(0,(p.hunger??100)-2);
      p.thirst=Math.max(0,(p.thirst??100)-3);
      p.hygiene=Math.max(0,(p.hygiene??100)-1);
      p.fatigue=Math.min(100,(p.fatigue??0)+2);

      // 피로가 높아질수록 정신 안정도도 서서히 감소
      if(p.fatigue>=60){
        p.sanityStat=Math.max(0,(p.sanityStat??100)-2);
      }

      io.to(p.id).emit("personal-stats",{
        hp:p.hp,
        hunger:p.hunger,
        thirst:p.thirst,
        hygiene:p.hygiene,
        fatigue:p.fatigue,
        sanityStat:p.sanityStat
      });
    }
  }
},STAT_TICK_MS);

// 스탯이 위험하면 DAY 변경과 무관하게 지속 피해
setInterval(()=>{
  for(const r of rooms.values()){
    const closedVents=(r.vents||[]).filter(v=>v.closed).length;

    for(const p of r.players.values()){
      if(!p.inBunker || (p.hp??0)<=0)continue;

      let damage=0;

      if((p.hunger??100)<=0)damage+=4;
      if((p.thirst??100)<=0)damage+=6;
      if((p.hygiene??100)<=0)damage+=2;

      // 원작 벤트 산소 규칙: 2개 이상 닫으면 산소 부족
      if(closedVents>=2)damage+=5;

      if(damage>0){
        p.hp=Math.max(0,p.hp-damage);

        io.to(r.code).emit("bunker-player-damaged",{
          id:p.id,
          hp:p.hp,
          damage,
          reason:closedVents>=2?"산소/생존 스탯 위험":"생존 스탯 위험"
        });
      }

      // 오래 안 자면 개인 Hallucination
      const hallucinationReady=
        (p.fatigue??0)>=80 ||
        (p.sanityStat??100)<=35;

      if(
        hallucinationReady &&
        Date.now()>=(p.nextHallucinationAt||0) &&
        Math.random()<0.20
      ){
        p.nextHallucinationAt=Date.now()+45000;

        io.to(p.id).emit("hallucination-spawn",{
          damage:8+Math.floor(Math.random()*6)
        });
      }
    }
  }
},DAMAGE_TICK_MS);

// =========================================================
// 랜덤 벤트 사건
// 세 환풍구는 서로 완전히 독립적으로 이벤트를 생성한다.
// 최대 3개 환풍구에 동시에 3개 이벤트가 존재할 수 있음.
// =========================================================
setInterval(()=>{
  const now=Date.now();

  for(const r of rooms.values()){
    if(r.status!=="playing")continue;

    const bunkerPlayers=[...r.players.values()]
      .filter(p=>p.inBunker&&(p.hp??0)>0);

    if(!bunkerPlayers.length)continue;

    for(const vent of r.vents||[]){
      // 위협이 없으면 이 환풍구 전용 타이머로 새 이벤트 발생
      if(!vent.threat){
        if(!vent.nextEventAt){
          scheduleNextVentEvent(r,vent);
        }

        if(now>=vent.nextEventAt){
          vent.threat=pick(["ventLady","spider","rats","cameraBug"]);
          vent.stage=1; // 멀리
          vent.nextStageAt=now+VENT_STAGE_MS;
          vent.nextEventAt=0;

          io.to(r.code).emit("vent-threat",{
            ventId:vent.id,
            threat:vent.threat,
            stage:vent.stage
          });

          io.to(r.code).emit("vent-state",{
            vents:ventPublicState(r)
          });
        }

        continue;
      }

      // 멀리 -> 중간, 중간 -> 가까움은 벤트를 닫아도 계속 진행한다.
      if(now<vent.nextStageAt)continue;

      if(vent.stage<3){
        vent.stage+=1;
        vent.nextStageAt=now+VENT_STAGE_MS;

        io.to(r.code).emit("vent-threat",{
          ventId:vent.id,
          threat:vent.threat,
          stage:vent.stage
        });

        io.to(r.code).emit("vent-state",{
          vents:ventPublicState(r)
        });

        continue;
      }

      // 오직 가까움 -> 침입 시점에서만 닫힘 여부 판정
      if(vent.stage===3){
        if(vent.closed){
          // 침입 직전 차단 성공
          clearVentThreat(r,vent);
        }else{
          // 실제 벙커 침입
          failVentThreat(r,vent);
        }
      }
    }
  }
},1000);

// =========================================================
// 벙커 내부 Spider / Rat / Fumigator AI
// =========================================================
setInterval(()=>{
  const now=Date.now();

  for(const r of rooms.values()){
    const players=[...r.players.values()]
      .filter(p=>p.inBunker&&(p.hp??0)>0);

    if(!players.length)continue;

    for(const mob of r.bunkerMobs||[]){
      if(!mob.alive)continue;

      const nearest=nearestBunkerPlayer(r,mob.x+16,mob.y+16);
      const target=nearest.target;
      const dist=nearest.distance;

      if(!target)continue;

      const speed=
        mob.type==="rat"?7:
        mob.type==="spider"?6:
        5;

      if(dist>42){
        const dx=(target.bunkerX-mob.x)/(dist||1);
        const dy=(target.bunkerY-mob.y)/(dist||1);
        mob.x=Math.max(120,Math.min(900,mob.x+dx*speed));
        mob.y=Math.max(80,Math.min(730,mob.y+dy*speed));
      }

      if(dist<=48 && now-mob.lastAttackAt>=1000){
        mob.lastAttackAt=now;

        const damage=
          mob.type==="rat"?7:
          mob.type==="spider"?9:
          14;

        target.hp=Math.max(0,target.hp-damage);

        io.to(r.code).emit("bunker-player-damaged",{
          id:target.id,
          hp:target.hp,
          damage,
          reason:mob.type
        });
      }

      io.to(r.code).emit("bunker-mob-moved",{
        id:mob.id,
        type:mob.type,
        x:mob.x,
        y:mob.y,
        hp:mob.hp,
        maxHp:mob.maxHp,
        alive:mob.alive
      });
    }

    r.bunkerMobs=r.bunkerMobs.filter(m=>m.alive);
  }
},150);


// =========================================================
// 탐사 sickness 지속 피해
// =========================================================
setInterval(()=>{
  for(const r of rooms.values()){
    for(const p of r.players.values()){
      if(!p.inExpedition || !p.sick || (p.hp??0)<=0)continue;

      p.hp=Math.max(0,(p.hp??100)-3);

      io.to(r.code).emit("explorer-damaged",{
        playerId:p.id,
        hp:p.hp,
        damage:3,
        reason:"sickness"
      });
    }
  }
},5000);

// =========================================================

const HOSPITAL_PATROL_CENTER_V28={x:1150,y:700};

const HOSPITAL_PATROL_ENDS_V28=[
  {id:"left",x:292.5,y:1072.5},
  {id:"top",x:1207.5,y:232.5},
  {id:"right",x:2122.5,y:1072.5}
];

function hospitalPatrolDestinationV28(a){
  if(a.patrolPhase!=="end"){
    const target=pick(HOSPITAL_PATROL_ENDS_V28);
    a.patrolPhase="end";
    return {x:target.x,y:target.y,id:target.id};
  }

  a.patrolPhase="center";
  return {
    x:HOSPITAL_PATROL_CENTER_V28.x,
    y:HOSPITAL_PATROL_CENTER_V28.y,
    id:"center"
  };
}

// Hospital Abomination AI
// 평상시 중앙 -> 끝 -> 중앙 순찰.
// 몸이 닿는 것만으로는 피해 없음.
// 움직임/함정 소리를 감지하여 chase 상태가 된 경우에만 공격 가능.
// 가까워지면 공격 모션(약 0.55초)을 먼저 시작하고,
// 모션이 끝나는 순간 공격 범위 안에 있으면 즉사.
// =========================================================
setInterval(()=>{
  const now=Date.now();

  for(const r of rooms.values()){
    if(r.expeditionLocation!=="hospital")continue;

    const a=r.hospitalAbomination;
    if(!a)continue;

    const explorers=[...r.players.values()]
      .filter(p=>p.inExpedition&&(p.hp??0)>0);

    if(!explorers.length)continue;

    const chasing=
      a.targetX!=null &&
      a.targetY!=null &&
      now<=a.alertedUntil;

    if(chasing){
      a.state="chase";

      // 공격 모션 중에는 움직이지 않음.
      if(!a.attacking){
        moveHospitalAbominationV26(
          a,
          a.targetX,
          a.targetY,
          22
        );
      }

      // 현재 가장 가까운 살아있는 탐사자
      let nearest=null;
      let nearestDist=Infinity;

      for(const p of explorers){
        const d=Math.hypot(
          (p.expeditionX+15)-(a.x+18),
          (p.expeditionY+15)-(a.y+18)
        );

        if(d<nearestDist){
          nearestDist=d;
          nearest=p;
        }
      }

      // 단순 접촉은 죽지 않음.
      // chase 중이고 사거리 안이면 공격 동작을 먼저 시작.
      if(
        nearest &&
        nearestDist<74 &&
        !a.attacking &&
        now-(a.lastAttackAt||0)>=1200
      ){
        a.attacking=true;
        a.attackTargetId=nearest.id;
        a.attackWindupUntil=now+550;
        a.lastAttackAt=now;

        io.to(r.code).emit("hospital-abomination-attack",{
          x:a.x,
          y:a.y,
          targetId:nearest.id,
          attackEndsAt:a.attackWindupUntil
        });
      }

      // 공격 모션 종료 시 실제 판정
      if(a.attacking && now>=a.attackWindupUntil){
        const target=r.players.get(a.attackTargetId);
        a.attacking=false;
        a.attackTargetId=null;

        if(target && target.inExpedition && (target.hp??0)>0){
          const hitDist=Math.hypot(
            (target.expeditionX+15)-(a.x+18),
            (target.expeditionY+15)-(a.y+18)
          );

          if(hitDist<82){
            target.hp=0;

            io.to(r.code).emit("explorer-damaged",{
              playerId:target.id,
              hp:0,
              damage:999,
              reason:"hospitalAbomination"
            });
          }
        }
      }
    }else{
      // 추격이 끝나면 공격 중 상태도 해제
      a.state="patrol";
      a.targetX=null;
      a.targetY=null;
      a.attacking=false;
      a.attackTargetId=null;

      if(a.patrolX==null||a.patrolY==null){
        a.patrolX=HOSPITAL_PATROL_CENTER_V28.x;
        a.patrolY=HOSPITAL_PATROL_CENTER_V28.y;
        a.nextPatrolChoiceAt=now+10000;
        a.patrolPhase="center";
      }

      const reached=Math.hypot(
        a.patrolX-a.x,
        a.patrolY-a.y
      )<28;

      if(reached && now>=(a.nextPatrolChoiceAt||0)){
        const next=hospitalPatrolDestinationV28(a);
        a.patrolX=next.x;
        a.patrolY=next.y;
        a.nextPatrolChoiceAt=now+10000;
      }

      moveHospitalAbominationV26(
        a,
        a.patrolX,
        a.patrolY,
        3.2
      );
    }

    io.to(r.code).emit("hospital-abomination-moved",{
      x:a.x,
      y:a.y,
      alerted:a.state==="chase",
      state:a.state,
      attacking:!!a.attacking,
      attackWindupUntil:a.attackWindupUntil||0,
      patrolPhase:a.patrolPhase
    });
  }
},120);

// =========================================================
// 탐사 돌연변이 AI
// =========================================================
setInterval(()=>{
  const now=Date.now();

  for(const r of rooms.values()){
    const explorers=[...r.players.values()].filter(p=>p.inExpedition && (p.hp??100)>0);
    if(!explorers.length)continue;

    for(const mutant of r.expeditionMutants||[]){
      if(!mutant.alive)continue;

      let target=null;
      let best=Infinity;

      for(const p of explorers){
        const d=Math.hypot(
          (p.expeditionX+15)-(mutant.x+18),
          (p.expeditionY+15)-(mutant.y+18)
        );

        if(d<best){
          best=d;
          target=p;
        }
      }

      // 390px 안으로 들어오면 추적
      if(target && best<=390){
        mutant.targetId=target.id;

        // 플레이어 방향으로 이동
        if(best>45){
          const dx=(target.expeditionX-mutant.x)/best;
          const dy=(target.expeditionY-mutant.y)/best;

          mutant.x=Math.max(35,Math.min(1125,mutant.x+dx*10));
          mutant.y=Math.max(35,Math.min(885,mutant.y+dy*10));
        }

        // 근접 공격
        if(best<=52 && now-mutant.lastAttackAt>=900){
          mutant.lastAttackAt=now;
          target.hp=Math.max(0,(target.hp??100)-12);

          io.to(r.code).emit("explorer-damaged",{
            playerId:target.id,
            hp:target.hp,
            mutantId:mutant.id,
            damage:12
          });
        }
      }else{
        mutant.targetId=null;
      }

      io.to(r.code).emit("mutant-moved",{
        id:mutant.id,
        x:mutant.x,
        y:mutant.y,
        hp:mutant.hp,
        alive:mutant.alive,
        targetId:mutant.targetId
      });
    }
  }
},120);

// =========================================================
// 서버 기준 DAY 시계
// =========================================================
setInterval(()=>{
  const now=Date.now();

  for(const r of rooms.values()){
    const elapsed=now-r.dayStartedAt;

    if(elapsed<DAY_LENGTH_MS)continue;

    const passed=Math.floor(elapsed/DAY_LENGTH_MS);

    r.day+=passed;
    r.dayStartedAt+=passed*DAY_LENGTH_MS;

    io.to(r.code).emit("day-changed",{
      day:r.day,
      dayStartedAt:r.dayStartedAt,
      dayLengthMs:DAY_LENGTH_MS,
      players:[...r.players.values()].map(p=>({
        id:p.id,
        hp:p.hp,
        hunger:p.hunger,
        thirst:p.thirst,
        hygiene:p.hygiene,
        fatigue:p.fatigue,
        sanityStat:p.sanityStat
      }))
    });
  }
},1000);

server.listen(process.env.PORT||3000,"0.0.0.0");
