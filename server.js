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

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = "";
    for (let i = 0; i < 6; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));

  return code;
}

function roomForClient(room) {
  return {
    code: room.code,
    name: room.name,
    private: room.private,
    maxPlayers: room.maxPlayers,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      ready: player.ready,
    })),
  };
}

function publicRoomList() {
  return [...rooms.values()]
    .filter((room) => !room.private && room.status === "waiting")
    .map((room) => ({
      code: room.code,
      name: room.name,
      playerCount: room.players.length,
      maxPlayers: room.maxPlayers,
      status: room.status,
    }))
    .sort((a, b) => b.playerCount - a.playerCount);
}

function emitRoomList() {
  io.emit("room-list", publicRoomList());
}

function emitRoom(room) {
  io.to(room.code).emit("room-updated", roomForClient(room));
  emitRoomList();
}

function leaveCurrentRoom(socket) {
  const roomCode = socketRoom.get(socket.id);
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  socketRoom.delete(socket.id);
  socket.leave(roomCode);

  if (!room) return;

  room.players = room.players.filter((player) => player.id !== socket.id);

  if (room.players.length === 0) {
    rooms.delete(roomCode);
    emitRoomList();
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
    room.players[0].ready = true;
  }

  emitRoom(room);
}

function joinRoom(socket, room, nickname, callback) {
  if (socketRoom.has(socket.id)) {
    return callback({ ok: false, message: "이미 다른 방에 참가 중입니다." });
  }

  if (room.status !== "waiting") {
    return callback({ ok: false, message: "이미 게임이 시작된 방입니다." });
  }

  if (room.players.length >= room.maxPlayers) {
    return callback({ ok: false, message: "방 인원이 가득 찼습니다." });
  }

  const safeNickname = cleanText(nickname, 14);
  if (!safeNickname) {
    return callback({ ok: false, message: "닉네임을 입력하세요." });
  }

  if (
    room.players.some(
      (player) => player.nickname.toLowerCase() === safeNickname.toLowerCase()
    )
  ) {
    return callback({ ok: false, message: "방 안에서 이미 사용 중인 닉네임입니다." });
  }

  const player = {
    id: socket.id,
    nickname: safeNickname,
    ready: false,
  };

  room.players.push(player);
  socketRoom.set(socket.id, room.code);
  socket.join(room.code);

  callback({ ok: true, room: roomForClient(room), myId: socket.id });
  emitRoom(room);
}

io.on("connection", (socket) => {
  socket.emit("room-list", publicRoomList());

  socket.on("get-room-list", () => {
    socket.emit("room-list", publicRoomList());
  });

  socket.on("create-room", (payload, callback = () => {}) => {
    if (socketRoom.has(socket.id)) {
      return callback({ ok: false, message: "이미 다른 방에 참가 중입니다." });
    }

    const nickname = cleanText(payload?.nickname, 14);
    const roomName = cleanText(payload?.roomName, 24);

    if (!nickname || !roomName) {
      return callback({ ok: false, message: "닉네임과 방 제목을 입력하세요." });
    }

    const maxPlayers = Math.min(
      8,
      Math.max(2, Number.parseInt(payload?.maxPlayers, 10) || 4)
    );

    const code = createRoomCode();
    const room = {
      code,
      name: roomName,
      private: Boolean(payload?.private),
      maxPlayers,
      status: "waiting",
      hostId: socket.id,
      players: [
        {
          id: socket.id,
          nickname,
          ready: true,
        },
      ],
    };

    rooms.set(code, room);
    socketRoom.set(socket.id, code);
    socket.join(code);

    callback({ ok: true, room: roomForClient(room), myId: socket.id });
    emitRoom(room);
  });

  socket.on("join-room", (payload, callback = () => {}) => {
    const code = cleanText(payload?.code, 6).toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return callback({ ok: false, message: "해당 방을 찾을 수 없습니다." });
    }

    joinRoom(socket, room, payload?.nickname, callback);
  });

  socket.on("quick-join", (payload, callback = () => {}) => {
    const room = [...rooms.values()].find(
      (candidate) =>
        !candidate.private &&
        candidate.status === "waiting" &&
        candidate.players.length < candidate.maxPlayers
    );

    if (!room) {
      return callback({ ok: false, message: "입장 가능한 공개방이 없습니다." });
    }

    joinRoom(socket, room, payload?.nickname, callback);
  });

  socket.on("toggle-ready", (callback = () => {}) => {
    const roomCode = socketRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room || room.status !== "waiting") {
      return callback({ ok: false, message: "대기 중인 방이 아닙니다." });
    }

    if (room.hostId === socket.id) {
      return callback({ ok: false, message: "방장은 항상 준비 상태입니다." });
    }

    const player = room.players.find((item) => item.id === socket.id);
    if (!player) {
      return callback({ ok: false, message: "플레이어 정보를 찾을 수 없습니다." });
    }

    player.ready = !player.ready;
    callback({ ok: true });
    emitRoom(room);
  });

  socket.on("start-game", (callback = () => {}) => {
    const roomCode = socketRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      return callback({ ok: false, message: "방 정보를 찾을 수 없습니다." });
    }

    if (room.hostId !== socket.id) {
      return callback({ ok: false, message: "방장만 게임을 시작할 수 있습니다." });
    }

    if (room.players.length < 2) {
      return callback({ ok: false, message: "최소 2명이 필요합니다." });
    }

    const unready = room.players.filter(
      (player) => player.id !== room.hostId && !player.ready
    );

    if (unready.length > 0) {
      return callback({
        ok: false,
        message: `${unready.map((player) => player.nickname).join(", ")} 님이 준비하지 않았습니다.`,
      });
    }

    room.status = "playing";
    callback({ ok: true });

    io.to(room.code).emit("game-started", {
      roomCode: room.code,
      players: room.players.map((player, index) => ({
        id: player.id,
        nickname: player.nickname,
        spawnIndex: index,
      })),
      countdown: 5,
    });

    emitRoomList();
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
  console.log(`Room server running at http://localhost:${PORT}`);
});
