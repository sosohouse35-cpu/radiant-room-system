"use strict";
const ioClient=io(),$=id=>document.getElementById(id);
let room=null,myId=null;
const show=id=>["home","lobby","game"].forEach(x=>$(x).classList.toggle("active",x===id));
function toast(t){$("toast").textContent=t;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),1800)}
$("new").onclick=()=>$("dlg").showModal();
$("form").onsubmit=e=>{e.preventDefault();ioClient.emit("create-room",{nickname:$("nick").value,roomName:$("title").value,maxPlayers:$("max").value},joined)};
$("join").onclick=()=>ioClient.emit("join-room",{nickname:$("nick").value,code:$("code").value.toUpperCase()},joined);
function joined(r){if(!r.ok)return toast(r.message);room=r.room;myId=r.myId;renderLobby();show("lobby");$("dlg").close()}
function renderLobby(){if(!room)return;$("roomName").textContent=room.name;$("roomCode").textContent=room.code;$("players").innerHTML=room.players.map(p=>`<div>${p.nickname}${p.id===room.hostId?" (방장)":""} ${p.ready?"✓":""}</div>`).join("");$("start").style.display=myId===room.hostId?"inline-block":"none";$("ready").style.display=myId===room.hostId?"none":"inline-block"}
$("ready").onclick=()=>ioClient.emit("toggle-ready",r=>{if(!r.ok)toast("변경 실패")});
$("start").onclick=()=>ioClient.emit("start-game",r=>{if(!r.ok)toast(r.message)});
ioClient.on("room-list",rs=>$("rooms").innerHTML=rs.map(r=>`<div><button data-c="${r.code}">${r.name} (${r.playerCount}/${r.maxPlayers})</button></div>`).join(""));
$("rooms").onclick=e=>{if(e.target.dataset.c)ioClient.emit("join-room",{nickname:$("nick").value,code:e.target.dataset.c},joined)};
ioClient.on("room-updated",r=>{room=r;renderLobby()});ioClient.on("connect",()=>{$("status").textContent="연결됨"});

const canvas=$("canvas"),ctx=canvas.getContext("2d");
const W=2400,H=1600,T=40,P=30,SPEED=235,COLS=W/T,ROWS=H/T;
const ICON={beans:"🥫",water:"💧",soap:"🧼",tape:"🩹",trap:"🪤",spray:"🧴",medkit:"💊",battery:"🔋",flashlight:"🔦",mask:"😷",axe:"🪓",backpack:"🎒",blueprint:"📘",toolbox:"🧰",map:"🗺️",radio:"📻"};
const ITEM_NAME={beans:"통조림",water:"물",soap:"비누",tape:"테이프",trap:"덫",spray:"살충제",medkit:"메디킷",battery:"배터리",flashlight:"손전등",mask:"방독면",axe:"도끼",backpack:"가방",blueprint:"블루프린트",toolbox:"공구함",map:"지도",radio:"라디오"};
let grids={},furn={},players={},items=[],me={},floor=1,bunker,defs={},keys=new Set(),near=null,ends=0,running=false,last=0,lastSend=0;
let day=1,sanity=0,bounty=0,bountyLevel=1,bunkerStock={},weapons={},power=100,securityState="LOCKED";
let hp=100,hunger=100,thirst=100;
let bunkerPlayer={x:265,y:515};
let bunkerKeys=new Set();
let bunkerRunning=false;
let bunkerNear=null;
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
function resize(){const d=devicePixelRatio||1;canvas.width=innerWidth*d;canvas.height=innerHeight*d;ctx.setTransform(d,0,0,d,0,0)}addEventListener("resize",resize);resize();
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
  const w=innerWidth;
  const h=innerHeight;
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

function renderSlots(){let a=[...document.querySelectorAll(".slot")];if(!a.length){$("slots").innerHTML='<div class="slot">✋</div>'.repeat(4);a=[...document.querySelectorAll(".slot")]}a.forEach(x=>{x.textContent="✋";x.style.background="#f0e4c9"});let k=0;(me.hands||[]).forEach(t=>{let n=defs[t].slots;for(let i=0;i<n&&k<4;i++,k++){a[k].textContent=i? "▪":ICON[t];a[k].style.background="#edf4c7"}});$("stored").textContent=me.stored?.length?`보관함: ${me.stored.map(t=>ICON[t]).join(" ")}`:"보관함 비어 있음"}
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
$("mPick").onclick=pickup;$("mStore").onclick=store;$("mStair").onclick=stair;$("full").onclick=async()=>{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen()};

function updateStatusUI(){
  $("dayLabel").textContent=`DAY ${day}`;
  $("bunkerDay").textContent=`DAY ${day}`;
  $("hpValue").textContent=`${hp} / 100`;
  $("sanityValue").textContent=`${sanity} SP`;
  $("hungerValue").textContent=`${Math.round(hunger)}%`;
  $("thirstValue").textContent=`${Math.round(thirst)}%`;
  $("statusDay").textContent=day;

  let condition="안정";
  if(hp<=0)condition="사망";
  else if(hp<35)condition="위험";
  else if(hunger<30)condition="배고픔";
  else if(thirst<30)condition="목마름";

  $("conditionValue").textContent=condition;
}

$("bookButton").onclick=()=>{
  $("statusPanel").classList.toggle("hidden");
  updateStatusUI();
};

const BUNKER_OBJECTS = [
  {id:"weapons",label:"무기 보관함",x:150,y:90,w:70,h:120},
  {id:"bed",label:"침대",x:150,y:220,w:150,h:85},
  {id:"computer",label:"컴퓨터",x:150,y:315,w:105,h:55},
  {id:"beans",label:"통조림",x:150,y:380,w:110,h:75},
  {id:"medkit",label:"메디킷",x:360,y:500,w:120,h:50},
  {id:"blueprints",label:"블루프린트",x:485,y:500,w:145,h:50},
  {id:"shower",label:"샤워실",x:620,y:90,w:170,h:240},
  {id:"power",label:"전력 공급",x:690,y:335,w:100,h:70},
  {id:"water",label:"물",x:730,y:440,w:60,h:120},
  {id:"vent",label:"환풍구",x:675,y:580,w:115,h:34},
  {id:"stairs",label:"계단",x:250,y:565,w:380,h:85}
];

function resizeBunkerCanvas(){
  const c=$("bunkerCanvas");
  const dpr=devicePixelRatio||1;
  c.width=innerWidth*dpr;
  c.height=innerHeight*dpr;
  c.getContext("2d").setTransform(dpr,0,0,dpr,0,0);
}
addEventListener("resize",resizeBunkerCanvas);

function drawBunkerInterior(){
  if(!bunkerRunning)return;

  const c=$("bunkerCanvas");
  const bctx=c.getContext("2d");
  const vw=innerWidth,vh=innerHeight;

  const worldW=940,worldH=720;
  const camX=bunkerPlayer.x-vw/2;
  const camY=bunkerPlayer.y-vh/2;

  bctx.fillStyle="#b9ad96";
  bctx.fillRect(0,0,vw,vh);

  // concrete floor grid
  bctx.strokeStyle="rgba(70,62,52,.13)";
  bctx.lineWidth=1;
  for(let x=-camX%60;x<vw;x+=60){
    bctx.beginPath();bctx.moveTo(x,0);bctx.lineTo(x,vh);bctx.stroke();
  }
  for(let y=-camY%60;y<vh;y+=60){
    bctx.beginPath();bctx.moveTo(0,y);bctx.lineTo(vw,y);bctx.stroke();
  }

  // outer bunker
  bctx.fillStyle="#d1c6af";
  bctx.fillRect(120-camX,60-camY,700,590);
  bctx.strokeStyle="#171411";
  bctx.lineWidth=7;
  bctx.strokeRect(120-camX,60-camY,700,590);

  // internal structures
  BUNKER_OBJECTS.forEach(o=>{
    bctx.fillStyle=
      o.id==="shower"?"#b8cad0":
      o.id==="power"?"#8d8d77":
      o.id==="stairs"?"#88725b":
      "#9c8465";

    bctx.fillRect(o.x-camX,o.y-camY,o.w,o.h);
    bctx.strokeStyle="#211a15";
    bctx.lineWidth=3;
    bctx.strokeRect(o.x-camX,o.y-camY,o.w,o.h);
    bctx.fillStyle="#211a15";
    bctx.font="bold 13px Malgun Gothic";
    bctx.fillText(o.label,o.x-camX+7,o.y-camY+19);
  });

  // stairs lines
  const st=BUNKER_OBJECTS.find(o=>o.id==="stairs");
  bctx.strokeStyle="#d8c7a9";
  for(let i=1;i<7;i++){
    const yy=st.y-camY+(st.h/7)*i;
    bctx.beginPath();
    bctx.moveTo(st.x-camX+8,yy);
    bctx.lineTo(st.x-camX+st.w-8,yy);
    bctx.stroke();
  }

  // player
  bctx.fillStyle=me.color||"#fff";
  bctx.fillRect(vw/2-15,vh/2-15,30,30);
  bctx.strokeStyle="#fff";
  bctx.lineWidth=2;
  bctx.strokeRect(vw/2-15,vh/2-15,30,30);

  requestAnimationFrame(drawBunkerInterior);
}

function bunkerNearestObject(){
  let result=null,best=90;
  for(const o of BUNKER_OBJECTS){
    const cx=o.x+o.w/2,cy=o.y+o.h/2;
    const d=Math.hypot(bunkerPlayer.x-cx,bunkerPlayer.y-cy);
    if(d<best){best=d;result=o}
  }
  bunkerNear=result;
  $("bunkerPrompt").classList.toggle("hidden",!result);
  if(result)$("bunkerPrompt").textContent=`E · ${result.label} 사용`;
}

function bunkerMoveLoop(){
  if(!bunkerRunning)return;
  let dx=(bunkerKeys.has("d")?1:0)-(bunkerKeys.has("a")?1:0);
  let dy=(bunkerKeys.has("s")?1:0)-(bunkerKeys.has("w")?1:0);

  if(Math.abs(joystickX)>.03||Math.abs(joystickY)>.03){
    dx=joystickX;dy=joystickY;
  }else if(dx&&dy){dx*=.707;dy*=.707}

  bunkerPlayer.x=Math.max(145,Math.min(795,bunkerPlayer.x+dx*3.2));
  bunkerPlayer.y=Math.max(85,Math.min(625,bunkerPlayer.y+dy*3.2));
  bunkerNearestObject();
  requestAnimationFrame(bunkerMoveLoop);
}

function openWeaponStorage(){
  const names={axe:"🪓 도끼"};
  const entries=Object.entries(weapons||{}).filter(([,count])=>count>0);

  $("weaponList").innerHTML=
    entries.length
      ? entries.map(([type,count])=>`<div>${names[type]||type} × ${count}</div>`).join("")
      : "<div>현재 보관된 무기가 없습니다.</div>";

  $("weaponPanel").classList.remove("hidden");
}

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

function interactBunker(){
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
    toast(`통조림 ${bunkerStock.beans||0}개`);
    return;
  }

  if(bunkerNear.id==="water"){
    toast(`물 ${bunkerStock.water||0}개`);
    return;
  }

  if(bunkerNear.id==="medkit"){
    toast(`메디킷 ${bunkerStock.medkit||0}개`);
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

  toast(`${bunkerNear.label}`);
}

addEventListener("keydown",e=>{
  if(!bunkerRunning)return;
  const k=e.key.toLowerCase();
  bunkerKeys.add(k);
  if(k==="e")interactBunker();
});
addEventListener("keyup",e=>{
  if(bunkerRunning)bunkerKeys.delete(e.key.toLowerCase());
});

function enterBunkerScene(){
  $("bunkerUI").classList.remove("hidden");
  $("fadeOverlay").classList.remove("hidden");
  resizeBunkerCanvas();

  // 카메라는 벙커 계단 위에서 시작
  bunkerPlayer.x=280;
  bunkerPlayer.y=595;
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
  updateStatusUI();
});
ioClient.on("game-started",d=>{show("game");build();players={};d.players.forEach(p=>players[p.id]={...p});me={...players[myId],hands:[],stored:[]};floor=1;bunker=d.bunker;defs=d.itemDefs;items=d.items;ends=d.endsAt;
day=d.day||1;sanity=d.sanity||0;bounty=d.bounty||0;bountyLevel=d.bountyLevel||1;bunkerStock=d.bunkerStock||{};weapons=d.weapons||{};power=d.power??100;securityState=d.security||"LOCKED";
updateStatusUI();$("timer").textContent="60";renderSlots();running=true;last=performance.now();requestAnimationFrame(loop)});
ioClient.on("player-moved",d=>{if(players[d.id])Object.assign(players[d.id],d)});ioClient.on("item-taken",d=>{let i=items.find(x=>x.id===d.itemId);if(i)i.taken=true;if(d.playerId===myId){me.hands=d.hands;renderSlots()}});ioClient.on("items-deposited",d=>{if(d.playerId===myId){me.hands=d.hands;me.stored=d.stored;renderSlots()}});
