const { io } = require('socket.io-client');

const roomId = process.argv[2] || 'CpqA1pwX5SjU1SgufRwQ59knKGaDMEQ7MQBeu6mpump';
const username = process.argv[3] || 'viewer';

const socket = io('https://livechat.pump.fun', {
  transports: ['websocket', 'polling'],
  reconnection: false,
  timeout: 20000
});

socket.on('connect', () => {
  console.log('connected', socket.id);
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

