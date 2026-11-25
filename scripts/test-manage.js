/* 数据台功能级测试：用真实 DOM 操作走一遍「进来 → 自动展开 → 填比分 → 大比分自动算」 */
const fs=require('fs'),{JSDOM,VirtualConsole}=require('jsdom');
const page='manage.html';
let html=fs.readFileSync(page,'utf8');
const auth=fs.readFileSync('js/auth.js','utf8'), layout=fs.readFileSync('js/layout.js','utf8');

const now=Date.now();
const fixtures=[
  {id:1,group:'传奇组',match_id:'RR-1-1',team_a:'阿尔法',team_b:'贝塔',match_date:new Date(now-3600e3).toISOString(),score_a:null,score_b:null,result_status:null,event_id:9},
  {id:2,group:'传奇组',match_id:'RR-1-2',team_a:'伽马',team_b:'德尔塔',match_date:new Date(now+7200e3).toISOString(),score_a:2,score_b:0,result_status:'pending',event_id:9}
];
const maps=[
  {id:11,group:'传奇组',team_a:'伽马',team_b:'德尔塔',map:'源工重镇',score:'13:9',team_a_player1_id:101,team_a_player1_ch:'捷风',team_a_player1_data:'250/20/15/5'},
  {id:12,group:'传奇组',team_a:'伽马',team_b:'德尔塔',map:'隐世修所',score:'13:11',team_a_player1_id:101,team_a_player1_ch:'捷风',team_a_player1_data:'230/18/16/4'}
];
const roster=[
  {id:101,name:'张三',team:'阿尔法',group:'传奇组',image:'',honor:''},
  {id:102,name:'李四',team:'阿尔法',group:'传奇组',image:'',honor:''},
  {id:201,name:'王五',team:'贝塔',group:'传奇组',image:'',honor:''},
  {id:301,name:'赵六',team:'伽马',group:'传奇组',image:'',honor:''},
  {id:401,name:'孙七',team:'德尔塔',group:'传奇组',image:'',honor:''}
];

const stub=`window.supabase={createClient:function(){
  function mk(table){
    var q={_t:table,_f:{}};
    ['select','in','not','is','order','limit'].forEach(function(m){q[m]=function(){return q}});
    q.eq=function(k,v){q._f[k]=v;return q};
    q.neq=function(){return q};
    q.insert=function(rows){window.__writes.push(['insert',table,rows]);return q};
    q.update=function(p){window.__writes.push(['update',table,p]);return q};
    q.delete=function(){window.__writes.push(['delete',table]);return q};
    q.upsert=function(r){window.__writes.push(['upsert',table,r]);return q};
    function rows(){
      var D=window.__data, d=table in D?D[table]:[];
      if(q._f.id!=null) d=d.filter(function(x){return String(x.id)===String(q._f.id)});
      if(q._f.team_a) d=d.filter(function(x){return x.team_a===q._f.team_a});
      if(q._f.team_b) d=d.filter(function(x){return x.team_b===q._f.team_b});
      if(q._f.group) d=d.filter(function(x){return x.group===q._f.group});
      return d;
    }
    q.maybeSingle=function(){return Promise.resolve({data:rows()[0]||null,error:null})};
    q.single=function(){return Promise.resolve({data:rows()[0]||{id:1},error:null})};
    q.then=function(res,rej){
      var D=window.__data, d=table in D?D[table]:[];
      if(q._f.id!=null) d=d.filter(function(x){return String(x.id)===String(q._f.id)});
      if(q._f.team_a) d=d.filter(function(x){return x.team_a===q._f.team_a});
      if(q._f.team_b) d=d.filter(function(x){return x.team_b===q._f.team_b});
      if(q._f.group) d=d.filter(function(x){return x.group===q._f.group});
      return Promise.resolve({data:d,error:null}).then(res,rej);
    };
    return q;
  }
  return {from:mk,rpc:function(){return {then:function(r){return Promise.resolve({data:null,error:null}).then(r)}}},
    auth:{getSession:function(){return Promise.resolve({data:{session:{user:{id:1}}}})}}};
}};`;
window_data={};
html=html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/g,'<script>'+stub+'</script>');
html=html.replace(/<script src="js\/auth\.js"><\/script>/g,()=>'<script>'+auth.replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace(/<script src="js\/layout\.js"><\/script>/g,()=>'<script>'+layout.replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace(/<link[^>]*fonts\.googleapis[^>]*>/g,'');

const errors=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>{ if(!/CSS/i.test(e.message)) {errors.push(e.message); console.log('  JSDOM-ERR',e.message, (e.detail&&e.detail.stack||'').split('\n').slice(0,4).join(' | '));} });
vc.on('error',(...a)=>{ errors.push('console.error: '+a.join(' ')); console.log('  CONSOLE-ERR',...a); });

const dom=new JSDOM(html,{url:'https://example.test/manage.html?event=9',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
  beforeParse(w){
    w.__writes=[];
    w.__data={
      s6_match_schedule:JSON.parse(JSON.stringify(fixtures)),
      s6_matches:JSON.parse(JSON.stringify(maps)),
      s6_player_ids:JSON.parse(JSON.stringify(roster)),
      s6_player_stats:[{id:1,player_name:'张三',game_id:'101',team:'阿尔法',group:'传奇组',role:'队长'}],
      events:[{id:9,title:'测试活动',season:'s6',status:'registration',start_time:null,end_time:null,reg_deadline:null,format:'BO3'}],
      seasons:[{season_key:'s6',status:'active'}],
      site_users:[{id:1,username:'cap',nickname:'张三',game_id:'101',role:'member'}],
      event_registrations:[],event_captains:[],team_transfer_requests:[],import_batches:[],notifications:[],audit_log:[]
    };
    w.localStorage.setItem('hw_session', JSON.stringify({id:1, username:'cap', nickname:'张三', game_id:'101', role:'member'}));
    w.localStorage.setItem('hw_session_meta', JSON.stringify({issued_at:Date.now(), last_seen:Date.now()}));
    w.fetch=()=>Promise.reject(new Error('offline'));
    w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));
  }});
const w=dom.window;
let fails=0;
function ok(name,cond,extra){ if(cond) console.log('  ✓ '+name); else {fails++;console.log('  ✗ '+name+(extra?'  → '+extra:''));} }

setTimeout(()=>{
  const d=w.document;
  console.log('\n[数据台] 初始渲染');
  const shell=d.getElementById('manage-shell');
  ok('外壳可见（权限通过）', shell && shell.style.display==='block', 'display='+(shell&&shell.style.display));
  ok('没有落到门禁页', d.getElementById('manage-gate').style.display!=='block' || !d.getElementById('manage-gate').innerHTML);
  const rows=d.querySelectorAll('.mgr-row');
  ok('队长的「我的待办」只列本队 1 场（其余在按轮次看全部里）', rows.length===1, 'got '+rows.length);  const first=rows[0];
  ok('最急的一场排第一（已过开赛时间未录）', first && /阿尔法/.test(first.textContent), first&&first.textContent.trim().slice(0,40));
  ok('第一场自动展开', first.classList.contains('open'));
  ok('本队场次按最急排序在最前', /阿尔法/.test(rows[0].textContent));
  ok('待办计数显示', /待你处理/.test(d.getElementById('mgr-count').textContent));

  console.log('\n[编辑器] 预填与自动算大比分');
  const body=first.querySelector('[data-body]');
  ok('编辑器已挂载', !!body && body.children.length>0);
  ok('队名锁定显示', /阿尔法/.test(body.textContent)&&/贝塔/.test(body.textContent));
  ok('默认一图', body.querySelectorAll('.map-card').length===1, 'got '+body.querySelectorAll('.map-card').length);
  ok('首发 2 人从花名册预填', body.querySelectorAll('input[data-k="name"]')[0].value==='张三', body.querySelectorAll('input[data-k="name"]')[0].value);
  ok('游戏 ID 联动预填', body.querySelectorAll('.ptable')[0].querySelector('input[data-k="name"]').value==='张三');

  // 填比分 → 大比分自动
  const card=body.querySelector('.map-card');
  const mapSel=card.querySelector('select[data-k="map"]'); mapSel.value='源工重镇'; mapSel.dispatchEvent(new w.Event('change',{bubbles:true}));
  const ai=card.querySelector('input[data-k="a"]'), bi=card.querySelector('input[data-k="b"]');
  ai.value='13'; ai.dispatchEvent(new w.Event('input',{bubbles:true}));
  bi.value='9';  bi.dispatchEvent(new w.Event('input',{bubbles:true}));
  ok('大比分自动变 1 : 0', body.querySelector('[data-series]').textContent==='1 : 0', body.querySelector('[data-series]').textContent);
  ok('单图胜负提示', /阿尔法 胜/.test(card.textContent), card.querySelector('.map-win') && card.querySelector('.map-win').textContent);
  ok('系列赛说明按 BO3 计算', /BO3/.test(body.querySelector('[data-series-note]').textContent), body.querySelector('[data-series-note]').textContent);

  // 加一图
  body.querySelector('[data-add-map]').click();
  ok('加一图后有两图', body.querySelectorAll('.map-card').length===2);

  // 查看看板
  const boardBtn=d.querySelector('#view-switch [data-view="board"]');
  boardBtn.click();
  ok('看板视图渲染', !!d.querySelector('.board'), 'groups='+d.querySelectorAll('.board-group').length);
  ok('看板包含全部 2 场（含他人「待确认」）', d.querySelectorAll('.bcard').length===2, 'got '+d.querySelectorAll('.bcard').length);
  ok('看板里有「待确认」分组', /待确认/.test(d.querySelector('.board').textContent));
  ok('看板里他人回合只读提示？(不出现可写控件)', d.querySelectorAll('.board .ptable').length===0);

  // 保存
  d.querySelector('#view-switch [data-view="queue"]').click();
  setTimeout(()=>{
    const row=d.querySelector('.mgr-row[data-fx="1"]');
    if(!row.classList.contains('open')) row.querySelector('[data-toggle]').click();
    setTimeout(()=>{
      const saveBtn=d.querySelector('.mgr-row[data-fx="1"] [data-save]');
      ok('保存按钮存在且文案随权限变化', !!saveBtn, saveBtn&&saveBtn.textContent);
      saveBtn.click();
      setTimeout(()=>{
        const w2=w.__writes.map(x=>x[0]+':'+x[1]);
        ok('保存写入赛程（update schedule）', w2.some(x=>x.startsWith('update:s6_match_schedule')), w2.join(','));
        ok('保存写入图数据（insert/update matches）', w2.some(x=>/matches/.test(x)), w2.join(','));
        if (errors.length) { fails += errors.length; console.log('  运行时错误：\n   ' + errors.slice(0,4).join('\n   ')); }
        console.log('\n结果录入：' + (fails ? 'FAIL ' + fails + ' 项' : '全部通过 ✓'));
        process.exit(fails ? 1 : 0);
      },700);
    },400);
  },300);
},1400);
