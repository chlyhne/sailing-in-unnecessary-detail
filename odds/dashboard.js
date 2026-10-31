(async () => {
  'use strict';
  const $ = id => document.getElementById(`odds-${id}`);
  const M = globalThis.OddsMath;
  const storageKey = 'onsdagsbanen-your-boat';
  const pct = (p, precise=false) => p == null ? '—' : p < .005 ? '<1%' : p > .995 ? '>99%' : `${(p*100).toFixed(precise?1:0)}%`;
  const fair = p => p == null ? '—' : p < .001 ? '>1,000' : (1/p).toFixed(2);
  const displayName = name => name.replace(/\p{L}+/gu,word=>word.length>1 && word===word.toLocaleUpperCase()?word[0]+word.slice(1).toLocaleLowerCase():word);
  const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  const text = (tag,content,cls) => { const el=document.createElement(tag);el.textContent=content;if(cls)el.className=cls;return el; };
  const option = (value,name) => { const el=text('option',name);el.value=value;return el; };
  const svgNode = (tag,attrs={}) => { const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n; };
  const initial=new URLSearchParams(location.hash.slice(1));
  let data, group, season, boatName, boatId, index, rivalId=null, currentRows=[];
  try {
    const response=await fetch('odds/data.json');
    if(!response.ok)throw new Error(`Data request failed (${response.status})`);
    data=await response.json();
    if(data.version!==2 || !data.groups?.length)throw new Error('Unsupported dataset');
  } catch(error) {
    $('loading').textContent='The model data could not be loaded. Please reload the page to try again.';
    console.error(error);return;
  }
  for(const g of data.groups) {
    const optgroup=document.createElement('optgroup');optgroup.label=g.name;
    const names=[...new Set(g.seasons.flatMap(s=>s.names))].sort((a,b)=>a.localeCompare(b));
    for(const name of names)optgroup.append(option(JSON.stringify([g.name,name]),displayName(name)));
    $('boat').append(optgroup);
  }
  function loadSeason(year,rivalName) {
    const eligible=group.seasons.filter(s=>s.names.includes(boatName));
    season=eligible.find(s=>s.year===Number(year)) || eligible.at(-1);
    $('season').replaceChildren(...eligible.map(s=>option(s.year,s.year)));
    $('season').value=season.year;
    boatId=season.names.indexOf(boatName);
    const other=season.names.indexOf(rivalName);
    rivalId=other>=0 && other!==boatId ? other : null;
    index=season.snapshots.length-1;
    $('date-slider').max=index;
  }
  function chooseBoat(value,preferredYear,rivalName) {
    let pair;try {pair=JSON.parse(value);}catch{return false;}
    if(!Array.isArray(pair)||pair.length!==2)return false;
    const g=data.groups.find(g=>g.name===pair[0]);
    if(!g || !g.seasons.some(s=>s.names.includes(pair[1])))return false;
    group=g;boatName=pair[1];$('boat').value=value;
    loadSeason(preferredYear,rivalName);
    return true;
  }
  function state() {
    const snapshot=season.snapshots[index];
    const boats=new Map(snapshot.boats.map(b=>[b.id,b]));
    return {snapshot,boats};
  }
  function chance(s,id) {
    return M.chance(s.snapshot,boatId,id,data.minimumFinishes);
  }
  function drawHistory(container,id,s) {
    container.replaceChildren();
    container.append(text('h3',`You vs ${displayName(season.names[id])}`));
    container.append(text('p',`Your chance of finishing ahead through ${season.year}. Above the dashed line favours you.`));
    const width=window.matchMedia('(max-width: 650px)').matches?420:740;
    const svg=svgNode('svg',{viewBox:`0 0 ${width} 260`,class:'odds-history',role:'img','aria-label':`Your chance of beating ${displayName(season.names[id])} through ${season.year}. Exact values in the table below.`});
    const left=45,right=width-18,top=20,bottom=218;
    const x=i=>left+(right-left)*i/Math.max(1,season.snapshots.length-1),y=p=>bottom-(bottom-top)*p;
    for(const p of [0,.5,1]) {
      svg.append(svgNode('line',{x1:left,x2:right,y1:y(p),y2:y(p),stroke:p===.5?'#869888':'#d9ddd3','stroke-dasharray':p===.5?'5 5':'0'}));
      const label=svgNode('text',{x:left-8,y:y(p)+4,'text-anchor':'end'});label.textContent=`${p*100}%`;svg.append(label);
    }
    const values=season.snapshots.map(snapshot=>{
      return M.chance(snapshot,boatId,id,data.minimumFinishes);
    });
    let path='',previous=false;
    values.forEach((v,i)=>{if(v==null){previous=false;return;}path+=`${previous?'L':'M'}${x(i)},${y(v)} `;previous=true;});
    svg.append(svgNode('path',{d:path,fill:'none',stroke:'#30695b','stroke-width':2.5,'stroke-linejoin':'round'}));
    svg.append(svgNode('line',{x1:x(index),x2:x(index),y1:top,y2:bottom,stroke:'#30695b','stroke-opacity':.35}));
    const table=text('table',''),thead=text('thead',''),head=text('tr','');
    for(const label of ['Race','Date','Your odds','Your chance']){const th=text('th',label);th.scope='col';head.append(th);}thead.append(head);table.append(thead);
    const tbody=text('tbody','');
    values.forEach((v,i)=>{
      const snap=season.snapshots[i];
      if(v!=null)svg.append(svgNode('circle',{cx:x(i),cy:y(v),r:i===index?5:2.5,fill:i===index?'#30695b':'#f7f5ef',stroke:'#30695b','stroke-width':1.5}));
      if(i===0||i===values.length-1||i%4===0){const label=svgNode('text',{x:x(i),y:bottom+25,'text-anchor':'middle'});label.textContent=snap.race;svg.append(label);}
      const hit=svgNode('rect',{x:x(i)-10,y:top,width:20,height:bottom-top,class:'odds-hit'});
      const tip=svgNode('title');tip.textContent=`${snap.race} · ${dateLabel(snap.date)}: ${pct(v,true)}`;hit.append(tip);
      hit.addEventListener('click',()=>{index=i;render();});svg.append(hit);
      const tr=text('tr','');tr.append(text('td',snap.race),text('td',dateLabel(snap.date)),text('td',fair(v)),text('td',pct(v,true)));tbody.append(tr);
    });
    table.append(tbody);container.append(svg);
    const current=chance(s,id);
    container.append(text('p',`${s.snapshot.race} · ${dateLabel(s.snapshot.date)}: you to win ${fair(current)} (${pct(current,true)}); ${displayName(season.names[id])} to win ${fair(current==null?null:1-current)} (${pct(current==null?null:1-current,true)}).`));
    const meetings=s.snapshot.pairMeetings[boatId][id],wins=s.snapshot.pairWins[boatId][id],losses=s.snapshot.pairWins[id][boatId];
    container.append(text('p',`Shared finishes this season: ${wins} ahead, ${losses} behind${meetings-wins-losses?`, ${meetings-wins-losses} tied`:''}, out of ${meetings} races.`));
    if(current!=null)container.append(text('p',`Approximate 90% model interval: ${pct(s.snapshot.pairLow[boatId][id],true)}–${pct(s.snapshot.pairHigh[boatId][id],true)}. This expresses uncertainty in the estimated chance.`));
    if(season.year===2025)container.append(text('p','The 2025 timeline is retrospective: this season was also used to choose the model’s regularisation.'));

    const details=text('details','');details.append(text('summary','Exact values'),table);container.append(details);
  }
  function renderCompetitors(s) {
    currentRows=season.names.map((name,id)=>({id,name,p:id===boatId?null:chance(s,id),finishes:s.boats.get(id)?.finishes})).filter(r=>r.id!==boatId);
    currentRows.sort((a,b)=>(a.p==null?Infinity:Math.abs(a.p-.5))-(b.p==null?Infinity:Math.abs(b.p-.5))||a.name.localeCompare(b.name));
    $('competitors').replaceChildren(...currentRows.map(row=>{
      const wrapper=text('div','','odds-opponent'),button=text('button','','odds-opponent-toggle');
      button.type='button';button.id=`odds-opponent-${row.id}`;
      button.setAttribute('aria-expanded',String(rivalId===row.id));
      button.setAttribute('aria-controls',`odds-detail-${row.id}`);
      button.setAttribute('aria-label',`${displayName(row.name)}: you to win ${fair(row.p)}, opponent to win ${fair(row.p==null?null:1-row.p)}. Your chance ${pct(row.p)}. ${rivalId===row.id?'Hide':'Show'} history.`);
      const label=text('span',displayName(row.name),'odds-opponent-name');
      if(row.finishes==null)label.append(text('span','No model state at this date','odds-opponent-note'));
      else if(row.finishes<data.minimumFinishes)label.append(text('span','Needs three finishes this season','odds-opponent-note'));
      const chevron=text('span','›','odds-chevron');chevron.setAttribute('aria-hidden','true');
      const yours=text('span',fair(row.p),'odds-price');
      const theirs=text('span',fair(row.p==null?null:1-row.p),'odds-price');
      yours.title=`You to win: ${pct(row.p,true)}`;
      theirs.title=`${displayName(row.name)} to win: ${pct(row.p==null?null:1-row.p,true)}`;
      if(row.p!=null && row.p>.5)yours.classList.add('odds-price-favourite');
      if(row.p!=null && row.p<.5)theirs.classList.add('odds-price-favourite');
      button.append(label,yours,theirs,chevron);
      button.addEventListener('click',()=>{rivalId=rivalId===row.id?null:row.id;render();});
      const detail=text('div','','odds-detail');detail.id=`odds-detail-${row.id}`;detail.hidden=rivalId!==row.id;
      if(!detail.hidden)drawHistory(detail,row.id,s);
      wrapper.append(button,detail);return wrapper;
    }));
  }
  function linkState() {
    const params=new URLSearchParams({course:group.name,boat:boatName});
    if(season!==group.seasons.at(-1))params.set('season',season.year);
    if(index!==season.snapshots.length-1)params.set('date',season.snapshots[index].date);
    if(rivalId!=null)params.set('rival',season.names[rivalId]);
    history.replaceState(null,'',`#${params}`);
  }
  function render() {
    const focusId=document.activeElement?.id;
    const s=state();
    $('welcome').hidden=true;$('results').hidden=false;
    const finishes=s.boats.get(boatId)?.finishes;
    $('context').textContent=`${group.name} · ${season.year} · ${index===season.snapshots.length-1?'Latest estimates':'Historical estimates'} after ${s.snapshot.race}, ${dateLabel(s.snapshot.date)}${finishes==null?' · Your boat has no model state at this date':finishes<data.minimumFinishes?' · Three finishes needed for your boat this season':''}`;
    $('date').textContent=`${s.snapshot.race} · ${dateLabel(s.snapshot.date)}`;
    $('date-slider').value=index;$('date-slider').setAttribute('aria-valuetext',$('date').textContent);
    $('latest').disabled=index===season.snapshots.length-1;
    renderCompetitors(s);
    const fleet=M.fleet(s.snapshot,data.minimumFinishes);
    $('fleet-chance').textContent=`Fair odds of winning the whole fleet: ${fair(fleet.get(boatId))} (${pct(fleet.get(boatId))}), if all ${fleet.size} boats with at least three season finishes race and finish.`;
    linkState();
    if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});
  }
  $('boat').addEventListener('change',()=>{
    if(!$('boat').value){group=null;$('welcome').hidden=false;$('results').hidden=true;history.replaceState(null,'',location.pathname);try{localStorage.removeItem(storageKey);}catch{}return;}
    if(chooseBoat($('boat').value)){
      try{localStorage.setItem(storageKey,$('boat').value);}catch{/* Selection still works without storage. */}
      render();
    }
  });
  $('season').addEventListener('change',()=>{loadSeason($('season').value,rivalId==null?null:season.names[rivalId]);render();});
  $('date-slider').addEventListener('input',()=>{index=Number($('date-slider').value);render();});
  $('latest').addEventListener('click',()=>{index=season.snapshots.length-1;render();});
  $('explain').addEventListener('click',event=>{event.preventDefault();$('method').open=true;$('method').scrollIntoView({block:'start'});$('method').querySelector('summary').focus({preventScroll:true});});
  let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{
    if(group&&rivalId!=null){const detail=$(`detail-${rivalId}`);if(detail)drawHistory(detail,rivalId,state());}
  });});
  $('share').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);$('action-status').textContent='Link copied.';}catch{$('action-status').textContent='Copy the address from your browser to share.';}});
  $('download').addEventListener('click',()=>{
    const csvCell=v=>`"${String(v).replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`;
    const rows=[['course','season','after_race','date','your_boat','competitor','your_probability_of_beating','fair_decimal_odds','opponent_decimal_odds','season_finishes'],...currentRows.map(r=>[group.name,season.year,season.snapshots[index].race,season.snapshots[index].date,boatName,r.name,r.p??'',r.p==null?'':r.p>0?1/r.p:'Infinity',r.p==null?'':r.p<1?1/(1-r.p):'Infinity',r.finishes??''])];
    const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`onsdagsbanen-odds-${season.year}-${season.snapshots[index].race}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('action-status').textContent='Comparison downloaded.';
  });
  $('provenance').textContent=`Data through ${dateLabel(data.through)} · ranking-model snapshot (2025–2026 only) · source SHA-256 ${data.sourceSha256.slice(0,12)}. Results are checked on Wednesday evenings, Danish time, and updated when a changed result sheet has settled.`;
  document.querySelector('.site-header a[href$="odds.html"]')?.setAttribute('aria-current','page');
  $('loading').hidden=true;$('app').hidden=false;
  let saved=null;try{saved=localStorage.getItem(storageKey);}catch{}
  const requested=initial.has('boat')?JSON.stringify([initial.get('course'),initial.get('boat')]):saved;
  if(requested&&chooseBoat(requested,initial.get('season'),initial.get('rival'))){
    const i=season.snapshots.findIndex(s=>s.date===initial.get('date'));if(i>=0)index=i;
    if(index!==season.snapshots.length-1)$('settings').open=true;
    render();
  }
})();
