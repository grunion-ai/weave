export const FUNCTIONS = [
  { id: 'object-actions', title: "Open an object's actions", blurb: 'The ⋮ buttons, header menus and right-click menus that list what you can do to a row, table, space or workspace.', match: [
    { cat: 'button', sig: /dots-btn|nav-menu-btn|more-btn|crumb-more|field-menu/ },
    { cat: 'menu' },
    { cat: 'colmenu' },
    { cat: 'button', text: /^More\b|actions$/i },
  ] },
  { id: 'move-to-trash', title: 'Move to trash', blurb: 'Every control that sends a row, table or space to the trash, and the Trash page that brings it back.', match: [
    { sig: /danger/ },
    { text: /move to trash|^delete\b|restore/i },
    { cat: 'card', sig: /trash/ },
  ] },
  { id: 'pick-value', title: 'Pick a value', blurb: 'Cell chips that open a picker, the pickers themselves, and the phone sheet options for select, state and multi-select fields.', match: [
    { cat: 'picker', sig: /picker-pop/ },
    { cat: 'button', sig: /next-state/ },
    { cat: 'chip', sig: /Select chip|State chip|Multi-select chip|Option dot/ },
    { cat: 'button', sig: /picker-face|new-row-opt|form-select/ },
    { cat: 'tabs', sig: /new-row-seg/ },
    { cat: 'toggle', sig: /wv-toggle|switch/ },
  ] },
  { id: 'pick-date', title: 'Pick a date', blurb: 'Date cells, the calendar buttons and the date and range pickers.', match: [
    { cat: 'picker', sig: /date-pop|Date picker fields/ },
    { cat: 'button', sig: /date-pick/ },
  ] },
  { id: 'collapse-section', title: 'Collapse a section', blurb: 'Disclosure toggles that fold a group of rows, fields, headings or the sidebar. Issue #766 asks for one control here.', match: [
    { sig: /nav-caret|doc-caret|doc-fold|view-desc-more|fold|nav-expand|nav-collapse|summary/ },
    { cat: 'button', sig: /^(?!.*mention)/, text: /^(collapse|expand|show more|show less|fold)\b|^[‹›]$/i },
  ] },
  { id: 'search', title: 'Search', blurb: 'Every way to search: the ⌘K palette, the sidebar search, the table search and the search fields inside pickers.', match: [
    { sig: /search|cmdk/ },
    { cat: 'dialog', sig: /cmdk/ },
    { cat: 'empty', sig: /cmdk-empty|table-search-empty|picker-empty/ },
  ] },
  { id: 'create-row', title: 'Create a row', blurb: 'Every surface that starts a new row: the table button, the phone bar, the new-row sheet and the picker that chooses its table.', match: [
    { sig: /add-entity|phone-new|new-row/ },
    { text: /^\+ ?new (row|bug|example|deal|task|item|record)|^new row in /i },
    { cat: 'card', text: /\+ New row/ },
  ] },
  { id: 'create-table', title: 'Create a table, space, field or workspace', blurb: 'The buttons and dialogs that add structure: new table, new space, new field and new workspace.', match: [
    { sig: /wv-start-new|nav-add-table|add-field|ws-new|nav-foot|type-tile/ },
    { text: /^\+ ?new (space|table|field|workspace)|^new (table|field|workspace|space)\b/i },
    { cat: 'dialog', text: /^New (table|field|workspace|space)/ },
  ] },
  { id: 'configure-field', title: 'Configure a field', blurb: 'The field editor tray, its type tiles and the controls that rename, describe and set up a field.', match: [
    { land: /Field editor tray/ },
    { cat: 'dialog', sig: /tray/ },
    { sig: /term-|field-desc|Field kind tag|Term tag/ },
  ] },
  { id: 'dismiss', title: 'Dismiss', blurb: 'Close, cancel and back buttons that put a dialog, tray, panel or toast away.', match: [
    { cat: ['button', 'popover'], sig: /close|cancel|new-row-back|tray-close|wv-toast-close/ },
    { cat: 'button', text: /^(close|cancel|dismiss|done)\b|^×$|^✕$/i },
  ] },
  { id: 'report-problem', title: 'Report a problem', blurb: 'The bug button and the report panel with its symptom chips, note field and send button.', match: [
    { sig: /bug-|bug_|#bug-panel/ },
    { land: /Bug report panel/ },
    { text: /report a problem/i },
  ] },
  { id: 'reorder', title: 'Reorder', blurb: 'Drag handles and lists you can drag to change order.', match: [
    { sig: /reorder|drag|grip/ },
    { text: /drag to reorder/i },
  ] },
  { id: 'show-hide-fields', title: 'Show or hide fields', blurb: 'The eye button, the fields popover and its rows, and the per-field show toggles.', match: [
    { sig: /eye-|table-fields|fields-popover/ },
    { text: /show or hide fields|show all|hide all/i },
  ] },
  { id: 'filter', title: 'Filter', blurb: 'The filter button, the filter popover and its chips, and the Activity filters.', match: [
    { sig: /filter/ },
    { text: /^filters?\b/i },
  ] },
  { id: 'sort', title: 'Sort', blurb: 'Column header menus and the sort rows inside them.', match: [
    { cat: 'colmenu' },
    { text: /sort by|smallest to largest|a → z|z → a|oldest|newest/i },
  ] },
  { id: 'change-view', title: 'Change the view or row height', blurb: 'The view switcher, its view tabs and the row density control.', match: [
    { sig: /table-view|view-tab|view-row|density|seg-ctl|list-segs|table-tools|table-control/ },
  ] },
  { id: 'select-rows', title: 'Select rows and act on them', blurb: 'Row checkboxes and the selection bar with its bulk actions.', match: [
    { sig: /sel-box|sel-act|sel-puck|glass/ },
    { land: /Selection bar/ },
  ] },
  { id: 'edit-cell', title: 'Edit a value in place', blurb: 'Inline editors, checkboxes, ratings and the small buttons inside cells and field rows.', match: [
    { sig: /Inline cell edit|url-edit|wv-rate|form-check-input|\bbutton\.x\b|unlink|mention-caret/ },
    { cat: 'input', sig: /Form field/, land: /Table|Record/ },
    { cat: 'toggle', land: /Table|Record|Document/ },
  ] },
  { id: 'link-records', title: 'Link records and attach files', blurb: 'The + link and + file buttons, relation chips and the controls that unlink a row.', match: [
    { text: /\+ ?link|\+ ?file|link to|link existing|unlink/i },
    { sig: /attach|unlink|mention|relation|k-rel/ },
  ] },
  { id: 'navigate', title: 'Navigate back and forward', blurb: 'Breadcrumbs, sidebar rows, the back and forward arrows and the phone navigation button.', match: [
    { cat: 'nav' },
    { cat: 'bar', sig: /view-header/ },
    { sig: /crumb|dock-back|dock-forward|nav-menu\b|nav-db|nav-space|new-row-back/ },
    { text: /^(back|forward)\b|open navigation/i },
  ] },
  { id: 'switch-workspace', title: 'Switch workspace', blurb: 'The workspace rail and its tiles.', match: [
    { sig: /ws-icon|ws-rail|nav-account|workspace/ },
    { land: /Workspace rail/ },
  ] },
  { id: 'set-icon', title: 'Set an icon', blurb: 'The icon button beside a page title, with no icon set and with one set, and the icon picker it opens.', match: [
    { sig: /icon-btn/ },
    { cat: 'picker', text: /^ICON\b|\bICON\b/ },
  ] },
  { id: 'rename', title: 'Rename', blurb: 'Title and name editors on pages and records.', match: [
    { sig: /Title edit|view-title|name-edit/ },
  ] },
  { id: 'invite', title: 'Invite someone and share', blurb: 'The Members box, its invite field and link, the Share button and the Share dialog.', match: [
    { sig: /share|member|invite/ },
    { land: /Members box/ },
    { cat: ['button', 'menu', 'dialog', 'input'], text: /invite|^share\b/i },
  ] },
  { id: 'read-notification', title: 'Read a notification', blurb: 'Toasts in every kind weave sends: info, success with Undo, error, automation, repeated and long.', match: [
    { cat: 'toast' },
  ] },
  { id: 'review-history', title: 'Review history and revert', blurb: 'The Activity button and panel, its cards and the revert buttons.', match: [
    { sig: /activity|wv-act/ },
    { land: /Activity panel/ },
    { cat: ['button', 'popover', 'menu'], text: /^revert to\b|^activity\b/i },
  ] },
  { id: 'copy-link', title: 'Copy a link', blurb: 'Permalink buttons on pages, documents and records.', match: [
    { sig: /copy|permalink|anchor/ },
    { text: /copy (permalink|link)/i },
  ] },
  { id: 'write-document', title: 'Write a document', blurb: 'The document editor, its toolbar, outline rail and the document chips that open it.', match: [
    { sig: /vditor|doc-|Document chip/ },
    { land: /Document/ },
  ] },
  { id: 'read-record', title: 'Read a record', blurb: 'Record field rows, page headers and the panels on a record page.', match: [
    { cat: 'cell', sig: /fieldrow/ },
    { cat: 'bar', sig: /view-header/ },
    { cat: 'card', sig: /empty-note/ },
    { cat: 'card', sig: /panel/ },
  ] },
  { id: 'browse-rows', title: 'Browse rows in a table', blurb: 'Table cells with their header row, column headers, footers and the table cards on space and home pages.', match: [
    { cat: 'cell', sig: /(^|\s|> )(td|th)\b|\bnum\b/ },
    { cat: 'card', sig: /table-wrap|list-rows|space-tables|system-tables|^div\.card$|card$/ },
    { cat: 'chip', sig: /ID chip|Badge|List chip|List group chip|Card state/ },
  ] },
  { id: 'read-stats', title: 'Read statistics', blurb: 'The statistics dialog and its cards.', match: [
    { sig: /stats/ },
    { text: /statistics/i },
  ] },
  { id: 'see-relations', title: 'See how tables relate', blurb: 'The relation map on the home page.', match: [
    { sig: /home-map|relation-map|relmap|auto-pill/ },
  ] },
  { id: 'keyboard', title: 'Use the keyboard', blurb: 'The keyboard shortcuts button and sheet.', match: [
    { sig: /key-sheet|kbd/ },
    { text: /keyboard shortcuts/i },
  ] },
  { id: 'switch-theme', title: 'Switch theme', blurb: 'The theme button in the workspace rail. The harvest never clicks it.', match: [
    { sig: /theme/ },
    { text: /^theme:/i },
  ] },
  { id: 'empty-state', title: 'See that a list is empty', blurb: 'What weave shows where a list, panel or search has nothing to show.', match: [
    { cat: 'empty' },
  ] },
  { id: 'phone-bar', title: 'Reach the main actions on a phone', blurb: 'The phone bottom bar and its buttons.', match: [
    { sig: /phone-/ },
    { land: /Phone bottom bar|New row sheet/ },
  ] },
];

const textOf = (c) => [...(c.texts || []), ...(c.looks || []).flatMap((l) => [l.label, l.trig?.text, ...(l.rows || [])])].filter(Boolean);
const landsOf = (c) => [c.land, ...(c.looks || []).map((l) => l.land)].filter(Boolean);
const one = (rule, c) => {
  if (rule.cat && ![].concat(rule.cat).includes(c.cat)) return false;
  const sig = [c.sig, c.name, ...(c.looks || []).map((l) => l.sig)].filter(Boolean).join(' ');
  if (rule.sig && !rule.sig.test(sig) && !rule.sig.test(sig.toLowerCase())) return false;
  if (rule.text && !textOf(c).some((t) => rule.text.test(t))) return false;
  if (rule.land && !landsOf(c).some((l) => rule.land.test(l))) return false;
  return true;
};
export function functionsOf(control, functions = FUNCTIONS) {
  return functions.filter((f) => f.match.some((rule) => one(rule, control))).map((f) => f.id);
}
