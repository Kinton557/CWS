/* CWS site behaviour: theme toggle, mobile menu, reveal-on-scroll, page transitions. No dependencies. */
(function(){
  var root=document.documentElement;
  function store(k,v){try{localStorage.setItem(k,v)}catch(e){}}
  function setTheme(t){root.setAttribute('data-theme',t);store('cws-theme',t);
    document.querySelectorAll('.theme-toggle').forEach(function(b){b.setAttribute('aria-pressed',t==='light');b.setAttribute('aria-label',t==='light'?'Switch to dark theme':'Switch to light theme')});
    var m=document.querySelector('meta[name=theme-color]');if(m)m.content=t==='light'?'#f6f4ef':'#0b0e13';}
  document.addEventListener('DOMContentLoaded',function(){
    setTheme(root.getAttribute('data-theme')||'dark');
    document.body.classList.add('page-in');
    document.addEventListener('click',function(e){
      var tg=e.target.closest('.theme-toggle');if(tg){setTheme(root.getAttribute('data-theme')==='light'?'dark':'light');return}
      var nt=e.target.closest('.nav-toggle');
      if(nt){var nb=nt.closest('.navbar'),open=nb.classList.toggle('nav-open');nt.setAttribute('aria-expanded',open)}
    });
    // current page marker in nav
    var here=location.pathname.split('/').pop()||'index.html';
    document.querySelectorAll('.nav-links a').forEach(function(a){if(a.getAttribute('href')===here)a.setAttribute('aria-current','page')});
    // reveal on scroll. Content is visible by default; hiding only starts here, and a timer guarantees everything shows.
    var els=document.querySelectorAll('.reveal');
    function showAll(){els.forEach(function(el){el.classList.add('in')})}
    try{
      if('IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
        root.classList.add('reveal-on');
        var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}})},{threshold:0,rootMargin:'0px 0px -4% 0px'});
        els.forEach(function(el){io.observe(el)});
        setTimeout(showAll,2500);
      }else showAll();
    }catch(err){root.classList.remove('reveal-on');showAll()}
    // light page transition for same-site links
    document.addEventListener('click',function(e){
      var a=e.target.closest('a[href]');
      if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||a.target==='_blank'||a.hasAttribute('download'))return;
      var u=new URL(a.href,location.href);
      if(u.origin!==location.origin||(u.pathname===location.pathname&&u.hash)||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      e.preventDefault();document.body.classList.add('leaving');setTimeout(function(){location.href=a.href},150);
    });
    window.addEventListener('pageshow',function(e){if(e.persisted)document.body.classList.remove('leaving')});
  });
})();
