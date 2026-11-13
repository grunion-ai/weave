# Region index

`public/app.js` (11,989 lines) and `src/engine.js` (11,853 lines) are too long to read whole. This page cuts each one into regions of at most 200 lines along its declarations and names what every region declares, so a change opens the right 200 lines first. The first table places each behaviour of the [grid map](grid.md) by line.

`node scripts/region-index.mjs` generates this page at commit [`03965a3`](https://github.com/grunion-ai/weave/tree/03965a39b34da55eaabaac7f11dd287251ca65e7), the commit the [architecture map](architecture/README.md) pins, so every line number is a line at that commit, and `node scripts/architecture.mjs` rewrites the page each time it re-pins the map. Code merged since the pin can shift a range by a few lines: `node scripts/region-index.mjs --now` prints these tables for your checkout. `test/region-index.test.mjs` fails when this page differs from what the script renders at the pin.

## Grid behaviours

A name with no file is in `public/app.js`, and "in" names the function a declaration sits inside.

| Behaviour | Lines |
| --- | --- |
| A table route opens and the chrome paints | `showDatabase` 4876-4897, `tableChrome` 5762-5834, `paintTableChrome` 5879-5887, `tableChromeOn` 5757-5761 |
| Rows are read and the grid is drawn | `readAndDrawTable` 4913-4955, `drawDatabase` 5889-6000, `renderTable` 6417-7889 (1,473 lines, 8 regions below) |
| A board layout takes the same route | `public/board-core.js` 1-113, `public/board-view.js` 1-341, `readAndDrawBoard` 6036-6061 |
| Which columns are drawn | `visibleCols` 6410-6414, `gridFields` 4963-4972, `fieldVisibilityPopover` 6218-6390, `dropDrawnColumn` 6392-6401 |
| Only the rows near the viewport are in the DOM | `public/grid-window.js` 1-57, `rewindow` 7338-7349 in `renderTable`, `paint` 7304-7337 in `renderTable`, `renderTable` 6417-7889 (1,473 lines, 8 regions below) |
| The next page is fetched as the reader scrolls | `gridPager` 4992-5038, `WeaveGridWindow.feedFor` public/grid-window.js 27-33 |
| The loading state | `gridHold` 10933-10938, `paintGridWait` 10944-10959, `showGridLoader` 10976-10990, `hideGridLoader` 10991-10995, `resetGridWait` 10996-11002 |
| A cell rests, opens and commits | `activateCell` 2508-2528, `openCellPicker` 2499-2506, `editorFor` 4068-4403 (336 lines, 2 regions below) |
| A commit writes and the grid catches up | `renderTable` 6417-7889 (1,473 lines, 8 regions below), `patchRows` 7386-7409 in `renderTable` |
| A new row is added and takes focus | `newRowTray` 11209-11303, `focusNewRow` 2589-2611, `focusGridRow` 10708-10712 |
| Focus and scroll survive a redraw | `rememberGridFocus` 2058-2067, `restoreGridFocus` 2069-2083, `keepScroll` 8498-8517 |
| The keyboard moves the cursor | `public/grid-keymap.js` 1-106, `gridMoves` 4957-4961 |
| A range is selected, copied and filled | `public/grid-range.js` 1-192, `public/selection-core.js` 1-62, `repaintRange` 6446-6446 in `renderTable`, `paintSelection` 6457-6476 in `renderTable` |
| Column widths and the resize handle | `public/column-resize.js` 1-157 |
| Frozen leading columns | `WeaveColumnResize.frozenFit` public/column-resize.js 69-77, `canFreeze` public/column-resize.js 78-79 |
| The grid decides whether it fits its pane | `refit` 6431-6442 in `renderTable`, `renderTable` 6417-7889 (1,473 lines, 8 regions below), `fitGridScroller` 2532-2538 |
| Sideways scroll state | no declaration to place: `scroll` |
| A clipped cell says so, and spills on hover | `markClippedCells` 2873-2901, `fitChips` 2778-2799, `showCellPop` 2643-2698, `hideCellPop` 2705-2707, `gridRightEdge` 2636-2642 |
| Row height | `gridDensity` 2906-2910, `saveGridDensity` 2911-2918, `checkRowPitch` 2802-2811 |
| Sort, filter, group and search | `public/list-core.js` 1-190, `gridSort` 4987-4990, `filterWhere` 4710-4712, `tableGroup` 4905-4909, `setTableSearch` 4826-4833 |
| The view pane that configures all four | `renderViewPane` 5662-5731, `paneFilters` 5600-5620, `paneWrite` 5366-5377 |
| Footer totals | `rollupCells` 5488-5490, `footStatLists` 5527-5552, `footRollupWrite` 5553-5578 |
| A row becomes a card on a phone | `public/phone-row.js` 1-101, `phoneRowOf` 2815-2820, `phoneLeadEl` 2821-2832, `fitPhoneChipLines` 2841-2872 |
| The phone action bar | `installPhoneBar` 11140-11153, `syncPhoneBar` 11304-11315 |
| Which fields the card shows | `phoneRowPopover` 5260-5333 |
| A related table on a record page | `relatedGrid` 10162-10286, `subtableOf` 10288-10296, `subtableChips` 10299-10307, `subtablePopover` 10309-10343 |

## public/app.js

| Lines | Declares |
| --- | --- |
| 1-196 | `$`, `el`, `svgEl`, `chevron`, `disclosure`, `setDisclosure`, `summaryChevron`, `WS_PREFIX`, `weaveFileBase`, `LOCAL_ZONE`, `commitActiveEdit`, `leaving`, `loadedSchemaVersion`, `lastSchemaVersion`, `schemaLoading`, `schemaFetch`, `noteSchemaVersion`, `UPLOAD_STALL_MS`, `UPLOAD_ANSWER_MS`, `uploadStates`, `uploadSeq`, `fileTooBig`, `uploadState`, `uploadHostsFor`, `sendUpload`, `landedFile`, `withErrorId`, `uploadWaits`, `paintUploadTile`, `uploadTileEl`, `drawUploads`, `paintUploads`, `uploadHost`, `refreshUploads` |
| 197-384 | `runUploads`, `runJobs`, `fileBase64`, `warmGets`, `WARM_MS`, `warmGet`, `rowRevisions`, `noteRevisions`, `api`, `usage`, `systemKindOf`, `templateIds`, `noteUsage`, `startUsage`, `copyText`, `TOAST_MS`, `TOAST_LIMIT`, `TOAST_ICON`, `toastsUp` |
| 385-551 | `toastLayer`, `seatToast`, `toast`, `dropToast`, `dropToastNode`, `toastTick`, `toastClock`, `MODAL_LIVE`, `MODAL_STOPS`, `reachableStop`, `holds`, `releasePage`, `holdPage`, `submitsInFlight`, `holdSubmit`, `freeSubmit` |
| 552-745 | `modal`, `tray`, `state`, `heldRows`, `HELD_ROWS_CAP`, `holdRow`, `openEntity`, `nativeClick`, `externalLinksOpenInTabs`, `NATIVE_CLICK_KEEPS`, `openNativeClick`, `headCheck`, `markStuckHeads`, `atSideEnd`, `nameFieldOf`, `computedName`, `termOfTable`, `dock`, `dockRead`, `dockOwns`, `compare`, `markDockedRow` |
| 746-930 | `releaseDockPanel`, `poseGlyph`, `crumbNav`, `navArrows`, `dockExpand`, `closeToTable`, `collapseToSplit`, `dockClose`, `anchorTable`, `dockEntity`, `syncDockChain`, `tableHop`, `dockCoversScreen`, `saves`, `weaveSaves`, `queuedWrites`, `dockHoldsSaveMark`, `saveMark`, `saveMarkFor`, `touchOnly`, `SHORTCUT_CLAUSE`, `keyHint`, `dockSyncUrl`, `dockDismiss`, `dockGo` |
| 931-1130 | `drawDock`, `DOCK_PANE`, `SIDE_PANE`, `pinPane`, `applyPaneWidth`, `fitPanes`, `fitPanesFrame`, `fitPanesSoon`, `paneWatch`, `wirePaneGutter`, `sideWanted`, `sideSyncUrl`, `DOCK_ESC_OWNERS`, `allTables`, `registryWorkflows`, `loadSchema`, `inlineNameInput`, `navTableMenu`, `iconRuns`, `playIcon` |
| 1131-1327 | `lucideEl`, `canHover`, `iconEl`, `iconCatalogue`, `iconButton`, `publishViewHeaderHeight`, `keyboardInset`, `publishKeyboardInset`, `publishHeaderOn`, `stickViewHeader`, `CRUMB_ICON_FALLBACK`, `crumbIconEl`, `navIconEl`, `crumbInner`, `crumbPath`, `fitCrumbs`, `CRUMB_MORE_PX`, `crumbFoldMenu`, `crumbOfHref`, `wsMarkEl`, `wsMarkIds`, `fillWsMark` |
| 1328-1497 | `refreshWsMarks`, `titleEdit`, `descriptionId`, `foldDescription`, `descToggle`, `viewHeader`, `wsHomeHref`, `navDrag`, `FOLDED_SPACES_KEY` |
| 1498-1697 | `renderNav`, `SYSTEM_FOLD_KEY`, `TRIAL_NOTICE_DAYS`, `ACCOUNT_ROLE_LABELS`, `accountSlot`, `accountDisplayName`, `accountWorkspaceName`, `healthNow`, `accountNow`, `refreshAccountChip` |
| 1698-1890 | `ACCOUNT_ROLE_HUES`, `accountChip`, `closeAccountMenu`, `personalMenuButton`, `personalMenu`, `postLogout`, `signOutOf`, `signOutEverywhere`, `fieldValueCell`, `isIconRef`, `stateLabel`, `stateNodes`, `chipLabel`, `stateCategory`, `stateChipClass`, `deckRoleOf`, `mermaidLoading`, `expandDocument`, `fullscreenViewer`, `openWhiteboard` |
| 1891-2085 | `renderMermaidIn`, `whileConnected`, `ghostBtn`, `dismissOutside`, `swallowClick`, `placeNear`, `showPopover`, `relearnRows`, `holdToConfirm`, `holdIcon`, `rememberGridFocus`, `restoreGridFocus` |
| 2086-2279 | `searchPicker`, `PHONE_SHORT_LIST`, `PHONE_ROW_H` |
| 2280-2471 | `anchorPop`, `valuePop`, `pickerSelect`, `chipPicker`, `chipPickerMulti`, `credentialLinkFor`, `credentialReveal`, `INTEGRATION_KEPT`, `integrationKeptCell`, `integrationKeyCell`, `replaceIntegrationKey`, `PICKER_FIELD_TYPES`, `READONLY_FIELD_TYPES`, `isNumCell`, `CREDENTIAL_GLYPHS`, `CREDENTIAL_KIND_LABELS`, `KEYSTORE_LABELS`, `computedMark`, `COMPUTED_NAME_MARKS`, `fieldDescription`, `qualifiedTableName` |
| 2472-2642 | `fieldRoute`, `fieldNameLabel`, `openCellPicker`, `activateCell`, `GRID_BOX_GUTTER`, `GRID_BOX_MIN`, `fitGridScroller`, `smoothScrollOk`, `paneOf`, `scrollBoxOf`, `scrollTargetIntoView`, `newRowTurn`, `stuckHeaderHeight`, `stickyFootHeight`, `focusNewRow`, `cellPopLayer`, `CELL_TYPE_PROPS`, `CLIPPABLE_CONTROLS`, `copyCellType`, `contentRect`, `CELL_POP_DELAY`, `SPILL_TYPES`, `spillsRight`, `gridRightEdge` |
| 2643-2840 | `showCellPop`, `CELL_POP_GAP`, `cellIsEditing`, `hideCellPop`, `spillEditor`, `overflowsX`, `WEAVE_CELLS`, `lastCopiedBlock`, `htmlText`, `weaveCellsHTML`, `readWeaveCells`, `fitChips`, `overflowsY`, `WEAVE_DEV`, `checkRowPitch`, `PHONE_MORE_W`, `phoneRowCore`, `phoneRowOf`, `phoneLeadEl`, `foldValueCounters` |
| 2841-3040 | `fitPhoneChipLines`, `markClippedCells`, `DENSITY_LABELS`, `densityKey`, `hasView`, `gridDensity`, `saveGridDensity`, `adoptLegacyDensity`, `registryTable`, `introControlsHidden`, `showIntroControls`, `renderMarkdownInto`, `appendRegistryPresentation`, `registryHref`, `mineOnly`, `rowClickTarget`, `menuSide`, `menuBounds` |
| 3041-3234 | `MENU_SHEET`, `openMenu`, `menuRow`, `menu`, `dotsMenu`, `KIND_LABELS`, `unthunk`, `kindHead`, `menuFor`, `kindDots`, `OWN_CONTEXT`, `kindContext`, `renameNavTable`, `duplicateEntity`, `setLinkPreview`, `TRASHED`, `reopenAfterUndo` |
| 3235-3429 | `trashRow`, `OPEN_TRASH`, `MENU_ROWS`, `hasInlineMarkup`, `INLINE_TAG`, `inlineIconAccept`, `dressTokens` |
| 3430-3615 | `swapToEdit`, `dressedText`, `dressedUrl`, `viewCore`, `viewFieldOf`, `cellGraphics`, `numberCore`, `scaleText`, `figureCanvas`, `figureWidth`, `numberGraphic`, `numberGraphicFor`, `ratingEl`, `ratingListEl`, `sparkEl`, `chipView`, `chipElFrom`, `viewSegmentEl`, `viewChipEl`, `viewCardEl`, `viewCell`, `avatarUpload` |
| 3616-3808 | `avatarPicker`, `avatarControl`, `entityAvatarEl`, `relationChipEl`, `externalRefChipEl`, `chipOpensRecord`, `toggleMentionCaret`, `stateOptions`, `statePicker`, `editChipSegment`, `toggleSwitch`, `HTML_FRAME_SANDBOX`, `FILE_FRAME_SANDBOX`, `fileUrl`, `previewUrl`, `streamUpload`, `fileKind`, `isPictureFile`, `fileIconName`, `fileSizeText`, `isViewableFile`, `fileViewUrl`, `plainClick`, `MISSING_TAIL`, `fitAttachName`, `attachItemEl` |
| 3809-3991 | `attachSheetEl`, `fileBodyEl`, `fileFrameOf`, `fittedHeights`, `FIT_PENDING_MS`, `fitFrame`, `reserveFit`, `PAGE_STORAGE_SAVE_MS`, `fileViewerEl`, `placeCoverIn`, `entityCoverEl`, `fileLightbox`, `filePanel`, `labeledEditorFor` |
| 3992-4067 | `fileDropZone`, `optionCreator`, `optionHue`, `optionIcon`, `optionChipEl`, `READ_ONLY_KEEPS`, `readOnlyValue` |
| 4068-4240 | in `editorFor`: `saved`, `patch` |
| 4241-4404 | in `editorFor` |
| 4405-4602 | `DOC_PREVIEW_LINES`, `docPreviewCell`, `docChipCell`, `BLANK_READ_ONLY`, `blankView`, `pickTableView`, `viewed`, `gridConfigWrite`, `viewHref`, `showsDeleted`, `showsRollups`, `systemDefault`, `nextViewName`, `viewEdit`, `viewStrip`, `filterSeed`, `PREFILL_SKIP`, `prefillBase`, `manyRelation` |
| 4603-4723 | `prefillControl`, `prefillValues`, `openPrefill`, `tableFilters`, `setTableFilters`, `FILTER_KINDS`, `isFilterField`, `FILTER_CHIP_ROLE`, `filterStates`, `filterCounts`, `setFilterTotal`, `filterWhere`, `filterTriples`, `FILTER_DEBOUNCE`, `filterWrites` |
| 4724-4912 | `filterStrip`, `TABLE_SEARCH_DEBOUNCE`, `tableSearch`, `tableSearchTimer`, `tableSearchRelease`, `tableSearchWrites`, `tableSearchLocal`, `saveTableSearch`, `stopTableSearchTimer`, `tableSearchText`, `setTableSearch`, `openTableSearch`, `tableSearchBox`, `showDatabase`, `FIRST_PAGES_KEPT`, `firstPages`, `rememberFirstPage`, `tableGroup`, `serverSums` |
| 4913-5100 | `readAndDrawTable`, `gridMoves`, `gridFields`, `graftChips`, `gridSort`, `gridPager`, `tableControlPopover`, `tableControlButton`, `tableControlHeader` |
| 5101-5259 | `tableViewButton`, `tableDensityButton`, `setFilterCount`, `tableFilterButton`, `tableSortButton`, `RO`, `startRowDrag` |
| 5260-5377 | `phoneRowPopover`, `VP`, `PANE_KEY`, `PANE_SECTION_KEY`, `readPref`, `writePref`, `viewPane`, `PANE_SECTIONS`, `NO_SORT_TYPES`, `sortFieldOptions`, `sortWords`, `paneSwitch`, `paneWrite` |
| 5378-5552 | `levelsBlock`, `listRowPrefs`, `drawnGroupKeys`, `rollupCells`, `keyedSeg`, `displayBlock`, `footStatLists` |
| 5553-5734 | `footRollupWrite`, `paneValue`, `paneChanged`, `paneFilters`, `paneFields`, `paneBody`, `paneEl`, `paneWanted`, `setPaneOpen`, `paneSync`, `renderViewPane`, `closeSharePanel`, `sharePanelOwner` |
| 5735-5888 | `sharePanelButton`, `tableChromeSig`, `tableChromeOn`, `tableChrome`, `tableToolsButton`, `paintTableChrome` |
| 5889-6075 | `drawDatabase`, `listCore`, `boardCore`, `isBoardLayout`, `listSetup`, `listKeys`, `listDomain`, `listTargetRows`, `readAndDrawBoard`, `listWrites`, `shareCollapsed`, `listViewWrite` |
| 6076-6217 | `listLevelValue`, `listPathValues`, `listHeadingEl`, `groupCrumbEl`, `breakdownFields`, `groupSummaryEl`, `drawnPast`, `cappedEls`, `boardCardFields`, `PICTURE_LABELS`, `FIT_OPTIONS`, `boardControls`, `groupFieldOptions`, `tableGroupButton`, `eyeGlyph`, `eyeWrites`, `eyeTails`, `eyeGestures`, `eyeGesture`, `REFERENCE_PANELS`, `showsRefPanel` |
| 6218-6416 | `fieldVisibilityPopover`, `dropDrawnColumn`, `drawnMatches`, `visibleCols`, `GRID_SEQ` |
| 6417-6615 | in `renderTable`: `isSysCol`, `cellBox`, `sysValue`, `sysCell`, `refit`, `SEL`, `repaintRange`, `chosen`, `drawnIds`, `ordered`, `total`, `itemAt`, `itemOf`, `loadedIds`, `paintSelection`, `setChosen`, `clearChosen`, `onBox`, `runOnSelection`, `dropRows`, `trashChosen`, `runBulk`, `relations`, `otherTables`, `nRows`, `picker`, `setField`, `setValue`, `relationPicker`, `linkTo` |
| 6616-6815 | in `renderTable`: `more`, `moreCmds`, `holdAct`, `drawPuck`, `fieldCell`, `buildRow`, `clientSortValue`, `groupSlots`, `rowSlotNear`, `foldGroup`, `buildGroupHead`, `buildSumRow`, `buildSlot`, `GW` |
| 6816-7013 | in `renderTable`: `canFreezeHere`, `storedFrozen`, `storedWidth`, `widestOf`, `emptyDoc`, `widthOf`, `headOf`, `leadCount`, `refreeze`, `layoutCss`, `paintLayout`, `sizePidColumn`, `settle` |
| 7014-7197 | in `renderTable`: `blocked`, `commitWidth`, `flip`, `applyOrder`, `columnDrag` |
| 7198-7385 | in `renderTable`: `headPointerDown`, `headKey`, `listRows`, `rowH`, `spacer`, `setPad`, `reach`, `paintLoadMore`, `rowFor`, `scroller`, `geometry`, `pinFor`, `paint`, `rewindow`, `schedule`, `onScroll`, `scrollToRow`, `ensureRow`, `repaintRow` |
| 7386-7564 | in `renderTable`: `patchRows`, `topEdge`, `topRow`, `setDensity`, `draw`, `KM`, `stops`, `rowsOf`, `openerOf`, `cellAt`, `landOn` |
| 7565-7763 | in `renderTable`: `apply`, `RG`, `rangeCols`, `refOfCell`, `coordOfCell`, `coordOfRef`, `refAtCoord`, `sameCell`, `rangeRect`, `cellOfNode`, `cursorCell`, `rangeOrCursor`, `paintRange`, `setRange`, `clearRange`, `fieldNamed`, `typeOf`, `optionsOf`, `labelOf`, `valueAt`, `relationRows`, `runRange`, `openControl`, `clipboardTarget`, `cellOfEvent`, `onGrid` |
| 7764-7891 | in `renderTable`: `cellUnder`, `endDrag`, `dropCellPop`, `listRow` |
| 7892-8083 | `TAP_SLOP`, `TAP_MS`, `phoneChipAt`, `editPhoneField`, `SYSTEM_COLS`, `stampEl`, `usersCache`, `flushUsers`, `workspaceUsers`, `actorChipEl`, `commentAuthorText`, `workflowRows`, `workflowRow`, `PULSE`, `automationSeen` |
| 8084-8276 | `noteAutomationWrites`, `pulseTargets`, `pulseCells`, `colField`, `MIN_COLUMN_WIDTH`, `cellFitProbe`, `fitColumnWidth`, `clearSelection`, `columnResizeGrip`, `FIELD_MENU_ICONS`, `lookupTargetOf`, `sortLabelsFor` |
| 8277-8468 | `fieldMenuButton`, `measureCtx`, `textWidth`, `dateControl`, `dateStoreFns`, `rangeControl`, `calendarGlyph`, `segCtl`, `lazyScripts`, `workflowCells`, `lazyScript`, `warmDatePicker`, `withDatePicker`, `openForms`, `openInvite`, `settingsView`, `openTrash`, `openSettings`, `openDeleteWorkspace`, `boardView`, `openFieldDialog` |
| 8469-8643 | `fieldConfigToast`, `rolledBackText`, `SCROLL_PANES`, `keepScroll`, `editFieldDialog`, `reorderBlocks`, `reorderField`, `addFieldMenuButton`, `FOOT_LABELS`, `FOOT_NUMERIC`, `footAggregatesFor`, `spaceRollupName`, `RATING_SCALE_FOOT`, `spaceRollupEntry`, `renderFooter`, `fillFooter` |
| 8644-8829 | `footerPicker`, `spaceStatTiles`, `showSpace`, `appendSpaceDetails`, `systemSpaceNote`, `useTemplateButton`, `useTemplateDialog` |
| 8830-9027 | `spaceTablesCard`, `relationMap`, `relationMapCard`, `liveEditors`, `pendingDocSaves`, `docPulls`, `vditorTheme`, `vditorLoading`, `loadVditor`, `docBubbles`, `REF_CHIP_DEBOUNCE`, `refChipLayers`, `docCodeAuto`, `docCodeRaw`, `resizeFrame`, `DASH_READING_LINE`, `docRails`, `attachDashRail`, `headText`, `sectionTexts`, `refreshDashRail`, `docFolds`, `DOC_DECOR`, `docFoldState`, `attachHeadingFolds` |
| 9028-9214 | `refreshHeadingFolds`, `__weaveEditors`, `__weaveDocSaves`, `__weaveFlushDocSaves`, `retheme`, `docBases`, `docSha256`, `docBaseOf`, `noteDocBase`, `sendDoc`, `docConflict`, `scheduleDocSave`, `flushDocSave`, `whenEl`, `flushDocSaves`, `leaveDocs`, `teardownDocEditors`, `dropDecor`, `docSectionCollapse`, `appearsAsPanel` |
| 9215-9283 | `showEntity`, `nextStateButton`, `nextStateFor`, `pageGo`, `entityHop`, `entityRefs` |
| 9284-9398 | in `renderEntityView`: `repaint`, `holds`, `holdsDoc`, `asNode`, `streamed`, `frame`, `saved`, `recordCtx`, `drawFab`, `openSide` |
| 9399-9585 | in `renderEntityView`: `docSection`, `relationCount`, `coverEl`, `placeCover`, `anchor`, `restingGrip`, `handle` |
| 9586-9775 | in `renderEntityView`: `wireBlock`, `dragRow`, `named` |
| 9776-9888 | in `renderEntityView`: `drawFiles`, `refCard`, `drawRefs` |
| 9889-10044 | `activityPanel`, `quickCreate`, `newUserDialog`, `tableTray`, `runStarter`, `emptyWorkspace`, `onboardingAsked`, `maybeOnboard` |
| 10045-10161 | `onboard`, `SCHEMA_OPEN_KEY`, `schemaDisclosure`, `fieldTray`, `addFieldDialog` |
| 10162-10351 | `relatedGrid`, `subtableOf`, `chipTriple`, `subtableChips`, `subtableWrites`, `subtablePopover`, `ACTIVITY_PAGE`, `openActivityLog` |
| 10352-10546 | `showView`, `homeReads`, `bootHomeReads`, `workspaceSystemCard`, `savedPagesCard`, `showHome`, `ROLE_LABELS`, `currentWsName`, `RECENT_KEY`, `RECENT_KEEP`, `readRecents`, `noteRecent`, `noteEntityRecent`, `marked`, `wireSearchButton`, `openPalette`, `relationTargets`, `linkSearch` |
| 10547-10742 | `gestures`, `GESTURE_CAP`, `UNDO_WINDOW`, `CLAIM_CAP`, `UNDO_REFUSED`, `keptLine`, `undoToast`, `undoKey`, `pendingClaims`, `looseIds`, `ENTITY_UNDO`, `BULK_UNDO`, `undoEntriesOf`, `newGesture`, `noteWrite`, `pinClaims`, `claimOwn`, `undoQueue`, `undoOwn`, `stepBackOwn`, `unlinkWithUndo`, `undoGesture`, `refreshView`, `focusGridRow`, `KEY_SHEET_ANYWHERE`, `KEY_SHEET_TABLE` |
| 10743-10938 | `openKeySheet`, `LOADER_CYCLE_MS`, `LOADER_SHOW_AFTER_MS`, `LOADER_POSE_FROM`, `LOADER_POSE_TO`, `LOADER_EXIT_RATE`, `LOADER_HOLD_MS`, `LOADER_FADE_MS`, `SKELETON_SHOW_AFTER_MS`, `LOADER_CAPTION_AFTER_MS`, `LOADER_RETRY_AFTER_MS`, `LOADER_CAPTION_TEXT`, `LOADER_RETRY_LABEL`, `loading`, `initPageLoader`, `showPageLoader`, `paintLoaderWait`, `paintLoaderRetry`, `clearLoaderWait`, `hidePageLoader`, `stillLoader`, `ropeAnimations`, `settleLoader`, `keepLoader`, `withPageLoader`, `gridWait`, `gridHold` |
| 10939-11133 | `markGridWait`, `paintGridWait`, `gridLoaderNode`, `placeGridLoader`, `showGridLoader`, `hideGridLoader`, `resetGridWait`, `paintSkeleton`, `skeleton`, `scheduleSkeleton`, `cancelSkeleton`, `syncDocTitle`, `renderRoute`, `rememberRoute`, `navDraw`, `navOwns`, `dispatchRoute`, `paintRouteError` |
| 11134-11324 | `renderRouteSafely`, `installPhoneBar`, `NEW_ROW_CHOICES`, `NEW_ROW_OPTIONS`, `rowNoun`, `sheetGrip`, `newRowTray`, `syncPhoneBar`, `ensureNavMenu`, `route` |
| 11325-11523 | `redock`, `buildWsRail`, `servesBareRoot`, `bareRootWs`, `wsHref`, `wsApiPrefix`, `wsApi`, `wsLogoButton`, `uploadWorkspaceLogo`, `removeWorkspaceLogo`, `wireWsNew`, `narrowShell`, `navPeekDwell`, `closeNavPeek`, `setNavCollapsed` |
| 11524-11722 | `wireNavCollapse`, `NAV_WIDTH`, `wireNavResize`, `NAV_KEY_OWNERS`, `wireNavHold`, `labelNavMenu`, `navMenuButton` |
| 11723-11859 | `wireSkipLink`, `THEME_ICONS`, `THEME_LABELS`, `THEME_MEDIA`, `themePref`, `applyTheme`, `cycleTheme`, `wireTheme`, `syncSchema`, `bugGlyph`, `bugRecorder`, `bugDraft`, `installBugReporter`, `bugTrigger`, `closeBugPanel` |
| 11860-11989 | `openBugPanel` |

## src/engine.js

| Lines | Declares |
| --- | --- |
| 1-182 | `iconValue`, `Term`, `ListCore`, `ViewPane`, `BoardCore`, `LAYOUTS`, `PhoneRow`, `SYSTEM_TERMS`, `CSV_FORMULA_START`, `unquoteCSVCell`, `parseCSV`, `VALUES_BLOCK`, `FILES_BLOCK`, `REFERENCE_PANELS`, `isFixedBlock`, `BLOB_ID`, `isBodyBlock`, `VALUE_TYPES`, `isFileField`, `AVATAR_SHAPES`, `AVATAR_IMAGE_TYPES`, `SEARCHED_VALUE_TYPES`, `REGISTRY_HITS`, `LOCKED_NAME`, `UPGRADE_FLOOR`, `refuseBeforeFloor`, `RESERVED_NAMES`, `own`, `PASTED_ENTITY`, `pastedEntityId`, `byPosition`, `checkPosition`, `SYSTEM_SPACE_NAME`, `SYSTEM_SPACE_ICON`, `LEGACY_SYSTEM_SPACE_NAME`, `answersLegacySystem`, `refuseReserved`, `sniffImage`, `fileBlobIds`, `PREVIEW_MAX_BYTES`, `FILE_MAX_BYTES`, `mbText`, `PREVIEW_TYPES`, `logoType`, `LOCAL_RANGES`, `localAddress`, `webhookRefusal`, `INLINE_FILE_TYPES`, `HTML_VIEW_POLICY`, `HTML_PAGE_POLICY`, `sandboxedHtmlHeaders`, `HTML_FILE_TYPES`, `FILE_STORAGE_CAP`, `isHtmlFile`, `FRAME_HEIGHT_SCRIPT`, `FRAME_LINK_BASE`, `frameLinkBase`, `scriptJson` |
| 183-374 | `frameStorageScript`, `LEADING_DOCTYPE`, `viewHtml`, `fileHeaders`, `ATTACHMENT_PREVIEWS`, `ATTACHMENT_SIZES`, `ATTACHMENT_FITS`, `ATTACHMENT_LOOK_KEYS`, `isBoolType`, `COMPUTED_TYPES`, `DERIVED_CACHE_CAP`, `STATE_CATEGORIES`, `DEFAULT_WORKFLOW_STATES`, `SYSTEM_SORT_KEYS`, `TEXT_OPS`, `VIEW_SHAPES`, `QUERY_SHAPES`, `leanRow`, `DESCRIPTION_SIZES`, `DESCRIPTION_CHARS`, `ACTIVITY_CAP`, `ACTIVITY_PAGE`, `ACCOUNT_ACTOR`, `accountActor`, `REMOVED_ACCOUNT`, `FIELD_CONFIG_ACTIONS`, `SCHEMA_AUDIT_ACTIONS`, `UNTAGGED_SCHEMA_ACTIONS`, `ONTOLOGY_TYPES`, `ONTOLOGY_LEGEND`, `ontologyEtag`, `fieldDefinition`, `canonicalJSON`, `definitionChanges`, `VIEW_AUTO_SEGMENTS`, `VIEW_DEFAULTS`, `VIEW_NAMES`, `VIEW_EXCLUDED_TYPES`, `plainLines`, `GRID_SYSTEM_COLUMNS`, `RETIRED_SYSTEM_FIELD`, `withoutRetired`, `sysColumnId`, `sysColumnName`, `viewEntryName`, `placeField`, `showBySchema`, `clip`, `DYNAMIC_DATE_DEFAULTS`, `DOCUMENT_KINDS`, `CREDENTIAL_KINDS`, `KEYSTORES`, `DEFAULT_PAIR_PARTS`, `NUMBER_COSTUME_KEYS`, `ROLLUP_COSTUME_KEYS`, `NUMBER_DISPLAYS`, `isGraphicDisplay`, `CELL_COLORS`, `cellColorValue`, `SPARKLINE_STYLES`, `lastNumber`, `RATING_MAX`, `RATING_DEFAULTS`, `RATING_SCALE_AGGS`, `ratingValue`, `DATE_COSTUME_KEYS`, `FORMULA_COSTUME_KEYS`, `DG`, `DEFAULTABLE_TYPES`, `FIELD_TYPES`, `DOC_REVISION_WINDOW_MS`, `docFingerprint` |
| 375-540 | `docChange`, `RETIRED_STATE_CATEGORIES`, `WORKFLOW_STATES`, `workflowActor`, `actorWorkflow`, `HOME_RUNS`, `HOME_RUN_ROWS`, `templated`, `scheduleOut`, `listenerOut`, `HOOK_PARTS`, `compileHook`, `hookOut`, `triggerOut`, `LISTENER_ACTIONS`, `HOOK_RECORD_ACTIONS`, `workflowScript`, `WORKFLOW_PANEL`, `whenWords`, `actionWords`, `urlHost`, `HTTP_STEP_BODY_MAX`, `itemRow`, `hookPathOf`, `OUTBOUND`, `CREDENTIAL_HEADERS`, `blankTemplates`, `fillJson`, `stepBody`, `thenWords`, `UPSERT_KEY_TYPES`, `blankSource`, `sourcePath`, `HUE_HEX`, `HUES`, `hueName`, `hueOf`, `normaliseOption`, `AGGREGATES`, `MAX_COMPUTE_DEPTH`, `CYCLE_PREFIX`, `isCycle`, `CycleSignal`, `FORMULA_SCAN_CAP`, `RECIPE_KEYS`, `DEFINABLE_TYPES`, `MAX_DEFINITION_DEPTH`, `TYPE_MIGRATIONS` |
| 541-700 | `ONTOLOGY`, `dressNumber`, `dressDate`, `pickCostume`, `putCostume`, `rollupCostume`, `formulaCostume`, `dressDateRange` |
| 701-860 | `numberConfig`, `dateConfig`, `optionName`, `credentialConfig`, `costumeFromDescriptor`, `recipeFromDescriptor`, `numberDescriptor`, `asBoolean`, `asString`, `dateType`, `optionType`, `CREDENTIAL_CONFIG_KEYS` |
| 861-1029 | in `FIELD_TYPE_CONFIG`: `text`, `number`, `formula`, `lookup`, `rollup`, `rating`, `date`, `daterange`, `checkbox`, `toggle`, `url`, `email`, `select`, `multiselect`, `workflow`, `field` |
| 1030-1151 | in `FIELD_TYPE_CONFIG`: `key`, `attachments`, `avatar`, `document`, `view` |
| 1152-1270 | `normalizeSelfContainedConfig`, `normalizeDefinition`, `formatFilters`, `parseFilters`, `formatSort`, `SORT_FORM`, `parseSortPart`, `parseSort`, `MIN_COLUMN_WIDTH`, `VIEW_MIN_WIDTH`, `VIEW_MAX_WIDTH`, `VIEW_DENSITIES`, `formatWidths`, `parseWidths`, `fieldDescriptionValue`, `CREATE_INPUT_KEYS`, `BULK_OPS`, `nowISO`, `schemaFingerprint`, `tableReaders` |
| 1271-1382 | `templateDoc`, `HELD`, `deferMigrations`, `runDeferredMigrations`, `detachHubRegistry` |
| 1383-1573 | `detachedRegistryState`, `inviteUrl`, `USER_COLUMNS`, `USER_KEPT`, `USER_PRIVATE`, `hidesChange`, `capital` |
| 1574-1770 | in `Weave`: `#dirty`, `#dirtyAll`, `#held`, `#detachedStorage`, `#schemaVersion`, `#rows`, `#query`, `#cutoffs`, `#computing`, `constructor`, `#migrate`, `#settlePositions`, `#place`, `#spacesInOrder`, `#tablesOfSpace`, `#reconcileFieldOrder`, `#ensureDescriptionField`, `#repairDoubledInverses`, `#ensureViewFields` |
| 1771-1968 | in `Weave`: `#ensureSystemColumnsInViews`, `#dropRetiredSystemField`, `#ensureStandardViewName`, `#ensureTableViews`, `viewField`, `#normalizeViewConfig`, `#viewSegmentFields`, `#faceOf`, `renderView`, `#viewLine`, `termOf`, `#inverseName`, `#setTerm` |
| 1969-2165 | in `Weave`: `descriptionField`, `save`, `#touching`, `touching`, `affectedBy`, `#mark`, `settleDeferred`, `maybeRefresh`, `schemaVersion`, `spaceMembers`, `setSpaceMember`, `removeSpaceMember`, `#nameHolders`, `#assertNameFree`, `createSpace`, `listSpaces`, `findSpace`, `getSpace` |
| 2166-2365 | in `Weave`: `updateSpace`, `deleteSpace`, `restoreSpace`, `createTable`, `listTables`, `userTables`, `qualifiedName`, `findTable`, `getTable`, `updateTable` |
| 2366-2557 | in `Weave`: `moveTable`, `duplicateTable`, `deleteTable`, `restoreTable` |
| 2558-2742 | in `Weave`: `relationMapMmd`, `createView`, `listViews`, `getView`, `deleteView`, `restoreView`, `resolveView`, `shareView`, `unshareView`, `viewByShareToken`, `mintShare`, `listShares`, `revokeShare`, `renewShare`, `updateShare`, `regenerateShare`, `shareByToken` |
| 2743-2885 | in `Weave`: `tableView`, `#viewTarget`, `#viewIndex`, `#noView`, `#blankFields`, `#viewOut`, `#phoneRowNamed`, `#writePhoneRow`, `#listField`, `#sameGrouping`, `#checkGroup`, `#orderRow` |
| 2886-2957 | in `Weave`: `#writeListKeys`, `#checkViewName` |
| 2958-3152 | in `Weave`: `#writeView`, `#sortOutOfGroup`, `#writeDefaultView`, `#checkFilters`, `viewQuery` |
| 3153-3216 | in `Weave`: `#viewQueryIn`, `#checkSort`, `#defaultViewConfig`, `applySchema`, `#atomically` |
| 3217-3415 | in `Weave` › `#applySchemaPass`: `act`, `configFromDescriptor`, `colorsOf`, `fieldChanged`, `docTable`, `cardinalityOf`, `relationArgs` |
| 3416-3488 | in `Weave` › `#applySchemaPass` |
| 3489-3556 | in `Weave`: `listTemplates`, `useTemplate`, `build`, `#buildCopy` |
| 3557-3746 | in `Weave` › `#buildRun`: `fail`, `step`, `extra`, `isObj`, `cosmetic`, `listAt`, `result`, `target`, `phase`, `relationOf`, `resolves`, `visit` |
| 3747-3793 | in `Weave` › `#buildRun` |
| 3794-3984 | in `Weave`: `#buildOrder`, `#applyTableCostume`, `#bodyOrderFrom`, `#legacyEdits`, `#applyViews`, `workspaceOrder`, `moveWorkspace`, `getWorkspace`, `updateWorkspace`, `#keyStore` |
| 3985-4182 | in `Weave`: `migrateKeys`, `credentialConfig`, `setKey`, `deleteKey`, `hasKey`, `listKeys`, `resolveKey`, `#localKeys`, `#keyInWorkspace`, `#mayReveal`, `revealKey`, `ownsKey`, `#callerAccount`, `#isKeyHolder`, `#mayGrant`, `#grantRefusal`, `grantKey`, `revokeKey`, `#renameKeyHolder`, `credentialLink`, `ROLES`, `ROLE_LABELS`, `OLD_ROLES`, `roleName`, `#audit` |
| 4183-4378 | in `Weave`: `#spacesTouching`, `auditWorkspace`, `listAudit`, `createAccount`, `#createAccount`, `verifyToken`, `listAccounts`, `noteTokenWrite`, `actorName`, `isActor`, `#accountById`, `#actorFor`, `#namedShared`, `#namedDetail`, `#namedActivity`, `#lockedNames`, `deleteAccount`, `onboardedAt`, `markOnboarded`, `agentSeen`, `noteAgent`, `setRequireAuth` |
| 4379-4575 | in `Weave`: `billing`, `startTrial`, `markTrialMail`, `linkBillingOrg`, `SESSION_TTL_MS`, `LAST_SEEN_MS`, `#account`, `#hash`, `createSession`, `verifySession`, `#lastSeenStale`, `removedSession`, `listSessions`, `revokeSession`, `INVITE_TTL_MS`, `#issuer`, `linkIdentity`, `#mintInvite`, `#invite`, `inviteMember`, `listInvites`, `revokeInvite`, `#inviteName` |
| 4576-4758 | in `Weave`: `renameAccount`, `setAccountRole`, `#memberName`, `identityInvite`, `invitesForEmail`, `acceptInvite`, `redeemIdentityInvite`, `#redeem`, `unlinkIdentity`, `accountForIdentity`, `#scrubIdentityEmails`, `#inMetaSync`, `#oneTime`, `inviteIssuer`, `localKeyAccess`, `registryHost`, `members`, `#reg`, `#engines`, `#engineOf`, `#wsIdOfRow`, `#ownerOf`, `#tableAnywhere`, `#fieldAnywhere` |
| 4759-4944 | in `Weave`: `#retireDetachedOrphans`, `detachHubRegistry` |
| 4945-5103 | in `Weave`: `joinRegistry`, `hostRegistry`, `dropWorkspace`, `#syncAll`, `#userRows`, `#syncUsers`, `#userTarget`, `#userValues` |
| 5104-5300 | in `Weave`: `#createUserRow`, `#updateUserRow`, `#setInviteRole`, `#deleteUserRow`, `takeOneTime`, `#syncWorkspaceRow`, `syncRegistry`, `#metaSync`, `#inUndo`, `#undoOwner`, `#recordUndo`, `#undoBefore`, `#undoAfter`, `#lastWriter`, `#undoChanged`, `#undoExpected` |
| 5301-5409 | in `Weave`: `undo`, `listUndo`, `#sysTable`, `#sysRow`, `#relIds`, `#sysField` |
| 5410-5564 | in `Weave`: `#ensureMetaTables` |
| 5565-5763 | in `Weave`: `registryReport`, `rebuildRegistry`, `#syncSpaceRow`, `#syncTableRow`, `#syncViewRows`, `#viewAnywhere` |
| 5764-5962 | in `Weave`: `#syncFieldRow`, `#dropFieldRow`, `#fieldOwner`, `#dropSysRow`, `#trashSysRow`, `#restoreSysRow`, `#integrationNamed`, `#integrationProvider`, `#integrationInput`, `#updateIntegrationRow`, `#onReg`, `#stampIntegration`, `#integrationRow`, `#integrationTarget`, `#integrationEntry`, `#sealIntegrationKey`, `#dropIntegrationKey`, `#checkIntegration` |
| 5963-6112 | in `Weave`: `integrationFetch`, `setIntegrationCredential`, `#interceptCreate` |
| 6113-6292 | in `Weave`: `#interceptUpdate`, `#viewRowPatch`, `#interceptDelete`, `findField`, `getField`, `materializeField` |
| 6293-6483 | in `Weave`: `addField`, `addRelation`, `bodyBlocks`, `#recipe`, `#refuseSpaceRepoint`, `#repoint`, `#formulasBroken` |
| 6484-6582 | in `Weave`: `#formulaHealth`, `#formulaRenames`, `#wherePaths`, `#fieldSettings`, `#fieldReaders`, `updateField`, `fieldChangeSince` |
| 6583-6774 | in `Weave`: `#updateField`, `#subtableConfig`, `#dropOlderSnapshots`, `#publicDetail`, `#fieldLogQuiet`, `#withoutFieldLog`, `#fieldConfigRows`, `#fieldConfigRow` |
| 6775-6964 | in `Weave`: `#rollbackCheck`, `rollbackFieldConfig`, `#formulaCycle`, `#refuseFormulaCycle`, `checkFormula`, `#migrateFieldType` |
| 6965-7163 | in `Weave`: `#textToRelation`, `#relationToText`, `deleteField`, `restoreField`, `#trashedField`, `#trashedFieldAnywhere`, `#purgeTrashedField` |
| 7164-7357 | in `Weave`: `#fieldTrashEntry`, `#fieldSnapshot`, `#reinstateField`, `#targetFieldReaders`, `#removeFieldRaw`, `documentFields`, `#resolveDocField`, `listEntities`, `#rowIndex`, `#derived`, `#forgetDerived`, `#derivedKey`, `#remember`, `#sortKeys` |
| 7358-7557 | in `Weave`: `#indexRow`, `#unindexRow`, `#tableRows`, `#rowsByPublicId`, `#liveRowCounts`, `listTrash`, `#present`, `#liveEntity`, `#lockedEntity`, `#hiddenSpaces`, `#hiddenKey`, `#tableHidden`, `#rowHidden`, `#sysRowHidden`, `#framed`, `#mayChange`, `#readOnlyFor`, `#guarded`, `#belowArchitect`, `#withheld`, `#mayWriteRow`, `#mayWriteTable`, `#mayShape`, `canSee` |
| 7558-7757 | in `Weave`: `hidesAnySpace`, `asAccount`, `permalink`, `getEntity`, `findEntity`, `entityName`, `createEntity`, `#claimPublicId`, `#insertEntity`, `updateEntity`, `#checkValues` |
| 7758-7956 | in `Weave`: `#applyValues`, `#holdRows`, `#restoreRows`, `#writeValues`, `#validateDefault`, `now`, `#resolveDefault`, `#coerceDate`, `#validateValue` |
| 7957-8152 | in `Weave`: `#findOption`, `relationTargetDbIds`, `#normalizeRelationInput`, `#setRelationValue`, `#logInverse`, `#relationIds`, `#pluck`, `link`, `unlink`, `setState`, `#setStateInternal`, `deleteEntity` |
| 8153-8316 | in `Weave`: `bulk`, `#bulkRows`, `#portable`, `#moveEntity`, `restoreEntity`, `resolveField`, `#resolve`, `#rawName` |
| 8317-8503 | in `Weave`: `#resolveValue`, `#displayValue`, `#lookupRelation`, `#rollupRows` |
| 8504-8689 | in `Weave`: `#rollupTarget`, `#checkWhere`, `tableRollups`, `tableStats`, `entityRevision`, `conditionalWrite` |
| 8690-8888 | in `Weave`: `#updateAtRevision`, `#batched`, `#adoptRolledBack`, `#inViewerZone`, `readEntity`, `#readEntityIn`, `#numberDisplay`, `#scaleOf`, `#ratingOf`, `#summary`, `#inWorkspace`, `#workflowWsId`, `workflowWorkspace` |
| 8889-9069 | in `Weave`: `query`, `#inQuery`, `#queryIn`, `#groupFieldShape`, `#groupTargets`, `#viewGroups`, `#rollupsOver`, `#matchNode` |
| 9070-9266 | in `Weave`: `#matchCondition`, `#definitionRank`, `#looseEq`, `#pathValue`, `getDoc`, `#docText`, `setDoc`, `docBase`, `#setDocAtBase`, `appendDoc`, `#writeDoc`, `#docRevisionFresh`, `#restoring`, `#recordDocRevision`, `listDocRevisions`, `getDocRevision`, `#docRevision`, `restoreDocRevision` |
| 9267-9405 | in `Weave`: `addComment`, `deleteComment`, `activityFeed`, `#activityFeed`, `getActivity`, `spaceHome`, `workspaceHome`, `#homeTables` |
| 9406-9538 | in `Weave`: `#homeRuns`, `#nextSeq`, `#logActivity`, `#stamping`, `#wfQueue`, `#wfEpoch`, `#wfRows`, `#wfRules`, `#noWebhooks`, `#trialHosted`, `webhookTimeoutMs`, `deliveryAttempts`, `createAutomation`, `#asReg` |
| 9539-9733 | in `Weave`: `#compileSpec`, `#compileListener`, `#compileUpsert`, `#compileHttpRequest`, `#checkFits` |
| 9734-9926 | in `Weave`: `#renderSpec`, `#workflowRows`, `#workflowHome`, `#wfField`, `#workflowRule`, `#allRules`, `#settleWorkflows`, `#stampDirty`, `#stamp`, `#setOption`, `#settleWorkflow`, `#stampRun` |
| 9927-10110 | in `Weave`: `#stampPoll`, `#guardWorkflowOn`, `#ruleOut`, `#myRules`, `listAutomations`, `describeAutomations`, `#myRow`, `updateAutomation`, `deleteAutomation`, `#migrating`, `#migrateAutomations`, `#runAccess`, `#runRow`, `#saveRun` |
| 10111-10300 | in `Weave`: `startRun`, `updateRun`, `listRuns`, `#mailingRuns`, `runMaintenance`, `#runAutomations`, `#runAutomationsIn`, `#fireRule`, `#pendingRuns`, `automationsSettled`, `#liveRow` |
| 10301-10462 | in `Weave`: `#stepRun`, `#awaitStep`, `#finishRun`, `#inFlight`, `claimInbound`, `isEcho`, `#hookOf`, `#hookWords`, `#hookSecret`, `#hookRule`, `hookDeliveries`, `revealHookSecret`, `#hookRecord`, `receiveHook` |
| 10463-10662 | in `Weave`: `#receiveHook`, `#rememberEcho`, `pendingDeliveries`, `#dropDelivery`, `#deliveryFailed`, `#runSnapshot`, `#deadLetter`, `#letterLanded`, `replayDelivery`, `#updateDeliveryRow` |
| 10663-10844 | in `Weave`: `#reviveRun`, `runDeliveries`, `#scheduleSince`, `runSchedules`, `#polling`, `#pollState`, `#pollBudget`, `#runListeners`, `#poll`, `#pollWords`, `#pollLanded` |
| 10845-11029 | in `Weave`: `#runAction`, `#httpRequest`, `#send`, `#httpLand`, `#upsertSource`, `#upsertRow`, `#signedHeaders` |
| 11030-11229 | in `Weave`: `#template`, `search`, `#searchHits`, `universalSearch`, `#scopedSearch`, `capRows`, `previewFields`, `#stateLabel`, `referencesTo`, `referencesFrom`, `storageStats` |
| 11230-11422 | in `Weave`: `#blobPath`, `#hasBlob`, `#readBlob`, `#dropBlob`, `#stagePath`, `#blobHead`, `filesOnDisk`, `stageBlob`, `streamBlob`, `dropStagedBlob`, `#adoptBlob`, `#writeBlob`, `attachFile`, `attachToField`, `readFileMeta`, `readFile`, `#fileMeta`, `readFileStorage`, `writeFileStorage`, `setWorkspaceLogo` |
| 11423-11612 | in `Weave`: `getWorkspaceLogo`, `deleteWorkspaceLogo`, `deleteFile`, `importCSV`, `#importRows`, `spaceVersions`, `ontology`, `#schemaHistory`, `#ontologyLabel`, `#ontologyFields`, `#ontologyComputed` |
| 11613-11794 | in `Weave`: `#ontologyConcept`, `describeSchema`, `exportJSON`, `#landBlobs`, `#keepSecrets` |
| 11795-11853 | in `Weave`: `importJSON`, `#fileLedger`, `exportCSV` |
