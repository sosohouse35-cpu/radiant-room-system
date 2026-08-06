"use strict";
const socket=io();
const $=id=>document.getElementById(id);
const screens={home:$("homeScreen"),lobby:$("lobbyScreen"),game:$("gameScreen")};
let currentRoom=null,myId=null,toastTimer=null;
function showScreen(n){Object.entries(screens).forEach(([k,v])=>v.classList.toggle("active",k===n))}
function toast(m){$("toast").textContent=m;$("toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),2200)}
function nickname(){const v=$("nickname").value.trim();if(v)localStorage.setItem("nick",v);return v}
$("nickname").value=localStorage.getItem("nick")||"";

function joinResult(r){if(!r?.ok)return toast(r?.message||"실패");currentRoom=r.room;myId=r.myId;renderLobby();showScreen("lobby");$("createDialog").close()}
function renderRooms(rooms){$("roomList").innerHTML="";if(!rooms.length){$("roomList").innerHTML="<p>공개방이 없습니다.</p>";return}
 rooms.forEach(r=>{const d=document.createElement("div");d.className="room-card";d.innerHTML=`<span>${r.name} (${r.playerCount}/${r.maxPlayers})</span>`;const b=document.createElement("button");b.textContent="참가";b.onclick=()=>socket.emit("join-room",{nickname:nickname(),code:r.code},joinResult);d.append(b);$("roomList").append(d)})}
function renderLobby(){if(!currentRoom)return;$("lobbyName").textContent=currentRoom.name;$("copyCodeButton").textContent=currentRoom.code;$("playerList").innerHTML="";
 currentRoom.players.forEach(p=>{const d=document.createElement("div");d.className="player-card";d.innerHTML=`<span><i style="display:inline-block;width:14px;height:14px;background:${p.color};margin-right:8px"></i>${p.nickname}${p.id===currentRoom.hostId?" (방장)":""}</span><b>${p.ready?"준비":"대기"}</b>`;$("playerList").append(d)});
 const host=myId===currentRoom.hostId;$("readyButton").classList.toggle("hidden",host);$("startButton").classList.toggle("hidden",!host)}
$("openCreateButton").onclick=()=>nickname()?$("createDialog").showModal():toast("닉네임 입력");
$("closeCreateButton").onclick=()=>$("createDialog").close();
$("createForm").onsubmit=e=>{e.preventDefault();socket.emit("create-room",{nickname:nickname(),roomName:$("roomName").value,maxPlayers:$("maxPlayers").value,private:$("privateRoom").checked},joinResult)};
$("joinCodeButton").onclick=()=>socket.emit("join-room",{nickname:nickname(),code:$("roomCodeInput").value.toUpperCase()},joinResult);
$("quickJoinButton").onclick=()=>socket.emit("quick-join",{nickname:nickname()},joinResult);
$("refreshButton").onclick=()=>socket.emit("get-room-list");
$("readyButton").onclick=()=>socket.emit("toggle-ready",r=>{if(!r.ok)toast(r.message)});
$("startButton").onclick=()=>socket.emit("start-game",r=>{if(!r.ok)toast(r.message)});
$("leaveButton").onclick=()=>socket.emit("leave-room",()=>location.reload());
$("copyCodeButton").onclick=()=>navigator.clipboard?.writeText(currentRoom.code);
socket.on("connect",()=>{$("connectionDot").classList.add("online");$("connectionText").textContent="연결됨"});
socket.on("room-list",renderRooms);socket.on("room-updated",r=>{currentRoom=r;renderLobby()});

/* GAME */
const canvas=$("gameCanvas"),ctx=canvas.getContext("2d");
const WORLD_W=2400,WORLD_H=1600,TILE=40,PLAYER=30,SPEED=230,VISION=330;
let players={},items=[],me={x:1200,y:800,color:"#fff",inventory:[]},keys=new Set(),running=false,last=0,endsAt=0,lastSend=0;

/* 0=floor, 1=wall. Original independent house layout: living room, kitchen,
   dining room, garage, study, hallway, two bedrooms, bathrooms and attic zone. */
const COLS=WORLD_W/TILE,ROWS=WORLD_H/TILE;
const grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));

function seededRandom(seed){
  let value=(Number(seed)||1)>>>0;
  return function(){
    value=(value*1664525+1013904223)>>>0;
    return value/4294967296;
  };
}

function clearMap(){
  for(let r=0;r<ROWS;r++) grid[r].fill(0);
}

function wallRect(x,y,w,h){
  for(let r=y;r<y+h;r++){
    for(let c=x;c<x+w;c++){
      if(r>=0&&r<ROWS&&c>=0&&c<COLS) grid[r][c]=1;
    }
  }
}

function door(x,y,w=1,h=1){
  for(let r=y;r<y+h;r++){
    for(let c=x;c<x+w;c++){
      if(grid[r]) grid[r][c]=0;
    }
  }
}

function furnitureRect(x,y,w,h){
  wallRect(x,y,w,h);
}

/*
  매 게임마다 같은 방 안의 모든 플레이어가 같은 seed를 받습니다.
  집의 외곽과 주요 방 위치는 유지하되 아래 요소가 무작위로 변합니다.

  - 방 사이 문 위치
  - 가구 위치와 방향
  - 일부 방의 내부 칸막이
  - 중앙 복도의 장애물
  - 좌우 방의 세부 배치

  통로가 완전히 막히지 않도록 방 출입구와 중앙 복도는 항상 남겨 둡니다.
*/
function buildMap(seed=1){
  clearMap();
  const random=seededRandom(seed);
  const pick=list=>list[Math.floor(random()*list.length)];

  // 외벽
  wallRect(0,0,COLS,1);
  wallRect(0,ROWS-1,COLS,1);
  wallRect(0,0,1,ROWS);
  wallRect(COLS-1,0,1,ROWS);

  // 큰 주택의 기본 방 구조
  wallRect(2,3,25,1); wallRect(2,3,1,14); wallRect(26,3,1,14); wallRect(2,16,25,1);
  wallRect(27,3,14,1); wallRect(40,3,1,14); wallRect(27,16,14,1);
  wallRect(41,3,16,1); wallRect(56,3,1,14); wallRect(41,16,16,1);
  wallRect(2,17,18,1); wallRect(2,17,1,18); wallRect(19,17,1,18); wallRect(2,34,18,1);
  wallRect(20,17,21,1); wallRect(40,17,1,18); wallRect(20,34,21,1);
  wallRect(41,17,16,1); wallRect(56,17,1,18); wallRect(41,34,16,1);

  // 위쪽 방 칸막이는 게임마다 조금 달라짐
  const upperDividers=[
    [8,15,33,48],
    [9,16,32,47],
    [7,14,34,49]
  ];
  const dividers=pick(upperDividers);
  wallRect(dividers[0],3,1,13);
  wallRect(dividers[1],3,1,13);
  wallRect(dividers[2],3,1,13);
  wallRect(dividers[3],3,1,13);

  // 주요 출입문: 후보 위치 중 무작위
  door(pick([4,5,6]),16,2);
  door(pick([21,22,23]),16,2);
  door(pick([34,35,36]),16,2);
  door(pick([49,50,51]),16,2);
  door(19,pick([22,24,27]),1,3);
  door(40,pick([22,24,27]),1,3);

  // 위쪽 내부 출입문
  door(dividers[0],pick([7,9,11]),1,2);
  door(dividers[1],pick([8,10,12]),1,2);
  door(dividers[2],pick([7,10,12]),1,2);
  door(dividers[3],pick([8,10,12]),1,2);

  // 가구 후보군. 각 방마다 한 배치를 골라 생성
  const roomFurniture=[
    [
      [[4,6,4,2],[17,6,5,2],[28,7,3,4],[43,6,5,2]],
      [[5,10,5,2],[18,5,3,4],[29,11,5,2],[45,7,3,4]],
      [[4,7,3,5],[17,11,5,2],[29,5,5,2],[44,11,5,2]]
    ],
    [
      [[5,21,5,2],[12,28,4,3],[25,21,7,2],[47,23,5,4]],
      [[4,27,4,3],[11,21,6,2],[27,27,5,3],[47,20,6,2]],
      [[5,22,3,5],[12,30,5,2],[24,22,4,4],[49,27,4,3]]
    ]
  ];

  pick(roomFurniture[0]).forEach(f=>furnitureRect(...f));
  pick(roomFurniture[1]).forEach(f=>furnitureRect(...f));

  // 중앙 복도에는 작은 장애물이 0~2개 생성
  const corridorOptions=[
    [],
    [[31,19,2,2]],
    [[29,29,3,2]],
    [[24,19,2,2],[35,30,2,2]]
  ];
  pick(corridorOptions).forEach(f=>furnitureRect(...f));

  // 일부 방에 짧은 칸막이를 추가하되 출입구는 남김
  if(random()<0.55){
    wallRect(43,29,7,1);
    door(pick([45,47,49]),29,1,1);
  }
  if(random()<0.55){
    wallRect(4,26,7,1);
    door(pick([6,8,10]),26,1,1);
  }

  // 시작 지점 주변과 주요 복도는 항상 비워 둠
  const safeZones=[
    [27,17,13,17],
    [26,15,16,4],
    [27,18,4,4]
  ];
  safeZones.forEach(([x,y,w,h])=>door(x,y,w,h));
}
buildMap(1);

const ITEM_ICONS={beans:"🥫",water:"💧",soap:"🧼",tape:"🩹",trap:"🪤",spray:"🧯",medkit:"💊",battery:"🔋",toolbox:"🧰",backpack:"🎒",blueprint:"📘",flashlight:"🔦",mask:"😷",map:"🗺️",radio:"📻"};
function resize(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}
addEventListener("resize",resize);resize();
function blocked(x,y){
 const points=[[x,y],[x+PLAYER,y],[x,y+PLAYER],[x+PLAYER,y+PLAYER]];
 return points.some(([px,py])=>grid[Math.floor(py/TILE)]?.[Math.floor(px/TILE)]===1)
}
addEventListener("keydown",e=>keys.add(e.key.toLowerCase()));addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
document.querySelectorAll("[data-dir]").forEach(b=>{const k={up:"w",down:"s",left:"a",right:"d"}[b.dataset.dir];b.onpointerdown=()=>keys.add(k);b.onpointerup=b.onpointerleave=()=>keys.delete(k)});

function visibleCell(cx,cy,tx,ty){
 let x0=cx,y0=cy,x1=tx,y1=ty,dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1,err=dx+dy;
 while(true){if(!(x0===cx&&y0===cy)&&grid[y0]?.[x0]===1)return x0===tx&&y0===ty;if(x0===x1&&y0===y1)return true;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx}if(e2<=dx){err+=dx;y0+=sy}}
}
function draw(){
 const vw=innerWidth,vh=innerHeight,cx=me.x+PLAYER/2,cy=me.y+PLAYER/2;
 const camX=Math.max(0,Math.min(WORLD_W-vw,cx-vw/2)),camY=Math.max(0,Math.min(WORLD_H-vh,cy-vh/2));
 ctx.clearRect(0,0,vw,vh);ctx.fillStyle="#161a14";ctx.fillRect(0,0,vw,vh);
 const minC=Math.max(0,Math.floor(camX/TILE)-1),maxC=Math.min(COLS-1,Math.ceil((camX+vw)/TILE)+1);
 const minR=Math.max(0,Math.floor(camY/TILE)-1),maxR=Math.min(ROWS-1,Math.ceil((camY+vh)/TILE)+1);
 const pc=Math.floor(cx/TILE),pr=Math.floor(cy/TILE);
 for(let r=minR;r<=maxR;r++)for(let c=minC;c<=maxC;c++){
   const x=c*TILE-camX,y=r*TILE-camY,dist=Math.hypot((c+.5)*TILE-cx,(r+.5)*TILE-cy);
   const vis=dist<VISION && visibleCell(pc,pr,c,r);
   if(!vis){ctx.fillStyle="#020302";ctx.fillRect(x,y,TILE+1,TILE+1);continue}
   if(grid[r][c]){ctx.fillStyle="#4a4438";ctx.fillRect(x,y,TILE,TILE);ctx.strokeStyle="#6a6253";ctx.strokeRect(x,y,TILE,TILE)}
   else{ctx.fillStyle=(r+c)%2?"#262b22":"#23281f";ctx.fillRect(x,y,TILE,TILE)}
 }
 items.filter(i=>!i.taken).forEach(i=>{const c=Math.floor(i.x/TILE),r=Math.floor(i.y/TILE);if(Math.hypot(i.x-cx,i.y-cy)<VISION&&visibleCell(pc,pr,c,r)){ctx.font="25px sans-serif";ctx.fillText(ITEM_ICONS[i.type]||"?",i.x-camX,i.y-camY)}})
 Object.values(players).forEach(p=>{if(p.id===myId)return;const c=Math.floor(p.x/TILE),r=Math.floor(p.y/TILE);if(Math.hypot(p.x-cx,p.y-cy)<VISION&&visibleCell(pc,pr,c,r)){ctx.fillStyle=p.color;ctx.fillRect(p.x-camX,p.y-camY,PLAYER,PLAYER);ctx.fillStyle="#fff";ctx.font="12px sans-serif";ctx.fillText(p.nickname,p.x-camX-4,p.y-camY-6)}})
 /* local player always centered except world edges */
 ctx.fillStyle=me.color;ctx.fillRect(me.x-camX,me.y-camY,PLAYER,PLAYER);ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.strokeRect(me.x-camX,me.y-camY,PLAYER,PLAYER);
 /* darkness vignette */
 const g=ctx.createRadialGradient(vw/2,vh/2,100,vw/2,vh/2,VISION);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(.72,"rgba(0,0,0,.2)");g.addColorStop(1,"rgba(0,0,0,.92)");ctx.fillStyle=g;ctx.fillRect(0,0,vw,vh);
}
function update(t){
 if(!running)return;const dt=Math.min((t-last)/1000,.05)||0;last=t;
 let dx=(keys.has("d")||keys.has("arrowright")?1:0)-(keys.has("a")||keys.has("arrowleft")?1:0),dy=(keys.has("s")||keys.has("arrowdown")?1:0)-(keys.has("w")||keys.has("arrowup")?1:0);
 if(dx&&dy){dx*=.7071;dy*=.7071}
 const nx=me.x+dx*SPEED*dt,ny=me.y+dy*SPEED*dt;if(!blocked(nx,me.y))me.x=nx;if(!blocked(me.x,ny))me.y=ny;
 items.forEach(i=>{if(!i.taken&&Math.hypot((me.x+PLAYER/2)-i.x,(me.y+PLAYER/2)-i.y)<45)socket.emit("take-item",i.id)});
 if(t-lastSend>60){socket.emit("player-move",{x:me.x,y:me.y});lastSend=t}
 $("timer").textContent=Math.max(0,Math.ceil((endsAt-Date.now())/1000));
 draw();requestAnimationFrame(update)
}
socket.on("game-started",data=>{
 showScreen("game");
 buildMap(data.mapSeed || 1);
 players={};
 data.players.forEach(p=>players[p.id]={...p});
 me={...players[myId]};
 items=data.items;
 endsAt=data.endsAt;
 let n=5;$("countdown").textContent=n;$("countdownOverlay").classList.remove("hidden");
 const h=setInterval(()=>{n--;$("countdown").textContent=n>0?n:"GO";if(n<0){clearInterval(h);$("countdownOverlay").classList.add("hidden");running=true;last=performance.now();requestAnimationFrame(update)}},1000)
});
socket.on("player-moved",d=>{if(players[d.id]){players[d.id].x=d.x;players[d.id].y=d.y}});
socket.on("item-taken",d=>{const i=items.find(x=>x.id===d.itemId);if(i)i.taken=true;if(d.playerId===myId){me.inventory.push(d.type);$("inventory").textContent="가방: "+me.inventory.map(x=>ITEM_ICONS[x]).join(" ")}});
