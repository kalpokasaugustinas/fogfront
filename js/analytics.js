// anonymous play counter: GoatCounter (no cookies, no personal data, no consent banner needed).
// counts page views plus a few game events (modes started, tutorial, wins, conquest stages).
// off while code is empty, and never on localhost (tests)
const code = '';   // goatcounter site code: https://<code>.goatcounter.com

const on = () => !!code && !/^(localhost|127\.)/.test(location.hostname);

export function initAnalytics() {
  if (!on()) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  document.head.appendChild(s);
}

// one game event, e.g. track('conquest-stage-3'); events before the script loads are dropped
export function track(name) {
  if (!on()) return;
  try { window.goatcounter?.count?.({ path: `event/${name}`, title: name, event: true }); } catch { /* blocked */ }
}
