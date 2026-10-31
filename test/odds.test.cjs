const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../odds/math.js');
const near=(a,b,t=2e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const data=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../odds/data.json')));
test('only 2025 and 2026 are included; prior was tuned on 2025 only',()=>{
 const d=data();assert.equal(d.version,2);assert.deepEqual(d.tuningYears,[2025]);
 for(const g of d.groups)assert.deepEqual(g.seasons.map(s=>s.year),[2025,2026]);
});
test('joint matchup probabilities are bounded and complementary',()=>{
 for(const g of data().groups)for(const season of g.seasons)for(const s of season.snapshots){
  const n=season.names.length;
  assert.equal(s.pairProbability.length,n);
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){
   const p=s.pairProbability[i][j];assert.ok(p>=0&&p<=1);near(p+s.pairProbability[j][i],1);
   assert.ok(s.pairLow[i][j]<=s.pairHigh[i][j]);
   assert.equal(s.pairMeetings[i][j],s.pairMeetings[j][i]);
   assert.ok(s.pairWins[i][j]+s.pairWins[j][i]<=s.pairMeetings[i][j]);
  }
  const fleet=M.fleet(s);if(fleet.size)near([...fleet.values()].reduce((a,b)=>a+b),1,1e-6);
 }
});
test('sparse and self comparisons do not display invented precision',()=>{
 const s=data().groups[0].seasons[0].snapshots[0];
 for(const a of s.boats)for(const b of s.boats)assert.equal(M.chance(s,a.id,b.id),null);
});
test('matchup record and display use the same saved state',()=>{
 for(const g of data().groups)for(const season of g.seasons){
  const snap=season.snapshots.at(-1);
  for(const a of snap.boats)for(const b of snap.boats){
   if(a.id===b.id||a.finishes<3||b.finishes<3)continue;
   near(M.chance(snap,a.id,b.id),snap.pairProbability[a.id][b.id]);
   assert.ok(snap.pairMeetings[a.id][b.id]<=Math.min(a.finishes,b.finishes));
  }
 }
});
