const socket = io();

const screens = {
  home: document.querySelector("#homeScreen"),
  lobby: document.querySelector("#lobbyScreen"),
  game: document.querySelector("#gameScreen"),
};

const nicknameInput = document.querySelector("#nickname");
const roomCodeInput = document.querySelector("#roomCodeInput");
const roomList = document.querySelector("#roomList");
const createDialog = document.querySelector("#createDialog");
const createForm = document.querySelector("#createForm");
const createError = document.querySelector("#createError");
const readyButton = document.querySelector("#readyButton");
const startButton = document.querySelector("#startButton");
const playerList = document.querySelector("#playerList");
const copyCodeButton = document.querySelector("#copyCodeButton");
const toast = document.querySelector("#toast");

let currentRoom = null;
let myId = null;
let toastTimer = null;

nicknameInput.value = localStorage.getItem("afterglow-nickname") || "";

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle("active", key === name);
  });
}

function nickname() {
  const value = nicknameInput.value.trim();
  if (value) localStorage.setItem("afterglow-nickname", value);
  return value;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

function handleJoinResponse(response) {
  if (!response?.ok) {
    showToast(response?.message || "요청을 처리하지 못했습니다.");
    return;
  }

  currentRoom = response.room;
  myId = response.myId;
  renderLobby();
  showScreen("lobby");
  createDialog.close();
}

function renderRooms(rooms) {
  roomList.innerHTML = "";

  if (!rooms.length) {
    roomList.innerHTML = `
      <div class="empty">
        현재 공개 대피조가 없습니다.<br />
        첫 번째 방을 만들어 보세요.
      </div>
    `;
    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement("article");
    card.className = "room-card";

    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = room.name;
    const meta = document.createElement("p");
    meta.textContent = `${room.playerCount}/${room.maxPlayers}명 · 코드 ${room.code}`;
    info.append(title, meta);

    const button = document.createElement("button");
    button.textContent = "참가";
    button.disabled = room.playerCount >= room.maxPlayers;
    button.addEventListener("click", () => {
      socket.emit(
        "join-room",
        { nickname: nickname(), code: room.code },
        handleJoinResponse
      );
    });

    card.append(info, button);
    roomList.append(card);
  });
}

function renderLobby() {
  if (!currentRoom) return;

  document.querySelector("#lobbyName").textContent = currentRoom.name;
  copyCodeButton.textContent = currentRoom.code;
  playerList.innerHTML = "";

  currentRoom.players.forEach((player) => {
    const card = document.createElement("div");
    card.className = `player-card ${player.ready ? "ready" : ""}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = player.nickname.slice(0, 1).toUpperCase();

    const nameArea = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = player.nickname;
    nameArea.append(name);

    if (player.id === currentRoom.hostId) {
      const badge = document.createElement("span");
      badge.className = "host-badge";
      badge.textContent = "방장";
      badge.style.marginLeft = "8px";
      nameArea.append(badge);
    }

    const ready = document.createElement("span");
    ready.className = `ready-badge ${player.ready ? "on" : ""}`;
    ready.textContent = player.ready ? "준비 완료" : "대기 중";

    card.append(avatar, nameArea, ready);
    playerList.append(card);
  });

  const isHost = myId === currentRoom.hostId;
  readyButton.classList.toggle("hidden", isHost);
  startButton.classList.toggle("hidden", !isHost);

  const me = currentRoom.players.find((player) => player.id === myId);
  readyButton.textContent = me?.ready ? "준비 취소" : "준비";
}

document.querySelector("#openCreateButton").addEventListener("click", () => {
  if (!nickname()) {
    showToast("먼저 닉네임을 입력하세요.");
    nicknameInput.focus();
    return;
  }
  createError.textContent = "";
  createDialog.showModal();
});

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createError.textContent = "";

  socket.emit(
    "create-room",
    {
      nickname: nickname(),
      roomName: document.querySelector("#roomName").value,
      maxPlayers: document.querySelector("#maxPlayers").value,
      private: document.querySelector("#privateRoom").checked,
    },
    (response) => {
      if (!response?.ok) {
        createError.textContent = response?.message || "방을 만들지 못했습니다.";
        return;
      }
      handleJoinResponse(response);
      createForm.reset();
    }
  );
});

document.querySelector("#joinCodeButton").addEventListener("click", () => {
  socket.emit(
    "join-room",
    {
      nickname: nickname(),
      code: roomCodeInput.value,
    },
    handleJoinResponse
  );
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
});

roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    document.querySelector("#joinCodeButton").click();
  }
});

document.querySelector("#quickJoinButton").addEventListener("click", () => {
  socket.emit("quick-join", { nickname: nickname() }, handleJoinResponse);
});

document.querySelector("#refreshButton").addEventListener("click", () => {
  socket.emit("get-room-list");
});

readyButton.addEventListener("click", () => {
  socket.emit("toggle-ready", (response) => {
    if (!response?.ok) showToast(response?.message || "처리하지 못했습니다.");
  });
});

startButton.addEventListener("click", () => {
  socket.emit("start-game", (response) => {
    if (!response?.ok) showToast(response?.message || "시작하지 못했습니다.");
  });
});

document.querySelector("#leaveButton").addEventListener("click", () => {
  socket.emit("leave-room", () => {
    currentRoom = null;
    myId = null;
    showScreen("home");
  });
});

copyCodeButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentRoom.code);
    showToast("방 코드가 복사되었습니다.");
  } catch {
    showToast(`방 코드: ${currentRoom.code}`);
  }
});

socket.on("connect", () => {
  document.querySelector("#connectionText").textContent = "서버 연결됨";
  document.querySelector(".status-dot").classList.add("online");
});

socket.on("disconnect", () => {
  document.querySelector("#connectionText").textContent = "서버 연결 끊김";
  document.querySelector(".status-dot").classList.remove("online");
});

socket.on("room-list", renderRooms);

socket.on("room-updated", (room) => {
  currentRoom = room;
  renderLobby();
});

socket.on("game-started", (data) => {
  showScreen("game");

  let seconds = data.countdown;
  const countdown = document.querySelector("#countdown");
  const gameMessage = document.querySelector("#gameMessage");
  countdown.textContent = seconds;

  const timer = setInterval(() => {
    seconds -= 1;
    countdown.textContent = Math.max(seconds, 0);

    if (seconds <= 0) {
      clearInterval(timer);
      countdown.textContent = "GO";
      gameMessage.textContent =
        "여기에 아이템 수집 맵과 캐릭터 이동 시스템을 연결하면 됩니다.";
    }
  }, 1000);
});
