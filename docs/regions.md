# Region index

`public/app.js` (12,190 lines) and `src/engine.js` (12,035 lines) are too long to read whole. This page cuts each one into regions of at most 200 lines along its declarations and names what every region declares, so a change opens the right 200 lines first. The first table places each behaviour of the [grid map](grid.md) by line.

`node scripts/region-index.mjs` generates this page at commit [`8b67a6e`](https://github.com/grunion-ai/weave/tree/8b67a6ee8199523eb5e51b6f0a077e45928cdb52), the commit the [architecture map](architecture/README.md) pins, so every line number is a line at that commit, and `node scripts/architecture.mjs` rewrites the page each time it re-pins the map. Code merged since the pin can shift a range by a few lines: `node scripts/region-index.mjs --now` prints these tables for your checkout. `test/region-index.test.mjs` fails when this page differs from what the script renders at the pin.

## Grid behaviours

A name with no file is in `public/app.js`, and "in" names the function a declaration sits inside.

| Behaviour | Lines |
| --- | --- |
| A table route opens and the chrome paints | `showDatabase` 4996-5017, `tableChrome` 5894-5966, `paintTableChrome` 6031-6040, `tableChromeOn` 5889-5893 |
| Rows are read and the grid is drawn | `readAndDrawTable` 5033-5075, `drawDatabase` 6045-6157, `renderTable` 6590-8070 (1,481 lines, 8 regions below) |
| The grid a redraw replaces is torn down | `teardownGrid` 6042-6044, `destroy` 8067-8067 in `renderTable`, `renderTable` 6590-8070 (1,481 lines, 8 regions below) |
| A board layout takes the same route | `public/board-core.js` 1-113, `public/board-view.js` 1-345, `readAndDrawBoard` 6193-6218 |
| Which columns are drawn | `visibleCols` 6583-6587, `gridFields` 5094-5103, `fieldVisibilityPopover` 6378-6563, `dropDrawnColumn` 6565-6574 |
| Only the rows near the viewport are in the DOM | `public/grid-window.js` 1-57, `rewindow` 7512-7523 in `renderTable`, `paint` 7478-7511 in `renderTable`, `renderTable` 6590-8070 (1,481 lines, 8 regions below) |
| The next page is fetched as the reader scrolls | `gridPager` 5123-5169, `WeaveGridWindow.feedFor` public/grid-window.js 27-33 |
| The loading state | `gridHold` 11123-11128, `paintGridWait` 11134-11149, `showGridLoader` 11166-11180, `hideGridLoader` 11181-11185, `resetGridWait` 11186-11192 |
| A cell rests, opens and commits | `activateCell` 2597-2617, `openCellPicker` 2588-2595, `editorFor` 4188-4523 (336 lines, 2 regions below) |
| A commit writes and the grid catches up | `renderTable` 6590-8070 (1,481 lines, 8 regions below), `patchRows` 7560-7587 in `renderTable`, `refreshView` 10891-10896, `undoPatch` 10866-10871, `bulkPatch` 5079-5083 |
| A write in the docked pane reaches the row behind it | `surfaceBehind` 9524-9524 in `renderEntityView`, `tellSurface` 9525-9525 in `renderEntityView`, `docSaved` 9526-9530 in `renderEntityView` |
| A new row is added and takes focus | `newRowTray` 11399-11493, `focusNewRow` 2678-2700, `focusGridRow` 10898-10902 |
| Focus and scroll survive a redraw | `rememberGridFocus` 2147-2156, `restoreGridFocus` 2158-2172, `keepScroll` 8682-8701 |
| The keyboard moves the cursor | `public/grid-keymap.js` 1-106, `gridMoves` 5085-5092 |
| A range is selected, copied and filled | `public/grid-range.js` 1-192, `public/selection-core.js` 1-62, `repaintRange` 6620-6620 in `renderTable`, `paintSelection` 6631-6650 in `renderTable` |
| Column widths and the resize handle | `public/column-resize.js` 1-157 |
| Frozen leading columns | `WeaveColumnResize.frozenFit` public/column-resize.js 69-77, `canFreeze` public/column-resize.js 78-79 |
| The grid decides whether it fits its pane | `refit` 6604-6615 in `renderTable`, `renderTable` 6590-8070 (1,481 lines, 8 regions below), `fitGridScroller` 2621-2627 |
| Sideways scroll state | no declaration to place: `scroll` |
| A clipped cell says so, and spills on hover | `markClippedCells` 2962-2990, `fitChips` 2867-2888, `showCellPop` 2732-2787, `hideCellPop` 2794-2796, `gridRightEdge` 2725-2731 |
| Row height | `gridDensity` 2995-2999, `saveGridDensity` 3000-3007, `checkRowPitch` 2891-2900 |
| Sort, filter, group and search | `public/list-core.js` 1-190, `gridSort` 5118-5121, `filterWhere` 4830-4832, `tableGroup` 5025-5029, `setTableSearch` 4946-4953 |
| The view pane that configures all four | `renderViewPane` 5794-5863, `paneFilters` 5732-5752, `paneWrite` 5498-5509 |
| Footer totals | `rollupCells` 5620-5622, `footStatLists` 5659-5684, `footRollupWrite` 5685-5710 |
| A row becomes a card on a phone | `public/phone-row.js` 1-101, `phoneRowOf` 2904-2909, `phoneLeadEl` 2910-2921, `fitPhoneChipLines` 2930-2961 |
| The phone action bar | `installPhoneBar` 11330-11343, `syncPhoneBar` 11494-11505 |
| Which fields the card shows | `phoneRowPopover` 5392-5465 |
| A related table on a record page | `relatedGrid` 10337-10461, `subtableOf` 10463-10471, `subtableChips` 10474-10482, `subtablePopover` 10484-10518 |

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
| 1584-1783 | `renderNav`, `SYSTEM_FOLD_KEY`, `TRIAL_NOTICE_DAYS`, `ACCOUNT_ROLE_LABELS`, `accountSlot`, `accountDisplayName`, `accountWorkspaceName`, `healthNow`, `accountNow`, `refreshAccountChip` |
| 1784-1979 | `ACCOUNT_ROLE_HUES`, `accountChip`, `closeAccountMenu`, `personalMenuButton`, `personalMenu`, `postLogout`, `signOutOf`, `signOutEverywhere`, `fieldValueCell`, `isIconRef`, `stateLabel`, `stateNodes`, `chipLabel`, `stateCategory`, `stateChipClass`, `deckRoleOf`, `mermaidLoading`, `expandDocument`, `fullscreenViewer`, `openWhiteboard` |
| 1980-2174 | `renderMermaidIn`, `whileConnected`, `ghostBtn`, `dismissOutside`, `swallowClick`, `placeNear`, `showPopover`, `relearnRows`, `holdToConfirm`, `holdIcon`, `rememberGridFocus`, `restoreGridFocus` |
| 2175-2368 | `searchPicker`, `PHONE_SHORT_LIST`, `PHONE_ROW_H` |
| 2369-2560 | `anchorPop`, `valuePop`, `pickerSelect`, `chipPicker`, `chipPickerMulti`, `credentialLinkFor`, `credentialReveal`, `INTEGRATION_KEPT`, `integrationKeptCell`, `integrationKeyCell`, `replaceIntegrationKey`, `PICKER_FIELD_TYPES`, `READONLY_FIELD_TYPES`, `isNumCell`, `CREDENTIAL_GLYPHS`, `CREDENTIAL_KIND_LABELS`, `KEYSTORE_LABELS`, `computedMark`, `COMPUTED_NAME_MARKS`, `fieldDescription`, `qualifiedTableName` |
| 2561-2731 | `fieldRoute`, `fieldNameLabel`, `openCellPicker`, `activateCell`, `GRID_BOX_GUTTER`, `GRID_BOX_MIN`, `fitGridScroller`, `smoothScrollOk`, `paneOf`, `scrollBoxOf`, `scrollTargetIntoView`, `newRowTurn`, `stuckHeaderHeight`, `stickyFootHeight`, `focusNewRow`, `cellPopLayer`, `CELL_TYPE_PROPS`, `CLIPPABLE_CONTROLS`, `copyCellType`, `contentRect`, `CELL_POP_DELAY`, `SPILL_TYPES`, `spillsRight`, `gridRightEdge` |
| 2732-2929 | `showCellPop`, `CELL_POP_GAP`, `cellIsEditing`, `hideCellPop`, `spillEditor`, `overflowsX`, `WEAVE_CELLS`, `lastCopiedBlock`, `htmlText`, `weaveCellsHTML`, `readWeaveCells`, `fitChips`, `overflowsY`, `WEAVE_DEV`, `checkRowPitch`, `PHONE_MORE_W`, `phoneRowCore`, `phoneRowOf`, `phoneLeadEl`, `foldValueCounters` |
| 2930-3129 | `fitPhoneChipLines`, `markClippedCells`, `DENSITY_LABELS`, `densityKey`, `hasView`, `gridDensity`, `saveGridDensity`, `adoptLegacyDensity`, `registryTable`, `introControlsHidden`, `showIntroControls`, `renderMarkdownInto`, `appendRegistryPresentation`, `registryHref`, `mineOnly`, `rowClickTarget`, `menuSide`, `menuBounds` |
| 3130-3325 | `openMenu`, `menuRow`, `menu`, `dotsMenu`, `KIND_LABELS`, `unthunk`, `kindHead`, `menuFor`, `kindDots`, `OWN_CONTEXT`, `kindContext`, `renameNavTable`, `duplicateEntity`, `setLinkPreview`, `TRASHED`, `reopenAfterUndo` |
| 3326-3522 | `trashRow`, `OPEN_TRASH`, `MENU_ROWS`, `hasInlineMarkup`, `INLINE_TAG`, `inlineIconAccept`, `dressTokens` |
| 3523-3708 | `swapToEdit`, `dressedText`, `dressedUrl`, `viewCore`, `viewFieldOf`, `cellGraphics`, `numberCore`, `scaleText`, `figureCanvas`, `figureWidth`, `numberGraphic`, `numberGraphicFor`, `ratingEl`, `ratingListEl`, `sparkEl`, `chipView`, `chipElFrom`, `viewSegmentEl`, `viewChipEl`, `viewCardEl`, `viewCell`, `avatarUpload` |
| 3709-3902 | `avatarPicker`, `avatarControl`, `entityAvatarEl`, `relationChipEl`, `externalRefChipEl`, `chipOpensRecord`, `toggleMentionCaret`, `stateOptions`, `statePicker`, `editChipSegment`, `toggleSwitch`, `HTML_FRAME_SANDBOX`, `FILE_FRAME_SANDBOX`, `fileUrl`, `previewUrl`, `streamUpload`, `fileKind`, `isPictureFile`, `fileIconName`, `fileSizeText`, `isViewableFile`, `fileViewUrl`, `plainClick`, `MISSING_TAIL`, `fitAttachName`, `attachItemEl` |
| 3903-4089 | `attachSheetEl`, `fileBodyEl`, `fileFrameOf`, `fittedHeights`, `FIT_PENDING_MS`, `fitFrame`, `reserveFit`, `PAGE_STORAGE_SAVE_MS`, `fileViewerEl`, `placeCoverIn`, `entityCoverEl`, `fileLightbox`, `filePanel`, `labeledEditorFor` |
| 4090-4187 | `fileDropZone`, `optionCreator`, `optionHue`, `optionIcon`, `optionChipEl`, `READ_ONLY_KEEPS`, `readOnlyValue`, `staleToast`, `saveValues` |
| 4188-4359 | in `editorFor`: `saved`, `patch` |
| 4360-4524 | in `editorFor` |
| 4525-4722 | `DOC_PREVIEW_LINES`, `docPreviewCell`, `docChipCell`, `BLANK_READ_ONLY`, `blankView`, `pickTableView`, `viewed`, `gridConfigWrite`, `viewHref`, `showsDeleted`, `showsRollups`, `systemDefault`, `nextViewName`, `viewEdit`, `viewStrip`, `filterSeed`, `PREFILL_SKIP`, `prefillBase`, `manyRelation` |
| 4723-4843 | `prefillControl`, `prefillValues`, `openPrefill`, `tableFilters`, `setTableFilters`, `FILTER_KINDS`, `isFilterField`, `FILTER_CHIP_ROLE`, `filterStates`, `filterCounts`, `setFilterTotal`, `filterWhere`, `filterTriples`, `FILTER_DEBOUNCE`, `filterWrites` |
| 4844-5032 | `filterStrip`, `TABLE_SEARCH_DEBOUNCE`, `tableSearch`, `tableSearchTimer`, `tableSearchRelease`, `tableSearchWrites`, `tableSearchLocal`, `saveTableSearch`, `stopTableSearchTimer`, `tableSearchText`, `setTableSearch`, `openTableSearch`, `tableSearchBox`, `showDatabase`, `FIRST_PAGES_KEPT`, `firstPages`, `rememberFirstPage`, `tableGroup`, `serverSums` |
| 5033-5232 | `readAndDrawTable`, `BULK_KEEPS_ROWS`, `bulkPatch`, `gridMoves`, `gridFields`, `graftChips`, `gridSort`, `gridPager`, `classSelector`, `tableControlPopover`, `tableControlButton`, `tableControlHeader` |
| 5233-5391 | `tableViewButton`, `tableDensityButton`, `setFilterCount`, `tableFilterButton`, `tableSortButton`, `RO`, `startRowDrag` |
| 5392-5509 | `phoneRowPopover`, `VP`, `PANE_KEY`, `PANE_SECTION_KEY`, `readPref`, `writePref`, `viewPane`, `PANE_SECTIONS`, `NO_SORT_TYPES`, `sortFieldOptions`, `sortWords`, `paneSwitch`, `paneWrite` |
| 5510-5684 | `levelsBlock`, `listRowPrefs`, `drawnGroupKeys`, `rollupCells`, `keyedSeg`, `displayBlock`, `footStatLists` |
| 5685-5866 | `footRollupWrite`, `paneValue`, `paneChanged`, `paneFilters`, `paneFields`, `paneBody`, `paneEl`, `paneWanted`, `setPaneOpen`, `paneSync`, `renderViewPane`, `closeSharePanel`, `sharePanelOwner` |
| 5867-6044 | `sharePanelButton`, `tableChromeSig`, `tableChromeOn`, `tableChrome`, `tableToolsButton`, `newRecordButton`, `paintTableChrome`, `teardownGrid` |
| 6045-6232 | `drawDatabase`, `listCore`, `boardCore`, `isBoardLayout`, `listSetup`, `listKeys`, `listDomain`, `listTargetRows`, `readAndDrawBoard`, `listWrites`, `shareCollapsed`, `listViewWrite` |
| 6233-6377 | `listLevelValue`, `listPathValues`, `listHeadingEl`, `groupCrumbEl`, `breakdownFields`, `groupSummaryEl`, `drawnPast`, `cappedEls`, `boardCardFields`, `PICTURE_LABELS`, `FIT_OPTIONS`, `boardControls`, `groupFieldOptions`, `tableGroupButton`, `eyeGlyph`, `eyeWrites`, `eyeTails`, `eyeGestures`, `eyeGesture`, `REFERENCE_PANELS`, `showsRefPanel` |
| 6378-6574 | `fieldVisibilityPopover`, `dropDrawnColumn` |
| 6575-6589 | `drawnMatches`, `visibleCols`, `GRID_SEQ` |
| 6590-6789 | in `renderTable`: `isSysCol`, `cellBox`, `sysValue`, `sysCell`, `refit`, `SEL`, `repaintRange`, `chosen`, `drawnIds`, `ordered`, `total`, `itemAt`, `itemOf`, `loadedIds`, `paintSelection`, `setChosen`, `clearChosen`, `onBox`, `runOnSelection`, `dropRows`, `trashChosen`, `runBulk`, `relations`, `otherTables`, `nRows`, `picker`, `setField`, `setValue`, `relationPicker`, `linkTo` |
| 6790-6989 | in `renderTable`: `more`, `moreCmds`, `holdAct`, `drawPuck`, `fieldCell`, `buildRow`, `clientSortValue`, `groupSlots`, `rowSlotNear`, `foldGroup`, `buildGroupHead`, `buildSumRow`, `buildSlot`, `GW` |
| 6990-7187 | in `renderTable`: `canFreezeHere`, `storedFrozen`, `storedWidth`, `widestOf`, `emptyDoc`, `widthOf`, `headOf`, `leadCount`, `refreeze`, `layoutCss`, `paintLayout`, `sizePidColumn`, `settle` |
| 7188-7371 | in `renderTable`: `blocked`, `commitWidth`, `flip`, `applyOrder`, `columnDrag` |
| 7372-7559 | in `renderTable`: `headPointerDown`, `headKey`, `listRows`, `rowH`, `spacer`, `setPad`, `reach`, `paintLoadMore`, `rowFor`, `scroller`, `geometry`, `pinFor`, `paint`, `rewindow`, `schedule`, `onScroll`, `scrollToRow`, `ensureRow`, `repaintRow` |
| 7560-7742 | in `renderTable`: `patchRows`, `topEdge`, `topRow`, `setDensity`, `draw`, `KM`, `stops`, `rowsOf`, `openerOf`, `cellAt`, `landOn` |
| 7743-7941 | in `renderTable`: `apply`, `RG`, `rangeCols`, `refOfCell`, `coordOfCell`, `coordOfRef`, `refAtCoord`, `sameCell`, `rangeRect`, `cellOfNode`, `cursorCell`, `rangeOrCursor`, `paintRange`, `setRange`, `clearRange`, `fieldNamed`, `typeOf`, `optionsOf`, `labelOf`, `valueAt`, `relationRows`, `runRange`, `openControl`, `clipboardTarget`, `cellOfEvent`, `onGrid` |
| 7942-8072 | in `renderTable`: `cellUnder`, `endDrag`, `dropCellPop`, `listRow`, `destroy` |
| 8073-8264 | `TAP_SLOP`, `TAP_MS`, `phoneChipAt`, `editPhoneField`, `SYSTEM_COLS`, `stampEl`, `usersCache`, `flushUsers`, `workspaceUsers`, `actorChipEl`, `commentAuthorText`, `workflowRows`, `workflowRow`, `PULSE`, `automationSeen` |
| 8265-8457 | `noteAutomationWrites`, `pulseTargets`, `pulseCells`, `colField`, `MIN_COLUMN_WIDTH`, `cellFitProbe`, `fitColumnWidth`, `clearSelection`, `columnResizeGrip`, `FIELD_MENU_ICONS`, `lookupTargetOf`, `sortLabelsFor` |
| 8458-8652 | `fieldMenuButton`, `measureCtx`, `textWidth`, `dateControl`, `dateStoreFns`, `rangeControl`, `calendarGlyph`, `segCtl`, `lazyScripts`, `workflowCells`, `lazyScript`, `warmDatePicker`, `withDatePicker`, `openForms`, `openInvite`, `settingsView`, `openTrash`, `openSettings`, `openDeleteWorkspace`, `boardView`, `openFieldDialog` |
| 8653-8833 | `fieldConfigToast`, `rolledBackText`, `SCROLL_PANES`, `keepScroll`, `editFieldDialog`, `reorderBlocks`, `reorderField`, `addFieldMenuButton`, `FOOT_LABELS`, `FOOT_NUMERIC`, `footPickerLabel`, `footAggregatesFor`, `spaceRollupName`, `RATING_SCALE_FOOT`, `spaceRollupEntry`, `renderFooter`, `fillFooter` |
| 8834-9023 | `footerPicker`, `spaceStatTiles`, `showSpace`, `appendSpaceDetails`, `systemSpaceNote`, `useTemplateButton`, `useTemplateDialog` |
| 9024-9220 | `spaceTablesCard`, `relationMap`, `relationMapCard`, `liveEditors`, `pendingDocSaves`, `docPulls`, `vditorTheme`, `vditorLoading`, `loadVditor`, `docBubbles`, `REF_CHIP_DEBOUNCE`, `refChipLayers`, `docCodeAuto`, `docCodeRaw`, `scrollRest`, `scrollMoved`, `resizeFrame`, `DASH_READING_LINE`, `docRails`, `attachDashRail`, `headText`, `sectionTexts`, `refreshDashRail`, `docFolds`, `DOC_DECOR`, `docFoldState` |
| 9221-9411 | `attachHeadingFolds`, `refreshHeadingFolds`, `__weaveEditors`, `__weaveDocSaves`, `__weaveFlushDocSaves`, `retheme`, `docBases`, `docBaseOf`, `noteDocBase`, `sendDoc`, `docConflict`, `scheduleDocSave`, `flushDocSave`, `whenEl`, `flushDocSaves`, `leaveDocs`, `teardownDocEditors`, `dropDecor`, `docSectionCollapse`, `foldCaret`, `appearsAsPanel` |
| 9412-9481 | `showEntity`, `nextStateButton`, `nextStateFor`, `pageGo`, `entityHop`, `entityRefs` |
| 9482-9632 | in `renderEntityView`: `repaint`, `holds`, `holdsDoc`, `asNode`, `streamed`, `surfaceBehind`, `tellSurface`, `docSaved`, `frame`, `saved`, `recordCtx`, `openEye`, `drawFab`, `shownRefPanels`, `openSide` |
| 9633-9824 | in `renderEntityView`: `docSection`, `relationCount`, `coverEl`, `placeCover`, `anchor`, `restingGrip`, `handle`, `wireBlock` |
| 9825-10020 | in `renderEntityView`: `dragRow`, `named`, `drawFiles` |
| 10021-10063 | in `renderEntityView`: `refCard`, `drawRefs` |
| 10064-10219 | `activityPanel`, `quickCreate`, `newUserDialog`, `tableTray`, `runStarter`, `emptyWorkspace`, `onboardingAsked`, `maybeOnboard` |
| 10220-10336 | `onboard`, `SCHEMA_OPEN_KEY`, `schemaDisclosure`, `fieldTray`, `addFieldDialog` |
| 10337-10526 | `relatedGrid`, `subtableOf`, `chipTriple`, `subtableChips`, `subtableWrites`, `subtablePopover`, `ACTIVITY_PAGE`, `openActivityLog` |
| 10527-10698 | `showView`, `homeReads`, `bootHomeReads`, `workspaceSystemCard`, `savedPagesCard`, `showHome`, `appendWorkspaceDetails`, `ROLE_LABELS`, `currentWsName`, `RECENT_KEY`, `RECENT_KEEP`, `readRecents`, `noteRecent`, `noteEntityRecent`, `marked`, `wireSearchButton`, `openPalette`, `relationTargets` |
| 10699-10897 | `linkSearch`, `gestures`, `GESTURE_CAP`, `UNDO_WINDOW`, `CLAIM_CAP`, `UNDO_REFUSED`, `keptLine`, `undoToast`, `undoKey`, `pendingClaims`, `looseIds`, `ENTITY_UNDO`, `BULK_UNDO`, `undoEntriesOf`, `newGesture`, `noteWrite`, `pinClaims`, `claimOwn`, `undoQueue`, `undoOwn`, `stepBackOwn`, `unlinkWithUndo`, `undoPatch`, `undoGesture`, `refreshView` |
| 10898-11083 | `focusGridRow`, `KEY_SHEET_ANYWHERE`, `KEY_SHEET_TABLE`, `openKeySheet`, `LOADER_CYCLE_MS`, `LOADER_SHOW_AFTER_MS`, `LOADER_POSE_FROM`, `LOADER_POSE_TO`, `LOADER_EXIT_RATE`, `LOADER_HOLD_MS`, `LOADER_FADE_MS`, `SKELETON_SHOW_AFTER_MS`, `LOADER_CAPTION_AFTER_MS`, `LOADER_RETRY_AFTER_MS`, `LOADER_CAPTION_TEXT`, `LOADER_RETRY_LABEL`, `loading`, `initPageLoader`, `showPageLoader`, `paintLoaderWait`, `paintLoaderRetry`, `clearLoaderWait`, `hidePageLoader`, `stillLoader`, `ropeAnimations`, `settleLoader`, `keepLoader` |
| 11084-11265 | `withPageLoader`, `gridWait`, `gridHold`, `markGridWait`, `paintGridWait`, `gridLoaderNode`, `placeGridLoader`, `showGridLoader`, `hideGridLoader`, `resetGridWait`, `paintSkeleton`, `skeleton`, `scheduleSkeleton`, `cancelSkeleton`, `syncDocTitle`, `renderRoute`, `rememberRoute`, `navDraw`, `navOwns` |
| 11266-11398 | `dispatchRoute`, `paintRouteError`, `renderRouteSafely`, `installPhoneBar`, `NEW_ROW_CHOICES`, `NEW_ROW_OPTIONS`, `rowNoun`, `sheetGrip` |
| 11399-11551 | `newRowTray`, `syncPhoneBar`, `ensureNavMenu`, `route`, `redock` |
| 11552-11719 | `buildWsRail`, `wsSpec`, `servesBareRoot`, `bareRootWs`, `wsHref`, `wsApiPrefix`, `wsApi`, `wsLogoButton`, `uploadWorkspaceLogo`, `removeWorkspaceLogo`, `wireWsNew`, `tightShell`, `navPeekDwell`, `closeNavPeek`, `showNavCollapsed`, `setNavCollapsed` |
| 11720-11909 | `wireNavCollapse`, `NAV_WIDTH`, `wireNavResize`, `NAV_KEY_OWNERS`, `wireNavHold`, `labelNavMenu` |
| 11910-12057 | `navMenuButton`, `wireSkipLink`, `THEME_ICONS`, `THEME_LABELS`, `THEME_MEDIA`, `themePref`, `applyTheme`, `cycleTheme`, `wireTheme`, `syncSchema`, `bugGlyph`, `bugRecorder`, `bugDraft`, `installBugReporter`, `bugTrigger`, `closeBugPanel` |
| 12058-12190 | `openBugPanel` |

## src/engine.js

| Lines | Declares |
| --- | --- |
| 1-197 | `iconValue`, `IconRegistry`, `MarkIcons`, `ChipCore`, `Term`, `ListCore`, `ViewPane`, `BoardCore`, `LAYOUTS`, `PhoneRow`, `SYSTEM_TERMS`, `CSV_FORMULA_START`, `unquoteCSVCell`, `parseCSV`, `VALUES_BLOCK`, `FILES_BLOCK`, `REFERENCE_PANELS`, `isFixedBlock`, `BLOB_ID`, `isBodyBlock`, `VALUE_TYPES`, `isFileField`, `AVATAR_SHAPES`, `AVATAR_IMAGE_TYPES`, `SEARCHED_VALUE_TYPES`, `REGISTRY_HITS`, `LOCKED_NAME`, `UPGRADE_FLOOR`, `refuseBeforeFloor`, `RESERVED_NAMES`, `own`, `PASTED_ENTITY`, `pastedEntityId`, `byPosition`, `checkPosition`, `SYSTEM_SPACE_NAME`, `SYSTEM_SPACE_ICON`, `LEGACY_SYSTEM_SPACE_NAME`, `answersLegacySystem`, `notFound`, `fieldNotFound`, `refuseReserved`, `sniffImage`, `fileBlobIds`, `PREVIEW_MAX_BYTES`, `FILE_MAX_BYTES`, `mbText`, `workspaceFileMaxBytes`, `PREVIEW_TYPES`, `logoType`, `LOCAL_RANGES`, `localAddress`, `webhookRefusal`, `INLINE_FILE_TYPES`, `HTML_VIEW_POLICY`, `HTML_PAGE_POLICY`, `sandboxedHtmlHeaders`, `HTML_FILE_TYPES`, `FILE_STORAGE_CAP`, `isHtmlFile`, `FRAME_HEIGHT_SCRIPT`, `FRAME_LINK_BASE`, `frameLinkBase`, `scriptJson` |
| 198-397 | `frameStorageScript`, `LEADING_DOCTYPE`, `viewHtml`, `fileHeaders`, `ATTACHMENT_PREVIEWS`, `ATTACHMENT_SIZES`, `ATTACHMENT_FITS`, `ATTACHMENT_LOOK_KEYS`, `isBoolType`, `COMPUTED_TYPES`, `DERIVED_CACHE_CAP`, `FieldDialogCore`, `STATE_CATEGORIES`, `DEFAULT_WORKFLOW_STATES`, `SYSTEM_SORT_KEYS`, `TEXT_OPS`, `VIEW_SHAPES`, `QUERY_SHAPES`, `pageNumber`, `describeValue`, `checkWhereNode`, `checkQueryDocs`, `leanRow`, `DESCRIPTION_SIZES`, `DESCRIPTION_CHARS`, `ACTIVITY_CAP`, `ACTIVITY_PAGE`, `ACCOUNT_ACTOR`, `accountActor`, `REMOVED_ACCOUNT`, `FIELD_CONFIG_ACTIONS`, `SCHEMA_AUDIT_ACTIONS`, `UNTAGGED_SCHEMA_ACTIONS`, `ONTOLOGY_TYPES`, `ONTOLOGY_LEGEND`, `ontologyEtag`, `fieldDefinition`, `canonicalJSON`, `definitionChanges`, `VIEW_AUTO_SEGMENTS`, `VIEW_DEFAULTS`, `VIEW_NAMES`, `VIEW_EXCLUDED_TYPES`, `plainLines`, `GRID_SYSTEM_COLUMNS`, `RETIRED_SYSTEM_FIELD`, `withoutRetired`, `sysColumnId`, `sysColumnName`, `viewEntryName`, `placeField`, `showBySchema`, `clip`, `DYNAMIC_DATE_DEFAULTS`, `DOCUMENT_KINDS` |
| 398-593 | `CREDENTIAL_KINDS`, `KEYSTORES`, `DEFAULT_PAIR_PARTS`, `NUMBER_COSTUME_KEYS`, `ROLLUP_COSTUME_KEYS`, `NUMBER_DISPLAYS`, `isGraphicDisplay`, `CELL_COLORS`, `cellColorValue`, `SPARKLINE_STYLES`, `lastNumber`, `RATING_MAX`, `RATING_DEFAULTS`, `RATING_SCALE_AGGS`, `ratingValue`, `DATE_COSTUME_KEYS`, `FORMULA_COSTUME_KEYS`, `DG`, `DEFAULTABLE_TYPES`, `FIELD_TYPES`, `DOC_REVISION_WINDOW_MS`, `docFingerprint`, `docChange`, `RETIRED_STATE_CATEGORIES`, `WORKFLOW_STATES`, `workflowActor`, `actorWorkflow`, `HOME_RUNS`, `HOME_RUN_ROWS`, `templated`, `scheduleOut`, `listenerOut`, `HOOK_PARTS`, `compileHook`, `hookOut`, `triggerOut`, `LISTENER_ACTIONS`, `HOOK_RECORD_ACTIONS`, `ACTION_TEXT_MAX`, `boundedText`, `workflowScript`, `WORKFLOW_PANEL`, `WORKFLOW_STAMPED`, `whenWords`, `actionWords`, `urlHost`, `HTTP_STEP_BODY_MAX`, `itemRow`, `hookPathOf`, `OUTBOUND`, `CREDENTIAL_HEADERS`, `blankTemplates`, `fillJson`, `stepBody`, `thenWords`, `UPSERT_KEY_TYPES`, `blankSource`, `sourcePath`, `HUE_HEX`, `HUES`, `hueName`, `hueOf`, `normaliseOption`, `AGGREGATES`, `MAX_COMPUTE_DEPTH`, `CYCLE_PREFIX`, `isCycle`, `CycleSignal`, `FORMULA_SCAN_CAP`, `RECIPE_KEYS`, `DEFINABLE_TYPES`, `MAX_DEFINITION_DEPTH`, `TYPE_MIGRATIONS` |
| 594-753 | `ONTOLOGY`, `dressNumber`, `dressDate`, `pickCostume`, `putCostume`, `rollupCostume`, `formulaCostume`, `dressDateRange` |
| 754-913 | `numberConfig`, `dateConfig`, `optionName`, `credentialConfig`, `costumeFromDescriptor`, `recipeFromDescriptor`, `numberDescriptor`, `asBoolean`, `asString`, `dateType`, `optionType`, `CREDENTIAL_CONFIG_KEYS` |
| 914-1082 | in `FIELD_TYPE_CONFIG`: `text`, `number`, `formula`, `lookup`, `rollup`, `rating`, `date`, `daterange`, `checkbox`, `toggle`, `url`, `email`, `select`, `multiselect`, `workflow`, `field` |
| 1083-1204 | in `FIELD_TYPE_CONFIG`: `key`, `attachments`, `avatar`, `document`, `view` |
| 1205-1323 | `normalizeSelfContainedConfig`, `normalizeDefinition`, `formatFilters`, `parseFilters`, `formatSort`, `SORT_FORM`, `parseSortPart`, `parseSort`, `MIN_COLUMN_WIDTH`, `VIEW_MIN_WIDTH`, `VIEW_MAX_WIDTH`, `VIEW_DENSITIES`, `formatWidths`, `parseWidths`, `fieldDescriptionValue`, `CREATE_INPUT_KEYS`, `BULK_OPS`, `nowISO`, `schemaFingerprint`, `tableReaders` |
| 1324-1435 | `templateDoc`, `HELD`, `deferMigrations`, `runDeferredMigrations`, `detachHubRegistry` |
| 1436-1626 | `detachedRegistryState`, `inviteUrl`, `USER_COLUMNS`, `USER_KEPT`, `USER_PRIVATE`, `hidesChange`, `capital` |
| 1627-1824 | in `Weave`: `#dirty`, `#dirtyAll`, `#held`, `#detachedStorage`, `#schemaVersion`, `#rows`, `#query`, `#cutoffs`, `#computing`, `constructor`, `#migrate`, `#settlePositions`, `#place`, `#spacesInOrder`, `#tablesOfSpace`, `#reconcileFieldOrder`, `#ensureDescriptionField`, `#repairDoubledInverses`, `#ensureViewFields` |
| 1825-2022 | in `Weave`: `#ensureSystemColumnsInViews`, `#dropRetiredSystemField`, `#ensureStandardViewName`, `#ensureTableViews`, `viewField`, `#normalizeViewConfig`, `#viewSegmentFields`, `#faceOf`, `renderView`, `#viewLine`, `termOf`, `#inverseName`, `#setTerm` |
| 2023-2215 | in `Weave`: `descriptionField`, `save`, `#rolledBack`, `#forgetPending`, `#touching`, `touching`, `affectedBy`, `#mark`, `settleDeferred`, `maybeRefresh`, `schemaVersion`, `spaceMembers`, `setSpaceMember`, `removeSpaceMember`, `#nameHolders`, `#assertNameFree`, `createSpace`, `listSpaces` |
| 2216-2368 | in `Weave`: `findSpace`, `getSpace`, `updateSpace`, `deleteSpace`, `restoreSpace`, `createTable`, `listTables`, `userTables`, `qualifiedName`, `findTable`, `#tableNotFound`, `getTable` |
| 2369-2549 | in `Weave`: `updateTable`, `moveTable`, `duplicateTable` |
| 2550-2747 | in `Weave`: `deleteTable`, `restoreTable`, `relationMapMmd`, `createView`, `listViews`, `getView`, `deleteView`, `restoreView`, `resolveView` |
| 2748-2945 | in `Weave`: `shareView`, `unshareView`, `mintShare`, `listShares`, `revokeShare`, `renewShare`, `updateShare`, `regenerateShare`, `shareByToken`, `tableView`, `#viewTarget`, `#viewIndex`, `#noView`, `#blankFields`, `#viewOut`, `#phoneRowNamed`, `#writePhoneRow`, `#listField`, `#sameGrouping`, `#checkGroup` |
| 2946-3026 | in `Weave`: `#orderRow`, `#writeListKeys`, `#checkViewName` |
| 3027-3216 | in `Weave`: `#writeView`, `#sortOutOfGroup`, `#writeDefaultView`, `#checkFilters` |
| 3217-3280 | in `Weave`: `#viewQueryIn`, `#checkSort`, `#defaultViewConfig`, `applySchema`, `#atomically` |
| 3281-3479 | in `Weave` › `#applySchemaPass`: `act`, `configFromDescriptor`, `colorsOf`, `fieldChanged`, `docTable`, `cardinalityOf`, `relationArgs` |
| 3480-3552 | in `Weave` › `#applySchemaPass` |
| 3553-3623 | in `Weave`: `listTemplates`, `useTemplate`, `build`, `#buildCopy` |
| 3624-3813 | in `Weave` › `#buildRun`: `fail`, `step`, `extra`, `isObj`, `cosmetic`, `listAt`, `result`, `target`, `phase`, `relationOf`, `resolves`, `visit` |
| 3814-3868 | in `Weave` › `#buildRun` |
| 3869-4059 | in `Weave`: `#buildOrder`, `#applyTableCostume`, `#bodyOrderFrom`, `#legacyEdits`, `#applyViews`, `workspaceOrder`, `moveWorkspace`, `getWorkspace`, `updateWorkspace`, `#keyStore` |
| 4060-4257 | in `Weave`: `migrateKeys`, `credentialConfig`, `setKey`, `deleteKey`, `hasKey`, `listKeys`, `resolveKey`, `#localKeys`, `#keyInWorkspace`, `#mayReveal`, `revealKey`, `ownsKey`, `#callerAccount`, `#isKeyHolder`, `#mayGrant`, `#grantRefusal`, `grantKey`, `revokeKey`, `#renameKeyHolder`, `credentialLink`, `ROLES`, `ROLE_LABELS`, `OLD_ROLES`, `roleName`, `#audit` |
| 4258-4453 | in `Weave`: `#spacesTouching`, `auditWorkspace`, `listAudit`, `createAccount`, `#createAccount`, `verifyToken`, `listAccounts`, `noteTokenWrite`, `actorName`, `isActor`, `#accountById`, `#actorFor`, `#namedShared`, `#namedDetail`, `#namedActivity`, `#lockedNames`, `deleteAccount`, `onboardedAt`, `markOnboarded`, `agentSeen`, `noteAgent`, `setRequireAuth` |
| 4454-4650 | in `Weave`: `billing`, `startTrial`, `markTrialMail`, `linkBillingOrg`, `SESSION_TTL_MS`, `LAST_SEEN_MS`, `#account`, `#hash`, `createSession`, `verifySession`, `#lastSeenStale`, `removedSession`, `listSessions`, `revokeSession`, `INVITE_TTL_MS`, `#issuer`, `linkIdentity`, `#mintInvite`, `#invite`, `inviteMember`, `listInvites`, `revokeInvite`, `#inviteName` |
| 4651-4833 | in `Weave`: `renameAccount`, `setAccountRole`, `#memberName`, `identityInvite`, `invitesForEmail`, `acceptInvite`, `redeemIdentityInvite`, `#redeem`, `unlinkIdentity`, `accountForIdentity`, `#scrubIdentityEmails`, `#inMetaSync`, `#oneTime`, `inviteIssuer`, `localKeyAccess`, `registryHost`, `members`, `#reg`, `#engines`, `#engineOf`, `#wsIdOfRow`, `#ownerOf`, `#tableAnywhere`, `#fieldAnywhere` |
| 4834-5019 | in `Weave`: `#retireDetachedOrphans`, `detachHubRegistry` |
| 5020-5206 | in `Weave`: `joinRegistry`, `hostRegistry`, `#syncAll`, `#userRows`, `#syncUsers`, `#userTarget`, `#userValues`, `#createUserRow` |
| 5207-5401 | in `Weave`: `#updateUserRow`, `#setInviteRole`, `#deleteUserRow`, `takeOneTime`, `#syncWorkspaceRow`, `syncRegistry`, `#metaSync`, `#inUndo`, `#undoOwner`, `#undoHeld`, `#recordUndo`, `#undoPending`, `#pushUndo`, `#holdUndo`, `#writersSince`, `#keptSince`, `#undoBefore`, `#undoAfter`, `#lastWriter`, `#undoChanged`, `#undoExpected` |
| 5402-5513 | in `Weave`: `undo`, `listUndo`, `#sysTable`, `#sysRow`, `#relIds`, `#sysField` |
| 5514-5668 | in `Weave`: `#ensureMetaTables` |
| 5669-5867 | in `Weave`: `registryReport`, `rebuildRegistry`, `#syncSpaceRow`, `#syncTableRow`, `#syncViewRows`, `#viewAnywhere` |
| 5868-6066 | in `Weave`: `#syncFieldRow`, `#dropFieldRow`, `#fieldOwner`, `#dropSysRow`, `#trashSysRow`, `#restoreSysRow`, `#integrationNamed`, `#integrationProvider`, `#integrationInput`, `#updateIntegrationRow`, `#onReg`, `#stampIntegration`, `#integrationRow`, `#integrationTarget`, `#integrationEntry`, `#sealIntegrationKey`, `#dropIntegrationKey`, `#checkIntegration` |
| 6067-6216 | in `Weave`: `integrationFetch`, `setIntegrationCredential`, `#interceptCreate` |
| 6217-6396 | in `Weave`: `#interceptUpdate`, `#viewRowPatch`, `#interceptDelete`, `findField`, `getField`, `materializeField` |
| 6397-6587 | in `Weave`: `addField`, `addRelation`, `bodyBlocks`, `#recipe`, `#refuseSpaceRepoint`, `#repoint`, `#formulasBroken` |
| 6588-6740 | in `Weave`: `#formulaHealth`, `#formulaRenames`, `#wherePaths`, `#ruleRenames`, `#applyRuleRenames`, `#fieldSettings`, `#fieldReaders`, `updateField`, `fieldChangeSince` |
| 6741-6935 | in `Weave`: `#updateField`, `#subtableConfig`, `#dropOlderSnapshots`, `#publicDetail`, `#fieldLogQuiet`, `#withoutFieldLog`, `#fieldConfigRows` |
| 6936-7131 | in `Weave`: `#fieldConfigRow`, `#rollbackCheck`, `rollbackFieldConfig`, `#formulaCycle`, `#refuseFormulaCycle`, `checkFormula`, `#migrateFieldType` |
| 7132-7330 | in `Weave`: `#textToRelation`, `#relationToText`, `deleteField`, `restoreField`, `#trashedField`, `#trashedFieldAnywhere`, `#purgeTrashedField` |
| 7331-7524 | in `Weave`: `#fieldTrashEntry`, `#fieldSnapshot`, `#reinstateField`, `#targetFieldReaders`, `#removeFieldRaw`, `documentFields`, `#resolveDocField`, `listEntities`, `#rowIndex`, `#derived`, `#forgetDerived`, `#derivedKey`, `#remember`, `#sortKeys` |
| 7525-7724 | in `Weave`: `#indexRow`, `#unindexRow`, `#tableRows`, `#rowsByPublicId`, `#liveRowCounts`, `listTrash`, `#present`, `#liveEntity`, `#lockedEntity`, `#hiddenSpaces`, `#hiddenKey`, `#tableHidden`, `#rowHidden`, `#sysRowHidden`, `#framed`, `#mayChange`, `#readOnlyFor`, `#guarded`, `#belowArchitect`, `#withheld`, `#mayWriteRow`, `#mayWriteTable`, `#mayShape`, `canSee` |
| 7725-7924 | in `Weave`: `asAccount`, `permalink`, `getEntity`, `findEntity`, `entityName`, `createEntity`, `#claimPublicId`, `#insertEntity`, `updateEntity`, `#checkValues` |
| 7925-8123 | in `Weave`: `#applyValues`, `#holdRows`, `#restoreRows`, `#writeValues`, `#validateDefault`, `now`, `#resolveDefault`, `#coerceDate`, `#validateValue` |
| 8124-8319 | in `Weave`: `#findOption`, `relationTargetDbIds`, `#normalizeRelationInput`, `#setRelationValue`, `#logInverse`, `#relationIds`, `#pluck`, `link`, `unlink`, `setState`, `#setStateInternal`, `deleteEntity` |
| 8320-8484 | in `Weave`: `bulk`, `#bulkRows`, `#portable`, `#moveEntity`, `restoreEntity`, `resolveField`, `#resolve`, `#rawName` |
| 8485-8671 | in `Weave`: `#resolveValue`, `#displayValue`, `#lookupRelation`, `#rollupRows` |
| 8672-8871 | in `Weave`: `#rollupTarget`, `#checkWhere`, `tableRollups`, `tableStats`, `entityRevision`, `conditionalWrite`, `#updateAtRevision`, `#adoptRolledBack`, `#inViewerZone` |
| 8872-9029 | in `Weave`: `readEntity`, `#readEntityIn`, `#numberDisplay`, `#scaleOf`, `#ratingOf`, `#summary`, `#inWorkspace`, `query`, `#inQuery` |
| 9030-9207 | in `Weave`: `#queryIn`, `#groupFieldShape`, `#groupTargets`, `#viewGroups`, `#rollupsOver`, `#matchNode` |
| 9208-9405 | in `Weave`: `#matchCondition`, `#definitionRank`, `#looseEq`, `#storesDate`, `#pathValue`, `getDoc`, `#docText`, `setDoc`, `docBase`, `#setDocAtBase`, `appendDoc`, `#writeDoc`, `#docRevisionFresh`, `#restoring`, `#recordDocRevision`, `listDocRevisions`, `getDocRevision`, `#docRevision`, `restoreDocRevision` |
| 9406-9544 | in `Weave`: `addComment`, `deleteComment`, `activityFeed`, `#activityFeed`, `getActivity`, `spaceHome`, `workspaceHome`, `#homeTables` |
| 9545-9677 | in `Weave`: `#homeRuns`, `#nextSeq`, `#logActivity`, `#stamping`, `#wfQueue`, `#wfEpoch`, `#wfRows`, `#wfRules`, `#noWebhooks`, `#trialHosted`, `webhookTimeoutMs`, `deliveryAttempts`, `createAutomation`, `#asReg` |
| 9678-9872 | in `Weave`: `#compileSpec`, `#compileListener`, `#compileUpsert`, `#compileHttpRequest`, `#checkFits` |
| 9873-10066 | in `Weave`: `#renderSpec`, `#workflowRows`, `#workflowHome`, `#wfField`, `#wfOption`, `#workflowRule`, `#allRules`, `#settleWorkflows`, `#stampDirty`, `#stamp`, `#setOption`, `#settleWorkflow`, `#stampRun` |
| 10067-10264 | in `Weave`: `#stampPoll`, `#guardWorkflowOn`, `#ruleOut`, `#ruleDiffers`, `#myRules`, `listAutomations`, `describeAutomations`, `#myRow`, `updateAutomation`, `deleteAutomation`, `#migrating`, `#migrateAutomations`, `#runAccess`, `#runRow` |
| 10265-10462 | in `Weave`: `#saveRun`, `startRun`, `updateRun`, `listRuns`, `#mailingRuns`, `runMaintenance`, `#runAutomations`, `#runAutomationsIn`, `#fireRule`, `#pendingRuns`, `automationsSettled` |
| 10463-10628 | in `Weave`: `#liveRow`, `#stepRun`, `#awaitStep`, `#finishRun`, `#inFlight`, `claimInbound`, `isEcho`, `#hookOf`, `#hookWords`, `#hookSecret`, `#hookRule`, `hookDeliveries`, `revealHookSecret`, `#hookRecord`, `receiveHook` |
| 10629-10828 | in `Weave`: `#receiveHook`, `#rememberEcho`, `pendingDeliveries`, `#dropDelivery`, `#deliveryFailed`, `#runSnapshot`, `#deadLetter`, `#letterLanded`, `replayDelivery`, `#updateDeliveryRow` |
| 10829-11010 | in `Weave`: `#reviveRun`, `runDeliveries`, `#scheduleSince`, `runSchedules`, `#polling`, `#pollState`, `#pollBudget`, `#runListeners`, `#poll`, `#pollWords`, `#pollLanded` |
| 11011-11195 | in `Weave`: `#runAction`, `#httpRequest`, `#send`, `#httpLand`, `#upsertSource`, `#upsertRow`, `#signedHeaders` |
| 11196-11393 | in `Weave`: `#template`, `search`, `#searchHits`, `universalSearch`, `#scopedSearch`, `capRows`, `previewFields`, `#stateLabel`, `referencesTo`, `referencesFrom`, `#fileBytes` |
| 11394-11590 | in `Weave`: `storageStats`, `#blobPath`, `#hasBlob`, `#readBlob`, `#dropBlob`, `#stagePath`, `#blobHead`, `filesOnDisk`, `stageBlob`, `streamBlob`, `dropStagedBlob`, `#adoptBlob`, `#writeBlob`, `attachFile`, `attachToField`, `readFileMeta`, `readFile`, `#fileMeta`, `readFileStorage`, `writeFileStorage` |
| 11591-11775 | in `Weave`: `setWorkspaceLogo`, `getWorkspaceLogo`, `deleteWorkspaceLogo`, `deleteFile`, `importCSV`, `#importRows`, `spaceVersions`, `ontology`, `#schemaHistory`, `#ontologyLabel`, `#ontologyFields` |
| 11776-11958 | in `Weave`: `#ontologyComputed`, `#ontologyConcept`, `describeSchema`, `exportJSON`, `#landBlobs` |
| 11959-12035 | in `Weave`: `#keepSecrets`, `importJSON`, `#fileLedger`, `exportCSV` |
