const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const qrSection = document.getElementById('qrSection');
const qrContainer = document.getElementById('qrContainer');
const connectedMsg = document.getElementById('connectedMsg');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const removeFile = document.getElementById('removeFile');
const sendBtn = document.getElementById('sendBtn');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const sentCount = document.getElementById('sentCount');
const smsCount = document.getElementById('smsCount');
const failedCount = document.getElementById('failedCount');
const totalCount = document.getElementById('totalCount');
const currentContact = document.getElementById('currentContact');
const errorLog = document.getElementById('errorLog');
const resultsContainer = document.getElementById('resultsContainer');
const resultsBody = document.getElementById('resultsBody');
const englishTemplate = document.getElementById('englishTemplate');
const teluguTemplate = document.getElementById('teluguTemplate');
const saveTemplates = document.getElementById('saveTemplates');
const previewBtn = document.getElementById('previewBtn');
const previewSection = document.getElementById('previewSection');
const previewContent = document.getElementById('previewContent');
const closePreview = document.getElementById('closePreview');
const translateToTelugu = document.getElementById('translateToTelugu');
const translateToEnglish = document.getElementById('translateToEnglish');

let selectedFile = null;
let pollInterval = null;

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    statusDot.className = 'status-dot ' + data.connection;

    if (data.connection === 'connected') {
      statusText.textContent = 'WhatsApp Connected';
      qrSection.classList.add('hidden');
      connectedMsg.classList.remove('hidden');
    } else if (data.connection === 'waiting_qr') {
      statusText.textContent = 'Scan QR Code with WhatsApp';
      qrSection.classList.remove('hidden');
      connectedMsg.classList.add('hidden');
      if (data.qr) {
        qrContainer.innerHTML = `<img src="${data.qr}" alt="QR Code">`;
      }
    } else {
      statusText.textContent = 'Connecting...';
      qrSection.classList.remove('hidden');
      connectedMsg.classList.add('hidden');
    }

    if (data.progress.status === 'sending' || data.progress.status === 'completed') {
      updateProgress(data.progress);
    }
  } catch (err) {
    statusText.textContent = 'Server unreachable';
  }
}

function updateProgress(progress) {
  progressSection.classList.remove('hidden');
  const pct = progress.total > 0 ? ((progress.sent + progress.smsSent + progress.failed) / progress.total * 100) : 0;
  progressBar.style.width = pct + '%';
  sentCount.textContent = progress.sent;
  smsCount.textContent = progress.smsSent || 0;
  failedCount.textContent = progress.failed;
  totalCount.textContent = progress.total;
  currentContact.textContent = progress.current ? `Processing: ${progress.current}` : '';

  if (progress.results && progress.results.length > 0) {
    resultsContainer.classList.remove('hidden');
    resultsBody.innerHTML = progress.results.map((r) => `
      <tr>
        <td>${r.company}</td>
        <td>${r.phone}</td>
        <td class="method-${r.method.toLowerCase()}">${r.method}</td>
        <td class="status-${r.status}">${r.status === 'sent' ? 'Sent' : 'Failed'}</td>
        <td>${r.reason || '-'}</td>
      </tr>
    `).join('');
  }

  if (progress.errors.length > 0) {
    errorLog.classList.remove('hidden');
    errorLog.innerHTML = progress.errors.map((e) => `<div>${e}</div>`).join('');
  }

  if (progress.status === 'completed') {
    currentContact.textContent = 'All messages sent!';
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send Messages';
  }
}

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls'].includes(ext)) {
    alert('Only .xlsx and .xls files are allowed');
    return;
  }
  selectedFile = file;
  fileName.textContent = file.name;
  fileInfo.classList.remove('hidden');
  dropZone.classList.add('hidden');
  sendBtn.disabled = false;
}

removeFile.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.classList.remove('hidden');
  sendBtn.disabled = true;
});

sendBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';
  progressSection.classList.remove('hidden');

  const formData = new FormData();
  formData.append('excel', selectedFile);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Upload failed');
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send Messages';
      return;
    }

    console.log('Upload started:', data);
    startPolling();
  } catch (err) {
    alert('Error uploading file: ' + err.message);
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send Messages';
  }
});

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/progress');
      const progress = await res.json();
      updateProgress(progress);
      if (progress.status === 'completed' || progress.status === 'error') {
        clearInterval(pollInterval);
      }
    } catch (err) {}
  }, 1000);
}

async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    const data = await res.json();
    englishTemplate.value = data.english || '';
    teluguTemplate.value = data.telugu || '';
  } catch (err) {}
}

async function doTranslate(text, from, to) {
  const btn = from === 'en' ? translateToTelugu : translateToEnglish;
  const originalText = btn.textContent;
  btn.textContent = 'Translating...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from, to }),
    });
    const data = await res.json();
    if (data.translated) {
      if (to === 'te') {
        teluguTemplate.value = data.translated;
      } else {
        englishTemplate.value = data.translated;
      }
    }
  } catch (err) {
    alert('Translation failed: ' + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

translateToTelugu.addEventListener('click', () => {
  const text = englishTemplate.value.trim();
  if (!text) return alert('English template is empty');
  doTranslate(text, 'en', 'te');
});

translateToEnglish.addEventListener('click', () => {
  const text = teluguTemplate.value.trim();
  if (!text) return alert('Telugu template is empty');
  doTranslate(text, 'te', 'en');
});

saveTemplates.addEventListener('click', async () => {
  try {
    await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        english: englishTemplate.value,
        telugu: teluguTemplate.value,
      }),
    });
    alert('Templates saved!');
  } catch (err) {
    alert('Error saving templates');
  }
});

previewBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/preview');
    const data = await res.json();
    const preview = `--- Message 1 (English) ---\n${data.messages.english}\n\n--- Message 2 (Telugu) ---\n${data.messages.telugu}`;
    previewContent.textContent = preview;
    previewSection.classList.remove('hidden');
  } catch (err) {
    alert('Error loading preview');
  }
});

closePreview.addEventListener('click', () => {
  previewSection.classList.add('hidden');
});

loadTemplates();
checkStatus();
setInterval(checkStatus, 5000);
