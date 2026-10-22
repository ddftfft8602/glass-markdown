'use strict';
const path = require('node:path');

// One minimal text edit preserves unchanged text and VS Code's undo history.
function textEdit(before, after) {
  if (before === after) return null;
  let start = 0, endA = before.length, endB = after.length;
  while (start < endA && start < endB && before[start] === after[start]) start++;
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) { endA--; endB--; }
  if (endA < before.length && /[\uDC00-\uDFFF]/.test(before[endA])) { endA++; endB++; }
  return { start, end: endA, text: after.slice(start, endB) };
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function normalizeEol(text, crlf) { return text.replace(/\r?\n/g, crlf ? '\r\n' : '\n'); }
function wikiTargets(markdown) {
  const clean = markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '').replace(/`[^`]*`/g, '');
  return [...new Set([...clean.matchAll(/!?\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map(m => m[1].trim()).filter(Boolean))];
}
function safeLocalPath(source, documentPath, workspacePath) {
  if (typeof source !== 'string' || /^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')) return null;
  let decoded;
  try { decoded = decodeURIComponent(source.split('#')[0]); } catch { return null; }
  const base = workspacePath || path.dirname(documentPath);
  const result = path.resolve(decoded.startsWith('/') ? base : path.dirname(documentPath), decoded.replace(/^\/+/, ''));
  const relative = path.relative(base, result);
  return relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) ? null : result;
}
module.exports = { textEdit, escapeHtml, normalizeEol, wikiTargets, safeLocalPath };
