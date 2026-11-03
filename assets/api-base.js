/* Where the server lives. The pages can be served from GitHub Pages while the Node server runs on Render.
   On cwsmultimediaconnect.co.zw every call to /api/... is sent to api.cwsmultimediaconnect.co.zw with the login cookie.
   Anywhere else (localhost, the onrender address) it stays on the same address. Override with window.CWS_API = 'https://...' before this file. */
(function () {
  var host = location.hostname;
  var api = window.CWS_API || '';
  if (!api && /(^|\.)cwsmultimediaconnect\.co\.zw$/.test(host) && host.indexOf('api.') !== 0) {
    api = 'https://api.cwsmultimediaconnect.co.zw';
  }
  window.CWS_API = api;
  if (!api || !window.fetch) return;
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.indexOf('/api/') === 0) {
      input = api + input;
      init = Object.assign({}, init, { credentials: 'include' });
    }
    return nativeFetch(input, init);
  };
  // Download links built from the server's relative path
  window.cwsApiUrl = function (p) { return p && p.charAt(0) === '/' ? api + p : p; };
})();
