export const PUBLIC_GLOBALS = {
  LUCIDE_MOVING: 'vendor/lucide-moving.js',
  WeaveEditorLib: 'editor-lib.js',
  WeaveStarters: 'starter-core.js',
  WeaveTerm: 'term-core.js',
  bugCore: 'bug-core.js',
  chipCore: 'chip-core.js',
  fieldDialogCore: 'field-dialog-core.js',
  weaveBoardCore: 'board-core.js',
  weaveCellGraphics: 'cell-graphics.js',
  weaveChipView: 'chip-view.js',
  weaveDateGrain: 'date-grain.js',
  weaveIconRegistry: 'icon-registry.js',
  weaveListCore: 'list-core.js',
  weaveMarkIcons: 'mark-icons.js',
  weaveNumberCore: 'number-core.js',
  weavePhoneRow: 'phone-row.js',
  weaveViewPane: 'view-pane-core.js',
};

export function sharedGlobal(name) {
  const owner = PUBLIC_GLOBALS[name];
  if (!owner) throw new Error(`${name} is not a shared public global; name its file in PUBLIC_GLOBALS in src/public-globals.js`);
  const value = globalThis[name];
  if (value == null) throw new Error(`public/${owner} left globalThis.${name} undefined; add import '../public/${owner}'; to the module that reads it`);
  return value;
}
