# Region index

`public/app.js` (12,256 lines) and `src/engine.js` (12,126 lines) are too long to read whole. This page cuts each one into regions of at most 200 lines along its declarations and names what every region declares, so a change opens the right 200 lines first. The first table places each behaviour of the [grid map](grid.md) by line.

`node scripts/region-index.mjs` generates this page at commit [`f533d53`](https://github.com/grunion-ai/weave/tree/f533d53607522fa41ac84c3b37d1bf13fa3818b1), the commit the [architecture map](architecture/README.md) pins, so every line number is a line at that commit, and `node scripts/architecture.mjs` rewrites the page each time it re-pins the map. Code merged since the pin can shift a range by a few lines: `node scripts/region-index.mjs --now` prints these tables for your checkout. `test/region-index.test.mjs` fails when this page differs from what the script renders at the pin.

## Grid behaviours

A name with no file is in `public/app.js`, and "in" names the function a declaration sits inside.

| Behaviour | Lines |
| --- | --- |
| A table route opens and the chrome paints | `showDatabase` 4993-5014, `tableChrome` 5891-5963, `paintTableChrome` 6028-6037, `tableChromeOn` 5886-5890 |
| Rows are read and the grid is drawn | `readAndDrawTable` 5030-5072, `drawDatabase` 6042-6154, `renderTable` 6587-8067 (1,481 lines, 8 regions below) |
| The grid a redraw replaces is torn down | `teardownGrid` 6039-6041, `destroy` 8064-8064 in `renderTable`, `renderTable` 6587-8067 (1,481 lines, 8 regions below) |
| A board layout takes the same route | `public/board-core.js` 1-113, `public/board-view.js` 1-345, `readAndDrawBoard` 6190-6215 |
| Which columns are drawn | `visibleCols` 6580-6584, `gridFields` 5091-5100, `fieldVisibilityPopover` 6375-6560, `dropDrawnColumn` 6562-6571 |
| Only the rows near the viewport are in the DOM | `public/grid-window.js` 1-57, `rewindow` 7509-7520 in `renderTable`, `paint` 7475-7508 in `renderTable`, `renderTable` 6587-8067 (1,481 lines, 8 regions below) |
| The next page is fetched as the reader scrolls | `gridPager` 5120-5166, `WeaveGridWindow.feedFor` public/grid-window.js 27-33 |
| The loading state | `gridHold` 11189-11194, `paintGridWait` 11200-11215, `showGridLoader` 11232-11246, `hideGridLoader` 11247-11251, `resetGridWait` 11252-11258 |
| A cell rests, opens and commits | `activateCell` 2594-2614, `openCellPicker` 2585-2592, `editorFor` 4185-4520 (336 lines, 2 regions below) |
| A commit writes and the grid catches up | `renderTable` 6587-8067 (1,481 lines, 8 regions below), `patchRows` 7557-7584 in `renderTable`, `refreshView` 10957-10962, `undoPatch` 10932-10937, `bulkPatch` 5076-5080 |
| A write in the docked pane reaches the row behind it | `surfaceBehind` 9558-9558 in `renderEntityView`, `tellSurface` 9559-9559 in `renderEntityView`, `docSaved` 9560-9564 in `renderEntityView` |
| A new row is added and takes focus | `newRowTray` 11465-11559, `focusNewRow` 2675-2697, `focusGridRow` 10964-10968 |
| Focus and scroll survive a redraw | `rememberGridFocus` 2144-2153, `restoreGridFocus` 2155-2169, `keepScroll` 8679-8698 |
| The keyboard moves the cursor | `public/grid-keymap.js` 1-106, `gridMoves` 5082-5089 |
| A range is selected, copied and filled | `public/grid-range.js` 1-192, `public/selection-core.js` 1-62, `repaintRange` 6617-6617 in `renderTable`, `paintSelection` 6628-6647 in `renderTable` |
| Column widths and the resize handle | `public/column-resize.js` 1-157 |
| Frozen leading columns | `WeaveColumnResize.frozenFit` public/column-resize.js 69-77, `canFreeze` public/column-resize.js 78-79 |
| The grid decides whether it fits its pane | `refit` 6601-6612 in `renderTable`, `renderTable` 6587-8067 (1,481 lines, 8 regions below), `fitGridScroller` 2618-2624 |
| Sideways scroll state | no declaration to place: `scroll` |
| A clipped cell says so, and spills on hover | `markClippedCells` 2959-2987, `fitChips` 2864-2885, `showCellPop` 2729-2784, `hideCellPop` 2791-2793, `gridRightEdge` 2722-2728 |
| Row height | `gridDensity` 2992-2996, `saveGridDensity` 2997-3004, `checkRowPitch` 2888-2897 |
| Sort, filter, group and search | `public/list-core.js` 1-190, `gridSort` 5115-5118, `filterWhere` 4827-4829, `tableGroup` 5022-5026, `setTableSearch` 4943-4950 |
| The view pane that configures all four | `renderViewPane` 5791-5860, `paneFilters` 5729-5749, `paneWrite` 5495-5506 |
| Footer totals | `rollupCells` 5617-5619, `footStatLists` 5656-5681, `footRollupWrite` 5682-5707 |
| A row becomes a card on a phone | `public/phone-row.js` 1-101, `phoneRowOf` 2901-2906, `phoneLeadEl` 2907-2918, `fitPhoneChipLines` 2927-2958 |
| The phone action bar | `installPhoneBar` 11396-11409, `syncPhoneBar` 11560-11571 |
| Which fields the card shows | `phoneRowPopover` 5389-5462 |
| A related table on a record page | `relatedGrid` 10373-10497, `subtableOf` 10499-10507, `subtableChips` 10510-10518, `subtablePopover` 10520-10554 |

## public/app.js

| Lines | Declares |
| --- | --- |
| 1-196 | `$`, `el`, `svgEl`, `chevron`, `disclosure`, `setDisclosure`, `summaryChevron`, `WS_PREFIX`, `weaveFileBase`, `LOCAL_ZONE`, `commitActiveEdit`, `leaving`, `loadedSchemaVersion`, `lastSchemaVersion`, `schemaLoading`, `schemaFetch`, `noteSchemaVersion`, `UPLOAD_STALL_MS`, `UPLOAD_ANSWER_MS`, `uploadStates`, `uploadSeq`, `fileTooBig`, `uploadState`, `uploadHostsFor`, `sendUpload`, `landedFile`, `withErrorId`, `uploadWaits`, `paintUploadTile`, `uploadTileEl`, `drawUploads`, `paintUploads`, `uploadHost`, `refreshUploads` |
| 197-396 | `runUploads`, `runJobs`, `fileBase64`, `warmGets`, `WARM_MS`, `warmGet`, `bootReads`, `bootOpen`, `bootRead`, `closeBootReads`, `rowRevisions`, `noteRevisions`, `api`, `usage`, `systemKindOf`, `templateIds`, `noteUsage`, `startUsage`, `copyText`, `TOAST_MS` |
| 397-567 | `TOAST_LIMIT`, `TOAST_ICON`, `toastsUp`, `toastLayer`, `seatToast`, `toast`, `dropToast`, `dropToastNode`, `toastTick`, `toastClock`, `MODAL_LIVE`, `MODAL_STOPS`, `reachableStop`, `holds`, `releasePage`, `holdPage`, `submitsInFlight`, `holdSubmit`, `freeSubmit` |
| 568-761 | `modal`, `tray`, `state`, `heldRows`, `HELD_ROWS_CAP`, `holdRow`, `openEntity`, `nativeClick`, `externalLinksOpenInTabs`, `NATIVE_CLICK_KEEPS`, `openNativeClick`, `headCheck`, `markStuckHeads`, `atSideEnd`, `nameFieldOf`, `computedName`, `termOfTable`, `dock`, `dockRead`, `dockOwns`, `compare`, `markDockedRow` |
| 762-945 | `releaseDockPanel`, `poseGlyph`, `crumbNav`, `navArrows`, `dockExpand`, `closeToTable`, `collapseToSplit`, `dockClose`, `anchorTable`, `dockEntity`, `syncDockChain`, `tableHop`, `dockCoversScreen`, `saves`, `weaveSaves`, `queuedWrites`, `dockHoldsSaveMark`, `saveMarkHome`, `saveMark`, `saveMarkFor`, `touchOnly`, `SHORTCUT_CLAUSE`, `keyHint`, `dockSyncUrl`, `dockDismiss`, `dockGo` |
| 946-1141 | `drawDock`, `DOCK_PANE`, `SIDE_PANE`, `pinPane`, `applyPaneWidth`, `fitPanes`, `fitPanesFrame`, `fitPanesSoon`, `paneWatch`, `wirePaneGutter`, `sideWanted`, `sideSyncUrl`, `DOCK_ESC_OWNERS`, `allTables`, `registryWorkflows`, `loadSchema`, `inlineNameInput`, `navTableMenu`, `iconRuns` |
| 1142-1306 | `playIcon`, `lucideEl`, `canHover`, `iconEl`, `iconCatalogue`, `iconButton`, `publishViewHeaderHeight`, `keyboardInset`, `publishKeyboardInset`, `publishHeaderOn`, `sharedResize`, `watchViewHeader`, `stickViewHeader`, `CRUMB_ICON_FALLBACK`, `crumbIconEl`, `navIconEl`, `crumbInner`, `watchCrumbPath`, `watchHeadBar`, `fitHeadBar`, `crumbPath` |
| 1307-1459 | `fitCrumbs`, `CRUMB_MORE_PX`, `shedRows`, `dockRow`, `crumbFoldMenu`, `crumbOfHref`, `wsMarkEl`, `wsMarkIds`, `fillWsMark`, `refreshWsMarks`, `titleEdit`, `descriptionId`, `foldDescription`, `descToggle` |
| 1460-1583 | `viewHeader`, `wsHomeHref`, `navDrag`, `FOLDED_SPACES_KEY` |
| 1584-1782 | `renderNav`, `SYSTEM_FOLD_KEY`, `TRIAL_NOTICE_DAYS`, `ACCOUNT_ROLE_LABELS`, `accountSlot`, `accountDisplayName`, `accountWorkspaceName`, `healthNow`, `accountNow`, `refreshAccountChip`, `ACCOUNT_ROLE_HUES` |
| 1783-1976 | `accountChip`, `closeAccountMenu`, `personalMenuButton`, `personalMenu`, `postLogout`, `signOutOf`, `signOutEverywhere`, `fieldValueCell`, `isIconRef`, `stateLabel`, `stateNodes`, `chipLabel`, `stateCategory`, `stateChipClass`, `deckRoleOf`, `mermaidLoading`, `expandDocument`, `fullscreenViewer`, `openWhiteboard` |
| 1977-2171 | `renderMermaidIn`, `whileConnected`, `ghostBtn`, `dismissOutside`, `swallowClick`, `placeNear`, `showPopover`, `relearnRows`, `holdToConfirm`, `holdIcon`, `rememberGridFocus`, `restoreGridFocus` |
| 2172-2365 | `searchPicker`, `PHONE_SHORT_LIST`, `PHONE_ROW_H` |
| 2366-2557 | `anchorPop`, `valuePop`, `pickerSelect`, `chipPicker`, `chipPickerMulti`, `credentialLinkFor`, `credentialReveal`, `INTEGRATION_KEPT`, `integrationKeptCell`, `integrationKeyCell`, `replaceIntegrationKey`, `PICKER_FIELD_TYPES`, `READONLY_FIELD_TYPES`, `isNumCell`, `CREDENTIAL_GLYPHS`, `CREDENTIAL_KIND_LABELS`, `KEYSTORE_LABELS`, `computedMark`, `COMPUTED_NAME_MARKS`, `fieldDescription`, `qualifiedTableName` |
| 2558-2728 | `fieldRoute`, `fieldNameLabel`, `openCellPicker`, `activateCell`, `GRID_BOX_GUTTER`, `GRID_BOX_MIN`, `fitGridScroller`, `smoothScrollOk`, `paneOf`, `scrollBoxOf`, `scrollTargetIntoView`, `newRowTurn`, `stuckHeaderHeight`, `stickyFootHeight`, `focusNewRow`, `cellPopLayer`, `CELL_TYPE_PROPS`, `CLIPPABLE_CONTROLS`, `copyCellType`, `contentRect`, `CELL_POP_DELAY`, `SPILL_TYPES`, `spillsRight`, `gridRightEdge` |
| 2729-2926 | `showCellPop`, `CELL_POP_GAP`, `cellIsEditing`, `hideCellPop`, `spillEditor`, `overflowsX`, `WEAVE_CELLS`, `lastCopiedBlock`, `htmlText`, `weaveCellsHTML`, `readWeaveCells`, `fitChips`, `overflowsY`, `WEAVE_DEV`, `checkRowPitch`, `PHONE_MORE_W`, `phoneRowCore`, `phoneRowOf`, `phoneLeadEl`, `foldValueCounters` |
| 2927-3126 | `fitPhoneChipLines`, `markClippedCells`, `DENSITY_LABELS`, `densityKey`, `hasView`, `gridDensity`, `saveGridDensity`, `adoptLegacyDensity`, `registryTable`, `introControlsHidden`, `showIntroControls`, `renderMarkdownInto`, `appendRegistryPresentation`, `registryHref`, `mineOnly`, `rowClickTarget`, `menuSide`, `menuBounds` |
| 3127-3322 | `openMenu`, `menuRow`, `menu`, `dotsMenu`, `KIND_LABELS`, `unthunk`, `kindHead`, `menuFor`, `kindDots`, `OWN_CONTEXT`, `kindContext`, `renameNavTable`, `duplicateEntity`, `setLinkPreview`, `TRASHED`, `reopenAfterUndo` |
| 3323-3519 | `trashRow`, `OPEN_TRASH`, `MENU_ROWS`, `hasInlineMarkup`, `INLINE_TAG`, `inlineIconAccept`, `dressTokens` |
| 3520-3705 | `swapToEdit`, `dressedText`, `dressedUrl`, `viewCore`, `viewFieldOf`, `cellGraphics`, `numberCore`, `scaleText`, `figureCanvas`, `figureWidth`, `numberGraphic`, `numberGraphicFor`, `ratingEl`, `ratingListEl`, `sparkEl`, `chipView`, `chipElFrom`, `viewSegmentEl`, `viewChipEl`, `viewCardEl`, `viewCell`, `avatarUpload` |
| 3706-3899 | `avatarPicker`, `avatarControl`, `entityAvatarEl`, `relationChipEl`, `externalRefChipEl`, `chipOpensRecord`, `toggleMentionCaret`, `stateOptions`, `statePicker`, `editChipSegment`, `toggleSwitch`, `HTML_FRAME_SANDBOX`, `FILE_FRAME_SANDBOX`, `fileUrl`, `previewUrl`, `streamUpload`, `fileKind`, `isPictureFile`, `fileIconName`, `fileSizeText`, `isViewableFile`, `fileViewUrl`, `plainClick`, `MISSING_TAIL`, `fitAttachName`, `attachItemEl` |
| 3900-4086 | `attachSheetEl`, `fileBodyEl`, `fileFrameOf`, `fittedHeights`, `FIT_PENDING_MS`, `fitFrame`, `reserveFit`, `PAGE_STORAGE_SAVE_MS`, `fileViewerEl`, `placeCoverIn`, `entityCoverEl`, `fileLightbox`, `filePanel`, `labeledEditorFor` |
| 4087-4184 | `fileDropZone`, `optionCreator`, `optionHue`, `optionIcon`, `optionChipEl`, `READ_ONLY_KEEPS`, `readOnlyValue`, `staleToast`, `saveValues` |
| 4185-4356 | in `editorFor`: `saved`, `patch` |
| 4357-4521 | in `editorFor` |
| 4522-4719 | `DOC_PREVIEW_LINES`, `docPreviewCell`, `docChipCell`, `BLANK_READ_ONLY`, `blankView`, `pickTableView`, `viewed`, `gridConfigWrite`, `viewHref`, `showsDeleted`, `showsRollups`, `systemDefault`, `nextViewName`, `viewEdit`, `viewStrip`, `filterSeed`, `PREFILL_SKIP`, `prefillBase`, `manyRelation` |
| 4720-4840 | `prefillControl`, `prefillValues`, `openPrefill`, `tableFilters`, `setTableFilters`, `FILTER_KINDS`, `isFilterField`, `FILTER_CHIP_ROLE`, `filterStates`, `filterCounts`, `setFilterTotal`, `filterWhere`, `filterTriples`, `FILTER_DEBOUNCE`, `filterWrites` |
| 4841-5029 | `filterStrip`, `TABLE_SEARCH_DEBOUNCE`, `tableSearch`, `tableSearchTimer`, `tableSearchRelease`, `tableSearchWrites`, `tableSearchLocal`, `saveTableSearch`, `stopTableSearchTimer`, `tableSearchText`, `setTableSearch`, `openTableSearch`, `tableSearchBox`, `showDatabase`, `FIRST_PAGES_KEPT`, `firstPages`, `rememberFirstPage`, `tableGroup`, `serverSums` |
| 5030-5229 | `readAndDrawTable`, `BULK_KEEPS_ROWS`, `bulkPatch`, `gridMoves`, `gridFields`, `graftChips`, `gridSort`, `gridPager`, `classSelector`, `tableControlPopover`, `tableControlButton`, `tableControlHeader` |
| 5230-5388 | `tableViewButton`, `tableDensityButton`, `setFilterCount`, `tableFilterButton`, `tableSortButton`, `RO`, `startRowDrag` |
| 5389-5506 | `phoneRowPopover`, `VP`, `PANE_KEY`, `PANE_SECTION_KEY`, `readPref`, `writePref`, `viewPane`, `PANE_SECTIONS`, `NO_SORT_TYPES`, `sortFieldOptions`, `sortWords`, `paneSwitch`, `paneWrite` |
| 5507-5681 | `levelsBlock`, `listRowPrefs`, `drawnGroupKeys`, `rollupCells`, `keyedSeg`, `displayBlock`, `footStatLists` |
| 5682-5863 | `footRollupWrite`, `paneValue`, `paneChanged`, `paneFilters`, `paneFields`, `paneBody`, `paneEl`, `paneWanted`, `setPaneOpen`, `paneSync`, `renderViewPane`, `closeSharePanel`, `sharePanelOwner` |
| 5864-6041 | `sharePanelButton`, `tableChromeSig`, `tableChromeOn`, `tableChrome`, `tableToolsButton`, `newRecordButton`, `paintTableChrome`, `teardownGrid` |
| 6042-6229 | `drawDatabase`, `listCore`, `boardCore`, `isBoardLayout`, `listSetup`, `listKeys`, `listDomain`, `listTargetRows`, `readAndDrawBoard`, `listWrites`, `shareCollapsed`, `listViewWrite` |
| 6230-6374 | `listLevelValue`, `listPathValues`, `listHeadingEl`, `groupCrumbEl`, `breakdownFields`, `groupSummaryEl`, `drawnPast`, `cappedEls`, `boardCardFields`, `PICTURE_LABELS`, `FIT_OPTIONS`, `boardControls`, `groupFieldOptions`, `tableGroupButton`, `eyeGlyph`, `eyeWrites`, `eyeTails`, `eyeGestures`, `eyeGesture`, `REFERENCE_PANELS`, `showsRefPanel` |
| 6375-6571 | `fieldVisibilityPopover`, `dropDrawnColumn` |
| 6572-6586 | `drawnMatches`, `visibleCols`, `GRID_SEQ` |
| 6587-6786 | in `renderTable`: `isSysCol`, `cellBox`, `sysValue`, `sysCell`, `refit`, `SEL`, `repaintRange`, `chosen`, `drawnIds`, `ordered`, `total`, `itemAt`, `itemOf`, `loadedIds`, `paintSelection`, `setChosen`, `clearChosen`, `onBox`, `runOnSelection`, `dropRows`, `trashChosen`, `runBulk`, `relations`, `otherTables`, `nRows`, `picker`, `setField`, `setValue`, `relationPicker`, `linkTo` |
| 6787-6986 | in `renderTable`: `more`, `moreCmds`, `holdAct`, `drawPuck`, `fieldCell`, `buildRow`, `clientSortValue`, `groupSlots`, `rowSlotNear`, `foldGroup`, `buildGroupHead`, `buildSumRow`, `buildSlot`, `GW` |
| 6987-7184 | in `renderTable`: `canFreezeHere`, `storedFrozen`, `storedWidth`, `widestOf`, `emptyDoc`, `widthOf`, `headOf`, `leadCount`, `refreeze`, `layoutCss`, `paintLayout`, `sizePidColumn`, `settle` |
| 7185-7368 | in `renderTable`: `blocked`, `commitWidth`, `flip`, `applyOrder`, `columnDrag` |
| 7369-7556 | in `renderTable`: `headPointerDown`, `headKey`, `listRows`, `rowH`, `spacer`, `setPad`, `reach`, `paintLoadMore`, `rowFor`, `scroller`, `geometry`, `pinFor`, `paint`, `rewindow`, `schedule`, `onScroll`, `scrollToRow`, `ensureRow`, `repaintRow` |
| 7557-7739 | in `renderTable`: `patchRows`, `topEdge`, `topRow`, `setDensity`, `draw`, `KM`, `stops`, `rowsOf`, `openerOf`, `cellAt`, `landOn` |
| 7740-7938 | in `renderTable`: `apply`, `RG`, `rangeCols`, `refOfCell`, `coordOfCell`, `coordOfRef`, `refAtCoord`, `sameCell`, `rangeRect`, `cellOfNode`, `cursorCell`, `rangeOrCursor`, `paintRange`, `setRange`, `clearRange`, `fieldNamed`, `typeOf`, `optionsOf`, `labelOf`, `valueAt`, `relationRows`, `runRange`, `openControl`, `clipboardTarget`, `cellOfEvent`, `onGrid` |
| 7939-8069 | in `renderTable`: `cellUnder`, `endDrag`, `dropCellPop`, `listRow`, `destroy` |
| 8070-8261 | `TAP_SLOP`, `TAP_MS`, `phoneChipAt`, `editPhoneField`, `SYSTEM_COLS`, `stampEl`, `usersCache`, `flushUsers`, `workspaceUsers`, `actorChipEl`, `commentAuthorText`, `workflowRows`, `workflowRow`, `PULSE`, `automationSeen` |
| 8262-8454 | `noteAutomationWrites`, `pulseTargets`, `pulseCells`, `colField`, `MIN_COLUMN_WIDTH`, `cellFitProbe`, `fitColumnWidth`, `clearSelection`, `columnResizeGrip`, `FIELD_MENU_ICONS`, `lookupTargetOf`, `sortLabelsFor` |
| 8455-8649 | `fieldMenuButton`, `measureCtx`, `textWidth`, `dateControl`, `dateStoreFns`, `rangeControl`, `calendarGlyph`, `segCtl`, `lazyScripts`, `workflowCells`, `lazyScript`, `warmDatePicker`, `withDatePicker`, `openForms`, `openInvite`, `settingsView`, `openTrash`, `openSettings`, `openDeleteWorkspace`, `boardView`, `openFieldDialog` |
| 8650-8830 | `fieldConfigToast`, `rolledBackText`, `SCROLL_PANES`, `keepScroll`, `editFieldDialog`, `reorderBlocks`, `reorderField`, `addFieldMenuButton`, `FOOT_LABELS`, `FOOT_NUMERIC`, `footPickerLabel`, `footAggregatesFor`, `spaceRollupName`, `RATING_SCALE_FOOT`, `spaceRollupEntry`, `renderFooter`, `fillFooter` |
| 8831-9020 | `footerPicker`, `spaceStatTiles`, `showSpace`, `appendSpaceDetails`, `systemSpaceNote`, `useTemplateButton`, `useTemplateDialog` |
| 9021-9202 | `spaceTablesCard`, `relationMap`, `relationMapCard`, `liveEditors`, `pendingDocSaves`, `docPulls`, `vditorTheme`, `vditorLoading`, `loadVditor`, `crepeLoading`, `loadCrepe`, `tiptapLoading`, `loadTiptap`, `docEditorKind`, `docBubbles`, `REF_CHIP_DEBOUNCE`, `refChipLayers`, `docCodeAuto`, `docCodeRaw`, `scrollRest`, `scrollMoved`, `resizeFrame`, `DASH_READING_LINE`, `docRails`, `attachDashRail`, `DOC_BLOCK_ROOT`, `headText`, `sectionTexts` |
| 9203-9398 | `refreshDashRail`, `docFolds`, `DOC_DECOR`, `docFoldState`, `attachHeadingFolds`, `refreshHeadingFolds`, `__weaveEditors`, `__weaveDocSaves`, `__weaveFlushDocSaves`, `retheme`, `docBases`, `docBaseOf`, `noteDocBase`, `sendDoc`, `docConflict`, `scheduleDocSave`, `flushDocSave`, `whenEl`, `flushDocSaves`, `leaveDocs`, `teardownDocEditors`, `dropDecor` |
| 9399-9515 | `docSectionCollapse`, `foldCaret`, `appearsAsPanel`, `showEntity`, `nextStateButton`, `nextStateFor`, `pageGo`, `entityHop`, `entityRefs` |
| 9516-9666 | in `renderEntityView`: `repaint`, `holds`, `holdsDoc`, `asNode`, `streamed`, `surfaceBehind`, `tellSurface`, `docSaved`, `frame`, `saved`, `recordCtx`, `openEye`, `drawFab`, `shownRefPanels`, `openSide` |
| 9667-9860 | in `renderEntityView`: `docSection`, `relationCount`, `coverEl`, `placeCover`, `anchor`, `restingGrip`, `handle`, `wireBlock` |
| 9861-10056 | in `renderEntityView`: `dragRow`, `named`, `drawFiles` |
| 10057-10099 | in `renderEntityView`: `refCard`, `drawRefs` |
| 10100-10255 | `activityPanel`, `quickCreate`, `newUserDialog`, `tableTray`, `runStarter`, `emptyWorkspace`, `onboardingAsked`, `maybeOnboard` |
| 10256-10372 | `onboard`, `SCHEMA_OPEN_KEY`, `schemaDisclosure`, `fieldTray`, `addFieldDialog` |
| 10373-10562 | `relatedGrid`, `subtableOf`, `chipTriple`, `subtableChips`, `subtableWrites`, `subtablePopover`, `ACTIVITY_PAGE`, `openActivityLog` |
| 10563-10757 | `showView`, `homeReads`, `bootHomeReads`, `workspaceSystemCard`, `savedPagesCard`, `showHome`, `appendWorkspaceDetails`, `ROLE_LABELS`, `currentWsName`, `RECENT_KEY`, `RECENT_KEEP`, `readRecents`, `noteRecent`, `noteEntityRecent`, `marked`, `wireSearchButton`, `paletteShell`, `openPalette` |
| 10758-10956 | `relationTargets`, `linkSearch`, `gestures`, `GESTURE_CAP`, `UNDO_WINDOW`, `CLAIM_CAP`, `UNDO_REFUSED`, `keptLine`, `undoToast`, `undoKey`, `pendingClaims`, `looseIds`, `ENTITY_UNDO`, `BULK_UNDO`, `undoEntriesOf`, `newGesture`, `noteWrite`, `pinClaims`, `claimOwn`, `undoQueue`, `undoOwn`, `stepBackOwn`, `unlinkWithUndo`, `undoPatch`, `undoGesture` |
| 10957-11149 | `refreshView`, `focusGridRow`, `KEY_SHEET_ANYWHERE`, `KEY_SHEET_TABLE`, `openKeySheet`, `LOADER_CYCLE_MS`, `LOADER_SHOW_AFTER_MS`, `LOADER_POSE_FROM`, `LOADER_POSE_TO`, `LOADER_EXIT_RATE`, `LOADER_HOLD_MS`, `LOADER_FADE_MS`, `SKELETON_SHOW_AFTER_MS`, `LOADER_CAPTION_AFTER_MS`, `LOADER_RETRY_AFTER_MS`, `LOADER_CAPTION_TEXT`, `LOADER_RETRY_LABEL`, `loading`, `initPageLoader`, `showPageLoader`, `paintLoaderWait`, `paintLoaderRetry`, `clearLoaderWait`, `hidePageLoader`, `stillLoader`, `ropeAnimations`, `settleLoader`, `keepLoader` |
| 11150-11331 | `withPageLoader`, `gridWait`, `gridHold`, `markGridWait`, `paintGridWait`, `gridLoaderNode`, `placeGridLoader`, `showGridLoader`, `hideGridLoader`, `resetGridWait`, `paintSkeleton`, `skeleton`, `scheduleSkeleton`, `cancelSkeleton`, `syncDocTitle`, `renderRoute`, `rememberRoute`, `navDraw`, `navOwns` |
| 11332-11464 | `dispatchRoute`, `paintRouteError`, `renderRouteSafely`, `installPhoneBar`, `NEW_ROW_CHOICES`, `NEW_ROW_OPTIONS`, `rowNoun`, `sheetGrip` |
| 11465-11617 | `newRowTray`, `syncPhoneBar`, `ensureNavMenu`, `route`, `redock` |
| 11618-11785 | `buildWsRail`, `wsSpec`, `servesBareRoot`, `bareRootWs`, `wsHref`, `wsApiPrefix`, `wsApi`, `wsLogoButton`, `uploadWorkspaceLogo`, `removeWorkspaceLogo`, `wireWsNew`, `tightShell`, `navPeekDwell`, `closeNavPeek`, `showNavCollapsed`, `setNavCollapsed` |
| 11786-11975 | `wireNavCollapse`, `NAV_WIDTH`, `wireNavResize`, `NAV_KEY_OWNERS`, `wireNavHold`, `labelNavMenu` |
| 11976-12123 | `navMenuButton`, `wireSkipLink`, `THEME_ICONS`, `THEME_LABELS`, `THEME_MEDIA`, `themePref`, `applyTheme`, `cycleTheme`, `wireTheme`, `syncSchema`, `bugGlyph`, `bugRecorder`, `bugDraft`, `installBugReporter`, `bugTrigger`, `closeBugPanel` |
| 12124-12256 | `openBugPanel` |

## src/engine.js

| Lines | Declares |
| --- | --- |
| 1-198 | `iconValue`, `IconRegistry`, `MarkIcons`, `ChipCore`, `Term`, `ListCore`, `ViewPane`, `BoardCore`, `LAYOUTS`, `PhoneRow`, `SYSTEM_TERMS`, `CSV_FORMULA_START`, `unquoteCSVCell`, `parseCSV`, `VALUES_BLOCK`, `FILES_BLOCK`, `REFERENCE_PANELS`, `isFixedBlock`, `BLOB_ID`, `isBodyBlock`, `VALUE_TYPES`, `isFileField`, `AVATAR_SHAPES`, `AVATAR_IMAGE_TYPES`, `SEARCHED_VALUE_TYPES`, `REGISTRY_HITS`, `LOCKED_NAME`, `UPGRADE_FLOOR`, `refuseBeforeFloor`, `RESERVED_NAMES`, `own`, `PASTED_ENTITY`, `pastedEntityId`, `byPosition`, `checkPosition`, `SYSTEM_SPACE_NAME`, `SYSTEM_SPACE_ICON`, `LEGACY_SYSTEM_SPACE_NAME`, `answersLegacySystem`, `notFound`, `fieldNotFound`, `refuseReserved`, `sniffImage`, `fileBlobIds`, `PREVIEW_MAX_BYTES`, `FILE_MAX_BYTES`, `SCHEDULE_ROW_BUDGET`, `mbText`, `workspaceFileMaxBytes`, `PREVIEW_TYPES`, `logoType`, `LOCAL_RANGES`, `localAddress`, `webhookRefusal`, `INLINE_FILE_TYPES`, `HTML_VIEW_POLICY`, `HTML_PAGE_POLICY`, `sandboxedHtmlHeaders`, `HTML_FILE_TYPES`, `FILE_STORAGE_CAP`, `isHtmlFile`, `FRAME_HEIGHT_SCRIPT`, `FRAME_LINK_BASE`, `frameLinkBase`, `scriptJson` |
| 199-397 | `frameStorageScript`, `LEADING_DOCTYPE`, `viewHtml`, `fileHeaders`, `ATTACHMENT_PREVIEWS`, `ATTACHMENT_SIZES`, `ATTACHMENT_FITS`, `ATTACHMENT_LOOK_KEYS`, `isBoolType`, `COMPUTED_TYPES`, `DERIVED_CACHE_CAP`, `FieldDialogCore`, `STATE_CATEGORIES`, `DEFAULT_WORKFLOW_STATES`, `SYSTEM_SORT_KEYS`, `TEXT_OPS`, `VIEW_SHAPES`, `QUERY_SHAPES`, `pageNumber`, `describeValue`, `checkWhereNode`, `checkQueryDocs`, `leanRow`, `DESCRIPTION_SIZES`, `DESCRIPTION_CHARS`, `ACTIVITY_CAP`, `ACTIVITY_PAGE`, `ACCOUNT_ACTOR`, `accountActor`, `REMOVED_ACCOUNT`, `FIELD_CONFIG_ACTIONS`, `SCHEMA_AUDIT_ACTIONS`, `UNTAGGED_SCHEMA_ACTIONS`, `ONTOLOGY_TYPES`, `ONTOLOGY_LEGEND`, `ontologyEtag`, `fieldDefinition`, `canonicalJSON`, `fieldDefinable`, `choiceIds`, `definitionChanges`, `VIEW_AUTO_SEGMENTS`, `VIEW_DEFAULTS`, `VIEW_NAMES`, `VIEW_EXCLUDED_TYPES`, `plainLines`, `GRID_SYSTEM_COLUMNS`, `RETIRED_SYSTEM_FIELD`, `withoutRetired`, `sysColumnId`, `sysColumnName`, `viewEntryName`, `placeField` |
| 398-588 | `showBySchema`, `clip`, `DYNAMIC_DATE_DEFAULTS`, `DOCUMENT_KINDS`, `CREDENTIAL_KINDS`, `KEYSTORES`, `DEFAULT_PAIR_PARTS`, `NUMBER_COSTUME_KEYS`, `ROLLUP_COSTUME_KEYS`, `NUMBER_DISPLAYS`, `isGraphicDisplay`, `CELL_COLORS`, `cellColorValue`, `SPARKLINE_STYLES`, `lastNumber`, `RATING_MAX`, `RATING_DEFAULTS`, `RATING_SCALE_AGGS`, `ratingValue`, `DATE_COSTUME_KEYS`, `FORMULA_COSTUME_KEYS`, `DG`, `DEFAULTABLE_TYPES`, `FIELD_TYPES`, `DOC_REVISION_WINDOW_MS`, `docFingerprint`, `docChange`, `RETIRED_STATE_CATEGORIES`, `WORKFLOW_STATES`, `workflowActor`, `actorWorkflow`, `HOME_RUNS`, `HOME_RUN_ROWS`, `templated`, `scheduleOut`, `listenerOut`, `HOOK_PARTS`, `compileHook`, `hookOut`, `triggerOut`, `LISTENER_ACTIONS`, `HOOK_RECORD_ACTIONS`, `ACTION_TEXT_MAX`, `boundedText`, `workflowScript`, `WORKFLOW_PANEL`, `WORKFLOW_STAMPED`, `whenWords`, `actionWords`, `urlHost`, `HTTP_STEP_BODY_MAX`, `itemRow`, `hookPathOf`, `OUTBOUND`, `CREDENTIAL_HEADERS`, `blankTemplates`, `fillJson`, `stepBody`, `thenWords`, `UPSERT_KEY_TYPES`, `blankSource`, `sourcePath`, `HUE_HEX`, `HUES`, `hueName`, `hueOf`, `normaliseOption`, `AGGREGATES`, `MAX_COMPUTE_DEPTH`, `CYCLE_PREFIX`, `isCycle`, `CycleSignal`, `FORMULA_SCAN_CAP`, `RECIPE_KEYS`, `DEFINABLE_TYPES`, `MAX_DEFINITION_DEPTH` |
| 589-764 | `TYPE_MIGRATIONS`, `ONTOLOGY`, `dressNumber`, `dressDate`, `pickCostume`, `putCostume`, `rollupCostume`, `formulaCostume`, `dressDateRange` |
| 765-924 | `numberConfig`, `dateConfig`, `optionName`, `credentialConfig`, `costumeFromDescriptor`, `recipeFromDescriptor`, `numberDescriptor`, `asBoolean`, `asString`, `dateType`, `optionType`, `CREDENTIAL_CONFIG_KEYS` |
| 925-1093 | in `FIELD_TYPE_CONFIG`: `text`, `number`, `formula`, `lookup`, `rollup`, `rating`, `date`, `daterange`, `checkbox`, `toggle`, `url`, `email`, `select`, `multiselect`, `workflow`, `field` |
| 1094-1215 | in `FIELD_TYPE_CONFIG`: `key`, `attachments`, `avatar`, `document`, `view` |
| 1216-1334 | `normalizeSelfContainedConfig`, `normalizeDefinition`, `formatFilters`, `parseFilters`, `formatSort`, `SORT_FORM`, `parseSortPart`, `parseSort`, `MIN_COLUMN_WIDTH`, `VIEW_MIN_WIDTH`, `VIEW_MAX_WIDTH`, `VIEW_DENSITIES`, `formatWidths`, `parseWidths`, `fieldDescriptionValue`, `CREATE_INPUT_KEYS`, `BULK_OPS`, `nowISO`, `schemaFingerprint`, `tableReaders` |
| 1335-1446 | `templateDoc`, `HELD`, `deferMigrations`, `runDeferredMigrations`, `detachHubRegistry` |
| 1447-1637 | `detachedRegistryState`, `inviteUrl`, `USER_COLUMNS`, `USER_KEPT`, `USER_PRIVATE`, `hidesChange`, `capital` |
| 1638-1824 | in `Weave`: `#dirty`, `#dirtyAll`, `#held`, `#detachedStorage`, `#schemaVersion`, `#rows`, `#query`, `#cutoffs`, `#computing`, `constructor`, `#migrate`, `#settlePositions`, `#place`, `#spacesInOrder`, `#placeSpace`, `#tablesOfSpace`, `#reconcileFieldOrder`, `#ensureDescriptionField`, `#repairDoubledInverses` |
| 1825-2022 | in `Weave`: `#ensureViewFields`, `#ensureSystemColumnsInViews`, `#dropRetiredSystemField`, `#ensureStandardViewName`, `#ensureTableViews`, `viewField`, `#normalizeViewConfig`, `#viewSegmentFields`, `#faceOf`, `renderView`, `#viewLine`, `termOf` |
| 2023-2214 | in `Weave`: `#inverseName`, `#setTerm`, `descriptionField`, `save`, `#rolledBack`, `#forgetPending`, `#touching`, `touching`, `affectedBy`, `#mark`, `settleDeferred`, `maybeRefresh`, `schemaVersion`, `spaceMembers`, `setSpaceMember`, `removeSpaceMember`, `#nameHolders`, `#assertNameFree` |
| 2215-2386 | in `Weave`: `createSpace`, `listSpaces`, `findSpace`, `getSpace`, `updateSpace`, `deleteSpace`, `restoreSpace`, `createTable`, `listTables`, `userTables`, `qualifiedName`, `findTable`, `#tableNotFound`, `getTable` |
| 2387-2567 | in `Weave`: `updateTable`, `moveTable`, `duplicateTable` |
| 2568-2765 | in `Weave`: `deleteTable`, `restoreTable`, `relationMapMmd`, `createView`, `listViews`, `getView`, `deleteView`, `restoreView`, `resolveView` |
| 2766-2963 | in `Weave`: `shareView`, `unshareView`, `mintShare`, `listShares`, `revokeShare`, `renewShare`, `updateShare`, `regenerateShare`, `shareByToken`, `tableView`, `#viewTarget`, `#viewIndex`, `#noView`, `#blankFields`, `#viewOut`, `#phoneRowNamed`, `#writePhoneRow`, `#listField`, `#sameGrouping`, `#checkGroup` |
| 2964-3044 | in `Weave`: `#orderRow`, `#writeListKeys`, `#checkViewName` |
| 3045-3234 | in `Weave`: `#writeView`, `#sortOutOfGroup`, `#writeDefaultView`, `#checkFilters` |
| 3235-3298 | in `Weave`: `#viewQueryIn`, `#checkSort`, `#defaultViewConfig`, `applySchema`, `#atomically` |
| 3299-3497 | in `Weave` › `#applySchemaPass`: `act`, `configFromDescriptor`, `colorsOf`, `fieldChanged`, `docTable`, `cardinalityOf`, `relationArgs` |
| 3498-3570 | in `Weave` › `#applySchemaPass` |
| 3571-3641 | in `Weave`: `listTemplates`, `useTemplate`, `build`, `#buildCopy` |
| 3642-3831 | in `Weave` › `#buildRun`: `fail`, `step`, `extra`, `isObj`, `cosmetic`, `listAt`, `result`, `target`, `phase`, `relationOf`, `resolves`, `visit` |
| 3832-3886 | in `Weave` › `#buildRun` |
| 3887-4077 | in `Weave`: `#buildOrder`, `#applyTableCostume`, `#bodyOrderFrom`, `#legacyEdits`, `#applyViews`, `workspaceOrder`, `moveWorkspace`, `getWorkspace`, `updateWorkspace`, `#keyStore` |
| 4078-4275 | in `Weave`: `migrateKeys`, `credentialConfig`, `setKey`, `deleteKey`, `hasKey`, `listKeys`, `resolveKey`, `#localKeys`, `#keyInWorkspace`, `#mayReveal`, `revealKey`, `ownsKey`, `#callerAccount`, `#isKeyHolder`, `#mayGrant`, `#grantRefusal`, `grantKey`, `revokeKey`, `#renameKeyHolder`, `credentialLink`, `ROLES`, `ROLE_LABELS`, `OLD_ROLES`, `roleName`, `#audit` |
| 4276-4475 | in `Weave`: `#spacesTouching`, `auditWorkspace`, `listAudit`, `createAccount`, `#createAccount`, `verifyToken`, `hasAccounts`, `listAccounts`, `noteTokenWrite`, `actorName`, `isActor`, `#accountById`, `#actorFor`, `#namedShared`, `#namedDetail`, `#namedActivity`, `#lockedNames`, `deleteAccount`, `onboardedAt`, `markOnboarded`, `agentSeen`, `noteAgent`, `setRequireAuth` |
| 4476-4672 | in `Weave`: `billing`, `startTrial`, `markTrialMail`, `linkBillingOrg`, `SESSION_TTL_MS`, `LAST_SEEN_MS`, `#account`, `#hash`, `createSession`, `verifySession`, `#lastSeenStale`, `removedSession`, `listSessions`, `revokeSession`, `INVITE_TTL_MS`, `#issuer`, `linkIdentity`, `#mintInvite`, `#invite`, `inviteMember`, `listInvites`, `revokeInvite`, `#inviteName` |
| 4673-4858 | in `Weave`: `renameAccount`, `setAccountRole`, `#memberName`, `identityInvite`, `invitesForEmail`, `acceptInvite`, `redeemIdentityInvite`, `#redeem`, `unlinkIdentity`, `accountForIdentity`, `#scrubIdentityEmails`, `#inMetaSync`, `#oneTime`, `inviteIssuer`, `localKeyAccess`, `registryHost`, `members`, `#reg`, `#engines`, `#engineOf`, `#wsIdOfRow`, `#ownerOf`, `#tableAnywhere`, `#fieldAnywhere` |
| 4859-5044 | in `Weave`: `#retireDetachedOrphans`, `detachHubRegistry` |
| 5045-5231 | in `Weave`: `joinRegistry`, `hostRegistry`, `#syncAll`, `#userRows`, `#syncUsers`, `#userTarget`, `#userValues`, `#createUserRow` |
| 5232-5426 | in `Weave`: `#updateUserRow`, `#setInviteRole`, `#deleteUserRow`, `takeOneTime`, `#syncWorkspaceRow`, `syncRegistry`, `#metaSync`, `#inUndo`, `#undoOwner`, `#undoHeld`, `#recordUndo`, `#undoPending`, `#pushUndo`, `#holdUndo`, `#writersSince`, `#keptSince`, `#undoBefore`, `#undoAfter`, `#lastWriter`, `#undoChanged`, `#undoExpected` |
| 5427-5538 | in `Weave`: `undo`, `listUndo`, `#sysTable`, `#sysRow`, `#relIds`, `#sysField` |
| 5539-5693 | in `Weave`: `#ensureMetaTables` |
| 5694-5889 | in `Weave`: `registryReport`, `rebuildRegistry`, `#syncSpaceRow`, `#syncTableRow`, `#syncViewRows` |
| 5890-6086 | in `Weave`: `#viewAnywhere`, `#syncFieldRow`, `#dropFieldRow`, `#fieldOwner`, `#dropSysRow`, `#trashSysRow`, `#restoreSysRow`, `#integrationNamed`, `#integrationProvider`, `#integrationInput`, `#updateIntegrationRow`, `#onReg`, `#stampIntegration`, `#integrationRow`, `#integrationTarget`, `#integrationEntry`, `#sealIntegrationKey`, `#dropIntegrationKey` |
| 6087-6249 | in `Weave`: `#checkIntegration`, `integrationFetch`, `setIntegrationCredential`, `#interceptCreate` |
| 6250-6429 | in `Weave`: `#interceptUpdate`, `#viewRowPatch`, `#interceptDelete`, `findField`, `getField`, `materializeField` |
| 6430-6620 | in `Weave`: `addField`, `addRelation`, `bodyBlocks`, `#recipe`, `#refuseSpaceRepoint`, `#repoint`, `#formulasBroken` |
| 6621-6773 | in `Weave`: `#formulaHealth`, `#formulaRenames`, `#wherePaths`, `#ruleRenames`, `#applyRuleRenames`, `#fieldSettings`, `#fieldReaders`, `updateField`, `fieldChangeSince` |
| 6774-6958 | in `Weave`: `#updateField`, `#orphanedChoices`, `#subtableConfig`, `#dropOlderSnapshots`, `#publicDetail`, `#fieldLogQuiet`, `#withoutFieldLog` |
| 6959-7095 | in `Weave`: `#fieldConfigRows`, `#fieldConfigRow`, `#rollbackCheck`, `rollbackFieldConfig`, `#formulaCycle`, `#refuseFormulaCycle`, `checkFormula` |
| 7096-7260 | in `Weave`: `#migrateFieldType`, `#textToRelation`, `#relationToText` |
| 7261-7453 | in `Weave`: `deleteField`, `restoreField`, `#trashedField`, `#trashedFieldAnywhere`, `#purgeTrashedField`, `#fieldTrashEntry`, `#fieldSnapshot`, `#reinstateField` |
| 7454-7643 | in `Weave`: `#targetFieldReaders`, `#removeFieldRaw`, `documentFields`, `#resolveDocField`, `listEntities`, `#rowIndex`, `#derived`, `#forgetDerived`, `#derivedKey`, `#remember`, `#sortKeys`, `#indexRow`, `#unindexRow`, `#tableRows`, `#rowsByPublicId`, `#liveRowCounts`, `listTrash`, `#present`, `#liveEntity`, `#lockedEntity` |
| 7644-7840 | in `Weave`: `#hiddenSpaces`, `#hiddenKey`, `#tableHidden`, `#rowHidden`, `#sysRowHidden`, `#framed`, `#mayChange`, `#readOnlyFor`, `#guarded`, `#belowArchitect`, `#withheld`, `#mayWriteRow`, `#mayWriteTable`, `#mayShape`, `canSee`, `asAccount`, `permalink`, `getEntity`, `findEntity`, `entityName`, `createEntity` |
| 7841-8009 | in `Weave`: `#claimPublicId`, `#insertEntity`, `updateEntity`, `#checkValues`, `#applyValues`, `#holdRows`, `#restoreRows` |
| 8010-8193 | in `Weave`: `#writeValues`, `#validateDefault`, `now`, `#resolveDefault`, `#coerceDate`, `#validateValue`, `#findOption`, `relationTargetDbIds`, `#normalizeRelationInput` |
| 8194-8370 | in `Weave`: `#setRelationValue`, `#logInverse`, `#relationIds`, `#pluck`, `link`, `unlink`, `setState`, `#setStateInternal`, `deleteEntity`, `bulk` |
| 8371-8527 | in `Weave`: `#bulkRows`, `#portable`, `#moveEntity`, `restoreEntity`, `resolveField`, `#resolve`, `#rawName` |
| 8528-8714 | in `Weave`: `#resolveValue`, `#displayValue`, `#lookupRelation`, `#rollupRows` |
| 8715-8914 | in `Weave`: `#rollupTarget`, `#checkWhere`, `tableRollups`, `tableStats`, `entityRevision`, `conditionalWrite`, `#updateAtRevision`, `#adoptRolledBack`, `#inViewerZone` |
| 8915-9072 | in `Weave`: `readEntity`, `#readEntityIn`, `#numberDisplay`, `#scaleOf`, `#ratingOf`, `#summary`, `#inWorkspace`, `query`, `#inQuery` |
| 9073-9250 | in `Weave`: `#queryIn`, `#groupFieldShape`, `#groupTargets`, `#viewGroups`, `#rollupsOver`, `#matchNode` |
| 9251-9448 | in `Weave`: `#matchCondition`, `#definitionRank`, `#looseEq`, `#storesDate`, `#pathValue`, `getDoc`, `#docText`, `setDoc`, `docBase`, `#setDocAtBase`, `appendDoc`, `#writeDoc`, `#docRevisionFresh`, `#restoring`, `#recordDocRevision`, `listDocRevisions`, `getDocRevision`, `#docRevision`, `restoreDocRevision` |
| 9449-9587 | in `Weave`: `addComment`, `deleteComment`, `activityFeed`, `#activityFeed`, `getActivity`, `spaceHome`, `workspaceHome`, `#homeTables` |
| 9588-9720 | in `Weave`: `#homeRuns`, `#nextSeq`, `#logActivity`, `#stamping`, `#wfQueue`, `#wfEpoch`, `#wfRows`, `#wfRules`, `#noWebhooks`, `#trialHosted`, `webhookTimeoutMs`, `deliveryAttempts`, `createAutomation`, `#asReg` |
| 9721-9915 | in `Weave`: `#compileSpec`, `#compileListener`, `#compileUpsert`, `#compileHttpRequest`, `#checkFits` |
| 9916-10109 | in `Weave`: `#renderSpec`, `#workflowRows`, `#workflowHome`, `#wfField`, `#wfOption`, `#workflowRule`, `#allRules`, `#settleWorkflows`, `#stampDirty`, `#stamp`, `#setOption`, `#settleWorkflow`, `#stampRun` |
| 10110-10307 | in `Weave`: `#stampPoll`, `#guardWorkflowOn`, `#ruleOut`, `#ruleDiffers`, `#myRules`, `listAutomations`, `describeAutomations`, `#myRow`, `updateAutomation`, `deleteAutomation`, `#migrating`, `#migrateAutomations`, `#runAccess`, `#runRow` |
| 10308-10505 | in `Weave`: `#saveRun`, `startRun`, `updateRun`, `listRuns`, `#mailingRuns`, `runMaintenance`, `#runAutomations`, `#runAutomationsIn`, `#fireRule`, `#pendingRuns`, `automationsSettled` |
| 10506-10686 | in `Weave`: `#liveRow`, `#stepRun`, `#chunkedRules`, `#yieldRun`, `#awaitStep`, `#finishRun`, `#inFlight`, `claimInbound`, `isEcho`, `#hookOf`, `#hookWords`, `#hookSecret`, `#hookRule`, `hookDeliveries`, `revealHookSecret`, `#hookRecord`, `receiveHook` |
| 10687-10886 | in `Weave`: `#receiveHook`, `#rememberEcho`, `pendingDeliveries`, `#dropDelivery`, `#deliveryFailed`, `#runSnapshot`, `#deadLetter`, `#letterLanded`, `replayDelivery`, `#updateDeliveryRow` |
| 10887-11071 | in `Weave`: `#reviveRun`, `runDeliveries`, `#scheduleSince`, `#scheduleArmed`, `runSchedules`, `#polling`, `#pollState`, `#pollBudget`, `#runListeners`, `#poll`, `#pollWords`, `#pollLanded` |
| 11072-11256 | in `Weave`: `#runAction`, `#httpRequest`, `#send`, `#httpLand`, `#upsertSource`, `#upsertRow`, `#signedHeaders` |
| 11257-11454 | in `Weave`: `#template`, `search`, `#searchHits`, `universalSearch`, `#scopedSearch`, `capRows`, `previewFields`, `#stateLabel`, `referencesTo`, `referencesFrom`, `#fileBytes` |
| 11455-11650 | in `Weave`: `storageStats`, `#blobPath`, `#hasBlob`, `#readBlob`, `#dropBlob`, `#stagePath`, `#blobHead`, `filesOnDisk`, `stageBlob`, `streamBlob`, `dropStagedBlob`, `#adoptBlob`, `#writeBlob`, `attachFile`, `attachToField`, `#fileHolders`, `#indexFiles`, `#fileHolder`, `readFileMeta`, `readFile`, `openFile` |
| 11651-11843 | in `Weave`: `#fileMeta`, `readFileStorage`, `writeFileStorage`, `setWorkspaceLogo`, `getWorkspaceLogo`, `deleteWorkspaceLogo`, `deleteFile`, `importCSV`, `#importRows`, `spaceVersions`, `ontology`, `#schemaHistory`, `#ontologyLabel` |
| 11844-12041 | in `Weave`: `#ontologyFields`, `#ontologyComputed`, `#ontologyConcept`, `describeSchema`, `exportJSON` |
| 12042-12126 | in `Weave`: `#landBlobs`, `#keepSecrets`, `importJSON`, `#fileLedger`, `exportCSV` |
