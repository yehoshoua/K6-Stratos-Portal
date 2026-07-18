// WebSocket — maintain connections under load.
// Env: WS_URL (e.g. wss://example.com/ws)
import ws from 'k6/ws';
import { check } from 'k6';

const WS_URL = __ENV.WS_URL || 'wss://test.k6.io/ws';

export const options = {
  vus: 10,
  duration: '2m',
  thresholds: { checks: ['rate>0.95'] },
};

export default function () {
  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'ping' }));
    });
    socket.on('message', (msg) => {
      check(msg, { 'message received': (m) => m.length > 0 });
      socket.close();
    });
    socket.setTimeout(() => socket.close(), 10000);
  });
  check(res, { 'ws status 101': (r) => r && r.status === 101 });
}
