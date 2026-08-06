"use strict";

const socket = io();
const $ = id => document.getElementById(id);

const screens = {
  home: $("homeScreen"),
  lobby: $("lobbyScreen"),
  game: $("gameScreen")
};

let currentRoom = null;
let myId = null;
let toastTimer = null;

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle("active", key === name);
  });
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    $("toast").classList.remove("show");
  }, 2200);
}

function nickname() {
  const value = $("nickname").value.trim();

  if (value) {
    localStorage.setItem("afterglow-nickname", value);
  }

  return value;
}

$("nickname").value =
  localStorage.getItem("afterglow-nickname") || "";

function handleJoin(response) {
  if (!response?.ok) {
    toast(response?.message || "요청 실패");
    return;
  }

  currentRoom = response.room;
  myId = response.myId;

  renderLobby();
  showScreen("lobby");

  if ($("createDialog").open) {
    $("createDialog").close();
  }
}

function renderRooms(rooms) {
  $("roomList").innerHTML = "";

  if (!rooms.length) {
    $("roomList").innerHTML = "<p>공개방이 없습니다.</p>";
    return;
  }

  rooms.forEach(room => {
    const card = document.createElement("div");
    card.className = "room-card";

    const text = document.createElement("span");
    text.textContent =
      `${room.name} (${room.playerCount}/${room.maxPlayers})`;

    const button = document.createElement("button");
    button.textContent = "참가";

    button.addEventListener("click", () => {
      socket.emit(
        "join-room",
        {
          nickname: nickname(),
          code: room.code
        },
        handleJoin
      );
    });

    card.append(text, button);
    $("roomList").appendChild(card);
  });
}

function renderLobby() {
  if (!currentRoom) return;

  $("lobbyName").textContent = currentRoom.name;
  $("copyCodeButton").textContent = currentRoom.code;
  $("playerList").innerHTML = "";

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

    $("playerList").appendChild(card);
  });

  const isHost = myId === currentRoom.hostId;

  $("readyButton").classList.toggle("hidden", isHost);
  $("startButton").classList.toggle("hidden", !isHost);
}

$("openCreateButton").addEventListener("click", () => {
  if (!nickname()) {
    toast("닉네임을 입력하세요.");
    return;
  }

  $("createDialog").showModal();
});

$("closeCreateButton").addEventListener("click", () => {
  $("createDialog").close();
});

$("createForm").addEventListener("submit", event => {
  event.preventDefault();

  socket.emit(
    "create-room",
    {
      nickname: nickname(),
      roomName: $("roomName").value,
      maxPlayers: $("maxPlayers").value,
      private: $("privateRoom").checked
    },
    handleJoin
  );
});

$("joinCodeButton").addEventListener("click", () => {
  socket.emit(
    "join-room",
    {
      nickname: nickname(),
      code: $("roomCodeInput").value.toUpperCase()
    },
    handleJoin
  );
});

$("quickJoinButton").addEventListener("click", () => {
  socket.emit(
    "quick-join",
    { nickname: nickname() },
    handleJoin
  );
});

$("refreshButton").addEventListener("click", () => {
  socket.emit("get-room-list");
});

$("readyButton").addEventListener("click", () => {
  socket.emit("toggle-ready", response => {
    if (!response?.ok) {
      toast(response?.message || "준비 변경 실패");
    }
  });
});

$("startButton").addEventListener("click", () => {
  socket.emit("start-game", response => {
    if (!response?.ok) {
      toast(response?.message || "게임 시작 실패");
    }
  });
});

$("leaveButton").addEventListener("click", () => {
  socket.emit("leave-room", () => location.reload());
});

$("copyCodeButton").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentRoom.code);
    toast("방 코드 복사 완료");
  } catch {
    toast(`방 코드: ${currentRoom.code}`);
  }
});

socket.on("connect", () => {
  $("connectionDot").classList.add("online");
  $("connectionText").textContent = "연결됨";
});

socket.on("disconnect", () => {
  $("connectionDot").classList.remove("online");
  $("connectionText").textContent = "연결 끊김";
});

socket.on("room-list", renderRooms);

socket.on("room-updated", room => {
  currentRoom = room;
  renderLobby();
});

/* =========================================================
   아이템 수집 게임
========================================================= */

const canvas = $("gameCanvas");
const context = canvas.getContext("2d");

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;
const TILE = 40;
const PLAYER_SIZE = 30;
const SPEED = 235;
const COLS = WORLD_WIDTH / TILE;
const ROWS = WORLD_HEIGHT / TILE;

const ITEM_ICONS = {
  beans: "🥫",
  water: "💧",
  soap: "🧼",
  tape: "🩹",
  trap: "🪤",
  spray: "🧯",
  medkit: "💊",
  battery: "🔋",
  flashlight: "🔦",
  mask: "😷",
  axe: "🪓",
  backpack: "🎒",
  blueprint: "📘",
  toolbox: "🧰",
  map: "🗺️",
  radio: "📻"
};

let itemDefs = {};
let handLimit = 4;
let bunker = null;
let grids = {};
let furniture = {};
let players = {};
let items = [];
let me = {};
let currentFloor = 1;
let keys = new Set();
let running = false;
let ended = false;
let lastFrame = 0;
let endsAt = 0;
let lastSend = 0;
let nearItem = null;

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;

  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function makeEmptyGrid() {
  return Array.from(
    { length: ROWS },
    () => Array(COLS).fill(0)
  );
}

function wall(grid, x, y, w, h) {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      if (grid[row]) {
        grid[row][column] = 1;
      }
    }
  }
}

function opening(grid, x, y, w = 1, h = 1) {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      if (grid[row]) {
        grid[row][column] = 0;
      }
    }
  }
}

function addFurniture(floor, x, y, w, h, type, label) {
  furniture[floor].push({
    x: x * TILE,
    y: y * TILE,
    w: w * TILE,
    h: h * TILE,
    type,
    label
  });

  wall(grids[floor], x, y, w, h);
}

function buildFloor1() {
  const grid = makeEmptyGrid();
  grids[1] = grid;
  furniture[1] = [];

  wall(grid, 0, 0, COLS, 1);
  wall(grid, 0, ROWS - 1, COLS, 1);
  wall(grid, 0, 0, 1, ROWS);
  wall(grid, COLS - 1, 0, 1, ROWS);

  // 주방
  wall(grid, 2, 3, 20, 1);
  wall(grid, 2, 3, 1, 13);
  wall(grid, 21, 3, 1, 13);
  wall(grid, 2, 15, 20, 1);

  // 거실
  wall(grid, 23, 3, 18, 1);
  wall(grid, 23, 3, 1, 13);
  wall(grid, 40, 3, 1, 13);
  wall(grid, 23, 15, 18, 1);

  // 욕실
  wall(grid, 42, 3, 15, 1);
  wall(grid, 42, 3, 1, 13);
  wall(grid, 56, 3, 1, 13);
  wall(grid, 42, 15, 15, 1);

  // 차고
  wall(grid, 2, 18, 20, 1);
  wall(grid, 2, 18, 1, 16);
  wall(grid, 21, 18, 1, 16);
  wall(grid, 2, 33, 20, 1);

  // 복도 + 벙커
  wall(grid, 23, 18, 34, 1);
  wall(grid, 23, 18, 1, 16);
  wall(grid, 56, 18, 1, 16);
  wall(grid, 23, 33, 34, 1);

  opening(grid, 9, 15, 3);
  opening(grid, 30, 15, 3);
  opening(grid, 48, 15, 2);
  opening(grid, 9, 18, 3);
  opening(grid, 31, 18, 3);

  addFurniture(1, 4, 5, 6, 2, "counter", "조리대");
  addFurniture(1, 13, 5, 5, 2, "counter", "싱크대");
  addFurniture(1, 5, 11, 4, 2, "table", "식탁");
  addFurniture(1, 25, 6, 5, 3, "sofa", "소파");
  addFurniture(1, 34, 5, 3, 2, "table", "탁자");
  addFurniture(1, 4, 22, 6, 3, "car", "차량");
  addFurniture(1, 13, 24, 4, 3, "shelf", "공구 선반");
  addFurniture(1, 45, 6, 3, 2, "bath", "욕조");

  // 벙커 내부 통로
  opening(grid, 27, 19, 8, 6);
}

function buildFloor2() {
  const grid = makeEmptyGrid();
  grids[2] = grid;
  furniture[2] = [];

  wall(grid, 0, 0, COLS, 1);
  wall(grid, 0, ROWS - 1, COLS, 1);
  wall(grid, 0, 0, 1, ROWS);
  wall(grid, COLS - 1, 0, 1, ROWS);

  // 침실
  wall(grid, 2, 3, 22, 1);
  wall(grid, 2, 3, 1, 15);
  wall(grid, 23, 3, 1, 15);
  wall(grid, 2, 17, 22, 1);

  // 서재
  wall(grid, 25, 3, 18, 1);
  wall(grid, 25, 3, 1, 15);
  wall(grid, 42, 3, 1, 15);
  wall(grid, 25, 17, 18, 1);

  // 욕실
  wall(grid, 44, 3, 13, 1);
  wall(grid, 44, 3, 1, 15);
  wall(grid, 56, 3, 1, 15);
  wall(grid, 44, 17, 13, 1);

  // 복도
  wall(grid, 2, 20, 55, 1);
  wall(grid, 2, 20, 1, 12);
  wall(grid, 56, 20, 1, 12);
  wall(grid, 2, 31, 55, 1);

  opening(grid, 10, 17, 3);
  opening(grid, 32, 17, 3);
  opening(grid, 49, 17, 2);
  opening(grid, 12, 20, 3);
  opening(grid, 30, 20, 3);
  opening(grid, 48, 20, 3);

  addFurniture(2, 4, 6, 7, 4, "bed", "침대");
  addFurniture(2, 14, 6, 5, 2, "desk", "책상");
  addFurniture(2, 27, 6, 6, 2, "desk", "큰 책상");
  addFurniture(2, 35, 10, 3, 4, "shelf", "책장");
  addFurniture(2, 47, 6, 4, 3, "bath", "욕조");
  addFurniture(2, 6, 24, 6, 2, "wardrobe", "옷장");
}

function buildFloor3() {
  const grid = makeEmptyGrid();
  grids[3] = grid;
  furniture[3] = [];

  wall(grid, 0, 0, COLS, 1);
  wall(grid, 0, ROWS - 1, COLS, 1);
  wall(grid, 0, 0, 1, ROWS);
  wall(grid, COLS - 1, 0, 1, ROWS);

  wall(grid, 3, 4, 54, 1);
  wall(grid, 3, 4, 1, 27);
  wall(grid, 56, 4, 1, 27);
  wall(grid, 3, 30, 54, 1);

  opening(grid, 28, 30, 4);

  addFurniture(3, 6, 8, 5, 4, "crate", "상자");
  addFurniture(3, 14, 8, 4, 3, "crate", "상자");
  addFurniture(3, 25, 8, 6, 2, "table", "작업대");
  addFurniture(3, 38, 8, 5, 4, "shelf", "낡은 선반");
  addFurniture(3, 48, 9, 4, 3, "crate", "큰 상자");
}

function buildMap() {
  buildFloor1();
  buildFloor2();
  buildFloor3();
}

function blocked(x, y, floor) {
  const grid = grids[floor];

  return [
    [x, y],
    [x + PLAYER_SIZE - 1, y],
    [x, y + PLAYER_SIZE - 1],
    [x + PLAYER_SIZE - 1, y + PLAYER_SIZE - 1]
  ].some(([pointX, pointY]) => {
    return (
      grid[Math.floor(pointY / TILE)]?.[
        Math.floor(pointX / TILE)
      ] === 1
    );
  });
}

function usedSlots() {
  return (me.hands || []).reduce(
    (sum, type) => sum + (itemDefs[type]?.slots || 1),
    0
  );
}

function renderHands() {
  const slots = [...document.querySelectorAll(".hand-slot")];

  slots.forEach(slot => {
    slot.textContent = "✋";
    slot.classList.remove("filled");
  });

  let cursor = 0;

  (me.hands || []).forEach(type => {
    const size = itemDefs[type]?.slots || 1;

    for (
      let index = 0;
      index < size && cursor < slots.length;
      index += 1, cursor += 1
    ) {
      slots[cursor].textContent =
        index === 0
          ? ITEM_ICONS[type] || "📦"
          : "▪";

      slots[cursor].classList.add("filled");
    }
  });

  $("storedItems").textContent =
    me.stored?.length
      ? `보관함: ${me.stored
          .map(type => ITEM_ICONS[type] || "📦")
          .join(" ")}`
      : "보관함: 비어 있음";
}

function roomNameAt(x, y, floor) {
  if (floor === 1) {
    if (x < 880 && y < 640) return "주방";
    if (x >= 920 && x < 1640 && y < 640) return "거실";
    if (x >= 1680 && y < 640) return "욕실";
    if (x < 880 && y >= 720) return "차고";
    return "벙커/복도";
  }

  if (floor === 2) {
    if (x < 960 && y < 720) return "침실";
    if (x >= 1000 && x < 1720 && y < 720) return "서재";
    if (x >= 1760 && y < 720) return "욕실";
    return "2층 복도";
  }

  return "다락방";
}

function drawMap(cameraX, cameraY, width, height) {
  const grid = grids[currentFloor];

  const minColumn = Math.max(
    0,
    Math.floor(cameraX / TILE) - 1
  );

  const maxColumn = Math.min(
    COLS - 1,
    Math.ceil((cameraX + width) / TILE) + 1
  );

  const minRow = Math.max(
    0,
    Math.floor(cameraY / TILE) - 1
  );

  const maxRow = Math.min(
    ROWS - 1,
    Math.ceil((cameraY + height) / TILE) + 1
  );

  for (let row = minRow; row <= maxRow; row += 1) {
    for (
      let column = minColumn;
      column <= maxColumn;
      column += 1
    ) {
      const screenX = column * TILE - cameraX;
      const screenY = row * TILE - cameraY;

      if (grid[row][column] === 1) {
        context.fillStyle = "#765f48";
        context.fillRect(screenX, screenY, TILE, TILE);

        context.strokeStyle = "#49372a";
        context.strokeRect(screenX, screenY, TILE, TILE);
      } else {
        context.fillStyle =
          (row + column) % 2
            ? "#eadbbc"
            : "#e4d2ae";

        context.fillRect(screenX, screenY, TILE, TILE);
      }
    }
  }
}

function drawFurniture(cameraX, cameraY) {
  const colors = {
    counter: "#bbb3a6",
    table: "#9d7048",
    sofa: "#7690a5",
    car: "#58616a",
    shelf: "#7c5a3c",
    bath: "#cedce2",
    bed: "#b99393",
    desk: "#8a633f",
    wardrobe: "#80654e",
    crate: "#8a6845"
  };

  furniture[currentFloor].forEach(object => {
    const screenX = object.x - cameraX;
    const screenY = object.y - cameraY;

    context.fillStyle =
      colors[object.type] || "#8a6845";

    context.fillRect(
      screenX,
      screenY,
      object.w,
      object.h
    );

    context.strokeStyle = "#49382a";

    context.strokeRect(
      screenX,
      screenY,
      object.w,
      object.h
    );

    context.fillStyle = "#2b241d";
    context.font = "12px Malgun Gothic";

    context.fillText(
      object.label,
      screenX + 6,
      screenY + 18
    );
  });
}

function drawBunker(cameraX, cameraY) {
  if (currentFloor !== 1) return;

  const screenX = bunker.x - cameraX;
  const screenY = bunker.y - cameraY;

  context.fillStyle = "rgba(143,180,78,0.22)";
  context.fillRect(
    screenX,
    screenY,
    bunker.w,
    bunker.h
  );

  context.strokeStyle = "#6c8d39";
  context.lineWidth = 3;

  context.strokeRect(
    screenX,
    screenY,
    bunker.w,
    bunker.h
  );

  context.fillStyle = "#425b22";
  context.font = "bold 16px Malgun Gothic";

  context.fillText(
    "벙커 보관소 · F",
    screenX + 20,
    screenY + 28
  );
}

function drawItems(cameraX, cameraY) {
  items
    .filter(
      item =>
        !item.taken &&
        item.floor === currentFloor
    )
    .forEach(item => {
      context.font = "28px sans-serif";

      context.fillText(
        ITEM_ICONS[item.type] || "📦",
        item.x - cameraX,
        item.y - cameraY
      );
    });
}

function drawPlayers(cameraX, cameraY) {
  Object.values(players).forEach(player => {
    if (
      player.id === myId ||
      player.floor !== currentFloor
    ) {
      return;
    }

    context.fillStyle = player.color;

    context.fillRect(
      player.x - cameraX,
      player.y - cameraY,
      PLAYER_SIZE,
      PLAYER_SIZE
    );
  });
}

function drawLocalPlayer(width, height) {
  // 내 캐릭터는 화면 중앙에 고정
  const screenX = width / 2 - PLAYER_SIZE / 2;
  const screenY = height / 2 - PLAYER_SIZE / 2;

  context.fillStyle = me.color;

  context.fillRect(
    screenX,
    screenY,
    PLAYER_SIZE,
    PLAYER_SIZE
  );

  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;

  context.strokeRect(
    screenX,
    screenY,
    PLAYER_SIZE,
    PLAYER_SIZE
  );
}

function drawGame() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  const cameraX =
    me.x + PLAYER_SIZE / 2 - width / 2;

  const cameraY =
    me.y + PLAYER_SIZE / 2 - height / 2;

  context.fillStyle = "#d8c7a5";
  context.fillRect(0, 0, width, height);

  drawMap(cameraX, cameraY, width, height);
  drawFurniture(cameraX, cameraY);
  drawBunker(cameraX, cameraY);
  drawItems(cameraX, cameraY);
  drawPlayers(cameraX, cameraY);
  drawLocalPlayer(width, height);

  $("floorName").textContent =
    `${currentFloor}층 · ${roomNameAt(
      me.x,
      me.y,
      currentFloor
    )}`;
}

function findNearItem() {
  nearItem = null;
  let shortestDistance = Infinity;

  items.forEach(item => {
    if (
      item.taken ||
      item.floor !== currentFloor
    ) {
      return;
    }

    const distance = Math.hypot(
      me.x + PLAYER_SIZE / 2 - item.x,
      me.y + PLAYER_SIZE / 2 - item.y
    );

    if (
      distance < 75 &&
      distance < shortestDistance
    ) {
      nearItem = item;
      shortestDistance = distance;
    }
  });

  $("interactionPrompt").classList.toggle(
    "hidden",
    !nearItem
  );

  if (nearItem) {
    $("interactionPrompt").textContent =
      `E · ${ITEM_ICONS[nearItem.type]} 줍기 ` +
      `(${itemDefs[nearItem.type]?.slots || 1}칸)`;
  }
}

function tryPickup() {
  if (!nearItem) {
    toast("근처에 아이템이 없습니다.");
    return;
  }

  socket.emit(
    "take-item",
    nearItem.id,
    response => {
      if (!response?.ok) {
        toast(response?.message || "줍기 실패");
      }
    }
  );
}

function insideBunker() {
  if (currentFloor !== 1) return false;

  const centerX = me.x + PLAYER_SIZE / 2;
  const centerY = me.y + PLAYER_SIZE / 2;

  return (
    centerX >= bunker.x &&
    centerX <= bunker.x + bunker.w &&
    centerY >= bunker.y &&
    centerY <= bunker.y + bunker.h
  );
}

function tryDeposit() {
  if (!insideBunker()) {
    toast("1층 벙커 안에서 F키를 누르세요.");
    return;
  }

  socket.emit("deposit-items", response => {
    if (!response?.ok) {
      toast(response?.message || "보관 실패");
      return;
    }

    me.hands = [...response.hands];
    me.stored = [...response.stored];

    renderHands();
    toast("벙커 보관 완료");
  });
}

function tryChangeFloor() {
  const stair = {
    x: 1480,
    y: 740,
    w: 140,
    h: 140
  };

  const centerX = me.x + PLAYER_SIZE / 2;
  const centerY = me.y + PLAYER_SIZE / 2;

  const inside =
    centerX >= stair.x &&
    centerX <= stair.x + stair.w &&
    centerY >= stair.y &&
    centerY <= stair.y + stair.h;

  if (!inside) {
    toast("계단 위치에서 Q키를 누르세요.");
    return;
  }

  if (currentFloor === 1) {
    currentFloor = 2;
  } else if (currentFloor === 2) {
    currentFloor = 3;
  } else {
    currentFloor = 2;
  }

  me.floor = currentFloor;
  me.x = 1500;
  me.y = currentFloor === 3 ? 1080 : 820;

  toast(`${currentFloor}층으로 이동`);
}

function finishRound() {
  if (ended) return;

  ended = true;
  running = false;

  $("resultText").textContent =
    `벙커에 보관한 아이템: ${me.stored.length}개`;

  $("resultOverlay").classList.remove("hidden");
}

function update(timestamp) {
  if (!running) return;

  const delta = Math.min(
    (timestamp - lastFrame) / 1000,
    0.05
  ) || 0;

  lastFrame = timestamp;

  let moveX =
    (
      keys.has("d") ||
      keys.has("arrowright")
        ? 1
        : 0
    ) -
    (
      keys.has("a") ||
      keys.has("arrowleft")
        ? 1
        : 0
    );

  let moveY =
    (
      keys.has("s") ||
      keys.has("arrowdown")
        ? 1
        : 0
    ) -
    (
      keys.has("w") ||
      keys.has("arrowup")
        ? 1
        : 0
    );

  if (moveX && moveY) {
    moveX *= 0.7071;
    moveY *= 0.7071;
  }

  const nextX =
    me.x + moveX * SPEED * delta;

  const nextY =
    me.y + moveY * SPEED * delta;

  if (!blocked(nextX, me.y, currentFloor)) {
    me.x = nextX;
  }

  if (!blocked(me.x, nextY, currentFloor)) {
    me.y = nextY;
  }

  findNearItem();

  if (timestamp - lastSend > 60) {
    socket.emit("player-move", {
      x: me.x,
      y: me.y,
      floor: currentFloor
    });

    lastSend = timestamp;
  }

  const remaining = Math.max(
    0,
    Math.ceil((endsAt - Date.now()) / 1000)
  );

  $("timer").textContent = remaining;

  if (remaining <= 0) {
    finishRound();
    drawGame();
    return;
  }

  drawGame();
  requestAnimationFrame(update);
}

window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  keys.add(key);

  if (key === "e") {
    tryPickup();
  }

  if (key === "f") {
    tryDeposit();
  }

  if (key === "q") {
    tryChangeFloor();
  }
});

window.addEventListener("keyup", event => {
  keys.delete(event.key.toLowerCase());
});

$("returnButton").addEventListener("click", () => {
  location.reload();
});

socket.on("game-started", data => {
  showScreen("game");

  buildMap();

  players = {};

  data.players.forEach(player => {
    players[player.id] = { ...player };
  });

  me = {
    ...players[myId],
    hands: [],
    stored: []
  };

  currentFloor = 1;
  bunker = data.bunker;
  handLimit = data.handLimit;
  itemDefs = data.itemDefs;
  items = data.items;
  endsAt = data.endsAt;
  ended = false;

  renderHands();

  let count = 5;

  $("countdown").textContent = count;
  $("countdownOverlay").classList.remove("hidden");
  $("resultOverlay").classList.add("hidden");

  const countdownTimer = setInterval(() => {
    count -= 1;

    $("countdown").textContent =
      count > 0
        ? count
        : "GO";

    if (count < 0) {
      clearInterval(countdownTimer);

      $("countdownOverlay").classList.add("hidden");

      running = true;
      lastFrame = performance.now();

      requestAnimationFrame(update);
    }
  }, 1000);
});

socket.on("player-moved", data => {
  if (players[data.id]) {
    Object.assign(players[data.id], data);
  }
});

socket.on("item-taken", data => {
  const item = items.find(
    candidate => candidate.id === data.itemId
  );

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
