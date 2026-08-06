"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const socketRoom = new Map();

const COLORS = [
  "#ff6b6b", "#4dabf7", "#69db7c", "#ffd43b",
  "#da77f2", "#ffa94d", "#38d9a9", "#f06595"
];

const ITEM_TYPES = [
  "beans", "water", "soap", "tape", "trap", "spray",
  "medkit", "battery", "toolbox",
  "backpack", "blueprint", "flashlight", "mask", "map", "radio"
];

const SPAWN_POINTS = [
  {x:240,y:240},{x:520,y:240},{x:900,y:220},{x:1320,y:240},
  {x:1770,y:240},{x:2110,y:250},{x:270,y:650},{x:650,y:650},
  {x:1040,y:620},{x:1430,y:650},{x:1880,y:650},{x:2150,y:700},
  {x:260,y:1060},{x:650,y:1100},{x:1010,y:1080},{x:1430,y:1090},
  {x:1820,y:1110},{x:2160,y:1080},{x:420,y:1400},{x:900,y:1410},
  {x:1370,y:1400},{x:1850,y:1400},{x:2210,y:1370}
];

function clean(v, n) {
  return String(v ?? "").replace(/[<>]/g, "").trim().slice(0, n);
}

function code() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result;
  do {
    result = Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  } while (rooms.has(result));
  return result;
}

function publicRoom(room) {
  return {
    code: room.code,
    name: room.name,
    private: room.private,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    status: room.status,
    players: [...room.players.values()].map(p => ({
      id:p.id, nickname:p.nickname, ready:p.ready, color:p.color
    }))
  };
}

function listRooms() {
  return [...rooms.values()]
    .filter(r => !r.private && r.status === "waiting")
    .map(r => ({
      code:r.code, name:r.name, playerCount:r.players.size,
      maxPlayers:r.maxPlayers, status:r.status
    }));
}

function emitList() {
  io.emit("room-list", listRooms());
}

function emitRoom(room) {
  io.to(room.code).emit("room-updated", publicRoom(room));
  emitList();
}

function makeItems() {
  const points = [...SPAWN_POINTS].sort(() => Math.random() - .5);
  return points.slice(0, 18).map((point, i) => ({
    id: `item-${i}`,
    type: ITEM_TYPES[Math.floor(Math.random()*ITEM_TYPES.length)],
    x: point.x,
    y: point.y,
    taken: false
  }));
}

function leave(socket) {
  const roomCode = socketRoom.get(socket.id);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  socketRoom.delete(socket.id);
  socket.leave(roomCode);
  if (!room) return;

  room.players.delete(socket.id);
  if (!room.players.size) {
    rooms.delete(roomCode);
    emitList();
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
    room.players.get(room.hostId).ready = true;
  }
  emitRoom(room);
}

function join(socket, room, nickname, cb) {
  if (room.status !== "waiting") return cb({ok:false,message:"이미 시작된 방입니다."});
  if (room.players.size >= room.maxPlayers) return cb({ok:false,message:"방이 가득 찼습니다."});
  const name = clean(nickname, 14);
  if (!name) return cb({ok:false,message:"닉네임을 입력하세요."});
  if ([...room.players.values()].some(p => p.nickname.toLowerCase() === name.toLowerCase())) {
    return cb({ok:false,message:"같은 닉네임이 이미 있습니다."});
  }

  const used = new Set([...room.players.values()].map(p => p.color));
  const color = COLORS.find(c => !used.has(c)) || COLORS[Math.floor(Math.random()*COLORS.length)];
  const p = {id:socket.id,nickname:name,ready:false,color,x:1200,y:800,inventory:[]};
  room.players.set(socket.id,p);
  socketRoom.set(socket.id, room.code);
  socket.join(room.code);
  cb({ok:true,room:publicRoom(room),myId:socket.id});
  emitRoom(room);
}

io.on("connection", socket => {
  socket.emit("room-list", listRooms());

  socket.on("get-room-list", () => socket.emit("room-list", listRooms()));

  socket.on("create-room", (payload, cb=()=>{}) => {
    if (socketRoom.has(socket.id)) return cb({ok:false,message:"이미 방에 있습니다."});
    const name = clean(payload?.nickname,14);
    const roomName = clean(payload?.roomName,24);
    if (!name || !roomName) return cb({ok:false,message:"닉네임과 방 제목을 입력하세요."});

    const roomCode = code();
    const player = {id:socket.id,nickname:name,ready:true,color:COLORS[0],x:1200,y:800,inventory:[]};
    const room = {
      code:roomCode,name:roomName,private:Boolean(payload?.private),
      maxPlayers:Math.max(2,Math.min(8,parseInt(payload?.maxPlayers)||4)),
      hostId:socket.id,status:"waiting",players:new Map([[socket.id,player]]),
      items:[],endsAt:0,mapSeed:0
    };
    rooms.set(roomCode,room);
    socketRoom.set(socket.id,roomCode);
    socket.join(roomCode);
    cb({ok:true,room:publicRoom(room),myId:socket.id});
    emitRoom(room);
  });

  socket.on("join-room", (payload, cb=()=>{}) => {
    const room = rooms.get(clean(payload?.code,6).toUpperCase());
    if (!room) return cb({ok:false,message:"방을 찾을 수 없습니다."});
    join(socket,room,payload?.nickname,cb);
  });

  socket.on("quick-join", (payload, cb=()=>{}) => {
    const room = [...rooms.values()].find(r => !r.private && r.status==="waiting" && r.players.size<r.maxPlayers);
    if (!room) return cb({ok:false,message:"입장 가능한 공개방이 없습니다."});
    join(socket,room,payload?.nickname,cb);
  });

  socket.on("toggle-ready", (cb=()=>{}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room) return cb({ok:false,message:"방 정보가 없습니다."});
    if (room.hostId === socket.id) return cb({ok:false,message:"방장은 항상 준비 상태입니다."});
    const p = room.players.get(socket.id);
    p.ready = !p.ready;
    cb({ok:true});
    emitRoom(room);
  });

  socket.on("start-game", (cb=()=>{}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room) return cb({ok:false,message:"방 정보가 없습니다."});
    if (room.hostId !== socket.id) return cb({ok:false,message:"방장만 시작할 수 있습니다."});
    if (room.players.size < 1) return cb({ok:false,message:"플레이어가 필요합니다."});
    if ([...room.players.values()].some(p => p.id!==room.hostId && !p.ready)) {
      return cb({ok:false,message:"모든 플레이어가 준비해야 합니다."});
    }

    room.status = "playing";
    room.items = makeItems();
    room.mapSeed = Math.floor(Math.random() * 1000000000);
    room.endsAt = Date.now() + 65000;
    let index = 0;
    for (const p of room.players.values()) {
      p.x = 1120 + (index%3)*55;
      p.y = 790 + Math.floor(index/3)*55;
      p.inventory = [];
      index++;
    }
    cb({ok:true});
    io.to(room.code).emit("game-started", {
      endsAt:room.endsAt,
      items:room.items,
      mapSeed:room.mapSeed,
      players:[...room.players.values()]
    });
    emitList();
  });

  socket.on("player-move", data => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.status!=="playing") return;
    const p = room.players.get(socket.id);
    if (!p) return;
    const x = Number(data?.x), y = Number(data?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    p.x = Math.max(20,Math.min(2380,x));
    p.y = Math.max(20,Math.min(1580,y));
    socket.to(room.code).emit("player-moved",{id:p.id,x:p.x,y:p.y});
  });

  socket.on("take-item", (itemId, cb=()=>{}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.status!=="playing") return cb({ok:false});
    const p = room.players.get(socket.id);
    const item = room.items.find(i=>i.id===itemId);
    if (!p || !item || item.taken) return cb({ok:false});
    const dx=p.x-item.x, dy=p.y-item.y;
    if (Math.hypot(dx,dy)>75) return cb({ok:false});
    item.taken=true;
    p.inventory.push(item.type);
    io.to(room.code).emit("item-taken",{itemId,playerId:p.id,type:item.type});
    cb({ok:true});
  });

  socket.on("leave-room", (cb=()=>{}) => { leave(socket); cb({ok:true}); });
  socket.on("disconnect", () => leave(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT,"0.0.0.0",()=>console.log(`Server running on ${PORT}`));
