'use strict';
const { escapeHtml } = require('./core');
function renderWebview({ html, rootUrl, documentUrl, cspSource, nonce }) {
  const csp = `default-src 'none'; script-src ${cspSource} 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource} data:; img-src ${cspSource} data: blob:; connect-src ${cspSource}; worker-src blob:;`;
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><base href="${escapeHtml(documentUrl)}/">`)
    .replace(/<base href="\{\{baseUrl\}\}\/">/, '')
    .replace(/(src|href)="(dist\/[^"\n]+|index\.css|index\.js|\.\.\/lib\/vscode\.js)"/g, (_all, attr, url) => `${attr}="${rootUrl}/${url === '../lib/vscode.js' ? 'bridge.js' : url}"`)
    .replace(/<script /g, `<script nonce="${nonce}" `)
    .replace('</head>', `<link rel="stylesheet" href="${rootUrl}/glass.css"></head>`)
    .replace('<title>Markdown Editor</title>', '<title>Glass Markdown</title>');
}
module.exports = { renderWebview };
