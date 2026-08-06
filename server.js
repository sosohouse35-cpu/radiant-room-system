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
  "medkit", "battery", "toolbox", "backpack",
  "blueprint", "flashlight", "mask", "map", "radio"
];

const SPAWN_POINTS = [
  {x:240,y:240},{x:520,y:240},{x:900,y:220},{x:1320,y:240},
  {x:1770,y:240},{x:2110,y:250},{x:270,y:650},{x:650,y:650},
  {x:1040,y:620},{x:1430,y:650},{x:1880,y:650},{x:2150,y:700},
  {x:260,y:1060},{x:650,y:1100},{x:1010,y:1080},{x:1430,y:1090},
  {x:1820,y:1110},{x:2160,y:1080},{x:420,y:1400},{x:900,y:1410},
  {x:1370,y:1400},{x:1850,y:1400},{x:2210,y:1370}
];

const BUNKER = { x: 1080, y: 740, w: 240, h: 180 };
const PLAYER_SIZE = 30;
const HAND_LIMIT = 4;

function clean(value, maxLength) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result;
  do {
    result = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
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
    players: [...room.players.values()].map(player => ({
      id: player.id,
      nickname: player.nickname,
      ready: player.ready,
      color: player.color
    }))
  };
}

function listRooms() {
  return [...rooms.values()]
    .filter(room => !room.private && room.status === "waiting")
    .map(room => ({
      code: room.code,
      name: room.name,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      status: room.status
    }));
}

function emitRoomList() {
  io.emit("room-list", listRooms());
}

function emitRoom(room) {
  io.to(room.code).emit("room-updated", publicRoom(room));
  emitRoomList();
}

function makeItems() {
  const shuffledPoints = [...SPAWN_POINTS].sort(() => Math.random() - 0.5);

  // 일반 아이템은 여러 개 나올 수 있고, 특수 아이템은 최대 한 개만 생성합니다.
  const commonTypes = [
    "beans", "beans", "water", "water", "soap", "tape",
    "trap", "spray", "medkit", "battery", "battery", "flashlight"
  ];
  const specialTypes = ["toolbox", "backpack", "blueprint", "mask", "map", "radio"];

  const generated = [];
  const count = Math.min(20, shuffledPoints.length);

  for (let index = 0; index < count; index += 1) {
    let type;

    if (index < 15) {
      type = commonTypes[Math.floor(Math.random() * commonTypes.length)];
    } else {
      type = specialTypes[index - 15] || commonTypes[Math.floor(Math.random() * commonTypes.length)];
    }

    generated.push({
      id: `item-${index}`,
      type,
      x: shuffledPoints[index].x,
      y: shuffledPoints[index].y,
      taken: false
    });
  }

  return generated;
}

function leaveRoom(socket) {
  const roomCode = socketRoom.get(socket.id);
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  socketRoom.delete(socket.id);
  socket.leave(roomCode);

  if (!room) return;

  room.players.delete(socket.id);

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    emitRoomList();
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
    room.players.get(room.hostId).ready = true;
  }

  emitRoom(room);
}

function joinRoom(socket, room, nickname, callback) {
  if (room.status !== "waiting") {
    return callback({ ok: false, message: "이미 시작된 방입니다." });
  }

  if (room.players.size >= room.maxPlayers) {
    return callback({ ok: false, message: "방이 가득 찼습니다." });
  }

  const safeName = clean(nickname, 14);

  if (!safeName) {
    return callback({ ok: false, message: "닉네임을 입력하세요." });
  }

  if (
    [...room.players.values()].some(
      player => player.nickname.toLowerCase() === safeName.toLowerCase()
    )
  ) {
    return callback({ ok: false, message: "같은 닉네임이 이미 있습니다." });
  }

  const usedColors = new Set([...room.players.values()].map(player => player.color));
  const color =
    COLORS.find(candidate => !usedColors.has(candidate)) ||
    COLORS[Math.floor(Math.random() * COLORS.length)];

  const player = {
    id: socket.id,
    nickname: safeName,
    ready: false,
    color,
    x: BUNKER.x + BUNKER.w / 2 - PLAYER_SIZE / 2,
    y: BUNKER.y + BUNKER.h / 2 - PLAYER_SIZE / 2,
    hands: [],
    stored: [],
    alive: true
  };

  room.players.set(socket.id, player);
  socketRoom.set(socket.id, room.code);
  socket.join(room.code);

  callback({
    ok: true,
    room: publicRoom(room),
    myId: socket.id
  });

  emitRoom(room);
}

io.on("connection", socket => {
  socket.emit("room-list", listRooms());

  socket.on("get-room-list", () => {
    socket.emit("room-list", listRooms());
  });

  socket.on("create-room", (payload, callback = () => {}) => {
    if (socketRoom.has(socket.id)) {
      return callback({ ok: false, message: "이미 방에 있습니다." });
    }

    const nickname = clean(payload?.nickname, 14);
    const roomName = clean(payload?.roomName, 24);

    if (!nickname || !roomName) {
      return callback({ ok: false, message: "닉네임과 방 제목을 입력하세요." });
    }

    const roomCode = createRoomCode();

    const player = {
      id: socket.id,
      nickname,
      ready: true,
      color: COLORS[0],
      x: BUNKER.x + BUNKER.w / 2 - PLAYER_SIZE / 2,
      y: BUNKER.y + BUNKER.h / 2 - PLAYER_SIZE / 2,
      hands: [],
      stored: [],
      alive: true
    };

    const room = {
      code: roomCode,
      name: roomName,
      private: Boolean(payload?.private),
      maxPlayers: Math.max(2, Math.min(8, parseInt(payload?.maxPlayers, 10) || 4)),
      hostId: socket.id,
      status: "waiting",
      players: new Map([[socket.id, player]]),
      items: [],
      endsAt: 0,
      mapSeed: 0
    };

    rooms.set(roomCode, room);
    socketRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    callback({
      ok: true,
      room: publicRoom(room),
      myId: socket.id
    });

    emitRoom(room);
  });

  socket.on("join-room", (payload, callback = () => {}) => {
    const room = rooms.get(clean(payload?.code, 6).toUpperCase());

    if (!room) {
      return callback({ ok: false, message: "방을 찾을 수 없습니다." });
    }

    joinRoom(socket, room, payload?.nickname, callback);
  });

  socket.on("quick-join", (payload, callback = () => {}) => {
    const room = [...rooms.values()].find(candidate =>
      !candidate.private &&
      candidate.status === "waiting" &&
      candidate.players.size < candidate.maxPlayers
    );

    if (!room) {
      return callback({ ok: false, message: "입장 가능한 공개방이 없습니다." });
    }

    joinRoom(socket, room, payload?.nickname, callback);
  });

  socket.on("toggle-ready", (callback = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room) {
      return callback({ ok: false, message: "방 정보가 없습니다." });
    }

    if (room.hostId === socket.id) {
      return callback({ ok: false, message: "방장은 항상 준비 상태입니다." });
    }

    const player = room.players.get(socket.id);
    player.ready = !player.ready;

    callback({ ok: true });
    emitRoom(room);
  });

  socket.on("start-game", (callback = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room) {
      return callback({ ok: false, message: "방 정보가 없습니다." });
    }

    if (room.hostId !== socket.id) {
      return callback({ ok: false, message: "방장만 시작할 수 있습니다." });
    }

    const unreadyPlayers = [...room.players.values()].filter(
      player => player.id !== room.hostId && !player.ready
    );

    if (unreadyPlayers.length > 0) {
      return callback({ ok: false, message: "모든 플레이어가 준비해야 합니다." });
    }

    room.status = "playing";
    room.items = makeItems();
    room.mapSeed = Math.floor(Math.random() * 1000000000);
    room.endsAt = Date.now() + 65000;

    let index = 0;

    for (const player of room.players.values()) {
      player.x = BUNKER.x + 60 + (index % 3) * 46;
      player.y = BUNKER.y + 65 + Math.floor(index / 3) * 46;
      player.hands = [];
      player.stored = [];
      player.alive = true;
      index += 1;
    }

    callback({ ok: true });

    io.to(room.code).emit("game-started", {
      endsAt: room.endsAt,
      items: room.items,
      mapSeed: room.mapSeed,
      bunker: BUNKER,
      handLimit: HAND_LIMIT,
      players: [...room.players.values()]
    });

    emitRoomList();
  });

  socket.on("player-move", data => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room || room.status !== "playing") return;

    const player = room.players.get(socket.id);

    if (!player || !player.alive) return;

    const x = Number(data?.x);
    const y = Number(data?.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    player.x = Math.max(20, Math.min(2380, x));
    player.y = Math.max(20, Math.min(1580, y));

    socket.to(room.code).emit("player-moved", {
      id: player.id,
      x: player.x,
      y: player.y
    });
  });

  socket.on("take-item", (itemId, callback = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room || room.status !== "playing") {
      return callback({ ok: false, message: "게임이 진행 중이 아닙니다." });
    }

    const player = room.players.get(socket.id);
    const item = room.items.find(candidate => candidate.id === itemId);

    if (!player || !player.alive || !item || item.taken) {
      return callback({ ok: false, message: "아이템을 획득할 수 없습니다." });
    }

    if (player.hands.length >= HAND_LIMIT) {
      return callback({ ok: false, message: "손 4칸이 모두 찼습니다." });
    }

    const dx = player.x + PLAYER_SIZE / 2 - item.x;
    const dy = player.y + PLAYER_SIZE / 2 - item.y;

    if (Math.hypot(dx, dy) > 75) {
      return callback({ ok: false, message: "아이템과 거리가 너무 멉니다." });
    }

    item.taken = true;
    player.hands.push(item.type);

    io.to(room.code).emit("item-taken", {
      itemId,
      playerId: player.id,
      type: item.type,
      hands: player.hands
    });

    callback({
      ok: true,
      hands: player.hands
    });
  });

  socket.on("deposit-items", (callback = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room || room.status !== "playing") {
      return callback({ ok: false, message: "게임이 진행 중이 아닙니다." });
    }

    const player = room.players.get(socket.id);

    if (!player || !player.alive) {
      return callback({ ok: false, message: "플레이어 상태를 확인할 수 없습니다." });
    }

    const centerX = player.x + PLAYER_SIZE / 2;
    const centerY = player.y + PLAYER_SIZE / 2;

    const insideBunker =
      centerX >= BUNKER.x &&
      centerX <= BUNKER.x + BUNKER.w &&
      centerY >= BUNKER.y &&
      centerY <= BUNKER.y + BUNKER.h;

    if (!insideBunker) {
      return callback({ ok: false, message: "벙커 안에서만 보관할 수 있습니다." });
    }

    if (player.hands.length === 0) {
      return callback({ ok: false, message: "보관할 아이템이 없습니다." });
    }

    const deposited = [...player.hands];
    player.stored.push(...deposited);
    player.hands = [];

    io.to(room.code).emit("items-deposited", {
      playerId: player.id,
      deposited,
      hands: player.hands,
      stored: player.stored
    });

    callback({
      ok: true,
      hands: player.hands,
      stored: player.stored
    });
  });

  socket.on("player-died", () => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room || room.status !== "playing") return;

    const player = room.players.get(socket.id);

    if (!player || !player.alive) return;

    player.alive = false;

    io.to(room.code).emit("player-died", {
      playerId: player.id,
      nickname: player.nickname
    });
  });

  socket.on("leave-room", (callback = () => {}) => {
    leaveRoom(socket);
    callback({ ok: true });
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
