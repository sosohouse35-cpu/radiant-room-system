"use strict";
const ioClient=io({
  // Socket.IO 기본 순서(polling -> websocket)를 사용.
  // 첫 transport가 실패하면 다른 transport도 자동 시도한다.
  tryAllTransports:true,
  upgrade:true,
  rememberUpgrade:false,
  reconnection:true,
  reconnectionAttempts:Infinity,
  reconnectionDelay:800,
  reconnectionDelayMax:5000,
  timeout:20000
}),$=id=>document.getElementById(id);

// DOM canvas references must exist before socket callbacks can fire.
const publicLobbyCanvas=$("publicLobbyCanvas");
const plctx=publicLobbyCanvas?.getContext("2d")||null;
const canvas=$("canvas");
const ctx=canvas?.getContext("2d")||null;


var accountToken=localStorage.getItem("afterglowAccountToken")||"";
var accountResumePending=!!accountToken;
var currentAccount=null;
var adminGodMode=false;
var adminFullBright=false;
var persistentSanityPoints=0;
var rainbowUnlockedV30=false;
var v30GiftClaimed=false;
var v30RainbowPhase=0;

function verifySocketLogin(callback=()=>{}){
  if(!accountToken){
    callback(false);
    return;
  }

  ioClient.emit("auth-status",{token:accountToken},r=>{
    if(r?.ok){
      if(r.account)applyAccount(r.account);
      callback(true);
    }else{
      callback(false);
    }
  });
}

function applyAccount(a){
  if(!a)return;

  currentAccount=a;
  persistentSanityPoints=Number(a.sanityPoints||0);
  sanity=persistentSanityPoints;
  rainbowUnlockedV30=!!a.rainbowUnlocked;
  v30GiftClaimed=!!a.v30Claimed;
  adminGodMode=!!a.adminGodMode;
  adminFullBright=!!a.adminFullBright;

  if($("nick")){
    $("nick").value=a.displayName||"";
    $("nick").readOnly=true;
  }

  if($("accountNameLabel"))$("accountNameLabel").textContent=a.displayName||"";
  if($("accountIdLabel"))$("accountIdLabel").textContent=a.accountId||"";

  renderPersistentSanityV30();
  renderRainbowOptionV30();
  renderV30ClaimButton();
  updateAccountUI();
  renderAdminSettings();
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

      btn.onclick=()=>{
        selectedColor="rainbow";
        localStorage.setItem("afterglow-color","rainbow");
        host.querySelectorAll("[data-color]").forEach(b=>
          b.classList.toggle("selected",b===btn)
        );
      };

      host.appendChild(btn);
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
  const phase=Math.floor(performance.now()/75);
  return palette[(phase+index)%16];
}

function rainbowIndexFromPlayerV30(p,fallback=0){
  if(!p)return fallback;
  const text=String(p.id||p.nickname||"");
  let hash=0;
  for(let i=0;i<text.length;i++){
    hash=((hash<<5)-hash+text.charCodeAt(i))|0;
  }
  return Math.abs(hash)%16;
}

function animatedPlayerColorV30(color,player=null,index=0){
  if(color!=="rainbow")return color||"#ffffff";
  return rainbowColorV30((rainbowIndexFromPlayerV30(player,index)+index)%16);
}

function updateAccountUI(){
  // 로그인/회원가입 화면을 가리는 게임 전용 오버레이를 항상 정리
  if(!currentAccount){
    $("generatorPanel")?.classList.add("hidden");
    $("firewallPanel")?.classList.add("hidden");
    $("sleepOverlay")?.classList.add("hidden");
    $("v32SystemHud")?.classList.add("hidden");
  }

  const auth=$("authScreen");
  const home=$("loggedInHome");

  if(currentAccount){
    auth?.classList.add("hidden");
    home?.classList.remove("hidden");
  }else{
    auth?.classList.remove("hidden");
    home?.classList.add("hidden");
  }
}

function showAuthMode(mode){
  const loginMode=mode==="login";
  $("loginFields")?.classList.toggle("hidden",!loginMode);
  $("registerFields")?.classList.toggle("hidden",loginMode);
  $("authLoginTab")?.classList.toggle("selected",loginMode);
  $("authRegisterTab")?.classList.toggle("selected",!loginMode);
}

function doRegister(){
  const accountId=$("registerAccountId")?.value.trim();
  const password=$("registerPassword")?.value||"";
  const displayName=$("registerName")?.value.trim();

  ioClient.emit("register-account",{accountId,password,displayName},r=>{
    if(!r?.ok)return toast(r?.message||"회원가입 실패");

    accountToken=r.token;
    accountResumePending=false;
    localStorage.setItem("afterglowAccountToken",accountToken);
    applyAccount(r.account);
    toast("회원가입 완료");
  });
}

function doLogin(){
  const accountId=$("loginAccountId")?.value.trim();
  const password=$("loginPassword")?.value||"";

  ioClient.emit("login-account",{accountId,password},r=>{
    if(!r?.ok)return toast(r?.message||"로그인 실패");

    accountToken=r.token;
    accountResumePending=false;
    localStorage.setItem("afterglowAccountToken",accountToken);
    applyAccount(r.account);
    toast("로그인 완료");
  });
}

function doLogout(){
  const oldToken=accountToken;

  accountToken="";
  currentAccount=null;
  localStorage.removeItem("afterglowAccountToken");

  if(oldToken){
    ioClient.emit("logout-account",{token:oldToken},()=>{});
  }

  updateAccountUI();
  renderAdminSettings();
  show("home");
}

function changeAccountName(){
  if(!currentAccount)return;

  const next=prompt(
    `새 이름을 입력하세요.\n비용: ${Number(currentAccount.nameChangeCost||1000).toLocaleString()} SP`,
    currentAccount.displayName||""
  );

  if(next===null)return;

  ioClient.emit("change-display-name",{token:accountToken,displayName:next},r=>{
    if(!r?.ok)return toast(r?.message||"이름 변경 실패");
    applyAccount(r.account);
    toast("이름 변경 완료 · 1,000 SP 사용");
  });
}

function renderV30ClaimButton(){
  const btn=$("v30ClaimButton");
  const text=$("v30ClaimText");
  if(!btn)return;

  if(!currentAccount){
    btn.disabled=true;
    btn.textContent="로그인 후 받을 수 있습니다";
    return;
  }

  if(v30GiftClaimed){
    btn.disabled=true;
    btn.classList.add("claimed");
    btn.textContent="✓ VERSION 30 보상 수령 완료";
    if(text)text.textContent="계정당 1회 보상을 이미 받았습니다.";
  }else{
    btn.disabled=false;
    btn.classList.remove("claimed");
    btn.textContent="🎁 VERSION 30 보상 받기";
    if(text)text.textContent="계정당 1회 · 100,000 SP + 무지개 캐릭터";
  }
}

function claimV30Reward(){
  if(!currentAccount)return toast("로그인하세요.");
  if(v30GiftClaimed)return toast("이미 VERSION 30 보상을 받았습니다.");

  ioClient.emit("claim-v30-event-account",{token:accountToken},r=>{
    if(r?.account)applyAccount(r.account);

    if(r?.ok){
      selectedColor="rainbow";
      localStorage.setItem("afterglow-color","rainbow");
      renderRainbowOptionV30();
      toast("🎉 100,000 SP + 무지개 캐릭터 획득!");
    }else{
      toast(r?.message||"보상을 받을 수 없습니다.");
    }
  });
}


function renderAdminSettings(){
  const button=$("adminSettingsButton");
  const panel=$("adminSettingsPanel");

  const isAdmin=!!currentAccount?.isAdmin;

  if(button){
    button.classList.toggle("hidden",!isAdmin);
  }

  if(!isAdmin && panel){
    panel.classList.add("hidden");
  }

  if($("adminGodMode")){
    $("adminGodMode").checked=!!adminGodMode;
  }

  if($("adminFullBright")){
    $("adminFullBright").checked=!!adminFullBright;
  }
}

function saveAdminSettings(){
  if(!currentAccount?.isAdmin)return;

  ioClient.emit("set-admin-settings",{
    token:accountToken,
    godMode:!!$("adminGodMode")?.checked,
    fullBright:!!$("adminFullBright")?.checked
  },r=>{
    if(!r?.ok)return toast(r?.message||"설정 저장 실패");

    applyAccount(r.account);
    toast("관리자 설정 저장");
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
    renderAdminSettings();
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
  if(button.dataset.color!=="rainbow"){
    button.style.background=button.dataset.color;
  }
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
  if(accountResumePending){
    toast("로그인 정보를 확인 중입니다.");
    return false;
  }

  if(!currentAccount || !accountToken){
    toast("먼저 로그인하세요.");
    return false;
  }

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
    nickname:currentAccount?.displayName||"",
    color:selectedColor,
    token:accountToken
  },r=>{
    if(!r?.ok)return toast(r?.message||"로비 입장 실패");

    myId=r.myId;
    if(r.account)applyAccount(r.account);
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
    btn.onclick=()=>ioClient.emit("join-room",{nickname:currentAccount?.displayName||"",token:accountToken,code:p.code,color:selectedColor,sessionId,publicLobbyId:currentPublicLobby},joined);
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

  verifySocketLogin(ok=>{
    if(!ok){
      toast("로그인 연결을 복구하지 못했습니다. 다시 로그인하세요.");
      return;
    }

    ioClient.emit("create-room",{nickname:currentAccount?.displayName||"",token:accountToken,roomName:title,maxPlayers:$("partyMax").value,private:$("partyPrivate").checked,color:selectedColor,sessionId,publicLobbyId:currentPublicLobby},r=>{if(!r?.ok)return toast(r?.message||"파티 생성 실패");$("createPartyPanel").classList.add("hidden");joined(r);});
  });
};

function joined(r){
  if(!r?.ok)return toast(r?.message||"입장 실패");

  room=r.room;
  myId=r.myId;
  if(r.account)applyAccount(r.account);

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
  accountResumePending=!!accountToken;

  if(accountToken){
    ioClient.emit("resume-account",{token:accountToken},r=>{
      accountResumePending=false;

      if(r?.ok){
        applyAccount(r.account);
      }else{
        accountToken="";
        currentAccount=null;
        localStorage.removeItem("afterglowAccountToken");
        updateAccountUI();
        renderAdminSettings();
        toast("저장된 로그인이 만료되었습니다. 다시 로그인하세요.");
      }
    });
  }else{
    accountResumePending=false;
    updateAccountUI();
    renderAdminSettings();
  }

  if($("status"))$("status").textContent="온라인";
});


// V37.2.4: 방에 입장한 뒤 Socket.IO가 재연결되면
// 수집/벙커/탐사 어느 장면이든 즉시 room mapping을 복구한다.
ioClient.on("connect",()=>{
  if(!room?.code)return;

  setTimeout(()=>{
    ioClient.emit("reconnect-room",roomIdentityPayloadV3723(),r=>{
      if(!r?.ok)return;

      room=r.room||room;
      myId=r.myId||myId;

      if(r.player){
        if(Number.isFinite(r.player.bunkerX))bunkerPlayer.x=r.player.bunkerX;
        if(Number.isFinite(r.player.bunkerY))bunkerPlayer.y=r.player.bunkerY;
        if(Number.isFinite(r.player.expeditionX))expeditionPlayer.x=r.player.expeditionX;
        if(Number.isFinite(r.player.expeditionY))expeditionPlayer.y=r.player.expeditionY;
      }

      // 벙커 화면이면 CCTV/Radio 상태까지 즉시 다시 가져온다.
      if(bunkerRunning){
        recoverBunkerConnectionV3723(ok=>{
          if(ok){
            refreshOutsideCCTVV37();
            refreshRadioStateV372();
          }
        });
      }
    });
  },350);
});

const W=2400,H=1600,T=40,P=30,SPEED=235,COLS=W/T,ROWS=H/T;
const ICON={beans:"🥫",water:"💧",soap:"🧼",tape:"🩹",trap:"🪤",spray:"🧴",medkit:"💊",battery:"🔋",flashlight:"🔦",mask:"😷",axe:"🪓",backpack:"🎒",blueprint:"📘",toolbox:"🧰",map:"🗺️",radio:"📻"};
const ITEM_NAME={beans:"통조림",water:"물",soap:"비누",tape:"테이프",trap:"덫",spray:"살충제",medkit:"메디킷",battery:"배터리",flashlight:"손전등",mask:"방독면",axe:"도끼",backpack:"가방",blueprint:"블루프린트",toolbox:"공구함",map:"지도",radio:"라디오"};
let grids={},furn={},players={},items=[],me={},floor=1,bunker,defs={},keys=new Set(),near=null,ends=0,running=false,last=0,lastSend=0;
var day=1,sanity=0,bounty=0,bountyLevel=1,bunkerStock={},weapons={},power=100,securityState="LOCKED";
var firewall=6,hacked=false,blackout=false,v32Sleeping=false,v32SleepEndsAt=0;
var doorDefense=100; var doorBreached=false; var cctvOutsideThreats=[];
var cctvSignalV3718="online";
var v3715DoorHitUntil=0; var v3715LastDoorDamage=0;
var v3716BreachUntil=0;
var radioStateV372={
  currentEvent:null,
  pendingSignal:null,
  pendingStart:null,
  interference:false,
  history:[],
  unlocks:{},
  completed:{},
  homeless:null,
  gameShow:null,
  alienRoute:false,
  hasRadio:false,
  currentDay:1
};
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
var lastBunkerNetStateV3730={x:null,y:null,fx:null,fy:null,lastHeartbeat:0};
var bunkerKeys=new Set();
var bunkerRunning=false;
updateV32HudVisibility();
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

    plctx.fillStyle=animatedPlayerColorV30(p.color,p);
    plctx.fillRect(p.x-camX,p.y-camY,30,30);

    plctx.fillStyle="#fff";
    plctx.font="11px sans-serif";
    plctx.fillText(p.nickname,p.x-camX-4,p.y-camY-7);
  });

  plctx.fillStyle=animatedPlayerColorV30(selectedColor,publicLobbyPlayers[myId]||{id:myId});
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

let woodFloorPatternV3729=null;
let woodFloorPatternSourceV3729=null;

function getWoodFloorPatternV3729(){
  const tile=USER_IMAGES.woodFloorSquare;
  if(!tile || !tile.complete || !tile.naturalWidth || !tile.naturalHeight)return null;

  // 이미지가 바뀐 경우에만 패턴을 다시 만든다.
  if(woodFloorPatternV3729 && woodFloorPatternSourceV3729===tile)return woodFloorPatternV3729;

  // 정사각형 원본을 정사각형 96x96으로 축소.
  // 가로세로 비율은 1:1 -> 1:1이므로 이미지 비율은 변하지 않는다.
  const size=96;
  const off=document.createElement("canvas");
  off.width=size;
  off.height=size;
  const oc=off.getContext("2d");
  oc.imageSmoothingEnabled=true;
  oc.drawImage(tile,0,0,size,size);

  woodFloorPatternV3729=ctx.createPattern(off,"repeat");
  woodFloorPatternSourceV3729=tile;
  return woodFloorPatternV3729;
}

function wood(camX,camY,w,h){
  const pattern=getWoodFloorPatternV3729();

  if(pattern){
    ctx.save();

    // 패턴을 "화면"이 아니라 "월드" 좌표에 고정한다.
    // 카메라 이동 시 개별 타일을 매 프레임 반올림하지 않으므로
    // 경계가 반짝이는 현상을 크게 줄인다.
    ctx.translate(-camX,-camY);
    ctx.fillStyle=pattern;
    ctx.fillRect(camX,camY,w,h);

    ctx.restore();
    return;
  }

  ctx.fillStyle="#d6ba8b";
  ctx.fillRect(0,0,w,h);
}
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
    const key=userItemImageKey(i.type);
    if(key && drawUserImage(ctx,key,i.x-camX-18,i.y-camY-18,42,42)){
      return;
    }
    ctx.font="27px sans-serif";
    ctx.fillText(ICON[i.type],i.x-camX,i.y-camY);
  });

  // 다른 플레이어도 같은 공간에 있을 때만 표시
  Object.values(players).filter(playerVisible).forEach(p=>{
    ctx.fillStyle=animatedPlayerColorV30(p.color,p);
    ctx.fillRect(
      p.x-camX,
      p.y-camY,
      P,P
    );
  });

  // 내 캐릭터는 항상 화면 중앙
  ctx.fillStyle=animatedPlayerColorV30(me.color,me);
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
    ioClient.emit("finish-scavenge",roomIdentityPayloadV3723({scene:"scavenge"}),r=>{
      if(!r?.ok){
        toast(r?.message||"수집 종료 처리 실패");
        return;
      }

      // 서버 이벤트와 callback 중 어느 쪽이 먼저 와도 벙커 상태를 확보
      if(r.roomCode && room)room.code=r.roomCode;
      bunkerStock=r.bunkerStock||bunkerStock;
      weapons=r.weapons||weapons;
      power=r.power??power;
      firewall=r.firewall??firewall;
      hacked=!!r.hacked;
      securityState=r.security||securityState;
      doorDefense=r.doorDefense??doorDefense;
      doorBreached=!!r.doorBreached;
      radioStateV372=r.radioState||radioStateV372;
      cctvOutsideThreats=r.threats||cctvOutsideThreats;

      (r.vents||[]).forEach(v=>ventStates[v.id]={...v});
      (r.bunkerMobs||[]).forEach(m=>bunkerMobs[m.id]={...m});
    });
    draw();
    return;
  }

  draw();
  requestAnimationFrame(loop);
}

addEventListener("keydown",e=>{
  const raw=typeof e?.key==="string" ? e.key : "";
  if(!raw)return;
  const k=raw.toLowerCase();
  keys.add(k);
  if(k==="e")pickup();
  if(k==="f")store();
  if(k==="q")stair();
});
addEventListener("keyup",e=>{
  const raw=typeof e?.key==="string" ? e.key : "";
  if(!raw)return;
  keys.delete(raw.toLowerCase());
});
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
  $("sanityValue").textContent=`${persistentSanityPoints} SP`;
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


// =========================================================
// USER PROVIDED GRAPHICS ONLY
// 사용자가 직접 업로드한 PNG만 사용
// =========================================================
const USER_ASSET_BASE="/assets/user/";
const USER_ASSET_PATHS={
  rat:"rat.png",
  spider:"spider.png",
  mutant:"mutant.png",
  bat:"bat.png",
  map:"map.png",
  tape:"tape.png",
  toolbox:"toolbox.png",
  soap:"soap.png",
  medkit:"medkit.png",
  water:"water.png",
  blueprint:"blueprint.png",
  beans:"beans.png",
  flashlight:"flashlight.png",
  backpack:"backpack.png",
  radio:"radio.png",
  battery:"battery.png",
  trap:"trap.png",
  spray:"spray.png",
  mask:"mask.png",
  shower:"shower.png",
  stick:"stick.png",
  axe:"axe.png",
  weaponCase:"weapon_case.png",
  computer:"computer.png",
  bed:"bed.png",
  wallParts:"wall_parts.png",
  woodFloor:"wood_floor.png",
  woodFloorTile:"wood_floor_tile.png",
  woodFloorSquare:"wood_floor_square.png"
};
const USER_IMAGES={};
for(const [key,file] of Object.entries(USER_ASSET_PATHS)){
  const img=new Image();
  img.src=USER_ASSET_BASE+file;
  USER_IMAGES[key]=img;
}
function drawUserImage(ctx,key,x,y,w,h,alpha=1){
  const img=USER_IMAGES[key];
  if(!img || !img.complete || !img.naturalWidth || !img.naturalHeight)return false;

  // V37.2.7: 사용자 제공 이미지는 절대 종횡비를 바꾸지 않는다.
  // 지정 영역 안에 contain 방식으로 맞추고 중앙 정렬한다.
  const scale=Math.min(w/img.naturalWidth,h/img.naturalHeight);
  const dw=img.naturalWidth*scale;
  const dh=img.naturalHeight*scale;
  const dx=x+(w-dw)/2;
  const dy=y+(h-dh)/2;

  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.drawImage(img,dx,dy,dw,dh);
  ctx.restore();
  return true;
}
function userItemImageKey(type){
  return ({
    beans:"beans",
    water:"water",
    soap:"soap",
    tape:"tape",
    medkit:"medkit",
    flashlight:"flashlight",
    axe:"axe",
    backpack:"backpack",
    blueprint:"blueprint",
    toolbox:"toolbox",
    map:"map",
    radio:"radio",
    battery:"battery",
    trap:"trap",
    spray:"spray",
    mask:"mask",
    woodenStick:"stick",
    stick:"stick",
    bat:"bat"
  })[type]||null;
}

const BUNKER_OBJECTS = [
  /* 왼쪽 생활/보관 벽 */
  {id:"weapons",label:"무기 보관함",x:118,y:92,w:82,h:128,solid:true,kind:"locker"},
  {id:"bed",label:"침대",x:118,y:244,w:178,h:92,solid:true,kind:"bed"},
  {id:"beans",label:"통조림",x:118,y:365,w:118,h:78,solid:true,kind:"storage"},
  {id:"water",label:"물",x:118,y:463,w:78,h:110,solid:true,kind:"water"},

  /* 위쪽/오른쪽 유틸리티 벽 */
  {id:"computer",label:"컴퓨터",x:315,y:92,w:118,h:66,solid:true,kind:"computer"},
  {id:"radioStation",label:"라디오",x:625,y:92,w:82,h:56,solid:true,kind:"radioStation"},
  {id:"power",label:"전력 공급기",x:805,y:105,w:116,h:82,solid:true,kind:"power"},
  {id:"medkit",label:"메디킷",x:805,y:220,w:116,h:62,solid:true,kind:"medical"},

  /* 아래쪽 보관/탐사 구역 */
  {id:"blueprints",label:"블루프린트",x:420,y:704,w:150,h:48,solid:true,kind:"blueprint"},

  /* 환풍구는 각각 실제 벽에 딱 붙임 */
  {id:"ventTop",label:"환풍구",x:515,y:76,w:108,h:30,solid:true,kind:"vent"},
  {id:"ventLeft",label:"환풍구",x:116,y:610,w:34,h:106,solid:true,kind:"ventVertical"},
  {id:"ventBottom",label:"환풍구",x:725,y:724,w:126,h:30,solid:true,kind:"vent"},

  /* 계단은 장식 */
  {id:"stairs",label:"계단",x:315,y:595,w:350,h:88,solid:false,kind:"stairs"},

  /* 탐사용 벙커문 */
  {id:"bunkerDoor",label:"벙커문",x:210,y:590,w:70,h:108,solid:true,kind:"door"},

  /* 샤워실은 벽 없는 개방형 공간 */
  {id:"showerRoom",label:"샤워실",x:795,y:390,w:130,h:190,solid:false,kind:"room"}
];

const BUNKER_WALLS = [
  /* 벙커 외곽 벽 */
  {x:100,y:60,w:850,h:16},
  {x:100,y:60,w:16,h:720},
  {x:934,y:60,w:16,h:720},
  {x:100,y:764,w:850,h:16},

  /* 계단 구역만 최소한의 벽 유지 */
  {x:285,y:590,w:16,h:125},
  {x:690,y:590,w:16,h:125}
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
    if(o.id==="radioStation" && (bunkerStock.radio||0)<=0)continue;
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

  if(performance.now()<v3716BreachUntil){
    const amt=5;
    bctx.translate((Math.random()-.5)*amt,(Math.random()-.5)*amt);
  }

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

  // 개방형 샤워 공간: 별도 벽 없이 바닥/배수구만 표시
  const shower=BUNKER_OBJECTS.find(o=>o.id==="showerRoom");
  if(!drawUserImage(bctx,"shower",shower.x-camX,shower.y-camY,shower.w,shower.h)){
    bctx.fillStyle="#9eafb2";
    bctx.fillRect(shower.x-camX,shower.y-camY,shower.w,shower.h);
    bctx.strokeStyle="rgba(225,245,245,.28)";
    bctx.lineWidth=1;
    for(let x=shower.x;x<shower.x+shower.w;x+=26){
      bctx.beginPath();
      bctx.moveTo(x-camX,shower.y-camY);
      bctx.lineTo(x-camX,shower.y+shower.h-camY);
      bctx.stroke();
    }
    for(let y=shower.y;y<shower.y+shower.h;y+=26){
      bctx.beginPath();
      bctx.moveTo(shower.x-camX,y-camY);
      bctx.lineTo(shower.x+shower.w-camX,y-camY);
      bctx.stroke();
    }
    bctx.fillStyle="#59676a";
    bctx.beginPath();
    bctx.arc(shower.x+shower.w/2-camX,shower.y+shower.h/2-camY,9,0,Math.PI*2);
    bctx.fill();
  }

  // 벽
  BUNKER_WALLS.forEach(w=>{
    bctx.fillStyle="#403a34";
    bctx.fillRect(w.x-camX,w.y-camY,w.w,w.h);
  });

  // 가구
  BUNKER_OBJECTS
    .filter(o=>o.id!=="showerRoom")
    .filter(o=>o.id!=="radioStation" || (bunkerStock.radio||0)>0)
    .forEach(o=>{
    const x=o.x-camX,y=o.y-camY;

    const userSprite={
      locker:"weaponCase",
      bed:"bed",
      computer:"computer",
      radioStation:"radio",
      storage:"beans",
      medical:"medkit",
      blueprint:"blueprint",
      water:"water"
    }[o.kind];

    if(userSprite && drawUserImage(bctx,userSprite,x,y,o.w,o.h)){
      // 사용자가 제공한 이미지 적용
    }else if(o.kind==="locker"){
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
    }else if(o.kind==="radioStation"){
      bctx.fillStyle="#554b3d";
      bctx.fillRect(x,y,o.w,o.h);
      bctx.fillStyle="#181b18";
      bctx.fillRect(x+8,y+8,o.w-16,18);
      bctx.strokeStyle="#b79b62";
      bctx.beginPath();
      bctx.moveTo(x+12,y+5);
      bctx.lineTo(x+46,y-12);
      bctx.stroke();
      bctx.fillStyle="#d7bf75";
      bctx.beginPath();bctx.arc(x+16,y+37,5,0,Math.PI*2);bctx.fill();
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
  bctx.fillRect(810-camX,410-camY,64,42);
  bctx.fillStyle="#87999a";
  bctx.fillRect(895-camX,405-camY,22,120);
  bctx.fillStyle="#e6efef";
  bctx.fillRect(810-camX,505-camY,80,52);
  bctx.fillStyle="#283131";
  bctx.font="bold 13px Malgun Gothic";
  bctx.fillText("샤워실",808-camX,382-camY);

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

    const breachMutant=["outsideMutant","mutantRaider"].includes(m.type);
    if(breachMutant && drawUserImage(
      bctx,"mutant",sx-4,sy-8,
      m.type==="mutantRaider"?44:38,
      m.type==="mutantRaider"?52:44
    )){
      // 사용자 돌연변이 그래픽
    }else if(m.type==="raider"){
      bctx.fillStyle="#865d3d";
      bctx.fillRect(sx+7,sy+5,18,27);
      bctx.fillStyle="#c69a68";
      bctx.beginPath();bctx.arc(sx+16,sy+3,8,0,Math.PI*2);bctx.fill();
      bctx.strokeStyle="#2b241e";bctx.lineWidth=4;
      bctx.beginPath();bctx.moveTo(sx+25,sy+18);bctx.lineTo(sx+38,sy+30);bctx.stroke();
    }else{
      bctx.fillStyle=
        m.type==="rat" ? "#6e5848" :
        m.type==="spider" ? "#4d362e" :
        "#6b7450";
      bctx.fillRect(sx,sy,32,32);
    }

    bctx.fillStyle="#d84f45";
    bctx.fillRect(sx,sy-8,38*Math.max(0,m.hp/m.maxHp),4);

    bctx.fillStyle="#201a17";
    bctx.font="11px sans-serif";
    bctx.fillText(
      m.type==="rat"?"RAT":
      m.type==="spider"?"SPIDER":
      m.type==="outsideMutant"?"MUTANT":
      m.type==="raider"?"RAIDER":
      m.type==="mutantRaider"?"M.RAIDER":
      m.type==="bountyHunter"?"BOUNTY":"FUMIGATOR",
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

  bctx.fillStyle=animatedPlayerColorV30(me.color,me);
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
    bctx.fillStyle=animatedPlayerColorV30(p.color,p);
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
    if(o.id==="radioStation" && (bunkerStock.radio||0)<=0)continue;

    const cx=o.x+o.w/2,cy=o.y+o.h/2;
    const d=Math.hypot(bunkerPlayer.x-cx,bunkerPlayer.y-cy);

    const interactRange=o.id==="radioStation"?135:92;
    if(d<interactRange && (result===null || d<best)){
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
    }else if(result.id==="radioStation"){
      $("bunkerPrompt").textContent="E · 라디오 채널 선택";
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
  const net=lastBunkerNetStateV3730;
  const moved=
    net.x===null ||
    Math.abs(bunkerPlayer.x-net.x)>.15 ||
    Math.abs(bunkerPlayer.y-net.y)>.15 ||
    Math.abs(bunkerFacing.x-net.fx)>.02 ||
    Math.abs(bunkerFacing.y-net.fy)>.02;
  const heartbeat=now-(net.lastHeartbeat||0)>=1000;

  if((moved && now-lastBunkerSend>160) || heartbeat){
    ioClient.emit("bunker-move",roomIdentityPayloadV3723({
      scene:"bunker",
      x:bunkerPlayer.x,
      y:bunkerPlayer.y,
      facingX:bunkerFacing.x,
      facingY:bunkerFacing.y
    }));
    lastBunkerSend=now;
    net.x=bunkerPlayer.x; net.y=bunkerPlayer.y;
    net.fx=bunkerFacing.x; net.fy=bunkerFacing.y;
    net.lastHeartbeat=now;
  }

  requestAnimationFrame(bunkerMoveLoop);
}

function openWeaponStorage(){
  const names={
    woodenStick:"🪵 나무 막대기",
    axe:"🪓 도끼",
    katana:"⚔️ 카타나"
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



const GAME_SHOW_SECTORS_V3732=[
  {key:"loseHealth",label:"HP 절반"},
  {key:"weapon",label:"카타나"},
  {key:"boss",label:"강적"},
  {key:"supplies",label:"보급품"},
  {key:"supplies",label:"보급품"},
  {key:"loseSupplies",label:"자원 손실"},
  {key:"maxHealth",label:"MAX HP"},
  {key:"sickness",label:"질병"}
];

let gameShowWheelRotationV3732=0;
let gameShowWheelAnimatingV3732=false;
let gameShowWheelPendingResultV3732=null;

function drawGameShowWheelV3732(rotation=0){
  const canvas=$("gameShowWheelCanvasV3732");
  if(!canvas)return;
  const c=canvas.getContext("2d");
  const W=canvas.width,H=canvas.height;
  const cx=W/2,cy=H/2;
  const radius=Math.min(W,H)*.45;
  const step=Math.PI*2/GAME_SHOW_SECTORS_V3732.length;

  c.clearRect(0,0,W,H);
  c.save();
  c.translate(cx,cy);
  c.rotate(rotation-Math.PI/2);

  GAME_SHOW_SECTORS_V3732.forEach((sector,i)=>{
    const a0=i*step;
    const a1=(i+1)*step;

    c.beginPath();
    c.moveTo(0,0);
    c.arc(0,0,radius,a0,a1);
    c.closePath();

    // 고정색 지정 대신 명암 교차로 게임쇼 룰렛 구분
    c.fillStyle=i%2===0 ? "#8a2d2d" : "#c39a38";
    c.fill();

    c.strokeStyle="#151515";
    c.lineWidth=4;
    c.stroke();

    c.save();
    c.rotate(a0+step/2);
    c.translate(radius*.63,0);
    c.rotate(Math.PI/2);
    c.fillStyle="#fff";
    c.font="900 19px sans-serif";
    c.textAlign="center";
    c.textBaseline="middle";
    c.fillText(sector.label,0,0);
    c.restore();
  });

  c.beginPath();
  c.arc(0,0,radius*.16,0,Math.PI*2);
  c.fillStyle="#202326";
  c.fill();
  c.strokeStyle="#e3d076";
  c.lineWidth=6;
  c.stroke();

  c.fillStyle="#f6e9bd";
  c.font="900 20px monospace";
  c.textAlign="center";
  c.textBaseline="middle";
  c.fillText("SPIN",0,1);

  c.restore();
}

function openGameShowWheelV3732(){
  const overlay=$("gameShowWheelOverlayV3732");
  const close=$("gameShowWheelCloseV3732");
  const status=$("gameShowWheelStatusV3732");
  if(!overlay)return;

  overlay.classList.remove("hidden");
  close?.classList.add("hidden");
  if(status)status.textContent="룰렛이 회전합니다...";
  drawGameShowWheelV3732(gameShowWheelRotationV3732);
}

function animateGameShowWheelToResultV3732(result,done=()=>{}){
  const matches=GAME_SHOW_SECTORS_V3732
    .map((s,i)=>s.key===result?i:-1)
    .filter(i=>i>=0);

  const targetIndex=matches.length
    ? matches[Math.floor(Math.random()*matches.length)]
    : 0;

  const count=GAME_SHOW_SECTORS_V3732.length;
  const step=Math.PI*2/count;

  // 포인터는 화면 위쪽(-PI/2). draw 함수 내부에서 -PI/2 기준 회전하므로
  // 해당 섹터의 중앙이 포인터에 오도록 최종 각도를 계산.
  const centerAngle=(targetIndex+.5)*step;
  const normalized=((gameShowWheelRotationV3732%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
  let targetBase=(-centerAngle)%(Math.PI*2);
  if(targetBase<0)targetBase+=Math.PI*2;

  let delta=targetBase-normalized;
  if(delta<0)delta+=Math.PI*2;

  const extraTurns=6+Math.floor(Math.random()*3);
  const totalDelta=extraTurns*Math.PI*2+delta;
  const startRot=gameShowWheelRotationV3732;
  const duration=4600;
  const start=performance.now();

  gameShowWheelAnimatingV3732=true;

  const tick=now=>{
    const t=Math.min(1,(now-start)/duration);
    const eased=1-Math.pow(1-t,4);
    gameShowWheelRotationV3732=startRot+totalDelta*eased;
    drawGameShowWheelV3732(gameShowWheelRotationV3732);

    if(t<1){
      requestAnimationFrame(tick);
      return;
    }

    gameShowWheelAnimatingV3732=false;
    done();
  };

  requestAnimationFrame(tick);
}

function finishGameShowWheelV3732(result){
  const status=$("gameShowWheelStatusV3732");
  const close=$("gameShowWheelCloseV3732");

  if(status){
    status.textContent=`결과 · ${radioResultTextV372(result)}`;
  }
  close?.classList.remove("hidden");
}

function radioResultTextV372(result){
  return ({
    loseHealth:"체력이 크게 감소했습니다.",
    weapon:"카타나를 획득했습니다.",
    boss:"벙커에 강력한 적이 나타났습니다.",
    supplies:"보급품 2개를 획득했습니다.",
    loseSupplies:"보급품 일부를 잃었습니다.",
    maxHealth:"최대 체력이 증가했습니다.",
    sickness:"질병에 걸렸습니다."
  })[result]||String(result||"");
}

function renderRadioPanelV372(){
  if(!$("radioPanelV372") || !$("radioSignalV372") || !$("radioEventV372"))return;
  const s=radioStateV372||{};
  const ev=s.currentEvent;
  const signal=$("radioSignalV372");
  const event=$("radioEventV372");
  const actions=$("radioEventActionsV372");
  const special=$("radioSpecialV372");
  const hist=$("radioHistoryV372");

  signal.textContent=
    !s.hasRadio ? "RADIO MISSING" :
    s.interference ? "████ STATIC / JAMMED ████" :
    s.pendingSignal ? `${s.pendingSignal.channel} FM · SIGNAL CAPTURED` :
    s.pendingStart ? `${s.pendingStart.channel} FM · EVENT PENDING` :
    ev ? "RESPONSE REQUIRED" :
    "READY";

  if(!s.hasRadio){
    event.innerHTML="60초 아이템 수집 단계에서 <b>라디오</b>를 가져와야 사용할 수 있습니다.";
    actions.innerHTML="";
  }else if(s.interference){
    event.innerHTML="<b>RADIO INTERFERENCE</b><br>강한 재밍 때문에 다른 방송을 들을 수 없습니다.";
    actions.innerHTML=`
      <button data-radio-clear="1">임시 신호 복구</button>
      <small>공구함 1 + 배터리 1 사용.</small>
    `;
  }else if(s.pendingSignal){
    event.innerHTML=
      `<b>${s.pendingSignal.channel} FM · ${s.pendingSignal.title}</b><br>`+
      `신호를 포착했습니다. <b>DAY ${s.pendingSignal.decisionDay}</b>에 상대가 다시 호출합니다.`;
    actions.innerHTML="";
  }else if(s.pendingStart){
    event.innerHTML=
      `<b>${s.pendingStart.title} 수락 완료</b><br>`+
      `실제 이벤트는 <b>DAY ${s.pendingStart.startDay}</b>에 시작됩니다.`;
    actions.innerHTML="";
  }else if(ev){
    const body={
      gameShow:"벙커를 돌며 진행되는 수상한 게임쇼 방송입니다. 참가하면 한 번의 룰렛 결과를 받아야 합니다.",
      sos:"모스 부호 형태의 SOS 신호입니다. 해독하면 정신력이 크게 떨어지지만 SOS 좌표를 확보합니다.",
      interference:"주파수 전역에서 이상한 방해 신호가 잡힙니다. 조사하면 전파 방해 탐사지 좌표가 기록되지만 라디오가 재밍됩니다.",
      homeless:"한 생존자가 라디오로 도움을 요청합니다. 받아들이려면 통조림 2개와 물 2개가 필요합니다.",
      aliens:"정체를 알 수 없는 구조 신호입니다. 수락하면 특수 Alien Route를 준비할 수 있습니다."
    }[ev.type]||"알 수 없는 신호입니다.";

    event.innerHTML=`<b>${ev.title}</b><br>${body}`;
    actions.innerHTML=`
      <button data-radio-choice="accept">수락</button>
      <button data-radio-choice="decline">무시</button>
    `;
  }else if(s.gameShow?.active && !s.gameShow?.spun){
    event.innerHTML="<b>GAME SHOW HOST</b><br>룰렛이 준비되었습니다. 한 번 돌리면 결과를 되돌릴 수 없습니다.";
    actions.innerHTML=`<button data-gameshow-spin="1">룰렛 돌리기</button>`;
  }else{
    event.textContent="주파수 버튼을 눌러 원하는 방송을 직접 선택하세요.";
    actions.innerHTML="";
  }

  const h=s.homeless;
  const homelessText=
    !h ? "" :
    !h.resolved ? `<div>방문자: 결과 대기 중...</div>` :
    h.outcome==="guard" ? `<div>방문자: 경비 역할 · 주기적으로 외부 위협 제거</div>` :
    h.outcome==="mold" ? `<div>방문자: 이상 증상 · 벙커 위생 지속 감소</div>` :
    `<div>방문자: 사망</div>`;

  const timelineText=
    s.pendingSignal
      ? `<div class="radio-progress-v3732">
           <b>① 주파수 포착 완료</b>
           <span>② DAY ${s.pendingSignal.decisionDay} 응답 대기</span>
           <span>③ 수락 시 다음 DAY 이벤트 시작</span>
         </div>`
      : s.currentEvent?.phase==="decision"
      ? `<div class="radio-progress-v3732">
           <span>① 주파수 포착 완료</span>
           <b>② 수락 / 거절 선택</b>
           <span>③ 수락 시 다음 DAY 이벤트 시작</span>
         </div>`
      : s.pendingStart
      ? `<div class="radio-progress-v3732">
           <span>① 주파수 포착 완료</span>
           <span>② 수락 완료</span>
           <b>③ DAY ${s.pendingStart.startDay} 이벤트 시작 대기</b>
         </div>`
      : "";

  special.innerHTML=`
    ${timelineText}
    ${homelessText}
    ${h?.active ? '<button data-homeless-expel="1">방문자 내보내기</button>' : ''}
    ${s.unlocks?.sos ? '<div>📍 SOS Location 좌표 확보</div>' : ''}
    ${s.unlocks?.interference ? '<div>📡 Radio Interference Location 좌표 확보</div>' : ''}
    ${s.alienRoute ? '<div>👽 UNKNOWN SIGNAL ROUTE ACTIVE</div>' : ''}
  `;

  hist.innerHTML=(s.history||[]).slice().reverse().map(h=>`
    <div><span>${new Date(h.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span> ${h.text}</div>
  `).join("") || "<div>기록 없음</div>";
}

function refreshRadioStateV372(){
  ioClient.emit("v372-radio-state",roomIdentityPayloadV3723(),r=>{
    if(!r?.ok){
      recoverBunkerConnectionV3723(ok=>{
        if(ok)setTimeout(refreshRadioStateV372,80);
      },{scene:"bunker",silent:true});
      return;
    }
    radioStateV372=r.state||radioStateV372;
    renderRadioPanelV372();
  });
}

function openRadioPanelV372(){
  if((bunkerStock.radio||0)<=0){
    toast("라디오를 수집하지 않았습니다.");
    return;
  }

  const panel=$("radioPanelV372");
  if(!panel){
    toast("라디오 UI를 불러오지 못했습니다.");
    return;
  }

  panel.classList.remove("hidden");

  // 라디오를 누른 순간 방 연결 상태를 한 번 동기화한 뒤 채널 상태를 로드.
  recoverBunkerConnectionV3723(ok=>{
    refreshRadioStateV372();
  },{scene:"bunker",silent:true});
}

if($("radioCloseV372")) $("radioCloseV372").onclick=()=> $("radioPanelV372")?.classList.add("hidden");

document.querySelectorAll("[data-radio-channel]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const channel=btn.dataset.radioChannel;
    const freq=$("radioFrequencyV372");
    if(freq)freq.textContent=`${channel} FM`;

    ioClient.emit("v372-radio-tune",roomIdentityPayloadV3723({channel,scene:"bunker"}),r=>{
      if(!r?.ok){
        toast(r?.message||"라디오 오류");
        return;
      }
      radioStateV372=r.state||radioStateV372;
      renderRadioPanelV372();
      if(r.scheduled){
        toast(`주파수 포착 · DAY ${r.decisionDay}에 응답 요청이 옵니다.`);
      }
    });
  });
});

if($("radioAlienV372")) $("radioAlienV372").onclick=()=>{
  ioClient.emit("v372-aliens-route",roomIdentityPayloadV3723(),r=>{
    if(!r?.ok)return toast(r?.message||"UNKNOWN CHANNEL 연결 실패");
    bunkerStock=r.bunkerStock||bunkerStock;
    radioStateV372=r.state||radioStateV372;
    renderRadioPanelV372();
    toast("정체불명의 구조 신호 루트가 시작되었습니다.");
  });
};

if($("radioEventActionsV372")) $("radioEventActionsV372").onclick=e=>{
  const choice=e.target.dataset.radioChoice;
  if(choice){
    ioClient.emit("v372-radio-choice",roomIdentityPayloadV3723({choice,scene:"bunker"}),r=>{
      if(!r?.ok)return toast(r?.message||"이벤트 처리 실패");
      bunkerStock=r.bunkerStock||bunkerStock;
      radioStateV372=r.state||radioStateV372;
      renderRadioPanelV372();
    });
    return;
  }

  if(e.target.dataset.gameshowSpin){
    if(gameShowWheelAnimatingV3732)return;

    // 서버가 결과를 확정한 뒤, 그 결과 칸까지 실제 룰렛이 회전한다.
    ioClient.emit("v372-gameshow-spin",roomIdentityPayloadV3723(),r=>{
      if(!r?.ok)return toast(r?.message||"룰렛 오류");

      gameShowWheelPendingResultV3732=r;
      openGameShowWheelV3732();

      animateGameShowWheelToResultV3732(r.result,()=>{
        bunkerStock=r.bunkerStock||bunkerStock;
        weapons=r.weapons||weapons;
        radioStateV372=r.state||radioStateV372;

        if(r.stats){
          hp=r.stats.hp??hp;
          playerSick=!!r.stats.sick;
        }

        updateStatusUI();
        renderRadioPanelV372();
        finishGameShowWheelV3732(r.result);
      });
    });
    return;
  }

  if(e.target.dataset.radioClear){
    ioClient.emit("v372-interference-clear",roomIdentityPayloadV3723(),r=>{
      if(!r?.ok)return toast(r?.message||"복구 실패");
      bunkerStock=r.bunkerStock||bunkerStock;
      radioStateV372=r.state||radioStateV372;
      renderRadioPanelV372();
      toast("라디오 신호가 임시 복구되었습니다.");
    });
  }
};


if($("gameShowWheelCloseV3732")){
  $("gameShowWheelCloseV3732").onclick=()=>{
    if(gameShowWheelAnimatingV3732)return;
    $("gameShowWheelOverlayV3732")?.classList.add("hidden");

    const r=gameShowWheelPendingResultV3732;
    if(r){
      toast("게임쇼 결과: "+radioResultTextV372(r.result));
    }
    gameShowWheelPendingResultV3732=null;
  };
}

if($("radioSpecialV372")) $("radioSpecialV372").onclick=e=>{
  if(!e.target.dataset.homelessExpel)return;
  ioClient.emit("v372-homeless-expel",roomIdentityPayloadV3723(),r=>{
    if(!r?.ok)return toast(r?.message||"처리 실패");
    radioStateV372=r.state||radioStateV372;
    renderRadioPanelV372();
  });
};


ioClient.on("connect",()=>{
  if(room?.code && (bunkerRunning || expeditionRunning)){
    setTimeout(()=>{
      recoverBunkerConnectionV3723(ok=>{
        if(ok && bunkerRunning){
          refreshOutsideCCTVV37();
          refreshRadioStateV372();
        }
      },{scene:bunkerRunning?"bunker":(expeditionRunning?"expedition":"room"),silent:true});
    },250);
  }
});

var lastDisconnectToastV3730=0;
ioClient.on("disconnect",reason=>{
  console.warn("[SOCKET DISCONNECT]",reason);
  if(bunkerRunning && Date.now()-lastDisconnectToastV3730>10000){
    lastDisconnectToastV3730=Date.now();
    toast("서버 재연결 중");
  }
});

ioClient.on("v372-radio-ready",()=>{});

ioClient.on("v3731-radio-decision",payload=>{
  radioStateV372=payload?.state||radioStateV372;

  const ev=payload?.event;
  if(!ev)return;

  // 게임 중 어디에 있든 라디오 응답 화면을 앞으로 띄운다.
  const panel=$("radioPanelV372");
  if(panel){
    panel.classList.remove("hidden");
    panel.style.zIndex="10000";
  }

  renderRadioPanelV372();
  toast(`📻 ${ev.channel} FM · 응답 요청 도착`);
});

ioClient.on("v3731-radio-started",payload=>{
  radioStateV372=payload?.state||radioStateV372;
  const title=payload?.title||payload?.type||"RADIO EVENT";
  toast(`📻 DAY ${payload?.day} · ${title} 이벤트 시작`);
  renderRadioPanelV372();
});

ioClient.on("v3731-radio-event-failed",payload=>{
  toast(payload?.message||"라디오 이벤트를 시작하지 못했습니다.");
});

ioClient.on("v372-radio-event",state=>{
  radioStateV372=state||radioStateV372;
  toast("📻 새로운 라디오 이벤트 수신");
  if(!$("radioPanelV372").classList.contains("hidden"))renderRadioPanelV372();
});

ioClient.on("v372-radio-state",state=>{
  radioStateV372=state||radioStateV372;
  if(!$("radioPanelV372").classList.contains("hidden"))renderRadioPanelV372();
});

function computerHTML(tab){
  if(hacked){
    return `
      <div class="v36-hacked-screen">
        <h3>⚠ SYSTEM HACKED</h3>
        <p>컴퓨터의 모든 기능이 잠겼습니다.</p>
        <p>해킹 해제에 필요한 자원:</p>
        <div class="hack-cost">
          <span>💧 물 ${bunkerStock.water||0}/2</span>
          <span>🥫 통조림 ${bunkerStock.beans||0}/2</span>
          <span>🔋 배터리 ${bunkerStock.battery||0}/1</span>
        </div>
        <button id="computerPayHackV36" type="button">자원 넣고 해킹 해제</button>
      </div>
    `;
  }

  if(tab==="cctv"){
    return `
      <h3>SECURITY CAMERA</h3>
      <p>벙커 내부가 아니라 <b>무너진 집 바깥과 벙커 입구</b>를 감시합니다.</p>
      <div class="cctv-system-row-v3718">
        <span>POWER ${Math.round(power)}%</span>
        <span>FIREWALL ${Math.round(firewall)}/6</span>
        <span>${doorBreached?"VAULT BREACHED":"VAULT "+Math.round(doorDefense)+"%"}</span>
      </div>
      <canvas id="cctvCanvasV37" width="640" height="360"></canvas>
      <div class="door-defense-wrap-v37">
        <div class="door-defense-label-v37">
          <span>DOOR DEFENSE</span>
          <b id="doorDefenseTextV37">${Math.round(doorDefense)}%</b>
        </div>
        <div class="door-defense-track-v37">
          <div id="doorDefenseFillV37" class="door-defense-fill-v37" style="width:${Math.max(0,Math.min(100,doorDefense))}%"></div>
        </div>
      </div>
      <div class="cctv-actions-v37">
        <button id="refreshCctvV37" type="button">카메라 새로고침</button>
        <button id="rechargeDefenseV37" type="button">
          ${doorBreached ? "VAULT DOOR 수리/재봉쇄" : "DOOR DEFENSE 충전"}
        </button>
      </div>
      ${
        doorBreached
          ? `<p class="door-repair-cost-v3717">수리: 공구함 1 + 테이프 2 + 배터리 1 · 침입자를 모두 처치해야 수리 가능</p>`
          : `<p class="door-repair-cost-v3717">충전: 배터리 1개 → Door Defense 100%</p>`
      }
      <p id="cctvStatusV37">카메라 연결 중...</p>
    `;
  }

  if(tab==="security"){
    return `
      <h3>SECURITY</h3>
      <p>Vault Door: <b>${securityState}</b></p>
      <p>Vent: <b>NORMAL</b></p>
      <p>Exterior Sensors: <b>ONLINE</b></p>
      <p>Firewall:
        <b>${"▰".repeat(Math.max(0,Math.round(firewall)))}${"▱".repeat(Math.max(0,6-Math.round(firewall)))}</b>
      </p>
      <button data-firewall-start="1">FIREWALL 복구 미니게임</button>
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
    <p>보유 Sanity: <b>${persistentSanityPoints} SP</b></p>
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
  if(!hacked)setTimeout(()=>refreshOutsideCCTVV37(),0);
}

$("computerClose").onclick=()=>{
  $("computerPanel").classList.add("hidden");
  $("computerClose").classList.add("hidden");
};

document.querySelector(".computer-tabs").onclick=e=>{
  const tab=e.target.dataset.tab;
  if(!tab)return;
  $("computerContent").innerHTML=computerHTML(tab);
  if(!hacked && tab==="cctv")setTimeout(()=>refreshOutsideCCTVV37(),0);
};

$("computerContent").onclick=e=>{
  if(e.target.id==="refreshCctvV37"){
    refreshOutsideCCTVV37();
    return;
  }
  if(e.target.id==="rechargeDefenseV37"){
    ioClient.emit("v37-door-defense-recharge",roomIdentityPayloadV3723(),r=>{
      if(!r?.ok)return toast(r?.message||"충전 실패");
      doorDefense=r.doorDefense??doorDefense;
      doorBreached=!!r.doorBreached;
      bunkerStock=r.bunkerStock||bunkerStock;
      updateDoorDefenseUIV37();

      // 버튼/설명까지 상태에 맞춰 다시 그림
      $("computerContent").innerHTML=computerHTML("cctv");
      setTimeout(()=>refreshOutsideCCTVV37(),0);

      toast(r.repaired
        ? "🔧 Vault Door 재봉쇄 완료 · Door Defense 60%"
        : "🔋 Door Defense 100% 충전");
    });
    return;
  }

  if(e.target.id==="computerPayHackV36"){
    payHackerV36FromComputer();
    return;
  }
  if(e.target.dataset.cctv){
    renderCCTVViewV36(e.target.dataset.cctv);
    return;
  }
  if(e.target.dataset.firewallStart){
    startFirewallBullethellV322();
    return;
  }
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


function updateV32HudVisibility(){
  const hud=$("v32SystemHud");
  if(!hud)return;
  hud.classList.toggle("hidden",!bunkerRunning);
}

function renderV32SystemHUD(){
  updateV32HudVisibility();
  if($("v32PowerText"))$("v32PowerText").textContent=`⚡ ${Math.round(power)}%`;
  if($("v32FirewallText"))$("v32FirewallText").textContent=`🛡 ${"▰".repeat(Math.max(0,Math.round(firewall)))}${"▱".repeat(Math.max(0,6-Math.round(firewall)))}`;
  if($("v32BatteryText"))$("v32BatteryText").textContent=`🔋 ×${bunkerStock.battery||0}`;
}

function openGeneratorPanelV32(){
  const p=$("generatorPanel");
  if(!p)return;
  v323RefreshGeneratorPanel?.();
  $("generatorTimingArea")?.classList.add("hidden");
  if($("generatorStageV36"))$("generatorStageV36").textContent="대기 중";
  p.classList.remove("hidden");
  document.body.classList.add("v32-modal-open");
}

let generatorV36={running:false,x:0,dir:1,target:.5,width:.2,stage:1,raf:0};

function generatorAnimateV36(){
  if(!generatorV36.running)return;
  const speeds={1:1.5,2:2.15,3:3.0};
  generatorV36.x+=generatorV36.dir*speeds[generatorV36.stage];
  if(generatorV36.x>=100){generatorV36.x=100;generatorV36.dir=-1}
  if(generatorV36.x<=0){generatorV36.x=0;generatorV36.dir=1}
  if($("generatorCursor"))$("generatorCursor").style.left=`${generatorV36.x}%`;
  generatorV36.raf=requestAnimationFrame(generatorAnimateV36);
}

function setupGeneratorStageV36(stage,target,width){
  generatorV36.stage=stage;
  generatorV36.target=target;
  generatorV36.width=width;
  generatorV36.x=0;
  generatorV36.dir=1;
  generatorV36.running=true;

  const targetEl=$("generatorTarget");
  if(targetEl){
    targetEl.style.left=`${Math.max(0,(target-width/2)*100)}%`;
    targetEl.style.width=`${width*100}%`;
  }
  if($("generatorStageV36"))$("generatorStageV36").textContent=`${stage} / 3 단계`;
  cancelAnimationFrame(generatorV36.raf);
  generatorV36.raf=requestAnimationFrame(generatorAnimateV36);
}

function startGeneratorTimingV32(){
  if(generatorV36.running)return;
  $("generatorTimingArea")?.classList.remove("hidden");
  ioClient.emit("v32-generator-action",{action:"timing"},r=>{
    if(!r?.ok)return toast(r?.message||"발전기 오류");
    setupGeneratorStageV36(r.stage||1,r.target,r.width||.22);
  });
}

function submitGeneratorHitV36(){
  if(!generatorV36.running)return;
  generatorV36.running=false;
  cancelAnimationFrame(generatorV36.raf);

  ioClient.emit("v32-generator-submit",{value:generatorV36.x/100},r=>{
    if(!r?.ok)return toast(r?.message||"발전기 오류");

    if(!r.success){
      $("generatorTimingArea")?.classList.add("hidden");
      if($("generatorStageV36"))$("generatorStageV36").textContent=`${r.failedStage}단계 실패 · 전력 유지`;
      toast(`발전기 ${r.failedStage}단계 실패 · 전력은 그대로 유지됩니다.`);
      v323RefreshGeneratorPanel?.();
      return;
    }

    if(r.complete){
      power=100;blackout=false;
      $("generatorTimingArea")?.classList.add("hidden");
      if($("generatorStageV36"))$("generatorStageV36").textContent="3단계 성공 · 100% 충전 완료";
      v323RefreshGeneratorPanel?.();
      toast("⚡ 3단계 성공! 전력이 100% 충전되었습니다.");
      return;
    }

    toast(`${r.stage-1}단계 성공`);
    setupGeneratorStageV36(r.stage,r.target,r.width);
  });
}

function useGeneratorBatteryV32(){
  ioClient.emit("v32-generator-action",{action:"battery"},r=>{
    if(!r?.ok)return toast(r?.message||"배터리가 없습니다.");
    power=100;blackout=false;bunkerStock=r.bunkerStock||bunkerStock;
    generatorV36.running=false;
    cancelAnimationFrame(generatorV36.raf);
    $("generatorTimingArea")?.classList.add("hidden");
    if($("generatorStageV36"))$("generatorStageV36").textContent="배터리 사용 · 100% 충전";
    v323RefreshGeneratorPanel?.();
    toast("🔋 배터리 1개 사용 · 전력 100%");
  });
}


var firewallGameV322=null;

function openFirewallStatusV322(){
  const panel=$("firewallPanel");
  if(!panel)return;
  $("firewallBarsV322").textContent=
    `${"▰".repeat(Math.max(0,Math.round(firewall)))}${"▱".repeat(Math.max(0,6-Math.round(firewall)))}`;
  $("firewallStateV322").textContent=hacked?"HACKED":firewall<=2?"위험":"정상";
  $("firewallPayHack")?.classList.toggle("hidden",!hacked);
  $("firewallStartV322").disabled=hacked;
  $("firewallGameAreaV322")?.classList.add("hidden");
  $("firewallStatusV322")?.classList.remove("hidden");
  panel.classList.remove("hidden");
  document.body.classList.add("v32-modal-open");
}

function stopFirewallBullethellV322(success){
  const g=firewallGameV322;
  if(!g)return;
  cancelAnimationFrame(g.raf);
  firewallGameV322=null;

  if(success){
    ioClient.emit("v32-firewall-survived",{},r=>{
      if(r?.ok){
        firewall=r.state.firewall; hacked=!!r.state.hacked;
        toast("🛡 FIREWALL 6칸 완전 복구!");
        renderV32SystemHUD();
        openFirewallStatusV322();
      }else toast(r?.message||"Firewall 복구 실패");
    });
  }else{
    ioClient.emit("v32-firewall-failed",{},r=>{
      if(r?.state){
        firewall=r.state.firewall; hacked=!!r.state.hacked;
        renderV32SystemHUD();
      }
      toast(hacked?"💀 컴퓨터가 해킹되었습니다.":"Firewall 복구 실패 · 보안 칸은 유지됩니다.");
      openFirewallStatusV322();
    });
  }
}

function startFirewallBullethellV322(){
  ioClient.emit("v32-firewall-start",{},r=>{
    if(!r?.ok)return toast(r?.message||"Firewall 실행 불가");

    $("firewallStatusV322")?.classList.add("hidden");
    $("firewallGameAreaV322")?.classList.remove("hidden");

    const c=$("firewallCanvasV322"),ctx=c.getContext("2d");
    const rect=c.getBoundingClientRect(),dpr=devicePixelRatio||1;
    c.width=Math.max(1,Math.round(rect.width*dpr));
    c.height=Math.max(1,Math.round(rect.height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);

    const W=rect.width,H=rect.height;
    const g={
      player:{x:W/2,y:H*.82,r:8},
      bullets:[],
      viruses:[
        {x:W*.50,y:H*.22,r:22}
      ],
      keys:new Set(),
      start:performance.now(),
      lastShot:0,
      duration:r.duration||36000,
      raf:0
    };
    firewallGameV322=g;

    const kd=e=>{if(firewallGameV322)g.keys.add(e.key.toLowerCase())};
    const ku=e=>{if(firewallGameV322)g.keys.delete(e.key.toLowerCase())};
    window.addEventListener("keydown",kd);
    window.addEventListener("keyup",ku);

    function shoot(now){
      // V36: 화면에 탄환은 항상 최대 1발만 존재
      if(g.bullets.length>0)return;
      if(now-g.lastShot<850)return;
      g.lastShot=now;
      const v=g.viruses[0];
      const a=Math.atan2(g.player.y-v.y,g.player.x-v.x);
      const speed=3.15;
      g.bullets.push({x:v.x,y:v.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,r:5});
    }

    function loop(now){
      if(firewallGameV322!==g)return;
      const elapsed=now-g.start;
      const sec=Math.floor(elapsed/6000);
      $("firewallStageV322").textContent=`보안 충전 ${Math.min(6,sec)} / 6`;

      const sp=4.2;
      if(g.keys.has("arrowleft")||g.keys.has("a"))g.player.x-=sp;
      if(g.keys.has("arrowright")||g.keys.has("d"))g.player.x+=sp;
      if(g.keys.has("arrowup")||g.keys.has("w"))g.player.y-=sp;
      if(g.keys.has("arrowdown")||g.keys.has("s"))g.player.y+=sp;
      g.player.x=Math.max(10,Math.min(W-10,g.player.x));
      g.player.y=Math.max(10,Math.min(H-10,g.player.y));

      shoot(now);
      for(const b of g.bullets){b.x+=b.vx;b.y+=b.vy;}
      g.bullets=g.bullets.filter(b=>b.x>-20&&b.y>-20&&b.x<W+20&&b.y<H+20);

      for(const b of g.bullets){
        if(Math.hypot(b.x-g.player.x,b.y-g.player.y)<b.r+g.player.r){
          window.removeEventListener("keydown",kd);window.removeEventListener("keyup",ku);
          return stopFirewallBullethellV322(false);
        }
      }

      ctx.fillStyle="#050807";ctx.fillRect(0,0,W,H);
      ctx.strokeStyle="#1d402a";ctx.strokeRect(1,1,W-2,H-2);

      for(const v of g.viruses){
        ctx.fillStyle="#b6192e";ctx.beginPath();ctx.arc(v.x,v.y,v.r,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#fff";ctx.font="18px sans-serif";ctx.textAlign="center";ctx.fillText("☣",v.x,v.y+6);
      }
      ctx.fillStyle="#ff425d";
      for(const b of g.bullets){ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle="#6cff96";ctx.beginPath();ctx.arc(g.player.x,g.player.y,g.player.r,0,Math.PI*2);ctx.fill();

      const pct=Math.min(1,elapsed/g.duration);
      $("firewallProgressV322").style.width=`${pct*100}%`;

      if(elapsed>=g.duration){
        window.removeEventListener("keydown",kd);window.removeEventListener("keyup",ku);
        return stopFirewallBullethellV322(true);
      }
      g.raf=requestAnimationFrame(loop);
    }
    g.raf=requestAnimationFrame(loop);
  });
}

function payHackerV322(){
  ioClient.emit("v32-pay-hacker",{},r=>{
    if(!r?.ok)return toast(r?.message||"물자가 부족합니다.");
    bunkerStock=r.bunkerStock||bunkerStock;
    firewall=r.state.firewall; hacked=!!r.state.hacked;
    renderV32SystemHUD();
    toast("물자를 넘겨 해킹을 해제했습니다. 보안 1칸부터 다시 시작합니다.");
    openFirewallStatusV322();
  });
}



function updateDoorDefenseUIV37(){
  const fill=$("doorDefenseFillV37");
  const txt=$("doorDefenseTextV37");
  if(fill){
    fill.style.width=`${Math.max(0,Math.min(100,doorDefense))}%`;
    fill.classList.toggle("warning",doorDefense<=30 && doorDefense>10);
    fill.classList.toggle("critical",doorDefense<=10);
  }
  if(txt){
    txt.textContent=`${Math.round(doorDefense)}%`;
    txt.classList.toggle("critical",doorDefense<=10);
  }
}

function drawOutsideCCTVV37(){
  const c=$("cctvCanvasV37");
  if(!c)return;
  const ctx=c.getContext("2d"),W=c.width,H=c.height;

  // =========================================================
  // V37.1-1 EXTERIOR MAP
  // CCTV는 벙커 내부가 아니라 핵폭발 후 무너진 집/마당/벙커 입구를 보여준다.
  // 이번 단계는 맵만 완성. 적 AI/문 공격은 다음 단계.
  // =========================================================

  // sky / distant darkness
  const sky=ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,"#151912");
  sky.addColorStop(.55,"#24281d");
  sky.addColorStop(1,"#34352a");
  ctx.fillStyle=sky;
  ctx.fillRect(0,0,W,H);

  // far dead tree line
  ctx.fillStyle="#11140f";
  for(let i=0;i<12;i++){
    const x=i*(W/11)-18;
    const h=42+((i*31)%65);
    ctx.fillRect(x,H*.34-h,10,h);
    ctx.beginPath();
    ctx.moveTo(x+5,H*.34-h+5);
    ctx.lineTo(x-18,H*.34-h+25);
    ctx.lineTo(x+4,H*.34-h+16);
    ctx.lineTo(x+26,H*.34-h+28);
    ctx.closePath();
    ctx.fill();
  }

  // road
  ctx.fillStyle="#353733";
  ctx.beginPath();
  ctx.moveTo(0,H*.68);
  ctx.lineTo(W,H*.58);
  ctx.lineTo(W,H*.83);
  ctx.lineTo(0,H*.92);
  ctx.closePath();
  ctx.fill();

  // road cracks
  ctx.strokeStyle="#1b1c1a";
  ctx.lineWidth=2;
  for(let i=0;i<9;i++){
    const x=(i*83)%W;
    const y=H*.70+((i*17)%55);
    ctx.beginPath();
    ctx.moveTo(x,y);
    ctx.lineTo(x+20,y-6);
    ctx.lineTo(x+32,y+4);
    ctx.stroke();
  }

  // yard
  ctx.fillStyle="#4a4938";
  ctx.fillRect(0,H*.43,W,H*.28);

  // broken fence
  ctx.strokeStyle="#615843";
  ctx.lineWidth=5;
  ctx.beginPath();
  ctx.moveTo(12,H*.48);
  ctx.lineTo(W*.18,H*.49);
  ctx.moveTo(W*.48,H*.47);
  ctx.lineTo(W*.62,H*.48);
  ctx.moveTo(W*.91,H*.45);
  ctx.lineTo(W-8,H*.45);
  ctx.stroke();

  for(const fx of [24,90,300,370,590]){
    ctx.fillStyle="#615843";
    ctx.fillRect(fx,H*.43,7,58);
  }

  // destroyed main house
  const hx=W*.11, hy=H*.20, hw=W*.42, hh=H*.31;
  ctx.fillStyle="#3b3932";
  ctx.fillRect(hx,hy,hw,hh);

  // roof remains
  ctx.fillStyle="#272821";
  ctx.beginPath();
  ctx.moveTo(hx-18,hy+8);
  ctx.lineTo(hx+hw*.45,hy-H*.13);
  ctx.lineTo(hx+hw+15,hy+9);
  ctx.lineTo(hx+hw*.72,hy+2);
  ctx.lineTo(hx+hw*.45,hy-H*.05);
  ctx.lineTo(hx+hw*.20,hy+7);
  ctx.closePath();
  ctx.fill();

  // collapsed right wall
  ctx.fillStyle="#24251f";
  ctx.beginPath();
  ctx.moveTo(hx+hw*.73,hy);
  ctx.lineTo(hx+hw,hy);
  ctx.lineTo(hx+hw,hy+hh);
  ctx.lineTo(hx+hw*.80,hy+hh*.67);
  ctx.lineTo(hx+hw*.90,hy+hh*.45);
  ctx.closePath();
  ctx.fill();

  // house openings
  ctx.fillStyle="#11130f";
  ctx.fillRect(hx+hw*.12,hy+hh*.35,hw*.17,hh*.38);
  ctx.fillRect(hx+hw*.44,hy+hh*.30,hw*.16,hh*.23);
  ctx.fillRect(hx+hw*.61,hy+hh*.30,hw*.15,hh*.23);

  // debris piles
  ctx.fillStyle="#57564c";
  const rubble=[
    [W*.06,H*.54,58,22],[W*.25,H*.55,80,28],[W*.45,H*.55,70,26],
    [W*.55,H*.60,42,18],[W*.82,H*.56,55,20]
  ];
  for(const [x,y,w,h] of rubble){
    ctx.beginPath();
    ctx.moveTo(x,y+h);
    ctx.lineTo(x+w*.2,y+h*.25);
    ctx.lineTo(x+w*.48,y);
    ctx.lineTo(x+w*.72,y+h*.35);
    ctx.lineTo(x+w,y+h);
    ctx.closePath();
    ctx.fill();
  }

  // bunker entrance structure
  const bx=W*.70, by=H*.43, bw=W*.20, bh=H*.24;
  ctx.fillStyle="#353b39";
  ctx.fillRect(bx,by,bw,bh);

  ctx.strokeStyle="#79817d";
  ctx.lineWidth=6;
  ctx.strokeRect(bx,by,bw,bh);

  // reinforced vault door
  const doorX=bx+bw*.27, doorY=by+bh*.15, doorW=bw*.46, doorH=bh*.76;
  ctx.fillStyle="#252b2a";
  ctx.fillRect(doorX,doorY,doorW,doorH);
  ctx.strokeStyle="#929a95";
  ctx.lineWidth=4;
  ctx.strokeRect(doorX,doorY,doorW,doorH);

  // door wheel
  ctx.strokeStyle="#757e7a";
  ctx.lineWidth=4;
  ctx.beginPath();
  ctx.arc(doorX+doorW*.52,doorY+doorH*.48,doorW*.18,0,Math.PI*2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(doorX+doorW*.34,doorY+doorH*.48);
  ctx.lineTo(doorX+doorW*.70,doorY+doorH*.48);
  ctx.moveTo(doorX+doorW*.52,doorY+doorH*.29);
  ctx.lineTo(doorX+doorW*.52,doorY+doorH*.67);
  ctx.stroke();

  // V37.1-5 문 공격 충격 효과
  if(performance.now()<v3715DoorHitUntil){
    const pulse=(v3715DoorHitUntil-performance.now())/320;
    ctx.save();
    ctx.globalAlpha=Math.max(.15,pulse*.75);
    ctx.strokeStyle="#ff6d5f";
    ctx.lineWidth=6;
    ctx.strokeRect(doorX-4,doorY-4,doorW+8,doorH+8);
    ctx.fillStyle="#ffdf9b";
    ctx.font="bold 16px monospace";
    ctx.textAlign="center";
    ctx.fillText(`-${v3715LastDoorDamage}`,doorX+doorW/2,doorY-10);
    ctx.restore();
  }

  // V37.1-6 방어력 0: Vault Door 파손 연출
  if(doorBreached){
    ctx.save();
    ctx.strokeStyle="#b4493f";
    ctx.lineWidth=5;
    ctx.beginPath();
    ctx.moveTo(doorX+8,doorY+10);
    ctx.lineTo(doorX+doorW*.50,doorY+doorH*.45);
    ctx.lineTo(doorX+doorW*.30,doorY+doorH*.80);
    ctx.moveTo(doorX+doorW*.65,doorY+5);
    ctx.lineTo(doorX+doorW*.48,doorY+doorH*.50);
    ctx.lineTo(doorX+doorW-8,doorY+doorH-8);
    ctx.stroke();
    ctx.fillStyle="rgba(120,20,16,.25)";
    ctx.fillRect(doorX,doorY,doorW,doorH);
    ctx.restore();
  }

  // security camera mast
  ctx.fillStyle="#555d59";
  ctx.fillRect(bx+bw*.88,by-H*.10,6,H*.12);
  ctx.fillRect(bx+bw*.82,by-H*.10,32,10);
  ctx.fillStyle="#202724";
  ctx.fillRect(bx+bw*.80,by-H*.105,25,15);

  // path to bunker
  ctx.fillStyle="#555246";
  ctx.beginPath();
  ctx.moveTo(W*.58,H*.67);
  ctx.lineTo(W*.78,H*.62);
  ctx.lineTo(W*.85,H*.72);
  ctx.lineTo(W*.62,H*.78);
  ctx.closePath();
  ctx.fill();

  // 외부 적 접근 경로를 희미하게 표시
  ctx.save();
  ctx.globalAlpha=.12;
  ctx.strokeStyle="#d9d2a1";
  ctx.lineWidth=3;
  ctx.setLineDash([8,8]);
  ctx.beginPath();
  ctx.moveTo(W*.10,H*.58);
  ctx.lineTo(W*.58,H*.60);
  ctx.lineTo(W*.79,H*.59);
  ctx.stroke();
  ctx.restore();

  // V37.1-3 외부 위협 표시
  for(const t of cctvOutsideThreats){
    const x=(t.x??0.5)*W;
    const y=(t.y??0.5)*H;

    if(t.type==="mutant"){
      // user-provided mutant image if available
      if(!drawUserImage(ctx,"mutant",x-18,y-25,36,50)){
        ctx.fillStyle="#617f50";
        ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill();
      }
    }else if(t.type==="raider"){
      ctx.fillStyle="#8c6038";
      ctx.fillRect(x-7,y-17,14,30);
      ctx.fillStyle="#c59a62";
      ctx.beginPath();ctx.arc(x,y-22,7,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#2b261f";
      ctx.lineWidth=3;
      ctx.beginPath();
      ctx.moveTo(x+5,y-4);ctx.lineTo(x+15,y+8);
      ctx.stroke();
    }else if(t.type==="mutantRaider"){
      ctx.fillStyle="#723f3b";
      ctx.fillRect(x-12,y-24,24,42);
      ctx.fillStyle="#9b5c50";
      ctx.beginPath();ctx.arc(x,y-31,11,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#c1a36f";
      ctx.lineWidth=3;
      ctx.strokeRect(x-15,y-27,30,48);
    }

    // threat marker label
    ctx.fillStyle="rgba(0,0,0,.65)";
    ctx.fillRect(x-26,y+21,52,14);
    ctx.fillStyle="#ffdf8d";
    ctx.font="bold 9px monospace";
    ctx.textAlign="center";
    ctx.fillText(
      t.type==="mutantRaider"?"M.RAIDER":
      t.type==="raider"?"RAIDER":"MUTANT",
      x,y+31
    );

    ctx.fillStyle=
      t.state==="atDoor" ? "#ff6565" :
      t.state==="approachingDoor" ? "#ffc75f" :
      t.state==="approachingYard" ? "#f0dd87" :
      "#b7d3b7";
    ctx.font="bold 8px monospace";
    ctx.fillText(
      t.state==="atDoor" ? "AT DOOR" :
      t.state==="approachingDoor" ? "TO DOOR" :
      t.state==="approachingYard" ? "TO YARD" :
      "ROAM",
      x,y+41
    );
  }

  // CCTV scan lines
  ctx.save();
  ctx.globalAlpha=.13;
  ctx.fillStyle="#a4ffbc";
  for(let y=0;y<H;y+=5)ctx.fillRect(0,y,W,1);
  ctx.restore();

  // vignette
  const vg=ctx.createRadialGradient(W*.5,H*.48,H*.15,W*.5,H*.48,H*.72);
  vg.addColorStop(0,"rgba(0,0,0,0)");
  vg.addColorStop(1,"rgba(0,0,0,.54)");
  ctx.fillStyle=vg;
  ctx.fillRect(0,0,W,H);

  // low power effect
  if(power<=0 && cctvSignalV3718!=="offline"){
    ctx.fillStyle="rgba(0,0,0,.93)";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#ff6666";
    ctx.font="bold 28px monospace";
    ctx.textAlign="center";
    ctx.fillText("NO SIGNAL - NO POWER",W/2,H/2);
  }else if(power<30){
    ctx.save();
    ctx.globalAlpha=.30;
    for(let i=0;i<90;i++){
      ctx.fillStyle=Math.random()>.5?"#ffffff":"#72ff99";
      ctx.fillRect(Math.random()*W,Math.random()*H,6+Math.random()*40,1);
    }
    ctx.restore();
  }

  // V37.1-8 camera lock/offline overlay
  if(hacked || cctvSignalV3718==="offline"){
    ctx.fillStyle="rgba(0,0,0,.92)";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle=hacked?"#ff6565":"#ffbb66";
    ctx.font="bold 26px monospace";
    ctx.textAlign="center";
    ctx.fillText(hacked?"SYSTEM LOCKED":"NO SIGNAL",W/2,H/2-6);
    ctx.font="bold 13px monospace";
    ctx.fillStyle="#ddd";
    ctx.fillText(hacked?"HACK RECOVERY REQUIRED":"POWER REQUIRED",W/2,H/2+20);
  }

  // labels
  ctx.fillStyle="#9dffb4";
  ctx.font="bold 14px monospace";
  ctx.textAlign="left";
  ctx.fillText("EXTERIOR SECURITY CAMERA",12,22);
  ctx.fillText(`POWER ${Math.round(power)}%`,12,42);
  ctx.fillText(`DOOR DEFENSE ${Math.round(doorDefense)}%`,12,62);
  ctx.fillText("SECTOR: HOUSE / VAULT ENTRANCE",12,H-14);

  updateDoorDefenseUIV37();

  const status=$("cctvStatusV37");
  if(status){
    status.textContent=
      hacked ? "SYSTEM LOCKED · 해킹 해제 필요" :
      cctvSignalV3718==="offline" ? "NO SIGNAL · 전력 필요" :
      cctvSignalV3718==="unstable" ? `신호 불안정 · 전력 ${Math.round(power)}%` :
      doorBreached
        ? "💥 VAULT DOOR BREACHED · 침입자 처리 후 수리 필요"
        : doorDefense<=0
        ? "🚨 DOOR DEFENSE 0% · 문 방어 붕괴"
        : doorDefense<=10
          ? `🚨 DOOR DEFENSE CRITICAL ${Math.round(doorDefense)}%`
          : doorDefense<=30
            ? `⚠ DOOR DEFENSE LOW ${Math.round(doorDefense)}%`
            : cctvOutsideThreats.length
        ? (
            cctvOutsideThreats.some(t=>t.state==="atDoor")
              ? `⚠ 벙커 문 공격 중 · ${cctvOutsideThreats.filter(t=>t.state==="atDoor").length}개`
              : cctvOutsideThreats.some(t=>t.state==="approachingDoor")
                ? `⚠ 외부 위협이 벙커 문으로 접근 중`
                : cctvOutsideThreats.some(t=>t.state==="approachingYard")
                  ? `외부 위협이 마당으로 접근 중`
                  : `외부 위협 ${cctvOutsideThreats.length}개 감지 · 배회 중`
          )
        : "외부 위협 없음 · 집 외부 감시 중";
  }
}

function refreshOutsideCCTVV37(){
  if(hacked){
    const status=$("cctvStatusV37");
    if(status)status.textContent="SYSTEM LOCKED · 해킹 해제 필요";
    return;
  }
  ioClient.emit("v37-cctv-state",roomIdentityPayloadV3723(),r=>{
    if(!r?.ok){
      recoverBunkerConnectionV3723(ok=>{
        if(ok)setTimeout(refreshOutsideCCTVV37,80);
      },{scene:"bunker",silent:true});
      return;
    }
    doorDefense=r.doorDefense??doorDefense;
    doorBreached=!!r.doorBreached;
    bunkerStock=r.bunkerStock||bunkerStock;
    cctvSignalV3718=r.signal||"online";
    cctvOutsideThreats=r.threats||[];
    power=r.power??power;
    drawOutsideCCTVV37();
  });
}




ioClient.on("v3717-door-resealed",d=>{
  doorDefense=d?.doorDefense??60;
  doorBreached=false;
  bunkerStock=d?.bunkerStock||bunkerStock;
  securityState=d?.security||"RESEALED";
  updateDoorDefenseUIV37();
  toast("🔧 Vault Door가 다시 봉쇄되었습니다.");

  if(!$("computerPanel")?.classList.contains("hidden")){
    $("computerContent").innerHTML=computerHTML("cctv");
    setTimeout(()=>refreshOutsideCCTVV37(),0);
  }
});

ioClient.on("v3716-vault-breached",d=>{
  doorDefense=d?.doorDefense??0;
  doorBreached=true;
  securityState=d?.security||"BREACHED";
  v3716BreachUntil=performance.now()+1800;
  updateDoorDefenseUIV37();
  toast(`💥 VAULT BREACH! 외부 적 ${d?.count||1}개가 벙커에 침입했습니다.`);

  if(!$("computerPanel")?.classList.contains("hidden") && $("cctvCanvasV37")){
    drawOutsideCCTVV37();
  }
});

ioClient.on("v3715-door-hit",d=>{
  doorDefense=d?.doorDefense??doorDefense;
  v3715LastDoorDamage=d?.damage||0;
  v3715DoorHitUntil=performance.now()+320;
  updateDoorDefenseUIV37();

  if(d?.critical){
    toast(`🚨 DOOR DEFENSE ${Math.round(doorDefense)}%`);
  }else if(d?.warning && doorDefense<=30){
    toast(`⚠ Door Defense ${Math.round(doorDefense)}%`);
  }

  if(!$("computerPanel")?.classList.contains("hidden") && $("cctvCanvasV37")){
    drawOutsideCCTVV37();
    setTimeout(()=>{
      if($("cctvCanvasV37"))drawOutsideCCTVV37();
    },340);
  }
});

ioClient.on("v3713-exterior-threats",d=>{
  cctvOutsideThreats=d?.threats||[];
  if(!$("computerPanel")?.classList.contains("hidden") && $("cctvCanvasV37")){
    drawOutsideCCTVV37();
  }
});

ioClient.on("v37-door-defense",d=>{
  doorDefense=d?.doorDefense??doorDefense;
  if(typeof d?.doorBreached==="boolean")doorBreached=d.doorBreached;
  updateDoorDefenseUIV37();
  if(!$("computerPanel")?.classList.contains("hidden") && $("cctvCanvasV37")){
    drawOutsideCCTVV37();
  }
});

function payHackerV36FromComputer(){
  ioClient.emit("v32-pay-hacker",{},r=>{
    if(!r?.ok)return toast(r?.message||"해킹 해제 실패");
    bunkerStock=r.bunkerStock||bunkerStock;
    firewall=r.state?.firewall??1;
    hacked=!!r.state?.hacked;
    cctvSignalV3718=power>0?(power<30?"unstable":"online"):"offline";
    securityState="RECOVERING";
    $("computerContent").innerHTML=computerHTML("cctv");
    setTimeout(()=>refreshOutsideCCTVV37(),0);
    toast("컴퓨터 해킹이 해제되었습니다.");
  });
}

function renderCCTVViewV36(camera="full"){
  // Legacy alias: V37부터는 외부 CCTV만 사용.
  refreshOutsideCCTVV37();
}


function startFirewallMiniGameV32(){
  ioClient.emit("v32-firewall-start",{},r=>{
    if(!r?.ok)return toast(r?.message||"Firewall 오류");
    const panel=$("firewallPanel");panel?.classList.remove("hidden");
    const seq=r.sequence||[],answer=[];
    const symbols=["▲","■","●","◆"];
    $("firewallSequence").textContent=seq.map(i=>symbols[i]).join(" ");
    $("firewallAnswer").textContent="";
    document.querySelectorAll("[data-fw]").forEach(btn=>{
      btn.onclick=()=>{
        answer.push(Number(btn.dataset.fw));
        $("firewallAnswer").textContent=answer.map(i=>symbols[i]).join(" ");
        if(answer.length>=seq.length){
          ioClient.emit("v32-firewall-submit",{answer},res=>{
            panel?.classList.add("hidden");
            if(res?.ok){firewall=res.state.firewall;toast(res.success?"FIREWALL 복구 성공":"FIREWALL 복구 실패");renderV32SystemHUD();}
          });
        }
      };
    });
  });
}

function startSleepDreamV32(endsAt){
  v32Sleeping=true;v32SleepEndsAt=endsAt||Date.now()+9000;
  const overlay=$("sleepOverlay");overlay?.classList.remove("hidden");
  const sheep=$("sleepSheep"),counter=$("sleepCount");
  let count=0;
  const run=()=>{
    if(!v32Sleeping||count>=3)return;
    count++;
    if(counter)counter.textContent=`${count} / 3`;
    if(sheep){
      sheep.classList.remove("jump");
      void sheep.offsetWidth;
      sheep.classList.add("jump");
    }
    if(count<3)setTimeout(run,2500);
  };
  run();
}


function roomIdentityPayloadV3723(extra={}){
  const scene=
    bunkerRunning ? "bunker" :
    expeditionRunning ? "expedition" :
    running ? "scavenge" : "room";

  return {
    roomCode:room?.code||"",
    sessionId:sessionId||"",
    accountId:currentAccount?.accountId||"",
    nickname:currentAccount?.displayName||me?.nickname||"",
    token:accountToken||"",
    scene,
    ...extra
  };
}

function recoverBunkerConnectionV3723(done=()=>{},options={}){
  const payload=roomIdentityPayloadV3723({
    scene:options.scene || (bunkerRunning?"bunker":"room")
  });

  ioClient.emit("v3723-recover-room",payload,r=>{
    if(!r?.ok){
      if(!options.silent){
        toast(r?.message||"서버 연결/방 정보 복구 실패");
      }
      done(false);
      return;
    }

    bunkerStock=r.bunkerStock||bunkerStock;
    weapons=r.weapons||weapons;
    power=r.power??power;
    firewall=r.firewall??firewall;
    hacked=!!r.hacked;
    securityState=r.security||securityState;
    doorDefense=r.doorDefense??doorDefense;
    doorBreached=!!r.doorBreached;
    radioStateV372=r.radioState||radioStateV372;
    cctvOutsideThreats=r.threats||[];

    (r.vents||[]).forEach(v=>ventStates[v.id]={...v});
    bunkerMobs={};
    (r.bunkerMobs||[]).forEach(m=>bunkerMobs[m.id]={...m});

    done(true);
  });
}

function consumeBunker(type){
  ioClient.emit("consume-bunker-item",{
    type,
    roomCode:room?.code,
    sessionId,
    nickname:currentAccount?.displayName||""
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
    nickname:currentAccount?.displayName||""
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

  if(bunkerNear.id==="radioStation"){
    openRadioPanelV372();
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
    openGeneratorPanelV32();
    return;
  }

  if(bunkerNear.id==="bed"){
    if(v32Sleeping)return;
    ioClient.emit("v32-sleep",{roomCode:room?.code,sessionId,nickname:currentAccount?.displayName||""},r=>{
      if(!r?.ok)toast(r?.message||"잘 수 없습니다.");
    });
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
  lastBunkerNetStateV3730={x:null,y:null,fx:null,fy:null,lastHeartbeat:0};

  // 네트워크 오류가 있어도 검은 페이드 화면에 영구 고정되지 않도록 안전 해제.
  setTimeout(()=>{
    const fade=$("fadeOverlay");
    if(fade){
      fade.style.opacity="0";
      setTimeout(()=>fade.classList.add("hidden"),700);
    }
  },1800);
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

  // 벙커 렌더링은 네트워크 복구 성공 여부와 분리한다.
  // 서버 상태는 가능한 즉시 가져오고 실패하면 백그라운드 복구가 다시 시도한다.
  ioClient.emit("get-bunker-players",roomIdentityPayloadV3723({scene:"bunker"}),r=>{
    if(r?.ok){
      bunkerOthers={};
      r.players.forEach(p=>bunkerOthers[p.id]=p);
    }
  });

  ioClient.emit("get-vent-state",roomIdentityPayloadV3723({scene:"bunker"}),r=>{
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
  updateV32HudVisibility();

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
    const userKey=userItemImageKey(item.type);
    if(userKey && drawUserImage(exctx,userKey,item.x-camX-12,item.y-camY-12,38,38)){
      // 사용자 아이템 이미지
    }else{
      exctx.font="27px sans-serif";
      exctx.fillText(ICON[item.type],item.x-camX,item.y-camY);
    }
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

    // 사용자가 제공한 돌연변이 이미지
    if(drawUserImage(exctx,"mutant",sx-10,sy-18,58,70)){
      // 이미지 렌더 완료
    }else{
      exctx.fillStyle="#667948";
      exctx.fillRect(sx,sy,36,36);
      exctx.fillStyle="#9ec45b";
      exctx.fillRect(sx+4,sy+5,8,8);
      exctx.fillRect(sx+22,sy+18,9,9);
    }

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

  exctx.fillStyle=animatedPlayerColorV30(me.color,me);
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
  if(!adminFullBright){
  {
    const cx=vw/2;
    const cy=vh/2;

    const radius=blackout
      ? (expeditionFlashlight ? Math.min(vw,vh)*0.23 : Math.min(vw,vh)*0.14)
      : (expeditionFlashlight ? Math.min(vw,vh)*0.58 : Math.min(vw,vh)*0.34);

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

  }
  requestAnimationFrame(drawExpedition);
}



function startBunkerJump(){
  if(!bunkerRunning||bunkerJumping)return;

  ioClient.emit("bunker-jump",{
    roomCode:room?.code,
    sessionId,
    nickname:currentAccount?.displayName||""
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
    nickname:currentAccount?.displayName||""
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

if($("chooseSOS")) $("chooseSOS").onclick=()=>{
  if(!radioStateV372?.unlocks?.sos){
    toast("91.3 FM SOS 신호를 먼저 해독해야 합니다.");
    return;
  }
  $("expeditionLocationPanel").classList.add("hidden");
  requestExpedition("sos");
};

if($("chooseInterference")) $("chooseInterference").onclick=()=>{
  if(!radioStateV372?.unlocks?.interference){
    toast("97.9 FM Radio Interference 신호를 먼저 수신해야 합니다.");
    return;
  }
  $("expeditionLocationPanel").classList.add("hidden");
  requestExpedition("interference");
};
function beginExpeditionFromServer(data){
  const participants=data.participantIds||[];

  if(!participants.includes(myId)){
    $("expeditionInvitePanel").classList.add("hidden");
    return;
  }

  bunkerRunning=false;
updateV32HudVisibility();
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
    expeditionLocation==="hospital" ? "🏥 병원 탐사" :
    expeditionLocation==="sos" ? "📡 SOS 좌표 탐사" :
    expeditionLocation==="interference" ? "📻 전파 방해 좌표 탐사" :
    "🛒 식료품점 탐사";

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
    nickname:currentAccount?.displayName||""
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
      nickname:currentAccount?.displayName||"",
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
  hospitalAttackUntil=performance.now()+180;
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
  if(d?.roomCode && room){
    room.code=d.roomCode;
  }
  day=d.day||day;
  sanity=persistentSanityPoints;
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

  setTimeout(()=>{
    // scavenge-result를 받은 시점에 서버는 이미 p.inBunker=true로 전환 완료.
    // 복구 요청 실패 때문에 검정 화면에 갇히지 않도록 장면부터 정상 진입한다.
    enterBunkerScene();

    // 연결 상태 동기화는 화면 진입 뒤 백그라운드에서 수행.
    setTimeout(()=>{
      recoverBunkerConnectionV3723(ok=>{
        if(ok){
          refreshOutsideCCTVV37();
          refreshRadioStateV372();
        }
      },{scene:"bunker",silent:true});
    },250);
  },450);
});

ioClient.on("account-state",a=>{
  applyAccount(a);
  sanity=persistentSanityPoints;
  updateStatusUI();
  if(!$("computerPanel")?.classList.contains("hidden")){
    $("computerContent").innerHTML=computerHTML("shop");
  }
});

ioClient.on("computer-hacked",()=>{
  hacked=true;
  firewall=0;
  cctvSignalV3718="offline";
  cctvOutsideThreats=[];
  renderV32SystemHUD();

  if(!$("computerPanel")?.classList.contains("hidden")){
    $("computerContent").innerHTML=computerHTML("security");
  }

  toast("💀 컴퓨터가 해킹당했습니다. 해킹 해제 외 기능이 잠겼습니다.");
});
ioClient.on("v32-system-state",d=>{
  power=d.power??power;
  firewall=d.firewall??firewall;
  const wasHacked=hacked;
  hacked=!!d.hacked;
  blackout=!!d.blackout;
  if(Number.isFinite(d.doorDefense))doorDefense=d.doorDefense;
  if(typeof d.doorBreached==="boolean")doorBreached=d.doorBreached;
  if(wasHacked!==hacked && !$("computerPanel")?.classList.contains("hidden")){
    $("computerContent").innerHTML=computerHTML(hacked?"security":"cctv");
    if(!hacked)setTimeout(()=>refreshOutsideCCTVV37(),0);
  }
  bounty=d.bounty??bounty;
  bountyLevel=d.bountyLevel??bountyLevel;
  if(typeof d.batteryCount==="number")bunkerStock.battery=d.batteryCount;
  renderV32SystemHUD();
});

ioClient.on("bounty-hunter-arrived",d=>{
  toast(`⚠ BOUNTY HUNTER LV.${d.level} 접근! HP ${d.hp}`);
});

ioClient.on("v32-sleep-start",d=>startSleepDreamV32(d.endsAt));
ioClient.on("v32-sleep-finished",d=>{
  v32Sleeping=false;
  $("sleepOverlay")?.classList.add("hidden");
  if(d.stats){
    fatigue=d.stats.fatigue??fatigue;
    hunger=d.stats.hunger??hunger;
    thirst=d.stats.thirst??thirst;
    sanityStat=d.stats.sanityStat??sanityStat;
  }
  updateStatusUI();
  toast("잠에서 깼습니다.");
});

ioClient.on("bunker-state",d=>{
  day=d.day||day;
  sanity=persistentSanityPoints;
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
sanity=persistentSanityPoints;
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


let lastConnectErrorToastV3726=0;
ioClient.on("connect_error",err=>{
  const transport=ioClient.io?.engine?.transport?.name||"not-connected";
  console.error(
    "Socket connection error:",
    err?.message||err,
    "transport:",transport,
    err
  );

  const now=Date.now();
  if(!ioClient.connected && now-lastConnectErrorToastV3726>12000){
    lastConnectErrorToastV3726=now;
    toast("서버 연결 재시도 중");
  }
});

ioClient.on("connect",()=>{
  console.log(
    "[SOCKET CONNECTED]",
    ioClient.id,
    "transport:",ioClient.io?.engine?.transport?.name,
    "recovered:",!!ioClient.recovered
  );
});

ioClient.io.on("reconnect_attempt",attempt=>{
  console.log("[SOCKET RECONNECT]",attempt);
});


if($("v30ClaimButton")){
  $("v30ClaimButton").onclick=claimV30Reward;
}
renderPersistentSanityV30();
renderRainbowOptionV30();
renderV30ClaimButton();


function animateRainbowPreviewV30(){
  const btn=$("colorPicker")?.querySelector('[data-color="rainbow"]');
  if(btn && rainbowUnlockedV30){
    const c1=rainbowColorV30(0);
    const c2=rainbowColorV30(4);
    const c3=rainbowColorV30(8);
    const c4=rainbowColorV30(12);
    btn.style.background=`linear-gradient(135deg,${c1},${c2},${c3},${c4})`;
  }
  requestAnimationFrame(animateRainbowPreviewV30);
}
requestAnimationFrame(animateRainbowPreviewV30);


requestAnimationFrame(()=>{
  if(selectedColor==="rainbow" && rainbowUnlockedV30){
    const rb=$("colorPicker")?.querySelector('[data-color="rainbow"]');
    if(rb){
      $("colorPicker").querySelectorAll("[data-color]").forEach(b=>
        b.classList.toggle("selected",b===rb)
      );
    }
  }
});


if($("authLoginTab"))$("authLoginTab").onclick=()=>showAuthMode("login");
if($("authRegisterTab"))$("authRegisterTab").onclick=()=>showAuthMode("register");
if($("loginButton"))$("loginButton").onclick=doLogin;
if($("registerButton"))$("registerButton").onclick=doRegister;
if($("logoutButton"))$("logoutButton").onclick=doLogout;
if($("changeNameButton"))$("changeNameButton").onclick=changeAccountName;
if($("v30ClaimButton"))$("v30ClaimButton").onclick=claimV30Reward;

function animateRainbowPreviewV30(){
  const btn=$("colorPicker")?.querySelector('[data-color="rainbow"]');
  if(btn&&rainbowUnlockedV30){
    const c1=rainbowColorV30(0);
    const c2=rainbowColorV30(4);
    const c3=rainbowColorV30(8);
    const c4=rainbowColorV30(12);
    btn.style.background=`linear-gradient(135deg,${c1},${c2},${c3},${c4})`;
  }
  requestAnimationFrame(animateRainbowPreviewV30);
}
requestAnimationFrame(animateRainbowPreviewV30);

showAuthMode("login");
updateAccountUI();


if($("adminSettingsButton")){
  $("adminSettingsButton").onclick=()=>{
    $("adminSettingsPanel")?.classList.toggle("hidden");
  };
}
if($("adminSettingsClose")){
  $("adminSettingsClose").onclick=()=>{
    $("adminSettingsPanel")?.classList.add("hidden");
  };
}
if($("adminGodMode"))$("adminGodMode").onchange=saveAdminSettings;
if($("adminFullBright"))$("adminFullBright").onchange=saveAdminSettings;

if($("generatorStart"))$("generatorStart").onclick=startGeneratorTimingV32;
if($("generatorBattery"))$("generatorBattery").onclick=useGeneratorBatteryV32;
if($("generatorClose"))$("generatorClose").onclick=()=>$("generatorPanel").classList.add("hidden");
renderV32SystemHUD();


document.addEventListener("DOMContentLoaded",()=>{
  $("generatorPanel")?.classList.add("hidden");
  $("firewallPanel")?.classList.add("hidden");
  $("sleepOverlay")?.classList.add("hidden");
  if(!bunkerRunning)$("v32SystemHud")?.classList.add("hidden");
});

if($("firewallStartV322"))$("firewallStartV322").onclick=startFirewallBullethellV322;
if($("firewallPayHack"))$("firewallPayHack").onclick=payHackerV322;
if($("firewallCloseV322"))$("firewallCloseV322").onclick=()=>closeV32Modal("firewallPanel");


// VERSION 32.3: 상단 전력/Firewall HUD는 사용하지 않음
function v323HideFloatingSystemHud(){
  const h=document.getElementById("v32SystemHud");
  if(h)h.remove();
}
v323HideFloatingSystemHud();

// 발전기 상태창은 상호작용했을 때만 갱신
function v323RefreshGeneratorPanel(){
  const a=document.getElementById("generatorPowerState");
  const b=document.getElementById("generatorBatteryState");
  const c=document.getElementById("generatorStatusState");
  if(a)a.textContent=`${Math.round(power)}%`;
  if(b)b.textContent=`${bunkerStock.battery||0}개`;
  if(c)c.textContent=power<=0?"정전":"정상";
}

// 기존 발전기 상호작용 함수의 결과 화면을 보강
const _v323OldOpenGenerator=typeof openGeneratorPanelV32==="function"?openGeneratorPanelV32:null;
if(_v323OldOpenGenerator){
  openGeneratorPanelV32=function(){
    const panel=document.getElementById("generatorPanel");
    if(panel){
      v323RefreshGeneratorPanel();
      document.getElementById("generatorTimingArea")?.classList.add("hidden");
      panel.classList.remove("hidden");
      document.body.classList.add("v32-modal-open");
    }
  };
}

function v323CloseModal(id){
  document.getElementById(id)?.classList.add("hidden");
  document.body.classList.remove("v32-modal-open");
}

// 캔버스가 발전기/Firewall 버튼 클릭을 가로채지 못하게 함
document.addEventListener("click",function(e){
  const b=e.target.closest("button");
  if(!b)return;

  if(b.id==="generatorStart"){
    e.preventDefault();e.stopPropagation();
    document.getElementById("generatorTimingArea")?.classList.remove("hidden");
    startGeneratorTimingV32();
    return;
  }
  if(b.id==="generatorBattery"){
    e.preventDefault();e.stopPropagation();
    useGeneratorBatteryV32();
    setTimeout(v323RefreshGeneratorPanel,150);
    return;
  }
  if(b.id==="generatorCloseV323"||b.id==="generatorClose"){
    e.preventDefault();e.stopPropagation();
    v323CloseModal("generatorPanel");
    return;
  }
  if(b.id==="firewallStartV322"){
    e.preventDefault();e.stopPropagation();
    startFirewallBullethellV322();
    return;
  }
  if(b.id==="firewallPayHack"){
    e.preventDefault();e.stopPropagation();
    payHackerV322();
    return;
  }
  if(b.id==="firewallCloseV322"){
    e.preventDefault();e.stopPropagation();
    v323CloseModal("firewallPanel");
    return;
  }
},true);


// VERSION 36 final UI bindings
document.addEventListener("click",e=>{
  const b=e.target.closest("button");
  if(!b)return;
  if(b.id==="generatorHit"){
    e.preventDefault(); e.stopPropagation();
    submitGeneratorHitV36();
  }
},true);
