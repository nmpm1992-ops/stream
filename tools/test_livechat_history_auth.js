require('dotenv').config();
const { io } = require('socket.io-client');

function extractJwt() {
  const rawCookie = process.env.PUMPFUN_COOKIE || '';
  const jwtFromEnv = process.env.PUMPFUN_JWT || '';
  const jwtFromCookie = rawCookie.match(/(?:^|;\\s*)auth_token=([^;]+)/)?.[1] || '';
  return { rawCookie, jwt: jwtFromEnv || jwtFromCookie };
}

const roomId = process.argv[2] || 'CpqA1pwX5SjU1SgufRwQ59knKGaDMEQ7MQBeu6mpump';
const { rawCookie, jwt } = extractJwt();
const username = process.env.PUMPFUN_USERNAME || 'viewer';

const extraHeaders = {
  'User-Agent': 'MeVoltOBS-Proxy/1.0',
  Origin: 'https://pump.fun',
  Referer: 'https://pump.fun/'
};
if (rawCookie) extraHeaders.Cookie = rawCookie;
if (jwt) {
  extraHeaders.Authorization = `Bearer ${jwt}`;
  extraHeaders['auth-token'] = jwt;
}

const socket = io('https://livechat.pump.fun', {
  transports: ['websocket', 'polling'],
  reconnection: false,
  timeout: 20000,
  extraHeaders,
  auth: jwt ? { token: jwt, auth_token: jwt, username } : undefined
});

socket.on('connect', () => {
  console.log('connected', socket.id, 'jwt?', !!jwt, 'cookie?', !!rawCookie);
  socket.emit('joinRoom', { roomId, username }, (ack) => {
    console.log('joinRoom ack', ack);
    socket.emit('getMessageHistory', { roomId, before: null, limit: 5 }, (history) => {
      console.log('history cb type', Array.isArray(history) ? 'array' : typeof history);
      console.log('history cb', history);
      socket.disconnect();
    });
  });
});

socket.on('connect_error', (err) => {
  console.error('connect_error', err.message);
});

