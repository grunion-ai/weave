# Region index

`public/app.js` (12,115 lines) and `src/engine.js` (12,019 lines) are too long to read whole. This page cuts each one into regions of at most 200 lines along its declarations and names what every region declares, so a change opens the right 200 lines first. The first table places each behaviour of the [grid map](grid.md) by line.

`node scripts/region-index.mjs` generates this page at commit [`56e52e2`](https://github.com/grunion-ai/weave/tree/56e52e26dd9554ed32607f06c5626389fbc9a169), the commit the [architecture map](architecture/README.md) pins, so every line number is a line at that commit, and `node scripts/architecture.mjs` rewrites the page each time it re-pins the map. Code merged since the pin can shift a range by a few lines: `node scripts/region-index.mjs --now` prints these tables for your checkout. `test/region-index.test.mjs` fails when this page differs from what the script renders at the pin.

## Grid behaviours

A name with no file is in `public/app.js`, and "in" names the function a declaration sits inside.

| Behaviour | Lines |
| --- | --- |
| A table route opens and the chrome paints | `showDatabase` 4962-4983, `tableChrome` 5848-5920, `paintTableChrome` 5965-5974, `tableChromeOn` 5843-5847 |
| Rows are read and the grid is drawn | `readAndDrawTable` 4999-5041, `drawDatabase` 5979-6091, `renderTable` 6511-7987 (1,477 lines, 8 regions below) |
| The grid a redraw replaces is torn down | `teardownGrid` 5976-5978, `destroy` 7984-7984 in `renderTable`, `renderTable` 6511-7987 (1,477 lines, 8 regions below) |
| A board layout takes the same route | `public/board-core.js` 1-113, `public/board-view.js` 1-342, `readAndDrawBoard` 6127-6152 |
| Which columns are drawn | `visibleCols` 6504-6508, `gridFields` 5049-5058, `fieldVisibilityPopover` 6312-6484, `dropDrawnColumn` 6486-6495 |
| Only the rows near the viewport are in the DOM | `public/grid-window.js` 1-57, `rewindow` 7433-7444 in `renderTable`, `paint` 7399-7432 in `renderTable`, `renderTable` 6511-7987 (1,477 lines, 8 regions below) |
| The next page is fetched as the reader scrolls | `gridPager` 5078-5124, `WeaveGridWindow.feedFor` public/grid-window.js 27-33 |
| The loading state | `gridHold` 11055-11060, `paintGridWait` 11066-11081, `showGridLoader` 11098-11112, `hideGridLoader` 11113-11117, `resetGridWait` 11118-11124 |
| A cell rests, opens and commits | `activateCell` 2568-2588, `openCellPicker` 2559-2566, `editorFor` 4155-4489 (335 lines, 2 regions below) |
| A commit writes and the grid catches up | `renderTable` 6511-7987 (1,477 lines, 8 regions below), `patchRows` 7481-7504 in `renderTable` |
| A new row is added and takes focus | `newRowTray` 11331-11425, `focusNewRow` 2649-2671, `focusGridRow` 10830-10834 |
| Focus and scroll survive a redraw | `rememberGridFocus` 2118-2127, `restoreGridFocus` 2129-2143, `keepScroll` 8596-8615 |
| The keyboard moves the cursor | `public/grid-keymap.js` 1-106, `gridMoves` 5043-5047 |
| A range is selected, copied and filled | `public/grid-range.js` 1-192, `public/selection-core.js` 1-62, `repaintRange` 6541-6541 in `renderTable`, `paintSelection` 6552-6571 in `renderTable` |
| Column widths and the resize handle | `public/column-resize.js` 1-157 |
| Frozen leading columns | `WeaveColumnResize.frozenFit` public/column-resize.js 69-77, `canFreeze` public/column-resize.js 78-79 |
| The grid decides whether it fits its pane | `refit` 6525-6536 in `renderTable`, `renderTable` 6511-7987 (1,477 lines, 8 regions below), `fitGridScroller` 2592-2598 |
| Sideways scroll state | no declaration to place: `scroll` |
| A clipped cell says so, and spills on hover | `markClippedCells` 2933-2961, `fitChips` 2838-2859, `showCellPop` 2703-2758, `hideCellPop` 2765-2767, `gridRightEdge` 2696-2702 |
| Row height | `gridDensity` 2966-2970, `saveGridDensity` 2971-2978, `checkRowPitch` 2862-2871 |
| Sort, filter, group and search | `public/list-core.js` 1-190, `gridSort` 5073-5076, `filterWhere` 4796-4798, `tableGroup` 4991-4995, `setTableSearch` 4912-4919 |
| The view pane that configures all four | `renderViewPane` 5748-5817, `paneFilters` 5686-5706, `paneWrite` 5452-5463 |
| Footer totals | `rollupCells` 5574-5576, `footStatLists` 5613-5638, `footRollupWrite` 5639-5664 |
| A row becomes a card on a phone | `public/phone-row.js` 1-101, `phoneRowOf` 2875-2880, `phoneLeadEl` 2881-2892, `fitPhoneChipLines` 2901-2932 |
| The phone action bar | `installPhoneBar` 11262-11275, `syncPhoneBar` 11426-11437 |
| Which fields the card shows | `phoneRowPopover` 5346-5419 |
| A related table on a record page | `relatedGrid` 10274-10398, `subtableOf` 10400-10408, `subtableChips` 10411-10419, `subtablePopover` 10421-10455 |

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
| 1279-1434 | `fitCrumbs`, `CRUMB_MORE_PX`, `tableShedRows`, `shedRows`, `crumbFoldMenu`, `crumbOfHref`, `wsMarkEl`, `wsMarkIds`, `fillWsMark`, `refreshWsMarks`, `titleEdit`, `descriptionId`, `foldDescription`, `descToggle` |
| 1435-1557 | `viewHeader`, `wsHomeHref`, `navDrag`, `FOLDED_SPACES_KEY` |
| 1558-1757 | `renderNav`, `SYSTEM_FOLD_KEY`, `TRIAL_NOTICE_DAYS`, `ACCOUNT_ROLE_LABELS`, `accountSlot`, `accountDisplayName`, `accountWorkspaceName`, `healthNow`, `accountNow`, `refreshAccountChip` |
| 1758-1950 | `ACCOUNT_ROLE_HUES`, `accountChip`, `closeAccountMenu`, `personalMenuButton`, `personalMenu`, `postLogout`, `signOutOf`, `signOutEverywhere`, `fieldValueCell`, `isIconRef`, `stateLabel`, `stateNodes`, `chipLabel`, `stateCategory`, `stateChipClass`, `deckRoleOf`, `mermaidLoading`, `expandDocument`, `fullscreenViewer`, `openWhiteboard` |
| 1951-2145 | `renderMermaidIn`, `whileConnected`, `ghostBtn`, `dismissOutside`, `swallowClick`, `placeNear`, `showPopover`, `relearnRows`, `holdToConfirm`, `holdIcon`, `rememberGridFocus`, `restoreGridFocus` |
| 2146-2339 | `searchPicker`, `PHONE_SHORT_LIST`, `PHONE_ROW_H` |
| 2340-2531 | `anchorPop`, `valuePop`, `pickerSelect`, `chipPicker`, `chipPickerMulti`, `credentialLinkFor`, `credentialReveal`, `INTEGRATION_KEPT`, `integrationKeptCell`, `integrationKeyCell`, `replaceIntegrationKey`, `PICKER_FIELD_TYPES`, `READONLY_FIELD_TYPES`, `isNumCell`, `CREDENTIAL_GLYPHS`, `CREDENTIAL_KIND_LABELS`, `KEYSTORE_LABELS`, `computedMark`, `COMPUTED_NAME_MARKS`, `fieldDescription`, `qualifiedTableName` |
| 2532-2702 | `fieldRoute`, `fieldNameLabel`, `openCellPicker`, `activateCell`, `GRID_BOX_GUTTER`, `GRID_BOX_MIN`, `fitGridScroller`, `smoothScrollOk`, `paneOf`, `scrollBoxOf`, `scrollTargetIntoView`, `newRowTurn`, `stuckHeaderHeight`, `stickyFootHeight`, `focusNewRow`, `cellPopLayer`, `CELL_TYPE_PROPS`, `CLIPPABLE_CONTROLS`, `copyCellType`, `contentRect`, `CELL_POP_DELAY`, `SPILL_TYPES`, `spillsRight`, `gridRightEdge` |
| 2703-2900 | `showCellPop`, `CELL_POP_GAP`, `cellIsEditing`, `hideCellPop`, `spillEditor`, `overflowsX`, `WEAVE_CELLS`, `lastCopiedBlock`, `htmlText`, `weaveCellsHTML`, `readWeaveCells`, `fitChips`, `overflowsY`, `WEAVE_DEV`, `checkRowPitch`, `PHONE_MORE_W`, `phoneRowCore`, `phoneRowOf`, `phoneLeadEl`, `foldValueCounters` |
| 2901-3100 | `fitPhoneChipLines`, `markClippedCells`, `DENSITY_LABELS`, `densityKey`, `hasView`, `gridDensity`, `saveGridDensity`, `adoptLegacyDensity`, `registryTable`, `introControlsHidden`, `showIntroControls`, `renderMarkdownInto`, `appendRegistryPresentation`, `registryHref`, `mineOnly`, `rowClickTarget`, `menuSide`, `menuBounds` |
| 3101-3296 | `MENU_SHEET`, `openMenu`, `menuRow`, `menu`, `dotsMenu`, `KIND_LABELS`, `unthunk`, `kindHead`, `menuFor`, `kindDots`, `OWN_CONTEXT`, `kindContext`, `renameNavTable`, `duplicateEntity`, `setLinkPreview`, `TRASHED`, `reopenAfterUndo` |
| 3297-3493 | `trashRow`, `OPEN_TRASH`, `MENU_ROWS`, `hasInlineMarkup`, `INLINE_TAG`, `inlineIconAccept`, `dressTokens` |
| 3494-3679 | `swapToEdit`, `dressedText`, `dressedUrl`, `viewCore`, `viewFieldOf`, `cellGraphics`, `numberCore`, `scaleText`, `figureCanvas`, `figureWidth`, `numberGraphic`, `numberGraphicFor`, `ratingEl`, `ratingListEl`, `sparkEl`, `chipView`, `chipElFrom`, `viewSegmentEl`, `viewChipEl`, `viewCardEl`, `viewCell`, `avatarUpload` |
| 3680-3873 | `avatarPicker`, `avatarControl`, `entityAvatarEl`, `relationChipEl`, `externalRefChipEl`, `chipOpensRecord`, `toggleMentionCaret`, `stateOptions`, `statePicker`, `editChipSegment`, `toggleSwitch`, `HTML_FRAME_SANDBOX`, `FILE_FRAME_SANDBOX`, `fileUrl`, `previewUrl`, `streamUpload`, `fileKind`, `isPictureFile`, `fileIconName`, `fileSizeText`, `isViewableFile`, `fileViewUrl`, `plainClick`, `MISSING_TAIL`, `fitAttachName`, `attachItemEl` |
| 3874-4056 | `attachSheetEl`, `fileBodyEl`, `fileFrameOf`, `fittedHeights`, `FIT_PENDING_MS`, `fitFrame`, `reserveFit`, `PAGE_STORAGE_SAVE_MS`, `fileViewerEl`, `placeCoverIn`, `entityCoverEl`, `fileLightbox`, `filePanel`, `labeledEditorFor` |
| 4057-4154 | `fileDropZone`, `optionCreator`, `optionHue`, `optionIcon`, `optionChipEl`, `READ_ONLY_KEEPS`, `readOnlyValue`, `staleToast`, `saveValues` |
| 4155-4325 | in `editorFor`: `saved`, `patch` |
| 4326-4490 | in `editorFor` |
| 4491-4688 | `DOC_PREVIEW_LINES`, `docPreviewCell`, `docChipCell`, `BLANK_READ_ONLY`, `blankView`, `pickTableView`, `viewed`, `gridConfigWrite`, `viewHref`, `showsDeleted`, `showsRollups`, `systemDefault`, `nextViewName`, `viewEdit`, `viewStrip`, `filterSeed`, `PREFILL_SKIP`, `prefillBase`, `manyRelation` |
| 4689-4809 | `prefillControl`, `prefillValues`, `openPrefill`, `tableFilters`, `setTableFilters`, `FILTER_KINDS`, `isFilterField`, `FILTER_CHIP_ROLE`, `filterStates`, `filterCounts`, `setFilterTotal`, `filterWhere`, `filterTriples`, `FILTER_DEBOUNCE`, `filterWrites` |
| 4810-4998 | `filterStrip`, `TABLE_SEARCH_DEBOUNCE`, `tableSearch`, `tableSearchTimer`, `tableSearchRelease`, `tableSearchWrites`, `tableSearchLocal`, `saveTableSearch`, `stopTableSearchTimer`, `tableSearchText`, `setTableSearch`, `openTableSearch`, `tableSearchBox`, `showDatabase`, `FIRST_PAGES_KEPT`, `firstPages`, `rememberFirstPage`, `tableGroup`, `serverSums` |
| 4999-5186 | `readAndDrawTable`, `gridMoves`, `gridFields`, `graftChips`, `gridSort`, `gridPager`, `tableControlPopover`, `tableControlButton`, `tableControlHeader` |
| 5187-5345 | `tableViewButton`, `tableDensityButton`, `setFilterCount`, `tableFilterButton`, `tableSortButton`, `RO`, `startRowDrag` |
| 5346-5463 | `phoneRowPopover`, `VP`, `PANE_KEY`, `PANE_SECTION_KEY`, `readPref`, `writePref`, `viewPane`, `PANE_SECTIONS`, `NO_SORT_TYPES`, `sortFieldOptions`, `sortWords`, `paneSwitch`, `paneWrite` |
| 5464-5638 | `levelsBlock`, `listRowPrefs`, `drawnGroupKeys`, `rollupCells`, `keyedSeg`, `displayBlock`, `footStatLists` |
| 5639-5820 | `footRollupWrite`, `paneValue`, `paneChanged`, `paneFilters`, `paneFields`, `paneBody`, `paneEl`, `paneWanted`, `setPaneOpen`, `paneSync`, `renderViewPane`, `closeSharePanel`, `sharePanelOwner` |
| 5821-5978 | `sharePanelButton`, `tableChromeSig`, `tableChromeOn`, `tableChrome`, `tableToolsButton`, `paintTableChrome`, `teardownGrid` |
| 5979-6166 | `drawDatabase`, `listCore`, `boardCore`, `isBoardLayout`, `listSetup`, `listKeys`, `listDomain`, `listTargetRows`, `readAndDrawBoard`, `listWrites`, `shareCollapsed`, `listViewWrite` |
| 6167-6311 | `listLevelValue`, `listPathValues`, `listHeadingEl`, `groupCrumbEl`, `breakdownFields`, `groupSummaryEl`, `drawnPast`, `cappedEls`, `boardCardFields`, `PICTURE_LABELS`, `FIT_OPTIONS`, `boardControls`, `groupFieldOptions`, `tableGroupButton`, `eyeGlyph`, `eyeWrites`, `eyeTails`, `eyeGestures`, `eyeGesture`, `REFERENCE_PANELS`, `showsRefPanel` |
| 6312-6510 | `fieldVisibilityPopover`, `dropDrawnColumn`, `drawnMatches`, `visibleCols`, `GRID_SEQ` |
| 6511-6710 | in `renderTable`: `isSysCol`, `cellBox`, `sysValue`, `sysCell`, `refit`, `SEL`, `repaintRange`, `chosen`, `drawnIds`, `ordered`, `total`, `itemAt`, `itemOf`, `loadedIds`, `paintSelection`, `setChosen`, `clearChosen`, `onBox`, `runOnSelection`, `dropRows`, `trashChosen`, `runBulk`, `relations`, `otherTables`, `nRows`, `picker`, `setField`, `setValue`, `relationPicker`, `linkTo` |
| 6711-6910 | in `renderTable`: `more`, `moreCmds`, `holdAct`, `drawPuck`, `fieldCell`, `buildRow`, `clientSortValue`, `groupSlots`, `rowSlotNear`, `foldGroup`, `buildGroupHead`, `buildSumRow`, `buildSlot`, `GW` |
| 6911-7108 | in `renderTable`: `canFreezeHere`, `storedFrozen`, `storedWidth`, `widestOf`, `emptyDoc`, `widthOf`, `headOf`, `leadCount`, `refreeze`, `layoutCss`, `paintLayout`, `sizePidColumn`, `settle` |
| 7109-7292 | in `renderTable`: `blocked`, `commitWidth`, `flip`, `applyOrder`, `columnDrag` |
| 7293-7480 | in `renderTable`: `headPointerDown`, `headKey`, `listRows`, `rowH`, `spacer`, `setPad`, `reach`, `paintLoadMore`, `rowFor`, `scroller`, `geometry`, `pinFor`, `paint`, `rewindow`, `schedule`, `onScroll`, `scrollToRow`, `ensureRow`, `repaintRow` |
| 7481-7659 | in `renderTable`: `patchRows`, `topEdge`, `topRow`, `setDensity`, `draw`, `KM`, `stops`, `rowsOf`, `openerOf`, `cellAt`, `landOn` |
| 7660-7858 | in `renderTable`: `apply`, `RG`, `rangeCols`, `refOfCell`, `coordOfCell`, `coordOfRef`, `refAtCoord`, `sameCell`, `rangeRect`, `cellOfNode`, `cursorCell`, `rangeOrCursor`, `paintRange`, `setRange`, `clearRange`, `fieldNamed`, `typeOf`, `optionsOf`, `labelOf`, `valueAt`, `relationRows`, `runRange`, `openControl`, `clipboardTarget`, `cellOfEvent`, `onGrid` |
| 7859-7989 | in `renderTable`: `cellUnder`, `endDrag`, `dropCellPop`, `listRow`, `destroy` |
| 7990-8181 | `TAP_SLOP`, `TAP_MS`, `phoneChipAt`, `editPhoneField`, `SYSTEM_COLS`, `stampEl`, `usersCache`, `flushUsers`, `workspaceUsers`, `actorChipEl`, `commentAuthorText`, `workflowRows`, `workflowRow`, `PULSE`, `automationSeen` |
| 8182-8374 | `noteAutomationWrites`, `pulseTargets`, `pulseCells`, `colField`, `MIN_COLUMN_WIDTH`, `cellFitProbe`, `fitColumnWidth`, `clearSelection`, `columnResizeGrip`, `FIELD_MENU_ICONS`, `lookupTargetOf`, `sortLabelsFor` |
| 8375-8566 | `fieldMenuButton`, `measureCtx`, `textWidth`, `dateControl`, `dateStoreFns`, `rangeControl`, `calendarGlyph`, `segCtl`, `lazyScripts`, `workflowCells`, `lazyScript`, `warmDatePicker`, `withDatePicker`, `openForms`, `openInvite`, `settingsView`, `openTrash`, `openSettings`, `openDeleteWorkspace`, `boardView`, `openFieldDialog` |
| 8567-8747 | `fieldConfigToast`, `rolledBackText`, `SCROLL_PANES`, `keepScroll`, `editFieldDialog`, `reorderBlocks`, `reorderField`, `addFieldMenuButton`, `FOOT_LABELS`, `FOOT_NUMERIC`, `footPickerLabel`, `footAggregatesFor`, `spaceRollupName`, `RATING_SCALE_FOOT`, `spaceRollupEntry`, `renderFooter`, `fillFooter` |
| 8748-8937 | `footerPicker`, `spaceStatTiles`, `showSpace`, `appendSpaceDetails`, `systemSpaceNote`, `useTemplateButton`, `useTemplateDialog` |
| 8938-9135 | `spaceTablesCard`, `relationMap`, `relationMapCard`, `liveEditors`, `pendingDocSaves`, `docPulls`, `vditorTheme`, `vditorLoading`, `loadVditor`, `docBubbles`, `REF_CHIP_DEBOUNCE`, `refChipLayers`, `docCodeAuto`, `docCodeRaw`, `resizeFrame`, `DASH_READING_LINE`, `docRails`, `attachDashRail`, `headText`, `sectionTexts`, `refreshDashRail`, `docFolds`, `DOC_DECOR`, `docFoldState`, `attachHeadingFolds` |
| 9136-9322 | `refreshHeadingFolds`, `__weaveEditors`, `__weaveDocSaves`, `__weaveFlushDocSaves`, `retheme`, `docBases`, `docSha256`, `docBaseOf`, `noteDocBase`, `sendDoc`, `docConflict`, `scheduleDocSave`, `flushDocSave`, `whenEl`, `flushDocSaves`, `leaveDocs`, `teardownDocEditors`, `dropDecor`, `docSectionCollapse`, `appearsAsPanel` |
| 9323-9391 | `showEntity`, `nextStateButton`, `nextStateFor`, `pageGo`, `entityHop`, `entityRefs` |
| 9392-9509 | in `renderEntityView`: `repaint`, `holds`, `holdsDoc`, `asNode`, `streamed`, `frame`, `saved`, `recordCtx`, `drawFab`, `openSide` |
| 9510-9696 | in `renderEntityView`: `docSection`, `relationCount`, `coverEl`, `placeCover`, `anchor`, `restingGrip`, `handle` |
| 9697-9886 | in `renderEntityView`: `wireBlock`, `dragRow`, `named` |
| 9887-10000 | in `renderEntityView`: `drawFiles`, `refCard`, `drawRefs` |
| 10001-10156 | `activityPanel`, `quickCreate`, `newUserDialog`, `tableTray`, `runStarter`, `emptyWorkspace`, `onboardingAsked`, `maybeOnboard` |
| 10157-10273 | `onboard`, `SCHEMA_OPEN_KEY`, `schemaDisclosure`, `fieldTray`, `addFieldDialog` |
| 10274-10463 | `relatedGrid`, `subtableOf`, `chipTriple`, `subtableChips`, `subtableWrites`, `subtablePopover`, `ACTIVITY_PAGE`, `openActivityLog` |
| 10464-10635 | `showView`, `homeReads`, `bootHomeReads`, `workspaceSystemCard`, `savedPagesCard`, `showHome`, `appendWorkspaceDetails`, `ROLE_LABELS`, `currentWsName`, `RECENT_KEY`, `RECENT_KEEP`, `readRecents`, `noteRecent`, `noteEntityRecent`, `marked`, `wireSearchButton`, `openPalette`, `relationTargets` |
| 10636-10835 | `linkSearch`, `gestures`, `GESTURE_CAP`, `UNDO_WINDOW`, `CLAIM_CAP`, `UNDO_REFUSED`, `keptLine`, `undoToast`, `undoKey`, `pendingClaims`, `looseIds`, `ENTITY_UNDO`, `BULK_UNDO`, `undoEntriesOf`, `newGesture`, `noteWrite`, `pinClaims`, `claimOwn`, `undoQueue`, `undoOwn`, `stepBackOwn`, `unlinkWithUndo`, `undoGesture`, `refreshView`, `focusGridRow` |
| 10836-11015 | `KEY_SHEET_ANYWHERE`, `KEY_SHEET_TABLE`, `openKeySheet`, `LOADER_CYCLE_MS`, `LOADER_SHOW_AFTER_MS`, `LOADER_POSE_FROM`, `LOADER_POSE_TO`, `LOADER_EXIT_RATE`, `LOADER_HOLD_MS`, `LOADER_FADE_MS`, `SKELETON_SHOW_AFTER_MS`, `LOADER_CAPTION_AFTER_MS`, `LOADER_RETRY_AFTER_MS`, `LOADER_CAPTION_TEXT`, `LOADER_RETRY_LABEL`, `loading`, `initPageLoader`, `showPageLoader`, `paintLoaderWait`, `paintLoaderRetry`, `clearLoaderWait`, `hidePageLoader`, `stillLoader`, `ropeAnimations`, `settleLoader`, `keepLoader` |
| 11016-11197 | `withPageLoader`, `gridWait`, `gridHold`, `markGridWait`, `paintGridWait`, `gridLoaderNode`, `placeGridLoader`, `showGridLoader`, `hideGridLoader`, `resetGridWait`, `paintSkeleton`, `skeleton`, `scheduleSkeleton`, `cancelSkeleton`, `syncDocTitle`, `renderRoute`, `rememberRoute`, `navDraw`, `navOwns` |
| 11198-11330 | `dispatchRoute`, `paintRouteError`, `renderRouteSafely`, `installPhoneBar`, `NEW_ROW_CHOICES`, `NEW_ROW_OPTIONS`, `rowNoun`, `sheetGrip` |
| 11331-11483 | `newRowTray`, `syncPhoneBar`, `ensureNavMenu`, `route`, `redock` |
| 11484-11648 | `buildWsRail`, `servesBareRoot`, `bareRootWs`, `wsHref`, `wsApiPrefix`, `wsApi`, `wsLogoButton`, `uploadWorkspaceLogo`, `removeWorkspaceLogo`, `wireWsNew`, `narrowShell`, `tightShell`, `navPeekDwell`, `closeNavPeek`, `showNavCollapsed`, `setNavCollapsed` |
| 11649-11848 | `wireNavCollapse`, `NAV_WIDTH`, `wireNavResize`, `NAV_KEY_OWNERS`, `wireNavHold`, `labelNavMenu`, `navMenuButton` |
| 11849-11985 | `wireSkipLink`, `THEME_ICONS`, `THEME_LABELS`, `THEME_MEDIA`, `themePref`, `applyTheme`, `cycleTheme`, `wireTheme`, `syncSchema`, `bugGlyph`, `bugRecorder`, `bugDraft`, `installBugReporter`, `bugTrigger`, `closeBugPanel` |
| 11986-12115 | `openBugPanel` |

## src/engine.js

| Lines | Declares |
| --- | --- |
| 1-183 | `iconValue`, `Term`, `ListCore`, `ViewPane`, `BoardCore`, `LAYOUTS`, `PhoneRow`, `SYSTEM_TERMS`, `CSV_FORMULA_START`, `unquoteCSVCell`, `parseCSV`, `VALUES_BLOCK`, `FILES_BLOCK`, `REFERENCE_PANELS`, `isFixedBlock`, `BLOB_ID`, `isBodyBlock`, `VALUE_TYPES`, `isFileField`, `AVATAR_SHAPES`, `AVATAR_IMAGE_TYPES`, `SEARCHED_VALUE_TYPES`, `REGISTRY_HITS`, `LOCKED_NAME`, `UPGRADE_FLOOR`, `refuseBeforeFloor`, `RESERVED_NAMES`, `own`, `PASTED_ENTITY`, `pastedEntityId`, `byPosition`, `checkPosition`, `SYSTEM_SPACE_NAME`, `SYSTEM_SPACE_ICON`, `LEGACY_SYSTEM_SPACE_NAME`, `answersLegacySystem`, `refuseReserved`, `sniffImage`, `fileBlobIds`, `PREVIEW_MAX_BYTES`, `FILE_MAX_BYTES`, `mbText`, `PREVIEW_TYPES`, `logoType`, `LOCAL_RANGES`, `localAddress`, `webhookRefusal`, `INLINE_FILE_TYPES`, `HTML_VIEW_POLICY`, `HTML_PAGE_POLICY`, `sandboxedHtmlHeaders`, `HTML_FILE_TYPES`, `FILE_STORAGE_CAP`, `isHtmlFile`, `FRAME_HEIGHT_SCRIPT`, `FRAME_LINK_BASE`, `frameLinkBase`, `scriptJson` |
| 184-383 | `frameStorageScript`, `LEADING_DOCTYPE`, `viewHtml`, `fileHeaders`, `ATTACHMENT_PREVIEWS`, `ATTACHMENT_SIZES`, `ATTACHMENT_FITS`, `ATTACHMENT_LOOK_KEYS`, `isBoolType`, `COMPUTED_TYPES`, `DERIVED_CACHE_CAP`, `STATE_CATEGORIES`, `DEFAULT_WORKFLOW_STATES`, `SYSTEM_SORT_KEYS`, `TEXT_OPS`, `VIEW_SHAPES`, `QUERY_SHAPES`, `pageNumber`, `describeValue`, `checkWhereNode`, `checkQueryDocs`, `leanRow`, `DESCRIPTION_SIZES`, `DESCRIPTION_CHARS`, `ACTIVITY_CAP`, `ACTIVITY_PAGE`, `ACCOUNT_ACTOR`, `accountActor`, `REMOVED_ACCOUNT`, `FIELD_CONFIG_ACTIONS`, `SCHEMA_AUDIT_ACTIONS`, `UNTAGGED_SCHEMA_ACTIONS`, `ONTOLOGY_TYPES`, `ONTOLOGY_LEGEND`, `ontologyEtag`, `fieldDefinition`, `canonicalJSON`, `definitionChanges`, `VIEW_AUTO_SEGMENTS`, `VIEW_DEFAULTS`, `VIEW_NAMES`, `VIEW_EXCLUDED_TYPES`, `plainLines`, `GRID_SYSTEM_COLUMNS`, `RETIRED_SYSTEM_FIELD`, `withoutRetired`, `sysColumnId`, `sysColumnName`, `viewEntryName`, `placeField`, `showBySchema`, `clip`, `DYNAMIC_DATE_DEFAULTS`, `DOCUMENT_KINDS`, `CREDENTIAL_KINDS` |
| 384-577 | `KEYSTORES`, `DEFAULT_PAIR_PARTS`, `NUMBER_COSTUME_KEYS`, `ROLLUP_COSTUME_KEYS`, `NUMBER_DISPLAYS`, `isGraphicDisplay`, `CELL_COLORS`, `cellColorValue`, `SPARKLINE_STYLES`, `lastNumber`, `RATING_MAX`, `RATING_DEFAULTS`, `RATING_SCALE_AGGS`, `ratingValue`, `DATE_COSTUME_KEYS`, `FORMULA_COSTUME_KEYS`, `DG`, `DEFAULTABLE_TYPES`, `FIELD_TYPES`, `DOC_REVISION_WINDOW_MS`, `docFingerprint`, `docChange`, `RETIRED_STATE_CATEGORIES`, `WORKFLOW_STATES`, `workflowActor`, `actorWorkflow`, `HOME_RUNS`, `HOME_RUN_ROWS`, `templated`, `scheduleOut`, `listenerOut`, `HOOK_PARTS`, `compileHook`, `hookOut`, `triggerOut`, `LISTENER_ACTIONS`, `HOOK_RECORD_ACTIONS`, `ACTION_TEXT_MAX`, `boundedText`, `workflowScript`, `WORKFLOW_PANEL`, `whenWords`, `actionWords`, `urlHost`, `HTTP_STEP_BODY_MAX`, `itemRow`, `hookPathOf`, `OUTBOUND`, `CREDENTIAL_HEADERS`, `blankTemplates`, `fillJson`, `stepBody`, `thenWords`, `UPSERT_KEY_TYPES`, `blankSource`, `sourcePath`, `HUE_HEX`, `HUES`, `hueName`, `hueOf`, `normaliseOption`, `AGGREGATES`, `MAX_COMPUTE_DEPTH`, `CYCLE_PREFIX`, `isCycle`, `CycleSignal`, `FORMULA_SCAN_CAP`, `RECIPE_KEYS`, `DEFINABLE_TYPES`, `MAX_DEFINITION_DEPTH`, `TYPE_MIGRATIONS` |
| 578-737 | `ONTOLOGY`, `dressNumber`, `dressDate`, `pickCostume`, `putCostume`, `rollupCostume`, `formulaCostume`, `dressDateRange` |
| 738-897 | `numberConfig`, `dateConfig`, `optionName`, `credentialConfig`, `costumeFromDescriptor`, `recipeFromDescriptor`, `numberDescriptor`, `asBoolean`, `asString`, `dateType`, `optionType`, `CREDENTIAL_CONFIG_KEYS` |
| 898-1066 | in `FIELD_TYPE_CONFIG`: `text`, `number`, `formula`, `lookup`, `rollup`, `rating`, `date`, `daterange`, `checkbox`, `toggle`, `url`, `email`, `select`, `multiselect`, `workflow`, `field` |
| 1067-1188 | in `FIELD_TYPE_CONFIG`: `key`, `attachments`, `avatar`, `document`, `view` |
| 1189-1307 | `normalizeSelfContainedConfig`, `normalizeDefinition`, `formatFilters`, `parseFilters`, `formatSort`, `SORT_FORM`, `parseSortPart`, `parseSort`, `MIN_COLUMN_WIDTH`, `VIEW_MIN_WIDTH`, `VIEW_MAX_WIDTH`, `VIEW_DENSITIES`, `formatWidths`, `parseWidths`, `fieldDescriptionValue`, `CREATE_INPUT_KEYS`, `BULK_OPS`, `nowISO`, `schemaFingerprint`, `tableReaders` |
| 1308-1419 | `templateDoc`, `HELD`, `deferMigrations`, `runDeferredMigrations`, `detachHubRegistry` |
| 1420-1610 | `detachedRegistryState`, `inviteUrl`, `USER_COLUMNS`, `USER_KEPT`, `USER_PRIVATE`, `hidesChange`, `capital` |
| 1611-1808 | in `Weave`: `#dirty`, `#dirtyAll`, `#held`, `#detachedStorage`, `#schemaVersion`, `#rows`, `#query`, `#cutoffs`, `#computing`, `constructor`, `#migrate`, `#settlePositions`, `#place`, `#spacesInOrder`, `#tablesOfSpace`, `#reconcileFieldOrder`, `#ensureDescriptionField`, `#repairDoubledInverses`, `#ensureViewFields` |
| 1809-2006 | in `Weave`: `#ensureSystemColumnsInViews`, `#dropRetiredSystemField`, `#ensureStandardViewName`, `#ensureTableViews`, `viewField`, `#normalizeViewConfig`, `#viewSegmentFields`, `#faceOf`, `renderView`, `#viewLine`, `termOf`, `#inverseName`, `#setTerm` |
| 2007-2199 | in `Weave`: `descriptionField`, `save`, `#rolledBack`, `#forgetPending`, `#touching`, `touching`, `affectedBy`, `#mark`, `settleDeferred`, `maybeRefresh`, `schemaVersion`, `spaceMembers`, `setSpaceMember`, `removeSpaceMember`, `#nameHolders`, `#assertNameFree`, `createSpace`, `listSpaces` |
| 2200-2344 | in `Weave`: `findSpace`, `getSpace`, `updateSpace`, `deleteSpace`, `restoreSpace`, `createTable`, `listTables`, `userTables`, `qualifiedName`, `findTable`, `getTable` |
| 2345-2525 | in `Weave`: `updateTable`, `moveTable`, `duplicateTable` |
| 2526-2723 | in `Weave`: `deleteTable`, `restoreTable`, `relationMapMmd`, `createView`, `listViews`, `getView`, `deleteView`, `restoreView`, `resolveView` |
| 2724-2914 | in `Weave`: `shareView`, `unshareView`, `viewByShareToken`, `mintShare`, `listShares`, `revokeShare`, `renewShare`, `updateShare`, `regenerateShare`, `shareByToken`, `tableView`, `#viewTarget`, `#viewIndex`, `#noView`, `#blankFields`, `#viewOut`, `#phoneRowNamed`, `#writePhoneRow`, `#listField`, `#sameGrouping` |
| 2915-3007 | in `Weave`: `#checkGroup`, `#orderRow`, `#writeListKeys`, `#checkViewName` |
| 3008-3202 | in `Weave`: `#writeView`, `#sortOutOfGroup`, `#writeDefaultView`, `#checkFilters`, `viewQuery` |
| 3203-3266 | in `Weave`: `#viewQueryIn`, `#checkSort`, `#defaultViewConfig`, `applySchema`, `#atomically` |
| 3267-3465 | in `Weave` › `#applySchemaPass`: `act`, `configFromDescriptor`, `colorsOf`, `fieldChanged`, `docTable`, `cardinalityOf`, `relationArgs` |
| 3466-3538 | in `Weave` › `#applySchemaPass` |
| 3539-3609 | in `Weave`: `listTemplates`, `useTemplate`, `build`, `#buildCopy` |
| 3610-3799 | in `Weave` › `#buildRun`: `fail`, `step`, `extra`, `isObj`, `cosmetic`, `listAt`, `result`, `target`, `phase`, `relationOf`, `resolves`, `visit` |
| 3800-3854 | in `Weave` › `#buildRun` |
| 3855-4045 | in `Weave`: `#buildOrder`, `#applyTableCostume`, `#bodyOrderFrom`, `#legacyEdits`, `#applyViews`, `workspaceOrder`, `moveWorkspace`, `getWorkspace`, `updateWorkspace`, `#keyStore` |
| 4046-4243 | in `Weave`: `migrateKeys`, `credentialConfig`, `setKey`, `deleteKey`, `hasKey`, `listKeys`, `resolveKey`, `#localKeys`, `#keyInWorkspace`, `#mayReveal`, `revealKey`, `ownsKey`, `#callerAccount`, `#isKeyHolder`, `#mayGrant`, `#grantRefusal`, `grantKey`, `revokeKey`, `#renameKeyHolder`, `credentialLink`, `ROLES`, `ROLE_LABELS`, `OLD_ROLES`, `roleName`, `#audit` |
| 4244-4439 | in `Weave`: `#spacesTouching`, `auditWorkspace`, `listAudit`, `createAccount`, `#createAccount`, `verifyToken`, `listAccounts`, `noteTokenWrite`, `actorName`, `isActor`, `#accountById`, `#actorFor`, `#namedShared`, `#namedDetail`, `#namedActivity`, `#lockedNames`, `deleteAccount`, `onboardedAt`, `markOnboarded`, `agentSeen`, `noteAgent`, `setRequireAuth` |
| 4440-4636 | in `Weave`: `billing`, `startTrial`, `markTrialMail`, `linkBillingOrg`, `SESSION_TTL_MS`, `LAST_SEEN_MS`, `#account`, `#hash`, `createSession`, `verifySession`, `#lastSeenStale`, `removedSession`, `listSessions`, `revokeSession`, `INVITE_TTL_MS`, `#issuer`, `linkIdentity`, `#mintInvite`, `#invite`, `inviteMember`, `listInvites`, `revokeInvite`, `#inviteName` |
| 4637-4819 | in `Weave`: `renameAccount`, `setAccountRole`, `#memberName`, `identityInvite`, `invitesForEmail`, `acceptInvite`, `redeemIdentityInvite`, `#redeem`, `unlinkIdentity`, `accountForIdentity`, `#scrubIdentityEmails`, `#inMetaSync`, `#oneTime`, `inviteIssuer`, `localKeyAccess`, `registryHost`, `members`, `#reg`, `#engines`, `#engineOf`, `#wsIdOfRow`, `#ownerOf`, `#tableAnywhere`, `#fieldAnywhere` |
| 4820-5005 | in `Weave`: `#retireDetachedOrphans`, `detachHubRegistry` |
| 5006-5164 | in `Weave`: `joinRegistry`, `hostRegistry`, `dropWorkspace`, `#syncAll`, `#userRows`, `#syncUsers`, `#userTarget`, `#userValues` |
| 5165-5364 | in `Weave`: `#createUserRow`, `#updateUserRow`, `#setInviteRole`, `#deleteUserRow`, `takeOneTime`, `#syncWorkspaceRow`, `syncRegistry`, `#metaSync`, `#inUndo`, `#undoOwner`, `#undoHeld`, `#recordUndo`, `#undoPending`, `#pushUndo`, `#holdUndo`, `#writersSince`, `#keptSince`, `#undoBefore` |
| 5365-5513 | in `Weave`: `#undoAfter`, `#lastWriter`, `#undoChanged`, `#undoExpected`, `undo`, `listUndo`, `#sysTable`, `#sysRow`, `#relIds`, `#sysField` |
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
| 7725-7895 | in `Weave`: `hidesAnySpace`, `asAccount`, `permalink`, `getEntity`, `findEntity`, `entityName`, `createEntity`, `#claimPublicId`, `#insertEntity`, `updateEntity` |
| 7896-8058 | in `Weave`: `#checkValues`, `#applyValues`, `#holdRows`, `#restoreRows`, `#writeValues`, `#validateDefault`, `now`, `#resolveDefault`, `#coerceDate` |
| 8059-8256 | in `Weave`: `#validateValue`, `#findOption`, `relationTargetDbIds`, `#normalizeRelationInput`, `#setRelationValue`, `#logInverse`, `#relationIds`, `#pluck`, `link`, `unlink` |
| 8257-8454 | in `Weave`: `setState`, `#setStateInternal`, `deleteEntity`, `bulk`, `#bulkRows`, `#portable`, `#moveEntity`, `restoreEntity`, `resolveField` |
| 8455-8651 | in `Weave`: `#resolve`, `#rawName`, `#resolveValue`, `#displayValue` |
| 8652-8834 | in `Weave`: `#lookupRelation`, `#rollupRows`, `#rollupTarget`, `#checkWhere`, `tableRollups`, `tableStats`, `entityRevision` |
| 8835-9030 | in `Weave`: `conditionalWrite`, `#updateAtRevision`, `#adoptRolledBack`, `#inViewerZone`, `readEntity`, `#readEntityIn`, `#numberDisplay`, `#scaleOf`, `#ratingOf`, `#summary`, `#inWorkspace`, `#workflowWsId` |
| 9031-9221 | in `Weave`: `workflowWorkspace`, `query`, `#inQuery`, `#queryIn`, `#groupFieldShape`, `#groupTargets`, `#viewGroups`, `#rollupsOver`, `#matchNode` |
| 9222-9419 | in `Weave`: `#matchCondition`, `#definitionRank`, `#looseEq`, `#storesDate`, `#pathValue`, `getDoc`, `#docText`, `setDoc`, `docBase`, `#setDocAtBase`, `appendDoc`, `#writeDoc`, `#docRevisionFresh`, `#restoring`, `#recordDocRevision`, `listDocRevisions`, `getDocRevision`, `#docRevision`, `restoreDocRevision` |
| 9420-9558 | in `Weave`: `addComment`, `deleteComment`, `activityFeed`, `#activityFeed`, `getActivity`, `spaceHome`, `workspaceHome`, `#homeTables` |
| 9559-9691 | in `Weave`: `#homeRuns`, `#nextSeq`, `#logActivity`, `#stamping`, `#wfQueue`, `#wfEpoch`, `#wfRows`, `#wfRules`, `#noWebhooks`, `#trialHosted`, `webhookTimeoutMs`, `deliveryAttempts`, `createAutomation`, `#asReg` |
| 9692-9886 | in `Weave`: `#compileSpec`, `#compileListener`, `#compileUpsert`, `#compileHttpRequest`, `#checkFits` |
| 9887-10079 | in `Weave`: `#renderSpec`, `#workflowRows`, `#workflowHome`, `#wfField`, `#workflowRule`, `#allRules`, `#settleWorkflows`, `#stampDirty`, `#stamp`, `#setOption`, `#settleWorkflow`, `#stampRun` |
| 10080-10274 | in `Weave`: `#stampPoll`, `#guardWorkflowOn`, `#ruleOut`, `#ruleDiffers`, `#myRules`, `listAutomations`, `describeAutomations`, `#myRow`, `updateAutomation`, `deleteAutomation`, `#migrating`, `#migrateAutomations`, `#runAccess`, `#runRow`, `#saveRun` |
| 10275-10464 | in `Weave`: `startRun`, `updateRun`, `listRuns`, `#mailingRuns`, `runMaintenance`, `#runAutomations`, `#runAutomationsIn`, `#fireRule`, `#pendingRuns`, `automationsSettled`, `#liveRow` |
| 10465-10626 | in `Weave`: `#stepRun`, `#awaitStep`, `#finishRun`, `#inFlight`, `claimInbound`, `isEcho`, `#hookOf`, `#hookWords`, `#hookSecret`, `#hookRule`, `hookDeliveries`, `revealHookSecret`, `#hookRecord`, `receiveHook` |
| 10627-10826 | in `Weave`: `#receiveHook`, `#rememberEcho`, `pendingDeliveries`, `#dropDelivery`, `#deliveryFailed`, `#runSnapshot`, `#deadLetter`, `#letterLanded`, `replayDelivery`, `#updateDeliveryRow` |
| 10827-11008 | in `Weave`: `#reviveRun`, `runDeliveries`, `#scheduleSince`, `runSchedules`, `#polling`, `#pollState`, `#pollBudget`, `#runListeners`, `#poll`, `#pollWords`, `#pollLanded` |
| 11009-11193 | in `Weave`: `#runAction`, `#httpRequest`, `#send`, `#httpLand`, `#upsertSource`, `#upsertRow`, `#signedHeaders` |
| 11194-11393 | in `Weave`: `#template`, `search`, `#searchHits`, `universalSearch`, `#scopedSearch`, `capRows`, `previewFields`, `#stateLabel`, `referencesTo`, `referencesFrom`, `storageStats` |
| 11394-11586 | in `Weave`: `#blobPath`, `#hasBlob`, `#readBlob`, `#dropBlob`, `#stagePath`, `#blobHead`, `filesOnDisk`, `stageBlob`, `streamBlob`, `dropStagedBlob`, `#adoptBlob`, `#writeBlob`, `attachFile`, `attachToField`, `readFileMeta`, `readFile`, `#fileMeta`, `readFileStorage`, `writeFileStorage`, `setWorkspaceLogo` |
| 11587-11778 | in `Weave`: `getWorkspaceLogo`, `deleteWorkspaceLogo`, `deleteFile`, `importCSV`, `#importRows`, `spaceVersions`, `ontology`, `#schemaHistory`, `#ontologyLabel`, `#ontologyFields`, `#ontologyComputed` |
| 11779-11960 | in `Weave`: `#ontologyConcept`, `describeSchema`, `exportJSON`, `#landBlobs`, `#keepSecrets` |
| 11961-12019 | in `Weave`: `importJSON`, `#fileLedger`, `exportCSV` |
