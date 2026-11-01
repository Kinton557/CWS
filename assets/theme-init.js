/* Runs before first paint: applies saved or system theme, flags JS for reveal animations. */
(function(){var d=document.documentElement,t=null;
try{t=localStorage.getItem('cws-theme')}catch(e){}
if(t!=='light'&&t!=='dark'){t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}
d.setAttribute('data-theme',t);})();
