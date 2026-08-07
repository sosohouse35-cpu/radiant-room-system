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
const ICON={beans:"🥫",water:"💧",soap:"🧼",tape:"🩹",trap:"🪤",spray:"🧯",medkit:"💊",battery:"🔋",flashlight:"🔦",mask:"😷",axe:"🪓",backpack:"🎒",blueprint:"📘",toolbox:"🧰",map:"🗺️",radio:"📻"};
let grids={},furn={},players={},items=[],me={},floor=1,bunker,defs={},keys=new Set(),near=null,ends=0,running=false,last=0,lastSend=0;
const roomsByFloor={
1:[{n:"주방",x:80,y:120,w:800,h:520},{n:"거실",x:920,y:120,w:720,h:520},{n:"1층 화장실",x:1680,y:120,w:600,h:520},{n:"차고",x:80,y:720,w:800,h:640},{n:"벙커/복도",x:920,y:720,w:1360,h:640}],
2:[{n:"침실",x:80,y:120,w:880,h:600},{n:"서재",x:1000,y:120,w:720,h:600},{n:"2층 화장실",x:1760,y:120,w:520,h:600},{n:"복도",x:80,y:800,w:2200,h:440}],
3:[{n:"다락방",x:120,y:160,w:2160,h:1040}]};
const stairs={1:{x:1480,y:760,w:150,h:130,to:2},2:{x:1480,y:760,w:150,h:130,to:3},3:{x:1480,y:1040,w:150,h:130,to:2}};
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
function wood(camX,camY,w,h){ctx.fillStyle="#d6ba8b";ctx.fillRect(0,0,w,h);for(let yy=Math.floor(camY/28)*28;yy<camY+h+28;yy+=28){let sy=yy-camY;ctx.strokeStyle="rgba(90,58,30,.24)";ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(w,sy);ctx.stroke();for(let xx=0;xx<W;xx+=180){let sx=xx-camX+((yy/28)%2?90:0);ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx,sy+28);ctx.stroke()}}}
function wallFill(camX,camY,w,h){let g=grids[floor];for(let r=Math.max(0,Math.floor(camY/T)-1);r<=Math.min(ROWS-1,Math.ceil((camY+h)/T)+1);r++)for(let c=Math.max(0,Math.floor(camX/T)-1);c<=Math.min(COLS-1,Math.ceil((camX+w)/T)+1);c++)if(g[r][c]){ctx.fillStyle="#6c5848";ctx.fillRect(c*T-camX,r*T-camY,T+1,T+1)}}
function outlines(camX,camY){ctx.strokeStyle="#080808";ctx.lineWidth=7;roomsByFloor[floor].forEach(r=>ctx.strokeRect(r.x-camX,r.y-camY,r.w,r.h))}
function drawStair(camX,camY){let s=stairs[floor],x=s.x-camX,y=s.y-camY;ctx.fillStyle="#8d755b";ctx.fillRect(x,y,s.w,s.h);ctx.strokeStyle="#111";ctx.lineWidth=4;ctx.strokeRect(x,y,s.w,s.h);ctx.strokeStyle="#e2cdb0";for(let i=1;i<6;i++){ctx.beginPath();ctx.moveTo(x+8,y+s.h*i/6);ctx.lineTo(x+s.w-8,y+s.h*i/6);ctx.stroke()}ctx.fillStyle="#fff";ctx.font="bold 13px sans-serif";ctx.fillText("계단 Q",x+12,y+18)}
function draw(){
 let w=innerWidth,h=innerHeight,camX=me.x+15-w/2,camY=me.y+15-h/2;ctx.clearRect(0,0,w,h);wood(camX,camY,w,h);wallFill(camX,camY,w,h);
 furn[floor].forEach(o=>{ctx.fillStyle=o.color;ctx.fillRect(o.x-camX,o.y-camY,o.w,o.h);ctx.strokeStyle="#49382a";ctx.lineWidth=2;ctx.strokeRect(o.x-camX,o.y-camY,o.w,o.h);ctx.fillStyle="#2a221b";ctx.font="12px sans-serif";ctx.fillText(o.label,o.x-camX+5,o.y-camY+16)});
 if(floor===1){ctx.strokeStyle="#6f8d3d";ctx.lineWidth=4;ctx.strokeRect(bunker.x-camX,bunker.y-camY,bunker.w,bunker.h)}
 drawStair(camX,camY);
 items.filter(i=>!i.taken&&i.floor===floor).forEach(i=>{ctx.font="27px sans-serif";ctx.fillText(ICON[i.type],i.x-camX,i.y-camY)});
 Object.values(players).forEach(p=>{if(p.id!==myId&&p.floor===floor){ctx.fillStyle=p.color;ctx.fillRect(p.x-camX,p.y-camY,P,P)}});
 let cur=currentRoom();roomsByFloor[floor].forEach(r=>{if(r!==cur){ctx.fillStyle="#000";ctx.fillRect(r.x-camX,r.y-camY,r.w,r.h)}});
 // 벽은 어두운 방에서도 보임
 wallFill(camX,camY,w,h);outlines(camX,camY);drawStair(camX,camY);
 ctx.fillStyle=me.color;ctx.fillRect(w/2-P/2,h/2-P/2,P,P);ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.strokeRect(w/2-P/2,h/2-P/2,P,P);
 $("floor").textContent=`${floor}층 · ${cur.n}`;
}
function renderSlots(){let a=[...document.querySelectorAll(".slot")];if(!a.length){$("slots").innerHTML='<div class="slot">✋</div>'.repeat(4);a=[...document.querySelectorAll(".slot")]}a.forEach(x=>{x.textContent="✋";x.style.background="#f0e4c9"});let k=0;(me.hands||[]).forEach(t=>{let n=defs[t].slots;for(let i=0;i<n&&k<4;i++,k++){a[k].textContent=i? "▪":ICON[t];a[k].style.background="#edf4c7"}});$("stored").textContent=me.stored?.length?`보관함: ${me.stored.map(t=>ICON[t]).join(" ")}`:"보관함 비어 있음"}
function findNear(){near=null;let d=999;items.forEach(i=>{if(i.taken||i.floor!==floor)return;let x=Math.hypot(me.x+15-i.x,me.y+15-i.y);if(x<75&&x<d){near=i;d=x}});$("prompt").classList.toggle("hidden",!near);if(near)$("prompt").textContent=`E · ${ICON[near.type]} 줍기 (${defs[near.type].slots}칸)`}
function pickup(){if(!near)return toast("가까이 가세요");ioClient.emit("take-item",near.id,r=>{if(!r.ok)toast(r.message)})}
function store(){ioClient.emit("deposit-items",r=>{if(!r.ok)return toast(r.message);me.hands=r.hands;me.stored=r.stored;renderSlots();toast("보관 완료")})}
function stair(){let s=stairs[floor],x=me.x+15,y=me.y+15;if(!(x>=s.x&&x<=s.x+s.w&&y>=s.y&&y<=s.y+s.h))return toast("계단 위에서 Q");floor=s.to;me.floor=floor;me.x=1500;me.y=floor===3?1010:900;toast(`${floor}층`)}
function loop(t){if(!running)return;let dt=Math.min((t-last)/1000,.05)||0;last=t;let x=(keys.has("d")||keys.has("arrowright")?1:0)-(keys.has("a")||keys.has("arrowleft")?1:0),y=(keys.has("s")||keys.has("arrowdown")?1:0)-(keys.has("w")||keys.has("arrowup")?1:0);if(x&&y){x*=.707;y*=.707}let nx=me.x+x*SPEED*dt,ny=me.y+y*SPEED*dt;if(!blocked(nx,me.y))me.x=nx;if(!blocked(me.x,ny))me.y=ny;findNear();if(t-lastSend>70){ioClient.emit("player-move",{x:me.x,y:me.y,floor});lastSend=t}$("timer").textContent=Math.max(0,Math.ceil((ends-Date.now())/1000));draw();requestAnimationFrame(loop)}
addEventListener("keydown",e=>{let k=e.key.toLowerCase();keys.add(k);if(k==="e")pickup();if(k==="f")store();if(k==="q")stair()});addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
document.querySelectorAll("[data-dir]").forEach(b=>{let k={up:"w",down:"s",left:"a",right:"d"}[b.dataset.dir];b.onpointerdown=e=>{e.preventDefault();keys.add(k)};b.onpointerup=b.onpointerleave=e=>{e?.preventDefault();keys.delete(k)}});
$("mPick").onclick=pickup;$("mStore").onclick=store;$("mStair").onclick=stair;$("full").onclick=async()=>{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen()};
ioClient.on("game-started",d=>{show("game");build();players={};d.players.forEach(p=>players[p.id]={...p});me={...players[myId],hands:[],stored:[]};floor=1;bunker=d.bunker;defs=d.itemDefs;items=d.items;ends=d.endsAt;renderSlots();running=true;last=performance.now();requestAnimationFrame(loop)});
ioClient.on("player-moved",d=>{if(players[d.id])Object.assign(players[d.id],d)});ioClient.on("item-taken",d=>{let i=items.find(x=>x.id===d.itemId);if(i)i.taken=true;if(d.playerId===myId){me.hands=d.hands;renderSlots()}});ioClient.on("items-deposited",d=>{if(d.playerId===myId){me.hands=d.hands;me.stored=d.stored;renderSlots()}});
