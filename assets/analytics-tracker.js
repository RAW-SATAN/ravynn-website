(function () {
  'use strict';

  function getSessionId() {
    let sid = sessionStorage.getItem('rv_sid');
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('rv_sid', sid);
    }
    return sid;
  }

  function getDevice() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  }

  function getUTM() {
    const params = new URLSearchParams(location.search);
    const keys = ['utm_source', 'utm_medium', 'utm_campaign'];
    const out = {};
    keys.forEach(k => {
      const v = params.get(k);
      if (v) { sessionStorage.setItem('rv_' + k, v); out[k] = v; }
      else { const sv = sessionStorage.getItem('rv_' + k); if (sv) out[k] = sv; }
    });
    return out;
  }

  function getReferrer() {
    const ref = document.referrer || '';
    if (!ref || ref.includes(location.hostname)) return null;
    if (/instagram\.com|l\.instagram/i.test(ref)) return 'instagram';
    if (/google\./i.test(ref)) return 'google';
    if (/facebook\.com|fb\./i.test(ref)) return 'facebook';
    if (/wa\.me|whatsapp/i.test(ref)) return 'whatsapp';
    if (/youtube\./i.test(ref)) return 'youtube';
    return ref.match(/^https?:\/\/([^/]+)/)?.[1] || 'other';
  }

  function getPage() {
    const path = location.pathname.split('/').pop() || 'index.html';
    const p = new URLSearchParams(location.search).get('p');
    return p ? path + '?p=' + p : path;
  }

  function send(payload) {
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  }

  function track(eventType, extra) {
    if (location.pathname.includes('adminn')) return;
    const utm = getUTM();
    send(Object.assign({
      event_type: eventType,
      session_id: getSessionId(),
      page: getPage(),
      referrer: getReferrer(),
      device_type: getDevice(),
      utm_source: utm.utm_source || null,
      utm_medium: utm.utm_medium || null,
      utm_campaign: utm.utm_campaign || null
    }, extra || {}));
  }

  // Fire pageview on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { track('pageview'); });
  } else {
    track('pageview');
  }

  // Heartbeat every 30s for live visitor count
  setInterval(function () { track('heartbeat'); }, 30000);

  // Expose globally for other scripts
  window.rvTrack = track;
})();
