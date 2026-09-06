require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { connectToWhatsApp, getQRCode, getConnectionStatus, isConnected, getSocket } = require('./whatsapp');
const { parseExcel } = require('./excelParser');
const { loadTemplate, saveTemplate, getMessages, translateText, sendSMS } = require('./messageSender');

const app = express();
const PORT = process.env.PORT || 3000;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 10;
const DELAY_MSG = parseInt(process.env.DELAY_BETWEEN_MESSAGES_MS) || 500;
const DELAY_LANG = parseInt(process.env.DELAY_BETWEEN_LANGUAGES_MS) || 300;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx and .xls files are allowed'));
    }
  },
});

let sendProgress = {
  status: 'idle',
  total: 0,
  sent: 0,
  smsSent: 0,
  failed: 0,
  current: '',
  errors: [],
  results: [],
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get('/api/status', (req, res) => {
  res.json({
    connection: getConnectionStatus(),
    qr: getQRCode(),
    progress: sendProgress,
    config: { batchSize: BATCH_SIZE, delayMsg: DELAY_MSG, delayLang: DELAY_LANG },
  });
});

app.get('/api/qr', async (req, res) => {
  const qr = getQRCode();
  if (qr) {
    res.json({ qr });
  } else if (isConnected()) {
    res.json({ connected: true });
  } else {
    res.json({ qr: null });
  }
});

app.get('/api/templates', (req, res) => {
  try {
    const english = loadTemplate('english');
    const telugu = loadTemplate('telugu');
    res.json({ english, telugu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/templates', (req, res) => {
  try {
    const { english, telugu } = req.body;
    if (english !== undefined) saveTemplate('english', english);
    if (telugu !== undefined) saveTemplate('telugu', telugu);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/translate', async (req, res) => {
  try {
    const { text, from, to } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    const translated = await translateText(text, from, to);
    res.json({ translated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload', upload.single('excel'), async (req, res) => {
  if (!isConnected()) {
    return res.status(400).json({ error: 'WhatsApp not connected. Scan QR code first.' });
  }

  if (sendProgress.status === 'sending') {
    return res.status(400).json({ error: 'Already sending messages. Please wait.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const result = parseExcel(req.file.path);
    fs.unlinkSync(req.file.path);

    sendProgress = {
      status: 'sending',
      total: result.total,
      sent: 0,
      smsSent: 0,
      failed: 0,
      current: '',
      errors: [],
      results: [],
      mapping: result.detectedMapping,
    };

    res.json({
      success: true,
      total: result.total,
      mapping: result.detectedMapping,
      sample: result.contacts.slice(0, 3),
    });

    sendMessages(result.contacts);
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/progress', (req, res) => {
  res.json(sendProgress);
});

app.get('/api/preview', async (req, res) => {
  try {
    const sample = { name: 'Rahul', phone: '919876543210', company: 'TechCorp' };
    const messages = await getMessages(sample);
    res.json({ messages, sample });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function sendOne(sock, contact) {
  const label = contact.company || contact.phone;

  try {
    const jid = `${contact.phone}@s.whatsapp.net`;
    const exists = await sock.onWhatsApp(jid);

    if (!exists || !exists[0]?.exists) {
      const messages = await getMessages(contact);
      const smsResult = await sendSMS(contact.phone, messages.english + '\n\n' + messages.telugu);

      if (smsResult.success) {
        sendProgress.smsSent++;
        sendProgress.results.push({ phone: contact.phone, company: label, method: 'SMS', status: 'sent' });
      } else {
        sendProgress.failed++;
        const reason = smsResult.error || 'Not on WhatsApp & SMS failed';
        sendProgress.errors.push(`${label} (${contact.phone}) - ${reason}`);
        sendProgress.results.push({ phone: contact.phone, company: label, method: 'none', status: 'failed', reason });
      }
      return;
    }

    const messages = await getMessages(contact);

    await sock.sendMessage(jid, { text: messages.english });
    await delay(DELAY_LANG);
    await sock.sendMessage(jid, { text: messages.telugu });

    sendProgress.sent++;
    sendProgress.results.push({ phone: contact.phone, company: label, method: 'WhatsApp', status: 'sent' });
  } catch (err) {
    sendProgress.failed++;
    const reason = err.message || 'Unknown error';
    sendProgress.errors.push(`${label} (${contact.phone}) - ${reason}`);
    sendProgress.results.push({ phone: contact.phone, company: label, method: 'none', status: 'failed', reason });
  }
}

async function sendMessages(contacts) {
  const sock = getSocket();
  if (!sock) {
    sendProgress.status = 'error';
    sendProgress.errors.push('WhatsApp socket not available');
    return;
  }

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const progress = Math.min(i + BATCH_SIZE, contacts.length);
    sendProgress.current = `Batch ${Math.floor(i / BATCH_SIZE) + 1} - ${progress}/${contacts.length}`;

    const promises = batch.map((contact) => sendOne(sock, contact));
    await Promise.all(promises);

    if (i + BATCH_SIZE < contacts.length) {
      await delay(DELAY_MSG);
    }
  }

  sendProgress.status = 'completed';
  sendProgress.current = '';
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Speed: ${BATCH_SIZE} parallel msgs, ${DELAY_MSG}ms batch delay, ${DELAY_LANG}ms lang delay`);
  connectToWhatsApp();
});
