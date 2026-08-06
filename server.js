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

const HAND_LIMIT = 4;
const ROUND_MS = 95_000;

const ITEM_DEFS = {
  beans:     { slots: 1, special: false },
  water:     { slots: 1, special: false },
  soap:      { slots: 1, special: false },
  tape:      { slots: 1, special: false },
  trap:      { slots: 1, special: false },
  spray:     { slots: 1, special: false },
  medkit:    { slots: 2, special: false },
  battery:   { slots: 2, special: false },
  flashlight:{ slots: 2, special: false },

  mask:      { slots: 2, special: true },
  axe:       { slots: 3, special: true },
  backpack:  { slots: 4, special: true },
  blueprint: { slots: 1, special: true },
  toolbox:   { slots: 4, special: true },
  map:       { slots: 1, special: true },
  radio:     { slots: 3, special: true }
};

const BUNKER = {
  floor: 1,
  x: 1100,
  y: 720,
  w: 280,
  h: 200
};

const ZONES = {
  kitchen: [
    { floor: 1, x: 260, y: 230 },
    { floor: 1, x: 360, y: 240 },
    { floor: 1, x: 470, y: 260 },
    { floor: 1, x: 300, y: 420 },
    { floor: 1, x: 440, y: 420 },
    { floor: 1, x: 570, y: 360 }
  ],
  pantry: [
    { floor: 1, x: 650, y: 240 },
    { floor: 1, x: 700, y: 330 },
    { floor: 1, x: 650, y: 440 }
  ],
  living: [
    { floor: 1, x: 1000, y: 250 },
    { floor: 1, x: 1170, y: 270 },
    { floor: 1, x: 1370, y: 300 },
    { floor: 1, x: 1030, y: 500 },
    { floor: 1, x: 1350, y: 500 }
  ],
  bathroom1: [
    { floor: 1, x: 1770, y: 250 },
    { floor: 1, x: 1860, y: 350 },
    { floor: 1, x: 1780, y: 480 }
  ],
  garage: [
    { floor: 1, x: 270, y: 1030 },
    { floor: 1, x: 430, y: 1080 },
    { floor: 1, x: 630, y: 1040 },
    { floor: 1, x: 760, y: 1170 }
  ],
  bedroom2: [
    { floor: 2, x: 300, y: 260 },
    { floor: 2, x: 470, y: 300 },
    { floor: 2, x: 600, y: 430 },
    { floor: 2, x: 360, y: 540 }
  ],
  study2: [
    { floor: 2, x: 1060, y: 250 },
    { floor: 2, x: 1210, y: 280 },
    { floor: 2, x: 1360, y: 410 }
  ],
  bathroom2: [
    { floor: 2, x: 1770, y: 260 },
    { floor: 2, x: 1860, y: 360 },
    { floor: 2, x: 1780, y: 490 }
  ],
  hall2: [
    { floor: 2, x: 900, y: 790 },
    { floor: 2, x: 1260, y: 790 },
    { floor: 2, x: 1560, y: 790 }
  ],
  attic: [
    { floor: 3, x: 350, y: 300 },
    { floor: 3, x: 570, y: 390 },
    { floor: 3, x: 850, y: 300 },
    { floor: 3, x: 1120, y: 430 },
    { floor: 3, x: 1490, y: 320 },
    { floor: 3, x: 1810, y: 430 }
  ]
};

function clean(value, maxLength) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function createCode() {
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

function roomForClient(room) {
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

function publicRoomList() {
  return [...rooms.values()]
    .filter(room => !room.private && room.status === "waiting")
    .map(room => ({
      code: room.code,
      name: room.name,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers
    }));
}

function emitRoomList() {
  io.emit("room-list", publicRoomList());
}

function emitRoom(room) {
  io.to(room.code).emit("room-updated", roomForClient(room));
  emitRoomList();
}

function shuffled(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function addItem(items, type, point) {
  items.push({
    id: `item-${items.length}`,
    type,
    slots: ITEM_DEFS[type].slots,
    floor: point.floor,
    x: point.x,
    y: point.y,
    taken: false
  });
}

function makeItems() {
  const items = [];

  // 음식과 물은 주방/팬트리에 집중
  const foodPoints = shuffled([...ZONES.kitchen, ...ZONES.pantry]);

  [
    "beans", "beans", "beans", "beans", "beans",
    "water", "water", "water", "water", "water"
  ].forEach((type, index) => {
    addItem(items, type, foodPoints[index % foodPoints.length]);
  });

  // 일반 생존 물품은 여러 층에 여러 개
  const normalPoints = shuffled([
    ...ZONES.living,
    ...ZONES.garage,
    ...ZONES.bedroom2,
    ...ZONES.study2,
    ...ZONES.hall2,
    ...ZONES.attic
  ]);

  [
    "soap", "soap",
    "tape", "tape",
    "trap", "trap",
    "spray", "spray",
    "medkit", "medkit",
    "battery", "battery", "battery",
    "flashlight", "flashlight"
  ].forEach((type, index) => {
    addItem(items, type, normalPoints[index % normalPoints.length]);
  });

  // 특수 아이템은 종류별로 정확히 1개씩
  addItem(
    items,
    "mask",
    pick([
      ...ZONES.bathroom1,
      ...ZONES.bathroom2,
      { floor: 1, x: 1650, y: 610 },
      { floor: 2, x: 1650, y: 610 }
    ])
  );

  addItem(
    items,
    "axe",
    pick([
      ...ZONES.garage,
      ...ZONES.attic,
      { floor: 1, x: 1640, y: 470 }
    ])
  );

  addItem(
    items,
    "backpack",
    pick([
      ...ZONES.bedroom2,
      { floor: 2, x: 660, y: 270 },
      { floor: 2, x: 950, y: 470 }
    ])
  );

  addItem(
    items,
    "blueprint",
    pick([
      { floor: 2, x: 1090, y: 250 },
      { floor: 2, x: 1220, y: 250 },
      { floor: 2, x: 1360, y: 250 }
    ])
  );

  addItem(
    items,
    "toolbox",
    pick([
      ...ZONES.garage,
      { floor: 3, x: 870, y: 500 }
    ])
  );

  addItem(
    items,
    "map",
    pick([
      { floor: 1, x: 1240, y: 340 },
      { floor: 2, x: 1180, y: 360 },
      { floor: 3, x: 1410, y: 310 }
    ])
  );

  addItem(
    items,
    "radio",
    pick([
      { floor: 1, x: 1080, y: 360 },
      { floor: 2, x: 1340, y: 360 },
      { floor: 3, x: 1720, y: 360 }
    ])
  );

  return items;
}

function usedSlots(player) {
  return player.hands.reduce(
    (sum, type) => sum + (ITEM_DEFS[type]?.slots || 1),
    0
  );
}

function leaveCurrentRoom(socket) {
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

  const usedColors = new Set(
    [...room.players.values()].map(player => player.color)
  );

  const color =
    COLORS.find(candidate => !usedColors.has(candidate)) ||
    COLORS[Math.floor(Math.random() * COLORS.length)];

  const player = {
    id: socket.id,
    nickname: safeName,
    ready: false,
    color,
    floor: 1,
    x: 1190,
    y: 790,
    hands: [],
    stored: []
  };

  room.players.set(socket.id, player);
  socketRoom.set(socket.id, room.code);
  socket.join(room.code);

  callback({
    ok: true,
    room: roomForClient(room),
    myId: socket.id
  });

  emitRoom(room);
}

io.on("connection", socket => {
  socket.emit("room-list", publicRoomList());

  socket.on("get-room-list", () => {
    socket.emit("room-list", publicRoomList());
  });

  socket.on("create-room", (payload, callback = () => {}) => {
    if (socketRoom.has(socket.id)) {
      return callback({ ok: false, message: "이미 다른 방에 있습니다." });
    }

    const nickname = clean(payload?.nickname, 14);
    const roomName = clean(payload?.roomName, 24);

    if (!nickname || !roomName) {
      return callback({
        ok: false,
        message: "닉네임과 방 제목을 입력하세요."
      });
    }

    const roomCode = createCode();

    const player = {
      id: socket.id,
      nickname,
      ready: true,
      color: COLORS[0],
      floor: 1,
      x: 1190,
      y: 790,
      hands: [],
      stored: []
    };

    const room = {
      code: roomCode,
      name: roomName,
      private: Boolean(payload?.private),
      maxPlayers: Math.max(
        1,
        Math.min(8, parseInt(payload?.maxPlayers, 10) || 4)
      ),
      hostId: socket.id,
      status: "waiting",
      players: new Map([[socket.id, player]]),
      items: [],
      endsAt: 0
    };

    rooms.set(roomCode, room);
    socketRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    callback({
      ok: true,
      room: roomForClient(room),
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
      return callback({
        ok: false,
        message: "입장 가능한 공개방이 없습니다."
      });
    }

    joinRoom(socket, room, payload?.nickname, callback);
  });

  socket.on("toggle-ready", (callback = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room) {
      return callback({ ok: false, message: "방 정보가 없습니다." });
    }

    if (room.hostId === socket.id) {
      return callback({
        ok: false,
        message: "방장은 항상 준비 상태입니다."
      });
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
      return callback({
        ok: false,
        message: "방장만 시작할 수 있습니다."
      });
    }

    const unready = [...room.players.values()].some(
      player => player.id !== room.hostId && !player.ready
    );

    if (unready) {
      return callback({
        ok: false,
        message: "모든 플레이어가 준비해야 합니다."
      });
    }

    room.status = "playing";
    room.items = makeItems();
    room.endsAt = Date.now() + ROUND_MS;

    let index = 0;

    for (const player of room.players.values()) {
      player.floor = 1;
      player.x = 1160 + (index % 3) * 42;
      player.y = 780 + Math.floor(index / 3) * 42;
      player.hands = [];
      player.stored = [];
      index += 1;
    }

    callback({ ok: true });

    io.to(room.code).emit("game-started", {
      endsAt: room.endsAt,
      items: room.items,
      bunker: BUNKER,
      handLimit: HAND_LIMIT,
      itemDefs: ITEM_DEFS,
      players: [...room.players.values()]
    });

    emitRoomList();
  });

  socket.on("player-move", data => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room || room.status !== "playing") return;

    const player = room.players.get(socket.id);

    if (!player) return;

    const x = Number(data?.x);
    const y = Number(data?.y);
    const floor = Number(data?.floor);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      ![1, 2, 3].includes(floor)
    ) {
      return;
    }

    player.x = Math.max(20, Math.min(2380, x));
    player.y = Math.max(20, Math.min(1580, y));
    player.floor = floor;

    socket.to(room.code).emit("player-moved", {
      id: player.id,
      x: player.x,
      y: player.y,
      floor: player.floor
    });
  });

  socket.on("take-item", (itemId, callback = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room || room.status !== "playing") {
      return callback({
        ok: false,
        message: "게임이 진행 중이 아닙니다."
      });
    }

    const player = room.players.get(socket.id);
    const item = room.items.find(candidate => candidate.id === itemId);

    if (
      !player ||
      !item ||
      item.taken ||
      item.floor !== player.floor
    ) {
      return callback({
        ok: false,
        message: "아이템을 획득할 수 없습니다."
      });
    }

    const itemSlots = ITEM_DEFS[item.type]?.slots || 1;
    const nextSlots = usedSlots(player) + itemSlots;

    if (nextSlots > HAND_LIMIT) {
      return callback({
        ok: false,
        message: `손 공간이 부족합니다. 이 아이템은 ${itemSlots}칸이 필요합니다.`
      });
    }

    const distance = Math.hypot(
      player.x + 15 - item.x,
      player.y + 15 - item.y
    );

    if (distance > 82) {
      return callback({
        ok: false,
        message: "아이템과 거리가 너무 멉니다."
      });
    }

    item.taken = true;
    player.hands.push(item.type);

    io.to(room.code).emit("item-taken", {
      itemId,
      playerId: player.id,
      type: item.type,
      hands: player.hands,
      usedSlots: usedSlots(player)
    });

    callback({
      ok: true,
      hands: player.hands,
      usedSlots: usedSlots(player)
    });
  });

  socket.on("deposit-items", (callback = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));

    if (!room || room.status !== "playing") {
      return callback({
        ok: false,
        message: "게임이 진행 중이 아닙니다."
      });
    }

    const player = room.players.get(socket.id);

    if (!player || player.floor !== 1) {
      return callback({
        ok: false,
        message: "1층 벙커에서만 보관할 수 있습니다."
      });
    }

    const centerX = player.x + 15;
    const centerY = player.y + 15;

    const insideBunker =
      centerX >= BUNKER.x &&
      centerX <= BUNKER.x + BUNKER.w &&
      centerY >= BUNKER.y &&
      centerY <= BUNKER.y + BUNKER.h;

    if (!insideBunker) {
      return callback({
        ok: false,
        message: "벙커 안에서 F키를 누르세요."
      });
    }

    if (player.hands.length === 0) {
      return callback({
        ok: false,
        message: "보관할 아이템이 없습니다."
      });
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

  socket.on("leave-room", (callback = () => {}) => {
    leaveCurrentRoom(socket);
    callback({ ok: true });
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Item collection server running on ${PORT}`);
});
