"use strict";
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const http=require("http");
const express=require("express");
const {Server}=require("socket.io");
const {Pool}=require("pg");
const app=express(), server=http.createServer(app), io=new Server(server,{
  pingInterval:25000,
  pingTimeout:30000,
  upgradeTimeout:15000,
  connectionStateRecovery:{
    maxDisconnectionDuration:10*60*1000,
    skipMiddlewares:false
  }
});
app.use(express.static(path.join(__dirname,"public")));
app.get("/",(req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"));
});
app.get("/healthz",(req,res)=>{
  res.status(200).json({ok:true,version:"37.2.9",rooms:rooms?.size??0});
});


const rooms=new Map(), socketRoom=new Map();

server.keepAliveTimeout=120000;
server.headersTimeout=125000;
server.requestTimeout=0;

function safeInterval(fn,ms,label="interval"){
  return globalThis.setInterval(()=>{
    try{
      const result=fn();
      if(result && typeof result.catch==="function"){
        result.catch(err=>console.error(`[SAFE ${label}] async error`,err?.stack||err));
      }
    }catch(err){
      console.error(`[SAFE ${label}] error`,err?.stack||err);
    }
  },ms);
}

process.on("unhandledRejection",err=>{
  console.error("[UNHANDLED REJECTION]",err?.stack||err);
});
process.on("uncaughtException",err=>{
  console.error("[UNCAUGHT EXCEPTION]",err?.stack||err);
});
io.engine.on("connection_error",err=>{
  console.error("[ENGINE CONNECTION ERROR]",err?.code,err?.message,err?.context||"");
});


// =========================================================
// VERSION 31 - NEON POSTGRES ACCOUNT SYSTEM
// =========================================================
const V30_EVENT_ACTIVE=true,V30_EVENT_POINTS=100000,NAME_CHANGE_COST=1000;
const ADMIN_ACCOUNT_ID="rjsdncjswo1004";
const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:5});
const socketAccounts=new Map();

async function initDatabase(){
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL missing");
 await db.query(`CREATE TABLE IF NOT EXISTS accounts(
  account_id VARCHAR(24) PRIMARY KEY,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,
  display_name VARCHAR(14) NOT NULL,sanity_points BIGINT NOT NULL DEFAULT 0,
  rainbow_unlocked BOOLEAN NOT NULL DEFAULT FALSE,v30_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  admin_god_mode BOOLEAN NOT NULL DEFAULT FALSE,admin_full_bright BOOLEAN NOT NULL DEFAULT FALSE,
  login_token TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_login_at TIMESTAMPTZ)`);
 await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_login_token_idx ON accounts(login_token) WHERE login_token IS NOT NULL`);
 console.log("[AFTERGLOW V37.3.0] Neon DB ready");
}
function safeAccountId(v){return String(v||"").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,24)}
function safeDisplayName(v){return String(v||"").replace(/[<>]/g,"").trim().slice(0,14)}
function hashPassword(p,s){return crypto.scryptSync(String(p||""),s,64).toString("hex")}
function makeToken(){return crypto.randomBytes(32).toString("hex")}
function rowToAccount(r){return r?{id:r.account_id,passwordHash:r.password_hash,passwordSalt:r.password_salt,displayName:r.display_name,sanityPoints:Number(r.sanity_points||0),rainbowUnlocked:!!r.rainbow_unlocked,v30Claimed:!!r.v30_claimed,adminGodMode:!!r.admin_god_mode,adminFullBright:!!r.admin_full_bright,loginToken:r.login_token||""}:null}
function accountView(a){return {accountId:a.id,displayName:a.displayName,sanityPoints:a.sanityPoints,rainbowUnlocked:!!a.rainbowUnlocked,v30Claimed:!!a.v30Claimed,eventActive:V30_EVENT_ACTIVE,nameChangeCost:NAME_CHANGE_COST,isAdmin:a.id===ADMIN_ACCOUNT_ID,adminGodMode:a.id===ADMIN_ACCOUNT_ID&&!!a.adminGodMode,adminFullBright:a.id===ADMIN_ACCOUNT_ID&&!!a.adminFullBright}}
async function getAccountById(id){const r=await db.query("SELECT * FROM accounts WHERE account_id=$1 LIMIT 1",[safeAccountId(id)]);return rowToAccount(r.rows[0])}
async function getAccountByToken(t){if(!t)return null;const r=await db.query("SELECT * FROM accounts WHERE login_token=$1 LIMIT 1",[String(t)]);return rowToAccount(r.rows[0])}
function bindSocketAccount(s,a){if(s&&a)socketAccounts.set(s.id,a.id)}
async function accountFromSocketOrToken(s,t){const id=socketAccounts.get(s?.id);if(id){const a=await getAccountById(id);if(a)return a}const a=await getAccountByToken(t);if(a)bindSocketAccount(s,a);return a}
async function updateAccount(id,patch){const map={displayName:"display_name",sanityPoints:"sanity_points",rainbowUnlocked:"rainbow_unlocked",v30Claimed:"v30_claimed",adminGodMode:"admin_god_mode",adminFullBright:"admin_full_bright",loginToken:"login_token"};const sets=[],vals=[];let i=1;for(const[k,v]of Object.entries(patch)){if(map[k]){sets.push(`${map[k]}=$${i++}`);vals.push(v)}}if(sets.length){vals.push(id);await db.query(`UPDATE accounts SET ${sets.join(",")} WHERE account_id=$${i}`,vals)}return getAccountById(id)}
function syncAccountToOnlinePlayers(a){for(const room of rooms.values())for(const p of room.players.values())if(p.accountId===a.id){p.nickname=a.displayName;p.sanityPoints=a.sanityPoints;p.rainbowUnlocked=a.rainbowUnlocked;p.adminGodMode=!!a.adminGodMode;p.adminFullBright=!!a.adminFullBright}for(const lobby of publicLobbies)for(const p of lobby.players.values())if(p.accountId===a.id){p.nickname=a.displayName;p.sanityPoints=a.sanityPoints;p.rainbowUnlocked=a.rainbowUnlocked;p.adminGodMode=!!a.adminGodMode;p.adminFullBright=!!a.adminFullBright}}
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
function view(r){return {code:r.code,name:r.name,publicLobbyId:r.publicLobbyId,private:r.private,maxPlayers:r.maxPlayers,hostId:r.hostId,status:r.status,players:[...r.players.values()].map(p=>({id:p.id,nickname:p.nickname,ready:p.ready,color:p.color,sanityPoints:p.sanityPoints||0,rainbowUnlocked:!!p.rainbowUnlocked,accountId:p.accountId||""}))}}
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
async function join(s,r,name,cb,preferredColor,preferredSessionId,token){
 if(r.status!=="waiting")return cb({ok:false,message:"이미 시작됨"});
 if(r.players.size>=r.maxPlayers)return cb({ok:false,message:"방이 가득 참"});
 name=String(name||"").trim().slice(0,14);if(!name)return cb({ok:false,message:"닉네임 입력"});
 const account=await accountFromSocketOrToken(s,token);
 if(!account)return cb({ok:false,message:"로그인이 필요합니다."});
 name=account.displayName;

 const used=new Set([...r.players.values()].map(p=>p.color));
 let color=String(preferredColor||"");

 if(color==="rainbow"){
   if(!account.rainbowUnlocked)color="";
 }else if(!COLORS.includes(color)){
   color="";
 }

 // 무지개는 중복 허용. 일반 색은 가능하면 중복 피함.
 if(!color){
   color=COLORS.find(c=>!used.has(c))||pick(COLORS);
 }

 const p={id:s.id,nickname:name,sessionId:String(preferredSessionId||""),ready:false,color,
   accountId:account.id,sanityPoints:account.sanityPoints,rainbowUnlocked:account.rainbowUnlocked,
   floor:1,x:1180,y:980,hands:[],stored:[],bunkerX:330,bunkerY:560,inBunker:false,
   hp:100,hunger:100,thirst:100,hygiene:100,fatigue:0,sanityStat:100,equipped:null,
   facingX:1,facingY:0,lastWeaponSwingAt:0,nextHallucinationAt:0,sick:false,jumping:false,
   jumpUntil:0,flashlightEquipped:false,inExpedition:false,expeditionX:260,expeditionY:900};

 r.players.set(s.id,p);
 socketRoom.set(s.id,r.code);
 s.join(r.code);
 cb({ok:true,room:view(r),myId:s.id,account:accountView(account)});
 emit(r)
}



// =========================================================
// VERSION 32 SURVIVAL SYSTEMS
// =========================================================
const V32_POWER_TICK_MS=30000;
const V32_FIREWALL_TICK_MS=45000;
const V32_SLEEP_MS=9000;

function v32PublicState(r){
  return {
    power:Math.max(0,Math.min(100,Number(r.power??100))),
    firewall:Math.max(0,Math.min(6,Number(r.firewall??6))),
    hacked:!!r.hacked,
    blackout:!!r.blackout,
    doorDefense:r.doorDefense??100,
    doorBreached:!!r.doorBreached,
    cctvOutsideEnabled:r.cctvOutsideEnabled!==false,
    batteryCount:Number(r.bunkerStock?.battery||0),
    bounty:r.bounty||0,
    bountyLevel:r.bountyLevel||1
  };
}

function v32EmitState(r){
  io.to(r.code).emit("v32-system-state",v32PublicState(r));
}

function spawnBountyHunterV32(r){
  if((r.bunkerMobs||[]).some(m=>m.alive&&m.type==="bountyHunter"))return false;
  const level=Math.max(1,r.bountyLevel||1);
  const hp=Math.round(140*Math.pow(1.18,level-1)); // 일반 돌연변이 70의 2배부터 시작
  r.bunkerMobs.push({
    id:`bounty-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    type:"bountyHunter",
    x:860,y:680,
    hp,maxHp:hp,alive:true,lastAttackAt:0,
    damage:14+Math.floor((level-1)*1.5),
    speed:1.7+Math.min(1.2,(level-1)*.08),
    bountyLevel:level
  });
  r.bounty=0;
  r.bountyLevel=level+1;
  io.to(r.code).emit("bounty-hunter-arrived",{
    level,hp,damage:14+Math.floor((level-1)*1.5)
  });
  io.to(r.code).emit("bunker-mobs",r.bunkerMobs.filter(m=>m.alive));
  v32EmitState(r);
  return true;
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
   "beans","beans","beans",
   "water","water","water",
   "soap","tape",
   "battery",
   "medkit"
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

  const graceMs=room.status==="playing" ? 10*60*1000 : 60*1000;

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
      if(currentRoom.status==="playing"){
        currentRoom.emptySince=Date.now();
        return;
      }
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
  },graceMs);

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
  if(room&&player)return {room,player,recovered:false};

  const sessionId=String(data?.sessionId||"");
  const roomCode=String(data?.roomCode||"").toUpperCase();
  const nickname=String(data?.nickname||"");

  // 로그인된 계정 ID는 Socket reconnect 후에도 가장 신뢰할 수 있는 복구 키.
  const socketAccount=socketAccounts.get(socket.id);
  const accountId=String(
    data?.accountId ||
    socketAccount ||
    socketAccount?.accountId ||
    socketAccount?.id ||
    ""
  );

  const candidates=[];
  if(roomCode&&rooms.has(roomCode))candidates.push(rooms.get(roomCode));
  for(const r of rooms.values()){
    if(!candidates.includes(r))candidates.push(r);
  }

  for(const candidate of candidates){
    const entry=[...candidate.players.entries()].find(([,p])=>
      (sessionId && p.sessionId===sessionId) ||
      (accountId && p.accountId===accountId) ||
      (nickname && p.nickname===nickname)
    );

    if(!entry)continue;

    const [oldId,p]=entry;

    // reconnect grace timer가 남아 있으면 즉시 취소
    if(p.sessionId && pendingDisconnects.has(p.sessionId)){
      clearTimeout(pendingDisconnects.get(p.sessionId));
      pendingDisconnects.delete(p.sessionId);
    }

    if(oldId!==socket.id){
      candidate.players.delete(oldId);
      socketRoom.delete(oldId);

      p.id=socket.id;
      candidate.players.set(socket.id,p);

      if(candidate.hostId===oldId){
        candidate.hostId=socket.id;
      }

      io.to(candidate.code).emit("bunker-player-left",{id:oldId});
    }

    socketRoom.set(socket.id,candidate.code);
    socket.join(candidate.code);

    return {room:candidate,player:p,recovered:true};
  }

  return {room:null,player:null,recovered:false};
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
    ventTop:{x:565,y:120},
    ventLeft:{x:165,y:650},
    ventBottom:{x:785,y:690}
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
      ventTop:{x:565,y:120},
      ventLeft:{x:165,y:650},
      ventBottom:{x:785,y:690}
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
  {x1:620,y1:610,x2:620,y2:780},
  {x1:1080,y1:850,x2:1270,y2:850},
  {x1:1590,y1:610,x2:1590,y2:780},
  {x1:1780,y1:1370,x2:1970,y2:1370},

  // V36.1 추가 함정
  {x1:430,y1:610,x2:430,y2:780},
  {x1:850,y1:610,x2:850,y2:780},
  {x1:1320,y1:610,x2:1320,y2:780},
  {x1:1840,y1:610,x2:1840,y2:780},
  {x1:1080,y1:1040,x2:1270,y2:1040},
  {x1:1780,y1:1220,x2:1970,y2:1220}
];

function makeHospitalItems(){
  const points=shuffle(HOSPITAL_POINTS).filter(p=>hospitalWalkableV26(p.x,p.y,8));
  const types=[
    "medkit","medkit","medkit","medkit","medkit","medkit",
    "water","water","water","water",
    "beans","beans","beans",
    "battery","battery",
    "tape","tape",
    "toolbox",
    "flashlight",
    "mask"
  ];

  return types.slice(0,points.length).map((type,i)=>({
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
    chaseTargetId:null,
    investigateUntil:0,
    investigateX:null,
    investigateY:null,
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

 s.on("register-account",async(d={},cb=()=>{})=>{try{const id=safeAccountId(d.accountId),pw=String(d.password||""),name=safeDisplayName(d.displayName);if(id.length<4)return cb({ok:false,message:"아이디는 4자 이상이어야 합니다."});if(pw.length<6)return cb({ok:false,message:"비밀번호는 6자 이상이어야 합니다."});if(!name)return cb({ok:false,message:"이름을 입력하세요."});if(await getAccountById(id))return cb({ok:false,message:"이미 사용 중인 아이디입니다."});const salt=crypto.randomBytes(16).toString("hex"),token=makeToken();await db.query("INSERT INTO accounts(account_id,password_hash,password_salt,display_name,login_token,last_login_at) VALUES($1,$2,$3,$4,$5,NOW())",[id,hashPassword(pw,salt),salt,name,token]);const a=await getAccountById(id);bindSocketAccount(s,a);cb({ok:true,token,account:accountView(a)})}catch(e){console.error(e);cb({ok:false,message:"회원가입 DB 오류"})}});
 s.on("login-account",async(d={},cb=()=>{})=>{try{const a=await getAccountById(d.accountId),pw=String(d.password||"");if(!a)return cb({ok:false,message:"아이디 또는 비밀번호가 올바르지 않습니다."});if(hashPassword(pw,a.passwordSalt)!==a.passwordHash)return cb({ok:false,message:"아이디 또는 비밀번호가 올바르지 않습니다."});const token=makeToken(),u=await updateAccount(a.id,{loginToken:token});bindSocketAccount(s,u);cb({ok:true,token,account:accountView(u)})}catch(e){console.error(e);cb({ok:false,message:"로그인 DB 오류"})}});
 s.on("resume-account",async(d={},cb=()=>{})=>{try{const a=await getAccountByToken(d.token);if(!a)return cb({ok:false});bindSocketAccount(s,a);cb({ok:true,account:accountView(a)})}catch(e){cb({ok:false})}});
 s.on("auth-status",async(d={},cb=()=>{})=>{try{const a=await accountFromSocketOrToken(s,d.token);cb({ok:!!a,account:a?accountView(a):null})}catch(e){cb({ok:false})}});
 s.on("logout-account",async(d={},cb=()=>{})=>{try{const a=await accountFromSocketOrToken(s,d.token);if(a)await updateAccount(a.id,{loginToken:null});socketAccounts.delete(s.id);cb({ok:true})}catch(e){cb({ok:true})}});
 s.on("change-display-name",async(d={},cb=()=>{})=>{try{const a=await accountFromSocketOrToken(s,d.token);if(!a)return cb({ok:false,message:"로그인이 필요합니다."});const n=safeDisplayName(d.displayName);if(!n)return cb({ok:false,message:"새 이름을 입력하세요."});if(a.sanityPoints<1000)return cb({ok:false,message:"이름 변경에는 1,000 SP가 필요합니다."});const u=await updateAccount(a.id,{displayName:n,sanityPoints:a.sanityPoints-1000});syncAccountToOnlinePlayers(u);cb({ok:true,account:accountView(u)})}catch(e){cb({ok:false,message:"이름 변경 DB 오류"})}});
 s.on("claim-v30-event-account",async(d={},cb=()=>{})=>{try{const a=await accountFromSocketOrToken(s,d.token);if(!a)return cb({ok:false,message:"로그인이 필요합니다."});if(a.v30Claimed)return cb({ok:false,message:"이미 VERSION 30 보상을 받았습니다.",account:accountView(a)});const u=await updateAccount(a.id,{v30Claimed:true,sanityPoints:a.sanityPoints+100000,rainbowUnlocked:true});syncAccountToOnlinePlayers(u);cb({ok:true,account:accountView(u)})}catch(e){cb({ok:false,message:"보상 DB 오류"})}});
 s.on("set-admin-settings",async(d={},cb=()=>{})=>{try{const a=await accountFromSocketOrToken(s,d.token);if(!a||a.id!==ADMIN_ACCOUNT_ID)return cb({ok:false,message:"권한이 없습니다."});const u=await updateAccount(a.id,{adminGodMode:!!d.godMode,adminFullBright:!!d.fullBright});syncAccountToOnlinePlayers(u);cb({ok:true,account:accountView(u)})}catch(e){cb({ok:false,message:"관리자 설정 DB 오류"})}});


 s.on("get-public-party-list",(lobbyId,cb=()=>{})=>{
  const id=Math.max(1,Math.min(10,parseInt(lobbyId)||1));
  cb({ok:true,parties:publicPartiesForLobby(id)});
 });
 s.on("reconnect-room",(payload={},cb=()=>{})=>{
  if(typeof payload==="string"){
    return reconnectRoom(s,String(payload||""),cb);
  }

  const resolved=resolveRoomPlayer(s,payload||{});
  const r=resolved.room,p=resolved.player;

  if(!r||!p){
    return cb({ok:false,message:"방 정보를 찾을 수 없습니다."});
  }

  socketRoom.set(s.id,r.code);
  s.join(r.code);

  cb({
    ok:true,
    room:view(r),
    myId:s.id,
    player:{
      inBunker:!!p.inBunker,
      inExpedition:!!p.inExpedition,
      bunkerX:p.bunkerX,
      bunkerY:p.bunkerY,
      expeditionX:p.expeditionX,
      expeditionY:p.expeditionY,
      hp:p.hp,
      hunger:p.hunger,
      thirst:p.thirst,
      hygiene:p.hygiene,
      equipped:p.equipped
    }
  });
 });

 s.emit("public-lobby-list",lobbyList());

 s.on("join-public-lobby",async(d,cb=()=>{})=>{
  leavePublicLobby(s);

  const lobbyId=Math.max(1,Math.min(10,parseInt(d?.lobbyId)||1));
  const account=await accountFromSocketOrToken(s,d?.token);
  if(!account)return cb({ok:false,message:"로그인이 필요합니다."});

  const nickname=account.displayName;
  let color=String(d?.color||COLORS[0]).slice(0,20);

  if(color==="rainbow"){
    if(!account.rainbowUnlocked)color=COLORS[0];
  }else if(!COLORS.includes(color)){
    color=COLORS[0];
  }

  if(!nickname)return cb({ok:false,message:"닉네임을 입력하세요."});

  const lobby=publicLobbies[lobbyId-1];
  if(lobby.players.size>=24)return cb({ok:false,message:"로비가 가득 찼습니다."});

  const p={
    id:s.id,nickname,color,
    accountId:account.id,
    sanityPoints:account.sanityPoints,
    rainbowUnlocked:account.rainbowUnlocked,
    adminGodMode:account.id===ADMIN_ACCOUNT_ID && !!account.adminGodMode,
    adminFullBright:account.id===ADMIN_ACCOUNT_ID && !!account.adminFullBright,
    x:500+Math.random()*250,
    y:400+Math.random()*180
  };
  lobby.players.set(s.id,p);
  socketLobby.set(s.id,lobbyId);
  s.join(`public-lobby-${lobbyId}`);

  cb({ok:true,myId:s.id,lobby:lobbyView(lobby),messages:lobby.messages.slice(-100),account:accountView(account)});
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
 s.on("create-room",async(d,cb=()=>{})=>{
  const originLobbyId=socketLobby.get(s.id)||parseInt(d?.publicLobbyId)||null;
  const account=await accountFromSocketOrToken(s,d?.token);
  if(!account)return cb({ok:false,message:"로그인이 필요합니다."});

  let chosenColor=String(d?.color||COLORS[0]);

  if(chosenColor==="rainbow"){
    if(!account.rainbowUnlocked)chosenColor=COLORS[0];
  }else if(!COLORS.includes(chosenColor)){
    chosenColor=COLORS[0];
  }

  const c=code(),p={
    id:s.id,
    nickname:account.displayName,
    sessionId:String(d.sessionId||""),
    ready:true,
    color:chosenColor,
    accountId:account.id,
    sanityPoints:account.sanityPoints,
    rainbowUnlocked:account.rainbowUnlocked,
    adminGodMode:account.id===ADMIN_ACCOUNT_ID && !!account.adminGodMode,
    adminFullBright:account.id===ADMIN_ACCOUNT_ID && !!account.adminFullBright,
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
    weapons:{woodenStick:1,axe:0,katana:0},
    power:100,
    firewall:6,
    hacked:false,
    bunkerSystemsStarted:false,
    blackout:false,
    security:"LOCKED",
    doorDefense:100,
    doorBreached:false,
    outsideThreats:[],
    cctvOutsideEnabled:true,
    nextExteriorThreatAt:Date.now()+45000,

    // V37.2 Radio
    radioState:{
      currentEvent:null,
      nextEventAt:Date.now()+45000,
      interference:false,
      history:[],
      unlocks:{sos:false,interference:false,aliens:false},
      completed:{gameShow:false,sos:false,interference:false,homeless:false,aliens:false},
      homeless:null,
      gameShow:null,
      alienRoute:false
    },

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
  rooms.set(c,r);socketRoom.set(s.id,c);s.join(c);cb({ok:true,room:view(r),myId:s.id,account:accountView(account)});emit(r)
 });
 s.on("join-room",(d,cb=()=>{})=>{
  const requestedLobby=parseInt(d?.publicLobbyId)||null;
  const r=rooms.get(String(d.code||"").toUpperCase());
  if(!r)return cb({ok:false,message:"방 없음"});
  if(requestedLobby && r.publicLobbyId && r.publicLobbyId!==requestedLobby){
    return cb({ok:false,message:"현재 로비의 파티가 아닙니다."});
  }
  join(s,r,d.nickname,(result)=>{ if(result?.ok)emitPublicParties(requestedLobby||r.publicLobbyId); cb(result); },d.color,d.sessionId,d.token)
 });
 s.on("toggle-ready",(cb=()=>{})=>{const r=rooms.get(socketRoom.get(s.id));if(!r)return cb({ok:false});if(r.hostId===s.id)return cb({ok:false});const p=r.players.get(s.id);p.ready=!p.ready;cb({ok:true});emit(r)});
 s.on("start-game",(cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id));if(!r)return cb({ok:false,message:"방 없음"});if(r.hostId!==s.id)return cb({ok:false,message:"방장만 가능"});
  if([...r.players.values()].some(p=>p.id!==r.hostId&&!p.ready))return cb({ok:false,message:"준비 필요"});
  r.status="playing";r.items=makeItems();r.endsAt=Date.now()+ROUND;r.doorDefense=100;r.doorBreached=false;r.security="LOCKED";r.outsideThreats=[];r.nextExteriorThreatAt=Date.now()+45000;
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
    doorDefense:r.doorDefense,
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

 s.on("finish-scavenge",async(payload={},cb=()=>{})=>{
  if(typeof payload==="function"){ cb=payload; payload={}; }

  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;

  if(!r||!p){
    return cb({ok:false,message:"수집 종료 시 방 정보를 복구하지 못했습니다."});
  }

  socketRoom.set(s.id,r.code);
  s.join(r.code);

  const cx=p.x+15,cy=p.y+15;
  const alive=
    p.floor===1 &&
    cx>=BUNKER.x && cx<=BUNKER.x+BUNKER.w &&
    cy>=BUNKER.y && cy<=BUNKER.y+BUNKER.h;

  if(alive){
    // 첫 수집 종료 후 벙커에 들어와도 DAY 1 유지
    p.inBunker=true;
    if(!r.bunkerSystemsStarted){
      r.bunkerSystemsStarted=true;
      r.power=100;
      r.firewall=6;
      r.hacked=false;
      r.blackout=false;
      r.security="ONLINE";
      v32EmitState(r);
    }
    r.bounty=Math.min(3,r.bounty+1);

    // V32: 벙커 SP와 로비 SP는 같은 계정 SP
    try{
      const account=await accountFromSocketOrToken(s,null);
      if(account){
        const updated=await updateAccount(account.id,{sanityPoints:account.sanityPoints+10});
        p.sanityPoints=updated.sanityPoints;
        io.to(p.id).emit("account-state",accountView(updated));
      }
    }catch(err){ console.error("[V32 SP]",err); }

    if(r.bounty>=3)spawnBountyHunterV32(r);
  }

  io.to(r.code).emit("scavenge-result",{
    alive,
    roomCode:r.code,
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
    alive,
    roomCode:r.code,
    bunkerStock:r.bunkerStock,
    weapons:r.weapons,
    power:r.power,
    firewall:r.firewall,
    hacked:!!r.hacked,
    security:r.security,
    doorDefense:r.doorDefense,
    doorBreached:!!r.doorBreached,
    radioState:radioPublicStateV372(r),
    threats:(r.outsideThreats||[]).map(v3713ThreatPublic),
    vents:ventPublicState(r),
    bunkerMobs:(r.bunkerMobs||[]).filter(m=>m.alive)
  });
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

 s.on("bunker-move",(d={})=>{
  const resolved=resolveRoomPlayer(s,d);
  const r=resolved.room,p=resolved.player;
  if(!r||!p||!p.inBunker)return;
  if(p.sleeping&&Date.now()<(p.sleepUntil||0))return;
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


 s.on("v3723-recover-room",(payload={},cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;

  if(!r||!p){
    return cb({
      ok:false,
      message:"방 정보를 복구하지 못했습니다.",
      roomCode:String(payload?.roomCode||"")
    });
  }

  // 장면을 명시한 경우에만 서버 플레이어 상태를 변경한다.
  // 기존처럼 playing 상태라는 이유만으로 무조건 inBunker=true로 만들지 않는다.
  const scene=String(payload?.scene||"");
  if(r.status==="playing" && scene==="bunker"){
    p.inBunker=true;
    p.inExpedition=false;
  }else if(r.status==="playing" && scene==="expedition"){
    p.inBunker=false;
    p.inExpedition=true;
  }

  socketRoom.set(s.id,r.code);
  s.join(r.code);

  cb({
    ok:true,
    recovered:!!resolved.recovered,
    roomCode:r.code,
    playerId:p.id,
    inBunker:!!p.inBunker,
    bunkerStock:r.bunkerStock,
    weapons:r.weapons,
    power:r.power,
    firewall:r.firewall,
    hacked:!!r.hacked,
    security:r.security,
    doorDefense:r.doorDefense,
    doorBreached:!!r.doorBreached,
    radioState:radioPublicStateV372(r),
    threats:(r.outsideThreats||[]).map(v3713ThreatPublic),
    vents:ventPublicState(r),
    bunkerMobs:(r.bunkerMobs||[]).filter(m=>m.alive)
  });
 });

 s.on("get-bunker-players",(payload={},cb=()=>{})=>{
  if(typeof payload==="function"){ cb=payload; payload={}; }
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room;
  if(!r)return cb({ok:false,players:[],message:"방 정보를 찾을 수 없습니다."});
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
      hospitalGlass:location==="hospital"?HOSPITAL_GLASS.filter(g=>hospitalWalkableV26(g.x,g.y,8)):[],
      hospitalTripwires:location==="hospital"?HOSPITAL_TRIPWIRES.filter(t=>{
        const mx=(t.x1+t.x2)/2,my=(t.y1+t.y2)/2;
        return hospitalWalkableV26(mx,my,4);
      }):[],
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

  // V36.1 Hospital Abomination
  // 인지 범위 안에서 플레이어가 움직이면 즉시 공격/추격 모드.
  // 유리/함정 소리는 공격 모드가 아니라 그 위치를 조사하러 빠르게 이동.
  if(r.expeditionLocation==="hospital" && r.hospitalAbomination){
    const a=r.hospitalAbomination;
    const moved=Math.hypot(p.expeditionX-prevX,p.expeditionY-prevY);
    const distance=Math.hypot(
      (p.expeditionX+15)-(a.x+18),
      (p.expeditionY+15)-(a.y+18)
    );

    const detectionRadius=280;

    if(moved>1.0 && distance<detectionRadius){
      a.chaseTargetId=p.id;
      a.state="chase";
      a.alertedUntil=Date.now()+120000; // 실제 추격은 타겟 사망/탐사 종료까지 유지
      a.investigateUntil=0;
    }

    if(!p.jumping && a.state!=="chase"){
      let noise=null;

      for(const g of HOSPITAL_GLASS){
        if(Math.hypot((p.expeditionX+15)-g.x,(p.expeditionY+15)-g.y)<30){
          noise={x:g.x,y:g.y};
          break;
        }
      }

      if(!noise){
        for(const w of HOSPITAL_TRIPWIRES){
          const cx=(w.x1+w.x2)/2,cy=(w.y1+w.y2)/2;
          if(Math.hypot((p.expeditionX+15)-cx,(p.expeditionY+15)-cy)<38){
            noise={x:cx,y:cy};
            break;
          }
        }
      }

      if(noise){
        a.state="investigate";
        a.investigateX=noise.x;
        a.investigateY=noise.y;
        a.investigateUntil=Date.now()+5000;
        a.chaseTargetId=null;
        a.attacking=false;
        a.attackTargetId=null;
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
    axe:1100,
    katana:620
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

  const damage=p.equipped==="katana" ? 62 : (p.equipped==="axe" ? 45 : 24);
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
    axe:1100,
    katana:620
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

  const damage=p.equipped==="katana"?62:(p.equipped==="axe"?45:24);

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

 s.on("buy-sanity-item",async(type,cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id));
  if(!r)return cb({ok:false,message:"방 없음"});
  if(r.hacked)return cb({ok:false,message:"컴퓨터가 해킹되어 상점을 사용할 수 없습니다."});
  const prices={battery:500,beans:800,water:800,medkit:1500,flashlight:2500,backpack:7000,mask:12000,axe:18000,blueprint:30000};
  const price=prices[type];
  if(!price)return cb({ok:false,message:"판매하지 않는 물품"});

  try{
    const account=await accountFromSocketOrToken(s,null);
    if(!account)return cb({ok:false,message:"로그인이 필요합니다."});
    if(account.sanityPoints<price)return cb({ok:false,message:"Sanity Point가 부족합니다."});

    const updated=await updateAccount(account.id,{sanityPoints:account.sanityPoints-price});
    r.bunkerStock[type]=(r.bunkerStock[type]||0)+1;
    if(type==="axe")r.weapons.axe=(r.weapons.axe||0)+1;
    const p=r.players.get(s.id); if(p)p.sanityPoints=updated.sanityPoints;

    io.to(s.id).emit("account-state",accountView(updated));
    io.to(r.code).emit("bunker-state",{bunkerStock:r.bunkerStock,weapons:r.weapons,power:r.power,security:r.security});
    v32EmitState(r);
    cb({ok:true,sanity:updated.sanityPoints,bunkerStock:r.bunkerStock,weapons:r.weapons,account:accountView(updated)});
  }catch(err){console.error("[SHOP DB]",err);cb({ok:false,message:"DB 저장 오류"});}
 });

 s.on("v32-sleep",(payload={},cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,payload),r=resolved.room,p=resolved.player;
  if(!r||!p||!p.inBunker)return cb({ok:false,message:"벙커 안이 아닙니다."});
  if(p.sleeping)return cb({ok:false,message:"이미 자고 있습니다."});
  p.sleeping=true;p.sleepUntil=Date.now()+V32_SLEEP_MS;
  io.to(p.id).emit("v32-sleep-start",{endsAt:p.sleepUntil});
  setTimeout(()=>{
    const room=rooms.get(r.code),pl=room?.players.get(p.id);
    if(!pl)return;
    pl.sleeping=false;pl.sleepUntil=0;
    pl.fatigue=Math.max(0,(pl.fatigue??0)-75);
    pl.hunger=Math.max(0,(pl.hunger??100)-12);
    pl.thirst=Math.max(0,(pl.thirst??100)-18);
    pl.sanityStat=Math.min(100,(pl.sanityStat??100)+12);
    io.to(pl.id).emit("v32-sleep-finished",{stats:{fatigue:pl.fatigue,hunger:pl.hunger,thirst:pl.thirst,sanityStat:pl.sanityStat}});
  },V32_SLEEP_MS);
  cb({ok:true,endsAt:p.sleepUntil});
 });





// =========================================================
// V37.2 RADIO SYSTEM
// Events inspired by the Radiant Residents radio event structure.
// =========================================================
const RADIO_EVENT_TYPES=["gameShow","sos","interference","homeless"];
const RADIO_CHANNELS_V3722={
  "88.7":{type:"gameShow",title:"GAME SHOW"},
  "91.3":{type:"sos",title:"SOS MESSAGE"},
  "97.9":{type:"interference",title:"RADIO INTERFERENCE"},
  "104.7":{type:"homeless",title:"HOMELESS DUDE"},
  "107.9":{type:"aliens",title:"ALIENS?"}
};

function radioPublicStateV372(r){
  const rs=r.radioState||{};
  return {
    hasRadio:(r.bunkerStock?.radio||0)>0,
    currentEvent:rs.currentEvent?{...rs.currentEvent}:null,
    nextEventAt:rs.nextEventAt||0,
    interference:!!rs.interference,
    history:(rs.history||[]).slice(-8),
    unlocks:{...(rs.unlocks||{})},
    completed:{...(rs.completed||{})},
    homeless:rs.homeless?{...rs.homeless}:null,
    gameShow:rs.gameShow?{...rs.gameShow}:null,
    alienRoute:!!rs.alienRoute,
    selectedChannel:rs.currentEvent?.channel||null
  };
}

function radioPushHistoryV372(r,text){
  if(!r.radioState) return;
  r.radioState.history.push({text,time:Date.now()});
  if(r.radioState.history.length>30){
    r.radioState.history.splice(0,r.radioState.history.length-30);
  }
}

function radioEventTitleV372(type){
  return ({
    gameShow:"GAME SHOW",
    sos:"SOS MESSAGE",
    interference:"RADIO INTERFERENCE",
    homeless:"HOMELESS DUDE",
    aliens:"ALIENS?"
  })[type]||"UNKNOWN SIGNAL";
}

function radioCreateEventV372(r,type=null){
  const rs=r.radioState;
  if(!rs || rs.currentEvent || rs.interference)return null;

  const available=RADIO_EVENT_TYPES.filter(t=>!rs.completed?.[t]);
  const chosen=type || pick(available.length?available:RADIO_EVENT_TYPES);

  rs.currentEvent={
    id:`radio-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    type:chosen,
    title:radioEventTitleV372(chosen),
    createdAt:Date.now()
  };
  radioPushHistoryV372(r,`${rs.currentEvent.title} 신호 수신`);
  io.to(r.code).emit("v372-radio-event",radioPublicStateV372(r));
  return rs.currentEvent;
}

function radioScheduleNextV372(r,min=65000,max=125000){
  if(!r.radioState)return;
  r.radioState.nextEventAt=Date.now()+min+Math.floor(Math.random()*(max-min));
}

function radioSpawnGameShowBossV372(r){
  const hp=190;
  r.bunkerMobs.push({
    id:`gameshow-boss-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    type:"mutantRaider",
    x:250,y:625,
    hp,maxHp:hp,alive:true,lastAttackAt:0,
    damage:17,speed:5.0,
    gameShowBoss:true
  });
  io.to(r.code).emit("bunker-mobs",r.bunkerMobs.filter(m=>m.alive));
}

function radioRandomSupplyTypeV372(){
  return pick(["beans","water","medkit","battery","tape","soap","flashlight"]);
}

function radioApplyGameShowSpinV372(r,p){
  const sectors=[
    "loseHealth","weapon","boss","supplies","supplies","loseSupplies","maxHealth","sickness"
  ];
  const result=pick(sectors);

  if(result==="loseHealth"){
    p.hp=Math.max(1,Math.floor((p.hp??100)*.5));
  }else if(result==="weapon"){
    r.weapons.katana=(r.weapons.katana||0)+1;
  }else if(result==="boss"){
    radioSpawnGameShowBossV372(r);
  }else if(result==="supplies"){
    const type=radioRandomSupplyTypeV372();
    r.bunkerStock[type]=(r.bunkerStock[type]||0)+2;
  }else if(result==="loseSupplies"){
    const candidates=["beans","water","medkit","battery","tape","soap","flashlight"]
      .filter(t=>(r.bunkerStock[t]||0)>0);
    if(candidates.length){
      const type=pick(candidates);
      r.bunkerStock[type]=Math.max(0,(r.bunkerStock[type]||0)-2);
    }
  }else if(result==="maxHealth"){
    p.maxHp=Math.min(160,(p.maxHp||100)+20);
    p.hp=Math.min(p.maxHp,(p.hp||100)+20);
  }else if(result==="sickness"){
    p.sick=true;
  }

  return result;
}

function radioHomelessResolveV372(r){
  const rs=r.radioState;
  if(!rs?.homeless || rs.homeless.resolved)return;

  const outcome=pick(["guard","guard","mold","dead"]);
  rs.homeless.resolved=true;
  rs.homeless.outcome=outcome;
  rs.homeless.resolvedAt=Date.now();

  radioPushHistoryV372(r,
    outcome==="guard" ? "방문자가 벙커 경비를 돕기 시작함" :
    outcome==="mold" ? "방문자에게 이상 증상이 나타남" :
    "방문자가 벙커에서 사망함"
  );
  io.to(r.code).emit("v372-radio-state",radioPublicStateV372(r));
}

function v3713ThreatPublic(t){
  return {
    id:t.id,
    type:t.type,
    x:t.x,
    y:t.y,
    hp:t.hp,
    maxHp:t.maxHp,
    state:t.state,
    attackPower:t.attackPower||0,
    lastAttackAt:t.lastAttackAt||0
  };
}

function v3713MakeThreat(type){
  const cfg={
    mutant:{hp:100,attackPower:1},
    raider:{hp:85,attackPower:4},
    mutantRaider:{hp:220,attackPower:8}
  }[type]||{hp:100,attackPower:1};

  // CCTV normalized coordinates. Enemies spawn near the far road/tree line.
  const lanes=[
    {x:.06,y:.58},
    {x:.18,y:.54},
    {x:.34,y:.60},
    {x:.52,y:.53},
    {x:.92,y:.56}
  ];
  const lane=pick(lanes);

  return {
    id:`ext-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    type,
    x:lane.x+(Math.random()*.04-.02),
    y:lane.y+(Math.random()*.03-.015),
    hp:cfg.hp,
    maxHp:cfg.hp,
    attackPower:cfg.attackPower,
    lastAttackAt:0,
    state:"wandering",
    spawnedAt:Date.now(),
    approachAt:Date.now()+12000+Math.floor(Math.random()*18000),
    driftX:(Math.random()*.004-.002),
    driftY:(Math.random()*.002-.001)
  };
}

function v3713SpawnExteriorThreat(room){
  if(!room || room.status!=="playing" || !room.bunkerSystemsStarted)return;

  // keep CCTV readable; max 5 visible threats at this step
  if((room.outsideThreats||[]).length>=5)return;

  const roll=Math.random();
  if(roll<.62){
    room.outsideThreats.push(v3713MakeThreat("mutant"));
  }else if(roll<.90){
    // raider encounter: spawn 2~4 together
    const count=2+Math.floor(Math.random()*3);
    for(let i=0;i<count && room.outsideThreats.length<5;i++){
      const t=v3713MakeThreat("raider");
      t.x=Math.max(.03,Math.min(.97,t.x+i*.025));
      t.y=Math.max(.46,Math.min(.68,t.y+i*.006));
      room.outsideThreats.push(t);
    }
  }else{
    room.outsideThreats.push(v3713MakeThreat("mutantRaider"));
  }

  io.to(room.code).emit("v3713-exterior-threats",{
    threats:room.outsideThreats.map(v3713ThreatPublic)
  });
}

function v3716ConvertThreatToBunkerMob(room,t,index=0){
  const cfg={
    mutant:{type:"outsideMutant",hp:110,damage:12,speed:5.8},
    raider:{type:"raider",hp:90,damage:11,speed:6.4},
    mutantRaider:{type:"mutantRaider",hp:240,damage:18,speed:4.9}
  }[t.type]||{type:"outsideMutant",hp:110,damage:12,speed:5.8};

  const mob={
    id:`breach-${Date.now()}-${index}-${Math.random().toString(36).slice(2,7)}`,
    type:cfg.type,
    sourceThreatType:t.type,
    x:235+(index%3)*34,
    y:610+Math.floor(index/3)*34,
    hp:cfg.hp,
    maxHp:cfg.hp,
    alive:true,
    lastAttackAt:0,
    damage:cfg.damage,
    speed:cfg.speed,
    breached:true
  };

  room.bunkerMobs.push(mob);
  return mob;
}

function v3716BreachExteriorThreats(room){
  if(!room || (room.doorDefense??100)>0)return false;

  room.doorBreached=true;
  room.security="BREACHED";
  v32EmitState(room);

  const attackers=(room.outsideThreats||[]).filter(t=>t.state==="atDoor");
  if(!attackers.length)return false;

  const mobs=[];
  attackers.forEach((t,i)=>{
    mobs.push(v3716ConvertThreatToBunkerMob(room,t,i));
  });

  const ids=new Set(attackers.map(t=>t.id));
  room.outsideThreats=(room.outsideThreats||[]).filter(t=>!ids.has(t.id));

  io.to(room.code).emit("v3716-vault-breached",{
    count:mobs.length,
    types:mobs.map(m=>m.type),
    doorDefense:room.doorDefense,
    doorBreached:true,
    security:room.security
  });

  io.to(room.code).emit("bunker-mobs",
    room.bunkerMobs.filter(m=>m.alive)
  );

  io.to(room.code).emit("v3713-exterior-threats",{
    threats:room.outsideThreats.map(v3713ThreatPublic)
  });

  return true;
}


 // =========================================================
 // V37.0 SECURITY CAMERA - STEP 1
 // 집 바깥 CCTV + Door Defense 기본 시스템
 // =========================================================

 // =========================================================
 // V37.2 RADIO SOCKETS
 // =========================================================
 s.on("v372-radio-state",(payload={},cb=()=>{})=>{
  if(typeof payload==="function"){ cb=payload; payload={}; }
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});
  cb({ok:true,state:radioPublicStateV372(r)});
 });

 s.on("v372-radio-tune",(d={},cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,d);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});
  if(!p.inBunker)return cb({ok:false,message:"벙커 안에서만 라디오를 사용할 수 있습니다."});
  if((r.bunkerStock.radio||0)<=0)return cb({ok:false,message:"라디오가 없습니다. 60초 수집 단계에서 라디오를 가져와야 합니다."});
  if((r.power??0)<=0)return cb({ok:false,message:"전력이 없어 라디오가 작동하지 않습니다."});

  const channel=String(d.channel||"");
  const preset=RADIO_CHANNELS_V3722[channel];
  if(!preset)return cb({ok:false,message:"등록되지 않은 주파수입니다."});

  // 재밍 상태에서는 interference 채널만 다시 들을 수 있음.
  if(r.radioState.interference && preset.type!=="interference"){
    return cb({ok:false,message:"강한 전파 방해 때문에 다른 채널을 수신할 수 없습니다."});
  }

  // Aliens? 채널은 일반 이벤트 팝업이 아니라 특수 루트 UI를 연다.
  if(preset.type==="aliens"){
    r.radioState.currentEvent={
      id:`radio-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      type:"aliens",
      title:"ALIENS?",
      channel,
      createdAt:Date.now()
    };
    radioPushHistoryV372(r,`${channel} FM · ALIENS? 신호 수신`);
    io.to(r.code).emit("v372-radio-event",radioPublicStateV372(r));
    return cb({ok:true,state:radioPublicStateV372(r)});
  }

  if(r.radioState.currentEvent){
    // 다른 채널을 돌리면 현재 신호를 교체.
    r.radioState.currentEvent=null;
  }

  const type=preset.type;
  r.radioState.currentEvent={
    id:`radio-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    type,
    title:preset.title,
    channel,
    createdAt:Date.now()
  };

  radioPushHistoryV372(r,`${channel} FM · ${preset.title} 수신`);
  io.to(r.code).emit("v372-radio-event",radioPublicStateV372(r));
  cb({ok:true,state:radioPublicStateV372(r)});
 });

 s.on("v372-radio-choice",(d={},cb=()=>{})=>{
  const resolved=resolveRoomPlayer(s,d);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});
  if((r.bunkerStock.radio||0)<=0)return cb({ok:false,message:"라디오가 없습니다."});

  const rs=r.radioState;
  const ev=rs.currentEvent;
  if(!ev)return cb({ok:false,message:"처리할 라디오 이벤트가 없습니다."});

  const accept=d.choice==="accept";
  const type=ev.type;

  if(type==="aliens"){
    if(!accept){
      radioPushHistoryV372(r,"107.9 FM · ALIENS? 신호 무시");
      rs.currentEvent=null;
      io.to(r.code).emit("v372-radio-state",radioPublicStateV372(r));
      return cb({ok:true,state:radioPublicStateV372(r)});
    }

    rs.currentEvent=null;
    io.to(r.code).emit("v372-radio-state",radioPublicStateV372(r));
    return cb({
      ok:true,
      aliens:true,
      state:radioPublicStateV372(r),
      message:"UNKNOWN CHANNEL 버튼에서 구조 신호 루트를 시작할 수 있습니다."
    });
  }

  if(!accept){
    radioPushHistoryV372(r,`${ev.title} 무시`);
    rs.completed[type]=true;
    rs.currentEvent=null;
    radioScheduleNextV372(r);
    io.to(r.code).emit("v372-radio-state",radioPublicStateV372(r));
    return cb({ok:true,state:radioPublicStateV372(r),message:"신호를 무시했습니다."});
  }

  if(type==="gameShow"){
    rs.gameShow={active:true,spun:false,acceptedAt:Date.now()};
    rs.currentEvent=null;
    radioPushHistoryV372(r,"게임쇼 참가 수락");
  }

  if(type==="sos"){
    p.sanityStat=Math.max(0,(p.sanityStat??100)-35);
    rs.unlocks.sos=true;
    rs.completed.sos=true;
    rs.currentEvent=null;
    radioPushHistoryV372(r,"SOS 신호 해독 · SOS 탐사지 좌표 확보");
    io.to(p.id).emit("personal-stats",{
      hp:p.hp,hunger:p.hunger,thirst:p.thirst,hygiene:p.hygiene,
      fatigue:p.fatigue,sanityStat:p.sanityStat
    });
  }

  if(type==="interference"){
    rs.interference=true;
    rs.unlocks.interference=true;
    rs.completed.interference=true;
    rs.currentEvent=null;
    radioPushHistoryV372(r,"라디오 재밍 시작 · 전파 방해 탐사지 좌표 확보");
  }

  if(type==="homeless"){
    if((r.bunkerStock.beans||0)<2 || (r.bunkerStock.water||0)<2){
      return cb({ok:false,message:"받아들이려면 통조림 2개와 물 2개가 필요합니다."});
    }
    r.bunkerStock.beans-=2;
    r.bunkerStock.water-=2;
    rs.homeless={
      active:true,
      resolved:false,
      outcome:null,
      arrivedAt:Date.now(),
      resolveAt:Date.now()+60000
    };
    rs.completed.homeless=true;
    rs.currentEvent=null;
    radioPushHistoryV372(r,"방문자를 벙커에 받아들임");
    io.to(r.code).emit("bunker-state",{bunkerStock:r.bunkerStock,power:r.power,security:r.security});
  }

  radioScheduleNextV372(r);
  io.to(r.code).emit("v372-radio-state",radioPublicStateV372(r));
  cb({ok:true,state:radioPublicStateV372(r),bunkerStock:r.bunkerStock});
 });

 s.on("v372-gameshow-spin",(payload={},cb=()=>{})=>{
  if(typeof payload==="function"){ cb=payload; payload={}; }
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});

  const gs=r.radioState?.gameShow;
  if(!gs?.active || gs.spun)return cb({ok:false,message:"현재 돌릴 수 있는 게임쇼 룰렛이 없습니다."});

  gs.spun=true;
  gs.active=false;
  gs.result=radioApplyGameShowSpinV372(r,p);
  r.radioState.completed.gameShow=true;
  radioPushHistoryV372(r,`게임쇼 룰렛 결과: ${gs.result}`);

  io.to(r.code).emit("bunker-state",{
    bunkerStock:r.bunkerStock,
    weapons:r.weapons,
    power:r.power,
    security:r.security
  });
  io.to(p.id).emit("personal-stats",{
    hp:p.hp,hunger:p.hunger,thirst:p.thirst,hygiene:p.hygiene,
    fatigue:p.fatigue,sanityStat:p.sanityStat
  });
  io.to(r.code).emit("v372-radio-state",radioPublicStateV372(r));

  cb({
    ok:true,
    result:gs.result,
    state:radioPublicStateV372(r),
    bunkerStock:r.bunkerStock,
    weapons:r.weapons,
    stats:{hp:p.hp,maxHp:p.maxHp||100,sick:!!p.sick}
  });
 });

 s.on("v372-homeless-expel",(payload={},cb=()=>{})=>{
  if(typeof payload==="function"){ cb=payload; payload={}; }
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});
  const h=r.radioState?.homeless;
  if(!h?.active)return cb({ok:false,message:"내보낼 방문자가 없습니다."});

  h.active=false;
  // 쫓아내면 적대 가능성: Raider 1명 벙커에 생성
  if(Math.random()<.65){
    r.bunkerMobs.push({
      id:`homeless-hostile-${Date.now()}`,
      type:"raider",x:270,y:620,hp:95,maxHp:95,alive:true,lastAttackAt:0,damage:12,speed:6.2
    });
    io.to(r.code).emit("bunker-mobs",r.bunkerMobs.filter(m=>m.alive));
  }
  radioPushHistoryV372(r,"방문자를 벙커에서 내보냄");
  io.to(r.code).emit("v372-radio-state",radioPublicStateV372(r));
  cb({ok:true,state:radioPublicStateV372(r)});
 });

 s.on("v372-interference-clear",(payload={},cb=()=>{})=>{
  if(typeof payload==="function"){ cb=payload; payload={}; }
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});
  if(!r.radioState?.interference)return cb({ok:false,message:"현재 라디오 재밍 상태가 아닙니다."});

  // V37.2에서는 탐사지 시스템 완성 전 임시 복구 규칙:
  // toolbox 1 + battery 1, 다음 단계에서 3개 안테나 탐사로 교체 예정.
  if((r.bunkerStock.toolbox||0)<1 || (r.bunkerStock.battery||0)<1){
    return cb({ok:false,message:"임시 신호 복구에는 공구함 1 + 배터리 1이 필요합니다."});
  }
  r.bunkerStock.toolbox--;
  r.bunkerStock.battery--;
  r.radioState.interference=false;
  radioScheduleNextV372(r,45000,90000);
  radioPushHistoryV372(r,"임시 신호 복구 완료");
  io.to(r.code).emit("bunker-state",{bunkerStock:r.bunkerStock,power:r.power,security:r.security});
  io.to(r.code).emit("v372-radio-state",radioPublicStateV372(r));
  cb({ok:true,state:radioPublicStateV372(r),bunkerStock:r.bunkerStock});
 });

 s.on("v372-aliens-route",(payload={},cb=()=>{})=>{
  if(typeof payload==="function"){ cb=payload; payload={}; }
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보가 없습니다."});
  if(r.radioState?.alienRoute)return cb({ok:false,message:"이미 Alien 신호 루트를 시작했습니다."});

  const need={beans:2,water:2,medkit:2,map:1};
  for(const [type,n] of Object.entries(need)){
    if((r.bunkerStock[type]||0)<n){
      return cb({ok:false,message:"필요 자원: 통조림 2 + 물 2 + 메디킷 2 + 지도 1"});
    }
  }
  for(const [type,n] of Object.entries(need))r.bunkerStock[type]-=n;

  r.radioState.alienRoute=true;
  r.radioState.unlocks.aliens=true;
  r.radioState.completed.aliens=true;
  radioPushHistoryV372(r,"정체불명의 구조 신호 루트 시작");
  io.to(r.code).emit("bunker-state",{bunkerStock:r.bunkerStock,power:r.power,security:r.security});
  io.to(r.code).emit("v372-radio-state",radioPublicStateV372(r));

  cb({ok:true,state:radioPublicStateV372(r),bunkerStock:r.bunkerStock});
 });

 s.on("v37-cctv-state",(payload={},cb=()=>{})=>{
  if(typeof payload==="function"){ cb=payload; payload={}; }
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보를 복구하지 못했습니다."});

  cb({
    ok:true,
    power:r.power??100,
    hacked:!!r.hacked,
    signal:(r.hacked || (r.power??0)<=0) ? "offline" : ((r.power??0)<30 ? "unstable" : "online"),
    doorDefense:r.doorDefense??100,
    doorBreached:!!r.doorBreached,
    bunkerStock:r.bunkerStock,
    threats:r.hacked ? [] : (r.outsideThreats||[]).map(v3713ThreatPublic)
  });
 });

 s.on("v37-door-defense-recharge",(payload={},cb=()=>{})=>{
  if(typeof payload==="function"){ cb=payload; payload={}; }
  const resolved=resolveRoomPlayer(s,payload);
  const r=resolved.room,p=resolved.player;
  if(!r||!p)return cb({ok:false,message:"방 정보를 복구하지 못했습니다."});
  if(r.hacked)return cb({ok:false,message:"컴퓨터가 해킹되어 있습니다."});
  if((r.power??0)<=0)return cb({ok:false,message:"전력이 없습니다."});

  // 문이 완전히 뚫린 경우: 침입자를 먼저 모두 처리해야 수리 가능.
  if(r.doorBreached){
    const intruders=(r.bunkerMobs||[]).filter(m=>
      m.alive && ["outsideMutant","raider","mutantRaider"].includes(m.type)
    );
    if(intruders.length){
      return cb({
        ok:false,
        message:`벙커 내부 침입자 ${intruders.length}명을 먼저 처리해야 합니다.`
      });
    }

    const need={toolbox:1,tape:2,battery:1};
    if((r.bunkerStock.toolbox||0)<need.toolbox ||
       (r.bunkerStock.tape||0)<need.tape ||
       (r.bunkerStock.battery||0)<need.battery){
      return cb({
        ok:false,
        repair:true,
        message:"문 수리에는 공구함 1 + 테이프 2 + 배터리 1이 필요합니다.",
        bunkerStock:r.bunkerStock
      });
    }

    r.bunkerStock.toolbox-=1;
    r.bunkerStock.tape-=2;
    r.bunkerStock.battery-=1;
    r.doorBreached=false;
    r.doorDefense=60;
    r.security="RESEALED";

    io.to(r.code).emit("v3717-door-resealed",{
      doorDefense:r.doorDefense,
      bunkerStock:r.bunkerStock,
      security:r.security
    });
    io.to(r.code).emit("v37-door-defense",{doorDefense:r.doorDefense,doorBreached:!!r.doorBreached});
    io.to(r.code).emit("bunker-state",{
      bunkerStock:r.bunkerStock,
      power:r.power,
      security:r.security
    });
    v32EmitState(r);

    return cb({
      ok:true,
      repaired:true,
      doorDefense:r.doorDefense,
      doorBreached:false,
      bunkerStock:r.bunkerStock
    });
  }

  if((r.doorDefense??100)>=100){
    return cb({ok:false,message:"Door Defense가 이미 100%입니다."});
  }

  // 파손 전 일반 충전: 배터리 1개로 100% 복구.
  if((r.bunkerStock.battery||0)<=0){
    return cb({ok:false,message:"Door Defense 충전에 배터리 1개가 필요합니다."});
  }

  r.bunkerStock.battery-=1;
  r.doorDefense=100;
  r.security="SECURE";

  io.to(r.code).emit("v37-door-defense",{doorDefense:r.doorDefense,doorBreached:!!r.doorBreached});
  io.to(r.code).emit("bunker-state",{
    bunkerStock:r.bunkerStock,
    power:r.power,
    security:r.security
  });
  v32EmitState(r);

  cb({
    ok:true,
    repaired:false,
    doorDefense:r.doorDefense,
    doorBreached:false,
    bunkerStock:r.bunkerStock
  });
 });

 s.on("v32-generator-action",(d={},cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p||!p.inBunker)return cb({ok:false,message:"벙커 안이 아닙니다."});

  if(d.action==="battery"){
    if((r.bunkerStock.battery||0)<=0)return cb({ok:false,message:"배터리가 없습니다."});
    r.bunkerStock.battery--;
    r.power=100;
    r.blackout=false;
    p.generatorChallenge=null;
    v32EmitState(r);
    io.to(r.code).emit("bunker-state",{bunkerStock:r.bunkerStock,power:r.power,security:r.security});
    return cb({ok:true,full:true,state:v32PublicState(r),bunkerStock:r.bunkerStock});
  }

  if(d.action!=="timing")return cb({ok:false,message:"알 수 없는 발전기 작업입니다."});

  const stage=1;
  const target=.22+Math.random()*.56;
  const width=.22; // 1단계는 넓음
  p.generatorChallenge={stage,target,width,createdAt:Date.now(),startPower:r.power};
  cb({ok:true,stage,target,width,power:r.power});
 });

 s.on("v32-generator-submit",(d={},cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  const ch=p?.generatorChallenge;
  if(!r||!p||!ch)return cb({ok:false,message:"진행 중인 발전기 게임이 없습니다."});

  const value=Math.max(0,Math.min(1,Number(d.value)||0));
  const half=(ch.width||.15)/2;
  const success=Math.abs(value-ch.target)<=half;

  if(!success){
    const stage=ch.stage;
    p.generatorChallenge=null;
    return cb({
      ok:true,
      success:false,
      failedStage:stage,
      complete:false,
      power:r.power,
      state:v32PublicState(r)
    });
  }

  if(ch.stage>=3){
    p.generatorChallenge=null;
    r.power=100;
    r.blackout=false;
    v32EmitState(r);
    return cb({
      ok:true,
      success:true,
      complete:true,
      stage:3,
      power:100,
      state:v32PublicState(r)
    });
  }

  const nextStage=ch.stage+1;
  const widths={2:.14,3:.08};
  const target=.18+Math.random()*.64;
  const width=widths[nextStage];
  p.generatorChallenge={...ch,stage:nextStage,target,width};
  cb({
    ok:true,
    success:true,
    complete:false,
    stage:nextStage,
    target,
    width,
    power:r.power,
    state:v32PublicState(r)
  });
 });

 s.on("v32-firewall-start",(d={},cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p||!p.inBunker)return cb({ok:false,message:"벙커 안이 아닙니다."});
  if(r.hacked)return cb({ok:false,hacked:true,message:"컴퓨터가 해킹되었습니다. 먼저 물자를 지불해 복구해야 합니다."});

  p.firewallChallenge={
    startedAt:Date.now(),
    duration:30000,
    targetBars:6
  };
  cb({ok:true,duration:30000,bars:r.firewall??0});
 });

 s.on("v32-firewall-survived",async(d={},cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p||!p.firewallChallenge)return cb({ok:false,message:"Firewall 게임 세션이 없습니다."});
  const elapsed=Date.now()-p.firewallChallenge.startedAt;
  p.firewallChallenge=null;

  if(elapsed<27000)return cb({ok:false,message:"복구 시간이 부족합니다."});

  r.firewall=6;
  r.hacked=false;
  r.security="ONLINE";
  v32EmitState(r);
  cb({ok:true,state:v32PublicState(r)});
 });

 s.on("v32-firewall-failed",(d={},cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p)return cb({ok:false});
  p.firewallChallenge=null;
  // V36: 미니게임 실패로 Firewall 칸은 감소하지 않는다.
  // Firewall은 시간 경과에 의해서만 감소한다.
  v32EmitState(r);
  cb({ok:true,kept:true,state:v32PublicState(r)});
 });

 s.on("v32-pay-hacker",(d={},cb=()=>{})=>{
  const r=rooms.get(socketRoom.get(s.id)),p=r?.players.get(s.id);
  if(!r||!p||!r.hacked)return cb({ok:false,message:"현재 해킹 상태가 아닙니다."});

  // 해킹 해제 비용: 물 2 + 통조림 2 + 배터리 1
  const cost={water:2,beans:2,battery:1};
  for(const [type,n] of Object.entries(cost)){
    if((r.bunkerStock[type]||0)<n){
      return cb({ok:false,message:"해킹 해제 물자가 부족합니다. 물 2, 통조림 2, 배터리 1이 필요합니다.",cost});
    }
  }
  for(const [type,n] of Object.entries(cost))r.bunkerStock[type]-=n;

  r.hacked=false;
  r.firewall=1;
  r.security="RECOVERING";
  v32EmitState(r);
  io.to(r.code).emit("bunker-state",{bunkerStock:r.bunkerStock,security:r.security,power:r.power});
  cb({ok:true,state:v32PublicState(r),bunkerStock:r.bunkerStock});
 });
 s.on("leave-room",(cb=()=>{})=>{leave(s);cb({ok:true})});s.on("disconnect",()=>{
  socketAccounts.delete(s.id);leavePublicLobby(s);scheduleRoomDisconnect(s)})
});



// =========================================================
// 지속 스탯: DAY와 무관하게 계속 감소
// =========================================================
safeInterval(()=>{
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
safeInterval(()=>{
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

      if(damage>0 && !p.adminGodMode){
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
safeInterval(()=>{
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
safeInterval(()=>{
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
        mob.type==="bountyHunter"?(mob.speed||7):
        mob.type==="mutantRaider"?(mob.speed||4.9):
        mob.type==="raider"?(mob.speed||6.4):
        mob.type==="outsideMutant"?(mob.speed||5.8):
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
          mob.type==="bountyHunter"?(mob.damage||14):
          mob.type==="mutantRaider"?(mob.damage||18):
          mob.type==="raider"?(mob.damage||11):
          mob.type==="outsideMutant"?(mob.damage||12):
          mob.type==="rat"?7:
          mob.type==="spider"?9:
          14;

        if(!target.adminGodMode){
          target.hp=Math.max(0,target.hp-damage);

          io.to(r.code).emit("bunker-player-damaged",{
          id:target.id,
          hp:target.hp,
          damage,
          reason:mob.type
          });
        }
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
safeInterval(()=>{
  for(const r of rooms.values()){
    for(const p of r.players.values()){
      if(!p.inExpedition || !p.sick || (p.hp??0)<=0)continue;
      if(p.adminGodMode)continue;

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

// Hospital Abomination AI - V36.1
// patrol: 평상시 순찰
// investigate: 함정/유리 소리 위치로 빠르게 이동하지만 플레이어를 공격하지 않음
// chase: 인지 범위에서 움직이는 플레이어를 발견하면 멈칫 없이 즉시 추격, 죽을 때까지 추적
safeInterval(()=>{
  const now=Date.now();

  for(const r of rooms.values()){
    if(r.expeditionLocation!=="hospital")continue;

    const a=r.hospitalAbomination;
    if(!a)continue;

    const explorers=[...r.players.values()]
      .filter(p=>p.inExpedition&&(p.hp??0)>0);

    if(!explorers.length)continue;

    // 실제 플레이어 추격
    if(a.state==="chase" && a.chaseTargetId){
      const target=r.players.get(a.chaseTargetId);

      if(!target || !target.inExpedition || (target.hp??0)<=0){
        a.state="patrol";
        a.chaseTargetId=null;
        a.attacking=false;
        a.attackTargetId=null;
      }else{
        const tx=target.expeditionX+15;
        const ty=target.expeditionY+15;
        const dist=Math.hypot(tx-(a.x+18),ty-(a.y+18));

        // 공격 준비 때문에 정지하지 않고 계속 달려간다.
        if(dist>48){
          moveHospitalAbominationV26(a,target.expeditionX,target.expeditionY,22);
        }

        // 가까우면 즉시 공격. 접촉 자체는 여전히 즉사가 아니다.
        if(dist<=62 && now-(a.lastAttackAt||0)>=700){
          a.lastAttackAt=now;

          io.to(r.code).emit("hospital-abomination-attack",{
            x:a.x,y:a.y,targetId:target.id,attackEndsAt:now+120
          });

          if(!target.adminGodMode){
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

    }else if(a.state==="investigate" && now<=a.investigateUntil){
      // 함정 소리는 위치만 조사한다. 플레이어를 공격하지 않는다.
      a.attacking=false;
      a.attackTargetId=null;
      a.chaseTargetId=null;

      const ix=a.investigateX??a.x;
      const iy=a.investigateY??a.y;
      const d=Math.hypot(ix-a.x,iy-a.y);

      if(d>18){
        moveHospitalAbominationV26(a,ix,iy,19);
      }else{
        // 함정 위치 도착 후 잠깐 확인한 뒤 순찰 복귀
        a.investigateUntil=Math.min(a.investigateUntil,now+900);
      }

    }else{
      a.state="patrol";
      a.chaseTargetId=null;
      a.investigateUntil=0;
      a.investigateX=null;
      a.investigateY=null;
      a.attacking=false;
      a.attackTargetId=null;

      if(a.patrolX==null||a.patrolY==null){
        a.patrolX=HOSPITAL_PATROL_CENTER_V28.x;
        a.patrolY=HOSPITAL_PATROL_CENTER_V28.y;
        a.nextPatrolChoiceAt=now+10000;
        a.patrolPhase="center";
      }

      const reached=Math.hypot(a.patrolX-a.x,a.patrolY-a.y)<28;

      if(reached && now>=(a.nextPatrolChoiceAt||0)){
        const next=hospitalPatrolDestinationV28(a);
        a.patrolX=next.x;
        a.patrolY=next.y;
        a.nextPatrolChoiceAt=now+10000;
      }

      moveHospitalAbominationV26(a,a.patrolX,a.patrolY,3.2);
    }

    io.to(r.code).emit("hospital-abomination-moved",{
      x:a.x,
      y:a.y,
      alerted:a.state==="chase",
      state:a.state,
      attacking:false,
      attackWindupUntil:0,
      patrolPhase:a.patrolPhase
    });
  }
},120);

// =========================================================
// 탐사 돌연변이 AI
// =========================================================
safeInterval(()=>{
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
          if(!target.adminGodMode){
            target.hp=Math.max(0,(target.hp??100)-12);

            io.to(r.code).emit("explorer-damaged",{
            playerId:target.id,
            hp:target.hp,
            mutantId:mutant.id,
            damage:12
            });
          }
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
safeInterval(()=>{
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




// =========================================================

// =========================================================
// V37.2 RADIO EVENT TIMER
// =========================================================
safeInterval(()=>{
  const now=Date.now();
  for(const r of rooms.values()){
    if(r.status!=="playing" || !r.bunkerSystemsStarted || !r.radioState)continue;

    const rs=r.radioState;

    if(rs.homeless?.active && !rs.homeless.resolved && now>=rs.homeless.resolveAt){
      radioHomelessResolveV372(r);
    }

    // Guard outcome: periodically intercept one exterior threat.
    if(rs.homeless?.active && rs.homeless.resolved && rs.homeless.outcome==="guard"){
      if(!rs.homeless.nextGuardAt)rs.homeless.nextGuardAt=now+30000;
      if(now>=rs.homeless.nextGuardAt){
        const target=(r.outsideThreats||[]).find(t=>t.state!=="atDoor") || (r.outsideThreats||[])[0];
        if(target){
          r.outsideThreats=r.outsideThreats.filter(t=>t.id!==target.id);
          io.to(r.code).emit("v3713-exterior-threats",{
            threats:r.outsideThreats.map(v3713ThreatPublic)
          });
          radioPushHistoryV372(r,"경비 NPC가 외부 위협 1개를 처리함");
        }
        rs.homeless.nextGuardAt=now+30000;
      }
    }

    // Mold outcome: hygiene slowly drops.
    if(rs.homeless?.active && rs.homeless.resolved && rs.homeless.outcome==="mold"){
      if(!rs.homeless.nextMoldAt)rs.homeless.nextMoldAt=now+15000;
      if(now>=rs.homeless.nextMoldAt){
        for(const p of r.players.values()){
          if(!p.inBunker)continue;
          p.hygiene=Math.max(0,(p.hygiene??100)-4);
          io.to(p.id).emit("personal-stats",{
            hp:p.hp,hunger:p.hunger,thirst:p.thirst,hygiene:p.hygiene,
            fatigue:p.fatigue,sanityStat:p.sanityStat
          });
        }
        rs.homeless.nextMoldAt=now+15000;
      }
    }

    // V37.2.2: 랜덤 신호는 사용하지 않음.
    // 플레이어가 특정 주파수를 직접 선택해야 이벤트가 발생한다.
  }
},3000);

// V37.1-5 EXTERIOR THREATS - DOOR DEFENSE ATTACK
// 외부 적은 문 앞에 도착하면 Door Defense를 실제로 공격한다.
safeInterval(()=>{
  const now=Date.now();

  for(const r of rooms.values()){
    if(r.status!=="playing" || !r.bunkerSystemsStarted)continue;

    if(!Number.isFinite(r.nextExteriorThreatAt)){
      r.nextExteriorThreatAt=now+30000+Math.floor(Math.random()*30000);
    }

    if(now>=r.nextExteriorThreatAt){
      v3713SpawnExteriorThreat(r);
      r.nextExteriorThreatAt=now+30000+Math.floor(Math.random()*45000);
    }

    let changed=false;
    let defenseChanged=false;

    const yardTarget={x:.58,y:.60};
    const bunkerDoorTarget={x:.79,y:.59};

    for(const t of r.outsideThreats||[]){
      if(t.state==="wandering"){
        t.x += (t.driftX||0);
        t.y += (t.driftY||0);

        if(t.x<.03 || t.x>.97)t.driftX=-(t.driftX||.001);
        if(t.y<.46 || t.y>.68)t.driftY=-(t.driftY||.0005);

        t.x=Math.max(.03,Math.min(.97,t.x));
        t.y=Math.max(.46,Math.min(.68,t.y));

        if(now >= (t.approachAt||0)){
          t.state="approachingYard";
        }
        changed=true;
      }

      if(t.state==="approachingYard"){
        const dx=yardTarget.x-t.x;
        const dy=yardTarget.y-t.y;
        const dist=Math.hypot(dx,dy)||1;

        const speed=
          t.type==="mutantRaider" ? .006 :
          t.type==="raider" ? .009 :
          .0075;

        t.x += dx/dist*speed;
        t.y += dy/dist*speed;

        if(dist<.035){
          t.state="approachingDoor";
        }
        changed=true;
      }

      if(t.state==="approachingDoor"){
        const dx=bunkerDoorTarget.x-t.x;
        const dy=bunkerDoorTarget.y-t.y;
        const dist=Math.hypot(dx,dy)||1;

        const speed=
          t.type==="mutantRaider" ? .0045 :
          t.type==="raider" ? .007 :
          .006;

        t.x += dx/dist*speed;
        t.y += dy/dist*speed;

        if(dist<.022){
          t.x=bunkerDoorTarget.x;
          t.y=bunkerDoorTarget.y;
          t.state="atDoor";
          t.arrivedAt=now;
          t.lastAttackAt=now;
        }
        changed=true;
      }

      if(t.state==="atDoor"){
        t.x=bunkerDoorTarget.x;
        t.y=bunkerDoorTarget.y;

        // Door Defense 0은 다음 단계에서 실제 breach로 연결.
        if((r.doorDefense??100)>0 && now-(t.lastAttackAt||0)>=1000){
          t.lastAttackAt=now;
          const damage=Math.max(1,t.attackPower||1);
          r.doorDefense=Math.max(0,(r.doorDefense??100)-damage);
          defenseChanged=true;

          io.to(r.code).emit("v3715-door-hit",{
            threatId:t.id,
            type:t.type,
            damage,
            doorDefense:r.doorDefense,
            critical:r.doorDefense<=10,
            warning:r.doorDefense<=30
          });
        }
        changed=true;
      }
    }

    // Door Defense가 0이 되면 문 앞의 적이 실제 벙커 내부로 침입
    if((r.doorDefense??100)<=0){
      if(v3716BreachExteriorThreats(r)){
        changed=true;
      }
    }

    const before=(r.outsideThreats||[]).length;
    r.outsideThreats=(r.outsideThreats||[]).filter(t=>
      t.state==="atDoor" || now-(t.spawnedAt||now)<240000
    );
    if(r.outsideThreats.length!==before)changed=true;

    if(defenseChanged){
      io.to(r.code).emit("v37-door-defense",{
        doorDefense:r.doorDefense
      });
    }

    if(changed){
      io.to(r.code).emit("v3713-exterior-threats",{
        threats:r.outsideThreats.map(v3713ThreatPublic)
      });
    }
  }
},1000);

// V37.0: Door Defense는 시간이 지나면서 천천히 감소.
// 다음 단계에서 외부 적의 문 공격 피해가 추가된다.
safeInterval(()=>{
  for(const r of rooms.values()){
    if(r.status!=="playing"||!r.bunkerSystemsStarted)continue;
    if(r.doorBreached)continue;
    // 평상시 자연 감소
    r.doorDefense=Math.max(0,(r.doorDefense??100)-1);
    io.to(r.code).emit("v37-door-defense",{
      doorDefense:r.doorDefense,
      doorBreached:!!r.doorBreached
    });
  }
},60000);

// V32: 전력/Firewall은 DAY와 무관하게 지속 감소
safeInterval(()=>{
  for(const r of rooms.values()){
    if(r.status!=="playing"||!r.bunkerSystemsStarted)continue;
    r.power=Math.max(0,(r.power??100)-4);
    if(r.power<=0)r.blackout=true;
    v32EmitState(r);
  }
},V32_POWER_TICK_MS);

safeInterval(()=>{
  for(const r of rooms.values()){
    if(r.status!=="playing"||!r.bunkerSystemsStarted||r.hacked)continue;
    r.firewall=Math.max(0,(r.firewall??6)-1);
    if(r.firewall<=0){
      r.firewall=0;
      r.hacked=true;
      r.security="HACKED";
      io.to(r.code).emit("computer-hacked",{message:"컴퓨터가 해킹당했습니다."});
    }else if(r.firewall<=2){
      r.security="ALERT";
    }
    v32EmitState(r);
  }
},90000);

async function startServer(){
  try{
    await initDatabase();

    const port=Number(process.env.PORT)||3000;

    server.listen(port,"0.0.0.0",()=>{
      console.log(`[AFTERGLOW V37.3.0] server listening on ${port}`);
      console.log("[V31] Neon DB ready");
    });
  }catch(e){
    console.error("[DB FATAL]",e);
    process.exit(1);
  }
}
startServer();
