'use strict';
const VIEW = 'glassMarkdown.editor';
const PATTERNS = ['*.md', '*.markdown', '*.mdown'];

// This personal extension was requested as the user's default Markdown editor.
// Configure it once on upgrade; never fight a later manual editor preference.
async function ensureDefaultEditor(vscode, context, force = false) {
  if (!force && context.globalState.get('glassDefaultEditorConfigured', false)) return false;
  const config = vscode.workspace.getConfiguration('workbench');
  const previous = config.inspect('editorAssociations')?.globalValue || {};
  const updated = { ...previous };
  for (const pattern of PATTERNS) updated[pattern] = VIEW;
  const changed = PATTERNS.some(pattern => previous[pattern] !== VIEW);
  if (changed) await config.update('editorAssociations', updated, vscode.ConfigurationTarget.Global);
  await context.globalState.update('glassDefaultEditorConfigured', true);
  return changed;
}
module.exports = { ensureDefaultEditor };
