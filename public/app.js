"use strict";

/* =========================================================
   서버 연결
========================================================= */

const socket = io();

/* =========================================================
   화면 및 로비 요소
========================================================= */

const screens = {
  home: document.getElementById("homeScreen"),
  lobby: document.getElementById("lobbyScreen"),
  game: document.getElementById("gameScreen"),
};

const connectionDot = document.getElementById("connectionDot");
const connectionText = document.getElementById("connectionText");

const nicknameInput = document.getElementById("nickname");
const roomCodeInput = document.getElementById("roomCodeInput");
const roomList = document.getElementById("roomList");

const openCreateButton = document.getElementById("openCreateButton");
const quickJoinButton = document.getElementById("quickJoinButton");
const joinCodeButton = document.getElementById("joinCodeButton");
const refreshButton = document.getElementById("refreshButton");

const createDialog = document.getElementById("createDialog");
const createForm = document.getElementById("createForm");
const closeCreateButton = document.getElementById("closeCreateButton");
const createError = document.getElementById("createError");

const roomNameInput = document.getElementById("roomName");
const maxPlayersSelect = document.getElementById("maxPlayers");
const privateRoomInput = document.getElementById("privateRoom");

const lobbyName = document.getElementById("lobbyName");
const copyCodeButton = document.getElementById("copyCodeButton");
const playerList = document.getElementById("playerList");

const leaveButton = document.getElementById("leaveButton");
const readyButton = document.getElementById("readyButton");
const startButton = document.getElementById("startButton");

const toast = document.getElementById("toast");

/* =========================================================
   게임 요소
========================================================= */

const preCountdownPanel = document.getElementById("preCountdownPanel");
const countdownElement = document.getElementById("countdown");
const gameMessage = document.getElementById("gameMessage");

const farmingPanel = document.getElementById("farmingPanel");
const farmingTimer = document.getElementById("farmingTimer");

const floorStage = document.getElementById("floorStage");
const playerElement = document.getElementById("player");
const floorChips = document.querySelectorAll(".floor-chip");

const inventoryList = document.getElementById("inventoryList");

const resultPanel = document.getElementById("resultPanel");
const resultTitle = document.getElementById("resultTitle");
const resultHeadline = document.getElementById("resultHeadline");
const resultInventory = document.getElementById("resultInventory");
const resultSub = document.getElementById("resultSub");
const returnHomeButton = document.getElementById("returnHomeButton");

const touchButtons = document.querySelectorAll(".touch-btn");

/* =========================================================
   로비 상태
========================================================= */

let currentRoom = null;
let myId = null;
let toastTimer = null;
let countdownHandle = null;

/* =========================================================
   게임 기본 설정
========================================================= */

const STAGE_WIDTH = 900;
const STAGE_HEIGHT = 500;

const PLAYER_SIZE = 34;
const PLAYER_SPEED = 300;

const TOTAL_SECONDS = 60;
const STAIR_COOLDOWN = 500;

/* =========================================================
   아이템 종류
========================================================= */

const ITEM_POOL = {
  water: {
    name: "물병",
    icon: "💧",
  },

  can: {
    name: "통조림",
    icon: "🥫",
  },

  mask: {
    name: "방독면",
    icon: "😷",
  },

  bag: {
    name: "배낭",
    icon: "🎒",
  },

  medkit: {
    name: "구급상자",
    icon: "💊",
  },

  radio: {
    name: "라디오",
    icon: "📻",
  },

  battery: {
    name: "건전지",
    icon: "🔋",
  },

  knife: {
    name: "칼",
    icon: "🔪",
  },

  blanket: {
    name: "담요",
    icon: "🧣",
  },
};

/* =========================================================
   층별 맵 설정
========================================================= */

const FLOOR_DEFINITIONS = {
  1: {
    label: "1층 · 거실",

    obstacles: [
      {
        x: 300,
        y: 190,
        w: 170,
        h: 70,
      },

      {
        x: 560,
        y: 300,
        w: 110,
        h: 60,
      },
    ],

    items: [
      {
        poolId: "bag",
        x: 110,
        y: 110,
        w: 40,
        h: 40,
      },

      {
        poolId: "can",
        x: 730,
        y: 110,
        w: 40,
        h: 40,
      },

      {
        poolId: "water",
        x: 340,
        y: 400,
        w: 40,
        h: 40,
      },

      {
        poolId: "battery",
        x: 630,
        y: 400,
        w: 40,
        h: 40,
      },
    ],

    stairs: [
      {
        x: 400,
        y: 30,
        w: 110,
        h: 44,
        label: "계단 ↑ 2층",
        to: 2,

        spawn: {
          x: 415,
          y: 400,
        },
      },
    ],

    bunker: {
      x: 20,
      y: 420,
      w: 140,
      h: 60,
      label: "☢ 지하 벙커 입구",
    },
  },

  2: {
    label: "2층",

    obstacles: [
      {
        x: 70,
        y: 240,
        w: 150,
        h: 70,
      },

      {
        x: 660,
        y: 240,
        w: 130,
        h: 60,
      },
    ],

    items: [
      {
        poolId: "medkit",
        x: 130,
        y: 110,
        w: 40,
        h: 40,
      },

      {
        poolId: "water",
        x: 720,
        y: 90,
        w: 40,
        h: 40,
      },

      {
        poolId: "mask",
        x: 320,
        y: 400,
        w: 40,
        h: 40,
      },

      {
        poolId: "can",
        x: 600,
        y: 400,
        w: 40,
        h: 40,
      },
    ],

    stairs: [
      {
        x: 400,
        y: 30,
        w: 110,
        h: 44,
        label: "계단 ↑ 3층",
        to: 3,

        spawn: {
          x: 415,
          y: 400,
        },
      },

      {
        x: 400,
        y: 440,
        w: 110,
        h: 44,
        label: "계단 ↓ 1층",
        to: 1,

        spawn: {
          x: 415,
          y: 70,
        },
      },
    ],
  },

  3: {
    label: "3층 · 다락방",

    obstacles: [
      {
        x: 380,
        y: 190,
        w: 90,
        h: 60,
      },

      {
        x: 140,
        y: 300,
        w: 70,
        h: 50,
      },

      {
        x: 660,
        y: 280,
        w: 60,
        h: 70,
      },
    ],

    items: [
      {
        poolId: "radio",
        x: 90,
        y: 90,
        w: 40,
        h: 40,
      },

      {
        poolId: "battery",
        x: 720,
        y: 110,
        w: 40,
        h: 40,
      },

      {
        poolId: "blanket",
        x: 260,
        y: 400,
        w: 40,
        h: 40,
      },

      {
        poolId: "knife",
        x: 640,
        y: 400,
        w: 40,
        h: 40,
      },
    ],

    stairs: [
      {
        x: 400,
        y: 440,
        w: 110,
        h: 44,
        label: "계단 ↓ 2층",
        to: 2,

        spawn: {
          x: 415,
          y: 70,
        },
      },
    ],
  },
};

/* =========================================================
   게임 상태
========================================================= */

let gameRunning = false;

let currentFloor = 1;

let player = {
  x: 430,
  y: 250,
};

let inventory = {};

let floorItems = {};

let remainingSeconds = TOTAL_SECONDS;

let activeDirections = new Set();

let timerHandle = null;
let animationHandle = null;

let previousFrameTime = 0;
let stairCooldownUntil = 0;

/* =========================================================
   공통 함수
========================================================= */

function showScreen(screenName) {
  Object.entries(screens).forEach(([name, screen]) => {
    screen.classList.toggle("active", name === screenName);
  });
}

function getNickname() {
  const value = nicknameInput.value.trim();

  if (value) {
    localStorage.setItem("afterglow-nickname", value);
  }

  return value;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

function percent(value, axis) {
  const total = axis === "x"
    ? STAGE_WIDTH
    : STAGE_HEIGHT;

  return `${(value / total) * 100}%`;
}

function isColliding(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/* =========================================================
   방 참가 처리
========================================================= */

function handleJoinResponse(response) {
  if (!response?.ok) {
    showToast(
      response?.message ||
      "요청을 처리하지 못했습니다."
    );

    return;
  }

  currentRoom = response.room;
  myId = response.myId;

  renderLobby();
  showScreen("lobby");

  if (createDialog.open) {
    createDialog.close();
  }
}

/* =========================================================
   공개방 목록
========================================================= */

function renderRoomList(rooms) {
  roomList.innerHTML = "";

  if (!Array.isArray(rooms) || rooms.length === 0) {
    roomList.innerHTML = `
      <div class="empty">
        현재 공개 대피조가 없습니다.<br />
        새로운 방을 만들어 보세요.
      </div>
    `;

    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement("article");
    card.className = "room-card";

    const information = document.createElement("div");

    const title = document.createElement("h3");
    title.textContent = room.name;

    const metadata = document.createElement("p");
    metadata.textContent =
      `${room.playerCount}/${room.maxPlayers}명 · 코드 ${room.code}`;

    information.append(title, metadata);

    const joinButton = document.createElement("button");
    joinButton.type = "button";
    joinButton.textContent = "참가";

    joinButton.disabled =
      room.playerCount >= room.maxPlayers;

    joinButton.addEventListener("click", () => {
      const nickname = getNickname();

      if (!nickname) {
        showToast("닉네임을 먼저 입력하세요.");
        nicknameInput.focus();
        return;
      }

      socket.emit(
        "join-room",
        {
          nickname,
          code: room.code,
        },
        handleJoinResponse
      );
    });

    card.append(information, joinButton);
    roomList.appendChild(card);
  });
}

/* =========================================================
   로비 렌더링
========================================================= */

function renderLobby() {
  if (!currentRoom) {
    return;
  }

  lobbyName.textContent = currentRoom.name;
  copyCodeButton.textContent = currentRoom.code;

  playerList.innerHTML = "";

  currentRoom.players.forEach((roomPlayer) => {
    const card = document.createElement("div");

    card.className =
      `player-card ${roomPlayer.ready ? "ready" : ""}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";

    avatar.textContent =
      roomPlayer.nickname
        .slice(0, 1)
        .toUpperCase();

    const nameArea = document.createElement("div");

    const name = document.createElement("strong");
    name.textContent = roomPlayer.nickname;

    nameArea.appendChild(name);

    if (roomPlayer.id === currentRoom.hostId) {
      const hostBadge = document.createElement("span");

      hostBadge.className = "host-badge";
      hostBadge.textContent = "방장";
      hostBadge.style.marginLeft = "8px";

      nameArea.appendChild(hostBadge);
    }

    const readyBadge = document.createElement("span");

    readyBadge.className =
      `ready-badge ${roomPlayer.ready ? "on" : ""}`;

    readyBadge.textContent =
      roomPlayer.ready
        ? "준비 완료"
        : "대기 중";

    card.append(
      avatar,
      nameArea,
      readyBadge
    );

    playerList.appendChild(card);
  });

  const isHost =
    myId === currentRoom.hostId;

  readyButton.classList.toggle(
    "hidden",
    isHost
  );

  startButton.classList.toggle(
    "hidden",
    !isHost
  );

  const me = currentRoom.players.find(
    (roomPlayer) => roomPlayer.id === myId
  );

  readyButton.textContent =
    me?.ready
      ? "준비 취소"
      : "준비";
}

/* =========================================================
   방 생성 및 참가 버튼
========================================================= */

openCreateButton.addEventListener("click", () => {
  if (!getNickname()) {
    showToast("닉네임을 먼저 입력하세요.");
    nicknameInput.focus();
    return;
  }

  createError.textContent = "";
  createDialog.showModal();
});

closeCreateButton.addEventListener("click", () => {
  createDialog.close();
});

createForm.addEventListener("submit", (event) => {
  event.preventDefault();

  createError.textContent = "";

  const nickname = getNickname();

  if (!nickname) {
    createError.textContent =
      "닉네임을 입력하세요.";

    return;
  }

  socket.emit(
    "create-room",
    {
      nickname,
      roomName: roomNameInput.value.trim(),
      maxPlayers: maxPlayersSelect.value,
      private: privateRoomInput.checked,
    },

    (response) => {
      if (!response?.ok) {
        createError.textContent =
          response?.message ||
          "방을 만들지 못했습니다.";

        return;
      }

      handleJoinResponse(response);

      roomNameInput.value = "";
      maxPlayersSelect.value = "4";
      privateRoomInput.checked = false;
    }
  );
});

joinCodeButton.addEventListener("click", () => {
  const nickname = getNickname();

  if (!nickname) {
    showToast("닉네임을 먼저 입력하세요.");
    nicknameInput.focus();
    return;
  }

  const code =
    roomCodeInput.value
      .trim()
      .toUpperCase();

  if (code.length !== 6) {
    showToast("6자리 방 코드를 입력하세요.");
    roomCodeInput.focus();
    return;
  }

  socket.emit(
    "join-room",
    {
      nickname,
      code,
    },
    handleJoinResponse
  );
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value =
    roomCodeInput.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
});

roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinCodeButton.click();
  }
});

quickJoinButton.addEventListener("click", () => {
  const nickname = getNickname();

  if (!nickname) {
    showToast("닉네임을 먼저 입력하세요.");
    nicknameInput.focus();
    return;
  }

  socket.emit(
    "quick-join",
    {
      nickname,
    },
    handleJoinResponse
  );
});

refreshButton.addEventListener("click", () => {
  socket.emit("get-room-list");
});

/* =========================================================
   로비 버튼
========================================================= */

readyButton.addEventListener("click", () => {
  socket.emit(
    "toggle-ready",
    (response) => {
      if (!response?.ok) {
        showToast(
          response?.message ||
          "준비 상태를 변경하지 못했습니다."
        );
      }
    }
  );
});

startButton.addEventListener("click", () => {
  socket.emit(
    "start-game",
    (response) => {
      if (!response?.ok) {
        showToast(
          response?.message ||
          "게임을 시작하지 못했습니다."
        );
      }
    }
  );
});

leaveButton.addEventListener("click", () => {
  socket.emit(
    "leave-room",
    () => {
      currentRoom = null;
      myId = null;

      showScreen("home");
    }
  );
});

copyCodeButton.addEventListener("click", async () => {
  if (!currentRoom) {
    return;
  }

  try {
    await navigator.clipboard.writeText(
      currentRoom.code
    );

    showToast("방 코드가 복사되었습니다.");
  } catch (error) {
    showToast(
      `방 코드: ${currentRoom.code}`
    );
  }
});

/* =========================================================
   Socket.IO 서버 이벤트
========================================================= */

socket.on("connect", () => {
  connectionText.textContent = "서버 연결됨";
  connectionDot.classList.add("online");
});

socket.on("disconnect", () => {
  connectionText.textContent =
    "서버 연결 끊김";

  connectionDot.classList.remove("online");
});

socket.on("room-list", (rooms) => {
  renderRoomList(rooms);
});

socket.on("room-updated", (room) => {
  currentRoom = room;
  renderLobby();
});

/* =========================================================
   게임 시작 이벤트
========================================================= */

socket.on("game-started", () => {
  showScreen("game");

  startPreCountdown();
});

/* =========================================================
   게임 시작 전 5초 카운트다운
========================================================= */

function startPreCountdown() {
  stopCollectGame();

  preCountdownPanel.classList.remove("hidden");
  farmingPanel.classList.add("hidden");
  resultPanel.classList.add("hidden");

  let count = 5;

  countdownElement.textContent = count;

  gameMessage.textContent =
    "게임 맵을 준비하고 있습니다.";

  if (countdownHandle) {
    clearInterval(countdownHandle);
  }

  countdownHandle = setInterval(() => {
    count -= 1;

    if (count > 0) {
      countdownElement.textContent = count;
      return;
    }

    if (count === 0) {
      countdownElement.textContent = "GO";
      gameMessage.textContent =
        "아이템을 챙기고 벙커로 이동하세요.";

      return;
    }

    clearInterval(countdownHandle);
    countdownHandle = null;

    startCollectGame();
  }, 1000);
}

/* =========================================================
   아이템 인스턴스 생성
========================================================= */

function buildFloorItems() {
  floorItems = {};

  Object.keys(FLOOR_DEFINITIONS).forEach(
    (floorNumberText) => {
      const floorNumber =
        Number(floorNumberText);

      floorItems[floorNumber] =
        FLOOR_DEFINITIONS[floorNumber]
          .items
          .map((item, index) => ({
            instanceId:
              `${floorNumber}-${index}`,

            poolId: item.poolId,

            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,

            collected: false,
          }));
    }
  );
}

/* =========================================================
   층 렌더링
========================================================= */

function renderFloor(floorNumber) {
  currentFloor = floorNumber;

  const floor =
    FLOOR_DEFINITIONS[floorNumber];

  floorStage.innerHTML = "";

  floor.obstacles.forEach((obstacle) => {
    const element =
      document.createElement("div");

    element.className =
      "obstacle-block";

    element.style.left =
      percent(obstacle.x, "x");

    element.style.top =
      percent(obstacle.y, "y");

    element.style.width =
      percent(obstacle.w, "x");

    element.style.height =
      percent(obstacle.h, "y");

    floorStage.appendChild(element);
  });

  floorItems[floorNumber].forEach(
    (itemInstance) => {
      if (itemInstance.collected) {
        return;
      }

      const itemDefinition =
        ITEM_POOL[itemInstance.poolId];

      const element =
        document.createElement("div");

      element.className = "item-token";

      element.dataset.instanceId =
        itemInstance.instanceId;

      element.style.left =
        percent(itemInstance.x, "x");

      element.style.top =
        percent(itemInstance.y, "y");

      element.style.width =
        percent(itemInstance.w, "x");

      element.style.height =
        percent(itemInstance.h, "y");

      element.innerHTML = `
        <span class="tok-icon">
          ${itemDefinition.icon}
        </span>

        <span class="tok-name">
          ${itemDefinition.name}
        </span>
      `;

      floorStage.appendChild(element);
    }
  );

  floor.stairs.forEach((stair) => {
    const element =
      document.createElement("div");

    element.className = "stair-zone";

    element.style.left =
      percent(stair.x, "x");

    element.style.top =
      percent(stair.y, "y");

    element.style.width =
      percent(stair.w, "x");

    element.style.height =
      percent(stair.h, "y");

    element.textContent =
      stair.label;

    floorStage.appendChild(element);
  });

  if (floor.bunker) {
    const bunkerElement =
      document.createElement("div");

    bunkerElement.className =
      "bunker-door";

    bunkerElement.style.left =
      percent(floor.bunker.x, "x");

    bunkerElement.style.top =
      percent(floor.bunker.y, "y");

    bunkerElement.style.width =
      percent(floor.bunker.w, "x");

    bunkerElement.style.height =
      percent(floor.bunker.h, "y");

    bunkerElement.textContent =
      floor.bunker.label;

    floorStage.appendChild(
      bunkerElement
    );
  }

  floorStage.appendChild(playerElement);

  floorChips.forEach((chip) => {
    chip.classList.toggle(
      "active",
      Number(chip.dataset.floor) ===
        floorNumber
    );
  });
}

/* =========================================================
   플레이어 렌더링
========================================================= */

function renderPlayer() {
  playerElement.style.left =
    percent(player.x, "x");

  playerElement.style.top =
    percent(player.y, "y");

  playerElement.style.width =
    percent(PLAYER_SIZE, "x");

  playerElement.style.height =
    percent(PLAYER_SIZE, "y");
}

/* =========================================================
   인벤토리
========================================================= */

function renderInventory(targetElement) {
  targetElement.innerHTML = "";

  const itemIds =
    Object.keys(inventory);

  if (itemIds.length === 0) {
    targetElement.innerHTML = `
      <p class="muted">
        아직 획득한 아이템이 없습니다.
      </p>
    `;

    return;
  }

  itemIds.forEach((itemId) => {
    const itemDefinition =
      ITEM_POOL[itemId];

    if (!itemDefinition) {
      return;
    }

    const chip =
      document.createElement("div");

    chip.className = "inv-chip";

    chip.innerHTML = `
      <span>
        ${itemDefinition.icon}
      </span>

      <b>
        ${itemDefinition.name}
      </b>

      <span class="inv-count">
        x${inventory[itemId]}
      </span>
    `;

    targetElement.appendChild(chip);
  });
}

function collectItem(
  itemInstance,
  tokenElement
) {
  itemInstance.collected = true;

  inventory[itemInstance.poolId] =
    (inventory[itemInstance.poolId] || 0) + 1;

  renderInventory(inventoryList);

  if (tokenElement) {
    tokenElement.classList.add(
      "collected"
    );

    setTimeout(() => {
      tokenElement.remove();
    }, 200);
  }
}

/* =========================================================
   키보드 입력
========================================================= */

function keyToDirection(key) {
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
      return "up";

    case "ArrowDown":
    case "s":
    case "S":
      return "down";

    case "ArrowLeft":
    case "a":
    case "A":
      return "left";

    case "ArrowRight":
    case "d":
    case "D":
      return "right";

    default:
      return null;
  }
}

document.addEventListener(
  "keydown",
  (event) => {
    if (!gameRunning) {
      return;
    }

    const direction =
      keyToDirection(event.key);

    if (!direction) {
      return;
    }

    event.preventDefault();

    activeDirections.add(direction);
  }
);

document.addEventListener(
  "keyup",
  (event) => {
    const direction =
      keyToDirection(event.key);

    if (!direction) {
      return;
    }

    activeDirections.delete(direction);
  }
);

/* =========================================================
   모바일 이동 버튼
========================================================= */

touchButtons.forEach((button) => {
  const direction =
    button.dataset.dir;

  const press = (event) => {
    event.preventDefault();

    if (gameRunning) {
      activeDirections.add(direction);
    }
  };

  const release = () => {
    activeDirections.delete(direction);
  };

  button.addEventListener(
    "pointerdown",
    press
  );

  button.addEventListener(
    "pointerup",
    release
  );

  button.addEventListener(
    "pointerleave",
    release
  );

  button.addEventListener(
    "pointercancel",
    release
  );
});

/* =========================================================
   게임 루프
========================================================= */

function gameLoop(timestamp) {
  if (!gameRunning) {
    return;
  }

  if (!previousFrameTime) {
    previousFrameTime = timestamp;
  }

  const deltaTime = Math.min(
    (timestamp - previousFrameTime) / 1000,
    0.05
  );

  previousFrameTime = timestamp;

  let moveX =
    (activeDirections.has("right") ? 1 : 0) -
    (activeDirections.has("left") ? 1 : 0);

  let moveY =
    (activeDirections.has("down") ? 1 : 0) -
    (activeDirections.has("up") ? 1 : 0);

  if (moveX !== 0 && moveY !== 0) {
    moveX *= 0.7071;
    moveY *= 0.7071;
  }

  const floor =
    FLOOR_DEFINITIONS[currentFloor];

  const movementX =
    moveX *
    PLAYER_SPEED *
    deltaTime;

  const movementY =
    moveY *
    PLAYER_SPEED *
    deltaTime;

  let nextX =
    player.x + movementX;

  nextX = Math.max(
    0,
    Math.min(
      STAGE_WIDTH - PLAYER_SIZE,
      nextX
    )
  );

  const horizontalBox = {
    x: nextX,
    y: player.y,
    w: PLAYER_SIZE,
    h: PLAYER_SIZE,
  };

  const blockedHorizontally =
    floor.obstacles.some(
      (obstacle) =>
        isColliding(
          horizontalBox,
          obstacle
        )
    );

  if (!blockedHorizontally) {
    player.x = nextX;
  }

  let nextY =
    player.y + movementY;

  nextY = Math.max(
    0,
    Math.min(
      STAGE_HEIGHT - PLAYER_SIZE,
      nextY
    )
  );

  const verticalBox = {
    x: player.x,
    y: nextY,
    w: PLAYER_SIZE,
    h: PLAYER_SIZE,
  };

  const blockedVertically =
    floor.obstacles.some(
      (obstacle) =>
        isColliding(
          verticalBox,
          obstacle
        )
    );

  if (!blockedVertically) {
    player.y = nextY;
  }

  let playerBox = {
    x: player.x,
    y: player.y,
    w: PLAYER_SIZE,
    h: PLAYER_SIZE,
  };

  if (timestamp > stairCooldownUntil) {
    const stair =
      floor.stairs.find(
        (candidate) =>
          isColliding(
            playerBox,
            candidate
          )
      );

    if (stair) {
      currentFloor = stair.to;

      player.x = stair.spawn.x;
      player.y = stair.spawn.y;

      stairCooldownUntil =
        timestamp + STAIR_COOLDOWN;

      renderFloor(currentFloor);

      playerBox = {
        x: player.x,
        y: player.y,
        w: PLAYER_SIZE,
        h: PLAYER_SIZE,
      };
    }
  }

  const currentItems =
    floorItems[currentFloor];

  currentItems.forEach(
    (itemInstance) => {
      if (itemInstance.collected) {
        return;
      }

      if (
        isColliding(
          playerBox,
          itemInstance
        )
      ) {
        const tokenElement =
          floorStage.querySelector(
            `.item-token[data-instance-id="${itemInstance.instanceId}"]`
          );

        collectItem(
          itemInstance,
          tokenElement
        );
      }
    }
  );

  if (
    currentFloor === 1 &&
    FLOOR_DEFINITIONS[1].bunker &&
    isColliding(
      playerBox,
      FLOOR_DEFINITIONS[1].bunker
    )
  ) {
    finishGame(true);
    return;
  }

  renderPlayer();

  animationHandle =
    requestAnimationFrame(gameLoop);
}

/* =========================================================
   게임 제한 시간
========================================================= */

function updateTimer() {
  remainingSeconds -= 1;

  farmingTimer.textContent =
    Math.max(remainingSeconds, 0);

  if (remainingSeconds <= 10) {
    farmingTimer.classList.add(
      "danger-tick"
    );
  }

  if (remainingSeconds <= 0) {
    finishGame(false);
  }
}

/* =========================================================
   아이템 수집 시작
========================================================= */

function startCollectGame() {
  gameRunning = true;

  currentFloor = 1;

  player = {
    x: 430,
    y: 250,
  };

  inventory = {};

  remainingSeconds =
    TOTAL_SECONDS;

  activeDirections.clear();

  previousFrameTime = 0;
  stairCooldownUntil = 0;

  buildFloorItems();

  preCountdownPanel.classList.add(
    "hidden"
  );

  resultPanel.classList.add(
    "hidden"
  );

  resultPanel.classList.remove(
    "fail"
  );

  farmingPanel.classList.remove(
    "hidden"
  );

  farmingTimer.classList.remove(
    "danger-tick"
  );

  farmingTimer.textContent =
    remainingSeconds;

  renderFloor(1);
  renderPlayer();
  renderInventory(inventoryList);

  if (timerHandle) {
    clearInterval(timerHandle);
  }

  timerHandle = setInterval(
    updateTimer,
    1000
  );

  if (animationHandle) {
    cancelAnimationFrame(
      animationHandle
    );
  }

  animationHandle =
    requestAnimationFrame(gameLoop);
}

/* =========================================================
   게임 중지 및 결과
========================================================= */

function stopCollectGame() {
  gameRunning = false;

  activeDirections.clear();

  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }

  if (animationHandle) {
    cancelAnimationFrame(
      animationHandle
    );

    animationHandle = null;
  }
}

function finishGame(success) {
  if (!gameRunning) {
    return;
  }

  stopCollectGame();

  farmingPanel.classList.add(
    "hidden"
  );

  resultPanel.classList.remove(
    "hidden"
  );

  resultPanel.classList.toggle(
    "fail",
    !success
  );

  if (success) {
    resultTitle.textContent =
      "☢ 대피 성공";

    resultHeadline.textContent =
      "방공호 안으로 무사히 들어갔습니다.";

    resultSub.textContent =
      `남은 시간 ${Math.max(
        remainingSeconds,
        0
      )}초를 남기고 대피했습니다.`;
  } else {
    resultTitle.textContent =
      "☢ 피폭 경보";

    resultHeadline.textContent =
      "시간 안에 대피하지 못했습니다.";

    resultSub.textContent =
      "핵폭발에 휘말렸습니다. 다시 도전하세요.";
  }

  renderInventory(resultInventory);

  socket.emit(
    "farmingDone",
    {
      success,

      inventory,

      remainingSeconds:
        Math.max(
          remainingSeconds,
          0
        ),
    }
  );
}

/* =========================================================
   결과 화면에서 처음으로
========================================================= */

returnHomeButton.addEventListener(
  "click",
  () => {
    location.reload();
  }
);

/* =========================================================
   시작할 때 저장된 닉네임 적용
========================================================= */

nicknameInput.value =
  localStorage.getItem(
    "afterglow-nickname"
  ) || "";
