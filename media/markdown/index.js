import { installDiagramRefresh } from "./glass.js";
import { installEditorPerformance } from "./performance.js";
import "./math-insertion.js";
import { installCompatibility } from "./compatibility.js";
import { installDocumentLinks, navigateToFragment } from "./links.js";
import { installEditorInteractions } from "./editor-interactions.js";
import { installHeadingFolding } from "./heading-folding.js";
import { installEditHistory } from "./edit-history.js";
import { installMathDeletion } from "./math-deletion.js";
import { installMathBoundaries } from "./math-boundaries.js";
import { installBlankLineDeletion } from "./blank-line-deletion.js";
import { installTableFocus } from "./table-focus.js";
import { installImageSelection } from "./image-selection.js";
import { installBlockHandleGuard } from "./block-handle-guard.js";
import "./math-clipboard.js";
import "./formula-search.js";
import "./list-editing.js";
import { installViewSettings } from "./view-settings.js";
import { installLatexPaste } from "./latex-paste.js";
import { installSourceView } from "./source-view.js";
import "./image-preview.js";
import "./image-clipboard.js";
import "./cut.js";
import { getToolbar, bindShortcut, createContextMenu, setAIAvailable, openToolbarExport } from "./util.js";
import { observeWorkspaceAbsoluteImages, createMarkdownValueReader, restoreWorkspaceBaseUrls, } from "./imagePath.js";
import { mapVscodeLanguageToVditorLang } from "./lang.js";
import { refreshExportDialogProState } from "./exportDialog.js";
import { toggleMarkmapView, refreshMarkmapProLock } from "./markmapView.js";


const removeLockedDecorations = (root) => {
  root?.querySelectorAll?.('.vditor-pro-locked__badge, .vditor-pro-locked__tooltip').forEach((node) => node.remove());
  root?.querySelectorAll?.('.vditor-pro-locked').forEach((node) => node.classList.remove('vditor-pro-locked'));
};

const hideToolbarEntry = (root, type) => {
  const item = root?.querySelector?.(`.vditor-toolbar [data-type="${type}"]`)?.closest('.vditor-toolbar__item');
  if (item) item.hidden = true;
};

const showToolbarEntry = (root, type) => {
  const item = root?.querySelector?.(`.vditor-toolbar [data-type="${type}"]`)?.closest('.vditor-toolbar__item');
  if (item) item.hidden = false;
};

const applyProState = (editor, isPro) => {
  document.body.classList.toggle('is-pro', !!isPro);
  if (!editor?.vditor?.options) {
    refreshExportDialogProState();
    return;
  }

  editor.vditor.options.isPro = !!isPro;
  if (editor.options) {
    editor.options.isPro = !!isPro;
  }

  if (isPro) {
    removeLockedDecorations(document);
    hideToolbarEntry(document, 'pro-upgrade');
    hideToolbarEntry(document, 'help');
  } else {
    showToolbarEntry(document, 'pro-upgrade');
    showToolbarEntry(document, 'help');
  }

  refreshExportDialogProState();
  refreshMarkmapProLock();
};

const applyProCancelledState = (editor, isProCancelled) => {
  document.body.classList.toggle('is-pro-cancelled', !!isProCancelled);
};

handler.on("open", async (md) => {
  const { content, rootPath, workspaceBaseUrl, documentCacheId, pendingFragment, shouldRestoreFocus, config, fileName } = md;
  window.__officeMarkdownFileName = fileName || 'Note';
  const {
    language, isWeb, isDev, isPro, isProCancelled, markdown,
    editMode, editorTheme, codeMirrorTheme, mermaidTheme
  } = config;
  if (isWeb) {
    document.body.classList.add('is-web')
  }
  applyProState(null, isPro)
  applyProCancelledState(null, isProCancelled)
  let editor;
  const getMarkdownValue = createMarkdownValueReader(() => editor, workspaceBaseUrl);
  editor = new Vditor('vditor', {
    value: content,
    cdn: rootPath,
    height: '100%',
    outline: {
      enable: false,
      position: 'left',
    },
    cache: {
      enable: false,
      id: documentCacheId,
      focusHost: 'vscode',
    },
    mode: editMode,
    editorTheme,
    codeMirrorTheme,
    mermaidTheme,
    isPro,
    onRequirePro() {
      handler.emit('openProPanel')
    },
    lang: mapVscodeLanguageToVditorLang(language),
    tab: '\t',
    toolbar: await getToolbar(rootPath, () => {
      handler.emit('doSave', getMarkdownValue());
      editor?.markSaved();
    }, isPro, () => openToolbarExport(editor), () => toggleMarkmapView(editor)),
    onAboutOpen: () => handler.emit('openAbout'),
    onSponsorLogoClick: () => handler.emit('openSponsor'),
    onSponsorSiteClick: () => handler.emit('openExternal', 'https://database-client.com/'),
    onLinkClick(payload, event) {
      event.preventDefault();
      const isCompose = event.metaKey || event.ctrlKey;
      if (payload.action !== "dblclick" && !(payload.action === "click" && isCompose)) {
        return;
      }
      if (payload.type === "footnote-ref") {
        navigateToFragment(editor, `footnote:${payload.href}`);
        return;
      }
      if (payload.href?.startsWith("#")) {
        navigateToFragment(editor, payload.href);
        return;
      }
      let uri = payload.href;
      if (payload.type === "wikilink" || payload.type === "wikilink-embed") {
        const hashIndex = uri.indexOf("#");
        const page = hashIndex < 0 ? uri : uri.slice(0, hashIndex);
        const fragment = hashIndex < 0 ? "" : uri.slice(hashIndex + 1);
        if (!page && fragment) {
          navigateToFragment(editor, fragment);
          return;
        }
        uri = `wiki:${payload.href}`;
      }
      handler.emit("openLink", uri);
    },
    debugger: isDev,
    wysiwygInputPerf: isDev && false,
    changeEditorTheme(theme) {
      handler.emit('editorTheme', theme)
    },
    changeCodeTheme(theme) {
      handler.emit('codeMirrorTheme', theme)
    },
    changeMermaidTheme(theme) {
      handler.emit('mermaidTheme', theme)
    },
    changeEditMode(mode) {
      handler.emit('editMode', mode)
    },
    onSettingsChange(settings) {
      handler.emit('syncViewerSettings', settings)
    },
    onEditSettings() {
      handler.emit('editViewerSettings', editor.exportViewerSettings())
    },
    input(content) {
      handler.emit("save", restoreWorkspaceBaseUrls(content, workspaceBaseUrl))
    },
    upload: {
      url: '/image',
      accept: 'image/*',
      handler(files) {
        for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        let reader = new FileReader();
        reader.readAsBinaryString(file);
        reader.onloadend = () => {
          handler.emit("img", { data: reader.result, ext })
        };
        }
      }
    },
    onTelemetry(event, properties) {
      handler.emit('telemetry', { event, properties });
    },
    ai: {
      onPolish(markdown, apply, options) {
        handler.emit('aiPolish', { markdown, options })
      },
      onCancelPolish() {
        handler.emit('aiPolishCancel')
      }
    },
    preview: {
      math: {
        macros: markdown?.math?.macros ?? {},
      },
    },
    after() {
      window.glassEditor = editor;
      installEditorPerformance(editor);
      installCompatibility(editor);
      installDiagramRefresh(editor);
      // Initial construction happens before the instance parser can be wrapped.
      // Reparse while the host bridge is still initializing, without writing back.
      editor.setValue(content, true);
      installDocumentLinks(editor);
      installEditorInteractions(editor);
      installViewSettings(editor);
      installLatexPaste(editor);
      installSourceView(editor);
      installHeadingFolding(editor);
      installEditHistory(editor);
      installMathDeletion(editor);
      installMathBoundaries(editor);
      installTableFocus(editor);
      installBlankLineDeletion(editor);
      installImageSelection(editor);
      installBlockHandleGuard(editor);
      createContextMenu(editor, mapVscodeLanguageToVditorLang(language));
      applyProState(editor, isPro);
      window.glassShowExport = () => openToolbarExport(editor);
      const { viewerSettings } = md;
      observeWorkspaceAbsoluteImages(document.getElementById('vditor'), workspaceBaseUrl);
      if (viewerSettings?.enabled) {
        editor.setViewerSettingsSyncEnabled(true);
        if (viewerSettings.settings) {
          editor.applyViewerSettings(viewerSettings.settings);
        }
      }
      handler.on('viewerSettingsSync', ({ enabled }) => {
        editor.setViewerSettingsSyncEnabled(!!enabled);
      });
      handler.on('viewerSettings', (settings) => {
        editor.applyViewerSettings(settings);
      });
      handler.on('markdownConfig', (update) => {
        if (update.editorTheme !== undefined) {
          editor.setEditorTheme(update.editorTheme);
        }
        if (update.codeMirrorTheme !== undefined) {
          Vditor.setCodeTheme(update.codeMirrorTheme, editor.vditor?.element);
        }
        if (update.mermaidTheme !== undefined) {
          editor.setMermaidTheme(update.mermaidTheme);
        }
        if (update.editMode !== undefined) {
          editor.switchEditMode(update.editMode);
        }
      });
      handler.on('proStatus', ({ isPro, isProCancelled }) => {
        applyProState(editor, !!isPro);
        applyProCancelledState(editor, !!isProCancelled);
        if (!isPro) {
          // Clear badge dismissed state so the dot reappears
          localStorage.removeItem('office.pro.badgeDismissed');
          // Re-inject badge dot into DOM if button is visible and dot was removed
          const btn = document.querySelector('.vditor-toolbar [data-type="pro-upgrade"]');
          if (btn && !btn.querySelector('.vditor-pro-badge')) {
            const dot = document.createElement('span');
            dot.className = 'vditor-pro-badge';
            btn.appendChild(dot);
          }
        }
      });
      handler.on("update", content => {
        if (document.querySelector("[data-type='yaml-front-matter'].vditor-code-block--cm .cm-editor.cm-focused")) {
          return;
        }
        if (getMarkdownValue() === content) {
          return;
        }
        editor.setValue(content);
        editor.markSaved();
      })
      handler.on("insertImageMarkdown", (markdown) => {
        editor.insertMarkdown(markdown);
      })
      handler.on("gotoBlock", (fragment) => {
        if (fragment) {
          navigateToFragment(editor, fragment);
        }
      })
      handler.emit('queryAIAvailable')
      handler.on("aiAvailable", (available) => {
        setAIAvailable(available, editor)
        if (available) {
          handler.emit('queryVSCodeModels')
        }
      })
      handler.on("vscodeModels", (models) => {
        editor.setVSCodeModels(models)
      })
      handler.on('aiPolishChunk', (chunk) => {
        editor.streamAIChunk(chunk)
      })
      handler.on('aiPolishEnd', () => {
        editor.endAIStream()
      })
      editor.restoreDocumentSession(true, !!shouldRestoreFocus)
      if (pendingFragment) {
        navigateToFragment(editor, pendingFragment);
      }
    }
  })
  bindShortcut(handler, editor, workspaceBaseUrl);
}).emit("init")
