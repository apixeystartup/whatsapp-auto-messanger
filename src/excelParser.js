const XLSX = require('xlsx');

function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);

  if (data.length === 0) {
    throw new Error('Excel file is empty');
  }

  const headers = Object.keys(data[0]);
  const phoneCol = findColumn(headers, ['phone', 'phone number', 'mobile', 'mobile number', 'contact', 'number', 'whatsapp']);
  const nameCol = findColumn(headers, ['name', 'full name', 'client name', 'contact name']);
  const companyCol = findColumn(headers, ['company', 'company name', 'organization', 'org', 'firm', 'business']);

  if (!phoneCol) {
    throw new Error(`No phone column found. Available columns: ${headers.join(', ')}`);
  }
  if (!companyCol) {
    throw new Error(`No company column found. Available columns: ${headers.join(', ')}`);
  }

  const contacts = data.map((row) => {
    let phone = String(row[phoneCol] || '').trim();
    phone = phone.replace(/[^0-9]/g, '');
    if (phone.length === 10) {
      phone = '91' + phone;
    }
    if (!phone.startsWith('91') && phone.length === 12) {
      phone = phone;
    }

    return {
      name: nameCol ? String(row[nameCol] || '').trim() : '',
      phone: phone,
      company: String(row[companyCol] || '').trim(),
      raw: row,
    };
  }).filter((c) => c.phone && c.phone.length >= 12);

  if (contacts.length === 0) {
    throw new Error('No valid contacts found. Ensure phone numbers are 10 digits.');
  }

  return {
    contacts,
    total: contacts.length,
    columns: headers,
    detectedMapping: { phone: phoneCol, name: nameCol, company: companyCol },
  };
}

function findColumn(headers, aliases) {
  for (const alias of aliases) {
    const found = headers.find((h) => h.toLowerCase().trim() === alias);
    if (found) return found;
  }
  for (const alias of aliases) {
    const found = headers.find((h) => h.toLowerCase().includes(alias));
    if (found) return found;
  }
  return null;
}

module.exports = { parseExcel };
