const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const SESSION_DIR = path.join(__dirname, '..', 'session');
const logger = pino({ level: 'silent' });

let socket = null;
let qrCode = null;
let connectionStatus = 'disconnected';
let reconnectAttempts = 0;

function clearSession() {
  if (fs.existsSync(SESSION_DIR)) {
    fs.readdirSync(SESSION_DIR).forEach((file) => {
      fs.unlinkSync(path.join(SESSION_DIR, file));
    });
  }
}

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    socket = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser: ['Chrome', 'Safari', '3.0'],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      markOnlineOnConnect: false,
      retryRequestDelayMs: 200,
      transactionOpts: { maxCommitRetries: 10 },
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = await qrcode.toDataURL(qr);
        connectionStatus = 'waiting_qr';
        console.log('QR Code generated. Scan with WhatsApp.');
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log(`Connection closed. Reason: ${reason}`);

        if (reason === 401) {
          console.log('Logged out. Clearing session...');
          clearSession();
          reconnectAttempts = 0;
          setTimeout(connectToWhatsApp, 3000);
        } else if (reason !== -1) {
          reconnectAttempts++;
          const delay = Math.min(reconnectAttempts * 5000, 30000);
          console.log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})`);
          setTimeout(connectToWhatsApp, delay);
        }
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        qrCode = null;
        reconnectAttempts = 0;
        console.log('WhatsApp connected successfully!');
      }
    });

    socket.ev.on('messages.upsert', () => {});
  } catch (err) {
    console.error('Connection error:', err.message);
    connectionStatus = 'error';
    setTimeout(connectToWhatsApp, 5000);
  }
}

function getSocket() {
  return socket;
}

function getQRCode() {
  return qrCode;
}

function getConnectionStatus() {
  return connectionStatus;
}

function isConnected() {
  return connectionStatus === 'connected';
}

module.exports = {
  connectToWhatsApp,
  getSocket,
  getQRCode,
  getConnectionStatus,
  isConnected,
  clearSession,
};
