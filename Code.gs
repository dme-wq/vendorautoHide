// ============================================================
//  VendorBill Auto-Hide System — Code.gs
//  Backend: Google Apps Script
//  Author:  AI-powered by Antigravity + Gemini
//  Version: 2.0.0
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
const CONFIG = {
  SOURCE_FOLDER_ID: '1WUsajzUXRV8w_PaIrNMm71mGyg_zZPI8',
  OUTPUT_FOLDER_ID: '1prX-2GkR0_aJZWB1FDmo3zKlVeiEEUL9',
  // ✅ SECURE: Key is stored in Apps Script Script Properties (NOT in this file)
  //    → Go to: Apps Script IDE → Project Settings → Script Properties
  //    → Add: Name = GEMINI_API_KEY  |  Value = your key
  GEMINI_API_KEY:   '',  // Leave blank here — loaded from Script Properties below
  PROCESSED_TAG:    '[VENDOR-SAFE]',
  LOG_SHEET_NAME:   'ProcessingLog',
  MAX_RETRIES:      3,
  HIDE_FIELDS: [
    'total amount', 'grand total', 'net amount', 'taxable amount',
    'invoice value', 'total value', 'amount payable', 'total payable',
    'cgst', 'sgst', 'igst', 'gst amount', 'tax amount', 'total tax',
    'cess', 'total gst', 'subtotal', 'sub total', 'basic amount',
    'discount amount', 'total discount', 'round off', 'final amount',
    'bill amount', 'invoice amount', 'assessable value',
    'total assessable', 'total invoice', 'e-way bill value',
    'consignment value', 'total consignment', 'rate', 'price',
    'unit price', 'basic rate', 'mrp', 'freight charges'
  ]
};

function getGeminiApiKey() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || CONFIG.GEMINI_API_KEY;
}

// ── ENTRY POINTS ─────────────────────────────────────────────
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'getLogs')     return jsonResponse(getLogs());
  if (action === 'getStats')    return jsonResponse(getStats());
  if (action === 'processNow')  return jsonResponse(processAllPendingFiles());
  if (action === 'health')      return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('VendorBill Auto-Hide Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'processFile' && data.fileId) return jsonResponse(processFile(data.fileId));
    if (data.action === 'processAll') return jsonResponse(processAllPendingFiles());
    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── TRIGGER SETUP ────────────────────────────────────────────
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoProcessNewFiles').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('dailyMaintenance').timeBased().atHour(1).everyDays(1).create();
  logEvent('INFO', 'Triggers set up successfully');
  return { success: true, message: 'Triggers configured. Auto-processing every 5 minutes.' };
}

// ── CORE PROCESSING ──────────────────────────────────────────
function autoProcessNewFiles() {
  try {
    const sourceFolder = DriveApp.getFolderById(CONFIG.SOURCE_FOLDER_ID);
    const files = sourceFolder.getFiles();
    let processed = 0;
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed()) continue;
      if (isAlreadyProcessed(file.getId())) continue;
      try { processFile(file.getId()); processed++; }
      catch (err) { logEvent('ERROR', 'Failed to process ' + file.getName() + ': ' + err.message); }
    }
    if (processed > 0) logEvent('INFO', 'Auto-processed ' + processed + ' new file(s)');
    return { processed };
  } catch (err) {
    logEvent('ERROR', 'autoProcessNewFiles error: ' + err.message);
    throw err;
  }
}

function processAllPendingFiles() {
  const sourceFolder = DriveApp.getFolderById(CONFIG.SOURCE_FOLDER_ID);
  const files = sourceFolder.getFiles();
  const results = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed() || isAlreadyProcessed(file.getId())) continue;
    try {
      const result = processFile(file.getId());
      results.push({ file: file.getName(), status: 'success', outputId: result.outputFileId });
    } catch (err) {
      results.push({ file: file.getName(), status: 'error', error: err.message });
    }
  }
  return { total: results.length, results };
}

function processFile(fileId) {
  const file = DriveApp.getFileById(fileId);
  const mimeType = file.getMimeType();
  const fileName = file.getName();
  logEvent('INFO', 'Processing: ' + fileName + ' (' + mimeType + ')');

  let outputFileId;
  if (mimeType === MimeType.PDF)                    outputFileId = processPdf(file);
  else if (mimeType === MimeType.GOOGLE_DOCS)       outputFileId = processGoogleDoc(file);
  else if (mimeType === MimeType.GOOGLE_SHEETS)     outputFileId = processGoogleSheet(file);
  else if (mimeType.startsWith('image/'))           outputFileId = processImage(file);
  else if (/word|docx/i.test(mimeType))             outputFileId = processWordDoc(file);
  else if (/excel|xlsx|spreadsheet/i.test(mimeType)) outputFileId = processExcelFile(file);
  else throw new Error('Unsupported file type: ' + mimeType);

  markAsProcessed(fileId, outputFileId, fileName);
  logEvent('SUCCESS', 'Processed: ' + fileName + ' Output ID: ' + outputFileId);
  return { success: true, inputFileId: fileId, outputFileId, fileName };
}

// ── FILE TYPE PROCESSORS ─────────────────────────────────────
function processPdf(file) {
  const fileName = file.getName().replace(/\.pdf$/i, '');
  
  // Try Gemini AI-assisted processing first
  const aiContent = enhancedGeminiPdfAnalysis(file.getBlob(), fileName);
  
  if (aiContent) {
    return createRedactedDocFromAiContent(aiContent, fileName, file.getName());
  }

  // Fallback: OCR-based processing
  const resource = { title: 'TEMP_OCR_' + fileName, mimeType: MimeType.GOOGLE_DOCS };
  const ocrFile = Drive.Files.copy(resource, file.getId(), { ocr: true, ocrLanguage: 'en' });
  const docId = ocrFile.id;
  try {
    const doc = DocumentApp.openById(docId);
    redactDocumentAmounts(doc);
    addRedactionWatermark(doc);
    doc.saveAndClose();
    return exportDocAsPdf(docId, fileName);
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {}
  }
}

function processGoogleDoc(file) {
  const fileName = file.getName();
  const copy = file.makeCopy('TEMP_' + fileName);
  const docId = copy.getId();
  try {
    const doc = DocumentApp.openById(docId);
    redactDocumentAmounts(doc);
    addRedactionWatermark(doc);
    doc.saveAndClose();
    return exportDocAsPdf(docId, fileName);
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {}
  }
}

function processGoogleSheet(file) {
  const fileName = file.getName();
  const copy = file.makeCopy('TEMP_' + fileName);
  const sheetId = copy.getId();
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    redactSpreadsheetAmounts(ss);
    SpreadsheetApp.flush();
    return exportSheetAsPdf(sheetId, fileName);
  } finally {
    try { DriveApp.getFileById(sheetId).setTrashed(true); } catch (e) {}
  }
}

function processImage(file) {
  const fileName = file.getName().replace(/\.[^.]+$/, '');
  const imageBlob = file.getBlob();
  const base64Image = Utilities.base64Encode(imageBlob.getBytes());
  const extractedText = analyzeWithGemini(base64Image, file.getMimeType());
  return createRedactedDocFromAiContent(extractedText, fileName, file.getName());
}

function processWordDoc(file) {
  const fileName = file.getName().replace(/\.(docx?|doc)$/i, '');
  const resource = { title: 'TEMP_WORD_' + fileName, mimeType: MimeType.GOOGLE_DOCS };
  const converted = Drive.Files.copy(resource, file.getId(), {});
  const docId = converted.id;
  try {
    const doc = DocumentApp.openById(docId);
    redactDocumentAmounts(doc);
    addRedactionWatermark(doc);
    doc.saveAndClose();
    return exportDocAsPdf(docId, fileName);
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {}
  }
}

function processExcelFile(file) {
  const fileName = file.getName().replace(/\.(xlsx?|xls)$/i, '');
  const resource = { title: 'TEMP_EXCEL_' + fileName, mimeType: MimeType.GOOGLE_SHEETS };
  const converted = Drive.Files.copy(resource, file.getId(), {});
  const sheetId = converted.id;
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    redactSpreadsheetAmounts(ss);
    SpreadsheetApp.flush();
    return exportSheetAsPdf(sheetId, fileName);
  } finally {
    try { DriveApp.getFileById(sheetId).setTrashed(true); } catch (e) {}
  }
}

// ── REDACTION LOGIC ──────────────────────────────────────────
function redactDocumentAmounts(doc) {
  const body = doc.getBody();

  // Redact paragraphs containing hide-fields
  const paragraphs = body.getParagraphs();
  paragraphs.forEach(function(para) {
    const text = para.getText().toLowerCase();
    const shouldRedact = CONFIG.HIDE_FIELDS.some(function(f) { return text.includes(f); });
    if (shouldRedact) redactAmountInParagraph(para);
  });

  // Redact tables
  const tables = body.getTables();
  tables.forEach(function(table) { redactTableAmounts(table); });

  // Pattern-based replaceText for currency values after keywords
  const patterns = [
    ['((?:Total Amount|Grand Total|Net Amount|Amount Payable|Invoice Value|Taxable Value)[\\s:₹Rs.]*)[\\d,]+\\.?\\d*', '$1████████'],
    ['((?:CGST|SGST|IGST|GST|Tax Amount|Total Tax)[\\s:@%\\d.]*[\\s:₹Rs.]*)[\\d,]+\\.?\\d*', '$1████████'],
    ['₹\\s*[\\d,]+\\.?\\d*', '₹ ████████'],
    ['Rs\\.?\\s*[\\d,]+\\.?\\d*', 'Rs. ████████'],
    ['INR\\s*[\\d,]+\\.?\\d*', 'INR ████████'],
  ];
  patterns.forEach(function(p) {
    try { body.replaceText(p[0], p[1]); } catch(e) {}
  });
}

function redactTableAmounts(table) {
  const numRows = table.getNumRows();
  if (numRows === 0) return;
  const numCols = table.getRow(0).getNumCells();
  const amountColIndices = detectAmountColumns(table, numRows, numCols);

  for (let r = 0; r < numRows; r++) {
    const row = table.getRow(r);
    const rowText = row.getText().toLowerCase();
    const isAmountRow = CONFIG.HIDE_FIELDS.some(function(f) { return rowText.includes(f); });

    for (let c = 0; c < numCols; c++) {
      const cell = row.getCell(c);
      const cellText = cell.getText().trim();
      if ((amountColIndices.has(c) || isAmountRow) && isMonetaryValue(cellText)) {
        try {
          cell.editAsText().setText('████████');
        } catch(e) {}
      }
    }
  }
}

function detectAmountColumns(table, numRows, numCols) {
  const amountCols = new Set();
  const headerRow = table.getRow(0);
  for (let c = 0; c < numCols; c++) {
    const h = headerRow.getCell(c).getText().toLowerCase();
    if (CONFIG.HIDE_FIELDS.some(function(f){ return h.includes(f); }) ||
        /amount|value|price|rate|total|tax|gst|cgst|sgst|igst|cess|freight/i.test(h)) {
      amountCols.add(c);
    }
  }
  // Auto-detect last column if it contains mostly numbers
  if (numRows > 2 && numCols > 0) {
    const lastC = numCols - 1;
    let numCount = 0;
    for (let r = 1; r < Math.min(numRows, 5); r++) {
      if (isMonetaryValue(table.getRow(r).getCell(lastC).getText())) numCount++;
    }
    if (numCount >= 2) amountCols.add(lastC);
  }
  return amountCols;
}

function redactAmountInParagraph(para) {
  const text = para.getText();
  const redacted = text
    .replace(/₹\s*[\d,]+\.?\d*/g, '₹ ████████')
    .replace(/Rs\.?\s*[\d,]+\.?\d*/gi, 'Rs. ████████')
    .replace(/INR\s*[\d,]+\.?\d*/gi, 'INR ████████')
    .replace(/:\s*[\d,]{3,}\.?\d*/g, ': ████████');
  if (text !== redacted) {
    try { para.editAsText().setText(redacted); } catch(e) {}
  }
}

function redactSpreadsheetAmounts(ss) {
  ss.getSheets().forEach(function(sheet) {
    const data = sheet.getDataRange().getValues();
    const numRows = data.length;
    const numCols = numRows > 0 ? data[0].length : 0;
    const amountCols = new Set();

    // Detect amount columns from header
    if (numRows > 0) {
      for (let c = 0; c < numCols; c++) {
        const h = String(data[0][c]).toLowerCase();
        if (CONFIG.HIDE_FIELDS.some(function(f){ return h.includes(f); }) ||
            /amount|value|price|rate|total|tax|gst|cgst|sgst|igst/i.test(h)) {
          amountCols.add(c);
        }
      }
    }

    for (let r = 0; r < numRows; r++) {
      const rowLabel = String(data[r][0]).toLowerCase();
      const isAmountRow = CONFIG.HIDE_FIELDS.some(function(f){ return rowLabel.includes(f); });
      for (let c = 0; c < numCols; c++) {
        const cellVal = data[r][c];
        if ((amountCols.has(c) || isAmountRow) && isNumericAmount(cellVal)) {
          const cellRef = sheet.getRange(r + 1, c + 1);
          cellRef.setValue('████████');
          cellRef.setFontColor('#1a1a1a');
          cellRef.setBackground('#1a1a1a');
        }
      }
    }
  });
}

// ── GEMINI AI ────────────────────────────────────────────────
function analyzeWithGemini(base64Image, mimeType) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return 'Gemini API Key not set. Add GEMINI_API_KEY in Script Properties.';

  const prompt = 'You are analyzing an Indian vendor bill/invoice/e-waybill.\n\nExtract ALL details EXCEPT monetary amounts:\n- DO include: Item names, Quantity (Qty), Units/UOM, HSN/SAC codes\n- DO include: Bill number, Date, Vendor name, Buyer name, GSTIN, PAN, addresses\n- DO include: Vehicle number, LR number, e-waybill number, transport details\n- DO NOT include: Any amounts, prices, rates, totals, tax values\n- REPLACE all monetary amounts with: ████████\n\nFormat output clearly. This is a vendor-safe copy.';

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;
  const payload = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
  };

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const resp = UrlFetchApp.fetch(url, { method: 'POST', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
      const result = JSON.parse(resp.getContentText());
      if (result.candidates && result.candidates[0] && result.candidates[0].content) {
        return result.candidates[0].content.parts[0].text;
      }
    } catch (err) {
      if (attempt < CONFIG.MAX_RETRIES) Utilities.sleep(2000 * attempt);
    }
  }
  return 'AI analysis unavailable. Document processed with pattern matching.';
}

function enhancedGeminiPdfAnalysis(pdfBlob, fileName) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  try {
    const base64Pdf = Utilities.base64Encode(pdfBlob.getBytes());
    const prompt = 'Analyze this Indian vendor bill/invoice/e-waybill PDF.\nExtract ALL details EXCEPT monetary amounts.\nFor line items include: Item name, HSN code, Quantity, Unit. REDACT: Total Amount, Grand Total, Rate, Price, CGST, SGST, IGST, Tax amount, Invoice value — replace with ████████.\nReturn clean formatted text for a vendor-safe document.';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=' + apiKey;
    const payload = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'application/pdf', data: base64Pdf } }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    };
    const resp = UrlFetchApp.fetch(url, { method: 'POST', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    const result = JSON.parse(resp.getContentText());
    if (result.candidates && result.candidates[0]) return result.candidates[0].content.parts[0].text;
  } catch (err) {
    logEvent('WARN', 'Enhanced Gemini PDF analysis failed: ' + err.message);
  }
  return null;
}

function createRedactedDocFromAiContent(content, baseName, originalName) {
  const doc = DocumentApp.create('TEMP_AI_' + baseName);
  const body = doc.getBody();
  body.clear();

  const title = body.appendParagraph('VENDOR BILL — AMOUNT DETAILS REDACTED');
  title.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  title.editAsText().setBold(true);

  body.appendParagraph('Original File: ' + originalName).editAsText().setItalic(true);
  body.appendParagraph('Processed: ' + new Date().toLocaleString('en-IN')).editAsText().setItalic(true);
  body.appendHorizontalRule();
  body.appendParagraph('');

  const lines = content.split('\n');
  lines.forEach(function(line) {
    if (line.trim() === '') { body.appendParagraph(''); return; }
    if (line.startsWith('# '))      { const p = body.appendParagraph(line.replace(/^#+\s*/,'')); p.setHeading(DocumentApp.ParagraphHeading.HEADING1); }
    else if (line.startsWith('## ')){ const p = body.appendParagraph(line.replace(/^#+\s*/,'')); p.setHeading(DocumentApp.ParagraphHeading.HEADING2); }
    else if (line.startsWith('### ')){ const p = body.appendParagraph(line.replace(/^#+\s*/,'')); p.setHeading(DocumentApp.ParagraphHeading.HEADING3); }
    else { body.appendParagraph(line); }
  });

  addRedactionWatermark(doc);
  doc.saveAndClose();

  const docId = doc.getId();
  try { return exportDocAsPdf(docId, baseName); }
  finally { try { DriveApp.getFileById(docId).setTrashed(true); } catch(e) {} }
}

// ── EXPORT ────────────────────────────────────────────────────
function exportDocAsPdf(docId, baseName) {
  const outputFolder = DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID);
  const pdfBlob = DriveApp.getFileById(docId).getAs(MimeType.PDF);
  const safeFileName = '[VENDOR-SAFE] ' + baseName + ' — ' + formatDate() + '.pdf';
  pdfBlob.setName(safeFileName);
  const pdfFile = outputFolder.createFile(pdfBlob);
  pdfFile.setDescription('Vendor-safe copy. Amounts redacted. Generated: ' + new Date().toISOString());
  return pdfFile.getId();
}

function exportSheetAsPdf(sheetId, baseName) {
  const outputFolder = DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID);
  const safeFileName = '[VENDOR-SAFE] ' + baseName + ' — ' + formatDate() + '.pdf';
  const url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/export?format=pdf&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&attachment=true';
  const response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
  const pdfBlob = response.getBlob().setName(safeFileName);
  const pdfFile = outputFolder.createFile(pdfBlob);
  pdfFile.setDescription('Vendor-safe sheet export. Generated: ' + new Date().toISOString());
  return pdfFile.getId();
}

function addRedactionWatermark(doc) {
  try {
    const header = doc.addHeader();
    const hp = header.appendParagraph('⚠️  VENDOR COPY — FINANCIAL DETAILS REDACTED FOR CONFIDENTIALITY  ⚠️');
    hp.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    hp.editAsText().setFontSize(9).setForegroundColor('#cc0000').setBold(true);
  } catch(e) {}
  try {
    const footer = doc.addFooter();
    const fp = footer.appendParagraph('Vendor-safe copy | Amounts hidden | Generated: ' + new Date().toLocaleString('en-IN'));
    fp.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    fp.editAsText().setFontSize(8).setForegroundColor('#666666');
  } catch(e) {}
}

// ── UTILITIES ─────────────────────────────────────────────────
function isMonetaryValue(text) {
  const t = String(text).trim().replace(/[₹Rs.INR\s]/gi, '');
  return /^[\d,]+\.?\d*$/.test(t) && t.replace(/[^\d]/g,'').length >= 2;
}

function isNumericAmount(val) {
  if (typeof val === 'number') return val > 0;
  return typeof val === 'string' && /^[₹\s]*[\d,]+\.?\d*$/.test(val.trim());
}

function formatDate() {
  const d = new Date();
  return d.getDate().toString().padStart(2,'0') + '-' + (d.getMonth()+1).toString().padStart(2,'0') + '-' + d.getFullYear();
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ── LOGGING ────────────────────────────────────────────────────
function getOrCreateLogSheet() {
  const ss = getOrCreateLogSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    sheet.appendRow(['Timestamp', 'Level', 'Message', 'Input File ID', 'Output File ID']);
    sheet.getRange(1,1,1,5).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateLogSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('LOG_SHEET_ID');
  if (ssId) { try { return SpreadsheetApp.openById(ssId); } catch(e) {} }
  const ss = SpreadsheetApp.create('VendorBill AutoHide Log');
  props.setProperty('LOG_SHEET_ID', ss.getId());
  return ss;
}

function logEvent(level, message, inputId, outputId) {
  try {
    getOrCreateLogSheet().appendRow([new Date(), level, message, inputId||'', outputId||'']);
  } catch(e) { console.log('['+level+'] '+message); }
}

function markAsProcessed(inputFileId, outputFileId, fileName) {
  try { getOrCreateLogSheet().appendRow([new Date(), 'PROCESSED', fileName, inputFileId, outputFileId]); } catch(e) {}
}

function isAlreadyProcessed(fileId) {
  try {
    const data = getOrCreateLogSheet().getDataRange().getValues();
    return data.some(function(row) { return row[3] === fileId && row[1] === 'PROCESSED'; });
  } catch(e) { return false; }
}

function getLogs() {
  try {
    const sheet = getOrCreateLogSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    return data.slice(1).reverse().slice(0,100).map(function(row) {
      const obj = {};
      headers.forEach(function(h,i) { obj[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
      return obj;
    });
  } catch(e) { return []; }
}

function getStats() {
  try {
    const data = getOrCreateLogSheet().getDataRange().getValues().slice(1);
    const processed = data.filter(function(r){ return r[1]==='PROCESSED'; }).length;
    const errors    = data.filter(function(r){ return r[1]==='ERROR'; }).length;
    const today     = new Date().toDateString();
    const todayProc = data.filter(function(r){ return r[1]==='PROCESSED' && new Date(r[0]).toDateString()===today; }).length;
    return { totalProcessed: processed, errors: errors, todayProcessed: todayProc, lastUpdated: new Date().toISOString() };
  } catch(e) { return { totalProcessed:0, errors:0, todayProcessed:0 }; }
}

function dailyMaintenance() {
  const stats = getStats();
  logEvent('INFO', 'Daily stats — Processed: ' + stats.totalProcessed + ' | Errors: ' + stats.errors);
}

// ── MANUAL INIT (run once from Apps Script IDE) ───────────────
function initialize() {
  setupTriggers();
  getOrCreateLogSheet();
  logEvent('INFO', 'VendorBill AutoHide system initialized');
  return { success: true, message: 'Initialized! Auto-processing every 5 minutes.' };
}
