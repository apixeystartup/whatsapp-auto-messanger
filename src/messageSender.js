const fs = require('fs');
const path = require('path');
const translate = require('google-translate-api-x');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function loadTemplate(lang) {
  const filePath = path.join(TEMPLATES_DIR, `${lang}.txt`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${lang}.txt`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function saveTemplate(lang, content) {
  const filePath = path.join(TEMPLATES_DIR, `${lang}.txt`);
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function translateText(text, fromLang, toLang) {
  try {
    const result = await translate(text, { from: fromLang, to: toLang });
    return result.text;
  } catch (err) {
    console.error('Translation error:', err.message);
    return text;
  }
}

function personalizeTemplate(template, contact) {
  let result = template
    .replace(/{greeting}/g, contact.name ? `Dear ${contact.name},` : 'Dear Sir/Madam,')
    .replace(/{name}/g, contact.name || '')
    .replace(/{phone}/g, contact.phone || '')
    .replace(/{company}/g, contact.company || '')
    .replace(/{date}/g, new Date().toLocaleDateString('en-IN'))
    .replace(/{business_name}/g, process.env.BUSINESS_NAME || 'Apixey');

  return result;
}

async function getMessages(contact) {
  const english = loadTemplate('english');
  const englishMsg = personalizeTemplate(english, contact);
  const teluguMsg = await translateText(englishMsg, 'en', 'te');

  return { english: englishMsg, telugu: teluguMsg };
}

async function sendSMS(phone, message) {
  const apiKey = process.env.TEXTBEE_API_KEY;
  const deviceId = process.env.TEXTBEE_DEVICE_ID;

  if (!apiKey || !deviceId) {
    return { success: false, error: 'textbee not configured. Set TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID in .env' };
  }

  try {
    const https = require('https');

    const postData = JSON.stringify({
      recipients: [`+${phone}`],
      message: message,
    });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.textbee.dev',
        path: `/api/v1/gateway/devices/${deviceId}/send-sms`,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            if (res.statusCode === 200 || res.statusCode === 201) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: `textbee error: ${body.message || body.error || data}` });
            }
          } catch {
            resolve({ success: false, error: `textbee invalid response: ${data}` });
          }
        });
      });
      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.write(postData);
      req.end();
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { loadTemplate, saveTemplate, personalizeTemplate, getMessages, translateText, sendSMS };
