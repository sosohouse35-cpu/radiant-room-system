"use strict";
const ioClient=io(),$=id=>document.getElementById(id);

// DOM canvas references must exist before socket callbacks can fire.
const publicLobbyCanvas=$("publicLobbyCanvas");
const plctx=publicLobbyCanvas?.getContext("2d")||null;
const canvas=$("canvas");
const ctx=canvas?.getContext("2d")||null;

var profileIdV30=localStorage.getItem("afterglowProfileId")||"";
var persistentSanityPoints=Number(localStorage.getItem("afterglowSanityPoints")||0);
var rainbowUnlockedV30=localStorage.getItem("afterglowRainbowUnlocked")==="1";
var v30GiftClaimed=localStorage.getItem("afterglowV30Claimed")==="1";
var v30RainbowPhase=0;

function saveProfileV30(p){
  if(!p)return;
  profileIdV30=p.profileId||profileIdV30;
  persistentSanityPoints=Number(p.sanityPoints||0);
  rainbowUnlockedV30=!!p.rainbowUnlocked;
  v30GiftClaimed=!!p.v30Claimed;

  if(profileIdV30)localStorage.setItem("afterglowProfileId",profileIdV30);
  localStorage.setItem("afterglowSanityPoints",String(persistentSanityPoints));
  localStorage.setItem("afterglowRainbowUnlocked",rainbowUnlockedV30?"1":"0");
  localStorage.setItem("afterglowV30Claimed",v30GiftClaimed?"1":"0");

  renderPersistentSanityV30();
  renderRainbowOptionV30();
  renderV30ClaimButton();
}

function renderPersistentSanityV30(){
  const el=$("persistentSanity");
  if(el)el.textContent=`🧠 세인티 포인트 ${persistentSanityPoints.toLocaleString()}`;
}

function renderRainbowOptionV30(){
  const host=$("colorPicker");
  if(!host)return;

  let btn=host.querySelector('[data-color="rainbow"]');

  if(rainbowUnlockedV30){
    if(!btn){
      btn=document.createElement("button");
      btn.type="button";
      btn.dataset.color="rainbow";
      btn.className="rainbow-color-button";
      btn.title="VERSION 30 무지개";
      host.appendChild(btn);

      btn.onclick=()=>{
        selectedColor="rainbow";
        localStorage.setItem("afterglow-color","rainbow");

        host.querySelectorAll("[data-color]").forEach(b=>
          b.classList.toggle("selected",b===btn)
        );
      };
    }
  }else if(btn){
    if(selectedColor==="rainbow"){
      selectedColor="#4dabf7";
      localStorage.setItem("afterglow-color",selectedColor);
    }
    btn.remove();
  }
}

function rainbowColorV30(index=0){
  const palette=[
    "#ff1744","#ff3d00","#ff9100","#ffd600",
    "#c6ff00","#76ff03","#00e676","#1de9b6",
    "#00e5ff","#00b0ff","#2979ff","#651fff",
    "#aa00ff","#d500f9","#f500d0","#ff4081"
  ];

  // 약 75ms마다 다음 색으로 넘어가므로 플레이 중 계속 색이 변한다.
  const phase=Math.floor(performance.now()/75);
  return palette[(phase+index)%16];
}


function renderV30ClaimButton(){
  const btn=$("v30ClaimButton");
  const text=$("v30ClaimText");
  if(!btn)return;

  if(v30GiftClaimed){
    btn.disabled=true;
    btn.classList.add("claimed");
    btn.textContent="✓ VERSION 30 보상 수령 완료";
    if(text)text.textContent="100,000 SP와 무지개 캐릭터를 획득했습니다.";
  }else{
    btn.disabled=false;
    btn.classList.remove("claimed");
    btn.textContent="🎁 VERSION 30 보상 받기";
    if(text)text.textContent="100,000 SP + 계속 색이 변하는 무지개 캐릭터";
  }
}

function claimV30Reward(){
  if(v30GiftClaimed){
    toast("이미 VERSION 30 보상을 받았습니다.");
    return;
  }

  const btn=$("v30ClaimButton");
  if(btn){
    btn.disabled=true;
    btn.textContent="받는 중...";
  }

  ioClient.emit("claim-v30-event",{profileId:profileIdV30},r=>{
    if(r?.profile)saveProfileV30(r.profile);

    if(r?.ok){
      toast("🎉 100,000 SP + 무지개 캐릭터 획득!");
      selectedColor="rainbow";
      localStorage.setItem("afterglow-color","rainbow");
      renderRainbowOptionV30();

      const rb=$("colorPicker")?.querySelector('[data-color="rainbow"]');
      if(rb){
        $("colorPicker").querySelectorAll("[data-color]").forEach(b=>
          b.classList.toggle("selected",b===rb)
        );
      }
    }else{
      toast(r?.message||"보상을 받을 수 없습니다.");
    }

    renderV30ClaimButton();
  });
}

let room=null,myId=null;
const sessionId=localStorage.getItem("afterglow-session") ||
  (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random()}`);
localStorage.setItem("afterglow-session",sessionId);
let selectedColor=localStorage.getItem("afterglow-color")||"#4dabf7";
let currentPublicLobby=null;
let publicLobbyPlayers={};
let publicLobbyPlayer={x:750,y:500};
let publicLobbyRunning=false;
let publicLobbyDrawLoopStarted=false;
let publicLobbyMoveLoopStarted=false;
let publicLobbyLastSend=0;

const show=id=>{
  const ids=["home","publicLobby","lobby","game"];

  ids.forEach(x=>{
    const el=$(x);
    if(!el)return;

    const active=x===id;
    el.classList.toggle("active",active);

    // active class가 CSS에 먹지 않는 경우에도 화면 전환이 확실하게 되도록
    el.style.display=active ? (x==="publicLobby"||x==="game" ? "block" : "") : "none";
  });

  document.body.classList.toggle("home-scroll",id==="home");

  if(id==="home"){
    document.body.style.overflowY="auto";
    document.body.style.touchAction="pan-y";
  }else{
    document.body.style.overflowY="hidden";
    document.body.style.touchAction="manipulation";
  }

  // 로비/게임 화면은 표시 직후 캔버스를 다시 맞춤
  if(id==="publicLobby"){
    requestAnimationFrame(()=>{
      resizePublicLobbyCanvas();
      if(!publicLobbyRunning){
        publicLobbyRunning=true;
        requestAnimationFrame(drawPublicLobby);
        requestAnimationFrame(publicLobbyLoop);
      }
    });
  }

  if(id==="game"){
    requestAnimationFrame(()=>{
      resize();
      if(typeof resizeBunkerCanvas==="function")resizeBunkerCanvas();
      if(typeof resizeExpeditionCanvas==="function")resizeExpeditionCanvas();
    });
  }
};

function toast(t){
  $("toast").textContent=t;
  $("toast").classList.add("show");
  setTimeout(()=>$("toast").classList.remove("show"),1800);
}

document.body.classList.add("home-scroll");
$("nick").value=localStorage.getItem("afterglow-nickname")||"";

document.querySelectorAll("#colorPicker [data-color]").forEach(button=>{
  button.style.background=button.dataset.color;
  button.classList.toggle("selected",button.dataset.color===selectedColor);

  button.onclick=()=>{
    selectedColor=button.dataset.color;
    localStorage.setItem("afterglow-color",selectedColor);

    document.querySelectorAll("#colorPicker [data-color]").forEach(b=>
      b.classList.toggle("selected",b===button)
    );
  };
});

function ensureProfile(){
  const name=$("nick").value.trim();
  if(!name){
    toast("닉네임을 입력하세요.");
    return false;
  }
  localStorage.setItem("afterglow-nickname",name);
  return true;
}

function renderPublicLobbyList(list){
  const host=$("publicLobbyList");
  if(!host)return;

  host.innerHTML="";

  list.forEach(l=>{
    const card=document.createElement("div");
    card.className="public-lobby-card";

    const info=document.createElement("span");
    info.textContent=`LOBBY ${l.id} · ${l.playerCount}/24`;

    const button=document.createElement("button");
    button.textContent="입장";
    button.onclick=()=>joinPublicLobby(l.id);

    card.append(info,button);
    host.appendChild(card);
  });
}

function joinPublicLobby(lobbyId){
  if(!ensureProfile())return;

  ioClient.emit("join-public-lobby",{
    lobbyId,
    nickname:$("nick").value.trim(),
    color:selectedColor,
    profileId:profileIdV30
  },r=>{
    if(!r?.ok)return toast(r?.message||"로비 입장 실패");

    myId=r.myId;
    if(r.profile)saveProfileV30(r.profile);
    currentPublicLobby=r.lobby.id;
    publicLobbyPlayers={};

    r.lobby.players.forEach(p=>{
      publicLobbyPlayers[p.id]={...p};
    });

    const mine=publicLobbyPlayers[myId];
    publicLobbyPlayer={
      x:mine?.x??750,
      y:mine?.y??500
    };

    $("publicLobbyTitle").textContent=`LOBBY ${currentPublicLobby}`;
    $("publicChatList").innerHTML="";
    (r.messages||[]).forEach(renderPublicLobbyChat);

    publicLobbyRunning=true;
    show("publicLobby");
    resizePublicLobbyCanvas();

    if(!publicLobbyDrawLoopStarted){
      publicLobbyDrawLoopStarted=true;
      requestAnimationFrame(drawPublicLobby);
    }

    if(!publicLobbyMoveLoopStarted){
      publicLobbyMoveLoopStarted=true;
      requestAnimationFrame(publicLobbyLoop);
    }

    applyMobileControlsVisibility();
  });
}

ioClient.on("public-lobby-list",renderPublicLobbyList);

function renderPartyList(parties){
  const host=$("partyList");
  if(!host)return;
  host.innerHTML="";
  if(!parties.length){host.innerHTML='<div class="party-card">현재 공개 파티가 없습니다.</div>';return;}
  parties.forEach(p=>{
    const row=document.createElement("div");row.className="party-card";
    const info=document.createElement("div");info.innerHTML=`<b>${p.name}</b><br><small>${p.playerCount}/${p.maxPlayers}</small>`;
    const btn=document.createElement("button");btn.textContent="Join";
    btn.onclick=()=>ioClient.emit("join-room",{nickname:$("nick").value.trim(),profileId:profileIdV30,code:p.code,color:selectedColor,sessionId,publicLobbyId:currentPublicLobby},joined);
    row.append(info,btn);host.appendChild(row);
  });
}

$("createPartyButton").onclick=()=>{$("joinPartyPanel").classList.add("hidden");$("createPartyPanel").classList.remove("hidden");};
$("joinPartyButton").onclick=()=>{$("createPartyPanel").classList.add("hidden");$("joinPartyPanel").classList.remove("hidden");ioClient.emit("get-public-party-list",currentPublicLobby,r=>{if(r?.ok)renderPartyList(r.parties||[])});};
$("createPartyClose").onclick=()=>$("createPartyPanel").classList.add("hidden");
$("joinPartyClose").onclick=()=>$("joinPartyPanel").classList.add("hidden");
$("partyCreateConfirm").onclick=()=>{
  if(!ensureProfile())return;
  const title=$("partyTitle").value.trim();if(!title)return toast("파티 이름을 입력하세요.");
  ioClient.emit("create-room",{nickname:$("nick").value.trim(),roomName:title,maxPlayers:$("partyMax").value,private:$("partyPrivate").checked,color:selectedColor,sessionId,publicLobbyId:currentPublicLobby},r=>{if(!r?.ok)return toast(r?.message||"파티 생성 실패");$("createPartyPanel").classList.add("hidden");joined(r);});
};

function joined(r){
  if(!r?.ok)return toast(r?.message||"입장 실패");

  room=r.room;
  myId=r.myId;
  if(r.profile)saveProfileV30(r.profile);

  renderLobby();

  if($("dlg")?.open)$("dlg").close();
  $("createPartyPanel")?.classList.add("hidden");
  $("joinPartyPanel")?.classList.add("hidden");

  // 공용 로비에서 만든 파티는 실제 게임 시작 전까지 로비 화면을 유지
  if(currentPublicLobby){
    publicLobbyRunning=true;
    show("publicLobby");

    const lobbyPanel=$("lobby");
    if(lobbyPanel){
      lobbyPanel.classList.add("party-overlay");
      lobbyPanel.style.display="block";
    }
  }else{
    show("lobby");
  }
}
function renderLobby(){
  if(!room)return;

  $("roomName").textContent=room.name;
  $("roomCode").textContent=room.code;

  $("players").innerHTML=room.players.map(p=>
    `<div>${p.nickname}${p.id===room.hostId?" (방장)":""} ${p.ready?"✓":""}</div>`
  ).join("");

  $("start").style.display=myId===room.hostId?"inline-block":"none";
  $("ready").style.display=myId===room.hostId?"none":"inline-block";
}


function renderPartyOverlay(){
  if(!room)return;

  renderLobby();

  const lobbyPanel=$("lobby");
  if(!lobbyPanel)return;

  lobbyPanel.classList.add("party-overlay");
  lobbyPanel.style.display="block";

  // Keep the actual public lobby canvas alive behind the party panel.
  if(currentPublicLobby){
    publicLobbyRunning=true;

    if(!publicLobbyDrawLoopStarted){
      publicLobbyDrawLoopStarted=true;
      requestAnimationFrame(drawPublicLobby);
    }

    if(!publicLobbyMoveLoopStarted){
      publicLobbyMoveLoopStarted=true;
      requestAnimationFrame(publicLobbyLoop);
    }
  }
}

$("ready").onclick=()=>ioClient.emit("toggle-ready",r=>{
  if(!r?.ok)toast("변경 실패");
});

$("start").onclick=()=>ioClient.emit("start-game",r=>{
  if(!r?.ok)toast(r?.message||"시작 실패");
});

ioClient.on("room-updated",r=>{
  room=r;
  if(currentPublicLobby && r.publicLobbyId===currentPublicLobby){
    renderPartyOverlay();
  }else{
    renderLobby();
  }

  if(typeof bunkerOthers!=="undefined"){
    const activeIds=new Set(r.players.map(p=>p.id));
    Object.keys(bunkerOthers).forEach(id=>{
      if(!activeIds.has(id))delete bunkerOthers[id];
    });
  }
});

ioClient.on("connect",()=>{ 
  ioClient.emit("get-profile",{profileId:profileIdV30},r=>{
    if(r?.ok)saveProfileV30(r.profile);
  });

  $("status").textContent="연결됨";

  ioClient.emit("reconnect-room",sessionId,r=>{
    if(!r?.ok)return;

    room=r.room;
    myId=r.myId;

    if(r.player){
      hp=r.player.hp??hp;
      hunger=r.player.hunger??hunger;
      thirst=r.player.thirst??thirst;
      hygiene=r.player.hygiene??hygiene;
      fatigue=r.player.fatigue??fatigue;
      sanityStat=r.player.sanityStat??sanityStat;
      equippedWeapon=r.player.equipped??equippedWeapon;

      if(r.player.inExpedition && expeditionRunning){
        expeditionPlayer.x=r.player.expeditionX??expeditionPlayer.x;
        expeditionPlayer.y=r.player.expeditionY??expeditionPlayer.y;
        expeditionItems=r.expeditionItems||expeditionItems;
        expeditionMutants={};
        (r.expeditionMutants||[]).forEach(m=>expeditionMutants[m.id]={...m});
      }

      if(r.player.inBunker && bunkerRunning){
        bunkerPlayer.x=r.player.bunkerX??bunkerPlayer.x;
        bunkerPlayer.y=r.player.bunkerY??bunkerPlayer.y;
      }
    }

    requestAnimationFrame(()=>{
      if(typeof updateStatusUI==="function")updateStatusUI();
    });
  });
});

const W=2400,H=1600,T=40,P=30,SPEED=235,COLS=W/T,ROWS=H/T;
const ICON={beans:"🥫",water:"💧",soap:"🧼",tape:"🩹",trap:"🪤",spray:"🧴",medkit:"💊",battery:"🔋",flashlight:"🔦",mask:"😷",axe:"🪓",backpack:"🎒",blueprint:"📘",toolbox:"🧰",map:"🗺️",radio:"📻"};
const ITEM_NAME={beans:"통조림",water:"물",soap:"비누",tape:"테이프",trap:"덫",spray:"살충제",medkit:"메디킷",battery:"배터리",flashlight:"손전등",mask:"방독면",axe:"도끼",backpack:"가방",blueprint:"블루프린트",toolbox:"공구함",map:"지도",radio:"라디오"};
let grids={},furn={},players={},items=[],me={},floor=1,bunker,defs={},keys=new Set(),near=null,ends=0,running=false,last=0,lastSend=0;
var day=1,sanity=0,bounty=0,bountyLevel=1,bunkerStock={},weapons={},power=100,securityState="LOCKED";
var hp=100,hunger=100,thirst=100,hygiene=100,fatigue=0,sanityStat=100;
var bunkerPlayer={x:330,y:560};

var expeditionRunning=false;
var expeditionItems=[];
var expeditionPlayer={x:250,y:850};
var expeditionOthers={};
var expeditionMutants={};
var mutantNear=null;
var expeditionNear=null;
var expeditionLastSend=0;
var expeditionFacing={x:1,y:0};
var expeditionSwingUntil=0;
var expeditionLocation="grocery";
var expeditionReturnPoint={x:250,y:850};
var expeditionReturnNear=false;
var expeditionHandLimit=4;
var playerSick=false;
var hospitalAbomination=null;
var hospitalAttackUntil=0;
var hospitalAttackTargetId=null;
var hospitalGlass=[];
var hospitalTripwires=[];
var expeditionJumping=false;
var expeditionJumpUntil=0;
var expeditionFlashlight=false;
var equippedWeapon=null;
var swingUntil=0;
var dayStartedAt=Date.now();
var dayLengthMs=120000;
var expeditionInviteEndsAt=0;
var expeditionInviteTimerHandle=null;
var bunkerOthers={};
var bunkerMobs={};
var ventStates={
  ventTop:{closed:false,threat:null,stage:0},
  ventLeft:{closed:false,threat:null,stage:0},
  ventBottom:{closed:false,threat:null,stage:0}
};
var selectedVentId=null;
var bunkerFacing={x:1,y:0};
var bunkerSwingUntil=0;
var weaponCooldownUntil=0;
var currentWeaponCooldown=0;
var ventRenderRunning=false;
var hallucination={active:false,x:0,y:0,start:0,duration:4200,damage:0};
var lastBunkerSend=0;
var bunkerKeys=new Set();
var bunkerRunning=false;
var bunkerJumping=false;
var bunkerJumpUntil=0;
var bunkerNear=null;
const roomsByFloor={
1:[{n:"주방",x:80,y:120,w:800,h:520},{n:"거실",x:920,y:120,w:720,h:520},{n:"1층 화장실",x:1680,y:120,w:600,h:520},{n:"차고",x:80,y:720,w:800,h:640},{n:"벙커/복도",x:920,y:720,w:1360,h:640}],
2:[{n:"침실",x:80,y:120,w:880,h:600},{n:"서재",x:1000,y:120,w:720,h:600},{n:"2층 화장실",x:1760,y:120,w:520,h:600},{n:"복도",x:80,y:800,w:2200,h:440}],
3:[{n:"다락방",x:400,y:260,w:1500,h:760}]};
const stairSystems = {
  1: [
    { id:"stairs12", x:1480, y:760, w:150, h:130, to:2, spawnX:1495, spawnY:885, label:"2층 ↑" }
  ],
  2: [
    { id:"stairs12", x:1480, y:760, w:150, h:130, to:1, spawnX:1495, spawnY:885, label:"1층 ↓" },
    { id:"stairs23", x:620, y:930, w:150, h:130, to:3, spawnX:635, spawnY:1070, label:"3층 ↑" }
  ],
  3: [
    { id:"stairs23", x:620, y:930, w:150, h:130, to:2, spawnX:635, spawnY:1070, label:"2층 ↓" }
  ]
};

let stairCooldownUntil = 0;
let joystickX = 0;
let joystickY = 0;

// =========================================================
// 공용 로비
// =========================================================

function resizePublicLobbyCanvas(){
  if(!publicLobbyCanvas||!plctx)return;
  const d=devicePixelRatio||1;
  const vw=Math.max(320,visualViewport?.width||innerWidth||320);
  const vh=Math.max(240,visualViewport?.height||innerHeight||240);

  publicLobbyCanvas.width=Math.round(vw*d);
  publicLobbyCanvas.height=Math.round(vh*d);
  publicLobbyCanvas.style.width=`${vw}px`;
  publicLobbyCanvas.style.height=`${vh}px`;
  plctx.setTransform(d,0,0,d,0,0);
}

function drawPublicLobby(){
  if(!publicLobbyCanvas||!plctx){
    publicLobbyDrawLoopStarted=false;
    return;
  }

  if(!publicLobbyRunning){
    publicLobbyDrawLoopStarted=false;
    return;
  }

  const vw=visualViewport?.width||innerWidth;
  const vh=visualViewport?.height||innerHeight;
  const camX=publicLobbyPlayer.x-vw/2;
  const camY=publicLobbyPlayer.y-vh/2;

  plctx.fillStyle="#536a4b";
  plctx.fillRect(0,0,vw,vh);

  // 넓은 공용 광장
  plctx.fillStyle="#898878";
  plctx.fillRect(390-camX,240-camY,720,510);
  plctx.strokeStyle="#30342d";
  plctx.lineWidth=6;
  plctx.strokeRect(390-camX,240-camY,720,510);

  // 길
  plctx.fillStyle="#77796f";
  plctx.fillRect(0-camX,450-camY,1500,120);
  plctx.fillRect(690-camX,0-camY,120,1000);

  // 벤치 / 나무 / 표지판
  const deco=[
    {x:460,y:300,w:120,h:32,c:"#74553b"},
    {x:920,y:300,w:120,h:32,c:"#74553b"},
    {x:460,y:660,w:120,h:32,c:"#74553b"},
    {x:920,y:660,w:120,h:32,c:"#74553b"},
    {x:270,y:260,w:75,h:75,c:"#315c31"},
    {x:1150,y:260,w:75,h:75,c:"#315c31"},
    {x:270,y:720,w:75,h:75,c:"#315c31"},
    {x:1150,y:720,w:75,h:75,c:"#315c31"},
    {x:700,y:420,w:100,h:70,c:"#4d4a40"}
  ];

  deco.forEach(o=>{
    plctx.fillStyle=o.c;
    plctx.fillRect(o.x-camX,o.y-camY,o.w,o.h);
  });

  Object.values(publicLobbyPlayers).forEach(p=>{
    if(p.id===myId)return;

    plctx.fillStyle=p.color;
    plctx.fillRect(p.x-camX,p.y-camY,30,30);

    plctx.fillStyle="#fff";
    plctx.font="11px sans-serif";
    plctx.fillText(p.nickname,p.x-camX-4,p.y-camY-7);
  });

  plctx.fillStyle=selectedColor;
  plctx.fillRect(vw/2-15,vh/2-15,30,30);
  plctx.strokeStyle="#fff";
  plctx.lineWidth=2;
  plctx.strokeRect(vw/2-15,vh/2-15,30,30);

  requestAnimationFrame(drawPublicLobby);
}

function publicLobbyLoop(t){
  if(!publicLobbyRunning){
    publicLobbyMoveLoopStarted=false;
    return;
  }

  let dx=(keys.has("d")||keys.has("arrowright")?1:0)-
         (keys.has("a")||keys.has("arrowleft")?1:0);

  let dy=(keys.has("s")||keys.has("arrowdown")?1:0)-
         (keys.has("w")||keys.has("arrowup")?1:0);

  if(Math.abs(joystickX)>.03||Math.abs(joystickY)>.03){
    dx=joystickX;
    dy=joystickY;
  }else if(dx&&dy){
    dx*=.707;
    dy*=.707;
  }

  publicLobbyPlayer.x=Math.max(30,Math.min(1470,publicLobbyPlayer.x+dx*3.4));
  publicLobbyPlayer.y=Math.max(30,Math.min(970,publicLobbyPlayer.y+dy*3.4));

  if(t-publicLobbyLastSend>70){
    ioClient.emit("public-lobby-move",{
      x:publicLobbyPlayer.x,
      y:publicLobbyPlayer.y
    });
    publicLobbyLastSend=t;
  }

  requestAnimationFrame(publicLobbyLoop);
}

ioClient.on("public-lobby-player-joined",p=>{
  publicLobbyPlayers[p.id]=p;
});

ioClient.on("public-lobby-player-moved",p=>{
  publicLobbyPlayers[p.id]={
    ...(publicLobbyPlayers[p.id]||{}),
    ...p
  };
});

ioClient.on("public-lobby-player-left",d=>{
  delete publicLobbyPlayers[d.id];
});

$("leavePublicLobby").onclick=()=>{
  publicLobbyRunning=false;
  publicLobbyDrawLoopStarted=false;
  publicLobbyMoveLoopStarted=false;
  currentPublicLobby=null;
  show("home");
};

function renderPublicLobbyChat(m){
  const row=document.createElement("div");
  row.className="chat-message"+(m.playerId===myId?" mine":"");

  const head=document.createElement("span");
  head.className="chat-name";
  head.textContent=m.nickname;

  const body=document.createElement("div");
  body.textContent=m.text;

  row.append(head,body);
  $("publicChatList").appendChild(row);
  $("publicChatList").scrollTop=$("publicChatList").scrollHeight;
}

ioClient.on("public-lobby-message",renderPublicLobbyChat);

$("publicChatButton").onclick=()=>{
  $("publicChatPanel").classList.remove("hidden");
  document.body.classList.add("chat-open");
  if(matchMedia("(orientation: portrait)").matches)resetJoystick();
  setTimeout(()=>$("publicChatInput").focus(),70);
};

$("publicChatClose").onclick=()=>{
  $("publicChatPanel").classList.add("hidden");
  document.body.classList.remove("chat-open");
};

function sendPublicChat(){
  const text=$("publicChatInput").value.trim();
  if(!text)return;

  ioClient.emit("public-lobby-message",text,r=>{
    if(!r?.ok)return toast(r?.message||"전송 실패");
    $("publicChatInput").value="";
  });
}

$("publicChatSend").onclick=sendPublicChat;
$("publicChatInput").addEventListener("keydown",e=>{
  if(e.key==="Enter"){
    e.preventDefault();
    sendPublicChat();
  }
});


const lobbyJoyBase=$("lobbyJoystickBase");
const lobbyJoyKnob=$("lobbyJoystickKnob");
let lobbyJoyPointer=null;

function resetLobbyJoystick(){
  joystickX=0;
  joystickY=0;
  lobbyJoyKnob.style.transform="translate(-50%, -50%)";
}

function updateLobbyJoystick(clientX,clientY){
  const rect=lobbyJoyBase.getBoundingClientRect();
  const cx=rect.left+rect.width/2;
  const cy=rect.top+rect.height/2;

  let dx=clientX-cx;
  let dy=clientY-cy;

  const max=rect.width/2-24;
  const distance=Math.hypot(dx,dy);

  if(distance>max){
    dx=dx/distance*max;
    dy=dy/distance*max;
  }

  joystickX=dx/max;
  joystickY=dy/max;

  lobbyJoyKnob.style.transform=
    `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

lobbyJoyBase.addEventListener("pointerdown",e=>{
  e.preventDefault();
  lobbyJoyPointer=e.pointerId;
  lobbyJoyBase.setPointerCapture(e.pointerId);
  updateLobbyJoystick(e.clientX,e.clientY);
});

lobbyJoyBase.addEventListener("pointermove",e=>{
  if(e.pointerId!==lobbyJoyPointer)return;
  e.preventDefault();
  updateLobbyJoystick(e.clientX,e.clientY);
});

function endLobbyJoy(e){
  if(lobbyJoyPointer!==null && e.pointerId!==lobbyJoyPointer)return;
  lobbyJoyPointer=null;
  resetLobbyJoystick();
}
lobbyJoyBase.addEventListener("pointerup",endLobbyJoy);
lobbyJoyBase.addEventListener("pointercancel",endLobbyJoy);
lobbyJoyBase.addEventListener("lostpointercapture",()=>{
  lobbyJoyPointer=null;
  resetLobbyJoystick();
});

addEventListener("resize",resizePublicLobbyCanvas);
if(window.visualViewport){
  visualViewport.addEventListener("resize",resizePublicLobbyCanvas);
}


function resize(){
  const d=devicePixelRatio||1;
  const vw=window.visualViewport?.width||innerWidth;
  const vh=window.visualViewport?.height||innerHeight;
  canvas.width=Math.max(1,Math.round(vw*d));
  canvas.height=Math.max(1,Math.round(vh*d));
  canvas.style.width=`${vw}px`;
  canvas.style.height=`${vh}px`;
  ctx.setTransform(d,0,0,d,0,0);
}
addEventListener("resize",resize);
if(window.visualViewport){
  window.visualViewport.addEventListener("resize",resize);
}
resize();
function empty(){return Array.from({length:ROWS},()=>Array(COLS).fill(0))}function wall(g,x,y,w,h){for(let r=y;r<y+h;r++)for(let c=x;c<x+w;c++)if(g[r])g[r][c]=1}function door(g,x,y,w=1,h=1){for(let r=y;r<y+h;r++)for(let c=x;c<x+w;c++)if(g[r])g[r][c]=0}
function furniture(fl,x,y,w,h,label,color){furn[fl].push({x:x*T,y:y*T,w:w*T,h:h*T,label,color});wall(grids[fl],x,y,w,h)}
function build(){
 for(let f=1;f<=3;f++){grids[f]=empty();furn[f]=[];let g=grids[f];wall(g,0,0,COLS,1);wall(g,0,ROWS-1,COLS,1);wall(g,0,0,1,ROWS);wall(g,COLS-1,0,1,ROWS)}
 let g=grids[1];
 [[2,3,20,1],[2,3,1,13],[21,3,1,13],[2,15,20,1],[23,3,18,1],[23,3,1,13],[40,3,1,13],[23,15,18,1],[42,3,15,1],[42,3,1,13],[56,3,1,13],[42,15,15,1],[2,18,20,1],[2,18,1,16],[21,18,1,16],[2,33,20,1],[23,18,34,1],[23,18,1,16],[56,18,1,16],[23,33,34,1]].forEach(a=>wall(g,...a));
 [[9,15,3,1],[30,15,3,1],[48,15,2,1],[9,18,3,1],[31,18,3,1]].forEach(a=>door(g,...a));
 furniture(1,4,5,6,2,"조리대","#b7afa3");furniture(1,13,5,5,2,"싱크대","#aab8bb");furniture(1,5,11,4,2,"식탁","#9a7048");furniture(1,25,6,5,3,"소파","#718ba0");furniture(1,34,5,3,2,"탁자","#9a7048");furniture(1,45,6,3,2,"욕조","#c9d8dd");furniture(1,4,22,6,3,"차량","#5c6268");furniture(1,13,24,4,3,"선반","#7d5a3d");
 g=grids[2];
 [[2,3,22,1],[2,3,1,15],[23,3,1,15],[2,17,22,1],[25,3,18,1],[25,3,1,15],[42,3,1,15],[25,17,18,1],[44,3,13,1],[44,3,1,15],[56,3,1,15],[44,17,13,1],[2,20,55,1],[2,20,1,12],[56,20,1,12],[2,31,55,1]].forEach(a=>wall(g,...a));
 [[10,17,3,1],[32,17,3,1],[49,17,2,1],[12,20,3,1],[30,20,3,1],[48,20,3,1]].forEach(a=>door(g,...a));
 furniture(2,4,6,7,4,"침대","#b99191");furniture(2,14,6,5,2,"책상","#87613f");furniture(2,27,6,6,2,"책상","#87613f");furniture(2,35,10,3,4,"책장","#765638");furniture(2,47,6,4,3,"욕조","#c9d8dd");
 g=grids[3];[[3,4,54,1],[3,4,1,27],[56,4,1,27],[3,30,54,1]].forEach(a=>wall(g,...a));door(g,28,30,4,1);
 furniture(3,6,8,5,4,"상자","#896945");furniture(3,14,8,4,3,"상자","#896945");furniture(3,25,8,6,2,"작업대","#87613f");furniture(3,38,8,5,4,"선반","#765638");
}
function blocked(x,y){const g=grids[floor];return [[x,y],[x+P-1,y],[x,y+P-1],[x+P-1,y+P-1]].some(([a,b])=>g[Math.floor(b/T)]?.[Math.floor(a/T)]===1)}
function currentRoom(){const x=me.x+15,y=me.y+15;return roomsByFloor[floor].find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)||roomsByFloor[floor][0]}

function isHallRoom(room){
  if(!room) return false;
  return room.n.includes("복도") || room.n.includes("벙커");
}

function itemVisible(item){
  if(item.floor !== floor || item.taken) return false;

  const playerRoom = currentRoom();
  const itemRoom = roomsByFloor[floor].find(r =>
    item.x >= r.x && item.x <= r.x+r.w &&
    item.y >= r.y && item.y <= r.y+r.h
  );

  // 복도에서는 방 안 아이템이 보이지 않는다.
  if(isHallRoom(playerRoom)){
    return itemRoom === playerRoom;
  }

  // 방 안에서는 그 방 아이템만 보인다.
  return itemRoom === playerRoom;
}

function playerVisible(player){
  if(player.id===myId || player.floor!==floor) return false;

  const playerRoom = currentRoom();
  const otherRoom = roomsByFloor[floor].find(r =>
    player.x+15 >= r.x && player.x+15 <= r.x+r.w &&
    player.y+15 >= r.y && player.y+15 <= r.y+r.h
  );

  if(isHallRoom(playerRoom)){
    return otherRoom === playerRoom;
  }

  return otherRoom === playerRoom;
}

function wood(camX,camY,w,h){ctx.fillStyle="#d6ba8b";ctx.fillRect(0,0,w,h);for(let yy=Math.floor(camY/28)*28;yy<camY+h+28;yy+=28){let sy=yy-camY;ctx.strokeStyle="rgba(90,58,30,.24)";ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(w,sy);ctx.stroke();for(let xx=0;xx<W;xx+=180){let sx=xx-camX+((yy/28)%2?90:0);ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx,sy+28);ctx.stroke()}}}
function wallFill(camX,camY,w,h){let g=grids[floor];for(let r=Math.max(0,Math.floor(camY/T)-1);r<=Math.min(ROWS-1,Math.ceil((camY+h)/T)+1);r++)for(let c=Math.max(0,Math.floor(camX/T)-1);c<=Math.min(COLS-1,Math.ceil((camX+w)/T)+1);c++)if(g[r][c]){ctx.fillStyle="#6c5848";ctx.fillRect(c*T-camX,r*T-camY,T+1,T+1)}}
function outlines(camX,camY){ctx.strokeStyle="#080808";ctx.lineWidth=7;roomsByFloor[floor].forEach(r=>ctx.strokeRect(r.x-camX,r.y-camY,r.w,r.h))}
function drawStair(camX,camY){
  (stairSystems[floor] || []).forEach(s=>{
    const x=s.x-camX, y=s.y-camY;

    ctx.fillStyle="#8d755b";
    ctx.fillRect(x,y,s.w,s.h);

    ctx.strokeStyle="#111";
    ctx.lineWidth=4;
    ctx.strokeRect(x,y,s.w,s.h);

    ctx.strokeStyle="#e2cdb0";
    ctx.lineWidth=3;

    for(let i=1;i<6;i++){
      ctx.beginPath();
      ctx.moveTo(x+8,y+s.h*i/6);
      ctx.lineTo(x+s.w-8,y+s.h*i/6);
      ctx.stroke();
    }

    ctx.fillStyle="#fff";
    ctx.font="bold 13px sans-serif";
    ctx.fillText(s.label,x+12,y+18);
    ctx.fillText("Q",x+s.w-23,y+18);
  });
}

function draw(){
  const w=window.visualViewport?.width||innerWidth;
  const h=window.visualViewport?.height||innerHeight;
  const camX=me.x+15-w/2;
  const camY=me.y+15-h/2;

  ctx.clearRect(0,0,w,h);

  // 모든 공간의 바닥/가구/벽은 우선 정상 렌더
  wood(camX,camY,w,h);
  wallFill(camX,camY,w,h);

  furn[floor].forEach(o=>{
    ctx.fillStyle=o.color;
    ctx.fillRect(o.x-camX,o.y-camY,o.w,o.h);
    ctx.strokeStyle="#49382a";
    ctx.lineWidth=2;
    ctx.strokeRect(o.x-camX,o.y-camY,o.w,o.h);
    ctx.fillStyle="#2a221b";
    ctx.font="12px sans-serif";
    ctx.fillText(o.label,o.x-camX+5,o.y-camY+16);
  });

  if(floor===1){
    ctx.strokeStyle="#6f8d3d";
    ctx.lineWidth=4;
    ctx.strokeRect(
      bunker.x-camX,bunker.y-camY,
      bunker.w,bunker.h
    );
  }

  drawStair(camX,camY);

  // 다른 방/복도는 검정이 아닌 반투명 어둠.
  // 가구와 바닥은 그대로 식별 가능.
  const cur=currentRoom();

  roomsByFloor[floor].forEach(r=>{
    if(r===cur) return;

    let alpha;

    if(isHallRoom(cur)){
      // 복도에 있으면 모든 방이 꽤 어둡다.
      alpha = isHallRoom(r) ? 0.14 : 0.58;
    }else{
      // 방 안에 있으면 복도는 살짝 어둡고 다른 방은 더 어둡다.
      alpha = isHallRoom(r) ? 0.28 : 0.53;
    }

    ctx.fillStyle=`rgba(14,16,18,${alpha})`;
    ctx.fillRect(
      r.x-camX,r.y-camY,
      r.w,r.h
    );
  });

  // 벽은 항상 잘 보이게 다시 렌더
  wallFill(camX,camY,w,h);
  outlines(camX,camY);
  drawStair(camX,camY);

  // 아이템은 현재 방/현재 복도에 있는 것만 보인다.
  items.filter(itemVisible).forEach(i=>{
    ctx.font="27px sans-serif";
    ctx.fillText(
      ICON[i.type],
      i.x-camX,
      i.y-camY
    );
  });

  // 다른 플레이어도 같은 공간에 있을 때만 표시
  Object.values(players).filter(playerVisible).forEach(p=>{
    ctx.fillStyle=p.color;
    ctx.fillRect(
      p.x-camX,
      p.y-camY,
      P,P
    );
  });

  // 내 캐릭터는 항상 화면 중앙
  ctx.fillStyle=me.color;
  ctx.fillRect(
    w/2-P/2,
    h/2-P/2,
    P,P
  );

  ctx.strokeStyle="#fff";
  ctx.lineWidth=2;
  ctx.strokeRect(
    w/2-P/2,
    h/2-P/2,
    P,P
  );

  $("floor").textContent=`${floor}층 · ${cur.n}`;
}

function renderSlots(){
  const limit=expeditionRunning ? expeditionHandLimit : 4;
  const slotsHost=$("slots");

  slotsHost.innerHTML='<div class="slot">✋</div>'.repeat(limit);
  const a=[...slotsHost.querySelectorAll(".slot")];

  let k=0;
  (me.hands||[]).forEach(t=>{
    const n=defs[t]?.slots||1;
    for(let i=0;i<n&&k<limit;i++,k++){
      a[k].textContent=i?"▪":ICON[t];
      a[k].style.background="#edf4c7";
    }
  });

  const title=document.querySelector(".hands > div");
  if(title){
    title.textContent=expeditionRunning
      ? `탐사 손 ${limit}칸${limit===8?" · 🎒 Backpack":""}`
      : "손 4칸";
  }

  $("stored").textContent=expeditionRunning
    ? `${k}/${limit}칸 사용`
    : (me.stored?.length
      ? `보관함: ${me.stored.map(t=>ICON[t]).join(" ")}`
      : "보관함 비어 있음");
}
function findNear(){
  near=null;
  let d=999;

  items.forEach(i=>{
    if(!itemVisible(i)) return;

    const dist=Math.hypot(
      me.x+15-i.x,
      me.y+15-i.y
    );

    if(dist<75 && dist<d){
      near=i;
      d=dist;
    }
  });

  $("prompt").classList.toggle("hidden",!near);

  if(near){
    $("prompt").textContent=
      `E · ${ICON[near.type]} ${ITEM_NAME[near.type]} 줍기 (${defs[near.type].slots}칸)`;
  }
}

function pickup(){if(!near)return toast("가까이 가세요");ioClient.emit("take-item",near.id,r=>{if(!r.ok)toast(r.message)})}
function store(){ioClient.emit("deposit-items",r=>{if(!r.ok)return toast(r.message);me.hands=r.hands;me.stored=r.stored;renderSlots();toast("보관 완료")})}
function stair(){
  const now=performance.now();

  if(now < stairCooldownUntil){
    return;
  }

  const x=me.x+15;
  const y=me.y+15;

  const s=(stairSystems[floor] || []).find(stair =>
    x>=stair.x &&
    x<=stair.x+stair.w &&
    y>=stair.y &&
    y<=stair.y+stair.h
  );

  if(!s){
    toast("계단 위에서 Q");
    return;
  }

  floor=s.to;
  me.floor=floor;
  me.x=s.spawnX;
  me.y=s.spawnY;

  stairCooldownUntil=performance.now()+700;

  toast(`${floor}층으로 이동`);
}

function loop(t){
  if(!running)return;

  const dt=Math.min((t-last)/1000,.05)||0;
  last=t;

  let x=
    (keys.has("d")||keys.has("arrowright")?1:0)-
    (keys.has("a")||keys.has("arrowleft")?1:0);

  let y=
    (keys.has("s")||keys.has("arrowdown")?1:0)-
    (keys.has("w")||keys.has("arrowup")?1:0);

  // 모바일 조이스틱 값이 있으면 키보드보다 우선
  if(Math.abs(joystickX)>.03 || Math.abs(joystickY)>.03){
    x=joystickX;
    y=joystickY;
  }else if(x&&y){
    x*=.707;
    y*=.707;
  }

  const nx=me.x+x*SPEED*dt;
  const ny=me.y+y*SPEED*dt;

  if(!blocked(nx,me.y)) me.x=nx;
  if(!blocked(me.x,ny)) me.y=ny;

  findNear();

  if(t-lastSend>70){
    ioClient.emit(
      "player-move",
      {x:me.x,y:me.y,floor}
    );
    lastSend=t;
  }

  const remaining=Math.max(
    0,
    Math.ceil((ends-Date.now())/1000)
  );

  $("timer").textContent=remaining;

  if(remaining<=0){
    running=false;
    ioClient.emit("finish-scavenge",()=>{});
    draw();
    return;
  }

  draw();
  requestAnimationFrame(loop);
}

addEventListener("keydown",e=>{let k=e.key.toLowerCase();keys.add(k);if(k==="e")pickup();if(k==="f")store();if(k==="q")stair()});addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
const joyBase=$("joystickBase");
const joyKnob=$("joystickKnob");
let joyPointerId=null;

function resetJoystick(){
  joystickX=0;
  joystickY=0;
  joyKnob.style.transform="translate(-50%, -50%)";
}

function updateJoystick(clientX,clientY){
  const rect=joyBase.getBoundingClientRect();
  const centerX=rect.left+rect.width/2;
  const centerY=rect.top+rect.height/2;

  let dx=clientX-centerX;
  let dy=clientY-centerY;

  const maxDistance=rect.width/2-31;
  const distance=Math.hypot(dx,dy);

  if(distance>maxDistance){
    dx=dx/distance*maxDistance;
    dy=dy/distance*maxDistance;
  }

  joystickX=dx/maxDistance;
  joystickY=dy/maxDistance;

  joyKnob.style.transform=
    `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

joyBase.addEventListener("pointerdown",e=>{
  e.preventDefault();
  joyPointerId=e.pointerId;
  joyBase.setPointerCapture(e.pointerId);
  updateJoystick(e.clientX,e.clientY);
});

joyBase.addEventListener("pointermove",e=>{
  if(e.pointerId!==joyPointerId)return;
  e.preventDefault();
  updateJoystick(e.clientX,e.clientY);
});

function endJoystick(e){
  if(joyPointerId!==null && e.pointerId!==joyPointerId)return;
  joyPointerId=null;
  resetJoystick();
}

joyBase.addEventListener("pointerup",endJoystick);
joyBase.addEventListener("pointercancel",endJoystick);
joyBase.addEventListener("lostpointercapture",()=>{
  joyPointerId=null;
  resetJoystick();
});
$("mPick").onclick=()=>{
  if(expeditionRunning)takeExpeditionItem();
  else if(bunkerRunning)interactBunker();
  else pickup();
};$("mStore").onclick=()=>{
  if(expeditionRunning){
    toast("탐사 중에는 벙커로 귀환해야 보관됩니다.");
  }else{
    store();
  }
};$("mStair").onclick=stair;$("full").onclick=async()=>{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen()};

function updateStatusUI(){
  $("dayLabel").textContent=`DAY ${day}`;
  $("bunkerDay").textContent=`DAY ${day}`;
  $("hpValue").textContent=`${hp} / 100`;
  $("sanityValue").textContent=`${sanity} SP`;
  $("hungerValue").textContent=`${Math.round(hunger)}%`;
  $("thirstValue").textContent=`${Math.round(thirst)}%`;
  if($("hygieneValue"))$("hygieneValue").textContent=`${Math.round(hygiene)}%`;
  if($("fatigueValue"))$("fatigueValue").textContent=`${Math.round(fatigue)}%`;
  if($("sanityStatValue"))$("sanityStatValue").textContent=`${Math.round(sanityStat)}%`;
  $("statusDay").textContent=day;

  let condition="안정";
  if(hp<=0)condition="사망";
  else if(hp<35)condition="위험";
  else if(hunger<30)condition="배고픔";
  else if(thirst<30)condition="목마름";
  else if(fatigue>75)condition="극심한 피로";
  else if(sanityStat<40)condition="환각 위험";
  else if(playerSick)condition="Sickness";

  $("conditionValue").textContent=condition;

  if($("hpBar"))$("hpBar").style.width=`${Math.max(0,Math.min(100,hp))}%`;
  if($("hungerBar"))$("hungerBar").style.width=`${Math.max(0,Math.min(100,hunger))}%`;
  if($("thirstBar"))$("thirstBar").style.width=`${Math.max(0,Math.min(100,thirst))}%`;
  if($("hygieneBar"))$("hygieneBar").style.width=`${Math.max(0,Math.min(100,hygiene))}%`;
  if($("fatigueBar"))$("fatigueBar").style.width=`${Math.max(0,Math.min(100,fatigue))}%`;
  if($("sanityStatBar"))$("sanityStatBar").style.width=`${Math.max(0,Math.min(100,sanityStat))}%`;
}

$("bookButton").onclick=()=>{
  $("statusPanel").classList.toggle("hidden");
  updateStatusUI();
};

const BUNKER_OBJECTS = [
  {id:"weapons",label:"무기 보관함",x:160,y:92,w:74,h:130,solid:true,kind:"locker"},
  {id:"bed",label:"침대",x:170,y:242,w:165,h:92,solid:true,kind:"bed"},
  {id:"computer",label:"컴퓨터",x:170,y:350,w:112,h:62,solid:true,kind:"computer"},
  {id:"beans",label:"통조림",x:170,y:430,w:118,h:82,solid:true,kind:"storage"},
  {id:"medkit",label:"메디킷",x:390,y:532,w:120,h:54,solid:true,kind:"medical"},
  {id:"blueprints",label:"블루프린트",x:520,y:532,w:150,h:54,solid:true,kind:"blueprint"},
  {id:"power",label:"전력 공급",x:760,y:365,w:102,h:76,solid:true,kind:"power"},
  {id:"water",label:"물",x:792,y:468,w:70,h:120,solid:true,kind:"water"},

  /* 사용자 스케치 기준 환풍구 3개 */
  {id:"ventTop",label:"환풍구",x:430,y:28,w:112,h:34,solid:true,kind:"vent"},
  {id:"ventLeft",label:"환풍구",x:82,y:425,w:40,h:112,solid:true,kind:"ventVertical"},
  {id:"ventBottom",label:"환풍구",x:730,y:718,w:132,h:34,solid:true,kind:"vent"},

  /* 계단은 장식 */
  {id:"stairs",label:"계단",x:300,y:610,w:390,h:92,solid:false,kind:"stairs"},

  /* 계단 왼쪽 탐사용 벙커문 */
  {id:"bunkerDoor",label:"벙커문",x:205,y:590,w:70,h:105,solid:true,kind:"door"},

  /* 샤워실 */
  {id:"showerRoom",label:"샤워실",x:665,y:92,w:197,h:240,solid:false,kind:"room"}
];

const BUNKER_WALLS = [
  {x:100,y:60,w:850,h:16},
  {x:100,y:60,w:16,h:720},
  {x:934,y:60,w:16,h:720},
  {x:100,y:764,w:850,h:16},

  /* 계단 양옆 벽 */
  {x:285,y:590,w:16,h:125},
  {x:690,y:590,w:16,h:125},

  /* 샤워실: 왼쪽 벽 가운데 문 70px를 비움 */
  {x:650,y:80,w:16,h:82},
  {x:650,y:232,w:16,h:118},
  {x:650,y:80,w:235,h:16},
  {x:650,y:334,w:235,h:16},
  {x:869,y:80,w:16,h:270}
];


function bunkerRectHit(px,py,w=30,h=30,rect,padding=4){
  return (
    px+w > rect.x-padding &&
    px < rect.x+rect.w+padding &&
    py+h > rect.y-padding &&
    py < rect.y+rect.h+padding
  );
}

function bunkerBlocked(nextX,nextY){
  // 바깥 경계
  if(nextX<115 || nextY<75 || nextX+30>925 || nextY+30>755) return true;

  // 가구 충돌
  for(const o of BUNKER_OBJECTS){
    if(o.solid && bunkerRectHit(nextX,nextY,30,30,o,2)) return true;
  }

  // 벽 충돌
  for(const wall of BUNKER_WALLS){
    if(bunkerRectHit(nextX,nextY,30,30,wall,0)) return true;
  }

  return false;
}

function bunkerStockCount(id){
  const map={
    beans:"beans",
    water:"water",
    medkit:"medkit",
    blueprints:"blueprint"
  };
  const type=map[id];
  return type ? (bunkerStock[type]||0) : null;
}

function resizeBunkerCanvas(){
  const c=$("bunkerCanvas");
  const dpr=devicePixelRatio||1;
  const vw=window.visualViewport?.width||innerWidth;
  const vh=window.visualViewport?.height||innerHeight;
  c.width=Math.max(1,Math.round(vw*dpr));
  c.height=Math.max(1,Math.round(vh*dpr));
  c.style.width=`${vw}px`;
  c.style.height=`${vh}px`;
  c.getContext("2d").setTransform(dpr,0,0,dpr,0,0);
}
addEventListener("resize",resizeBunkerCanvas);
if(window.visualViewport){
  window.visualViewport.addEventListener("resize",()=>{
    if(bunkerRunning)resizeBunkerCanvas();
  });
}

function drawBunkerInterior(){
  if(!bunkerRunning)return;

  const c=$("bunkerCanvas");
  const bctx=c.getContext("2d");
  const vw=window.visualViewport?.width||innerWidth, vh=window.visualViewport?.height||innerHeight;

  // 확대: 플레이어 주변만 보이게 함
  const scale=1.55;
  const camX=bunkerPlayer.x-vw/(2*scale);
  const camY=bunkerPlayer.y-vh/(2*scale);

  bctx.save();
  bctx.clearRect(0,0,vw,vh);
  bctx.scale(scale,scale);

  const drawW=vw/scale;
  const drawH=vh/scale;

  // 벙커 바깥은 완전 검정
  bctx.fillStyle="#000";
  bctx.fillRect(0,0,drawW,drawH);

  bctx.strokeStyle="rgba(66,58,48,.16)";
  bctx.lineWidth=1;
  for(let x=-camX%52;x<drawW;x+=52){
    bctx.beginPath();bctx.moveTo(x,0);bctx.lineTo(x,drawH);bctx.stroke();
  }
  for(let y=-camY%52;y<drawH;y+=52){
    bctx.beginPath();bctx.moveTo(0,y);bctx.lineTo(drawW,y);bctx.stroke();
  }

  // 넓어진 철제 벙커 바닥
  bctx.fillStyle="#747a7d";
  bctx.fillRect(100-camX,60-camY,850,720);

  // 철판 이음선
  bctx.strokeStyle="rgba(35,40,43,.42)";
  bctx.lineWidth=1;

  for(let x=100;x<=950;x+=85){
    bctx.beginPath();
    bctx.moveTo(x-camX,60-camY);
    bctx.lineTo(x-camX,780-camY);
    bctx.stroke();
  }

  for(let y=60;y<=780;y+=72){
    bctx.beginPath();
    bctx.moveTo(100-camX,y-camY);
    bctx.lineTo(950-camX,y-camY);
    bctx.stroke();
  }

  // 리벳
  bctx.fillStyle="rgba(33,38,41,.62)";
  for(let x=110;x<950;x+=85){
    for(let y=70;y<780;y+=72){
      bctx.beginPath();
      bctx.arc(x-camX,y-camY,2.2,0,Math.PI*2);
      bctx.fill();
    }
  }

  // 샤워실 별도 바닥
  const shower=BUNKER_OBJECTS.find(o=>o.id==="showerRoom");
  bctx.fillStyle="#aebfc1";
  bctx.fillRect(shower.x-camX,shower.y-camY,shower.w,shower.h);
  bctx.strokeStyle="rgba(255,255,255,.22)";
  for(let y=shower.y;y<shower.y+shower.h;y+=28){
    bctx.beginPath();
    bctx.moveTo(shower.x-camX,y-camY);
    bctx.lineTo(shower.x+shower.w-camX,y-camY);
    bctx.stroke();
  }

  // 벽
  BUNKER_WALLS.forEach(w=>{
    bctx.fillStyle="#403a34";
    bctx.fillRect(w.x-camX,w.y-camY,w.w,w.h);
  });

  // 가구
  BUNKER_OBJECTS.filter(o=>o.id!=="showerRoom").forEach(o=>{
    const x=o.x-camX,y=o.y-camY;

    if(o.kind==="locker"){
      bctx.fillStyle="#50575a";
      bctx.fillRect(x,y,o.w,o.h);
      bctx.strokeStyle="#181b1c";bctx.lineWidth=3;bctx.strokeRect(x,y,o.w,o.h);
      bctx.strokeStyle="#303638";
      bctx.beginPath();bctx.moveTo(x+o.w/2,y);bctx.lineTo(x+o.w/2,y+o.h);bctx.stroke();
    }else if(o.kind==="bed"){
      bctx.fillStyle="#795b4d";bctx.fillRect(x,y,o.w,o.h);
      bctx.fillStyle="#d7d0c4";bctx.fillRect(x+8,y+8,o.w-16,o.h-16);
      bctx.fillStyle="#b8aaa0";bctx.fillRect(x+12,y+12,48,28);
    }else if(o.kind==="computer"){
      bctx.fillStyle="#54483a";bctx.fillRect(x,y,o.w,o.h);
      bctx.fillStyle="#14231a";bctx.fillRect(x+16,y+8,58,34);
      bctx.strokeStyle="#79d58a";bctx.strokeRect(x+16,y+8,58,34);
      bctx.fillStyle="#292723";bctx.fillRect(x+78,y+18,20,25);
    }else if(o.kind==="storage"){
      bctx.fillStyle="#816b50";bctx.fillRect(x,y,o.w,o.h);
      for(let i=1;i<3;i++){bctx.strokeStyle="#4b3d2e";bctx.beginPath();bctx.moveTo(x,y+o.h*i/3);bctx.lineTo(x+o.w,y+o.h*i/3);bctx.stroke()}
    }else if(o.kind==="medical"){
      bctx.fillStyle="#e1dfd5";bctx.fillRect(x,y,o.w,o.h);
      bctx.fillStyle="#a93131";bctx.fillRect(x+o.w/2-7,y+8,14,o.h-16);
      bctx.fillRect(x+o.w/2-22,y+o.h/2-7,44,14);
    }else if(o.kind==="blueprint"){
      bctx.fillStyle="#74634c";bctx.fillRect(x,y,o.w,o.h);
      bctx.fillStyle="#497aa2";bctx.fillRect(x+9,y+8,o.w-18,o.h-16);
    }else if(o.kind==="power"){
      bctx.fillStyle="#696b5d";bctx.fillRect(x,y,o.w,o.h);
      bctx.fillStyle="#9fc65e";bctx.fillRect(x+12,y+13,12,12);
      bctx.fillStyle="#d0a14e";bctx.fillRect(x+34,y+13,12,12);
    }else if(o.kind==="water"){
      bctx.fillStyle="#6f929f";bctx.fillRect(x,y,o.w,o.h);
      bctx.strokeStyle="#c3e5ee";bctx.strokeRect(x+10,y+10,o.w-20,o.h-20);
    }else if(o.kind==="vent"){
      bctx.fillStyle="#565b5b";
      bctx.fillRect(x,y,o.w,o.h);
      bctx.strokeStyle="#262929";

      for(let i=8;i<o.w;i+=10){
        bctx.beginPath();
        bctx.moveTo(x+i,y+5);
        bctx.lineTo(x+i,y+o.h-5);
        bctx.stroke();
      }
    }else if(o.kind==="ventVertical"){
      bctx.fillStyle="#565b5b";
      bctx.fillRect(x,y,o.w,o.h);
      bctx.strokeStyle="#262929";

      for(let i=8;i<o.h;i+=10){
        bctx.beginPath();
        bctx.moveTo(x+5,y+i);
        bctx.lineTo(x+o.w-5,y+i);
        bctx.stroke();
      }
    }else if(o.kind==="door"){
      bctx.fillStyle="#484f4f";bctx.fillRect(x,y,o.w,o.h);
      bctx.strokeStyle="#111";bctx.lineWidth=4;bctx.strokeRect(x,y,o.w,o.h);
      bctx.fillStyle="#d9b44a";bctx.beginPath();bctx.arc(x+o.w-14,y+o.h/2,5,0,Math.PI*2);bctx.fill();
      bctx.fillStyle="#cbd1c9";bctx.fillRect(x+8,y+12,o.w-24,8);
      bctx.fillRect(x+8,y+o.h-20,o.w-24,8);
    }else if(o.kind==="stairs"){
      bctx.fillStyle="#7c6956";bctx.fillRect(x,y,o.w,o.h);
      bctx.strokeStyle="#ded0b8";
      for(let i=1;i<8;i++){const yy=y+o.h*i/8;bctx.beginPath();bctx.moveTo(x+5,yy);bctx.lineTo(x+o.w-5,yy);bctx.stroke()}
    }

    bctx.fillStyle="#201b16";
    bctx.font="bold 12px Malgun Gothic";
    bctx.fillText(o.label,x+6,y+17);

    const count=bunkerStockCount(o.id);
    if(count!==null){
      bctx.fillStyle="#2b2017";
      bctx.font="bold 16px Malgun Gothic";
      bctx.fillText(`× ${count}`,x+8,y+o.h-8);
    }
  });

  // 샤워실 내부 설비
  bctx.fillStyle="#d9e5e5";
  bctx.fillRect(690-camX,125-camY,64,42);
  bctx.fillStyle="#87999a";
  bctx.fillRect(800-camX,120-camY,22,120);
  bctx.fillStyle="#e6efef";
  bctx.fillRect(690-camX,245-camY,80,52);
  bctx.fillStyle="#283131";
  bctx.font="bold 13px Malgun Gothic";
  bctx.fillText("샤워실",700-camX,112-camY);

  // 환풍구는 벙커 화면에서 위협의 종류를 직접 표시하지 않음.
  // 플레이어가 환풍구에 접근해 내부 화면을 열어야만 상태를 확인 가능.
  BUNKER_OBJECTS
    .filter(o=>["ventTop","ventLeft","ventBottom"].includes(o.id))
    .forEach(o=>{
      const v=ventStates[o.id]||{};
      const x=o.x-camX,y=o.y-camY;

      if(v.closed){
        bctx.fillStyle="rgba(26,28,27,.82)";
        bctx.fillRect(x,y,o.w,o.h);
        bctx.fillStyle="#d4d6d1";
        bctx.font="bold 10px sans-serif";
        bctx.fillText("CLOSED",x+3,y+14);
      }
    });

  // 벙커 내부 적
  Object.values(bunkerMobs).forEach(m=>{
    if(!m.alive)return;

    const sx=m.x-camX,sy=m.y-camY;

    bctx.fillStyle=
      m.type==="rat" ? "#6e5848" :
      m.type==="spider" ? "#4d362e" :
      "#6b7450";

    bctx.fillRect(sx,sy,32,32);

    bctx.fillStyle="#d84f45";
    bctx.fillRect(sx,sy-8,32*(m.hp/m.maxHp),4);

    bctx.fillStyle="#201a17";
    bctx.font="11px sans-serif";
    bctx.fillText(
      m.type==="rat"?"RAT":
      m.type==="spider"?"SPIDER":"FUMIGATOR",
      sx-3,sy-12
    );
  });

  // 다른 플레이어의 장착 무기
  Object.values(bunkerOthers).forEach(p=>{
    if(!p.equipped)return;
    const sx=p.x-camX+15,sy=p.y-camY+15;
    const fx=p.facingX??1,fy=p.facingY??0;

    bctx.strokeStyle=p.equipped==="axe"?"#b4bbbc":"#754c2f";
    bctx.lineWidth=p.equipped==="axe"?7:5;
    bctx.beginPath();
    bctx.moveTo(sx+fx*10,sy+fy*10);
    bctx.lineTo(sx+fx*52,sy+fy*52);
    bctx.stroke();
  });

  // 플레이어는 화면 중앙
  const bunkerJumpRemaining=bunkerJumping
    ? Math.max(0,Math.min(1,(bunkerJumpUntil-performance.now())/520))
    : 0;
  const bunkerJumpPhase=bunkerJumping?1-bunkerJumpRemaining:0;
  const bunkerJumpArc=bunkerJumping?Math.sin(bunkerJumpPhase*Math.PI):0;
  const bunkerJumpScale=1+bunkerJumpArc*.34;
  const bunkerCharSize=30*bunkerJumpScale;
  const bunkerJumpLift=bunkerJumpArc*10;

  bctx.fillStyle=`rgba(0,0,0,${0.24-bunkerJumpArc*.10})`;
  bctx.beginPath();
  bctx.ellipse(
    vw/(2*scale),
    vh/(2*scale)+18,
    15-bunkerJumpArc*4,
    6-bunkerJumpArc*2,
    0,0,Math.PI*2
  );
  bctx.fill();

  bctx.fillStyle=(me.color==="rainbow"?rainbowColorV30(0):(me.color||"#fff"));
  bctx.fillRect(
    vw/(2*scale)-bunkerCharSize/2,
    vh/(2*scale)-bunkerCharSize/2-bunkerJumpLift,
    bunkerCharSize,
    bunkerCharSize
  );
  bctx.strokeStyle="#fff";
  bctx.lineWidth=2;
  bctx.strokeRect(
    vw/(2*scale)-bunkerCharSize/2,
    vh/(2*scale)-bunkerCharSize/2-bunkerJumpLift,
    bunkerCharSize,
    bunkerCharSize
  );

  // 내 장착 무기: 마지막 이동 방향 + 강화된 무기 모양/베기 효과
  if(equippedWeapon){
    const cx=vw/(2*scale);
    const cy=vh/(2*scale);
    const fx=bunkerFacing.x||1;
    const fy=bunkerFacing.y||0;
    const baseAngle=Math.atan2(fy,fx);
    const swinging=performance.now()<bunkerSwingUntil;

    bctx.save();
    bctx.translate(cx,cy);
    bctx.rotate(baseAngle + (swinging ? .72 : 0));

    // 손잡이 그림자
    bctx.strokeStyle="rgba(0,0,0,.35)";
    bctx.lineWidth=9;
    bctx.lineCap="round";
    bctx.beginPath();
    bctx.moveTo(10,3);
    bctx.lineTo(61,3);
    bctx.stroke();

    if(equippedWeapon==="axe"){
      // 나무 손잡이
      bctx.strokeStyle="#795033";
      bctx.lineWidth=6;
      bctx.beginPath();
      bctx.moveTo(10,0);
      bctx.lineTo(62,0);
      bctx.stroke();

      // 도끼 머리
      bctx.fillStyle="#adb6b8";
      bctx.beginPath();
      bctx.moveTo(49,-15);
      bctx.lineTo(70,-12);
      bctx.lineTo(75,0);
      bctx.lineTo(69,13);
      bctx.lineTo(50,10);
      bctx.closePath();
      bctx.fill();

      bctx.strokeStyle="#5d6567";
      bctx.lineWidth=2;
      bctx.stroke();
    }else{
      // 나무 막대기: 끝이 굵고 결이 보이게
      const stickGrad=bctx.createLinearGradient(8,0,68,0);
      stickGrad.addColorStop(0,"#5b371f");
      stickGrad.addColorStop(.5,"#8a5c35");
      stickGrad.addColorStop(1,"#60391f");
      bctx.strokeStyle=stickGrad;
      bctx.lineWidth=9;
      bctx.beginPath();
      bctx.moveTo(10,0);
      bctx.lineTo(67,0);
      bctx.stroke();

      bctx.strokeStyle="rgba(238,190,125,.35)";
      bctx.lineWidth=2;
      bctx.beginPath();
      bctx.moveTo(20,-2);
      bctx.lineTo(58,-2);
      bctx.stroke();
    }

    if(swinging){
      // 2중 베기 궤적
      bctx.strokeStyle="rgba(255,249,218,.92)";
      bctx.lineWidth=5;
      bctx.beginPath();
      bctx.arc(0,0,76,-.82,.63);
      bctx.stroke();

      bctx.strokeStyle="rgba(255,214,132,.38)";
      bctx.lineWidth=10;
      bctx.beginPath();
      bctx.arc(0,0,68,-.76,.55);
      bctx.stroke();
    }

    bctx.restore();

    // 쿨타임 원형 표시
    const remaining=Math.max(0,weaponCooldownUntil-performance.now());
    if(remaining>0 && currentWeaponCooldown>0){
      const ratio=1-remaining/currentWeaponCooldown;
      bctx.save();
      bctx.strokeStyle="rgba(255,255,255,.75)";
      bctx.lineWidth=3;
      bctx.beginPath();
      bctx.arc(cx,cy+30,12,-Math.PI/2,-Math.PI/2+Math.PI*2*ratio);
      bctx.stroke();
      bctx.restore();
    }
  }

  // 벙커에 들어온 다른 방원 표시
  Object.values(bunkerOthers).forEach(p=>{
    if(p.id===myId)return;
    const sx=p.x-camX, sy=p.y-camY;
    bctx.fillStyle=p.color||"#ccc";
    bctx.fillRect(sx,sy,30,30);
    bctx.strokeStyle="#fff";
    bctx.lineWidth=1.5;
    bctx.strokeRect(sx,sy,30,30);
    bctx.fillStyle="#251f19";
    bctx.font="11px Malgun Gothic";
    bctx.fillText(p.nickname||"Player",sx-3,sy-6);
  });

  bctx.restore();
  requestAnimationFrame(drawBunkerInterior);
}

function bunkerNearestObject(){
  let result=null,best=92;

  for(const o of BUNKER_OBJECTS){
    // 계단은 장식용
    if(o.id==="stairs") continue;

    const cx=o.x+o.w/2,cy=o.y+o.h/2;
    const d=Math.hypot(bunkerPlayer.x-cx,bunkerPlayer.y-cy);

    if(d<best){
      best=d;
      result=o;
    }
  }

  bunkerNear=result;
  $("bunkerPrompt").classList.toggle("hidden",!result);

  if(result){
    const count=bunkerStockCount(result.id);

    if(count!==null){
      const action=
        result.id==="water" ? "마시기" :
        result.id==="beans" ? "먹기" :
        result.id==="medkit" ? "사용" :
        "확인";

      $("bunkerPrompt").textContent=
        `E · ${result.label} ${count}개 · ${action}`;
    }else if(result.id==="showerRoom"){
      $("bunkerPrompt").textContent=`E · 샤워하기 · 비누 ${bunkerStock.soap||0}개`;
    }else if(result.id==="bunkerDoor"){
      $("bunkerPrompt").textContent="E · 식료품점 탐사 모집";
    }else{
      $("bunkerPrompt").textContent=`E · ${result.label} 사용`;
    }
  }
}

function bunkerMoveLoop(){
  if(ventRenderRunning){
    requestAnimationFrame(bunkerMoveLoop);
    return;
  }

  if(!bunkerRunning)return;

  let dx=(bunkerKeys.has("d")?1:0)-(bunkerKeys.has("a")?1:0);
  let dy=(bunkerKeys.has("s")?1:0)-(bunkerKeys.has("w")?1:0);

  if(Math.abs(joystickX)>.03||Math.abs(joystickY)>.03){
    dx=joystickX;
    dy=joystickY;
  }else if(dx&&dy){
    dx*=.707;
    dy*=.707;
  }

  if(
    Math.abs(dx)+Math.abs(dy)>.05 &&
    performance.now()>=bunkerSwingUntil
  ){
    const len=Math.hypot(dx,dy)||1;
    bunkerFacing.x=dx/len;
    bunkerFacing.y=dy/len;
  }

  const nx=bunkerPlayer.x+dx*3.0;
  const ny=bunkerPlayer.y+dy*3.0;

  if(!bunkerBlocked(nx,bunkerPlayer.y)) bunkerPlayer.x=nx;
  if(!bunkerBlocked(bunkerPlayer.x,ny)) bunkerPlayer.y=ny;

  bunkerNearestObject();

  const now=performance.now();
  if(now-lastBunkerSend>70){
    ioClient.emit("bunker-move",{
      x:bunkerPlayer.x,
      y:bunkerPlayer.y,
      facingX:bunkerFacing.x,
      facingY:bunkerFacing.y
    });
    lastBunkerSend=now;
  }

  requestAnimationFrame(bunkerMoveLoop);
}

function openWeaponStorage(){
  const names={
    woodenStick:"🪵 나무 막대기",
    axe:"🪓 도끼"
  };

  const entries=Object.entries(weapons||{}).filter(([,count])=>count>0);

  $("weaponList").innerHTML=
    entries.length
      ? entries.map(([type,count])=>`
        <div class="weapon-row">
          <span>${names[type]||type} × ${count}</span>
          <button data-equip="${type}">
            ${equippedWeapon===type ? "장착 중" : "장착"}
          </button>
        </div>
      `).join("")
      : "<div>현재 보관된 무기가 없습니다.</div>";

  $("weaponPanel").classList.remove("hidden");
}

$("weaponList").addEventListener("click",e=>{
  const weapon=e.target.dataset.equip;
  if(!weapon)return;

  ioClient.emit("equip-weapon",weapon,r=>{
    if(!r?.ok){
      toast(r?.message||"장착 실패");
      return;
    }

    equippedWeapon=r.weapon;
    toast("무기 장착");
    openWeaponStorage();

    $("swingButton").classList.remove("hidden");
  });
});

$("weaponClose").onclick=()=>$("weaponPanel").classList.add("hidden");

function computerHTML(tab){
  if(tab==="cctv"){
    return `
      <h3>CCTV</h3>
      <p>1층 카메라: ONLINE</p>
      <p>2층 카메라: ONLINE</p>
      <p>3층 카메라: ONLINE</p>
      <p>현재 CCTV는 상태 확인용입니다.</p>
    `;
  }

  if(tab==="security"){
    return `
      <h3>SECURITY</h3>
      <p>Vault Door: <b>${securityState}</b></p>
      <p>Power: <b>${power}%</b></p>
      <p>Vent: <b>NORMAL</b></p>
      <p>Exterior Sensors: <b>ONLINE</b></p>
    `;
  }

  if(tab==="bounty"){
    const pct=(bounty/3)*100;
    return `
      <h3>BOUNTY HUNTER</h3>
      <div class="bounty-bar"><div class="bounty-fill" style="width:${pct}%"></div></div>
      <p>게이지: ${bounty} / 3</p>
      <p>Hunter Level: ${bountyLevel}</p>
      ${
        bounty>=3
          ? '<p class="warning-text">WARNING: BOUNTY HUNTER INCOMING</p>'
          : '<p>Status: NOT COMING</p>'
      }
    `;
  }

  const price={
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

  return `
    <h3>SANITY SHOP</h3>
    <p>보유 Sanity: <b>${sanity} SP</b></p>
    ${Object.entries(price).map(([type,p])=>`
      <div class="shop-row">
        <span>${ICON[type]} ${ITEM_NAME[type]} — ${p.toLocaleString()} SP</span>
        <button data-buy="${type}">구매</button>
      </div>
    `).join("")}
  `;
}

function openComputer(){
  $("computerPanel").classList.remove("hidden");
  $("computerClose").classList.remove("hidden");
  $("computerContent").innerHTML=computerHTML("cctv");
}

$("computerClose").onclick=()=>{
  $("computerPanel").classList.add("hidden");
  $("computerClose").classList.add("hidden");
};

document.querySelector(".computer-tabs").onclick=e=>{
  const tab=e.target.dataset.tab;
  if(!tab)return;
  $("computerContent").innerHTML=computerHTML(tab);
};

$("computerContent").onclick=e=>{
  const type=e.target.dataset.buy;
  if(!type)return;

  ioClient.emit("buy-sanity-item",type,r=>{
    if(!r.ok)return toast(r.message);
    sanity=r.sanity;
    bunkerStock=r.bunkerStock;
    weapons=r.weapons;
    updateStatusUI();
    $("computerContent").innerHTML=computerHTML("shop");
    toast("구매 완료");
  });
};

function consumeBunker(type){
  ioClient.emit("consume-bunker-item",{
    type,
    roomCode:room?.code,
    sessionId,
    nickname:$("nick").value.trim()
  },r=>{
    if(!r.ok){
      toast(r.message);
      return;
    }

    bunkerStock=r.bunkerStock||bunkerStock;

    if(r.stats){
      hp=r.stats.hp??hp;
      hunger=r.stats.hunger??hunger;
      thirst=r.stats.thirst??thirst;
      hygiene=r.stats.hygiene??hygiene;
      if(typeof r.stats.sick==="boolean")playerSick=r.stats.sick;
    }

    if(type==="water")toast("물을 마셨습니다. 갈증 +70");
    else if(type==="beans")toast("통조림을 먹었습니다. 허기 +50");
    else if(type==="medkit")toast("메디킷을 사용했습니다. HP 완전 회복");
    else if(type==="soap"){
      playerSick=false;
      $("sickBadge")?.classList.add("hidden");
      toast("샤워 완료 · 깨끗함 100% · Sickness 치료");
    }

    updateStatusUI();
  });
}



function threatName(type){
  return {
    ventLady:"Vent Lady",
    spider:"Spider",
    rats:"Rats",
    cameraBug:"Camera Bug"
  }[type]||"없음";
}

function ventDistanceText(stage){
  if(stage<=0)return "이상 없음";
  if(stage===1)return "멀리 있음";
  if(stage===2)return "중간";
  return "가까움";
}

function resizeVentCanvas(){
  const c=$("ventCanvas");
  if(!c)return;

  const d=devicePixelRatio||1;
  const vw=visualViewport?.width||innerWidth;
  const vh=visualViewport?.height||innerHeight;

  c.width=Math.round(vw*d);
  c.height=Math.round(vh*d);
  c.style.width=`${vw}px`;
  c.style.height=`${vh}px`;

  c.getContext("2d").setTransform(d,0,0,d,0,0);
}

function drawVentInspection(){
  if(!ventRenderRunning)return;

  const c=$("ventCanvas");
  const vctx=c.getContext("2d");
  const vw=visualViewport?.width||innerWidth;
  const vh=visualViewport?.height||innerHeight;

  const state=ventStates[selectedVentId]||{closed:false,threat:null,stage:0};

  vctx.clearRect(0,0,vw,vh);
  vctx.fillStyle="#050706";
  vctx.fillRect(0,0,vw,vh);

  const entranceX=vw*.055;
  const farX=vw*.69;
  const topNear=vh*.10;
  const bottomNear=vh*.90;
  const topFar=vh*.30;
  const bottomFar=vh*.70;

  const tunnelGrad=vctx.createLinearGradient(entranceX,0,farX,0);
  tunnelGrad.addColorStop(0,"#6c7371");
  tunnelGrad.addColorStop(.18,"#4f5654");
  tunnelGrad.addColorStop(.55,"#252a28");
  tunnelGrad.addColorStop(1,"#090b0a");
  vctx.fillStyle=tunnelGrad;
  vctx.beginPath();
  vctx.moveTo(entranceX,topNear);
  vctx.lineTo(farX,topFar);
  vctx.lineTo(farX,bottomFar);
  vctx.lineTo(entranceX,bottomNear);
  vctx.closePath();
  vctx.fill();

  vctx.strokeStyle="rgba(190,201,196,.20)";
  vctx.lineWidth=2;
  for(let i=1;i<=7;i++){
    const t=i/8;
    const x=entranceX+(farX-entranceX)*t;
    const top=topNear+(topFar-topNear)*t;
    const bottom=bottomNear+(bottomFar-bottomNear)*t;
    vctx.beginPath();
    vctx.moveTo(x,top);
    vctx.lineTo(x,bottom);
    vctx.stroke();

    vctx.fillStyle="rgba(215,221,218,.34)";
    vctx.beginPath();
    vctx.arc(x,top+10,2.4,0,Math.PI*2);
    vctx.arc(x,bottom-10,2.4,0,Math.PI*2);
    vctx.fill();
  }

  vctx.strokeStyle="rgba(25,29,27,.70)";
  vctx.lineWidth=3;
  for(let i=1;i<9;i++){
    const t=i/9;
    const y=bottomNear-(bottomNear-bottomFar)*t;
    vctx.beginPath();
    vctx.moveTo(entranceX,y);
    vctx.lineTo(farX,bottomFar);
    vctx.stroke();
  }

  vctx.strokeStyle="#493f34";
  vctx.lineWidth=4;
  vctx.beginPath();
  vctx.moveTo(entranceX+20,topNear+65);
  vctx.bezierCurveTo(vw*.24,topNear+38,vw*.45,topFar+30,farX-15,topFar+48);
  vctx.stroke();

  vctx.strokeStyle="#66522e";
  vctx.lineWidth=2;
  vctx.beginPath();
  vctx.moveTo(entranceX+20,topNear+74);
  vctx.bezierCurveTo(vw*.28,topNear+60,vw*.47,topFar+44,farX-10,topFar+60);
  vctx.stroke();

  const fanX=farX-20;
  const fanY=(topFar+bottomFar)/2;
  const fanR=Math.max(42,Math.min(vw,vh)*.085);

  vctx.fillStyle="#111512";
  vctx.beginPath();
  vctx.arc(fanX,fanY,fanR*1.22,0,Math.PI*2);
  vctx.fill();

  vctx.strokeStyle="#4a514e";
  vctx.lineWidth=6;
  vctx.beginPath();
  vctx.arc(fanX,fanY,fanR*1.05,0,Math.PI*2);
  vctx.stroke();

  vctx.save();
  vctx.translate(fanX,fanY);
  vctx.rotate(performance.now()/1500);
  for(let i=0;i<6;i++){
    vctx.rotate(Math.PI/3);
    vctx.fillStyle="#343a37";
    vctx.beginPath();
    vctx.moveTo(5,-8);
    vctx.quadraticCurveTo(fanR*.62,-fanR*.20,fanR*.84,5);
    vctx.quadraticCurveTo(fanR*.55,fanR*.16,8,9);
    vctx.closePath();
    vctx.fill();
  }
  vctx.fillStyle="#202522";
  vctx.beginPath();
  vctx.arc(0,0,fanR*.18,0,Math.PI*2);
  vctx.fill();
  vctx.restore();

  const lightX=vw*.24;
  const lightY=topNear+58;
  const lightGrad=vctx.createRadialGradient(lightX,lightY,2,lightX,lightY,85);
  lightGrad.addColorStop(0,"rgba(227,220,162,.68)");
  lightGrad.addColorStop(1,"rgba(227,220,162,0)");
  vctx.fillStyle=lightGrad;
  vctx.beginPath();
  vctx.arc(lightX,lightY,85,0,Math.PI*2);
  vctx.fill();

  vctx.fillStyle="#d8d1a0";
  vctx.fillRect(lightX-15,lightY-4,30,8);

  if(!state.threat && !state.closed){
    vctx.fillStyle="rgba(216,224,219,.68)";
    vctx.font="700 15px sans-serif";
    vctx.fillText("NO MOVEMENT",entranceX+36,bottomNear-30);
  }

  if(state.closed){
    vctx.fillStyle="rgba(23,27,25,.97)";
    vctx.fillRect(entranceX,topNear,farX-entranceX,bottomNear-topNear);
    vctx.strokeStyle="#515a56";
    vctx.lineWidth=8;
    for(let y=topNear+30;y<bottomNear;y+=44){
      vctx.beginPath();
      vctx.moveTo(entranceX+10,y);
      vctx.lineTo(farX-10,y);
      vctx.stroke();
    }
    vctx.fillStyle="#dadcd6";
    vctx.font="900 34px sans-serif";
    vctx.fillText("VENT CLOSED",entranceX+35,(topNear+bottomNear)/2);
  }

  if(state.threat && !state.closed){
    const stage=Math.max(1,Math.min(3,state.stage||1));
    const px=stage===1 ? farX-45 : stage===2 ? entranceX+(farX-entranceX)*.57 : entranceX+(farX-entranceX)*.26;
    const py=(topNear+bottomNear)/2;
    const size=stage===1 ? 34 : stage===2 ? 66 : 108;
    vctx.globalAlpha=stage===1 ? .58 : stage===2 ? .80 : 1;

    if(state.threat==="rats"){
      for(let i=0;i<3;i++){
        const ox=(i-1)*size*.42;
        vctx.fillStyle="#3d3129";
        vctx.beginPath();
        vctx.ellipse(px+ox,py+(i%2)*11,size*.34,size*.20,0,0,Math.PI*2);
        vctx.fill();
        vctx.beginPath();
        vctx.arc(px+ox+size*.27,py-7+(i%2)*11,size*.13,0,Math.PI*2);
        vctx.fill();
      }
    }else if(state.threat==="spider"){
      vctx.strokeStyle="#29201d";
      vctx.fillStyle="#302521";
      vctx.lineWidth=Math.max(3,size*.065);
      vctx.beginPath();
      vctx.ellipse(px,py,size*.26,size*.21,0,0,Math.PI*2);
      vctx.fill();
      for(let i=0;i<8;i++){
        const a=(Math.PI*2/8)*i;
        vctx.beginPath();
        vctx.moveTo(px+Math.cos(a)*size*.12,py+Math.sin(a)*size*.10);
        vctx.lineTo(px+Math.cos(a)*size*.55,py+Math.sin(a)*size*.48);
        vctx.stroke();
      }
    }else if(state.threat==="ventLady"){
      vctx.fillStyle="#111413";
      vctx.beginPath();
      vctx.arc(px,py-size*.32,size*.18,0,Math.PI*2);
      vctx.fill();
      vctx.beginPath();
      vctx.moveTo(px-size*.21,py-size*.13);
      vctx.lineTo(px+size*.21,py-size*.13);
      vctx.lineTo(px+size*.31,py+size*.53);
      vctx.lineTo(px-size*.31,py+size*.53);
      vctx.closePath();
      vctx.fill();
    }else{
      vctx.fillStyle="#303936";
      vctx.fillRect(px-size*.34,py-size*.27,size*.68,size*.54);
      vctx.fillStyle="#151a18";
      vctx.fillRect(px-size*.22,py-size*.14,size*.44,size*.28);
      vctx.fillStyle="#bbc56c";
      vctx.beginPath();
      vctx.arc(px,py,size*.11,0,Math.PI*2);
      vctx.fill();
    }

    vctx.globalAlpha=1;
    vctx.fillStyle="rgba(245,58,44,.92)";
    vctx.beginPath();
    vctx.arc(px-size*.075,py-size*.10,Math.max(3,size*.03),0,Math.PI*2);
    vctx.arc(px+size*.075,py-size*.10,Math.max(3,size*.03),0,Math.PI*2);
    vctx.fill();
  }

  vctx.globalAlpha=1;
  requestAnimationFrame(drawVentInspection);
}
function refreshVentPanel(){
  if(!selectedVentId)return;

  const state=ventStates[selectedVentId]||{
    closed:false,
    threat:null,
    stage:0
  };

  $("ventPanelTitle").textContent=
    selectedVentId==="ventTop" ? "상단 환풍구" :
    selectedVentId==="ventLeft" ? "왼쪽 환풍구" :
    "오른쪽 환풍구";

  $("ventDistanceLabel").textContent=
    state.closed ? "닫혀 있음" :
    state.threat ? ventDistanceText(state.stage) :
    "이상 없음";

  $("ventToggle").querySelector("span").textContent=
    state.closed ? "벤트 열기" : "벤트 닫기";

  $("ventSprayCount").textContent=
    `스프레이 ×${bunkerStock.spray||0}`;

  $("ventTrapCount").textContent=
    `덫 ×${bunkerStock.trap||0}`;
}

function openVentPanel(ventId){
  selectedVentId=ventId;
  refreshVentPanel();

  $("ventPanel").classList.remove("hidden");
  ventRenderRunning=true;
  resizeVentCanvas();
  drawVentInspection();

  // 벤트 화면에서는 캐릭터 이동 방지
  resetJoystick();
}

function closeVentPanel(){
  ventRenderRunning=false;
  $("ventPanel").classList.add("hidden");
  selectedVentId=null;
}

$("ventPanelClose").onclick=closeVentPanel;

function doVentAction(action){
  if(!selectedVentId)return;

  const selected=selectedVentId;

  ioClient.emit("vent-action",{
    action,
    ventId:selected,
    roomCode:room?.code,
    sessionId,
    nickname:$("nick").value.trim()
  },r=>{
    if(!r?.ok){
      toast(r?.message||"처리 실패");
      return;
    }

    if(r.message)toast(r.message);

    if(action==="toggle"){
      const state=ventStates[selected]||{};
      state.closed=r.closed;
      ventStates[selected]=state;
    }

    refreshVentPanel();
  });
}

$("ventToggle").onclick=()=>doVentAction("toggle");
$("ventSpray").onclick=()=>doVentAction("spray");
$("ventTrap").onclick=()=>doVentAction("trap");

addEventListener("resize",()=>{
  if(ventRenderRunning)resizeVentCanvas();
});
if(window.visualViewport){
  visualViewport.addEventListener("resize",()=>{
    if(ventRenderRunning)resizeVentCanvas();
  });
}

function interactBunker(){
  // v19: 환풍구는 무조건 전용 내부 화면으로 진입
  if(bunkerNear && ["ventTop","ventLeft","ventBottom"].includes(bunkerNear.id)){
    openVentPanel(bunkerNear.id);
    return;
  }

  if(!bunkerNear)return;

  if(bunkerNear.id==="computer"){
    openComputer();
    return;
  }

  if(bunkerNear.id==="weapons"){
    openWeaponStorage();
    return;
  }

  if(bunkerNear.id==="beans"){
    consumeBunker("beans");
    return;
  }

  if(bunkerNear.id==="water"){
    consumeBunker("water");
    return;
  }

  if(bunkerNear.id==="medkit"){
    consumeBunker("medkit");
    return;
  }

  if(bunkerNear.id==="blueprints"){
    toast(`블루프린트 ${bunkerStock.blueprint||0}개`);
    return;
  }

  if(bunkerNear.id==="power"){
    toast(`전력 ${power}%`);
    return;
  }

  if(bunkerNear.id==="bunkerDoor"){
    requestExpedition();
    return;
  }

  if(bunkerNear.id==="showerRoom"){
    if((bunkerStock.soap||0)<=0){
      toast("비누가 없습니다.");
      return;
    }
    consumeBunker("soap");
    return;
  }

  

  toast(`${bunkerNear.label}`);
}


$("bunkerPrompt").addEventListener("click",()=>{
  if(bunkerRunning)interactBunker();
});

addEventListener("keydown",e=>{
  if(!bunkerRunning)return;
  const k=e.key.toLowerCase();
  bunkerKeys.add(k);
  if(k==="e")interactBunker();
});
addEventListener("keyup",e=>{
  if(bunkerRunning)bunkerKeys.delete(e.key.toLowerCase());
});

function updateMobileActionVisibility(scene){
  const pick=$("mPick"),store=$("mStore"),stairBtn=$("mStair"),swing=$("mSwing"),hands=document.querySelector(".hands");
  if(!pick||!store||!stairBtn)return;
  if(hands)hands.style.display=scene==="bunker"?"none":"block";
  if(scene==="bunker"){
    pick.style.display="none";
    store.style.display="none";
    stairBtn.style.display="none";
    if(swing){
      swing.style.display=equippedWeapon?"inline-block":"none";
      swing.textContent="공격";
    }
  }else if(scene==="expedition"){
    pick.style.display="inline-block"; pick.textContent="줍기"; store.style.display="none"; stairBtn.style.display="none"; if(swing)swing.style.display=equippedWeapon?"inline-block":"none";
  }else{
    pick.style.display="inline-block"; pick.textContent="줍기"; store.style.display="inline-block"; stairBtn.style.display="inline-block"; if(swing)swing.style.display="none";
  }
}

function enterBunkerScene(){
  document.body.classList.remove("chat-open");
  updateMobileActionVisibility("bunker");
  $("bunkerUI").classList.remove("hidden");
  $("fadeOverlay").classList.remove("hidden");
  resizeBunkerCanvas();

  // 상태책은 벙커 안에서만 표시
  $("bookButton").classList.remove("hidden");
  $("messageButton").classList.remove("hidden");

  $("bookButton").style.setProperty("display","block","important");
  $("bookButton").style.setProperty("z-index","125","important");
  $("messageButton").style.setProperty("display","block","important");
  $("messageButton").style.setProperty("z-index","125","important");
  $("statusPanel").classList.add("hidden");

  // 모바일 조이스틱은 벙커에서도 유지
  const mobileControls=document.querySelector(".mobile");
  if(mobileControls){
    mobileControls.style.setProperty("display","block","important");
    mobileControls.style.setProperty("z-index","140","important");
  }

  const joystickBase=$("joystickBase");
  if(joystickBase){
    joystickBase.style.setProperty("display","block","important");
  }

  $("bookButton").style.setProperty("display","block","important");
  $("bookButton").style.setProperty("z-index","140","important");
  $("messageButton").style.setProperty("display","block","important");
  $("messageButton").style.setProperty("z-index","140","important");

  ioClient.emit("get-bunker-players",r=>{
    if(r?.ok){
      bunkerOthers={};
      r.players.forEach(p=>bunkerOthers[p.id]=p);
    }
  });

  ioClient.emit("get-vent-state",{
    roomCode:room?.code,
    sessionId,
    nickname:$("nick").value.trim()
  },r=>{
    if(!r?.ok)return;

    (r.vents||[]).forEach(v=>{
      ventStates[v.id]={...v};
    });

    bunkerMobs={};
    (r.bunkerMobs||[]).forEach(m=>{
      bunkerMobs[m.id]={...m};
    });
  });

  // 계단은 장식용이며, 벙커 진입 시 계단의 위쪽에서 시작
  bunkerPlayer.x=330;
  bunkerPlayer.y=560;
  bunkerRunning=true;

  drawBunkerInterior();
  bunkerMoveLoop();

  requestAnimationFrame(()=>{
    setTimeout(()=>{
      $("fadeOverlay").style.opacity="0";
      setTimeout(()=>$("fadeOverlay").classList.add("hidden"),1300);
    },350);
  });
}


function renderChatMessage(message){
  const row=document.createElement("div");
  row.className=
    "chat-message" +
    (message.playerId===myId ? " mine" : "");

  const time=new Date(message.time).toLocaleTimeString(
    [],
    {hour:"2-digit",minute:"2-digit"}
  );

  const header=document.createElement("span");
  header.className="chat-name";
  header.textContent=message.nickname;

  const stamp=document.createElement("span");
  stamp.className="chat-time";
  stamp.textContent=time;
  header.appendChild(stamp);

  const body=document.createElement("div");
  body.textContent=message.text;

  row.append(header,body);
  $("messageList").appendChild(row);
}

function scrollChatBottom(){
  $("messageList").scrollTop=$("messageList").scrollHeight;
}

$("messageButton").onclick=()=>{
  ioClient.emit("get-messages",r=>{
    if(!r?.ok){
      toast("채팅을 불러올 수 없습니다.");
      return;
    }

    $("messageList").innerHTML="";
    r.messages.forEach(renderChatMessage);
    $("messagePanel").classList.remove("hidden");
    document.body.classList.add("chat-open");
    if(matchMedia("(orientation: portrait)").matches)resetJoystick();
    scrollChatBottom();
    setTimeout(()=>$("messageInput").focus(),80);
  });
};

$("messageClose").onclick=()=>{
  $("messagePanel").classList.add("hidden");
  document.body.classList.remove("chat-open");
};

function sendTeamMessage(){
  const text=$("messageInput").value.trim();
  if(!text)return;

  ioClient.emit("send-message",text,r=>{
    if(!r?.ok){
      toast(r?.message||"전송 실패");
      return;
    }

    $("messageInput").value="";
  });
}

$("messageSend").onclick=sendTeamMessage;

$("messageInput").addEventListener("keydown",e=>{
  if(e.key==="Enter"){
    e.preventDefault();
    sendTeamMessage();
  }
});

ioClient.on("team-message",message=>{
  renderChatMessage(message);
  scrollChatBottom();
});


ioClient.on("bunker-player-jumped",d=>{
  if(d.id===myId){
    bunkerJumping=true;
    bunkerJumpUntil=performance.now()+520;
  }else if(bunkerOthers[d.id]){
    bunkerOthers[d.id].jumping=true;
    bunkerOthers[d.id].jumpUntil=Date.now()+520;
  }
});

ioClient.on("bunker-player-landed",d=>{
  if(d.id===myId){
    bunkerJumping=false;
  }else if(bunkerOthers[d.id]){
    bunkerOthers[d.id].jumping=false;
  }
});

ioClient.on("bunker-player-moved",p=>{
  bunkerOthers[p.id]={...(bunkerOthers[p.id]||{}),...p};
});

ioClient.on("bunker-player-left",data=>{
  delete bunkerOthers[data.id];
});




function updateMouseWeaponFacing(clientX,clientY){
  const vw=visualViewport?.width||innerWidth;
  const vh=visualViewport?.height||innerHeight;
  const dx=clientX-vw/2;
  const dy=clientY-vh/2;
  const len=Math.hypot(dx,dy);

  if(len<8)return;

  const facing={x:dx/len,y:dy/len};

  if(bunkerRunning){
    bunkerFacing=facing;
  }
  if(expeditionRunning){
    expeditionFacing=facing;
  }
}

addEventListener("pointermove",e=>{
  if(e.pointerType==="touch")return;
  if(bunkerRunning||expeditionRunning){
    updateMouseWeaponFacing(e.clientX,e.clientY);
  }
});

// =========================================================
// v10 식료품점 탐사
// =========================================================
const expeditionCanvas=$("expeditionCanvas");
const exctx=expeditionCanvas.getContext("2d");

const EX_W=1200,EX_H=960,EX_P=30;
const EX_SOLIDS=[
  // 바깥 벽
  {x:0,y:0,w:1200,h:30},
  {x:0,y:930,w:1200,h:30},
  {x:0,y:0,w:30,h:960},
  {x:1170,y:0,w:30,h:960},

  // 계산대
  {x:160,y:120,w:360,h:65},

  // 진열대 열
  {x:190,y:270,w:170,h:70},
  {x:420,y:270,w:170,h:70},
  {x:650,y:270,w:170,h:70},
  {x:880,y:270,w:150,h:70},

  {x:190,y:470,w:170,h:70},
  {x:420,y:470,w:170,h:70},
  {x:650,y:470,w:170,h:70},
  {x:880,y:470,w:150,h:70},

  {x:190,y:670,w:170,h:70},
  {x:420,y:670,w:170,h:70},
  {x:650,y:670,w:170,h:70},
  {x:880,y:670,w:150,h:70}
];



const hospitalMapV30Img=new Image();
hospitalMapV30Img.src="hospital_v30.png";

const HOSPITAL_V30_W=2400;
const HOSPITAL_V30_H=2820;
const HOSPITAL_V30_GRID_W=160;
const HOSPITAL_V30_GRID_H=188;
const HOSPITAL_V30_RUNS=[[],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[36,120]],[[72,88]],[[1,19],[72,87]],[[1,19],[72,87]],[[1,19],[72,87]],[[1,19],[72,87]],[[1,19],[72,87]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[70,91],[138,157]],[[1,19],[67,91],[137,157]],[[1,20],[67,91],[137,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,157]],[[1,93],[137,157]],[[1,20],[64,93],[137,157]],[[1,19],[67,93],[137,157]],[[1,19],[67,93],[138,157]],[[1,19],[72,93],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,157]],[[1,19],[72,87],[138,158]],[[1,19],[72,87],[138,158]],[[1,19],[72,87],[138,158]],[[1,19],[72,87],[138,158]],[[1,19],[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,87],[138,158]],[[72,88],[138,158]],[[72,158]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[72,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[129,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[117,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[112,144]],[[113,144]],[]];

function hospitalWalkableClientV30(x,y,radius=12){
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

    let ok=false;
    for(const r of HOSPITAL_V30_RUNS[gy]||[]){
      if(gx>=r[0]&&gx<=r[1]){ok=true;break;}
    }
    if(!ok)return false;
  }

  return true;
}
const HOSPITAL_WALKABLE_V26=[
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

function hospitalWalkableClientV26(x,y,radius=15){
  return HOSPITAL_WALKABLE_V26.some(r=>
    x-radius>=r.x &&
    x+radius<=r.x+r.w &&
    y-radius>=r.y &&
    y+radius<=r.y+r.h
  );
}

function hospitalHasLineOfSightV29(x1,y1,x2,y2){
  if(expeditionLocation!=="hospital")return true;

  const dist=Math.hypot(x2-x1,y2-y1);
  const steps=Math.max(1,Math.ceil(dist/12));

  for(let i=1;i<steps;i++){
    const t=i/steps;
    const x=x1+(x2-x1)*t;
    const y=y1+(y2-y1)*t;

    // ray가 검정 영역을 한 번이라도 지나면 벽 뒤로 판단
    if(!hospitalWalkableClientV30(x,y,2)){
      return false;
    }
  }

  return true;
}

function hospitalVisibleFromPlayerV29(worldX,worldY){
  if(expeditionLocation!=="hospital")return true;

  return hospitalHasLineOfSightV29(
    expeditionPlayer.x+15,
    expeditionPlayer.y+15,
    worldX,
    worldY
  );
}



const HOSPITAL_SOLIDS=[
  {x:0,y:0,w:1200,h:28},{x:0,y:932,w:1200,h:28},
  {x:0,y:0,w:28,h:960},{x:1172,y:0,w:28,h:960},

  {x:360,y:55,w:430,h:22},
  {x:360,y:55,w:22,h:105},
  {x:768,y:55,w:22,h:105},

  {x:500,y:160,w:22,h:500},
  {x:590,y:160,w:22,h:500},

  {x:95,y:180,w:22,h:400},
  {x:190,y:180,w:22,h:185},
  {x:190,y:425,w:22,h:155},

  {x:190,y:300,w:250,h:20},
  {x:190,y:365,w:205,h:20},
  {x:430,y:300,w:20,h:30},
  {x:430,y:355,w:20,h:30},

  {x:612,y:300,w:280,h:20},
  {x:612,y:365,w:280,h:20},

  {x:890,y:195,w:22,h:350},
  {x:980,y:195,w:22,h:350},

  {x:890,y:545,w:110,h:20},
  {x:978,y:545,w:22,h:120},
  {x:890,y:645,w:110,h:20},

  {x:500,y:660,w:285,h:20},
  {x:500,y:735,w:285,h:20},

  {x:785,y:660,w:22,h:235},
  {x:865,y:735,w:22,h:160},
  {x:720,y:830,w:65,h:22}
];

function currentExpeditionSolids(){
  return expeditionLocation==="hospital"
    ? HOSPITAL_SOLIDS
    : EX_SOLIDS;
}
function resizeExpeditionCanvas(){
  const d=devicePixelRatio||1;
  const vw=visualViewport?.width||innerWidth;
  const vh=visualViewport?.height||innerHeight;

  expeditionCanvas.width=Math.round(vw*d);
  expeditionCanvas.height=Math.round(vh*d);
  expeditionCanvas.style.width=`${vw}px`;
  expeditionCanvas.style.height=`${vh}px`;
  exctx.setTransform(d,0,0,d,0,0);
}

function exBlocked(x,y){
  if(expeditionLocation==="hospital"){
    return !hospitalWalkableClientV30(x+15,y+15,12);
  }
  return currentExpeditionSolids().some(r=>
    x+EX_P>r.x &&
    x<r.x+r.w &&
    y+EX_P>r.y &&
    y<r.y+r.h
  );
}

function exFindNear(){
  expeditionNear=null;
  expeditionReturnNear=false;

  const returnDistance=Math.hypot(
    expeditionPlayer.x+15-expeditionReturnPoint.x,
    expeditionPlayer.y+15-expeditionReturnPoint.y
  );

  if(returnDistance<85){
    expeditionReturnNear=true;
    $("expeditionPrompt").classList.remove("hidden");
    $("expeditionPrompt").textContent="E · 벙커로 돌아가기";
    return;
  }

  let best=999;

  expeditionItems.forEach(item=>{
    if(item.taken)return;

    const dist=Math.hypot(
      expeditionPlayer.x+15-item.x,
      expeditionPlayer.y+15-item.y
    );

    if(dist<75&&dist<best){
      best=dist;
      expeditionNear=item;
    }
  });

  $("expeditionPrompt").classList.toggle("hidden",!expeditionNear);

  if(expeditionNear){
    $("expeditionPrompt").textContent=
      `E · ${ICON[expeditionNear.type]} ${ITEM_NAME[expeditionNear.type]} 줍기 (${defs[expeditionNear.type]?.slots||1}칸)`;
  }
}
function drawExpedition(){
  if(!expeditionRunning)return;

  const vw=visualViewport?.width||innerWidth;
  const vh=visualViewport?.height||innerHeight;
  const camX=expeditionPlayer.x+15-vw/2;
  const camY=expeditionPlayer.y+15-vh/2;

  exctx.clearRect(0,0,vw,vh);

  // 장소별 바닥/구조
  if(expeditionLocation==="hospital"){
    exctx.fillStyle="#000";
    exctx.fillRect(0,0,vw,vh);

    // v30 user map image: no synthetic door/thin-wall geometry.
    if(hospitalMapV30Img.complete){
      exctx.drawImage(
        hospitalMapV30Img,
        -camX,-camY,
        HOSPITAL_V30_W,HOSPITAL_V30_H
      );
    }

        // START FLOOR MARK: 바닥 표시일 뿐 벽이나 문이 아님.
    {
      const sx=1660-camX;
      const sy=1570-camY;
      exctx.strokeStyle="rgba(65,76,70,.55)";
      exctx.lineWidth=3;
      exctx.setLineDash([10,8]);
      exctx.strokeRect(sx-45,sy-45,90,90);
      exctx.setLineDash([]);
      exctx.fillStyle="rgba(45,55,50,.75)";
      exctx.font="bold 13px sans-serif";
      exctx.fillText("START / EXIT",sx-42,sy-56);
    }

    // v29 핵폭발 흔적: 이동 판정에는 영향 없는 시각 장식
    const scorchMarks=[
      {x:890,y:165,r:58},
      {x:250,y:500,r:45},
      {x:720,y:700,r:62},
      {x:1150,y:430,r:52},
      {x:1510,y:690,r:66},
      {x:2070,y:520,r:48},
      {x:1390,y:1210,r:72},
      {x:1870,y:1490,r:48}
    ];

    scorchMarks.forEach(s=>{
      const sx=s.x-camX,sy=s.y-camY;
      const g=exctx.createRadialGradient(sx,sy,3,sx,sy,s.r);
      g.addColorStop(0,"rgba(14,13,12,.48)");
      g.addColorStop(.55,"rgba(25,22,20,.25)");
      g.addColorStop(1,"rgba(25,22,20,0)");
      exctx.fillStyle=g;
      exctx.beginPath();
      exctx.arc(sx,sy,s.r,0,Math.PI*2);
      exctx.fill();
    });

    const debris=[
      [940,150],[280,720],[690,675],[1180,570],
      [1690,715],[2060,1040],[1510,1180],[1880,1540]
    ];

    debris.forEach(([x,y],i)=>{
      exctx.fillStyle=i%2?"#323733":"#3a3d39";
      exctx.fillRect(x-camX,y-camY,8+(i%3)*5,5+(i%2)*5);
    });

hospitalGlass.forEach(g=>{
      const sx=g.x-camX,sy=g.y-camY;
      exctx.strokeStyle="rgba(215,240,245,.95)";
      exctx.lineWidth=2;
      for(let i=0;i<9;i++){
        const a=i*Math.PI/4.5;
        exctx.beginPath();exctx.moveTo(sx,sy);
        exctx.lineTo(sx+Math.cos(a)*(12+(i%3)*6),sy+Math.sin(a)*(12+(i%3)*6));
        exctx.stroke();
      }
    });

    hospitalTripwires.forEach(w=>{
      exctx.strokeStyle="rgba(185,40,36,.92)";
      exctx.lineWidth=2;
      exctx.beginPath();
      exctx.moveTo(w.x1-camX,w.y1-camY);
      exctx.lineTo(w.x2-camX,w.y2-camY);
      exctx.stroke();
    });

    if(
      hospitalAbomination &&
      hospitalVisibleFromPlayerV29(
        hospitalAbomination.x+18,
        hospitalAbomination.y+20
      )
    ){
      const sx=hospitalAbomination.x-camX,sy=hospitalAbomination.y-camY;
      exctx.fillStyle="#242a26";
      exctx.beginPath();exctx.ellipse(sx+18,sy+20,19,30,0,0,Math.PI*2);exctx.fill();
      exctx.fillStyle="#4c5a50";exctx.fillRect(sx+7,sy+35,22,42);
      exctx.strokeStyle="#151a17";exctx.lineWidth=7;
      exctx.beginPath();
      exctx.moveTo(sx+8,sy+45);exctx.lineTo(sx-10,sy+70);
      exctx.moveTo(sx+28,sy+45);exctx.lineTo(sx+45,sy+72);exctx.stroke();
      exctx.strokeStyle="#877b6d";exctx.lineWidth=5;
      exctx.beginPath();exctx.moveTo(sx+7,sy+18);exctx.lineTo(sx+30,sy+18);exctx.stroke();
    }
  }else{
    // 식료품점
    exctx.fillStyle="#aca58d";
    exctx.fillRect(0,0,vw,vh);

    const tile=48;
    for(let y=Math.floor(camY/tile)*tile;y<camY+vh+tile;y+=tile){
      for(let x=Math.floor(camX/tile)*tile;x<camX+vw+tile;x+=tile){
        exctx.fillStyle=
          ((Math.floor(x/tile)+Math.floor(y/tile))%2===0)
          ? "#bbb49c"
          : "#a9a28c";
        exctx.fillRect(x-camX,y-camY,tile,tile);
      }
    }

    EX_SOLIDS.forEach((r,i)=>{
      exctx.fillStyle=i<4?"#49443a":"#75654d";
      exctx.fillRect(r.x-camX,r.y-camY,r.w,r.h);
      exctx.strokeStyle="#211e19";
      exctx.lineWidth=3;
      exctx.strokeRect(r.x-camX,r.y-camY,r.w,r.h);
    });
  }

  // 아이템
  expeditionItems.forEach(item=>{
    if(
      expeditionLocation==="hospital" &&
      !hospitalVisibleFromPlayerV29(item.x,item.y)
    )return;

    if(item.taken)return;
    exctx.font="27px sans-serif";
    exctx.fillText(ICON[item.type],item.x-camX,item.y-camY);
  });

  // 다른 탐사자
  Object.values(expeditionOthers).forEach(p=>{
    if(
      expeditionLocation==="hospital" &&
      !hospitalVisibleFromPlayerV29(p.x+15,p.y+15)
    )return;

    if(p.id===myId)return;

    let scale=1;
    let lift=0;

    if(p.jumping && p.jumpUntil){
      const remaining=Math.max(
        0,
        Math.min(1,(p.jumpUntil-performance.now())/520)
      );
      const phase=1-remaining;
      const arc=Math.sin(phase*Math.PI);
      scale=1+arc*.34;
      lift=arc*10;
    }

    const size=30*scale;

    exctx.fillStyle="rgba(0,0,0,.20)";
    exctx.beginPath();
    exctx.ellipse(
      p.x-camX+15,
      p.y-camY+34,
      14,
      5,
      0,0,Math.PI*2
    );
    exctx.fill();

    exctx.fillStyle=(p.color==="rainbow"?rainbowColorV30(Math.floor((p.x+p.y)/30)):(p.color||"#bbb"));
    exctx.fillRect(
      p.x-camX+15-size/2,
      p.y-camY+15-size/2-lift,
      size,
      size
    );

    exctx.fillStyle="#eee";
    exctx.font="11px sans-serif";
    exctx.fillText(
      p.nickname||"Player",
      p.x-camX-3,
      p.y-camY-6-lift
    );
  });

  // 돌연변이
  let nearestMutantDistance=Infinity;
  mutantNear=null;

  Object.values(expeditionMutants).forEach(m=>{
    if(!m.alive)return;

    const sx=m.x-camX;
    const sy=m.y-camY;

    const dist=Math.hypot(
      expeditionPlayer.x+15-(m.x+18),
      expeditionPlayer.y+15-(m.y+18)
    );

    if(dist<nearestMutantDistance){
      nearestMutantDistance=dist;
      mutantNear=m;
    }

    // 몸
    exctx.fillStyle="#667948";
    exctx.fillRect(sx,sy,36,36);

    // 변이 반점
    exctx.fillStyle="#9ec45b";
    exctx.fillRect(sx+4,sy+5,8,8);
    exctx.fillRect(sx+22,sy+18,9,9);

    // 눈
    exctx.fillStyle="#f4e36d";
    exctx.fillRect(sx+8,sy+12,5,5);
    exctx.fillRect(sx+23,sy+12,5,5);

    // HP bar
    exctx.fillStyle="#281412";
    exctx.fillRect(sx,sy-9,36,5);
    exctx.fillStyle="#ba4b3f";
    exctx.fillRect(sx,sy-9,36*(m.hp/m.maxHp),5);
  });

  $("mutantWarning").classList.toggle(
    "hidden",
    expeditionLocation==="hospital" || nearestMutantDistance>260
  );

  // 내 캐릭터 중앙
  // 점프 시 위치만 뜨는 것이 아니라 캐릭터가 커졌다가 원래 크기로 돌아오는 모션.
  const jumpRemaining=expeditionJumping
    ? Math.max(0,Math.min(1,(expeditionJumpUntil-performance.now())/520))
    : 0;

  const jumpPhase=expeditionJumping ? 1-jumpRemaining : 0;
  const jumpArc=expeditionJumping ? Math.sin(jumpPhase*Math.PI) : 0;

  // 30px -> 최대 약 40px -> 30px
  const jumpScale=1+jumpArc*.34;
  const charSize=30*jumpScale;

  // 크기 변화에 더해 아주 살짝 위로 떠 보이게 함
  const jumpLift=jumpArc*10;

  // 점프 그림자: 공중에 뜨면 작아지고 흐려짐
  exctx.fillStyle=`rgba(0,0,0,${0.28-jumpArc*.12})`;
  exctx.beginPath();
  exctx.ellipse(
    vw/2,
    vh/2+18,
    15-jumpArc*4,
    6-jumpArc*2,
    0,0,Math.PI*2
  );
  exctx.fill();

  exctx.fillStyle=(me.color==="rainbow"?rainbowColorV30(0):(me.color||"#fff"));
  exctx.fillRect(
    vw/2-charSize/2,
    vh/2-charSize/2-jumpLift,
    charSize,
    charSize
  );

  exctx.strokeStyle="#f5f5f5";
  exctx.lineWidth=2;
  exctx.strokeRect(
    vw/2-charSize/2,
    vh/2-charSize/2-jumpLift,
    charSize,
    charSize
  );

  // 탐사 무기: 벙커와 동일한 방향/쿨타임/베기 시스템
  if(equippedWeapon){
    const cx=vw/2;
    const cy=vh/2;
    const fx=expeditionFacing.x||1;
    const fy=expeditionFacing.y||0;
    const angle=Math.atan2(fy,fx);
    const swinging=performance.now()<expeditionSwingUntil;

    exctx.save();
    exctx.translate(cx,cy);
    exctx.rotate(angle+(swinging?.72:0));

    exctx.strokeStyle="rgba(0,0,0,.4)";
    exctx.lineWidth=11;
    exctx.lineCap="round";
    exctx.beginPath();
    exctx.moveTo(10,3);
    exctx.lineTo(66,3);
    exctx.stroke();

    if(equippedWeapon==="axe"){
      const handle=exctx.createLinearGradient(8,0,68,0);
      handle.addColorStop(0,"#4a2918");
      handle.addColorStop(.5,"#8c5b34");
      handle.addColorStop(1,"#54301c");

      exctx.strokeStyle=handle;
      exctx.lineWidth=7;
      exctx.beginPath();
      exctx.moveTo(10,0);
      exctx.lineTo(67,0);
      exctx.stroke();

      const metal=exctx.createLinearGradient(48,-16,80,16);
      metal.addColorStop(0,"#e1e6e7");
      metal.addColorStop(.45,"#a6afb1");
      metal.addColorStop(1,"#596264");

      exctx.fillStyle=metal;
      exctx.beginPath();
      exctx.moveTo(49,-16);
      exctx.lineTo(73,-12);
      exctx.lineTo(80,0);
      exctx.lineTo(72,14);
      exctx.lineTo(50,10);
      exctx.closePath();
      exctx.fill();

      exctx.strokeStyle="#4d5557";
      exctx.lineWidth=2;
      exctx.stroke();

      // 감지 후 실제 공격 모션. 몸 접촉 자체는 공격 판정이 아님.
      if(performance.now()<hospitalAttackUntil){
        const t=1-Math.max(0,hospitalAttackUntil-performance.now())/550;
        const swing=Math.sin(t*Math.PI);

        exctx.save();
        exctx.translate(sx+18,sy+43);
        exctx.rotate(-0.7+swing*1.4);

        exctx.strokeStyle="#1b1f1c";
        exctx.lineWidth=9;
        exctx.lineCap="round";
        exctx.beginPath();
        exctx.moveTo(0,0);
        exctx.lineTo(52,0);
        exctx.stroke();

        exctx.restore();
      }

    }else{
      const wood=exctx.createLinearGradient(8,0,74,0);
      wood.addColorStop(0,"#452616");
      wood.addColorStop(.3,"#855431");
      wood.addColorStop(.65,"#a36a3c");
      wood.addColorStop(1,"#55301b");

      exctx.strokeStyle=wood;
      exctx.lineWidth=10;
      exctx.beginPath();
      exctx.moveTo(10,0);
      exctx.lineTo(72,0);
      exctx.stroke();

      exctx.strokeStyle="rgba(246,196,133,.32)";
      exctx.lineWidth=2;
      exctx.beginPath();
      exctx.moveTo(19,-2);
      exctx.bezierCurveTo(34,-4,50,2,66,-2);
      exctx.stroke();

      exctx.strokeStyle="rgba(53,25,12,.38)";
      exctx.beginPath();
      exctx.moveTo(27,3);
      exctx.bezierCurveTo(40,5,55,0,69,3);
      exctx.stroke();
    }

    if(swinging){
      const slash=exctx.createLinearGradient(0,-80,86,42);
      slash.addColorStop(0,"rgba(255,255,255,0)");
      slash.addColorStop(.45,"rgba(255,252,224,.96)");
      slash.addColorStop(1,"rgba(255,202,110,0)");

      exctx.strokeStyle=slash;
      exctx.lineWidth=7;
      exctx.beginPath();
      exctx.arc(0,0,83,-.87,.68);
      exctx.stroke();

      exctx.strokeStyle="rgba(255,205,108,.38)";
      exctx.lineWidth=14;
      exctx.beginPath();
      exctx.arc(0,0,71,-.77,.58);
      exctx.stroke();
    }

    exctx.restore();

    const remaining=Math.max(0,weaponCooldownUntil-performance.now());
    if(remaining>0&&currentWeaponCooldown>0){
      const ratio=1-remaining/currentWeaponCooldown;

      exctx.strokeStyle="rgba(0,0,0,.50)";
      exctx.lineWidth=5;
      exctx.beginPath();
      exctx.arc(cx,cy+33,13,0,Math.PI*2);
      exctx.stroke();

      exctx.strokeStyle="rgba(245,247,235,.94)";
      exctx.lineWidth=3;
      exctx.beginPath();
      exctx.arc(cx,cy+33,13,-Math.PI/2,-Math.PI/2+Math.PI*2*ratio);
      exctx.stroke();
    }
  }

  // 탐사 시작/귀환 지점
  {
    const rx=expeditionReturnPoint.x-camX;
    const ry=expeditionReturnPoint.y-camY;

    exctx.strokeStyle="rgba(210,235,185,.9)";
    exctx.lineWidth=3;
    exctx.setLineDash([8,6]);
    exctx.strokeRect(rx-35,ry-35,70,70);
    exctx.setLineDash([]);

    exctx.fillStyle="rgba(218,240,198,.85)";
    exctx.font="bold 11px sans-serif";
    exctx.fillText("BUNKER EXIT",rx-36,ry-43);
  }

  // v28: 시야 밖만 완전 검정.
  // 맵 픽셀 자체는 지우지 않으며, 손전등은 시야 반경만 확대.
  {
    const cx=vw/2;
    const cy=vh/2;

    const radius=expeditionFlashlight
      ? Math.min(vw,vh)*0.58
      : Math.min(vw,vh)*0.34;

    exctx.save();
    exctx.fillStyle="#000";

    if(typeof Path2D!=="undefined"){
      const mask=new Path2D();
      mask.rect(0,0,vw,vh);
      mask.arc(cx,cy,radius,0,Math.PI*2,true);
      exctx.fill(mask,"evenodd");
    }else{
      // fallback: 원 밖을 4개 사각형으로 덮음
      exctx.fillRect(0,0,vw,Math.max(0,cy-radius));
      exctx.fillRect(0,cy+radius,vw,Math.max(0,vh-(cy+radius)));
      exctx.fillRect(0,Math.max(0,cy-radius),Math.max(0,cx-radius),radius*2);
      exctx.fillRect(cx+radius,Math.max(0,cy-radius),Math.max(0,vw-(cx+radius)),radius*2);
    }

    exctx.restore();
  }

  requestAnimationFrame(drawExpedition);
}



function startBunkerJump(){
  if(!bunkerRunning||bunkerJumping)return;

  ioClient.emit("bunker-jump",{
    roomCode:room?.code,
    sessionId,
    nickname:$("nick").value.trim()
  },r=>{
    if(!r?.ok)return;
    bunkerJumping=true;
    bunkerJumpUntil=performance.now()+520;
    $("jumpBadge")?.classList.remove("hidden");
    setTimeout(()=>{
      bunkerJumping=false;
      $("jumpBadge")?.classList.add("hidden");
    },530);
  });
}

function startCurrentJump(){
  if(expeditionRunning)startExpeditionJump();
  else if(bunkerRunning)startBunkerJump();
}

function startExpeditionJump(){
  if(!expeditionRunning || expeditionJumping)return;

  ioClient.emit("expedition-jump",{
    roomCode:room?.code,
    sessionId,
    nickname:$("nick").value.trim()
  },r=>{
    if(!r?.ok)return;

    expeditionJumping=true;
    expeditionJumpUntil=performance.now()+520;
    $("jumpBadge")?.classList.remove("hidden");

    setTimeout(()=>{
      expeditionJumping=false;
      $("jumpBadge")?.classList.add("hidden");
    },530);
  });
}

if($("mJump")){
  $("mJump").onclick=e=>{
    e.stopPropagation();
    startCurrentJump();
  };
}

function expeditionLoop(){
  if(!expeditionRunning)return;

  let dx=(keys.has("d")||keys.has("arrowright")?1:0)-
         (keys.has("a")||keys.has("arrowleft")?1:0);

  let dy=(keys.has("s")||keys.has("arrowdown")?1:0)-
         (keys.has("w")||keys.has("arrowup")?1:0);

  if(Math.abs(joystickX)>.03||Math.abs(joystickY)>.03){
    dx=joystickX;
    dy=joystickY;
  }else if(dx&&dy){
    dx*=.707;
    dy*=.707;
  }

  if(
    Math.abs(dx)+Math.abs(dy)>.05 &&
    performance.now()>=expeditionSwingUntil
  ){
    const len=Math.hypot(dx,dy)||1;
    expeditionFacing.x=dx/len;
    expeditionFacing.y=dy/len;
  }

  const moveSpeed=playerSick?2.5:3.2;
  const nx=expeditionPlayer.x+dx*moveSpeed;
  const ny=expeditionPlayer.y+dy*moveSpeed;

  if(!exBlocked(nx,expeditionPlayer.y))expeditionPlayer.x=nx;
  if(!exBlocked(expeditionPlayer.x,ny))expeditionPlayer.y=ny;

  exFindNear();

  const now=performance.now();
  if(now-expeditionLastSend>70){
    ioClient.emit("expedition-move",{
      x:expeditionPlayer.x,
      y:expeditionPlayer.y,
      facingX:expeditionFacing.x,
      facingY:expeditionFacing.y
    });
    expeditionLastSend=now;
  }

  requestAnimationFrame(expeditionLoop);
}

function takeExpeditionItem(){
  if(expeditionReturnNear){
    returnToBunker();
    return;
  }

  if(!expeditionNear){
    toast("가까운 아이템이 없습니다.");
    return;
  }

  ioClient.emit("take-expedition-item",expeditionNear.id,r=>{
    if(!r?.ok){
      toast(r?.message||"획득 실패");
      return;
    }

    me.hands=[...r.hands];
    renderSlots();
  });
}

function requestExpedition(location=null){
  if((bunkerStock.map||0)>0 && !location){
    $("expeditionLocationPanel").classList.remove("hidden");
    return;
  }

  ioClient.emit("request-expedition",{location},r=>{
    if(!r?.ok){
      toast(r?.message||"탐사 모집 실패");
      return;
    }

    if(r.random){
      toast(
        r.location==="hospital"
          ? "지도가 없어 무작위로 병원 탐사가 선택되었습니다."
          : "지도가 없어 무작위로 식료품점 탐사가 선택되었습니다."
      );
    }
  });
}

$("expeditionLocationClose").onclick=()=>
  $("expeditionLocationPanel").classList.add("hidden");

$("chooseGrocery").onclick=()=>{
  $("expeditionLocationPanel").classList.add("hidden");
  requestExpedition("grocery");
};

$("chooseHospital").onclick=()=>{
  $("expeditionLocationPanel").classList.add("hidden");
  requestExpedition("hospital");
};
function beginExpeditionFromServer(data){
  const participants=data.participantIds||[];

  if(!participants.includes(myId)){
    $("expeditionInvitePanel").classList.add("hidden");
    return;
  }

  bunkerRunning=false;
  $("bunkerUI").classList.add("hidden");
  $("bookButton").classList.add("hidden");
  $("messageButton").classList.add("hidden");
  $("statusPanel").classList.add("hidden");
  $("expeditionInvitePanel").classList.add("hidden");

  expeditionLocation=data.location||"grocery";
  expeditionItems=data.items||[];
  expeditionReturnPoint=data.returnPoint||(
    expeditionLocation==="hospital"
      ? {x:1897.5,y:2572.5}
      : {x:250,y:850}
  );
  expeditionHandLimit=data.handLimit||4;
  playerSick=!data.hasGasMask;
  expeditionFlashlight=!!data.hasFlashlight;

  expeditionMutants={};
  (data.mutants||[]).forEach(m=>expeditionMutants[m.id]={...m});

  hospitalAbomination=data.hospitalAbomination
    ? {...data.hospitalAbomination}
    : null;
  hospitalGlass=data.hospitalGlass||[];
  hospitalTripwires=data.hospitalTripwires||[];

  expeditionPlayer={
    x:expeditionReturnPoint.x,
    y:expeditionReturnPoint.y
  };
  expeditionFacing={x:1,y:0};
  expeditionOthers={};
  expeditionRunning=true;
  me.hands=[];

  $("expeditionUI").classList.toggle(
    "hospital-mode",
    expeditionLocation==="hospital"
  );

  $("expeditionTitle").textContent=
    expeditionLocation==="hospital"
      ? "🏥 병원 탐사"
      : "🛒 식료품점 탐사";

  $("sickBadge").classList.toggle("hidden",!playerSick);

  updateMobileActionVisibility("expedition");
  $("expeditionUI").classList.remove("hidden");
  $("expeditionDay").textContent=`DAY ${day}`;

  if(equippedWeapon){
    $("swingButton").classList.remove("hidden");
  }

  resizeExpeditionCanvas();
  renderSlots();
  applyMobileControlsVisibility();
  drawExpedition();
  expeditionLoop();
}
function returnToBunker(){
  ioClient.emit("return-from-expedition",{
    roomCode:room?.code,
    sessionId,
    nickname:$("nick").value.trim()
  },r=>{
    if(!r?.ok){
      toast(r?.message||"귀환 실패");
      return;
    }

    expeditionRunning=false;
    $("mutantWarning").classList.add("hidden");
    $("sickBadge").classList.add("hidden");
    hospitalAbomination=null;
    hospitalGlass=[];
    hospitalTripwires=[];
    expeditionMutants={};
    $("expeditionUI").classList.add("hidden");

    bunkerStock=r.bunkerStock||bunkerStock;
    weapons=r.weapons||weapons;

    if(r.stats){
      hp=r.stats.hp??hp;
      hunger=r.stats.hunger??hunger;
      thirst=r.stats.thirst??thirst;
      hygiene=r.stats.hygiene??hygiene;
    }

    bunkerPlayer.x=r.player?.x??330;
    bunkerPlayer.y=r.player?.y??560;

    // DAY는 탐사 귀환 때문에 바꾸지 않음
    expeditionOthers={};
    expeditionMutants={};
    updateStatusUI();
    enterBunkerScene();
  });
}

function swingWeapon(){
  if(!equippedWeapon){
    toast("장착한 무기가 없습니다.");
    return;
  }

  const now=performance.now();
  if(now<weaponCooldownUntil)return;

  const cooldown=
    equippedWeapon==="axe" ? 1100 :
    equippedWeapon==="woodenStick" ? 700 :
    800;

  currentWeaponCooldown=cooldown;
  weaponCooldownUntil=now+cooldown;

  if(bunkerRunning){
    bunkerSwingUntil=now+320;

    ioClient.emit("swing-weapon",{
      roomCode:room?.code,
      sessionId,
      nickname:$("nick").value.trim(),
      facingX:bunkerFacing.x,
      facingY:bunkerFacing.y
    },r=>{
      if(r?.cooldown){
        weaponCooldownUntil=performance.now()+(r.remaining||0);
      }else if(r&&!r.ok&&r.message){
        toast(r.message);
      }
    });
    return;
  }

  if(expeditionRunning){
    expeditionSwingUntil=now+320;
    swingUntil=now+320;

    if(!mutantNear||!mutantNear.alive)return;

    const dx=(mutantNear.x+18)-(expeditionPlayer.x+15);
    const dy=(mutantNear.y+18)-(expeditionPlayer.y+15);
    const dist=Math.hypot(dx,dy);

    if(dist>125)return;

    const dot=
      (dx/(dist||1))*expeditionFacing.x+
      (dy/(dist||1))*expeditionFacing.y;

    if(dot<-0.18)return;

    ioClient.emit("attack-mutant",{
      mutantId:mutantNear.id,
      facingX:expeditionFacing.x,
      facingY:expeditionFacing.y
    },r=>{
      if(r?.cooldown){
        weaponCooldownUntil=performance.now()+(r.remaining||0);
        return;
      }

      if(!r?.ok){
        if(r?.message)toast(r.message);
        return;
      }

      if(r.cooldown)currentWeaponCooldown=r.cooldown;
      if(r.killed)toast("돌연변이를 처치했습니다.");
    });
  }
}


$("expeditionPrompt").onclick=takeExpeditionItem;



addEventListener("keydown",e=>{
  if(!expeditionRunning)return;

  if(e.key.toLowerCase()==="e"){
    takeExpeditionItem();
  }

  if(e.code==="Space"){
    e.preventDefault();
    swingWeapon();
  }
});


function updateExpeditionInviteCountdown(){
  clearInterval(expeditionInviteTimerHandle);

  const render=()=>{
    const left=Math.max(0,Math.ceil((expeditionInviteEndsAt-Date.now())/1000));
    $("expeditionInviteTimer").textContent=left;

    if(left<=0){
      clearInterval(expeditionInviteTimerHandle);
    }
  };

  render();
  expeditionInviteTimerHandle=setInterval(render,250);
}

ioClient.on("expedition-invite",d=>{
  expeditionInviteEndsAt=d.endsAt;

  $("expeditionInviteText").textContent=
    d.leaderId===myId
      ? "팀원의 참여를 기다리는 중..."
      : `${d.leaderName}님이 ${d.location==="hospital"?"병원":"식료품점"} 탐사를 준비합니다.`;

  $("expeditionInvitePanel").classList.remove("hidden");
  updateExpeditionInviteCountdown();
});

$("expeditionAccept").onclick=()=>{
  ioClient.emit("respond-expedition",true,r=>{
    if(!r?.ok)toast(r?.message||"참여 실패");
    else toast("탐사 참여");
  });
};

$("expeditionDecline").onclick=()=>{
  ioClient.emit("respond-expedition",false,r=>{
    if(!r?.ok){
      toast(r?.message||"거절 실패");
    }else{
      toast("탐사 거절");
      $("expeditionInvitePanel").classList.add("hidden");
    }
  });
};

ioClient.on("expedition-started",beginExpeditionFromServer);

ioClient.on("expedition-item-taken",d=>{
  const item=expeditionItems.find(i=>i.id===d.itemId);
  if(item)item.taken=true;

  if(d.playerId===myId){
    me.hands=[...d.hands];
    renderSlots();
  }
});

ioClient.on("expedition-player-entered",p=>{
  expeditionOthers[p.id]=p;
});

ioClient.on("expedition-player-moved",p=>{
  expeditionOthers[p.id]={...(expeditionOthers[p.id]||{}),...p};
});

ioClient.on("expedition-player-jumped",d=>{
  if(d.id===myId){
    expeditionJumping=true;
    expeditionJumpUntil=performance.now()+520;
  }else if(expeditionOthers[d.id]){
    expeditionOthers[d.id].jumping=true;
    expeditionOthers[d.id].jumpUntil=performance.now()+520;
  }
});

ioClient.on("expedition-player-landed",d=>{
  if(d.id===myId){
    expeditionJumping=false;
  }else if(expeditionOthers[d.id]){
    expeditionOthers[d.id].jumping=false;
  }
});


ioClient.on("expedition-player-left",d=>{
  delete expeditionOthers[d.id];
});

ioClient.on("player-equipped",d=>{
  if(d.id===myId){
    equippedWeapon=d.weapon;
  }
});

ioClient.on("weapon-swung",d=>{
  if(d.id===myId){
    swingUntil=performance.now()+260;
  }
});




ioClient.on("hospital-abomination-attack",d=>{
  hospitalAttackUntil=performance.now()+550;
  hospitalAttackTargetId=d.targetId||null;
});

ioClient.on("hospital-abomination-moved",d=>{
  if(!hospitalAbomination)return;
  hospitalAbomination={
    ...hospitalAbomination,
    x:d.x,
    y:d.y,
    alerted:d.alerted
  };
});

ioClient.on("mutant-moved",m=>{
  expeditionMutants[m.id]={
    ...(expeditionMutants[m.id]||{}),
    ...m,
    maxHp:expeditionMutants[m.id]?.maxHp||70
  };
});

ioClient.on("mutant-hit",d=>{
  const m=expeditionMutants[d.id];
  if(!m)return;

  m.hp=d.hp;
  m.maxHp=d.maxHp;
  m.alive=d.alive;

  if(!d.alive){
    setTimeout(()=>{
      delete expeditionMutants[d.id];
    },500);
  }
});

ioClient.on("explorer-damaged",d=>{
  if(d.playerId!==myId)return;

  hp=d.hp;
  updateStatusUI();

  if(d.reason==="sickness"){
    playerSick=true;
    $("sickBadge").classList.remove("hidden");
    toast(`방사능 sickness -${d.damage} HP`);
  }else if(d.reason==="hospitalAbomination"){
    toast("Hospital Abomination에게 붙잡혔습니다.");
  }else{
    toast(`돌연변이 공격 -${d.damage} HP`);
  }

  if(hp<=0){
    expeditionRunning=false;

    $("expeditionUI").innerHTML=`
      <div style="
        position:fixed;
        inset:0;
        display:grid;
        place-items:center;
        background:#000;
        color:#d95146;
        z-index:9999;
        text-align:center">
        <div>
          <h1 style="font-size:52px;margin:0">YOU DIED</h1>
          <p style="color:#ddd">돌연변이에게 당했습니다.</p>
        </div>
      </div>
    `;
  }
});

ioClient.on("day-changed",d=>{
  day=d.day;
  dayStartedAt=d.dayStartedAt;
  dayLengthMs=d.dayLengthMs||dayLengthMs;

  const mine=d.players.find(p=>p.id===myId);
  if(mine){
    hp=mine.hp??hp;
    hunger=mine.hunger??hunger;
    thirst=mine.thirst??thirst;
    hygiene=mine.hygiene??hygiene;
    fatigue=mine.fatigue??fatigue;
    sanityStat=mine.sanityStat??sanityStat;
  }

  updateStatusUI();

  if($("expeditionDay")){
    $("expeditionDay").textContent=`DAY ${day}`;
  }

  toast(`DAY ${day}`);
});


ioClient.on("vent-state",d=>{
  (d.vents||[]).forEach(v=>{
    ventStates[v.id]={...v};
  });

  if(selectedVentId && !$("ventPanel").classList.contains("hidden")){
    refreshVentPanel();
  }
});

ioClient.on("vent-threat",d=>{
  ventStates[d.ventId]={
    ...(ventStates[d.ventId]||{}),
    threat:d.threat,
    stage:d.stage
  };

  // 벙커 맵에서는 종류를 공개하지 않음.
  // 이미 해당 환풍구를 보고 있을 때만 거리 상태가 갱신됨.
  if(selectedVentId===d.ventId && ventRenderRunning){
    refreshVentPanel();
  }
});

ioClient.on("vent-lady-attack",d=>{
  bunkerStock=d.bunkerStock||bunkerStock;

  if(d.victimId===myId){
    hp=Math.max(0,hp-d.damage);
    toast(`Vent Lady 공격! HP -${d.damage}, 자원을 빼앗겼습니다.`);
  }else{
    toast("Vent Lady가 벙커 자원을 훔쳤습니다.");
  }

  updateStatusUI();
});

ioClient.on("bunker-mobs",list=>{
  bunkerMobs={};
  (list||[]).forEach(m=>bunkerMobs[m.id]={...m});
});

ioClient.on("bunker-mob-moved",m=>{
  bunkerMobs[m.id]={...(bunkerMobs[m.id]||{}),...m};
});

ioClient.on("bunker-mob-hit",d=>{
  const m=bunkerMobs[d.id];
  if(!m)return;

  m.hp=d.hp;
  m.maxHp=d.maxHp;
  m.alive=d.alive;

  if(!d.alive){
    toast("벙커의 적을 처치했습니다.");
    setTimeout(()=>delete bunkerMobs[d.id],350);
  }
});

ioClient.on("bunker-player-damaged",d=>{
  if(d.id!==myId)return;
  hp=d.hp;
  updateStatusUI();
  toast(`${d.reason} · HP -${d.damage}`);
});

ioClient.on("personal-stats",d=>{
  hp=d.hp??hp;
  hunger=d.hunger??hunger;
  thirst=d.thirst??thirst;
  hygiene=d.hygiene??hygiene;
  fatigue=d.fatigue??fatigue;
  sanityStat=d.sanityStat??sanityStat;
  updateStatusUI();
});

ioClient.on("hallucination-spawn",d=>{
  if(!bunkerRunning)return;

  hallucination={
    active:true,
    x:(visualViewport?.width||innerWidth)*0.15,
    y:(visualViewport?.height||innerHeight)*0.35,
    start:performance.now(),
    duration:4200,
    damage:d.damage||10
  };

  // 검은 형체가 쫓아오는 연출 후 점프스케어
  const start=performance.now();

  const chase=()=>{
    if(!hallucination.active)return;

    const elapsed=performance.now()-start;

    if(elapsed>=hallucination.duration){
      hallucination.active=false;
      $("hallucinationOverlay").classList.remove("hidden");

      setTimeout(()=>{
        $("hallucinationOverlay").classList.add("hidden");
      },650);

      return;
    }

    requestAnimationFrame(chase);
  };

  chase();
});

ioClient.on("weapon-swung",d=>{
  if(d.id===myId){
    bunkerSwingUntil=performance.now()+260;
    if(Number.isFinite(d.facingX)&&Number.isFinite(d.facingY)){
      bunkerFacing={x:d.facingX,y:d.facingY};
    }
  }else if(bunkerOthers[d.id]){
    bunkerOthers[d.id].facingX=d.facingX;
    bunkerOthers[d.id].facingY=d.facingY;
    bunkerOthers[d.id].equipped=d.weapon;
  }
});

ioClient.on("scavenge-result",d=>{
  day=d.day||day;
  sanity=d.sanity??sanity;
  bounty=d.bounty??bounty;
  bountyLevel=d.bountyLevel??bountyLevel;
  bunkerStock=d.bunkerStock||bunkerStock;
  weapons=d.weapons||weapons;
  power=d.power??power;
  securityState=d.security||securityState;
  updateStatusUI();

  $("fadeOverlay").style.opacity="1";
  $("fadeOverlay").classList.remove("hidden");

  if(!d.alive){
    hp=0;
    updateStatusUI();
    setTimeout(()=>{
      document.body.innerHTML=`
        <div style="
          position:fixed;inset:0;background:#000;color:#d94b42;
          display:grid;place-items:center;text-align:center;
          font-family:Arial,sans-serif">
          <div>
            <div style="font-size:64px;font-weight:900">YOU DIED</div>
            <p style="color:#ddd">시간 안에 벙커에 들어가지 못했습니다.</p>
          </div>
        </div>`;
    },700);
    return;
  }

  setTimeout(enterBunkerScene,650);
});

ioClient.on("bunker-state",d=>{
  day=d.day||day;
  sanity=d.sanity??sanity;
  bounty=d.bounty??bounty;
  bountyLevel=d.bountyLevel??bountyLevel;
  bunkerStock=d.bunkerStock||bunkerStock;
  weapons=d.weapons||weapons;
  power=d.power??power;
  securityState=d.security||securityState;

  if(d.stats){
    hp=d.stats.hp??hp;
    hunger=d.stats.hunger??hunger;
    thirst=d.stats.thirst??thirst;
  }

  updateStatusUI();
});

function applyMobileControlsVisibility(){
  const touchDevice=
    navigator.maxTouchPoints>0 ||
    "ontouchstart" in window ||
    matchMedia("(pointer: coarse)").matches;

  const mobile=document.querySelector(".mobile");
  if(!mobile)return;

  if(touchDevice){
    mobile.style.setProperty("display","block","important");
    mobile.style.setProperty("z-index","140","important");
  }
}

applyMobileControlsVisibility();
addEventListener("resize",applyMobileControlsVisibility);
if(window.visualViewport){
  window.visualViewport.addEventListener("resize",applyMobileControlsVisibility);
}

ioClient.on("game-started",d=>{show("game");
$("partyRoomOverlay")?.classList.add("hidden");
updateMobileActionVisibility("scavenge");
$("bookButton").classList.add("hidden");
$("messageButton").classList.add("hidden");
$("statusPanel").classList.add("hidden");
$("messagePanel").classList.add("hidden");
build();players={};d.players.forEach(p=>players[p.id]={...p});me={...players[myId],hands:[],stored:[]};floor=1;bunker=d.bunker;defs=d.itemDefs;items=d.items;ends=d.endsAt;
day=d.day||1;
dayStartedAt=d.dayStartedAt||Date.now();
dayLengthMs=d.dayLengthMs||120000;
sanity=d.sanity||0;
bounty=d.bounty||0;
bountyLevel=d.bountyLevel||1;
bunkerStock=d.bunkerStock||{};
weapons=d.weapons||{};
power=d.power??100;
securityState=d.security||"LOCKED";

const mine=d.players.find(p=>p.id===myId);
if(mine){
  hp=mine.hp??100;
  hunger=mine.hunger??100;
  thirst=mine.thirst??100;
  hygiene=mine.hygiene??100;
  fatigue=mine.fatigue??0;
  sanityStat=mine.sanityStat??100;
  equippedWeapon=mine.equipped||null;
}
updateStatusUI();$("timer").textContent="60";renderSlots();running=true;last=performance.now();requestAnimationFrame(loop)});
ioClient.on("player-moved",d=>{if(players[d.id])Object.assign(players[d.id],d)});ioClient.on("item-taken",d=>{let i=items.find(x=>x.id===d.itemId);if(i)i.taken=true;if(d.playerId===myId){me.hands=d.hands;renderSlots()}});ioClient.on("items-deposited",d=>{if(d.playerId===myId){me.hands=d.hands;me.stored=d.stored;renderSlots()}});

$("globalFullscreen").onclick=async()=>{
  const btn=$("globalFullscreen");
  try{
    if(document.fullscreenElement){
      if(document.exitFullscreen)await document.exitFullscreen();
      btn.textContent="⛶";
      return;
    }
    const el=document.documentElement;
    const request=el.requestFullscreen||el.webkitRequestFullscreen;
    if(request){
      await request.call(el);
      btn.textContent="×";
      return;
    }
    // iPhone Safari fallback: browser fullscreen API가 없으면 최대 화면 모드
    document.body.classList.toggle("pseudo-fullscreen");
    window.scrollTo(0,1);
    btn.textContent=document.body.classList.contains("pseudo-fullscreen")?"×":"⛶";
  }catch(e){
    document.body.classList.toggle("pseudo-fullscreen");
    window.scrollTo(0,1);
  }
};

document.addEventListener("fullscreenchange",()=>{
  const b=$("globalFullscreen");
  if(b)b.textContent=document.fullscreenElement?"×":"⛶";
});




const v21KeyboardControls=true;
addEventListener("keydown",e=>{
  if(e.repeat)return;

  if((expeditionRunning||bunkerRunning)&&e.code==="Space"){
    e.preventDefault();
    startCurrentJump();
    return;
  }

  if(expeditionRunning&&e.key.toLowerCase()==="e"){
    e.preventDefault();
    takeExpeditionItem();
    return;
  }

  if(bunkerRunning&&e.key.toLowerCase()==="e"){
    e.preventDefault();
    interactBunker();
    return;
  }
});


function isUiTarget(target){
  return !!target.closest(
    "button,input,textarea,select,.message-panel,.public-chat-panel,"+
    ".status-panel,.weapon-panel,.vent-inspection,.lobby-popup,"+
    ".expedition-location-panel,.expedition-invite-panel,.joystick-base,.hands"
  );
}


function aimAtScreenPointV28(clientX,clientY){
  const vw=visualViewport?.width||innerWidth;
  const vh=visualViewport?.height||innerHeight;
  const dx=clientX-vw/2;
  const dy=clientY-vh/2;
  const len=Math.hypot(dx,dy);

  if(len<5)return;

  const facing={x:dx/len,y:dy/len};

  if(bunkerRunning){
    bunkerFacing={...facing};
  }

  if(expeditionRunning){
    expeditionFacing={...facing};
  }
}

function combatScreenPointer(e){
  if(isUiTarget(e.target))return;
  if(!(bunkerRunning||expeditionRunning))return;
  if(!equippedWeapon)return;

  const vw=visualViewport?.width||innerWidth;

  if(e.pointerType==="touch"){
    if(e.clientX<vw*.42)return;
  }

  // 이동 방향이 아니라 실제 터치/클릭 위치를 향해 조준
  aimAtScreenPointV28(e.clientX,e.clientY);
  swingWeapon();
}

$("bunkerCanvas").addEventListener("pointerdown",combatScreenPointer);
$("expeditionCanvas").addEventListener("pointerdown",combatScreenPointer);


ioClient.on("connect_error",err=>{
  console.error("Socket connection error:",err);
  toast("서버 연결 오류");
});


if($("v30ClaimButton")){
  $("v30ClaimButton").onclick=claimV30Reward;
}
renderPersistentSanityV30();
renderRainbowOptionV30();
renderV30ClaimButton();
