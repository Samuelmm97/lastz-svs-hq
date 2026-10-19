window.PLACEMENT_API_URL = 'https://state-798-placement-api.menagedsamuel.workers.dev';
window.PLACEMENT_SHARED_SOURCE_BASE = window.PLACEMENT_API_URL + '/api/atlas';

/* Access code handling. The code arrives once as ?k=<code> on a link handed out by
   leadership, is kept in localStorage, and is sent as X-Read-Key on every API call.
   Rotating the code on the Worker invalidates every link and every stored copy. */
(function () {
  const store = 'state798.readKey';
  try {
    const supplied = new URLSearchParams(location.search).get('k');
    if (supplied) {
      localStorage.setItem(store, supplied);
      const url = new URL(location.href); url.searchParams.delete('k');
      history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
    }
  } catch {}
  window.readKey = () => { try { return localStorage.getItem(store) || ''; } catch { return ''; } };
  window.readHeaders = extra => {
    const key = window.readKey();
    return Object.assign({}, extra || {}, key ? { 'X-Read-Key': key } : {});
  };
  window.needAccessCode = status => status === 401 || status === 403;
})();
