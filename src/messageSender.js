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
  const provider = process.env.SMS_PROVIDER || 'twilio';

  if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return { success: false, error: 'Twilio not configured. Set TWILIO_* in .env' };
    }

    try {
      const https = require('https');
      const querystring = require('querystring');

      const postData = querystring.stringify({
        To: `+${phone}`,
        From: fromNumber,
        Body: message,
      });

      return new Promise((resolve) => {
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
        const req = https.request({
          hostname: 'api.twilio.com',
          path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': postData.length,
          },
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 201 || res.statusCode === 200) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: `Twilio error: ${res.statusCode}` });
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

  return { success: false, error: `Unknown SMS provider: ${provider}` };
}

module.exports = { loadTemplate, saveTemplate, personalizeTemplate, getMessages, translateText, sendSMS };
