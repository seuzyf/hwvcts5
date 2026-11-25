const fs=require('fs'),path=require('path'),{JSDOM,VirtualConsole}=require('jsdom');
const PAGES=['index.html','events.html','manage.html','register.html','admin.html','matches.html',
  'schedule.html','summary.html','betting.html','draft.html','lottery.html','shop.html','player.html',
  'players.html','review.html','team.html','404.html'];
const only=process.argv.slice(2);
const pages=only.length?only:PAGES;
let totalFail=0, done=0;
pages.forEach(runPage);

function runPage(page){
let html=fs.readFileSync(page,'utf8');
const auth=fs.readFileSync('js/auth.js','utf8'), layout=fs.readFileSync('js/layout.js','utf8');
const supabaseStub=`window.supabase={createClient:function(){var q={select:function(){return q},eq:function(){return q},in:function(){return q},not:function(){return q},is:function(){return q},neq:function(){return q},order:function(){return q},limit:function(){return q},range:function(){return q},match:function(){return q},or:function(){return q},ilike:function(){return q},gte:function(){return q},lte:function(){return q},insert:function(){return q},update:function(){return q},delete:function(){return q},upsert:function(){return q},maybeSingle:function(){return Promise.resolve({data:null,error:{message:'stub'}})},single:function(){return Promise.resolve({data:null,error:{message:'stub'}})},then:function(r){return Promise.resolve({data:[],error:null}).then(r)}};return {from:function(){return q},rpc:function(){return q},auth:{getSession:function(){return Promise.resolve({data:{session:null}})}}}}};`;
html=html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/g,'<script>'+supabaseStub+'</script>');
html=html.replace(/<script src="js\/auth\.js"><\/script>/g,()=>'<script>'+auth.replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace(/<script src="js\/layout\.js"><\/script>/g,()=>'<script>'+layout.replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace(/<link[^>]*fonts\.googleapis[^>]*>/g,'');
const errors=[];
const vc=new VirtualConsole();
vc.on('jsdomError',e=>{ if(!/Could not parse CSS|css/i.test(e.message)) errors.push(e.message+' :: '+(e.detail&&e.detail.stack||'').split('\n').slice(0,3).join(' | ')); });
vc.on('error',(...a)=>errors.push('console.error: '+a.join(' ')));
new JSDOM(html,{url:'https://example.test/'+page,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
  beforeParse(w){
    w.fetch=()=>Promise.reject(new Error('offline'));
    w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));
  }});
setTimeout(()=>{
  if (errors.length) totalFail++;
  console.log((errors.length?'FAIL ':'OK   ')+page+(errors.length?'\n   '+errors.slice(0,4).join('\n   '):''));
  if (++done===pages.length) {
    console.log('\n页面冒烟：' + (pages.length-totalFail) + ' 通过 / ' + totalFail + ' 失败');
    process.exit(totalFail?1:0);
  }
},1100);
}
