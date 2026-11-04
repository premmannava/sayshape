/**
 * A correct answer to every benchmark task in both formats. The tests check
 * that each one passes every check, which shows the checks are fair to both
 * formats: a check either can't fail a working answer, or the task is wrong.
 */

const HOSTILE = `<img src=x onerror=alert(1)>`;

export const reference: Record<string, { sayshape: string; html: string }> = {
  k1: {
    sayshape: `grid min=140 gap=12
  stat label="Revenue" value="$1.24M" change="+12%"
  stat label="Active users" value="48,210" change="+5.4%"
  stat label="Churn" value="2.1%" change="-0.4 pts" good=down`,
    html: `<div class="g"><div><p>Revenue</p><b>$1.24M</b><small class="up">▲ 12%</small></div><div><p>Active users</p><b>48,210</b><small class="up">▲ 5.4%</small></div><div><p>Churn</p><b>2.1%</b><small class="up">▼ 0.4 pts</small></div></div>
<style>.g{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.up{color:green}</style>`,
  },
  k2: {
    sayshape: `state visits=[1200, 1350, 1280, 1500, 1620, 1580, 1710]
stat label="Visits today" value="{number(last(visits))}" change="+{round((last(visits) - first(visits)) / first(visits) * 100, 1)}%" spark=visits`,
    html: `<p>Visits today</p><h2 id="v"></h2><span id="c"></span><svg id="s" width="140" height="30"></svg>
<script>const v=[1200,1350,1280,1500,1620,1580,1710];document.getElementById('v').textContent=v[6].toLocaleString('en-US');
document.getElementById('c').textContent='+'+((v[6]-v[0])/v[0]*100).toFixed(1)+'%';
const p=document.createElementNS('http://www.w3.org/2000/svg','polyline');p.setAttribute('points',v.map((x,i)=>i*20+','+(30-(x-1200)/20)).join(' '));p.setAttribute('fill','none');p.setAttribute('stroke','currentColor');document.getElementById('s').appendChild(p);</script>`,
  },
  k3: {
    sayshape: `state spent=7400 budget=10000
card
  text "Budget" style=title
  progress value={spent} max={budget} label="{round(spent / budget * 100)}% used"
  text "{money(budget - spent)} remaining"`,
    html: `<p><span id="p"></span> used</p><div style="background:#ddd;height:8px"><div id="b" style="height:8px;background:#36c"></div></div><p id="r"></p>
<script>const s=7400,b=10000;document.getElementById('p').textContent=Math.round(s/b*100)+'%';document.getElementById('b').style.width=s/b*100+'%';document.getElementById('r').textContent='$'+(b-s).toLocaleString('en-US')+' remaining';</script>`,
  },
  k4: {
    sayshape: `grid min=140 gap=12
  stat label="Orders" value="320" change="+10.3%"
  stat label="Avg order value" value="$58" change="-4.9%"
  stat label="Refunds" value="12" change="-33.3%" good=down`,
    html: `<div><p>Orders</p><b>320</b> <small>+10.3% vs 290</small></div><div><p>Avg order value</p><b>$58</b> <small>-4.9% vs $61</small></div><div><p>Refunds</p><b>12</b> <small style="color:green">-33.3% vs 18</small></div>`,
  },
  c1: {
    sayshape: `state sales=[{region: "NA", k: 420}, {region: "EU", k: 310}, {region: "APAC", k: 280}, {region: "LATAM", k: 120}]
chart "Sales by region ($K)" kind=bar items=sales x=region y=k`,
    html: `<canvas id="c"></canvas><script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>new Chart(document.getElementById('c'),{type:'bar',data:{labels:['NA','EU','APAC','LATAM'],datasets:[{label:'Sales ($K)',data:[420,310,280,120]}]}});</script>`,
  },
  c2: {
    sayshape: `state rev=[{m: "Jan", a: 12, b: 10}, {m: "Feb", a: 18, b: 14}, {m: "Mar", a: 15, b: 16}, {m: "Apr", a: 21, b: 17}, {m: "May", a: 24, b: 19}, {m: "Jun", a: 22, b: 20}]
chart "Revenue ($K)" kind=line items=rev x=m y=a,b labels="This year,Last year"`,
    html: `<canvas id="c"></canvas><script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>new Chart(document.getElementById('c'),{type:'line',data:{labels:['Jan','Feb','Mar','Apr','May','Jun'],datasets:[{label:'This year',data:[12,18,15,21,24,22]},{label:'Last year',data:[10,14,16,17,19,20]}]}});</script>`,
  },
  c3: {
    sayshape: `state src=[{name: "Search", pct: 46}, {name: "Direct", pct: 28}, {name: "Social", pct: 16}, {name: "Email", pct: 10}]
chart "Traffic sources (%)" kind=donut items=src x=name y=pct format=number`,
    html: `<canvas id="c"></canvas><script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>new Chart(document.getElementById('c'),{type:'doughnut',data:{labels:['Search 46%','Direct 28%','Social 16%','Email 10%'],datasets:[{data:[46,28,16,10]}]}});</script>`,
  },
  c4: {
    sayshape: `state products=[{name: "Lamp", units: 120}, {name: "Desk", units: 340}, {name: "Chair", units: 410}, {name: "Shelf", units: 95}, {name: "Rug", units: 210}, {name: "Mirror", units: 180}, {name: "Sofa", units: 60}, {name: "Stool", units: 150}]
derive top={take(sort(products, 'units', 'desc'), 5)}
chart "Top 5 products by units" kind=hbar items=top x=name y=units`,
    html: `<canvas id="c"></canvas><script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>const p=[['Lamp',120],['Desk',340],['Chair',410],['Shelf',95],['Rug',210],['Mirror',180],['Sofa',60],['Stool',150]].sort((a,b)=>b[1]-a[1]).slice(0,5);
new Chart(document.getElementById('c'),{type:'bar',data:{labels:p.map(x=>x[0]),datasets:[{label:'Units',data:p.map(x=>x[1])}]},options:{indexAxis:'y'}});</script>`,
  },
  c5: {
    sayshape: `state view="Week" week=[{d: "Mon", n: 30}, {d: "Tue", n: 42}, {d: "Wed", n: 38}, {d: "Thu", n: 51}, {d: "Fri", n: 47}, {d: "Sat", n: 22}, {d: "Sun", n: 18}] month=[{d: "Week 1", n: 210}, {d: "Week 2", n: 245}, {d: "Week 3", n: 230}, {d: "Week 4", n: 268}]
card
  segmented bind=view options="Week,Month"
  if={view == 'Week'}
    chart "Signups this week" kind=bar items=week x=d y=n
  if={view == 'Month'}
    chart "Signups this month" kind=bar items=month x=d y=n`,
    html: `<button id="w">Week</button><button id="m">Month</button><canvas id="c"></canvas><script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>const D={w:[['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],[30,42,38,51,47,22,18]],m:[['Week 1','Week 2','Week 3','Week 4'],[210,245,230,268]]};
const ch=new Chart(document.getElementById('c'),{type:'bar',data:{labels:D.w[0],datasets:[{label:'Signups',data:D.w[1]}]}});
function show(k){ch.data.labels=D[k][0];ch.data.datasets[0].data=D[k][1];ch.update();}
document.getElementById('w').onclick=()=>show('w');document.getElementById('m').onclick=()=>show('m');</script>`,
  },
  t1: {
    sayshape: `state people=[{name: "Ana", team: "Design", joined: 2019, rating: 4.8}, {name: "Ben", team: "Engineering", joined: 2021, rating: 4.2}, {name: "Chen", team: "Engineering", joined: 2018, rating: 4.9}, {name: "Dee", team: "Sales", joined: 2022, rating: 3.9}, {name: "Eli", team: "Design", joined: 2020, rating: 4.5}, {name: "Fay", team: "Sales", joined: 2017, rating: 4.6}] by="name" dir="asc"
table items=people sort=by direction=dir
  table-column "Name" field=name
  table-column "Team" field=team
  table-column "Joined" field=joined format=text
  table-column "Rating" field=rating format=number`,
    html: `<table><thead><tr><th data-k="name">Name</th><th data-k="team">Team</th><th data-k="joined">Joined</th><th data-k="rating">Rating</th></tr></thead><tbody></tbody></table>
<script>const P=[['Ana','Design',2019,4.8],['Ben','Engineering',2021,4.2],['Chen','Engineering',2018,4.9],['Dee','Sales',2022,3.9],['Eli','Design',2020,4.5],['Fay','Sales',2017,4.6]].map(([name,team,joined,rating])=>({name,team,joined,rating}));
let key='name',dir=1;const tb=document.querySelector('tbody');
function draw(){tb.replaceChildren(...[...P].sort((a,b)=>(a[key]>b[key]?1:-1)*dir).map(p=>{const tr=document.createElement('tr');for(const k of ['name','team','joined','rating']){const td=document.createElement('td');td.textContent=p[k];tr.appendChild(td);}return tr;}));}
document.querySelectorAll('th').forEach(th=>th.onclick=()=>{dir=key===th.dataset.k?-dir:1;key=th.dataset.k;draw();});draw();</script>`,
  },
  t2: {
    sayshape: `state query="" products=[{name: "Notebook", price: 4}, {name: "Pen", price: 2}, {name: "Pencil", price: 1}, {name: "Backpack", price: 35}, {name: "Ruler", price: 3}, {name: "Marker", price: 5}, {name: "Paper pack", price: 8}, {name: "Pen case", price: 9}]
derive shown={search(products, 'name', query)}
card
  input bind=query kind=search placeholder="Search products"
  text "{plural(len(shown), 'match', 'matches')}" tone=muted
  table items=shown
    table-column "Name" field=name
    table-column "Price" field=price format=money`,
    html: `<input id="q" placeholder="Search products"><p id="n"></p><ul id="l"></ul>
<script>const P=[['Notebook',4],['Pen',2],['Pencil',1],['Backpack',35],['Ruler',3],['Marker',5],['Paper pack',8],['Pen case',9]];
function draw(){const q=document.getElementById('q').value.toLowerCase();const s=P.filter(p=>p[0].toLowerCase().includes(q));document.getElementById('n').textContent=s.length+' matches';
document.getElementById('l').replaceChildren(...s.map(p=>{const li=document.createElement('li');li.textContent=p[0]+' $'+p[1];return li;}));}
document.getElementById('q').oninput=draw;draw();</script>`,
  },
  t3: {
    sayshape: `state orders=[{id: "A1", customer: "Acme", total: 1200, status: "Shipped"}, {id: "A2", customer: "Globex", total: 860, status: "Pending"}, {id: "A3", customer: "Initech", total: 2310, status: "Shipped"}, {id: "A4", customer: "Umbrella", total: 410, status: "Cancelled"}] picked=""
derive sel={find(orders, 'id', picked)}
card
  table items=orders key=id bind=picked
    table-column "Order" field=id
    table-column "Customer" field=customer
    table-column "Total" field=total format=money
    table-column "Status" field=status
  if={picked != ''}
    text "{sel.id}: {sel.customer}, {money(sel.total)}, {sel.status}" tone=accent`,
    html: `<table><tbody id="b"></tbody></table><p id="d"></p>
<script>const O=[['A1','Acme',1200,'Shipped'],['A2','Globex',860,'Pending'],['A3','Initech',2310,'Shipped'],['A4','Umbrella',410,'Cancelled']];
for(const o of O){const tr=document.createElement('tr');tr.onclick=()=>{document.getElementById('d').textContent=o[0]+': '+o[1]+', $'+o[2].toLocaleString('en-US')+', '+o[3];};for(const v of o){const td=document.createElement('td');td.textContent=v;tr.appendChild(td);}document.getElementById('b').appendChild(tr);}</script>`,
  },
  t4: {
    sayshape: `state inv=[{id: "INV-1", amount: 500, status: "Paid"}, {id: "INV-2", amount: 1250, status: "Overdue"}, {id: "INV-3", amount: 320, status: "Draft"}, {id: "INV-4", amount: 780, status: "Paid"}]
card
  each items=inv as=i
    row align=center
      text "{i.id}"
      text "{money(i.amount)}"
      badge "{i.status}" tone={i.status == 'Paid' ? 'good' : i.status == 'Overdue' ? 'bad' : 'muted'}
  divider
  text "Total {money(sum(inv, 'amount'))}" weight=semibold`,
    html: `<table id="t"></table><p id="tot"></p>
<script>const I=[['INV-1',500,'Paid'],['INV-2',1250,'Overdue'],['INV-3',320,'Draft'],['INV-4',780,'Paid']];const C={Paid:'green',Overdue:'red',Draft:'grey'};
for(const [id,a,s] of I){const r=document.getElementById('t').insertRow();r.insertCell().textContent=id;r.insertCell().textContent='$'+a.toLocaleString('en-US');const b=document.createElement('span');b.textContent=s;b.style.color=C[s];r.insertCell().appendChild(b);}
document.getElementById('tot').textContent='Total $'+I.reduce((t,x)=>t+x[1],0).toLocaleString('en-US');</script>`,
  },
  f1: {
    sayshape: `state name="" email="" plan="Free" agreed=false sent=false who="" plans=["Free", "Pro", "Team"]
card
  if={!sent}
    input "Name" bind=name
    input "Email" bind=email kind=email
    select "Plan" items=plans bind=plan
    check "I agree to the terms" bind=agreed
    button "Create account" disabled={trim(name) == '' || trim(email) == '' || !agreed} on="set:who:{name};set:sent:true"
  if={sent}
    text "Welcome, {who}!" style=title`,
    html: `<form id="f"><input id="n" placeholder="Name"><input id="e" type="email" placeholder="Email"><select><option>Free</option><option>Pro</option><option>Team</option></select>
<label><input id="a" type="checkbox"> I agree to the terms</label><button type="submit">Create account</button><p id="err"></p></form><p id="ok"></p>
<script>document.getElementById('f').onsubmit=(ev)=>{ev.preventDefault();const n=document.getElementById('n').value.trim(),e=document.getElementById('e').value.trim();
if(!n||!e||!document.getElementById('a').checked){document.getElementById('err').textContent='Fill in every field and accept the terms';return;}
document.getElementById('f').style.display='none';document.getElementById('ok').textContent='Welcome, '+n+'!';};</script>`,
  },
  f2: {
    sayshape: `state task="" todos=[{text: "Buy milk", done: true}, {text: "Call mom", done: false}]
card
  text "{len(todos) - count(todos, 'done')} left" tone=muted
  each items=todos as=t
    row align=center
      check "{t.text}" bind=t.done
      button "Remove" variant=secondary on=remove:t
  row
    input bind=task placeholder="New item"
    button "Add" on="add:todos:{text: task, done: false};set:task:''" disabled={trim(task) == ''}`,
    html: `<p id="left"></p><ul id="l"></ul><input id="t" placeholder="New item"><button id="add">Add</button>
<script>const T=[{text:'Buy milk',done:true},{text:'Call mom',done:false}];
function draw(){document.getElementById('left').textContent=T.filter(t=>!t.done).length+' left';document.getElementById('l').replaceChildren(...T.map((t,i)=>{const li=document.createElement('li');const c=document.createElement('input');c.type='checkbox';c.checked=t.done;c.onchange=()=>{t.done=c.checked;draw();};
const s=document.createElement('span');s.textContent=t.text;const x=document.createElement('button');x.textContent='Remove';x.onclick=()=>{T.splice(i,1);draw();};li.append(c,s,x);return li;}));}
document.getElementById('add').onclick=()=>{const v=document.getElementById('t').value.trim();if(!v)return;T.push({text:v,done:false});document.getElementById('t').value='';draw();};draw();</script>`,
  },
  f3: {
    sayshape: `state notif=true autosave=true beta=false theme="System"
card
  switch "Notifications" bind=notif
  switch "Auto-save" bind=autosave
  switch "Beta features" bind=beta
  segmented bind=theme options="Light,Dark,System"
  text "Notifications {notif ? 'on' : 'off'}, auto-save {autosave ? 'on' : 'off'}, beta {beta ? 'on' : 'off'}, {lower(theme)} theme" tone=muted`,
    html: `<label><input type="checkbox" id="n" checked> Notifications</label><label><input type="checkbox" id="a" checked> Auto-save</label><label><input type="checkbox" id="b"> Beta features</label>
<div><button data-t="Light">Light</button><button data-t="Dark">Dark</button><button data-t="System">System</button></div><p id="s"></p>
<script>let theme='System';const on=id=>document.getElementById(id).checked?'on':'off';
function draw(){document.getElementById('s').textContent='Notifications '+on('n')+', auto-save '+on('a')+', beta '+on('b')+', '+theme.toLowerCase()+' theme';}
document.querySelectorAll('input').forEach(i=>i.onchange=draw);document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{theme=b.dataset.t;draw();});draw();</script>`,
  },
  f4: {
    sayshape: `state stars=0 comment="" sent=false
card
  rating bind=stars
  input "Comment" bind=comment
  button "Send" disabled={stars == 0} on="set:sent:true"
  if={sent}
    text "Thanks! You rated us {stars} stars."`,
    html: `<div id="r"></div><textarea placeholder="Comment"></textarea><button id="send">Send</button><p id="m"></p>
<script>let stars=0;for(let i=1;i<=5;i++){const b=document.createElement('button');b.textContent='★';b.setAttribute('aria-label',i+' stars');b.onclick=()=>{stars=i;};document.getElementById('r').appendChild(b);}
document.getElementById('send').onclick=()=>{if(!stars)return;document.getElementById('m').textContent='Thanks! You rated us '+stars+' stars.';};</script>`,
  },
  x1: {
    sayshape: `state amount=300000 rate=6.5 years=30
derive r={rate / 1200}
derive n={years * 12}
derive payment={amount * r * pow(1 + r, n) / (pow(1 + r, n) - 1)}
card
  slider "Loan: {money(amount)}" bind=amount min=50000 max=1000000 step=5000
  slider "Rate: {rate}%" bind=rate min=1 max=12 step=0.1
  slider "Term: {years} years" bind=years min=5 max=40
  stat label="Monthly payment" value="{money(payment)}"`,
    html: `<input id="a" type="range" min="50000" max="1000000" step="5000" value="300000"><input id="r" type="range" min="1" max="12" step="0.1" value="6.5"><input id="y" type="range" min="5" max="40" value="30">
<p>Monthly payment: <b id="p"></b></p>
<script>function u(){const P=+document.getElementById('a').value,i=document.getElementById('r').value/1200,n=document.getElementById('y').value*12;
const m=P*i*Math.pow(1+i,n)/(Math.pow(1+i,n)-1);document.getElementById('p').textContent='$'+m.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
['a','r','y'].forEach(k=>document.getElementById(k).oninput=u);u();</script>`,
  },
  x2: {
    sayshape: `state bill=84.5 tip="18%" people=3
derive rate={tip == '15%' ? 0.15 : tip == '18%' ? 0.18 : 0.2}
derive tipAmount={bill * rate}
derive total={bill + tipAmount}
card
  input "Bill" bind=bill kind=number
  segmented bind=tip options="15%,18%,20%"
  stepper "People" bind=people min=1 max=20
  grid min=140 gap=12
    stat label="Tip" value="{money(tipAmount)}"
    stat label="Total" value="{money(total)}"
    stat label="Per person" value="{money(total / people)}"`,
    html: `<input id="b" type="number" value="84.50"><div><button data-p="15">15%</button><button data-p="18">18%</button><button data-p="20">20%</button></div><input id="n" type="number" value="3">
<p>Tip <span id="t"></span> · Total <span id="g"></span> · Per person <span id="e"></span></p>
<script>let pct=18;const f=x=>'$'+x.toFixed(2);function u(){const b=+document.getElementById('b').value,n=+document.getElementById('n').value||1,t=b*pct/100;
document.getElementById('t').textContent=f(t);document.getElementById('g').textContent=f(b+t);document.getElementById('e').textContent=f((b+t)/n);}
document.querySelectorAll('[data-p]').forEach(x=>x.onclick=()=>{pct=+x.dataset.p;u();});document.querySelectorAll('input').forEach(i=>i.oninput=u);u();</script>`,
  },
  x3: {
    sayshape: `state value=10 dir="Km to mi"
derive out={dir == 'Km to mi' ? value * 0.621371 : value / 0.621371}
card
  input "Distance" bind=value kind=number
  segmented bind=dir options="Km to mi,Mi to km"
  text "{fixed(out, 2)} {dir == 'Km to mi' ? 'miles' : 'km'}" style=title`,
    html: `<input id="v" type="number" value="10"><select id="d"><option value="k">km to miles</option><option value="m">miles to km</option></select><button id="sw">miles to km</button><p id="o"></p>
<script>let dir='k';function u(){const v=+document.getElementById('v').value;document.getElementById('o').textContent=dir==='k'?(v*0.621371).toFixed(2)+' miles':(v/0.621371).toFixed(2)+' km';}
document.getElementById('sw').onclick=()=>{dir='m';document.getElementById('d').value='m';u();};document.getElementById('d').onchange=e=>{dir=e.target.value;u();};document.getElementById('v').oninput=u;u();</script>`,
  },
  d1: {
    sayshape: `state region="All" query="" by="total" dir="desc"
state orders=[{id: "A101", customer: "Acme", region: "NA", total: 12400, status: "Shipped"}, {id: "A102", customer: "Globex", region: "EU", total: 8600, status: "Pending"}, {id: "A103", customer: "Initech", region: "NA", total: 23100, status: "Shipped"}, {id: "A104", customer: "Umbrella", region: "APAC", total: 4100, status: "Cancelled"}, {id: "A105", customer: "Stark", region: "NA", total: 31500, status: "Pending"}, {id: "A106", customer: "Wayne", region: "EU", total: 17800, status: "Shipped"}, {id: "A107", customer: "Tyrell", region: "APAC", total: 9900, status: "Shipped"}, {id: "A108", customer: "Soylent", region: "APAC", total: 14300, status: "Pending"}]
derive inRegion={region == 'All' ? orders : filter(orders, 'region', region)}
derive shown={search(inRegion, 'customer', query)}
derive top={take(sort(inRegion, 'total', 'desc'), 5)}
column gap=16
  row align=center
    segmented bind=region options="All,NA,EU,APAC"
    input bind=query kind=search placeholder="Search customers"
  grid min=140 gap=12
    stat label="Revenue" value="{money(sum(inRegion, 'total'))}"
    stat label="Orders" value="{len(inRegion)}"
    stat label="Avg order" value="{money(round(avg(inRegion, 'total'), 0))}"
    stat label="Pending" value="{count(inRegion, 'status', 'Pending')}"
  chart "Top customers" kind=hbar items=top x=customer y=total format=money
  table items=shown key=id sort=by direction=dir
    table-column "Order" field=id
    table-column "Customer" field=customer
    table-column "Region" field=region
    table-column "Status" field=status
    table-column "Total" field=total format=money`,
    html: `<div id="seg"><button>All</button><button>NA</button><button>EU</button><button>APAC</button></div><input id="q" placeholder="Search customers">
<p>Revenue <b id="rev"></b> · Orders <b id="cnt"></b> · Avg order <b id="avg"></b> · Pending <b id="pen"></b></p><canvas id="c"></canvas><table><tbody id="tb"></tbody></table>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>const O=[['A101','Acme','NA',12400,'Shipped'],['A102','Globex','EU',8600,'Pending'],['A103','Initech','NA',23100,'Shipped'],['A104','Umbrella','APAC',4100,'Cancelled'],['A105','Stark','NA',31500,'Pending'],['A106','Wayne','EU',17800,'Shipped'],['A107','Tyrell','APAC',9900,'Shipped'],['A108','Soylent','APAC',14300,'Pending']];
let reg='All';const $=id=>document.getElementById(id),m=v=>'$'+Math.round(v).toLocaleString('en-US');const ch=new Chart($('c'),{type:'bar',data:{labels:[],datasets:[{label:'Total',data:[]}]},options:{indexAxis:'y'}});
function draw(){const r=reg==='All'?O:O.filter(o=>o[2]===reg),q=$('q').value.toLowerCase(),s=r.filter(o=>o[1].toLowerCase().includes(q)),sum=r.reduce((t,o)=>t+o[3],0);
$('rev').textContent=m(sum);$('cnt').textContent=r.length;$('avg').textContent=r.length?m(sum/r.length):'–';$('pen').textContent=r.filter(o=>o[4]==='Pending').length;
const top=[...r].sort((a,b)=>b[3]-a[3]).slice(0,5);ch.data.labels=top.map(o=>o[1]);ch.data.datasets[0].data=top.map(o=>o[3]);ch.update();
$('tb').replaceChildren(...s.map(o=>{const tr=document.createElement('tr');for(const v of o){const td=document.createElement('td');td.textContent=v;tr.appendChild(td);}return tr;}));}
$('seg').onclick=e=>{if(e.target.tagName!=='BUTTON')return;reg=e.target.textContent;draw();};$('q').oninput=draw;draw();</script>`,
  },
  d2: {
    sayshape: `state prio="All" days=[{d: "Mon", n: 34}, {d: "Tue", n: 41}, {d: "Wed", n: 29}, {d: "Thu", n: 38}, {d: "Fri", n: 45}]
state tickets=[{id: "#201", title: "Login fails", priority: "High", owner: "Ana"}, {id: "#202", title: "Slow export", priority: "Medium", owner: "Ben"}, {id: "#203", title: "Typo on page", priority: "Low", owner: "Ana"}, {id: "#204", title: "Data missing", priority: "High", owner: "Chen"}, {id: "#205", title: "Billing error", priority: "Medium", owner: "Chen"}]
derive shown={prio == 'All' ? tickets : filter(tickets, 'priority', prio)}
column gap=16
  grid min=140 gap=12
    stat label="Open tickets" value="{len(tickets)}"
    stat label="High priority" value="{count(tickets, 'priority', 'High')}"
  chart "Tickets per day" kind=bar items=days x=d y=n
  segmented bind=prio options="All,High,Medium,Low"
  table items=shown
    table-column "Ticket" field=id
    table-column "Title" field=title
    table-column "Priority" field=priority
    table-column "Owner" field=owner`,
    html: `<p>Open <b>5</b> · High priority <b>2</b></p><canvas id="c"></canvas><div id="f"><button>All</button><button>High</button><button>Medium</button><button>Low</button></div><ul id="l"></ul>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>new Chart(document.getElementById('c'),{type:'bar',data:{labels:['Mon','Tue','Wed','Thu','Fri'],datasets:[{label:'Tickets',data:[34,41,29,38,45]}]}});
const T=[['#201','Login fails','High','Ana'],['#202','Slow export','Medium','Ben'],['#203','Typo on page','Low','Ana'],['#204','Data missing','High','Chen'],['#205','Billing error','Medium','Chen']];
function draw(p){document.getElementById('l').replaceChildren(...T.filter(t=>p==='All'||t[2]===p).map(t=>{const li=document.createElement('li');li.textContent=t.join(' ');return li;}));}
document.getElementById('f').onclick=e=>{if(e.target.tagName==='BUTTON')draw(e.target.textContent);};draw('All');</script>`,
  },
  d3: {
    sayshape: `state owner="All" tasks=[{title: "Design mockups", project: "Website", owner: "Ana", done: true}, {title: "Build pages", project: "Website", owner: "Ben", done: false}, {title: "Write copy", project: "Website", owner: "Ana", done: true}, {title: "Set up CI", project: "App", owner: "Chen", done: true}, {title: "Login screen", project: "App", owner: "Ben", done: false}, {title: "Push alerts", project: "App", owner: "Chen", done: false}]
derive web={filter(tasks, 'project', 'Website')}
derive app={filter(tasks, 'project', 'App')}
card
  progress value={count(web, 'done')} max={len(web)} label="Website: {count(web, 'done')} of {len(web)}"
  progress value={count(app, 'done')} max={len(app)} label="App: {count(app, 'done')} of {len(app)}"
  segmented bind=owner options="All,Ana,Ben,Chen"
  each items=tasks as=t
    check "{t.title}" bind=t.done if={owner == 'All' || t.owner == owner}`,
    html: `<p id="w"></p><p id="a"></p><div id="f"><button>All</button><button>Ana</button><button>Ben</button><button>Chen</button></div><div id="l"></div>
<script>const T=[['Design mockups','Website','Ana',true],['Build pages','Website','Ben',false],['Write copy','Website','Ana',true],['Set up CI','App','Chen',true],['Login screen','App','Ben',false],['Push alerts','App','Chen',false]].map(([title,project,owner,done])=>({title,project,owner,done}));
let who='All';function prog(p){const t=T.filter(x=>x.project===p);return p+': '+t.filter(x=>x.done).length+' of '+t.length;}
function draw(){document.getElementById('w').textContent=prog('Website');document.getElementById('a').textContent=prog('App');
document.getElementById('l').replaceChildren(...T.filter(t=>who==='All'||t.owner===who).map(t=>{const l=document.createElement('label');const c=document.createElement('input');c.type='checkbox';c.checked=t.done;c.onchange=()=>{t.done=c.checked;draw();};l.append(c,' '+t.title);return l;}));}
document.getElementById('f').onclick=e=>{if(e.target.tagName==='BUTTON'){who=e.target.textContent;draw();}};draw();</script>`,
  },
  d4: {
    sayshape: `state item="" cat="Food" amt=null cats=["Food", "Transport", "Fun"]
state spend=[{name: "Groceries", cat: "Food", amt: 82}, {name: "Gas", cat: "Transport", amt: 45}, {name: "Dinner out", cat: "Food", amt: 64}, {name: "Movie", cat: "Fun", amt: 18}, {name: "Bus pass", cat: "Transport", amt: 30}]
derive byCat={[{name: 'Food', total: sum(filter(spend, 'cat', 'Food'), 'amt')}, {name: 'Transport', total: sum(filter(spend, 'cat', 'Transport'), 'amt')}, {name: 'Fun', total: sum(filter(spend, 'cat', 'Fun'), 'amt')}]}
card
  stat label="Total spent" value="{money(sum(spend, 'amt'))}"
  chart "By category" kind=donut items=byCat x=name y=total format=money
  row align=bottom
    input "Expense" bind=item placeholder="Coffee"
    select "Category" items=cats bind=cat
    input "Amount" bind=amt kind=number placeholder="5"
  button "Add expense" disabled={trim(item) == '' || amt == null} on="add:spend:{name: item, cat: cat, amt: amt};set:item:'';set:amt:null"`,
    html: `<p>Total spent <b id="t"></b></p><canvas id="c"></canvas><input id="n" placeholder="Expense"><select id="k"><option>Food</option><option>Transport</option><option>Fun</option></select><input id="a" type="number" placeholder="Amount"><button id="add">Add expense</button>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>const S=[['Groceries','Food',82],['Gas','Transport',45],['Dinner out','Food',64],['Movie','Fun',18],['Bus pass','Transport',30]];const C=['Food','Transport','Fun'];
const ch=new Chart(document.getElementById('c'),{type:'doughnut',data:{labels:C,datasets:[{data:[]}]}});
function draw(){document.getElementById('t').textContent='$'+S.reduce((x,s)=>x+s[2],0);ch.data.datasets[0].data=C.map(c=>S.filter(s=>s[1]===c).reduce((x,s)=>x+s[2],0));ch.update();}
document.getElementById('add').onclick=()=>{const n=document.getElementById('n').value.trim(),a=+document.getElementById('a').value;if(!n||!a)return;S.push([n,document.getElementById('k').value,a]);draw();};draw();</script>`,
  },
  s1: {
    sayshape: `state customers=[{name: "Acme", city: "Phoenix", orders: 12}, {name: "${HOSTILE}", city: "Tucson", orders: 3}, {name: "Globex", city: "Mesa", orders: 7}]
table items=customers
  table-column "Name" field=name
  table-column "City" field=city
  table-column "Orders" field=orders format=number`,
    html: `<table id="t"></table>
<script>const C=[['Acme','Phoenix',12],[${JSON.stringify(HOSTILE)},'Tucson',3],['Globex','Mesa',7]];
for(const c of C){const r=document.getElementById('t').insertRow();for(const v of c)r.insertCell().textContent=v;}</script>`,
  },
  s2: {
    sayshape: `state name=""
card
  input "Your name" bind=name
  text "Hello, {name}!"`,
    html: `<input id="n" placeholder="Your name"><p id="h">Hello, !</p>
<script>document.getElementById('n').oninput=e=>{document.getElementById('h').textContent='Hello, '+e.target.value+'!';};</script>`,
  },
};

/** Broken answers, one per kind of mistake, that the checks must catch. */
export const broken: Array<{ task: string; format: "sayshape" | "html"; code: string; why: string }> = [
  { task: "s1", format: "html", why: "inserts data as HTML", code: `<table id="t"></table>
<script>const C=[['Acme','Phoenix',12],[${JSON.stringify(HOSTILE)},'Tucson',3],['Globex','Mesa',7]];
document.getElementById('t').innerHTML=C.map(c=>'<tr><td>'+c.join('</td><td>')+'</td></tr>').join('');</script>` },
  { task: "s2", format: "html", why: "echoes typed text as HTML", code: `<input id="n"><p id="h">Hello, !</p>
<script>document.getElementById('n').oninput=e=>{document.getElementById('h').innerHTML='Hello, '+e.target.value+'!';};</script>` },
  { task: "t2", format: "html", why: "search doesn't filter", code: `<input id="q"><ul><li>Notebook</li><li>Pen</li><li>Pencil</li><li>Backpack</li><li>Ruler</li><li>Marker</li><li>Paper pack</li><li>Pen case</li></ul>` },
  { task: "t2", format: "sayshape", why: "search doesn't filter", code: `state query="" products=[{name: "Notebook"}, {name: "Pen"}, {name: "Pencil"}, {name: "Backpack"}, {name: "Ruler"}, {name: "Marker"}, {name: "Paper pack"}, {name: "Pen case"}]
card
  input bind=query kind=search
  table items=products
    table-column "Name" field=name` },
  { task: "x1", format: "sayshape", why: "simple interest instead of the formula", code: `state amount=300000 rate=6.5 years=30
stat label="Monthly payment" value="{money((amount + amount * rate / 100 * years) / (years * 12))}"` },
  { task: "x1", format: "html", why: "a script error", code: `<p id="p"></p><script>document.getElementById('missing').textContent='$1,896.20';</script>` },
  { task: "f1", format: "html", why: "welcomes without checking the form", code: `<input id="n"><input id="e"><label><input type="checkbox"> I agree to the terms</label><button id="b">Create account</button><p id="o"></p>
<script>document.getElementById('b').onclick=()=>{document.getElementById('o').textContent='Welcome, '+document.getElementById('n').value+'!';};</script>` },
  { task: "d1", format: "sayshape", why: "the region filter changes nothing", code: `state region="All" orders=[{customer: "Acme", region: "NA", total: 12400}, {customer: "Stark", region: "NA", total: 31500}, {customer: "Globex", region: "EU", total: 8600}, {customer: "Wayne", region: "EU", total: 17800}, {customer: "Initech", region: "NA", total: 23100}, {customer: "Umbrella", region: "APAC", total: 4100}, {customer: "Tyrell", region: "APAC", total: 9900}, {customer: "Soylent", region: "APAC", total: 14300}]
card
  segmented bind=region options="All,NA,EU,APAC"
  stat label="Revenue" value="{money(sum(orders, 'total'))}"
  table items=orders
    table-column "Customer" field=customer` },
  { task: "c4", format: "sayshape", why: "charts every product", code: `state products=[{name: "Lamp", units: 120}, {name: "Desk", units: 340}, {name: "Chair", units: 410}, {name: "Shelf", units: 95}, {name: "Rug", units: 210}, {name: "Mirror", units: 180}, {name: "Sofa", units: 60}, {name: "Stool", units: 150}]
chart "Products" kind=hbar items=products x=name y=units` },
];
