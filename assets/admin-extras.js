/* CWS admin extras: analytics, activity, search/filter. Read-only: uses existing API data, changes no data. */
(function(){
  var J=function(u){return fetch(u,{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})};
  var $=function(i){return document.getElementById(i)};
  var money=function(n){return '$'+(Number(n)||0).toFixed(2)};
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
  function box(){
    var s=$('userSummary');if(!s)return null;
    var d=document.createElement('div');d.id='adminInsights';d.setAttribute('data-admin-only','');
    d.innerHTML='<div class="admin-stats" id="aiStats"></div><div class="table-wrap panel"><div class="admin-panel-header"><h3>Revenue, last 6 months</h3><p>Paid orders only.</p></div><div class="ai-bars" id="aiBars"></div></div><div class="table-wrap panel"><div class="admin-panel-header"><h3>Recent activity</h3></div><ul class="ai-feed" id="aiFeed"></ul></div>';
    s.parentNode.insertBefore(d,s.nextSibling);return d;
  }
  function filterBar(anchor,id,ph,opts){
    var w=document.createElement('div');w.className='ai-filter';
    w.innerHTML='<input type="search" id="'+id+'Q" placeholder="'+ph+'" aria-label="'+ph+'" />'+
      '<select id="'+id+'S" aria-label="Filter">'+opts.map(function(o){return'<option value="'+o[0]+'">'+o[1]+'</option>'}).join('')+'</select>';
    anchor.parentNode.insertBefore(w,anchor);return w;
  }
  function wire(id,rowSel,statusAttr){
    function run(){
      var q=$(id+'Q').value.toLowerCase(),st=$(id+'S').value;
      document.querySelectorAll(rowSel).forEach(function(r){
        var t=r.textContent.toLowerCase(),ok=(!q||t.indexOf(q)>-1)&&(!st||t.indexOf(st)>-1);
        r.style.display=ok?'':'none';
      });
    }
    $(id+'Q').addEventListener('input',run);$(id+'S').addEventListener('change',run);
    var tgt=document.querySelector(rowSel.split(' ')[0]);
    if(tgt)new MutationObserver(run).observe(tgt,{childList:true});
  }
  Promise.all([J('/api/admin/users'),J('/api/orders')]).then(function(r){
    if(!r[0]||!r[1])return; /* not admin or server offline */
    var users=r[0].users||[],orders=r[1].orders||[],host=box();if(!host)return;
    var paid=orders.filter(function(o){return o.status==='paid'});
    var wait=orders.filter(function(o){return o.status==='pending'||o.status==='awaiting_confirmation'});
    var rev=paid.reduce(function(a,o){return a+Number(o.amount||0)},0);
    var cards=[['Total revenue',money(rev)],['Total orders',orders.length],['Pending payments',wait.length],['Completed orders',paid.length],['Registered users',users.filter(function(u){return u.role!=='admin'}).length]];
    $('aiStats').innerHTML=cards.map(function(c){return'<div class="ai-stat"><strong>'+c[0+1]+'</strong><span>'+c[0]+'</span></div>'}).join('');
    var months=[],now=new Date();
    for(var i=5;i>=0;i--){var d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({k:d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2),l:d.toLocaleString('en',{month:'short'}),v:0})}
    paid.forEach(function(o){var k=String(o.paid_at||o.created_at||'').slice(0,7);months.forEach(function(m){if(m.k===k)m.v+=Number(o.amount||0)})});
    var mx=Math.max.apply(null,months.map(function(m){return m.v}))||1;
    $('aiBars').innerHTML=months.map(function(m){return'<div class="ai-bar"><i style="height:'+Math.max(m.v/mx*100,2)+'%"></i><b>'+money(m.v)+'</b><span>'+m.l+'</span></div>'}).join('');
    var ev=[];
    orders.slice(0,8).forEach(function(o){ev.push([o.created_at,'New order: '+esc(o.service_name)+' by '+esc(o.buyer_name||'guest')+' ('+esc(o.status.replace('_',' '))+')'])});
    users.slice(0,5).forEach(function(u){ev.push([u.created_at,'New account: '+esc(u.name)])});
    ev.sort(function(a,b){return String(b[0]).localeCompare(String(a[0]))});
    $('aiFeed').innerHTML=ev.slice(0,8).map(function(e){return'<li><small>'+esc(String(e[0]).slice(0,16))+'</small> '+e[1]+'</li>'}).join('')||'<li>No activity yet.</li>';
    var ot=document.querySelector('#ordersTableBody');
    if(ot){filterBar(ot.closest('table'),'aiOrd','Search orders, buyers, codes',[['','All statuses'],['paid','Paid'],['pending','Pending'],['awaiting','Awaiting confirmation'],['cancelled','Cancelled']]);wire('aiOrd','#ordersTableBody tr');}
    var dl=$('designList');
    if(dl){filterBar(dl,'aiDes','Search designs',[['','All'],['flyer','Flyer'],['poster','Poster'],['branding','Branding'],['event','Event'],['church','Church'],['social','Social'],['booked','Booked']]);wire('aiDes','#designList > *');}
  });
})();
