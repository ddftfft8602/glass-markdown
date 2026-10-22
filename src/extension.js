'use strict';
const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { textEdit, escapeHtml, normalizeEol, wikiTargets, safeLocalPath } = require('./core');
const { exportDocument } = require('./exporter');
const { renderWebview } = require('./webview');
const { migrateAppearance } = require('./preferences');
const { ensureDefaultEditor } = require('./default-editor');
const VIEW = 'glassMarkdown.editor';

async function activate(context) {
  if (context.globalState.get('glassAppearanceRevision', 0) < 3) {
    const stored = context.globalState.get('viewerSettings');
    const migrated = migrateAppearance(stored);
    if (migrated !== stored) await context.globalState.update('viewerSettings', migrated);
    await context.globalState.update('glassAppearanceRevision', 3);
  }
  const sessions = new Map();
  let active;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  const config = (key, fallback) => vscode.workspace.getConfiguration('glassMarkdown').get(key, fallback);
  const updateStatus = doc => { status.text = `$(markdown) 轻墨 · ${doc.getText().replace(/\s/g, '').length} 字`; status.show(); };
  const open = async uri => {
    uri ||= vscode.window.activeTextEditor?.document.uri || active?.document.uri;
    if (!uri) { const d = await vscode.workspace.openTextDocument({ language: 'markdown', content: '' }); uri = d.uri; }
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW);
  };
  const provider = {
    async resolveCustomTextEditor(document, panel) {
      const workspace = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
      const folder = document.isUntitled ? (workspace || vscode.workspace.workspaceFolders?.[0]?.uri || context.extensionUri) : vscode.Uri.joinPath(document.uri, '..');
      const root = vscode.Uri.joinPath(context.extensionUri, 'media', 'markdown');
      panel.webview.options = { enableScripts: true, localResourceRoots: [context.extensionUri, folder, ...(vscode.workspace.workspaceFolders || []).map(w => w.uri)] };
      const send = (type, data) => panel.webview.postMessage({ type, data });
      const session = { document, panel, send, ready: false, pending: Promise.resolve() };
      sessions.set(document.uri.toString(), session); active = session;
      let applying = false;
      const update = async value => {
        const next = normalizeEol(value, document.eol === vscode.EndOfLine.CRLF);
        const diff = textEdit(document.getText(), next);
        if (!diff) return;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(diff.start), document.positionAt(diff.end)), diff.text);
        applying = true;
        try { if (!await vscode.workspace.applyEdit(edit)) throw new Error('无法写入文档'); } finally { applying = false; }
        updateStatus(document);
      };
      const disposables = [
        vscode.workspace.onDidChangeTextDocument(e => {
          if (e.document === document && !applying && e.contentChanges.length) send('update', { value: document.getText(), version: document.version });
        }),
        vscode.workspace.onDidSaveTextDocument(d => { if (d === document) send('saved', null); }),
        panel.onDidChangeViewState(e => { if (e.webviewPanel.active) { active = session; updateStatus(document); } else if (!e.webviewPanel.visible) status.hide(); })
      ];
      const saveImage = async data => {
        if (document.isUntitled) throw new Error('请先保存 Markdown 文件，再插入本地图片。');
        const ext = String(data.ext || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!['png','jpg','jpeg','gif','webp','svg','avif','bmp'].includes(ext)) throw new Error('不支持此图片格式。');
        const bytes = Buffer.from(data.base64, 'base64');
        if (bytes.length > 30 * 1024 * 1024) throw new Error('图片大于 30 MB，请以文件链接插入。');
        const imageFolder = vscode.Uri.joinPath(folder, 'assets');
        await vscode.workspace.fs.createDirectory(imageFolder);
        const name = `image-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(imageFolder, name), bytes);
        send('insertImageMarkdown', `![图片](assets/${name})`);
      };
      const openLink = async href => {
        if (typeof href !== 'string') return;
        if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return vscode.env.openExternal(vscode.Uri.parse(href));
        let target;
        if (href.startsWith('wiki:')) {
          const raw = href.slice(5), [page, fragment] = raw.split('#');
          if (!page) return send('gotoBlock', fragment);
          const clean = page.replace(/\.md$/i, '');
          const relative = safeLocalPath(clean + '.md', document.uri.fsPath, workspace?.fsPath);
          if (relative) { try { await fs.access(relative); target = vscode.Uri.file(relative); } catch {} }
          if (!target) {
            const files = await vscode.workspace.findFiles('**/*.{md,markdown}', '**/{node_modules,.git}/**', 5000);
            const candidates = files.filter(f => path.basename(f.fsPath, path.extname(f.fsPath)).toLowerCase() === path.basename(clean).toLowerCase());
            if (candidates.length === 1) target = candidates[0];
            else if (candidates.length > 1) target = (await vscode.window.showQuickPick(candidates.map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri }))))?.uri;
          }
          if (!target) { vscode.window.showInformationMessage(`找不到页面：${page}`); return; }
          await open(target); if (fragment) sessions.get(target.toString())?.send('gotoBlock', fragment); return;
        }
        if (href.startsWith('#')) return send('gotoBlock', href);
        for (const uri of [folder, workspace].filter(Boolean)) {
          const base = panel.webview.asWebviewUri(uri).toString().replace(/\/$/, '');
          if (href.startsWith(base + '/')) { href = decodeURIComponent(href.slice(base.length + 1)); break; }
        }
        const resolved = safeLocalPath(href, document.uri.fsPath, workspace?.fsPath);
        if (resolved) { target = vscode.Uri.file(resolved); await vscode.commands.executeCommand(/\.(md|markdown)$/i.test(resolved) ? 'glassMarkdown.open' : 'vscode.open', target); }
      };
      const receive = async ({ type, data }) => {
        switch (type) {
          case 'init':
            send('open', { content: document.getText(), version: document.version, fileName: path.basename(document.uri.fsPath || 'Untitled.md'), rootPath: panel.webview.asWebviewUri(root).toString(), documentBaseUrl: panel.webview.asWebviewUri(folder).toString(), workspaceBaseUrl: workspace ? panel.webview.asWebviewUri(workspace).toString() : '', settings: context.globalState.get('viewerSettings'), config: { language: vscode.env.language, editMode: context.globalState.get('editMode', config('editMode', 'wysiwyg')), editorTheme: context.globalState.get('editorTheme', config('theme', 'Light')), codeMirrorTheme: context.globalState.get('codeMirrorTheme', 'Auto'), mermaidTheme: context.globalState.get('mermaidTheme', 'default') } }); break;
          case 'ready': session.ready = true; updateStatus(document); break;
          case 'change':
            if (typeof data?.value !== 'string') break;
            if (data.baseVersion !== document.version) { send('conflict', { value: document.getText(), version: document.version }); break; }
            await update(data.value); send('ack', { seq: data.seq, version: document.version }); break;
          case 'save': await document.save(); break;
          case 'recover': { const recovered = await vscode.workspace.openTextDocument({ language: 'markdown', content: String(data) }); await vscode.window.showTextDocument(recovered); break; }
          case 'image': await saveImage(data); break;
          case 'insertImage': {
            const selected = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { Images: ['png','jpg','jpeg','gif','webp','svg','avif','bmp'] } });
            for (const uri of selected || []) await saveImage({ ext: path.extname(uri.fsPath).slice(1), base64: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('base64') }); break;
          }
          case 'editInVSCode': await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default'); break;
          case 'switchEditor': {
            const command = data === 'previous' ? 'workbench.action.previousEditorInGroup'
              : data === 'next' ? 'workbench.action.nextEditorInGroup' : null;
            if (command) await vscode.commands.executeCommand(command);
            break;
          }
          case 'openLink': await openLink(data); break;
          case 'showInFolder': if (!document.isUntitled) await vscode.commands.executeCommand('revealFileInOS', document.uri); break;
          case 'paste': send('paste', await vscode.env.clipboard.readText()); break;
          case 'clipboard': {
            try {
              if (data?.action === 'write' && typeof data.text === 'string') await vscode.env.clipboard.writeText(data.text);
              else if (data?.action !== 'read') throw new Error('无效的剪贴板操作');
              send('clipboardResult', { id: data.id, text: data.action === 'read' ? await vscode.env.clipboard.readText() : '' });
            } catch (error) { send('clipboardResult', { id: data?.id, error: String(error.message || error) }); }
            break;
          }
          case 'settings': await context.globalState.update('viewerSettings', data); for (const s of sessions.values()) if (s !== session) s.send('settings', data); break;
          case 'editorTheme': case 'codeMirrorTheme': case 'mermaidTheme': case 'editMode':
            if (typeof data === 'string') { await context.globalState.update(type, data); for (const s of sessions.values()) if (s !== session) s.send('markdownConfig', { [type]: data }); } break;
          case 'editViewerSettings': {
            const uri = vscode.Uri.joinPath(context.globalStorageUri, 'editor-settings.json');
            await vscode.workspace.fs.createDirectory(context.globalStorageUri); await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2)));
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri)); break;
          }
          case 'export': {
            const type = ['html','pdf','docx'].includes(data?.type) ? data.type : 'html';
            const defaultUri = document.isUntitled ? undefined : vscode.Uri.file(document.uri.fsPath.replace(/\.[^.]+$/, '') + '.' + type);
            const destination = await vscode.window.showSaveDialog({ defaultUri, filters: { [type.toUpperCase()]: [type] } });
            if (!destination) break;
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `轻墨：导出 ${type.toUpperCase()}` }, () => exportDocument({ ...data, type, destination: destination.fsPath, documentPath: document.uri.fsPath, workspacePath: workspace?.fsPath, extensionPath: context.extensionPath, chromiumPath: config('chromiumPath', '') }));
            const show = await vscode.window.showInformationMessage('导出完成', '打开文件'); if (show) await vscode.env.openExternal(destination); break;
          }
          case 'exportMarkmap': {
            const destination = await vscode.window.showSaveDialog({ filters: { SVG: ['svg'] } });
            if (destination) await vscode.workspace.fs.writeFile(destination, Buffer.from(String(data.content))); break;
          }
          case 'queryWikiGraph': {
            const currentPage = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath));
            const outbound = wikiTargets(String(data?.markdown || document.getText())); const inbound = [];
            const files = await vscode.workspace.findFiles('**/*.{md,markdown}', '**/{node_modules,.git}/**', 2000);
            for (const file of files) {
              if (file.toString() === document.uri.toString()) continue;
              try { const text = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8'); if (wikiTargets(text).some(p => path.basename(p).replace(/\.md$/, '') === currentPage)) inbound.push(vscode.workspace.asRelativePath(file).replace(/\.(md|markdown)$/, '')); } catch {}
            }
            send('wikiGraph', { current: currentPage, outbound, inbound }); break;
          }
        }
      };
      disposables.push(panel.webview.onDidReceiveMessage(message => {
        session.pending = session.pending.then(() => receive(message)).catch(error => { send('error', String(error.message || error)); vscode.window.showErrorMessage(`轻墨：${error.message || error}`); });
      }));
      panel.onDidDispose(() => { disposables.forEach(d => d.dispose()); sessions.delete(document.uri.toString()); if (active === session) { active = undefined; status.hide(); } });
      let html = await fs.readFile(path.join(context.extensionPath, 'media/markdown/index.html'), 'utf8');
      const nonce = crypto.randomBytes(16).toString('hex');
      const rootUrl = panel.webview.asWebviewUri(root).toString();
      panel.webview.html = renderWebview({ html, rootUrl, documentUrl: panel.webview.asWebviewUri(folder).toString(), cspSource: panel.webview.cspSource, nonce });
    }
  };
  context.subscriptions.push(status, vscode.window.registerCustomEditorProvider(VIEW, provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }),
    vscode.commands.registerCommand('glassMarkdown.open', open),
    vscode.commands.registerCommand('glassMarkdown.makeDefault', () => ensureDefaultEditor(vscode, context, true)),
    vscode.commands.registerCommand('glassMarkdown.new', async () => { const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '' }); await open(document.uri); }),
    vscode.commands.registerCommand('glassMarkdown.export', () => active?.send('showExport')),
    vscode.commands.registerCommand('glassMarkdown.undo', () => active?.send('history', 'undo')),
    vscode.commands.registerCommand('glassMarkdown.redo', () => active?.send('history', 'redo')),
    vscode.workspace.onDidSaveTextDocument(async document => {
      if (document.uri.toString() !== vscode.Uri.joinPath(context.globalStorageUri, 'editor-settings.json').toString()) return;
      try {
        const settings = JSON.parse(document.getText());
        if (!settings?.globalSettings || typeof settings.globalSettings !== 'object' || Array.isArray(settings.globalSettings)) throw new Error('globalSettings 必须为对象');
        await context.globalState.update('viewerSettings', settings);
        for (const session of sessions.values()) session.send('settings', settings);
      } catch (error) { vscode.window.showErrorMessage(`轻墨设置：${error.message}`); }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      const updates = {};
      if (event.affectsConfiguration('glassMarkdown.theme')) updates.editorTheme = config('theme', 'Light');
      if (event.affectsConfiguration('glassMarkdown.editMode')) updates.editMode = config('editMode', 'wysiwyg');
      for (const [key, value] of Object.entries(updates)) context.globalState.update(key, value);
      if (Object.keys(updates).length) for (const session of sessions.values()) session.send('markdownConfig', updates);
    }));
  try { await ensureDefaultEditor(vscode, context); }
  catch (error) { vscode.window.showWarningMessage(`轻墨：默认打开方式未能保存。可以稍后执行“Glass Markdown: 设为默认 Markdown 编辑器”重试。${error.message || error}`); }
  return { sessions, open };
}
module.exports = { activate, deactivate() {} };
