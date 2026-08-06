"use strict";

const socket = io();
const byId = id => document.getElementById(id);

const screens = {
  home: byId("homeScreen"),
  lobby: byId("lobbyScreen"),
  game: byId("gameScreen")
};

let currentRoom = null;
let myId = null;
let toastTimer = null;

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => {
    element.classList.toggle("active", key === name);
  });
}

function showToast(message) {
  byId("toast").textContent = message;
  byId("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => byId("toast").classList.remove("show"), 2200);
}

function nickname() {
  const value = byId("nickname").value.trim();

  if (value) {
    localStorage.setItem("afterglow-nickname", value);
  }

  return value;
}

byId("nickname").value =
  localStorage.getItem("afterglow-nickname") || "";

function handleJoin(response) {
  if (!response?.ok) {
    showToast(response?.message || "요청을 처리하지 못했습니다.");
    return;
  }

  currentRoom = response.room;
  myId = response.myId;

  renderLobby();
  showScreen("lobby");

  if (byId("createDialog").open) {
    byId("createDialog").close();
  }
}

function renderRooms(rooms) {
  const list = byId("roomList");
  list.innerHTML = "";

  if (!rooms.length) {
    list.innerHTML = "<p>공개방이 없습니다.</p>";
    return;
  }

  rooms.forEach(room => {
    const card = document.createElement("div");
    card.className = "room-card";

    const text = document.createElement("span");
    text.textContent = `${room.name} (${room.playerCount}/${room.maxPlayers})`;

    const button = document.createElement("button");
    button.textContent = "참가";
    button.addEventListener("click", () => {
      socket.emit(
        "join-room",
        { nickname: nickname(), code: room.code },
        handleJoin
      );
    });

    card.append(text, button);
    list.appendChild(card);
  });
}

function renderLobby() {
  if (!currentRoom) return;

  byId("lobbyName").textContent = currentRoom.name;
  byId("copyCodeButton").textContent = currentRoom.code;
  byId("playerList").innerHTML = "";

  currentRoom.players.forEach(player => {
    const card = document.createElement("div");
    card.className = "player-card";

    card.innerHTML = `
      <span>
        <i style="
          display:inline-block;
          width:14px;
          height:14px;
          margin-right:8px;
          background:${player.color}
        "></i>
        ${player.nickname}
        ${player.id === currentRoom.hostId ? " (방장)" : ""}
      </span>
      <b>${player.ready ? "준비" : "대기"}</b>
    `;

    byId("playerList").appendChild(card);
  });

  const isHost = myId === currentRoom.hostId;

  byId("readyButton").classList.toggle("hidden", isHost);
  byId("startButton").classList.toggle("hidden", !isHost);
}

byId("openCreateButton").addEventListener("click", () => {
  if (!nickname()) {
    showToast("닉네임을 입력하세요.");
    return;
  }

  byId("createDialog").showModal();
});

byId("closeCreateButton").addEventListener("click", () => {
  byId("createDialog").close();
});

byId("createForm").addEventListener("submit", event => {
  event.preventDefault();

  socket.emit(
    "create-room",
    {
      nickname: nickname(),
      roomName: byId("roomName").value,
      maxPlayers: byId("maxPlayers").value,
      private: byId("privateRoom").checked
    },
    handleJoin
  );
});

byId("joinCodeButton").addEventListener("click", () => {
  socket.emit(
    "join-room",
    {
      nickname: nickname(),
      code: byId("roomCodeInput").value.toUpperCase()
    },
    handleJoin
  );
});

byId("quickJoinButton").addEventListener("click", () => {
  socket.emit(
    "quick-join",
    { nickname: nickname() },
    handleJoin
  );
});

byId("refreshButton").addEventListener("click", () => {
  socket.emit("get-room-list");
});

byId("readyButton").addEventListener("click", () => {
  socket.emit("toggle-ready", response => {
    if (!response?.ok) {
      showToast(response?.message || "준비 상태를 바꾸지 못했습니다.");
    }
  });
});

byId("startButton").addEventListener("click", () => {
  socket.emit("start-game", response => {
    if (!response?.ok) {
      showToast(response?.message || "게임을 시작하지 못했습니다.");
    }
  });
});

byId("leaveButton").addEventListener("click", () => {
  socket.emit("leave-room", () => location.reload());
});

byId("copyCodeButton").addEventListener("click", async () => {
  if (!currentRoom) return;

  try {
    await navigator.clipboard.writeText(currentRoom.code);
    showToast("방 코드가 복사되었습니다.");
  } catch {
    showToast(`방 코드: ${currentRoom.code}`);
  }
});

socket.on("connect", () => {
  byId("connectionDot").classList.add("online");
  byId("connectionText").textContent = "연결됨";
});

socket.on("disconnect", () => {
  byId("connectionDot").classList.remove("online");
  byId("connectionText").textContent = "연결 끊김";
});

socket.on("room-list", renderRooms);

socket.on("room-updated", room => {
  currentRoom = room;
  renderLobby();
});

/* =========================================================
   게임
========================================================= */

const canvas = byId("gameCanvas");
const context = canvas.getContext("2d");

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;
const TILE_SIZE = 40;
const PLAYER_SIZE = 30;
const PLAYER_SPEED = 230;

const columns = WORLD_WIDTH / TILE_SIZE;
const rows = WORLD_HEIGHT / TILE_SIZE;

const grid = Array.from(
  { length: rows },
  () => Array(columns).fill(0)
);

const ITEM_ICONS = {
  beans: "🥫",
  water: "💧",
  soap: "🧼",
  tape: "🩹",
  trap: "🪤",
  spray: "🧯",
  medkit: "💊",
  battery: "🔋",
  toolbox: "🧰",
  backpack: "🎒",
  blueprint: "📘",
  flashlight: "🔦",
  mask: "😷",
  map: "🗺️",
  radio: "📻"
};

let players = {};
let items = [];
let bunker = { x: 1080, y: 740, w: 240, h: 180 };
let handLimit = 4;

let me = {
  x: bunker.x + 105,
  y: bunker.y + 75,
  color: "#ffffff",
  hands: [],
  stored: [],
  alive: true
};

let pressedKeys = new Set();
let gameRunning = false;
let gameEnded = false;
let lastFrameTime = 0;
let gameEndsAt = 0;
let lastPositionSend = 0;
let depositCooldown = false;

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;

  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function seededRandom(seed) {
  let value = (Number(seed) || 1) >>> 0;

  return function random() {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function clearMap() {
  for (let row = 0; row < rows; row += 1) {
    grid[row].fill(0);
  }
}

function wallRect(x, y, width, height) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      if (
        row >= 0 &&
        row < rows &&
        column >= 0 &&
        column < columns
      ) {
        grid[row][column] = 1;
      }
    }
  }
}

function clearRect(x, y, width = 1, height = 1) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      if (grid[row]) {
        grid[row][column] = 0;
      }
    }
  }
}

function buildMap(seed = 1) {
  clearMap();

  const random = seededRandom(seed);
  const pick = list => list[Math.floor(random() * list.length)];

  wallRect(0, 0, columns, 1);
  wallRect(0, rows - 1, columns, 1);
  wallRect(0, 0, 1, rows);
  wallRect(columns - 1, 0, 1, rows);

  wallRect(2, 3, 25, 1);
  wallRect(2, 3, 1, 14);
  wallRect(26, 3, 1, 14);
  wallRect(2, 16, 25, 1);

  wallRect(27, 3, 14, 1);
  wallRect(40, 3, 1, 14);
  wallRect(27, 16, 14, 1);

  wallRect(41, 3, 16, 1);
  wallRect(56, 3, 1, 14);
  wallRect(41, 16, 16, 1);

  wallRect(2, 17, 18, 1);
  wallRect(2, 17, 1, 18);
  wallRect(19, 17, 1, 18);
  wallRect(2, 34, 18, 1);

  wallRect(20, 17, 21, 1);
  wallRect(40, 17, 1, 18);
  wallRect(20, 34, 21, 1);

  wallRect(41, 17, 16, 1);
  wallRect(56, 17, 1, 18);
  wallRect(41, 34, 16, 1);

  const dividerSets = [
    [8, 15, 33, 48],
    [9, 16, 32, 47],
    [7, 14, 34, 49]
  ];

  const dividers = pick(dividerSets);

  wallRect(dividers[0], 3, 1, 13);
  wallRect(dividers[1], 3, 1, 13);
  wallRect(dividers[2], 3, 1, 13);
  wallRect(dividers[3], 3, 1, 13);

  clearRect(pick([4, 5, 6]), 16, 2);
  clearRect(pick([21, 22, 23]), 16, 2);
  clearRect(pick([34, 35, 36]), 16, 2);
  clearRect(pick([49, 50, 51]), 16, 2);

  clearRect(19, pick([22, 24, 27]), 1, 3);
  clearRect(40, pick([22, 24, 27]), 1, 3);

  clearRect(dividers[0], pick([7, 9, 11]), 1, 2);
  clearRect(dividers[1], pick([8, 10, 12]), 1, 2);
  clearRect(dividers[2], pick([7, 10, 12]), 1, 2);
  clearRect(dividers[3], pick([8, 10, 12]), 1, 2);

  const furnitureLayouts = [
    [
      [5, 7, 4, 2],
      [18, 6, 5, 2],
      [29, 7, 3, 4],
      [44, 7, 5, 2],
      [5, 22, 5, 2],
      [12, 28, 4, 3],
      [25, 22, 7, 2],
      [47, 24, 5, 4]
    ],
    [
      [5, 10, 5, 2],
      [18, 5, 3, 4],
      [29, 11, 5, 2],
      [45, 7, 3, 4],
      [4, 27, 4, 3],
      [11, 21, 6, 2],
      [27, 27, 5, 3],
      [47, 20, 6, 2]
    ],
    [
      [4, 7, 3, 5],
      [17, 11, 5, 2],
      [29, 5, 5, 2],
      [44, 11, 5, 2],
      [5, 22, 3, 5],
      [12, 30, 5, 2],
      [24, 22, 4, 4],
      [49, 27, 4, 3]
    ]
  ];

  pick(furnitureLayouts).forEach(furniture => {
    wallRect(...furniture);
  });

  // 벙커 내부와 출입구는 항상 이동 가능하게 유지합니다.
  clearRect(26, 17, 9, 7);
}

function playerBlocked(x, y) {
  const corners = [
    [x, y],
    [x + PLAYER_SIZE - 1, y],
    [x, y + PLAYER_SIZE - 1],
    [x + PLAYER_SIZE - 1, y + PLAYER_SIZE - 1]
  ];

  return corners.some(([pointX, pointY]) => {
    const column = Math.floor(pointX / TILE_SIZE);
    const row = Math.floor(pointY / TILE_SIZE);

    return grid[row]?.[column] === 1;
  });
}

function playerInsideBunker(player) {
  const centerX = player.x + PLAYER_SIZE / 2;
  const centerY = player.y + PLAYER_SIZE / 2;

  return (
    centerX >= bunker.x &&
    centerX <= bunker.x + bunker.w &&
    centerY >= bunker.y &&
    centerY <= bunker.y + bunker.h
  );
}

function renderHands() {
  const slots = [...document.querySelectorAll(".hand-slot")];

  slots.forEach((slot, index) => {
    const type = me.hands[index];

    slot.classList.toggle("filled", Boolean(type));
    slot.textContent = type ? ITEM_ICONS[type] || "📦" : "✋";
    slot.title = type || "빈손";
  });

  byId("storedItems").textContent =
    me.stored.length > 0
      ? `보관함: ${me.stored.map(type => ITEM_ICONS[type] || "📦").join(" ")}`
      : "보관함: 비어 있음";
}

function drawMap(cameraX, cameraY, viewportWidth, viewportHeight) {
  const minColumn = Math.max(0, Math.floor(cameraX / TILE_SIZE) - 1);
  const maxColumn = Math.min(
    columns - 1,
    Math.ceil((cameraX + viewportWidth) / TILE_SIZE) + 1
  );

  const minRow = Math.max(0, Math.floor(cameraY / TILE_SIZE) - 1);
  const maxRow = Math.min(
    rows - 1,
    Math.ceil((cameraY + viewportHeight) / TILE_SIZE) + 1
  );

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const screenX = column * TILE_SIZE - cameraX;
      const screenY = row * TILE_SIZE - cameraY;

      if (grid[row][column] === 1) {
        // 벽과 가구의 위치가 항상 보이도록 어둠/원형 시야를 사용하지 않습니다.
        context.fillStyle = "#51493d";
        context.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);

        context.strokeStyle = "#7a705f";
        context.lineWidth = 2;
        context.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
      } else {
        context.fillStyle =
          (row + column) % 2 === 0
            ? "#272c23"
            : "#232820";

        context.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);

        context.strokeStyle = "rgba(255,255,255,0.025)";
        context.lineWidth = 1;
        context.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

function drawBunker(cameraX, cameraY) {
  const screenX = bunker.x - cameraX;
  const screenY = bunker.y - cameraY;

  context.fillStyle = "rgba(214,240,85,0.13)";
  context.fillRect(screenX, screenY, bunker.w, bunker.h);

  context.strokeStyle = "#d6f055";
  context.lineWidth = 4;
  context.strokeRect(screenX, screenY, bunker.w, bunker.h);

  context.fillStyle = "#d6f055";
  context.font = "bold 16px Malgun Gothic";
  context.fillText("벙커 아이템 보관소", screenX + 20, screenY + 30);
}

function drawItems(cameraX, cameraY) {
  items
    .filter(item => !item.taken)
    .forEach(item => {
      context.font = "26px sans-serif";
      context.fillText(
        ITEM_ICONS[item.type] || "📦",
        item.x - cameraX,
        item.y - cameraY
      );
    });
}

function drawPlayers(cameraX, cameraY) {
  Object.values(players).forEach(player => {
    if (player.id === myId) return;
    if (player.alive === false) return;

    context.fillStyle = player.color;
    context.fillRect(
      player.x - cameraX,
      player.y - cameraY,
      PLAYER_SIZE,
      PLAYER_SIZE
    );

    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.strokeRect(
      player.x - cameraX,
      player.y - cameraY,
      PLAYER_SIZE,
      PLAYER_SIZE
    );

    context.fillStyle = "#ffffff";
    context.font = "12px Malgun Gothic";
    context.fillText(
      player.nickname,
      player.x - cameraX - 4,
      player.y - cameraY - 7
    );
  });
}

function drawLocalPlayer(viewportWidth, viewportHeight) {
  // 내 캐릭터의 화면 좌표는 절대로 변경하지 않습니다.
  // 월드 좌표가 변할 때 카메라만 반대 방향으로 이동합니다.
  const screenX = viewportWidth / 2 - PLAYER_SIZE / 2;
  const screenY = viewportHeight / 2 - PLAYER_SIZE / 2;

  context.fillStyle = me.color;
  context.fillRect(screenX, screenY, PLAYER_SIZE, PLAYER_SIZE);

  context.strokeStyle = "#ffffff";
  context.lineWidth = 3;
  context.strokeRect(screenX, screenY, PLAYER_SIZE, PLAYER_SIZE);
}

function drawGame() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // 카메라를 플레이어 월드 좌표에 맞추므로 캐릭터는 항상 화면 중앙입니다.
  // 가장자리에서도 캐릭터가 움직여 보이지 않도록 카메라를 제한하지 않습니다.
  const cameraX =
    me.x + PLAYER_SIZE / 2 - viewportWidth / 2;

  const cameraY =
    me.y + PLAYER_SIZE / 2 - viewportHeight / 2;

  context.clearRect(0, 0, viewportWidth, viewportHeight);
  context.fillStyle = "#0d0f0c";
  context.fillRect(0, 0, viewportWidth, viewportHeight);

  drawMap(cameraX, cameraY, viewportWidth, viewportHeight);
  drawBunker(cameraX, cameraY);
  drawItems(cameraX, cameraY);
  drawPlayers(cameraX, cameraY);
  drawLocalPlayer(viewportWidth, viewportHeight);
}

function finishByTime() {
  if (gameEnded) return;

  gameEnded = true;
  gameRunning = false;

  if (playerInsideBunker(me)) {
    byId("bunkerMessage").textContent =
      "폭발 순간 벙커 안에 있어 생존했습니다.";

    showToast("생존했습니다.");
  } else {
    me.alive = false;
    socket.emit("player-died");
    byId("deathOverlay").classList.remove("hidden");
  }
}

function updateGame(timestamp) {
  if (!gameRunning) return;

  const deltaTime = Math.min(
    (timestamp - lastFrameTime) / 1000,
    0.05
  ) || 0;

  lastFrameTime = timestamp;

  let directionX =
    (
      pressedKeys.has("d") ||
      pressedKeys.has("arrowright")
        ? 1
        : 0
    ) -
    (
      pressedKeys.has("a") ||
      pressedKeys.has("arrowleft")
        ? 1
        : 0
    );

  let directionY =
    (
      pressedKeys.has("s") ||
      pressedKeys.has("arrowdown")
        ? 1
        : 0
    ) -
    (
      pressedKeys.has("w") ||
      pressedKeys.has("arrowup")
        ? 1
        : 0
    );

  if (directionX !== 0 && directionY !== 0) {
    directionX *= 0.7071;
    directionY *= 0.7071;
  }

  const nextX =
    me.x + directionX * PLAYER_SPEED * deltaTime;

  const nextY =
    me.y + directionY * PLAYER_SPEED * deltaTime;

  if (!playerBlocked(nextX, me.y)) {
    me.x = nextX;
  }

  if (!playerBlocked(me.x, nextY)) {
    me.y = nextY;
  }

  if (me.hands.length < handLimit) {
    items.forEach(item => {
      if (item.taken) return;

      const distance = Math.hypot(
        me.x + PLAYER_SIZE / 2 - item.x,
        me.y + PLAYER_SIZE / 2 - item.y
      );

      if (distance < 45) {
        socket.emit("take-item", item.id, response => {
          if (!response?.ok && response?.message) {
            showToast(response.message);
          }
        });
      }
    });
  }

  if (
    playerInsideBunker(me) &&
    me.hands.length > 0 &&
    !depositCooldown
  ) {
    byId("bunkerMessage").textContent =
      "벙커 안입니다. 오른쪽 아래의 ‘벙커에 보관’을 누르세요.";
  } else if (!playerInsideBunker(me)) {
    byId("bunkerMessage").textContent =
      me.hands.length >= handLimit
        ? "손 4칸이 찼습니다. 벙커로 돌아가 보관하세요."
        : "아이템을 모은 뒤 벙커로 돌아오세요.";
  }

  if (timestamp - lastPositionSend > 60) {
    socket.emit("player-move", {
      x: me.x,
      y: me.y
    });

    lastPositionSend = timestamp;
  }

  const remaining = Math.max(
    0,
    Math.ceil((gameEndsAt - Date.now()) / 1000)
  );

  byId("timer").textContent = remaining;

  if (remaining <= 0) {
    finishByTime();
    drawGame();
    return;
  }

  drawGame();
  requestAnimationFrame(updateGame);
}

document.addEventListener("keydown", event => {
  pressedKeys.add(event.key.toLowerCase());
});

document.addEventListener("keyup", event => {
  pressedKeys.delete(event.key.toLowerCase());
});

document.querySelectorAll("[data-dir]").forEach(button => {
  const key = {
    up: "w",
    down: "s",
    left: "a",
    right: "d"
  }[button.dataset.dir];

  button.addEventListener("pointerdown", event => {
    event.preventDefault();
    pressedKeys.add(key);
  });

  const release = () => {
    pressedKeys.delete(key);
  };

  button.addEventListener("pointerup", release);
  button.addEventListener("pointerleave", release);
  button.addEventListener("pointercancel", release);
});

byId("depositButton").addEventListener("click", () => {
  if (!playerInsideBunker(me)) {
    showToast("벙커 안에서만 보관할 수 있습니다.");
    return;
  }

  if (me.hands.length === 0) {
    showToast("보관할 아이템이 없습니다.");
    return;
  }

  depositCooldown = true;

  socket.emit("deposit-items", response => {
    depositCooldown = false;

    if (!response?.ok) {
      showToast(response?.message || "보관하지 못했습니다.");
      return;
    }

    me.hands = [...response.hands];
    me.stored = [...response.stored];

    renderHands();
    showToast("아이템을 벙커에 보관했습니다.");
  });
});

byId("deathReturnButton").addEventListener("click", () => {
  location.reload();
});

socket.on("game-started", data => {
  showScreen("game");

  buildMap(data.mapSeed || 1);

  players = {};

  data.players.forEach(player => {
    players[player.id] = { ...player };
  });

  me = {
    ...players[myId],
    hands: [...(players[myId]?.hands || [])],
    stored: [...(players[myId]?.stored || [])],
    alive: true
  };

  bunker = data.bunker || bunker;
  handLimit = data.handLimit || 4;
  items = data.items;
  gameEndsAt = data.endsAt;
  gameEnded = false;

  renderHands();

  let countdown = 5;
  byId("countdown").textContent = countdown;
  byId("countdownOverlay").classList.remove("hidden");
  byId("deathOverlay").classList.add("hidden");

  const countdownTimer = setInterval(() => {
    countdown -= 1;

    byId("countdown").textContent =
      countdown > 0
        ? countdown
        : "GO";

    if (countdown < 0) {
      clearInterval(countdownTimer);
      byId("countdownOverlay").classList.add("hidden");
      gameRunning = true;
      lastFrameTime = performance.now();
      requestAnimationFrame(updateGame);
    }
  }, 1000);
});

socket.on("player-moved", data => {
  if (!players[data.id]) return;

  players[data.id].x = data.x;
  players[data.id].y = data.y;
});

socket.on("item-taken", data => {
  const item = items.find(candidate => candidate.id === data.itemId);

  if (item) {
    item.taken = true;
  }

  if (data.playerId === myId) {
    me.hands = [...data.hands];
    renderHands();
  }
});

socket.on("items-deposited", data => {
  if (data.playerId !== myId) return;

  me.hands = [...data.hands];
  me.stored = [...data.stored];

  renderHands();
});

socket.on("player-died", data => {
  if (players[data.playerId]) {
    players[data.playerId].alive = false;
  }

  if (data.playerId !== myId) {
    showToast(`${data.nickname} 님이 사망했습니다.`);
  }
});
