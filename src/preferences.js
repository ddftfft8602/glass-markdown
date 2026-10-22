'use strict';

// Migrate only the bundled 0.1/0.2 defaults. Keep user-selected typography intact.
function migrateAppearance(settings) {
  const current = settings?.globalSettings;
  if (!current || current.editorFontSize !== 20 || current.editorLineHeight !== 1.9 || current.editorFontFamily !== '"Segoe UI", "Microsoft YaHei", sans-serif') return settings;
  return { ...settings, globalSettings: { ...current, editorFontFamily: 'inherit', editorFontSize: 16, editorLineHeight: 1.7 } };
}
module.exports = { migrateAppearance };
