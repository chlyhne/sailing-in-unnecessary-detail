/* UI accessors for precomputed joint ranking-model probabilities. */
(function(root){
  'use strict';
  function chance(snapshot,a,b,minimum=3){
    if(a===b)return null;
    const x=snapshot.boats.find(v=>v.id===a),y=snapshot.boats.find(v=>v.id===b);
    if(!x||!y||x.finishes<minimum||y.finishes<minimum)return null;
    const p=snapshot.pairProbability[a]?.[b];
    if(!Number.isFinite(p)||p<0||p>1)throw new Error('Invalid ranking probability');
    return p;
  }
  function fleet(snapshot,minimum=3){
    return new Map(snapshot.boats.filter(b=>b.finishes>=minimum).map(b=>[b.id,snapshot.fleetProbability[b.id]]));
  }
  const api={chance,fleet};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OddsMath=api;
})(globalThis);
