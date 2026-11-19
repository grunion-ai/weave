# Region index

`public/app.js` (12,119 lines) and `src/engine.js` (11,985 lines) are too long to read whole. This page cuts each one into regions of at most 200 lines along its declarations and names what every region declares, so a change opens the right 200 lines first. The first table places each behaviour of the [grid map](grid.md) by line.

`node scripts/region-index.mjs` generates this page at commit [`7e47d85`](https://github.com/grunion-ai/weave/tree/7e47d85808de1192d18ec25d5f74b98f72990f1c), the commit the [architecture map](architecture/README.md) pins, so every line number is a line at that commit, and `node scripts/architecture.mjs` rewrites the page each time it re-pins the map. Code merged since the pin can shift a range by a few lines: `node scripts/region-index.mjs --now` prints these tables for your checkout. `test/region-index.test.mjs` fails when this page differs from what the script renders at the pin.

## Grid behaviours

A name with no file is in `public/app.js`, and "in" names the function a declaration sits inside.

| Behaviour | Lines |
| --- | --- |
| A table route opens and the chrome paints | `showDatabase` 4970-4991, `tableChrome` 5868-5940, `paintTableChrome` 5985-5994, `tableChromeOn` 5863-5867 |
| Rows are read and the grid is drawn | `readAndDrawTable` 5007-5049, `drawDatabase` 5999-6111, `renderTable` 6544-8024 (1,481 lines, 8 regions below) |
| The grid a redraw replaces is torn down | `teardownGrid` 5996-5998, `destroy` 8021-8021 in `renderTable`, `renderTable` 6544-8024 (1,481 lines, 8 regions below) |
| A board layout takes the same route | `public/board-core.js` 1-113, `public/board-view.js` 1-345, `readAndDrawBoard` 6147-6172 |
| Which columns are drawn | `visibleCols` 6537-6541, `gridFields` 5068-5077, `fieldVisibilityPopover` 6332-6517, `dropDrawnColumn` 6519-6528 |
| Only the rows near the viewport are in the DOM | `public/grid-window.js` 1-57, `rewindow` 7466-7477 in `renderTable`, `paint` 7432-7465 in `renderTable`, `renderTable` 6544-8024 (1,481 lines, 8 regions below) |
| The next page is fetched as the reader scrolls | `gridPager` 5097-5143, `WeaveGridWindow.feedFor` public/grid-window.js 27-33 |
| The loading state | `gridHold` 11059-11064, `paintGridWait` 11070-11085, `showGridLoader` 11102-11116, `hideGridLoader` 11117-11121, `resetGridWait` 11122-11128 |
| A cell rests, opens and commits | `activateCell` 2571-2591, `openCellPicker` 2562-2569, `editorFor` 4162-4497 (336 lines, 2 regions below) |
| A commit writes and the grid catches up | `renderTable` 6544-8024 (1,481 lines, 8 regions below), `patchRows` 7514-7541 in `renderTable`, `refreshView` 10827-10832, `undoPatch` 10802-10807, `bulkPatch` 5053-5057 |
| A write in the docked pane reaches the row behind it | `surfaceBehind` 9465-9465 in `renderEntityView`, `tellSurface` 9466-9466 in `renderEntityView`, `docSaved` 9467-9471 in `renderEntityView` |
| A new row is added and takes focus | `newRowTray` 11335-11429, `focusNewRow` 2652-2674, `focusGridRow` 10834-10838 |
| Focus and scroll survive a redraw | `rememberGridFocus` 2121-2130, `restoreGridFocus` 2132-2146, `keepScroll` 8633-8652 |
| The keyboard moves the cursor | `public/grid-keymap.js` 1-106, `gridMoves` 5059-5066 |
| A range is selected, copied and filled | `public/grid-range.js` 1-192, `public/selection-core.js` 1-62, `repaintRange` 6574-6574 in `renderTable`, `paintSelection` 6585-6604 in `renderTable` |
| Column widths and the resize handle | `public/column-resize.js` 1-157 |
| Frozen leading columns | `WeaveColumnResize.frozenFit` public/column-resize.js 69-77, `canFreeze` public/column-resize.js 78-79 |
| The grid decides whether it fits its pane | `refit` 6558-6569 in `renderTable`, `renderTable` 6544-8024 (1,481 lines, 8 regions below), `fitGridScroller` 2595-2601 |
| Sideways scroll state | no declaration to place: `scroll` |
| A clipped cell says so, and spills on hover | `markClippedCells` 2936-2964, `fitChips` 2841-2862, `showCellPop` 2706-2761, `hideCellPop` 2768-2770, `gridRightEdge` 2699-2705 |
| Row height | `gridDensity` 2969-2973, `saveGridDensity` 2974-2981, `checkRowPitch` 2865-2874 |
| Sort, filter, group and search | `public/list-core.js` 1-190, `gridSort` 5092-5095, `filterWhere` 4804-4806, `tableGroup` 4999-5003, `setTableSearch` 4920-4927 |
| The view pane that configures all four | `renderViewPane` 5768-5837, `paneFilters` 5706-5726, `paneWrite` 5472-5483 |
| Footer totals | `rollupCells` 5594-5596, `footStatLists` 5633-5658, `footRollupWrite` 5659-5684 |
| A row becomes a card on a phone | `public/phone-row.js` 1-101, `phoneRowOf` 2878-2883, `phoneLeadEl` 2884-2895, `fitPhoneChipLines` 2904-2935 |
| The phone action bar | `installPhoneBar` 11266-11279, `syncPhoneBar` 11430-11441 |
| Which fields the card shows | `phoneRowPopover` 5366-5439 |
| A related table on a record page | `relatedGrid` 10273-10397, `subtableOf` 10399-10407, `subtableChips` 10410-10418, `subtablePopover` 10420-10454 |

## public/app.js

| Lines | Declares |
| --- | --- |
| 1-196 | `$`, `el`, `svgEl`, `chevron`, `disclosure`, `setDisclosure`, `summaryChevron`, `WS_PREFIX`, `weaveFileBase`, `LOCAL_ZONE`, `commitActiveEdit`, `leaving`, `loadedSchemaVersion`, `lastSchemaVersion`, `schemaLoading`, `schemaFetch`, `noteSchemaVersion`, `UPLOAD_STALL_MS`, `UPLOAD_ANSWER_MS`, `uploadStates`, `uploadSeq`, `fileTooBig`, `uploadState`, `uploadHostsFor`, `sendUpload`, `landedFile`, `withErrorId`, `uploadWaits`, `paintUploadTile`, `uploadTileEl`, `drawUploads`, `paintUploads`, `uploadHost`, `refreshUploads` |
| 197-384 | `runUploads`, `runJobs`, `fileBase64`, `warmGets`, `WARM_MS`, `warmGet`, `rowRevisions`, `noteRevisions`, `api`, `usage`, `systemKindOf`, `templateIds`, `noteUsage`, `startUsage`, `copyText`, `TOAST_MS`, `TOAST_LIMIT`, `TOAST_ICON`, `toastsUp` |
| 385-551 | `toastLayer`, `seatToast`, `toast`, `dropToast`, `dropToastNode`, `toastTick`, `toastClock`, `MODAL_LIVE`, `MODAL_STOPS`, `reachableStop`, `holds`, `releasePage`, `holdPage`, `submitsInFlight`, `holdSubmit`, `freeSubmit` |
| 552-745 | `modal`, `tray`, `state`, `heldRows`, `HELD_ROWS_CAP`, `holdRow`, `openEntity`, `nativeClick`, `externalLinksOpenInTabs`, `NATIVE_CLICK_KEEPS`, `openNativeClick`, `headCheck`, `markStuckHeads`, `atSideEnd`, `nameFieldOf`, `computedName`, `termOfTable`, `dock`, `dockRead`, `dockOwns`, `compare`, `markDockedRow` |
| 746-929 | `releaseDockPanel`, `poseGlyph`, `crumbNav`, `navArrows`, `dockExpand`, `closeToTable`, `collapseToSplit`, `dockClose`, `anchorTable`, `dockEntity`, `syncDockChain`, `tableHop`, `dockCoversScreen`, `saves`, `weaveSaves`, `queuedWrites`, `dockHoldsSaveMark`, `saveMarkHome`, `saveMark`, `saveMarkFor`, `touchOnly`, `SHORTCUT_CLAUSE`, `keyHint`, `dockSyncUrl`, `dockDismiss`, `dockGo` |
| 930-1125 | `drawDock`, `DOCK_PANE`, `SIDE_PANE`, `pinPane`, `applyPaneWidth`, `fitPanes`, `fitPanesFrame`, `fitPanesSoon`, `paneWatch`, `wirePaneGutter`, `sideWanted`, `sideSyncUrl`, `DOCK_ESC_OWNERS`, `allTables`, `registryWorkflows`, `loadSchema`, `inlineNameInput`, `navTableMenu`, `iconRuns` |
| 1126-1278 | `playIcon`, `lucideEl`, `canHover`, `iconEl`, `iconCatalogue`, `iconButton`, `publishViewHeaderHeight`, `keyboardInset`, `publishKeyboardInset`, `publishHeaderOn`, `sharedResize`, `watchViewHeader`, `stickViewHeader`, `CRUMB_ICON_FALLBACK`, `crumbIconEl`, `navIconEl`, `crumbInner`, `watchCrumbPath`, `crumbPath` |
| 1279-1437 | `fitCrumbs`, `CRUMB_MORE_PX`, `shedRows`, `dockRow`, `crumbFoldMenu`, `crumbOfHref`, `wsMarkEl`, `wsMarkIds`, `fillWsMark`, `refreshWsMarks`, `titleEdit`, `descriptionId`, `foldDescription`, `descToggle` |
| 1438-1560 | `viewHeader`, `wsHomeHref`, `navDrag`, `FOLDED_SPACES_KEY` |
| 1561-1760 | `renderNav`, `SYSTEM_FOLD_KEY`, `TRIAL_NOTICE_DAYS`, `ACCOUNT_ROLE_LABELS`, `accountSlot`, `accountDisplayName`, `accountWorkspaceName`, `healthNow`, `accountNow`, `refreshAccountChip` |
| 1761-1953 | `ACCOUNT_ROLE_HUES`, `accountChip`, `closeAccountMenu`, `personalMenuButton`, `personalMenu`, `postLogout`, `signOutOf`, `signOutEverywhere`, `fieldValueCell`, `isIconRef`, `stateLabel`, `stateNodes`, `chipLabel`, `stateCategory`, `stateChipClass`, `deckRoleOf`, `mermaidLoading`, `expandDocument`, `fullscreenViewer`, `openWhiteboard` |
| 1954-2148 | `renderMermaidIn`, `whileConnected`, `ghostBtn`, `dismissOutside`, `swallowClick`, `placeNear`, `showPopover`, `relearnRows`, `holdToConfirm`, `holdIcon`, `rememberGridFocus`, `restoreGridFocus` |
| 2149-2342 | `searchPicker`, `PHONE_SHORT_LIST`, `PHONE_ROW_H` |
| 2343-2534 | `anchorPop`, `valuePop`, `pickerSelect`, `chipPicker`, `chipPickerMulti`, `credentialLinkFor`, `credentialReveal`, `INTEGRATION_KEPT`, `integrationKeptCell`, `integrationKeyCell`, `replaceIntegrationKey`, `PICKER_FIELD_TYPES`, `READONLY_FIELD_TYPES`, `isNumCell`, `CREDENTIAL_GLYPHS`, `CREDENTIAL_KIND_LABELS`, `KEYSTORE_LABELS`, `computedMark`, `COMPUTED_NAME_MARKS`, `fieldDescription`, `qualifiedTableName` |
| 2535-2705 | `fieldRoute`, `fieldNameLabel`, `openCellPicker`, `activateCell`, `GRID_BOX_GUTTER`, `GRID_BOX_MIN`, `fitGridScroller`, `smoothScrollOk`, `paneOf`, `scrollBoxOf`, `scrollTargetIntoView`, `newRowTurn`, `stuckHeaderHeight`, `stickyFootHeight`, `focusNewRow`, `cellPopLayer`, `CELL_TYPE_PROPS`, `CLIPPABLE_CONTROLS`, `copyCellType`, `contentRect`, `CELL_POP_DELAY`, `SPILL_TYPES`, `spillsRight`, `gridRightEdge` |
| 2706-2903 | `showCellPop`, `CELL_POP_GAP`, `cellIsEditing`, `hideCellPop`, `spillEditor`, `overflowsX`, `WEAVE_CELLS`, `lastCopiedBlock`, `htmlText`, `weaveCellsHTML`, `readWeaveCells`, `fitChips`, `overflowsY`, `WEAVE_DEV`, `checkRowPitch`, `PHONE_MORE_W`, `phoneRowCore`, `phoneRowOf`, `phoneLeadEl`, `foldValueCounters` |
| 2904-3103 | `fitPhoneChipLines`, `markClippedCells`, `DENSITY_LABELS`, `densityKey`, `hasView`, `gridDensity`, `saveGridDensity`, `adoptLegacyDensity`, `registryTable`, `introControlsHidden`, `showIntroControls`, `renderMarkdownInto`, `appendRegistryPresentation`, `registryHref`, `mineOnly`, `rowClickTarget`, `menuSide`, `menuBounds` |
| 3104-3299 | `openMenu`, `menuRow`, `menu`, `dotsMenu`, `KIND_LABELS`, `unthunk`, `kindHead`, `menuFor`, `kindDots`, `OWN_CONTEXT`, `kindContext`, `renameNavTable`, `duplicateEntity`, `setLinkPreview`, `TRASHED`, `reopenAfterUndo` |
| 3300-3496 | `trashRow`, `OPEN_TRASH`, `MENU_ROWS`, `hasInlineMarkup`, `INLINE_TAG`, `inlineIconAccept`, `dressTokens` |
| 3497-3682 | `swapToEdit`, `dressedText`, `dressedUrl`, `viewCore`, `viewFieldOf`, `cellGraphics`, `numberCore`, `scaleText`, `figureCanvas`, `figureWidth`, `numberGraphic`, `numberGraphicFor`, `ratingEl`, `ratingListEl`, `sparkEl`, `chipView`, `chipElFrom`, `viewSegmentEl`, `viewChipEl`, `viewCardEl`, `viewCell`, `avatarUpload` |
| 3683-3876 | `avatarPicker`, `avatarControl`, `entityAvatarEl`, `relationChipEl`, `externalRefChipEl`, `chipOpensRecord`, `toggleMentionCaret`, `stateOptions`, `statePicker`, `editChipSegment`, `toggleSwitch`, `HTML_FRAME_SANDBOX`, `FILE_FRAME_SANDBOX`, `fileUrl`, `previewUrl`, `streamUpload`, `fileKind`, `isPictureFile`, `fileIconName`, `fileSizeText`, `isViewableFile`, `fileViewUrl`, `plainClick`, `MISSING_TAIL`, `fitAttachName`, `attachItemEl` |
| 3877-4063 | `attachSheetEl`, `fileBodyEl`, `fileFrameOf`, `fittedHeights`, `FIT_PENDING_MS`, `fitFrame`, `reserveFit`, `PAGE_STORAGE_SAVE_MS`, `fileViewerEl`, `placeCoverIn`, `entityCoverEl`, `fileLightbox`, `filePanel`, `labeledEditorFor` |
| 4064-4161 | `fileDropZone`, `optionCreator`, `optionHue`, `optionIcon`, `optionChipEl`, `READ_ONLY_KEEPS`, `readOnlyValue`, `staleToast`, `saveValues` |
| 4162-4333 | in `editorFor`: `saved`, `patch` |
| 4334-4498 | in `editorFor` |
| 4499-4696 | `DOC_PREVIEW_LINES`, `docPreviewCell`, `docChipCell`, `BLANK_READ_ONLY`, `blankView`, `pickTableView`, `viewed`, `gridConfigWrite`, `viewHref`, `showsDeleted`, `showsRollups`, `systemDefault`, `nextViewName`, `viewEdit`, `viewStrip`, `filterSeed`, `PREFILL_SKIP`, `prefillBase`, `manyRelation` |
| 4697-4817 | `prefillControl`, `prefillValues`, `openPrefill`, `tableFilters`, `setTableFilters`, `FILTER_KINDS`, `isFilterField`, `FILTER_CHIP_ROLE`, `filterStates`, `filterCounts`, `setFilterTotal`, `filterWhere`, `filterTriples`, `FILTER_DEBOUNCE`, `filterWrites` |
| 4818-5006 | `filterStrip`, `TABLE_SEARCH_DEBOUNCE`, `tableSearch`, `tableSearchTimer`, `tableSearchRelease`, `tableSearchWrites`, `tableSearchLocal`, `saveTableSearch`, `stopTableSearchTimer`, `tableSearchText`, `setTableSearch`, `openTableSearch`, `tableSearchBox`, `showDatabase`, `FIRST_PAGES_KEPT`, `firstPages`, `rememberFirstPage`, `tableGroup`, `serverSums` |
| 5007-5206 | `readAndDrawTable`, `BULK_KEEPS_ROWS`, `bulkPatch`, `gridMoves`, `gridFields`, `graftChips`, `gridSort`, `gridPager`, `classSelector`, `tableControlPopover`, `tableControlButton`, `tableControlHeader` |
| 5207-5365 | `tableViewButton`, `tableDensityButton`, `setFilterCount`, `tableFilterButton`, `tableSortButton`, `RO`, `startRowDrag` |
| 5366-5483 | `phoneRowPopover`, `VP`, `PANE_KEY`, `PANE_SECTION_KEY`, `readPref`, `writePref`, `viewPane`, `PANE_SECTIONS`, `NO_SORT_TYPES`, `sortFieldOptions`, `sortWords`, `paneSwitch`, `paneWrite` |
| 5484-5658 | `levelsBlock`, `listRowPrefs`, `drawnGroupKeys`, `rollupCells`, `keyedSeg`, `displayBlock`, `footStatLists` |
| 5659-5840 | `footRollupWrite`, `paneValue`, `paneChanged`, `paneFilters`, `paneFields`, `paneBody`, `paneEl`, `paneWanted`, `setPaneOpen`, `paneSync`, `renderViewPane`, `closeSharePanel`, `sharePanelOwner` |
| 5841-5998 | `sharePanelButton`, `tableChromeSig`, `tableChromeOn`, `tableChrome`, `tableToolsButton`, `paintTableChrome`, `teardownGrid` |
| 5999-6186 | `drawDatabase`, `listCore`, `boardCore`, `isBoardLayout`, `listSetup`, `listKeys`, `listDomain`, `listTargetRows`, `readAndDrawBoard`, `listWrites`, `shareCollapsed`, `listViewWrite` |
| 6187-6331 | `listLevelValue`, `listPathValues`, `listHeadingEl`, `groupCrumbEl`, `breakdownFields`, `groupSummaryEl`, `drawnPast`, `cappedEls`, `boardCardFields`, `PICTURE_LABELS`, `FIT_OPTIONS`, `boardControls`, `groupFieldOptions`, `tableGroupButton`, `eyeGlyph`, `eyeWrites`, `eyeTails`, `eyeGestures`, `eyeGesture`, `REFERENCE_PANELS`, `showsRefPanel` |
| 6332-6528 | `fieldVisibilityPopover`, `dropDrawnColumn` |
| 6529-6543 | `drawnMatches`, `visibleCols`, `GRID_SEQ` |
| 6544-6743 | in `renderTable`: `isSysCol`, `cellBox`, `sysValue`, `sysCell`, `refit`, `SEL`, `repaintRange`, `chosen`, `drawnIds`, `ordered`, `total`, `itemAt`, `itemOf`, `loadedIds`, `paintSelection`, `setChosen`, `clearChosen`, `onBox`, `runOnSelection`, `dropRows`, `trashChosen`, `runBulk`, `relations`, `otherTables`, `nRows`, `picker`, `setField`, `setValue`, `relationPicker`, `linkTo` |
| 6744-6943 | in `renderTable`: `more`, `moreCmds`, `holdAct`, `drawPuck`, `fieldCell`, `buildRow`, `clientSortValue`, `groupSlots`, `rowSlotNear`, `foldGroup`, `buildGroupHead`, `buildSumRow`, `buildSlot`, `GW` |
| 6944-7141 | in `renderTable`: `canFreezeHere`, `storedFrozen`, `storedWidth`, `widestOf`, `emptyDoc`, `widthOf`, `headOf`, `leadCount`, `refreeze`, `layoutCss`, `paintLayout`, `sizePidColumn`, `settle` |
| 7142-7325 | in `renderTable`: `blocked`, `commitWidth`, `flip`, `applyOrder`, `columnDrag` |
| 7326-7513 | in `renderTable`: `headPointerDown`, `headKey`, `listRows`, `rowH`, `spacer`, `setPad`, `reach`, `paintLoadMore`, `rowFor`, `scroller`, `geometry`, `pinFor`, `paint`, `rewindow`, `schedule`, `onScroll`, `scrollToRow`, `ensureRow`, `repaintRow` |
| 7514-7696 | in `renderTable`: `patchRows`, `topEdge`, `topRow`, `setDensity`, `draw`, `KM`, `stops`, `rowsOf`, `openerOf`, `cellAt`, `landOn` |
| 7697-7895 | in `renderTable`: `apply`, `RG`, `rangeCols`, `refOfCell`, `coordOfCell`, `coordOfRef`, `refAtCoord`, `sameCell`, `rangeRect`, `cellOfNode`, `cursorCell`, `rangeOrCursor`, `paintRange`, `setRange`, `clearRange`, `fieldNamed`, `typeOf`, `optionsOf`, `labelOf`, `valueAt`, `relationRows`, `runRange`, `openControl`, `clipboardTarget`, `cellOfEvent`, `onGrid` |
| 7896-8026 | in `renderTable`: `cellUnder`, `endDrag`, `dropCellPop`, `listRow`, `destroy` |
| 8027-8218 | `TAP_SLOP`, `TAP_MS`, `phoneChipAt`, `editPhoneField`, `SYSTEM_COLS`, `stampEl`, `usersCache`, `flushUsers`, `workspaceUsers`, `actorChipEl`, `commentAuthorText`, `workflowRows`, `workflowRow`, `PULSE`, `automationSeen` |
| 8219-8411 | `noteAutomationWrites`, `pulseTargets`, `pulseCells`, `colField`, `MIN_COLUMN_WIDTH`, `cellFitProbe`, `fitColumnWidth`, `clearSelection`, `columnResizeGrip`, `FIELD_MENU_ICONS`, `lookupTargetOf`, `sortLabelsFor` |
| 8412-8603 | `fieldMenuButton`, `measureCtx`, `textWidth`, `dateControl`, `dateStoreFns`, `rangeControl`, `calendarGlyph`, `segCtl`, `lazyScripts`, `workflowCells`, `lazyScript`, `warmDatePicker`, `withDatePicker`, `openForms`, `openInvite`, `settingsView`, `openTrash`, `openSettings`, `openDeleteWorkspace`, `boardView`, `openFieldDialog` |
| 8604-8784 | `fieldConfigToast`, `rolledBackText`, `SCROLL_PANES`, `keepScroll`, `editFieldDialog`, `reorderBlocks`, `reorderField`, `addFieldMenuButton`, `FOOT_LABELS`, `FOOT_NUMERIC`, `footPickerLabel`, `footAggregatesFor`, `spaceRollupName`, `RATING_SCALE_FOOT`, `spaceRollupEntry`, `renderFooter`, `fillFooter` |
| 8785-8974 | `footerPicker`, `spaceStatTiles`, `showSpace`, `appendSpaceDetails`, `systemSpaceNote`, `useTemplateButton`, `useTemplateDialog` |
| 8975-9172 | `spaceTablesCard`, `relationMap`, `relationMapCard`, `liveEditors`, `pendingDocSaves`, `docPulls`, `vditorTheme`, `vditorLoading`, `loadVditor`, `docBubbles`, `REF_CHIP_DEBOUNCE`, `refChipLayers`, `docCodeAuto`, `docCodeRaw`, `resizeFrame`, `DASH_READING_LINE`, `docRails`, `attachDashRail`, `headText`, `sectionTexts`, `refreshDashRail`, `docFolds`, `DOC_DECOR`, `docFoldState`, `attachHeadingFolds` |
| 9173-9352 | `refreshHeadingFolds`, `__weaveEditors`, `__weaveDocSaves`, `__weaveFlushDocSaves`, `retheme`, `docBases`, `docBaseOf`, `noteDocBase`, `sendDoc`, `docConflict`, `scheduleDocSave`, `flushDocSave`, `whenEl`, `flushDocSaves`, `leaveDocs`, `teardownDocEditors`, `dropDecor`, `docSectionCollapse`, `foldCaret`, `appearsAsPanel` |
| 9353-9422 | `showEntity`, `nextStateButton`, `nextStateFor`, `pageGo`, `entityHop`, `entityRefs` |
| 9423-9568 | in `renderEntityView`: `repaint`, `holds`, `holdsDoc`, `asNode`, `streamed`, `surfaceBehind`, `tellSurface`, `docSaved`, `frame`, `saved`, `recordCtx`, `openEye`, `drawFab`, `shownRefPanels`, `openSide` |
| 9569-9760 | in `renderEntityView`: `docSection`, `relationCount`, `coverEl`, `placeCover`, `anchor`, `restingGrip`, `handle`, `wireBlock` |
| 9761-9956 | in `renderEntityView`: `dragRow`, `named`, `drawFiles` |
| 9957-9999 | in `renderEntityView`: `refCard`, `drawRefs` |
| 10000-10155 | `activityPanel`, `quickCreate`, `newUserDialog`, `tableTray`, `runStarter`, `emptyWorkspace`, `onboardingAsked`, `maybeOnboard` |
| 10156-10272 | `onboard`, `SCHEMA_OPEN_KEY`, `schemaDisclosure`, `fieldTray`, `addFieldDialog` |
| 10273-10462 | `relatedGrid`, `subtableOf`, `chipTriple`, `subtableChips`, `subtableWrites`, `subtablePopover`, `ACTIVITY_PAGE`, `openActivityLog` |
| 10463-10634 | `showView`, `homeReads`, `bootHomeReads`, `workspaceSystemCard`, `savedPagesCard`, `showHome`, `appendWorkspaceDetails`, `ROLE_LABELS`, `currentWsName`, `RECENT_KEY`, `RECENT_KEEP`, `readRecents`, `noteRecent`, `noteEntityRecent`, `marked`, `wireSearchButton`, `openPalette`, `relationTargets` |
| 10635-10833 | `linkSearch`, `gestures`, `GESTURE_CAP`, `UNDO_WINDOW`, `CLAIM_CAP`, `UNDO_REFUSED`, `keptLine`, `undoToast`, `undoKey`, `pendingClaims`, `looseIds`, `ENTITY_UNDO`, `BULK_UNDO`, `undoEntriesOf`, `newGesture`, `noteWrite`, `pinClaims`, `claimOwn`, `undoQueue`, `undoOwn`, `stepBackOwn`, `unlinkWithUndo`, `undoPatch`, `undoGesture`, `refreshView` |
| 10834-11019 | `focusGridRow`, `KEY_SHEET_ANYWHERE`, `KEY_SHEET_TABLE`, `openKeySheet`, `LOADER_CYCLE_MS`, `LOADER_SHOW_AFTER_MS`, `LOADER_POSE_FROM`, `LOADER_POSE_TO`, `LOADER_EXIT_RATE`, `LOADER_HOLD_MS`, `LOADER_FADE_MS`, `SKELETON_SHOW_AFTER_MS`, `LOADER_CAPTION_AFTER_MS`, `LOADER_RETRY_AFTER_MS`, `LOADER_CAPTION_TEXT`, `LOADER_RETRY_LABEL`, `loading`, `initPageLoader`, `showPageLoader`, `paintLoaderWait`, `paintLoaderRetry`, `clearLoaderWait`, `hidePageLoader`, `stillLoader`, `ropeAnimations`, `settleLoader`, `keepLoader` |
| 11020-11201 | `withPageLoader`, `gridWait`, `gridHold`, `markGridWait`, `paintGridWait`, `gridLoaderNode`, `placeGridLoader`, `showGridLoader`, `hideGridLoader`, `resetGridWait`, `paintSkeleton`, `skeleton`, `scheduleSkeleton`, `cancelSkeleton`, `syncDocTitle`, `renderRoute`, `rememberRoute`, `navDraw`, `navOwns` |
| 11202-11334 | `dispatchRoute`, `paintRouteError`, `renderRouteSafely`, `installPhoneBar`, `NEW_ROW_CHOICES`, `NEW_ROW_OPTIONS`, `rowNoun`, `sheetGrip` |
| 11335-11487 | `newRowTray`, `syncPhoneBar`, `ensureNavMenu`, `route`, `redock` |
| 11488-11651 | `buildWsRail`, `servesBareRoot`, `bareRootWs`, `wsHref`, `wsApiPrefix`, `wsApi`, `wsLogoButton`, `uploadWorkspaceLogo`, `removeWorkspaceLogo`, `wireWsNew`, `tightShell`, `navPeekDwell`, `closeNavPeek`, `showNavCollapsed`, `setNavCollapsed` |
| 11652-11841 | `wireNavCollapse`, `NAV_WIDTH`, `wireNavResize`, `NAV_KEY_OWNERS`, `wireNavHold`, `labelNavMenu` |
| 11842-11989 | `navMenuButton`, `wireSkipLink`, `THEME_ICONS`, `THEME_LABELS`, `THEME_MEDIA`, `themePref`, `applyTheme`, `cycleTheme`, `wireTheme`, `syncSchema`, `bugGlyph`, `bugRecorder`, `bugDraft`, `installBugReporter`, `bugTrigger`, `closeBugPanel` |
| 11990-12119 | `openBugPanel` |

## src/engine.js

| Lines | Declares |
| --- | --- |
| 1-186 | `iconValue`, `IconRegistry`, `MarkIcons`, `ChipCore`, `Term`, `ListCore`, `ViewPane`, `BoardCore`, `LAYOUTS`, `PhoneRow`, `SYSTEM_TERMS`, `CSV_FORMULA_START`, `unquoteCSVCell`, `parseCSV`, `VALUES_BLOCK`, `FILES_BLOCK`, `REFERENCE_PANELS`, `isFixedBlock`, `BLOB_ID`, `isBodyBlock`, `VALUE_TYPES`, `isFileField`, `AVATAR_SHAPES`, `AVATAR_IMAGE_TYPES`, `SEARCHED_VALUE_TYPES`, `REGISTRY_HITS`, `LOCKED_NAME`, `UPGRADE_FLOOR`, `refuseBeforeFloor`, `RESERVED_NAMES`, `own`, `PASTED_ENTITY`, `pastedEntityId`, `byPosition`, `checkPosition`, `SYSTEM_SPACE_NAME`, `SYSTEM_SPACE_ICON`, `LEGACY_SYSTEM_SPACE_NAME`, `answersLegacySystem`, `refuseReserved`, `sniffImage`, `fileBlobIds`, `PREVIEW_MAX_BYTES`, `FILE_MAX_BYTES`, `mbText`, `PREVIEW_TYPES`, `logoType`, `LOCAL_RANGES`, `localAddress`, `webhookRefusal`, `INLINE_FILE_TYPES`, `HTML_VIEW_POLICY`, `HTML_PAGE_POLICY`, `sandboxedHtmlHeaders`, `HTML_FILE_TYPES`, `FILE_STORAGE_CAP`, `isHtmlFile`, `FRAME_HEIGHT_SCRIPT`, `FRAME_LINK_BASE`, `frameLinkBase`, `scriptJson` |
| 187-386 | `frameStorageScript`, `LEADING_DOCTYPE`, `viewHtml`, `fileHeaders`, `ATTACHMENT_PREVIEWS`, `ATTACHMENT_SIZES`, `ATTACHMENT_FITS`, `ATTACHMENT_LOOK_KEYS`, `isBoolType`, `COMPUTED_TYPES`, `DERIVED_CACHE_CAP`, `FieldDialogCore`, `STATE_CATEGORIES`, `DEFAULT_WORKFLOW_STATES`, `SYSTEM_SORT_KEYS`, `TEXT_OPS`, `VIEW_SHAPES`, `QUERY_SHAPES`, `pageNumber`, `describeValue`, `checkWhereNode`, `checkQueryDocs`, `leanRow`, `DESCRIPTION_SIZES`, `DESCRIPTION_CHARS`, `ACTIVITY_CAP`, `ACTIVITY_PAGE`, `ACCOUNT_ACTOR`, `accountActor`, `REMOVED_ACCOUNT`, `FIELD_CONFIG_ACTIONS`, `SCHEMA_AUDIT_ACTIONS`, `UNTAGGED_SCHEMA_ACTIONS`, `ONTOLOGY_TYPES`, `ONTOLOGY_LEGEND`, `ontologyEtag`, `fieldDefinition`, `canonicalJSON`, `definitionChanges`, `VIEW_AUTO_SEGMENTS`, `VIEW_DEFAULTS`, `VIEW_NAMES`, `VIEW_EXCLUDED_TYPES`, `plainLines`, `GRID_SYSTEM_COLUMNS`, `RETIRED_SYSTEM_FIELD`, `withoutRetired`, `sysColumnId`, `sysColumnName`, `viewEntryName`, `placeField`, `showBySchema`, `clip`, `DYNAMIC_DATE_DEFAULTS`, `DOCUMENT_KINDS` |
| 387-581 | `CREDENTIAL_KINDS`, `KEYSTORES`, `DEFAULT_PAIR_PARTS`, `NUMBER_COSTUME_KEYS`, `ROLLUP_COSTUME_KEYS`, `NUMBER_DISPLAYS`, `isGraphicDisplay`, `CELL_COLORS`, `cellColorValue`, `SPARKLINE_STYLES`, `lastNumber`, `RATING_MAX`, `RATING_DEFAULTS`, `RATING_SCALE_AGGS`, `ratingValue`, `DATE_COSTUME_KEYS`, `FORMULA_COSTUME_KEYS`, `DG`, `DEFAULTABLE_TYPES`, `FIELD_TYPES`, `DOC_REVISION_WINDOW_MS`, `docFingerprint`, `docChange`, `RETIRED_STATE_CATEGORIES`, `WORKFLOW_STATES`, `workflowActor`, `actorWorkflow`, `HOME_RUNS`, `HOME_RUN_ROWS`, `templated`, `scheduleOut`, `listenerOut`, `HOOK_PARTS`, `compileHook`, `hookOut`, `triggerOut`, `LISTENER_ACTIONS`, `HOOK_RECORD_ACTIONS`, `ACTION_TEXT_MAX`, `boundedText`, `workflowScript`, `WORKFLOW_PANEL`, `whenWords`, `actionWords`, `urlHost`, `HTTP_STEP_BODY_MAX`, `itemRow`, `hookPathOf`, `OUTBOUND`, `CREDENTIAL_HEADERS`, `blankTemplates`, `fillJson`, `stepBody`, `thenWords`, `UPSERT_KEY_TYPES`, `blankSource`, `sourcePath`, `HUE_HEX`, `HUES`, `hueName`, `hueOf`, `normaliseOption`, `AGGREGATES`, `MAX_COMPUTE_DEPTH`, `CYCLE_PREFIX`, `isCycle`, `CycleSignal`, `FORMULA_SCAN_CAP`, `RECIPE_KEYS`, `DEFINABLE_TYPES`, `MAX_DEFINITION_DEPTH`, `TYPE_MIGRATIONS` |
| 582-741 | `ONTOLOGY`, `dressNumber`, `dressDate`, `pickCostume`, `putCostume`, `rollupCostume`, `formulaCostume`, `dressDateRange` |
| 742-901 | `numberConfig`, `dateConfig`, `optionName`, `credentialConfig`, `costumeFromDescriptor`, `recipeFromDescriptor`, `numberDescriptor`, `asBoolean`, `asString`, `dateType`, `optionType`, `CREDENTIAL_CONFIG_KEYS` |
| 902-1070 | in `FIELD_TYPE_CONFIG`: `text`, `number`, `formula`, `lookup`, `rollup`, `rating`, `date`, `daterange`, `checkbox`, `toggle`, `url`, `email`, `select`, `multiselect`, `workflow`, `field` |
| 1071-1192 | in `FIELD_TYPE_CONFIG`: `key`, `attachments`, `avatar`, `document`, `view` |
| 1193-1311 | `normalizeSelfContainedConfig`, `normalizeDefinition`, `formatFilters`, `parseFilters`, `formatSort`, `SORT_FORM`, `parseSortPart`, `parseSort`, `MIN_COLUMN_WIDTH`, `VIEW_MIN_WIDTH`, `VIEW_MAX_WIDTH`, `VIEW_DENSITIES`, `formatWidths`, `parseWidths`, `fieldDescriptionValue`, `CREATE_INPUT_KEYS`, `BULK_OPS`, `nowISO`, `schemaFingerprint`, `tableReaders` |
| 1312-1423 | `templateDoc`, `HELD`, `deferMigrations`, `runDeferredMigrations`, `detachHubRegistry` |
| 1424-1614 | `detachedRegistryState`, `inviteUrl`, `USER_COLUMNS`, `USER_KEPT`, `USER_PRIVATE`, `hidesChange`, `capital` |
| 1615-1812 | in `Weave`: `#dirty`, `#dirtyAll`, `#held`, `#detachedStorage`, `#schemaVersion`, `#rows`, `#query`, `#cutoffs`, `#computing`, `constructor`, `#migrate`, `#settlePositions`, `#place`, `#spacesInOrder`, `#tablesOfSpace`, `#reconcileFieldOrder`, `#ensureDescriptionField`, `#repairDoubledInverses`, `#ensureViewFields` |
| 1813-2010 | in `Weave`: `#ensureSystemColumnsInViews`, `#dropRetiredSystemField`, `#ensureStandardViewName`, `#ensureTableViews`, `viewField`, `#normalizeViewConfig`, `#viewSegmentFields`, `#faceOf`, `renderView`, `#viewLine`, `termOf`, `#inverseName`, `#setTerm` |
| 2011-2203 | in `Weave`: `descriptionField`, `save`, `#rolledBack`, `#forgetPending`, `#touching`, `touching`, `affectedBy`, `#mark`, `settleDeferred`, `maybeRefresh`, `schemaVersion`, `spaceMembers`, `setSpaceMember`, `removeSpaceMember`, `#nameHolders`, `#assertNameFree`, `createSpace`, `listSpaces` |
| 2204-2348 | in `Weave`: `findSpace`, `getSpace`, `updateSpace`, `deleteSpace`, `restoreSpace`, `createTable`, `listTables`, `userTables`, `qualifiedName`, `findTable`, `getTable` |
| 2349-2529 | in `Weave`: `updateTable`, `moveTable`, `duplicateTable` |
| 2530-2727 | in `Weave`: `deleteTable`, `restoreTable`, `relationMapMmd`, `createView`, `listViews`, `getView`, `deleteView`, `restoreView`, `resolveView` |
| 2728-2925 | in `Weave`: `shareView`, `unshareView`, `mintShare`, `listShares`, `revokeShare`, `renewShare`, `updateShare`, `regenerateShare`, `shareByToken`, `tableView`, `#viewTarget`, `#viewIndex`, `#noView`, `#blankFields`, `#viewOut`, `#phoneRowNamed`, `#writePhoneRow`, `#listField`, `#sameGrouping`, `#checkGroup` |
| 2926-3006 | in `Weave`: `#orderRow`, `#writeListKeys`, `#checkViewName` |
| 3007-3196 | in `Weave`: `#writeView`, `#sortOutOfGroup`, `#writeDefaultView`, `#checkFilters` |
| 3197-3260 | in `Weave`: `#viewQueryIn`, `#checkSort`, `#defaultViewConfig`, `applySchema`, `#atomically` |
| 3261-3459 | in `Weave` › `#applySchemaPass`: `act`, `configFromDescriptor`, `colorsOf`, `fieldChanged`, `docTable`, `cardinalityOf`, `relationArgs` |
| 3460-3532 | in `Weave` › `#applySchemaPass` |
| 3533-3603 | in `Weave`: `listTemplates`, `useTemplate`, `build`, `#buildCopy` |
| 3604-3793 | in `Weave` › `#buildRun`: `fail`, `step`, `extra`, `isObj`, `cosmetic`, `listAt`, `result`, `target`, `phase`, `relationOf`, `resolves`, `visit` |
| 3794-3848 | in `Weave` › `#buildRun` |
| 3849-4039 | in `Weave`: `#buildOrder`, `#applyTableCostume`, `#bodyOrderFrom`, `#legacyEdits`, `#applyViews`, `workspaceOrder`, `moveWorkspace`, `getWorkspace`, `updateWorkspace`, `#keyStore` |
| 4040-4237 | in `Weave`: `migrateKeys`, `credentialConfig`, `setKey`, `deleteKey`, `hasKey`, `listKeys`, `resolveKey`, `#localKeys`, `#keyInWorkspace`, `#mayReveal`, `revealKey`, `ownsKey`, `#callerAccount`, `#isKeyHolder`, `#mayGrant`, `#grantRefusal`, `grantKey`, `revokeKey`, `#renameKeyHolder`, `credentialLink`, `ROLES`, `ROLE_LABELS`, `OLD_ROLES`, `roleName`, `#audit` |
| 4238-4433 | in `Weave`: `#spacesTouching`, `auditWorkspace`, `listAudit`, `createAccount`, `#createAccount`, `verifyToken`, `listAccounts`, `noteTokenWrite`, `actorName`, `isActor`, `#accountById`, `#actorFor`, `#namedShared`, `#namedDetail`, `#namedActivity`, `#lockedNames`, `deleteAccount`, `onboardedAt`, `markOnboarded`, `agentSeen`, `noteAgent`, `setRequireAuth` |
| 4434-4630 | in `Weave`: `billing`, `startTrial`, `markTrialMail`, `linkBillingOrg`, `SESSION_TTL_MS`, `LAST_SEEN_MS`, `#account`, `#hash`, `createSession`, `verifySession`, `#lastSeenStale`, `removedSession`, `listSessions`, `revokeSession`, `INVITE_TTL_MS`, `#issuer`, `linkIdentity`, `#mintInvite`, `#invite`, `inviteMember`, `listInvites`, `revokeInvite`, `#inviteName` |
| 4631-4813 | in `Weave`: `renameAccount`, `setAccountRole`, `#memberName`, `identityInvite`, `invitesForEmail`, `acceptInvite`, `redeemIdentityInvite`, `#redeem`, `unlinkIdentity`, `accountForIdentity`, `#scrubIdentityEmails`, `#inMetaSync`, `#oneTime`, `inviteIssuer`, `localKeyAccess`, `registryHost`, `members`, `#reg`, `#engines`, `#engineOf`, `#wsIdOfRow`, `#ownerOf`, `#tableAnywhere`, `#fieldAnywhere` |
| 4814-4999 | in `Weave`: `#retireDetachedOrphans`, `detachHubRegistry` |
| 5000-5186 | in `Weave`: `joinRegistry`, `hostRegistry`, `#syncAll`, `#userRows`, `#syncUsers`, `#userTarget`, `#userValues`, `#createUserRow` |
| 5187-5381 | in `Weave`: `#updateUserRow`, `#setInviteRole`, `#deleteUserRow`, `takeOneTime`, `#syncWorkspaceRow`, `syncRegistry`, `#metaSync`, `#inUndo`, `#undoOwner`, `#undoHeld`, `#recordUndo`, `#undoPending`, `#pushUndo`, `#holdUndo`, `#writersSince`, `#keptSince`, `#undoBefore`, `#undoAfter`, `#lastWriter`, `#undoChanged`, `#undoExpected` |
| 5382-5493 | in `Weave`: `undo`, `listUndo`, `#sysTable`, `#sysRow`, `#relIds`, `#sysField` |
| 5494-5648 | in `Weave`: `#ensureMetaTables` |
| 5649-5847 | in `Weave`: `registryReport`, `rebuildRegistry`, `#syncSpaceRow`, `#syncTableRow`, `#syncViewRows`, `#viewAnywhere` |
| 5848-6046 | in `Weave`: `#syncFieldRow`, `#dropFieldRow`, `#fieldOwner`, `#dropSysRow`, `#trashSysRow`, `#restoreSysRow`, `#integrationNamed`, `#integrationProvider`, `#integrationInput`, `#updateIntegrationRow`, `#onReg`, `#stampIntegration`, `#integrationRow`, `#integrationTarget`, `#integrationEntry`, `#sealIntegrationKey`, `#dropIntegrationKey`, `#checkIntegration` |
| 6047-6196 | in `Weave`: `integrationFetch`, `setIntegrationCredential`, `#interceptCreate` |
| 6197-6376 | in `Weave`: `#interceptUpdate`, `#viewRowPatch`, `#interceptDelete`, `findField`, `getField`, `materializeField` |
| 6377-6567 | in `Weave`: `addField`, `addRelation`, `bodyBlocks`, `#recipe`, `#refuseSpaceRepoint`, `#repoint`, `#formulasBroken` |
| 6568-6720 | in `Weave`: `#formulaHealth`, `#formulaRenames`, `#wherePaths`, `#ruleRenames`, `#applyRuleRenames`, `#fieldSettings`, `#fieldReaders`, `updateField`, `fieldChangeSince` |
| 6721-6915 | in `Weave`: `#updateField`, `#subtableConfig`, `#dropOlderSnapshots`, `#publicDetail`, `#fieldLogQuiet`, `#withoutFieldLog`, `#fieldConfigRows` |
| 6916-7111 | in `Weave`: `#fieldConfigRow`, `#rollbackCheck`, `rollbackFieldConfig`, `#formulaCycle`, `#refuseFormulaCycle`, `checkFormula`, `#migrateFieldType` |
| 7112-7310 | in `Weave`: `#textToRelation`, `#relationToText`, `deleteField`, `restoreField`, `#trashedField`, `#trashedFieldAnywhere`, `#purgeTrashedField` |
| 7311-7504 | in `Weave`: `#fieldTrashEntry`, `#fieldSnapshot`, `#reinstateField`, `#targetFieldReaders`, `#removeFieldRaw`, `documentFields`, `#resolveDocField`, `listEntities`, `#rowIndex`, `#derived`, `#forgetDerived`, `#derivedKey`, `#remember`, `#sortKeys` |
| 7505-7704 | in `Weave`: `#indexRow`, `#unindexRow`, `#tableRows`, `#rowsByPublicId`, `#liveRowCounts`, `listTrash`, `#present`, `#liveEntity`, `#lockedEntity`, `#hiddenSpaces`, `#hiddenKey`, `#tableHidden`, `#rowHidden`, `#sysRowHidden`, `#framed`, `#mayChange`, `#readOnlyFor`, `#guarded`, `#belowArchitect`, `#withheld`, `#mayWriteRow`, `#mayWriteTable`, `#mayShape`, `canSee` |
| 7705-7904 | in `Weave`: `asAccount`, `permalink`, `getEntity`, `findEntity`, `entityName`, `createEntity`, `#claimPublicId`, `#insertEntity`, `updateEntity`, `#checkValues` |
| 7905-8103 | in `Weave`: `#applyValues`, `#holdRows`, `#restoreRows`, `#writeValues`, `#validateDefault`, `now`, `#resolveDefault`, `#coerceDate`, `#validateValue` |
| 8104-8299 | in `Weave`: `#findOption`, `relationTargetDbIds`, `#normalizeRelationInput`, `#setRelationValue`, `#logInverse`, `#relationIds`, `#pluck`, `link`, `unlink`, `setState`, `#setStateInternal`, `deleteEntity` |
| 8300-8464 | in `Weave`: `bulk`, `#bulkRows`, `#portable`, `#moveEntity`, `restoreEntity`, `resolveField`, `#resolve`, `#rawName` |
| 8465-8651 | in `Weave`: `#resolveValue`, `#displayValue`, `#lookupRelation`, `#rollupRows` |
| 8652-8851 | in `Weave`: `#rollupTarget`, `#checkWhere`, `tableRollups`, `tableStats`, `entityRevision`, `conditionalWrite`, `#updateAtRevision`, `#adoptRolledBack`, `#inViewerZone` |
| 8852-9009 | in `Weave`: `readEntity`, `#readEntityIn`, `#numberDisplay`, `#scaleOf`, `#ratingOf`, `#summary`, `#inWorkspace`, `query`, `#inQuery` |
| 9010-9187 | in `Weave`: `#queryIn`, `#groupFieldShape`, `#groupTargets`, `#viewGroups`, `#rollupsOver`, `#matchNode` |
| 9188-9385 | in `Weave`: `#matchCondition`, `#definitionRank`, `#looseEq`, `#storesDate`, `#pathValue`, `getDoc`, `#docText`, `setDoc`, `docBase`, `#setDocAtBase`, `appendDoc`, `#writeDoc`, `#docRevisionFresh`, `#restoring`, `#recordDocRevision`, `listDocRevisions`, `getDocRevision`, `#docRevision`, `restoreDocRevision` |
| 9386-9524 | in `Weave`: `addComment`, `deleteComment`, `activityFeed`, `#activityFeed`, `getActivity`, `spaceHome`, `workspaceHome`, `#homeTables` |
| 9525-9657 | in `Weave`: `#homeRuns`, `#nextSeq`, `#logActivity`, `#stamping`, `#wfQueue`, `#wfEpoch`, `#wfRows`, `#wfRules`, `#noWebhooks`, `#trialHosted`, `webhookTimeoutMs`, `deliveryAttempts`, `createAutomation`, `#asReg` |
| 9658-9852 | in `Weave`: `#compileSpec`, `#compileListener`, `#compileUpsert`, `#compileHttpRequest`, `#checkFits` |
| 9853-10045 | in `Weave`: `#renderSpec`, `#workflowRows`, `#workflowHome`, `#wfField`, `#workflowRule`, `#allRules`, `#settleWorkflows`, `#stampDirty`, `#stamp`, `#setOption`, `#settleWorkflow`, `#stampRun` |
| 10046-10240 | in `Weave`: `#stampPoll`, `#guardWorkflowOn`, `#ruleOut`, `#ruleDiffers`, `#myRules`, `listAutomations`, `describeAutomations`, `#myRow`, `updateAutomation`, `deleteAutomation`, `#migrating`, `#migrateAutomations`, `#runAccess`, `#runRow`, `#saveRun` |
| 10241-10430 | in `Weave`: `startRun`, `updateRun`, `listRuns`, `#mailingRuns`, `runMaintenance`, `#runAutomations`, `#runAutomationsIn`, `#fireRule`, `#pendingRuns`, `automationsSettled`, `#liveRow` |
| 10431-10592 | in `Weave`: `#stepRun`, `#awaitStep`, `#finishRun`, `#inFlight`, `claimInbound`, `isEcho`, `#hookOf`, `#hookWords`, `#hookSecret`, `#hookRule`, `hookDeliveries`, `revealHookSecret`, `#hookRecord`, `receiveHook` |
| 10593-10792 | in `Weave`: `#receiveHook`, `#rememberEcho`, `pendingDeliveries`, `#dropDelivery`, `#deliveryFailed`, `#runSnapshot`, `#deadLetter`, `#letterLanded`, `replayDelivery`, `#updateDeliveryRow` |
| 10793-10974 | in `Weave`: `#reviveRun`, `runDeliveries`, `#scheduleSince`, `runSchedules`, `#polling`, `#pollState`, `#pollBudget`, `#runListeners`, `#poll`, `#pollWords`, `#pollLanded` |
| 10975-11159 | in `Weave`: `#runAction`, `#httpRequest`, `#send`, `#httpLand`, `#upsertSource`, `#upsertRow`, `#signedHeaders` |
| 11160-11359 | in `Weave`: `#template`, `search`, `#searchHits`, `universalSearch`, `#scopedSearch`, `capRows`, `previewFields`, `#stateLabel`, `referencesTo`, `referencesFrom`, `storageStats` |
| 11360-11552 | in `Weave`: `#blobPath`, `#hasBlob`, `#readBlob`, `#dropBlob`, `#stagePath`, `#blobHead`, `filesOnDisk`, `stageBlob`, `streamBlob`, `dropStagedBlob`, `#adoptBlob`, `#writeBlob`, `attachFile`, `attachToField`, `readFileMeta`, `readFile`, `#fileMeta`, `readFileStorage`, `writeFileStorage`, `setWorkspaceLogo` |
| 11553-11744 | in `Weave`: `getWorkspaceLogo`, `deleteWorkspaceLogo`, `deleteFile`, `importCSV`, `#importRows`, `spaceVersions`, `ontology`, `#schemaHistory`, `#ontologyLabel`, `#ontologyFields`, `#ontologyComputed` |
| 11745-11926 | in `Weave`: `#ontologyConcept`, `describeSchema`, `exportJSON`, `#landBlobs`, `#keepSecrets` |
| 11927-11985 | in `Weave`: `importJSON`, `#fileLedger`, `exportCSV` |
