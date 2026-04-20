'use strict';
const { google } = require('googleapis');
const officeParser = require('officeparser');
const logger = require('./logger');

const MAX_CONTENT_CHARS = 20_000;
const MAX_SEARCH_RESULTS = 15;

let drive = null;

function getDrive() {
  if (drive) return drive;
  const b64 = process.env.GDRIVE_SERVICE_ACCOUNT_JSON_B64;
  if (!b64) throw new Error('GDRIVE_SERVICE_ACCOUNT_JSON_B64 not set');
  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (err) {
    throw new Error('Invalid GDRIVE_SERVICE_ACCOUNT_JSON_B64 (not valid base64 JSON)');
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  drive = google.drive({ version: 'v3', auth });
  return drive;
}

function escapeQ(s) {
  return (s || '').replace(/['\\]/g, '\\$&');
}

async function search(query) {
  const d = getDrive();
  const q = `(fullText contains '${escapeQ(query)}' or name contains '${escapeQ(query)}') and trashed = false`;
  const res = await d.files.list({
    q,
    fields: 'files(id, name, mimeType, modifiedTime, webViewLink, parents)',
    pageSize: MAX_SEARCH_RESULTS,
    orderBy: 'modifiedTime desc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files || []).map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modified: f.modifiedTime,
    url: f.webViewLink,
  }));
}

async function readDocument(fileId) {
  const d = getDrive();
  const meta = await d.files.get({
    fileId,
    fields: 'id, name, mimeType, webViewLink',
    supportsAllDrives: true,
  });
  const { name, mimeType, webViewLink } = meta.data;

  let text;
  try {
    if (mimeType === 'application/vnd.google-apps.document') {
      text = await exportText(d, fileId, 'text/plain');
    } else if (mimeType === 'application/vnd.google-apps.presentation') {
      text = await exportText(d, fileId, 'text/plain');
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      text = await exportText(d, fileId, 'text/csv');
    } else if (
      mimeType === 'application/pdf' ||
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/vnd.ms-powerpoint' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mimeType === 'application/vnd.ms-excel' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      const buf = await downloadBuffer(d, fileId);
      text = await officeParser.parseOfficeAsync(buf);
    } else if (mimeType.startsWith('text/')) {
      const buf = await downloadBuffer(d, fileId);
      text = buf.toString('utf8');
    } else {
      return {
        id: fileId,
        name,
        mimeType,
        url: webViewLink,
        content: `(Unsupported file type: ${mimeType})`,
        truncated: false,
      };
    }
  } catch (err) {
    logger.warn(`gdrive: read failed for ${fileId} (${mimeType}): ${err.message}`);
    return {
      id: fileId,
      name,
      mimeType,
      url: webViewLink,
      content: `(Could not extract: ${err.message})`,
      truncated: false,
    };
  }

  const truncated = text.length > MAX_CONTENT_CHARS;
  return {
    id: fileId,
    name,
    mimeType,
    url: webViewLink,
    content: truncated ? text.slice(0, MAX_CONTENT_CHARS) + '\n\n[…TRUNCATED…]' : text,
    truncated,
  };
}

async function exportText(d, fileId, mimeType) {
  const res = await d.files.export(
    { fileId, mimeType, supportsAllDrives: true },
    { responseType: 'text' }
  );
  return res.data;
}

async function downloadBuffer(d, fileId) {
  const res = await d.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

module.exports = { search, readDocument };
