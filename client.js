/**
 * Browser half of the Agent Soul plugin: the Settings page that lists every
 * soul Markdown file, opens one document in a centered resizable dialog for
 * section-by-section editing, and shows the plugin settings plus live runtime
 * state. The same artifact registers a small Session-header badge that reads
 * the Host's durable Orchestrator-mode projection.
 *
 * This file is a classic browser artifact, not a module: it registers a lazy
 * factory with the page module loader and takes React from the browser module
 * table. The Host half (`lib/gui-host.js`) owns the eleven JSON route paths this
 * page calls; they are documented in `docs/GUI-INTERNALS.md`.
 *
 * Plugin-authored UI chrome uses the slot-bound `t` of the
 * `settings.agentSoul` locale namespace; Host diagnostics/messages and file
 * content may be rendered untranslated. The page styles render as one inline
 * `<style>` element inside the component tree, while the compact header badge
 * keeps its styles in an inline object. Both use only the shipped theme's
 * `--dsw-alias-*` / `--dsw-radius-*` custom properties.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-agent-soul',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this page. */
    const NS = 'settings.agentSoul'

    /** Settings section id: a fresh id renders beside the shipped sections. */
    const SECTION_ID = 'agent-soul'

    /**
     * Copy dictionaries; the locale service registers all eight for this
     * plugin. Every dictionary declares the same keys as `en`, and every
     * placeholder ({name}, {count}, {time}, …) survives translation.
     */
    const en = {
      nav: 'Agent Soul',
      title: 'Agent Soul',
      intro: 'Each Agent Soul is one Markdown file: YAML frontmatter for routing and permissions, then prompt sections. Saving writes the file, so the next spawn uses it.',
      newButton: 'New soul',
      refreshButton: 'Refresh',
      refreshBusy: 'Refreshing…',
      scanLine: 'Last scan {time} · {valid} valid · {invalid} invalid',
      scanNever: 'No scan yet · {valid} valid · {invalid} invalid',
      listHeading: 'Souls',
      listCount: '{count}',
      listEmptyTitle: 'No soul files yet',
      listEmptyBody: 'Create one to give a teammate a Markdown-defined persona and permissions.',
      listNoDescription: 'No description',
      listOpen: 'Edit {name}',
      badgeValid: 'Valid',
      badgeInvalid: 'Invalid',
      badgeAllTools: 'All tools',
      badgeNoTools: 'No tools',
      badgeTools: '{count} tools',
      badgeModel: 'Model: {model}',
      badgeContext: 'Context: {context}',
      defaultSoulLabel: 'Default Soul',
      defaultSoulHint: 'Used by spawn_teammate when agent_type is omitted. Every Team child must run a defined Soul.',
      defaultSoulAutoOption: 'Bundled default (generalist)',
      defaultSoulMissingOption: '{name} (not in catalog)',
      badgeDefault: 'Default',
      defaultWarningTitle: 'Default Soul warning',
      defaultWarningBody: '{message}',
      statusDefaultSaved: 'Default Soul set to {name}.',
      statusDefaultCleared: 'Default Soul selection cleared.',
      emptyTitle: 'Nothing selected',
      emptyBody: 'Select a soul from the list, or create a new one.',
      editorHeading: 'Editing {name}',
      dirtyHint: 'Unsaved changes',
      groupIdentity: 'Identity',
      groupRouting: 'Routing & permissions',
      groupMarkdown: 'Markdown sections',
      groupAdvanced: 'Advanced',
      fieldName: 'Name',
      fieldDescription: 'Description',
      fieldTools: 'Tools',
      fieldToolsPlaceholder: 'Comma-separated tool names. * inherits every tool; empty denies all inherited tools.',
      fieldModel: 'Model',
      fieldModelPlaceholder: 'e.g. deepseek-flash (empty inherits)',
      fieldProvider: 'Provider',
      fieldProviderInherit: 'Inherit (empty)',
      fieldReasoning: 'Reasoning effort',
      fieldReasoningPlaceholder: 'e.g. high (empty inherits)',
      fieldContext: 'Context',
      fieldContextAbsent: 'Not specified',
      fieldContextFresh: 'fresh',
      fieldContextFork: 'fork',
      fieldUserInvocable: 'User-invocable',
      fieldUserInvocableHint: 'Also registers this soul as a slash command.',
      fieldExtraFrontmatter: 'Extra frontmatter',
      fieldExtraFrontmatterHint: 'Raw YAML lines for keys this editor does not model. Preserved verbatim.',
      fieldExtraMarkdown: 'Extra markdown',
      fieldExtraMarkdownHint: 'Body content outside the four sections; it becomes the preamble.',
      sectionsHint: 'Each section is its own textarea so one section can be copied and pasted on its own.',
      sectionRole: 'Role Definition',
      sectionInputs: 'Inputs You Will See',
      sectionRules: 'Hard Rules',
      sectionOutput: 'Output Format',
      saveButton: 'Save',
      savingButton: 'Saving…',
      deleteButton: 'Delete',
      deletingButton: 'Deleting…',
      confirmDeleteButton: 'Confirm delete',
      cancelButton: 'Cancel',
      retryButton: 'Retry',
      createButton: 'Create',
      creatingButton: 'Creating…',
      createHeading: 'New soul',
      createName: 'Name',
      createNamePlaceholder: 'lower-kebab-case, e.g. researcher',
      createHint: 'Creates <first soul directory>/<name>.md from the chosen template.',
      createNameRequired: 'Enter a name first.',
      confirmDelete: 'Delete "{name}"? The Markdown file moves to the trash when the Host supports it.',
      errorTitle: 'Could not load the soul catalog',
      errorBody: 'The Host routes for this page did not answer. Check that the plugin is active, then retry.',
      errorDocumentTitle: 'Could not open this soul',
      errorNetwork: 'Network request failed.',
      errorCodeInvalid: 'The document is invalid, so nothing was saved.',
      errorCodeInvalidName: 'That name is not valid. Use lower-kebab-case, at most 64 characters, and not "lead".',
      errorCodeExists: 'A soul with that name already exists.',
      errorCodeNoDirs: 'No soul directory exists yet. Check the plugin configuration.',
      errorCodeNotFound: 'The file no longer exists. Refresh the list.',
      errorCodeUnsafePath: 'That path is outside the configured soul directories.',
      errorCodeInvalidRequest: 'The Host rejected the request as malformed.',
      errorCodeInvalidResponse: 'The Host answered with an unexpected payload. Refresh the page or retry.',
      errorUnknown: 'The request failed ({code}).',
      diagnosticsHeading: 'Diagnostics',
      scanDiagnosticsHeading: 'Scan diagnostics',
      infoHeading: 'Plugin settings & runtime',
      infoPlugin: 'Plugin',
      infoRoot: 'Workspace root',
      infoDirs: 'Soul directories',
      infoDirsEmpty: 'No soul directory resolves for this workspace.',
      pageTitle: 'Use Default Agent Souls',
      pageDescription: 'When on, the packaged default souls and orchestrator doctrine shipped with the plugin are the live definitions and open editable in Settings > Agent Soul. When off, they stay read-only defaults and you customize copies in the workspace.',
      toggleLabel: 'Use default agent souls',
      cardLabel: 'Use default agent souls',
      summary: 'Edit the packaged default souls shipped with the plugin in place instead of copying them.',
      statusOn: 'On - packaged defaults are editable in place',
      statusOff: 'Off - packaged defaults are read-only',
      statusUnavailable: 'Unavailable - bundled defaults are disabled (bundled: false)',
      statusNotConfigurable: 'Unavailable - this profile cannot save this setting',
      statusApplying: 'Applying... the plugin reloads once',
      statusApplied: 'Applied.',
      statusUnverified: 'Saved, but the reload was not confirmed. Reload the page to verify the new value.',
      statusError: 'Could not update the plugin configuration.',
      infoBindings: 'Bindings file',
      infoBindingsCount: '{count} stored bindings',
      infoBindingsUnreadable: 'Count unavailable',
      infoProviders: 'Providers',
      infoProvidersEmpty: 'The Host reports no providers.',
      infoCommandPrefix: 'Command prefix',
      infoCommandPrefixNone: 'none',
      infoDefaultContext: 'Default context',
      infoSpawnProviders: 'Spawn providers',
      infoLimitsLabel: 'Limits',
      infoLimits: 'Up to {definitions} definitions · {chars} prompt characters',
      infoScanTime: 'Last scan',
      infoScanNever: 'never',
      infoLiveTeams: 'Live Team commands',
      infoLiveTeamsEmpty: 'No live Team session reports commands.',
      infoTeamLead: 'Lead {lead}',
      infoDelegation: 'Delegation',
      infoDelegationHint: 'Start a teammate with this soul:',
      infoDelegationExample: 'spawn_teammate({ …, agent_type: "<name>" })',
      infoMarkdownNote: 'Souls are plain Markdown (YAML frontmatter plus body). Save writes the file directly; there is no separate database.',
      statusLoading: 'Loading…',
      statusRefreshed: 'Reloaded from disk.',
      statusSaved: 'Saved. The next spawn uses this soul.',
      statusCreated: 'Created {name}.',
      statusDeleted: 'Deleted {name}.',
      statusSaving: 'Saving…',
      statusDeleting: 'Deleting…',
      statusCreating: 'Creating…',
      statusOpening: 'Opening…',
      searchLabel: 'Search souls',
      searchPlaceholder: 'Search name, description, source path or file name',
      filterLabel: 'Filter souls',
      filterAll: 'All',
      filterUser: 'User-invocable',
      filterAi: 'AI-only',
      filterInvalid: 'Invalid',
      sortLabel: 'Sort souls',
      sortName: 'Name',
      sortUpdated: 'Updated',
      noMatchesTitle: 'No matching souls',
      noMatchesBody: 'Adjust the search or filters and try again.',
      clearFiltersButton: 'Clear filters',
      unsavedGuardTitle: 'Unsaved changes',
      unsavedGuardText: '"{name}" has unsaved changes. Discard them before continuing?',
      discardChangesButton: 'Discard changes',
      keepEditingButton: 'Keep editing',
      draftFoundTitle: 'Recover an unsaved draft',
      draftFoundText: 'A locally saved draft from {time} is newer than the file. Restore it?',
      restoreDraftButton: 'Restore draft',
      discardDraftButton: 'Discard draft',
      conflictTitle: 'The file changed on disk',
      conflictText: 'This file changed before your save ({time}). Reload it, or overwrite it with your edits.',
      reloadFileButton: 'Reload file',
      overwriteButton: 'Overwrite',
      fieldErrorSummary: 'Fix these fields',
      revertButton: 'Revert',
      statusReverted: 'Reverted to the last loaded content.',
      copyButton: 'Copy',
      copiedButton: 'Copied',
      copyFailed: 'Could not copy to the clipboard.',
      emptyDirsHint: 'Souls are the Markdown files in these directories.',
      errorCodeConflict: 'The file changed, so nothing was saved.',
      fieldToolsAdvanced: 'Tools (comma-separated)',
      fieldToolsAdvancedHint: 'The picker and this list stay in sync. * inherits every tool; empty denies all.',
      toolsInheritAll: 'Inherit every tool',
      toolsInheritHint: 'The teammate may use every tool the Lead can share.',
      toolsNoneHint: 'No tools selected: the teammate inherits no tools.',
      toolsCustomHint: 'Click a tool to toggle it. Names missing from the live catalog stay visible so you can remove them.',
      toolsCount: '{count} selected',
      toolsCatalogEmpty: 'The Host reports no live tool catalog, so this picker is empty. Use the advanced list.',
      toolsUnknownHeading: 'Not in the live catalog',
      toolsUnknownHint: 'These names are not offered by the live Lead. Remove them unless you mean them.',
      toolsTeamAlwaysHint: 'Team tools are always available and cannot be restricted; listing them here is harmless and they are skipped by this matrix.',
      toolsRemove: 'Remove {name}',
      toolsToggle: 'Toggle {name}',
      modelInheritOption: 'Inherit from the Lead',
      modelNotInCatalog: '{model} (not in the catalog)',
      modelPickerHint: 'Pick a route from the live catalog; the raw fields under Advanced stay authoritative.',
      modelCatalogEmpty: 'The Host reports no model catalog; edit the raw fields under Advanced.',
      modelResolvedLabel: 'Resolved route',
      modelResolvedInherited: 'Inherited from the Lead',
      advancedModel: 'Model (free text)',
      advancedProvider: 'Provider (free text)',
      advancedHint: 'These fields win over the pickers; leave them empty to inherit.',
      previewHeading: 'What the teammate will receive',
      previewHint: 'No-write preview of the persona, route, tools and prompt-catalog line.',
      previewShow: 'Show preview',
      previewHide: 'Hide preview',
      previewLoading: 'Composing the preview…',
      previewError: 'The preview could not be composed. Editing is unaffected.',
      previewRetry: 'Retry preview',
      previewValid: 'Valid',
      previewInvalid: 'Invalid — fix the diagnostics below.',
      previewPersona: 'Persona',
      previewPersonaHint: 'Composed from Role Definition, Inputs You Will See, Hard Rules and Output Format.',
      previewResolvedModel: 'Resolved model',
      previewCommand: 'Command status',
      previewTools: 'Tool matrix',
      previewToolsInheritAll: 'Inherits every tool',
      previewToolsDenyAll: 'Inherits no tools',
      previewToolUnknown: 'Not in the live catalog',
      previewCatalogLine: 'Prompt-catalog line',
      previewCatalogEmpty: 'No catalog line: the composed soul is invalid.',
      previewComposed: 'Composed Markdown',
      previewComposedShow: 'Show composed Markdown',
      previewComposedHide: 'Hide composed Markdown',
      previewDiagnostics: 'Preview diagnostics',
      copyPersona: 'Copy persona',
      copyCatalogLine: 'Copy catalog line',
      commandStatusRegistered: 'Registered',
      commandStatusAiOnly: 'AI-only',
      commandStatusInvalidName: 'Invalid name',
      commandStatusCollision: 'Command collision',
      commandStatusNoLiveLead: 'No live Lead',
      commandStatusUnknown: 'Unknown status',
      modeLabel: 'Editor mode',
      modeForm: 'Form',
      modeRaw: 'Raw',
      rawHeading: 'Raw Markdown',
      rawHint: 'Edit the complete file text. Saving validates it and reloads the document.',
      statusRawSaved: 'Saved the raw Markdown and reloaded the document.',
      pasteButton: 'Paste Markdown',
      pasteHeading: 'Paste or import Markdown',
      pasteHint: 'Paste a complete soul file. Parsing writes nothing.',
      pasteSourceLabel: 'Markdown source',
      pastePlaceholder: '---\nname: my-teammate\n---\n…',
      parseButton: 'Parse',
      parsingButton: 'Parsing…',
      importButton: 'Import into draft',
      createFromPaste: 'Create soul',
      pasteIntoDraftHint: 'The parsed fields replace the current draft. Nothing is saved until you Save.',
      pasteCreateHint: 'No document is selected: create a new soul from the parsed name and source.',
      pasteEmpty: 'Paste Markdown first.',
      pasteParseFirst: 'Parse the pasted Markdown before importing.',
      pasteMissingName: 'The parsed Markdown has no valid name. Select a document to import into, or fix the paste.',
      statusPasted: 'Imported the pasted Markdown into the draft. Review it, then Save.',
      statusPasteCreated: 'Created {name} from the pasted Markdown.',
      parseHeading: 'Parse result',
      parseValid: 'The pasted Markdown parses as a valid soul.',
      parseInvalid: 'The pasted Markdown has diagnostics.',
      templatesLabel: 'Template',
      templateBlank: 'Blank',
      templateResearcher: 'Researcher',
      templateCodeReviewer: 'Code reviewer',
      templateDocsWriter: 'Docs writer',
      templateHint: 'The template is composed in the browser with this name and sent as the new file.',
      duplicateButton: 'Duplicate',
      duplicateHeading: 'Duplicate this soul',
      duplicateName: 'New name',
      duplicateNamePlaceholder: 'lower-kebab-case, e.g. researcher-copy',
      duplicateSubmit: 'Create copy',
      duplicatingButton: 'Duplicating…',
      duplicateHint: 'Copies the saved file on disk; unsaved edits are not included.',
      statusDuplicated: 'Duplicated as {name}.',
      statusDeletedTrashed: 'Deleted {name}. The file moved to the trash.',
      undoTitle: 'The file is recoverable',
      undoText: '“{name}” was moved to the trash. Restore it now?',
      undoButton: 'Undo delete',
      undoingButton: 'Restoring…',
      undoDismiss: 'Dismiss',
      statusRestored: 'Restored {name}.',
      statusRestoring: 'Restoring…',
      deleteTrashHint: 'Deleting moves the file to a trash folder when the Host supports it, so you can undo.',
      usageSaved: '{count} saved',
      usageLastUsed: 'last used {time}',
      usageNeverUsed: 'never used',
      usageActive: 'in use by {names}',
      commandStatusAria: 'Command status: {status}',
      commandStatusHeading: 'Command',
      commandStatusUnavailable: 'Not reported by the Host',
      catalogLineHeading: 'How the Lead sees it',
      catalogLineUnavailable: 'No catalog line reported yet.',
      healthHeading: 'Runtime health',
      healthHint: 'Catalog-wide budgets and scan findings. Bars turn red past the limit.',
      healthDefinitions: 'Definition budget',
      healthCatalogChars: 'Catalog character budget',
      healthBudgetValue: '{used} of {max} used',
      healthBudgetNoLimit: 'No limit reported · {used} used',
      healthBudgetUnknown: 'Usage not reported',
      healthDuplicatesHeading: 'Duplicate names',
      healthNoDuplicates: 'No duplicate names.',
      healthDuplicateLabel: 'Duplicate name',
      healthInvalidFiles: 'Invalid files',
      healthScanDiagnostics: 'Scan diagnostics',
      healthNoDiagnostics: 'No scan diagnostics.',
      healthNotReported: 'Not reported',
      healthTeamTools: 'Team tool surface',
      diagnosticOpenFile: 'Open {file} in the editor',
      infoLiveTeamMember: '1 member',
      infoLiveTeamMembers: '{count} members',
      infoTeamSpawnNote: 'Edits apply to the next spawn, not to running teammates.',
      closeDialog: 'Close dialog',
      resizeHandle: 'Resize dialog (drag or arrow keys)',
      resetSizeButton: 'Reset size',
      tabSouls: 'Souls',
      tabOrchestrator: 'Orchestrator',
      orchestratorHeading: 'Orchestrator definition',
      orchestratorIntro: 'The Lead’s orchestration doctrine and its model/tool overrides. Sub-agent souls still drive delegation.',
      orchestratorHint: 'Applies after `/orchestrate` in this chat (which also enables Agent Teams); `/orchestrate off` exits and disables Agent Teams. Mode is remembered for the session.',
      orchestratorActivation: 'Chat commands',
      orchestratorCommand: '/orchestrate',
      orchestratorCommandOff: '/orchestrate off',
      orchestratorPath: 'Definition file',
      orchestratorEditButton: 'Edit orchestrator',
      orchestratorCreateButton: 'Create default orchestrator',
      orchestratorCreateHint: 'Composes the six canonical sections and the default configuration, then writes the file.',
      orchestratorDialogHint: 'Saving writes the definition file. It applies the next time `/orchestrate` runs in a chat.',
      orchestratorMissingTitle: 'No orchestrator definition yet',
      orchestratorMissingBody: 'Create the default definition to describe how the Lead plans, delegates, tracks state, verifies work and recovers from failures.',
      orchestratorConfigured: 'Configured',
      badgeBundled: 'Bundled',
      bundledSoulNotice: 'This soul is a bundled default shipped with the plugin. It is read-only here; duplicate it into a workspace soul directory to customize it.',
      orchestratorBundledHint: 'Using the bundled default doctrine shipped with the plugin. Saving writes a workspace-specific definition at the path above; delete that file to fall back to the bundled default.',
      orchestratorUnconfigured: 'Not created',
      orchestratorBadgePlan: 'Plan-first: {value}',
      orchestratorBadgeGate: 'Gate mode: {mode}',
      orchestratorBadgeRetries: 'Max retries: {count}',
      orchestratorBadgePause: 'Pause on fatal: {value}',
      valueOn: 'on',
      valueOff: 'off',
      gateModeStrict: 'strict',
      gateModeAdvisory: 'advisory',
      gateModeOff: 'off',
      groupOrchestratorConfig: 'Orchestrator configuration',
      groupOrchestratorSections: 'Orchestration sections',
      orchestratorConfigHint: 'Routing and safety limits applied at activation. Empty model and provider keep the Lead’s own route.',
      orchestratorSectionsHint: 'Each canonical section is its own textarea. Empty sections are skipped when the mode applies.',
      fieldPlanFirst: 'Plan first',
      fieldPlanFirstHint: 'Ask for a written plan before delegating work.',
      fieldPauseOnFatal: 'Pause on fatal',
      fieldPauseOnFatalHint: 'Stop delegating after an unrecoverable failure instead of retrying.',
      fieldGateMode: 'Gate mode',
      fieldMaxRetries: 'Max retries',
      sectionIdentity: 'Identity & Boundaries',
      sectionPlan: 'Plan Generation',
      sectionDelegation: 'Delegation & Context Minimization',
      sectionState: 'State Tracking',
      sectionVerification: 'Quality Verification',
      sectionRecovery: 'Exception & Recovery',
      statusOrchestratorSaved: 'Orchestrator saved. It applies the next time `/orchestrate` runs in a chat.',
      statusOrchestratorCreated: 'Created the default orchestrator definition.',
      errorOrchestratorTitle: 'Could not load the orchestrator definition',
      orchestratorBadgeLabel: 'Orchestrator mode on',
      orchestratorBadgeTitle: 'Orchestrator mode is on. Run /orchestrate off to exit.',
      orchestratorBadgeAria: 'Orchestrator mode is on. Run /orchestrate off to exit.',
    }

    /** Simplified Chinese copy for the same keys. */
    const zh = {
      nav: 'Agent Soul',
      title: 'Agent Soul',
      intro: '每个 Agent Soul 就是一个 Markdown 文件：YAML frontmatter 定义路由与权限，正文是提示词分段。保存即写入文件，下一次派生队友时生效。',
      newButton: '新建 Soul',
      refreshButton: '刷新',
      refreshBusy: '正在刷新…',
      scanLine: '上次扫描 {time} · {valid} 个有效 · {invalid} 个无效',
      scanNever: '尚未扫描 · {valid} 个有效 · {invalid} 个无效',
      listHeading: 'Soul',
      listCount: '{count}',
      listEmptyTitle: '还没有 Soul 文件',
      listEmptyBody: '新建一个，为队友定义 Markdown 人设与权限。',
      listNoDescription: '没有描述',
      listOpen: '编辑 {name}',
      badgeValid: '有效',
      badgeInvalid: '无效',
      badgeAllTools: '全部工具',
      badgeNoTools: '无工具',
      badgeTools: '{count} 个工具',
      badgeModel: '模型：{model}',
      badgeContext: '上下文：{context}',
      defaultSoulLabel: '默认 Soul',
      defaultSoulHint: '当省略 agent_type 时由 spawn_teammate 使用。每个 Team 子成员都必须运行已定义的 Soul。',
      defaultSoulAutoOption: '内置默认（generalist）',
      defaultSoulMissingOption: '{name}（不在目录中）',
      badgeDefault: '默认',
      defaultWarningTitle: '默认 Soul 警告',
      defaultWarningBody: '{message}',
      statusDefaultSaved: '默认 Soul 已设为 {name}。',
      statusDefaultCleared: '已清除默认 Soul 选择。',
      emptyTitle: '未选中',
      emptyBody: '从左侧列表选择一个 Soul，或新建一个。',
      editorHeading: '正在编辑 {name}',
      dirtyHint: '有未保存的修改',
      groupIdentity: '身份',
      groupRouting: '路由与权限',
      groupMarkdown: 'Markdown 分段',
      groupAdvanced: '高级',
      fieldName: '名称',
      fieldDescription: '描述',
      fieldTools: '工具',
      fieldToolsPlaceholder: '逗号分隔的工具名。* 表示继承全部工具；留空表示不继承任何工具。',
      fieldModel: '模型',
      fieldModelPlaceholder: '例如 deepseek-flash（留空则继承）',
      fieldProvider: '提供方',
      fieldProviderInherit: '继承（留空）',
      fieldReasoning: '推理强度',
      fieldReasoningPlaceholder: '例如 high（留空则继承）',
      fieldContext: '上下文',
      fieldContextAbsent: '未指定',
      fieldContextFresh: 'fresh',
      fieldContextFork: 'fork',
      fieldUserInvocable: '可手动调用',
      fieldUserInvocableHint: '同时把该 Soul 注册为斜杠命令。',
      fieldExtraFrontmatter: '额外 frontmatter',
      fieldExtraFrontmatterHint: '本编辑器不建模的键，按原始 YAML 行保留。',
      fieldExtraMarkdown: '额外 Markdown',
      fieldExtraMarkdownHint: '四个分段之外的正文，会作为前导段落。',
      sectionsHint: '每个分段都是独立的文本框，可以单独复制粘贴某一段。',
      sectionRole: '角色定义',
      sectionInputs: '你将看到的输入',
      sectionRules: '硬性规则',
      sectionOutput: '输出格式',
      saveButton: '保存',
      savingButton: '保存中…',
      deleteButton: '删除',
      deletingButton: '删除中…',
      confirmDeleteButton: '确认删除',
      cancelButton: '取消',
      retryButton: '重试',
      createButton: '创建',
      creatingButton: '创建中…',
      createHeading: '新建 Soul',
      createName: '名称',
      createNamePlaceholder: '小写短横线风格，例如 researcher',
      createHint: '在第一个 Soul 目录中按所选模板创建 <name>.md。',
      createNameRequired: '请先输入名称。',
      confirmDelete: '删除“{name}”？在 Host 支持时，Markdown 文件会被移入回收站。',
      errorTitle: '无法加载 Soul 列表',
      errorBody: '本页需要的 Host 路由没有响应。请确认插件已启用，然后重试。',
      errorDocumentTitle: '无法打开该 Soul',
      errorNetwork: '网络请求失败。',
      errorCodeInvalid: '文档校验未通过，因此没有保存。',
      errorCodeInvalidName: '名称不合法：请使用小写短横线风格、不超过 64 个字符，且不能是 "lead"。',
      errorCodeExists: '同名 Soul 已存在。',
      errorCodeNoDirs: '还没有可用的 Soul 目录，请检查插件配置。',
      errorCodeNotFound: '文件已不存在，请刷新列表。',
      errorCodeUnsafePath: '该路径不在配置的 Soul 目录内。',
      errorCodeInvalidRequest: 'Host 判定请求格式不合法。',
      errorCodeInvalidResponse: 'Host 返回了无法识别的数据，请刷新页面或重试。',
      errorUnknown: '请求失败（{code}）。',
      diagnosticsHeading: '诊断信息',
      scanDiagnosticsHeading: '扫描诊断',
      infoHeading: '插件设置与运行时',
      infoPlugin: '插件',
      infoRoot: '工作区根目录',
      infoDirs: 'Soul 目录',
      infoDirsEmpty: '当前工作区没有解析出 Soul 目录。',
      pageTitle: '使用默认 Agent Souls',
      pageDescription: '开启后，插件自带的默认 soul 与编排章程即为生效定义，可在“设置 > Agent Soul”中直接编辑。关闭后，它们仍是只读默认项，请在 workspace 中自定义副本。',
      toggleLabel: '使用默认 agent souls',
      cardLabel: '使用默认 agent souls',
      summary: '直接就地编辑插件自带的默认 soul，而无需复制。',
      statusOn: '已开启 - 内置默认项可就地编辑',
      statusOff: '已关闭 - 内置默认项为只读',
      statusUnavailable: '不可用 - 内置默认已禁用（bundled: false）',
      statusNotConfigurable: '不可用 - 当前配置无法保存该设置',
      statusApplying: '正在应用…插件将重新加载一次',
      statusApplied: '已应用。',
      statusUnverified: '已保存，但未能确认插件重载。请刷新页面确认新的值。',
      statusError: '无法更新插件配置。',
      infoBindings: '绑定文件',
      infoBindingsCount: '{count} 条已存绑定',
      infoBindingsUnreadable: '数量不可用',
      infoProviders: '提供方',
      infoProvidersEmpty: 'Host 未报告任何提供方。',
      infoCommandPrefix: '命令前缀',
      infoCommandPrefixNone: '无',
      infoDefaultContext: '默认上下文',
      infoSpawnProviders: '派生提供方',
      infoLimitsLabel: '上限',
      infoLimits: '最多 {definitions} 个定义 · {chars} 个提示词字符',
      infoScanTime: '上次扫描',
      infoScanNever: '从未',
      infoLiveTeams: '活动 Team 命令',
      infoLiveTeamsEmpty: '当前没有活动的 Team 会话上报命令。',
      infoTeamLead: 'Lead {lead}',
      infoDelegation: '委托',
      infoDelegationHint: '用该 Soul 派生队友：',
      infoDelegationExample: 'spawn_teammate({ …, agent_type: "<name>" })',
      infoMarkdownNote: 'Soul 就是普通 Markdown（YAML frontmatter 加正文）。保存会直接写文件，没有单独的数据库。',
      statusLoading: '加载中…',
      statusRefreshed: '已从磁盘重新加载。',
      statusSaved: '已保存，下一次派生起使用该 Soul。',
      statusCreated: '已创建 {name}。',
      statusDeleted: '已删除 {name}。',
      statusSaving: '保存中…',
      statusDeleting: '删除中…',
      statusCreating: '创建中…',
      statusOpening: '打开中…',
      searchLabel: '搜索 Soul',
      searchPlaceholder: '按名称、描述、来源路径或文件名搜索',
      filterLabel: '筛选 Soul',
      filterAll: '全部',
      filterUser: '可手动调用',
      filterAi: '仅 AI',
      filterInvalid: '无效',
      sortLabel: '排序 Soul',
      sortName: '名称',
      sortUpdated: '更新时间',
      noMatchesTitle: '没有匹配的 Soul',
      noMatchesBody: '调整搜索或筛选条件后重试。',
      clearFiltersButton: '清除筛选',
      unsavedGuardTitle: '有未保存的修改',
      unsavedGuardText: '“{name}”有未保存的修改。继续前要先丢弃吗？',
      discardChangesButton: '丢弃修改',
      keepEditingButton: '继续编辑',
      draftFoundTitle: '发现未保存的草稿',
      draftFoundText: '本地保存的草稿（{time}）比文件更新。要恢复它吗？',
      restoreDraftButton: '恢复草稿',
      discardDraftButton: '丢弃草稿',
      conflictTitle: '文件已在磁盘上发生变化',
      conflictText: '保存前该文件被其他操作修改过（{time}）。请重新加载，或用当前内容覆盖。',
      reloadFileButton: '重新加载文件',
      overwriteButton: '覆盖保存',
      fieldErrorSummary: '请修正以下字段',
      revertButton: '还原',
      statusReverted: '已还原为上次加载的内容。',
      copyButton: '复制',
      copiedButton: '已复制',
      copyFailed: '无法复制到剪贴板。',
      emptyDirsHint: 'Soul 就是这些目录中的 Markdown 文件。',
      errorCodeConflict: '文件已被修改，因此没有保存。',
      fieldToolsAdvanced: '工具（逗号分隔）',
      fieldToolsAdvancedHint: '选择器与这份列表双向同步。* 表示继承全部工具；留空表示不继承任何工具。',
      toolsInheritAll: '继承全部工具',
      toolsInheritHint: '该队友可以使用 Lead 能共享的全部工具。',
      toolsNoneHint: '未选择任何工具：该队友不继承任何工具。',
      toolsCustomHint: '点击工具即可切换。在线目录中不存在的名称会保留显示，方便你移除。',
      toolsCount: '已选 {count} 个',
      toolsCatalogEmpty: 'Host 未提供在线工具目录，因此选择器为空。请使用高级列表。',
      toolsUnknownHeading: '不在在线目录中',
      toolsUnknownHint: '这些名称不在当前 Lead 提供的目录中。除非确实需要，请移除它们。',
      toolsTeamAlwaysHint: '团队工具始终可用且不可限制；在此列出无影响，限制矩阵会跳过它们。',
      toolsRemove: '移除 {name}',
      toolsToggle: '切换 {name}',
      modelInheritOption: '继承自 Lead',
      modelNotInCatalog: '{model}（不在目录中）',
      modelPickerHint: '从在线目录选择路由；高级中的原始字段仍然是最终依据。',
      modelCatalogEmpty: 'Host 未提供模型目录；请编辑高级中的原始字段。',
      modelResolvedLabel: '解析后的路由',
      modelResolvedInherited: '继承自 Lead',
      advancedModel: '模型（自由文本）',
      advancedProvider: '提供方（自由文本）',
      advancedHint: '这些字段优先于选择器；留空表示继承。',
      previewHeading: '队友将收到的内容',
      previewHint: '不会写入文件的预览：人设、路由、工具与提示词目录行。',
      previewShow: '显示预览',
      previewHide: '隐藏预览',
      previewLoading: '正在生成预览…',
      previewError: '无法生成预览，编辑不受影响。',
      previewRetry: '重试预览',
      previewValid: '有效',
      previewInvalid: '无效——请修正下面的诊断。',
      previewPersona: '人设',
      previewPersonaHint: '按角色定义、你将看到的输入、硬性规则、输出格式的顺序组合。',
      previewResolvedModel: '解析后的模型',
      previewCommand: '命令状态',
      previewTools: '工具矩阵',
      previewToolsInheritAll: '继承全部工具',
      previewToolsDenyAll: '不继承任何工具',
      previewToolUnknown: '不在在线目录中',
      previewCatalogLine: '提示词目录行',
      previewCatalogEmpty: '没有目录行：组合后的 Soul 无效。',
      previewComposed: '组合后的 Markdown',
      previewComposedShow: '显示组合后的 Markdown',
      previewComposedHide: '隐藏组合后的 Markdown',
      previewDiagnostics: '预览诊断',
      copyPersona: '复制人设',
      copyCatalogLine: '复制目录行',
      commandStatusRegistered: '已注册',
      commandStatusAiOnly: '仅 AI',
      commandStatusInvalidName: '名称无效',
      commandStatusCollision: '命令冲突',
      commandStatusNoLiveLead: '没有活动 Lead',
      commandStatusUnknown: '未知状态',
      modeLabel: '编辑模式',
      modeForm: '表单',
      modeRaw: '原始',
      rawHeading: '原始 Markdown',
      rawHint: '编辑完整文件文本。保存时会先校验，然后重新加载文档。',
      statusRawSaved: '已保存原始 Markdown 并重新加载文档。',
      pasteButton: '粘贴 Markdown',
      pasteHeading: '粘贴或导入 Markdown',
      pasteHint: '粘贴完整的 Soul 文件。解析不会写入任何内容。',
      pasteSourceLabel: 'Markdown 源文本',
      pastePlaceholder: '---\nname: my-teammate\n---\n…',
      parseButton: '解析',
      parsingButton: '正在解析…',
      importButton: '导入到草稿',
      createFromPaste: '创建 Soul',
      pasteIntoDraftHint: '解析出的字段会替换当前草稿；在你保存之前不会写入文件。',
      pasteCreateHint: '当前未选中文档：将按解析出的名称与源文本创建新的 Soul。',
      pasteEmpty: '请先粘贴 Markdown。',
      pasteParseFirst: '请先解析粘贴的 Markdown。',
      pasteMissingName: '解析出的 Markdown 没有有效名称。请选择要导入的文档，或修正粘贴内容。',
      statusPasted: '已将粘贴的 Markdown 导入草稿。检查后保存。',
      statusPasteCreated: '已根据粘贴的 Markdown 创建 {name}。',
      parseHeading: '解析结果',
      parseValid: '粘贴的 Markdown 解析为有效的 Soul。',
      parseInvalid: '粘贴的 Markdown 存在诊断信息。',
      templatesLabel: '模板',
      templateBlank: '空白',
      templateResearcher: '研究员',
      templateCodeReviewer: '代码审查员',
      templateDocsWriter: '文档撰写员',
      templateHint: '模板会在浏览器中按此名称组合，并作为新文件发送。',
      duplicateButton: '复制一份',
      duplicateHeading: '复制此 Soul',
      duplicateName: '新名称',
      duplicateNamePlaceholder: '小写短横线风格，例如 researcher-copy',
      duplicateSubmit: '创建副本',
      duplicatingButton: '正在复制…',
      duplicateHint: '复制磁盘上已保存的文件；未保存的修改不会包含在内。',
      statusDuplicated: '已复制为 {name}。',
      statusDeletedTrashed: '已删除 {name}。文件已移入回收站。',
      undoTitle: '文件可以恢复',
      undoText: '“{name}”已被移入回收站。要现在恢复吗？',
      undoButton: '撤销删除',
      undoingButton: '正在恢复…',
      undoDismiss: '忽略',
      statusRestored: '已恢复 {name}。',
      statusRestoring: '正在恢复…',
      deleteTrashHint: '删除时（在 Host 支持的情况下）会把文件移入回收站，因此可以撤销。',
      usageSaved: '已保存 {count} 条',
      usageLastUsed: '上次使用 {time}',
      usageNeverUsed: '从未使用',
      usageActive: '正在被 {names} 使用',
      commandStatusAria: '命令状态：{status}',
      commandStatusHeading: '命令',
      commandStatusUnavailable: 'Host 未报告',
      catalogLineHeading: 'Lead 看到的样子',
      catalogLineUnavailable: '尚未报告目录行。',
      healthHeading: '运行时健康',
      healthHint: '整个目录的配额与扫描结果。超出限额时进度条会变红。',
      healthDefinitions: '定义配额',
      healthCatalogChars: '目录字符配额',
      healthBudgetValue: '已用 {used} / {max}',
      healthBudgetNoLimit: '未报告限额 · 已用 {used}',
      healthBudgetUnknown: '未报告使用量',
      healthDuplicatesHeading: '重名',
      healthNoDuplicates: '没有重名。',
      healthDuplicateLabel: '重名',
      healthInvalidFiles: '无效文件',
      healthScanDiagnostics: '扫描诊断',
      healthNoDiagnostics: '没有扫描诊断。',
      healthNotReported: '未报告',
      healthTeamTools: 'Team 工具表面',
      diagnosticOpenFile: '在编辑器中打开 {file}',
      infoLiveTeamMember: '1 名成员',
      infoLiveTeamMembers: '{count} 名成员',
      infoTeamSpawnNote: '修改只影响下一次派生，不会影响正在运行的队友。',
      closeDialog: '关闭对话框',
      resizeHandle: '调整对话框大小（拖拽或方向键）',
      resetSizeButton: '重置大小',
      tabSouls: 'Soul',
      tabOrchestrator: '编排器',
      orchestratorHeading: '编排器定义',
      orchestratorIntro: 'Lead 的编排策略及其模型/工具覆盖。子 Agent Soul 仍然负责委托。',
      orchestratorHint: '在此对话中执行 `/orchestrate` 后生效（同时启用 Agent Teams）；`/orchestrate off` 退出并禁用 Agent Teams。模式按会话记忆。',
      orchestratorActivation: '聊天命令',
      orchestratorCommand: '/orchestrate',
      orchestratorCommandOff: '/orchestrate off',
      orchestratorPath: '定义文件',
      orchestratorEditButton: '编辑编排器',
      orchestratorCreateButton: '创建默认编排器',
      orchestratorCreateHint: '在浏览器中组合六个规范分段与默认配置，然后写入文件。',
      orchestratorDialogHint: '保存会写入定义文件；下次在对话中执行 `/orchestrate` 时生效。',
      orchestratorMissingTitle: '还没有编排器定义',
      orchestratorMissingBody: '创建默认定义来描述 Lead 如何规划、委托、跟踪状态、验证工作并从失败中恢复。',
      orchestratorConfigured: '已配置',
      badgeBundled: '内置',
      bundledSoulNotice: '此 soul 是插件自带的内置默认项，在此处为只读；请将其复制到工作区的 soul 目录后再自定义。',
      orchestratorBundledHint: '正在使用插件自带的默认编排章程。保存会在上方路径写入当前工作区的专属定义；删除该文件即可恢复内置默认。',
      orchestratorUnconfigured: '未创建',
      orchestratorBadgePlan: '先规划：{value}',
      orchestratorBadgeGate: '把关模式：{mode}',
      orchestratorBadgeRetries: '最大重试：{count}',
      orchestratorBadgePause: '致命错误暂停：{value}',
      valueOn: '开',
      valueOff: '关',
      gateModeStrict: '严格',
      gateModeAdvisory: '建议',
      gateModeOff: '关闭',
      groupOrchestratorConfig: '编排器配置',
      groupOrchestratorSections: '编排分段',
      orchestratorConfigHint: '激活时应用的路由与安全限制。模型和提供方留空时沿用 Lead 自身的路由。',
      orchestratorSectionsHint: '每个规范分段都是独立文本框；模式生效时会跳过空分段。',
      fieldPlanFirst: '先制定计划',
      fieldPlanFirstHint: '委托工作前先要求写出计划。',
      fieldPauseOnFatal: '致命错误时暂停',
      fieldPauseOnFatalHint: '遇到不可恢复的失败时停止委托，而不是继续重试。',
      fieldGateMode: '把关模式',
      fieldMaxRetries: '最大重试次数',
      sectionIdentity: '身份与边界',
      sectionPlan: '计划生成',
      sectionDelegation: '委托与上下文最小化',
      sectionState: '状态跟踪',
      sectionVerification: '质量验证',
      sectionRecovery: '异常与恢复',
      statusOrchestratorSaved: '编排器已保存。下次在对话中执行 `/orchestrate` 时生效。',
      statusOrchestratorCreated: '已创建默认编排器定义。',
      errorOrchestratorTitle: '无法加载编排器定义',
      orchestratorBadgeLabel: '编排器模式已开启',
      orchestratorBadgeTitle: '编排器模式已开启。运行 /orchestrate off 可退出。',
      orchestratorBadgeAria: '编排器模式已开启。运行 /orchestrate off 可退出。',
    }

    /** Japanese copy (日本語) for the same keys. */
    const ja = {
      nav: 'Agent Soul',
      title: 'Agent Soul',
      intro: '各Agent Soul は 1 つの Markdown ファイルです。YAML frontmatter がルーティングと権限を定義し、その後にプロンプトのセクションが続きます。保存するとファイルに書き込まれ、次回のスポーンで使われます。',
      newButton: '新規 Soul',
      refreshButton: '更新',
      refreshBusy: '更新中…',
      scanLine: '最終スキャン {time} · 有効 {valid} · 無効 {invalid}',
      scanNever: '未スキャン · 有効 {valid} · 無効 {invalid}',
      listHeading: 'Soul',
      listCount: '{count}',
      listEmptyTitle: 'Soul ファイルはまだありません',
      listEmptyBody: '作成すると、Markdown で定義したペルソナと権限をチームメイトに与えられます。',
      listNoDescription: '説明なし',
      listOpen: '{name} を編集',
      badgeValid: '有効',
      badgeInvalid: '無効',
      badgeAllTools: '全ツール',
      badgeNoTools: 'ツールなし',
      badgeTools: 'ツール {count} 個',
      badgeModel: 'モデル: {model}',
      badgeContext: 'コンテキスト: {context}',
      defaultSoulLabel: 'デフォルトSoul',
      defaultSoulHint: 'agent_type を省略したときに spawn_teammate が使用します。すべての Team 子メンバーは定義済み Soul で実行されます。',
      defaultSoulAutoOption: '同梱のデフォルト（generalist）',
      defaultSoulMissingOption: '{name}（カタログにありません）',
      badgeDefault: 'デフォルト',
      defaultWarningTitle: 'デフォルトSoulの警告',
      defaultWarningBody: '{message}',
      statusDefaultSaved: 'デフォルトSoulを {name} に設定しました。',
      statusDefaultCleared: 'デフォルトSoulの選択を解除しました。',
      emptyTitle: '未選択',
      emptyBody: '一覧から Soul を選ぶか、新規作成してください。',
      editorHeading: '{name} を編集中',
      dirtyHint: '未保存の変更',
      groupIdentity: '基本情報',
      groupRouting: 'ルーティングと権限',
      groupMarkdown: 'Markdown セクション',
      groupAdvanced: '詳細',
      fieldName: '名前',
      fieldDescription: '説明',
      fieldTools: 'ツール',
      fieldToolsPlaceholder: 'ツール名をカンマ区切りで指定します。* は全ツールを継承し、空欄は継承したツールをすべて拒否します。',
      fieldModel: 'モデル',
      fieldModelPlaceholder: '例: deepseek-flash（空欄は継承）',
      fieldProvider: 'プロバイダー',
      fieldProviderInherit: '継承（空欄）',
      fieldReasoning: '推論の強度',
      fieldReasoningPlaceholder: '例: high（空欄は継承）',
      fieldContext: 'コンテキスト',
      fieldContextAbsent: '未指定',
      fieldContextFresh: 'fresh',
      fieldContextFork: 'fork',
      fieldUserInvocable: '手動呼び出し',
      fieldUserInvocableHint: 'この Soul をスラッシュコマンドとしても登録します。',
      fieldExtraFrontmatter: '追加の frontmatter',
      fieldExtraFrontmatterHint: 'このエディターが扱わないキーの生の YAML 行です。そのまま保持されます。',
      fieldExtraMarkdown: '追加の Markdown',
      fieldExtraMarkdownHint: '4 つのセクション外の本文で、前書きになります。',
      sectionsHint: '各セクションは独立したテキストエリアなので、個別にコピー＆ペーストできます。',
      sectionRole: 'ロール定義',
      sectionInputs: '受け取る入力',
      sectionRules: '厳格なルール',
      sectionOutput: '出力形式',
      saveButton: '保存',
      savingButton: '保存中…',
      deleteButton: '削除',
      deletingButton: '削除中…',
      confirmDeleteButton: '削除を確定',
      cancelButton: 'キャンセル',
      retryButton: '再試行',
      createButton: '作成',
      creatingButton: '作成中…',
      createHeading: '新規 Soul',
      createName: '名前',
      createNamePlaceholder: 'lower-kebab-case、例: researcher',
      createHint: '選択したテンプレートから <first soul directory>/<name>.md を作成します。',
      createNameRequired: '先に名前を入力してください。',
      confirmDelete: '「{name}」を削除しますか？Host が対応している場合、Markdown ファイルはゴミ箱に移動します。',
      errorTitle: 'Soul カタログを読み込めませんでした',
      errorBody: 'このページの Host ルートが応答しませんでした。プラグインが有効か確認して再試行してください。',
      errorDocumentTitle: 'この Soul を開けませんでした',
      errorNetwork: 'ネットワーク リクエストに失敗しました。',
      errorCodeInvalid: 'ドキュメントが無効なため、保存されませんでした。',
      errorCodeInvalidName: 'その名前は無効です。lower-kebab-case で 64 文字以内、「lead」以外にしてください。',
      errorCodeExists: '同じ名前の Soul がすでに存在します。',
      errorCodeNoDirs: 'Soul ディレクトリがまだありません。プラグイン設定を確認してください。',
      errorCodeNotFound: 'ファイルはすでに存在しません。一覧を更新してください。',
      errorCodeUnsafePath: 'そのパスは設定された Soul ディレクトリの外です。',
      errorCodeInvalidRequest: 'Host がリクエストを不正として拒否しました。',
      errorCodeInvalidResponse: 'Host が想定外の応答を返しました。ページを更新するか再試行してください。',
      errorUnknown: 'リクエストに失敗しました（{code}）。',
      diagnosticsHeading: '診断',
      scanDiagnosticsHeading: 'スキャン診断',
      infoHeading: 'プラグイン設定とランタイム',
      infoPlugin: 'プラグイン',
      infoRoot: 'ワークスペースのルート',
      infoDirs: 'Soul ディレクトリ',
      infoDirsEmpty: 'このワークスペースで解決される Soul ディレクトリはありません。',
      pageTitle: '既定の Agent Souls を使用',
      pageDescription: 'オンにすると、プラグイン同梱の既定のソウルとオーケストレーターのドクトリンが有効な定義となり、「設定 > Agent Soul」でそのまま編集できます。オフにすると読み取り専用の既定値となり、ワークスペースにコピーを作ってカスタマイズします。',
      toggleLabel: '既定の agent souls を使用',
      cardLabel: '既定の agent souls を使用',
      summary: '同梱の既定のソウルをコピーせずにその場で編集します。',
      statusOn: 'オン - 同梱の既定値をその場で編集できます',
      statusOff: 'オフ - 同梱の既定値は読み取り専用です',
      statusUnavailable: '利用不可 - 同梱の既定値が無効です（bundled: false）',
      statusNotConfigurable: '利用不可 - この構成ではこの設定を保存できません',
      statusApplying: '適用中…プラグインは一度再読み込みされます',
      statusApplied: '適用しました。',
      statusUnverified: '保存しましたが、再読み込みを確認できませんでした。ページを更新して新しい値を確認してください。',
      statusError: 'プラグインの構成を更新できませんでした。',
      infoBindings: 'バインディング ファイル',
      infoBindingsCount: '保存済みバインディング {count} 件',
      infoBindingsUnreadable: '件数を取得できません',
      infoProviders: 'プロバイダー',
      infoProvidersEmpty: 'Host はプロバイダーを報告していません。',
      infoCommandPrefix: 'コマンド プレフィックス',
      infoCommandPrefixNone: 'なし',
      infoDefaultContext: '既定のコンテキスト',
      infoSpawnProviders: 'スポーン プロバイダー',
      infoLimitsLabel: '上限',
      infoLimits: '最大 {definitions} 定義 · {chars} プロンプト文字',
      infoScanTime: '最終スキャン',
      infoScanNever: 'なし',
      infoLiveTeams: 'アクティブな Team コマンド',
      infoLiveTeamsEmpty: 'コマンドを報告しているアクティブな Team セッションはありません。',
      infoTeamLead: 'Lead {lead}',
      infoDelegation: '委任',
      infoDelegationHint: 'この Soul でチームメイトを起動:',
      infoDelegationExample: 'spawn_teammate({ …, agent_type: "<name>" })',
      infoMarkdownNote: 'Soul はプレーンな Markdown（YAML frontmatter と本文）です。保存はファイルに直接書き込み、別のデータベースはありません。',
      statusLoading: '読み込み中…',
      statusRefreshed: 'ディスクから再読み込みしました。',
      statusSaved: '保存しました。次回のスポーンでこの Soul が使われます。',
      statusCreated: '{name} を作成しました。',
      statusDeleted: '{name} を削除しました。',
      statusSaving: '保存中…',
      statusDeleting: '削除中…',
      statusCreating: '作成中…',
      statusOpening: '開いています…',
      searchLabel: 'Soul を検索',
      searchPlaceholder: '名前、説明、ソースパス、ファイル名を検索',
      filterLabel: 'Soul を絞り込む',
      filterAll: 'すべて',
      filterUser: '手動呼び出し可',
      filterAi: 'AI のみ',
      filterInvalid: '無効',
      sortLabel: 'Soul を並べ替え',
      sortName: '名前',
      sortUpdated: '更新日時',
      noMatchesTitle: '一致する Soul がありません',
      noMatchesBody: '検索語またはフィルターを変更して再試行してください。',
      clearFiltersButton: 'フィルターを解除',
      unsavedGuardTitle: '未保存の変更',
      unsavedGuardText: '「{name}」に未保存の変更があります。続行する前に破棄しますか？',
      discardChangesButton: '変更を破棄',
      keepEditingButton: '編集を続ける',
      draftFoundTitle: '未保存の下書きを復元',
      draftFoundText: '{time} にローカル保存された下書きがファイルより新しいです。復元しますか？',
      restoreDraftButton: '下書きを復元',
      discardDraftButton: '下書きを破棄',
      conflictTitle: 'ファイルがディスク上で変更されました',
      conflictText: '保存前にこのファイルが変更されました（{time}）。再読み込みするか、変更内容で上書きしてください。',
      reloadFileButton: 'ファイルを再読み込み',
      overwriteButton: '上書き',
      fieldErrorSummary: '次のフィールドを修正してください',
      revertButton: '元に戻す',
      statusReverted: '最後に読み込んだ内容に戻しました。',
      copyButton: 'コピー',
      copiedButton: 'コピーしました',
      copyFailed: 'クリップボードにコピーできませんでした。',
      emptyDirsHint: 'Soul はこれらのディレクトリにある Markdown ファイルです。',
      errorCodeConflict: 'ファイルが変更されたため、保存されませんでした。',
      fieldToolsAdvanced: 'ツール（カンマ区切り）',
      fieldToolsAdvancedHint: '選択画面とこの一覧は同期します。* は全ツールを継承し、空欄はすべて拒否します。',
      toolsInheritAll: '全ツールを継承',
      toolsInheritHint: 'チームメイトは Lead が共有できるすべてのツールを使えます。',
      toolsNoneHint: 'ツール未選択: チームメイトはツールを継承しません。',
      toolsCustomHint: 'ツールをクリックして切り替えます。ライブ カタログにない名前も、削除できるように表示されます。',
      toolsCount: '{count} 個選択中',
      toolsCatalogEmpty: 'Host がライブ ツール カタログを報告していないため、この選択画面は空です。詳細の一覧を使ってください。',
      toolsUnknownHeading: 'ライブ カタログにない名前',
      toolsUnknownHint: 'アクティブな Lead が提供していない名前です。意図がない限り削除してください。',
      toolsTeamAlwaysHint: 'チームツールは常に利用可能で制限できません。ここに列挙しても問題なく、このマトリックスではスキップされます。',
      toolsRemove: '{name} を削除',
      toolsToggle: '{name} を切り替え',
      modelInheritOption: 'Lead から継承',
      modelNotInCatalog: '{model}（カタログにありません）',
      modelPickerHint: 'ライブ カタログからルートを選択します。詳細の生フィールドが優先されます。',
      modelCatalogEmpty: 'Host がモデル カタログを報告していません。詳細の生フィールドを編集してください。',
      modelResolvedLabel: '解決済みルート',
      modelResolvedInherited: 'Lead から継承',
      advancedModel: 'モデル（自由入力）',
      advancedProvider: 'プロバイダー（自由入力）',
      advancedHint: 'これらのフィールドは選択画面より優先されます。継承するには空欄にしてください。',
      previewHeading: 'チームメイトが受け取る内容',
      previewHint: 'ペルソナ、ルート、ツール、プロンプト カタログ行を書き込まずにプレビューします。',
      previewShow: 'プレビューを表示',
      previewHide: 'プレビューを隠す',
      previewLoading: 'プレビューを構成中…',
      previewError: 'プレビューを構成できませんでした。編集には影響しません。',
      previewRetry: 'プレビューを再試行',
      previewValid: '有効',
      previewInvalid: '無効 — 下の診断を修正してください。',
      previewPersona: 'ペルソナ',
      previewPersonaHint: 'ロール定義、受け取る入力、厳格なルール、出力形式から構成されます。',
      previewResolvedModel: '解決済みモデル',
      previewCommand: 'コマンド ステータス',
      previewTools: 'ツール マトリクス',
      previewToolsInheritAll: '全ツールを継承',
      previewToolsDenyAll: 'ツールを継承しない',
      previewToolUnknown: 'ライブ カタログにありません',
      previewCatalogLine: 'プロンプト カタログ行',
      previewCatalogEmpty: 'カタログ行がありません: 構成された Soul が無効です。',
      previewComposed: '構成済み Markdown',
      previewComposedShow: '構成済み Markdown を表示',
      previewComposedHide: '構成済み Markdown を隠す',
      previewDiagnostics: 'プレビュー診断',
      copyPersona: 'ペルソナをコピー',
      copyCatalogLine: 'カタログ行をコピー',
      commandStatusRegistered: '登録済み',
      commandStatusAiOnly: 'AI のみ',
      commandStatusInvalidName: '無効な名前',
      commandStatusCollision: 'コマンド衝突',
      commandStatusNoLiveLead: 'アクティブな Lead なし',
      commandStatusUnknown: '不明なステータス',
      modeLabel: 'エディター モード',
      modeForm: 'フォーム',
      modeRaw: '生テキスト',
      rawHeading: '生の Markdown',
      rawHint: 'ファイル全体のテキストを編集します。保存時に検証し、ドキュメントを再読み込みします。',
      statusRawSaved: '生の Markdown を保存し、ドキュメントを再読み込みしました。',
      pasteButton: 'Markdown を貼り付け',
      pasteHeading: 'Markdown を貼り付け / インポート',
      pasteHint: '完全な Soul ファイルを貼り付けてください。解析は何も書き込みません。',
      pasteSourceLabel: 'Markdown ソース',
      pastePlaceholder: '---\nname: my-teammate\n---\n…',
      parseButton: '解析',
      parsingButton: '解析中…',
      importButton: '下書きにインポート',
      createFromPaste: 'Soul を作成',
      pasteIntoDraftHint: '解析したフィールドが現在の下書きを置き換えます。保存するまで何も書き込まれません。',
      pasteCreateHint: 'ドキュメント未選択: 解析した名前とソースから新しい Soul を作成します。',
      pasteEmpty: '先に Markdown を貼り付けてください。',
      pasteParseFirst: 'インポートする前に、貼り付けた Markdown を解析してください。',
      pasteMissingName: '解析した Markdown に有効な名前がありません。インポート先のドキュメントを選ぶか、貼り付け内容を修正してください。',
      statusPasted: '貼り付けた Markdown を下書きにインポートしました。確認してから保存してください。',
      statusPasteCreated: '貼り付けた Markdown から {name} を作成しました。',
      parseHeading: '解析結果',
      parseValid: '貼り付けた Markdown は有効な Soul です。',
      parseInvalid: '貼り付けた Markdown に診断があります。',
      templatesLabel: 'テンプレート',
      templateBlank: '空',
      templateResearcher: 'リサーチャー',
      templateCodeReviewer: 'コード レビュー',
      templateDocsWriter: 'ドキュメント作成',
      templateHint: 'テンプレートはブラウザーでこの名前とともに構成され、新しいファイルとして送信されます。',
      duplicateButton: '複製',
      duplicateHeading: 'この Soul を複製',
      duplicateName: '新しい名前',
      duplicateNamePlaceholder: 'lower-kebab-case、例: researcher-copy',
      duplicateSubmit: 'コピーを作成',
      duplicatingButton: '複製中…',
      duplicateHint: 'ディスク上の保存済みファイルをコピーします。未保存の変更は含まれません。',
      statusDuplicated: '{name} として複製しました。',
      statusDeletedTrashed: '{name} を削除しました。ファイルはゴミ箱に移動しました。',
      undoTitle: 'ファイルを復元できます',
      undoText: '「{name}」をゴミ箱に移動しました。今すぐ復元しますか？',
      undoButton: '削除を元に戻す',
      undoingButton: '復元中…',
      undoDismiss: '閉じる',
      statusRestored: '{name} を復元しました。',
      statusRestoring: '復元中…',
      deleteTrashHint: '削除すると、Host が対応している場合はファイルがゴミ箱に移動するため、元に戻せます。',
      usageSaved: '保存 {count} 件',
      usageLastUsed: '最終使用 {time}',
      usageNeverUsed: '未使用',
      usageActive: '{names} が使用中',
      commandStatusAria: 'コマンド ステータス: {status}',
      commandStatusHeading: 'コマンド',
      commandStatusUnavailable: 'Host から報告されていません',
      catalogLineHeading: 'Lead からの見え方',
      catalogLineUnavailable: 'カタログ行はまだ報告されていません。',
      healthHeading: 'ランタイムの状態',
      healthHint: 'カタログ全体の上限とスキャン結果です。上限を超えるとバーが赤くなります。',
      healthDefinitions: '定義の上限',
      healthCatalogChars: 'カタログ文字数の上限',
      healthBudgetValue: '{used} / {max} 使用',
      healthBudgetNoLimit: '上限の報告なし · {used} 使用',
      healthBudgetUnknown: '使用量の報告なし',
      healthDuplicatesHeading: '重複した名前',
      healthNoDuplicates: '重複した名前はありません。',
      healthDuplicateLabel: '重複した名前',
      healthInvalidFiles: '無効なファイル',
      healthScanDiagnostics: 'スキャン診断',
      healthNoDiagnostics: 'スキャン診断はありません。',
      healthNotReported: '未報告',
      healthTeamTools: 'Team ツール面',
      diagnosticOpenFile: '{file} をエディターで開く',
      infoLiveTeamMember: 'メンバー 1 名',
      infoLiveTeamMembers: 'メンバー {count} 名',
      infoTeamSpawnNote: '変更は次回のスポーンに適用され、実行中のチームメイトには適用されません。',
      closeDialog: 'ダイアログを閉じる',
      resizeHandle: 'ダイアログのサイズ変更（ドラッグまたは矢印キー）',
      resetSizeButton: 'サイズをリセット',
      tabSouls: 'Soul',
      tabOrchestrator: 'オーケストレーター',
      orchestratorHeading: 'オーケストレーター定義',
      orchestratorIntro: 'Lead のオーケストレーション方針とモデル/ツールの上書き。サブAgent Soul は引き続き委任を担います。',
      orchestratorHint: 'このチャットで `/orchestrate` を実行すると適用されます（Agent Teams も有効になります）。`/orchestrate off` で終了し、Agent Teams も無効になります。モードはセッションごとに記憶されます。',
      orchestratorActivation: 'チャットコマンド',
      orchestratorCommand: '/orchestrate',
      orchestratorCommandOff: '/orchestrate off',
      orchestratorPath: '定義ファイル',
      orchestratorEditButton: 'オーケストレーターを編集',
      orchestratorCreateButton: '既定のオーケストレーターを作成',
      orchestratorCreateHint: '6 つの正規セクションと既定の構成をブラウザーで組み立ててから、ファイルに書き込みます。',
      orchestratorDialogHint: '保存すると定義ファイルに書き込まれます。次にチャットで `/orchestrate` を実行したときに適用されます。',
      orchestratorMissingTitle: 'オーケストレーター定義はまだありません',
      orchestratorMissingBody: '既定の定義を作成し、Lead が計画・委任・状態追跡・検証・復旧をどう行うかを記述してください。',
      orchestratorConfigured: '設定済み',
      badgeBundled: '同梱',
      bundledSoulNotice: 'このソウルはプラグイン同梱の既定です。ここでは読み取り専用です。カスタマイズするにはワークスペースのソウルディレクトリに複製してください。',
      orchestratorBundledHint: 'プラグイン同梱の既定ドクトリンを使用しています。保存すると上記パスにワークスペース固有の定義が書き込まれます。そのファイルを削除すると同梱の既定に戻ります。',
      orchestratorUnconfigured: '未作成',
      orchestratorBadgePlan: '計画優先: {value}',
      orchestratorBadgeGate: 'ゲートモード: {mode}',
      orchestratorBadgeRetries: '最大再試行: {count}',
      orchestratorBadgePause: '致命的エラーで一時停止: {value}',
      valueOn: 'オン',
      valueOff: 'オフ',
      gateModeStrict: '厳格',
      gateModeAdvisory: '助言',
      gateModeOff: 'オフ',
      groupOrchestratorConfig: 'オーケストレーター構成',
      groupOrchestratorSections: 'オーケストレーション セクション',
      orchestratorConfigHint: '有効化時に適用されるルーティングと安全制限です。モデルとプロバイダーが空欄なら Lead 自身のルートを使います。',
      orchestratorSectionsHint: '各正規セクションは独立したテキストエリアです。空のセクションはモード適用時に省略されます。',
      fieldPlanFirst: '計画を先に立てる',
      fieldPlanFirstHint: '作業を委任する前に書面の計画を求めます。',
      fieldPauseOnFatal: '致命的エラーで一時停止',
      fieldPauseOnFatalHint: '回復不能な失敗の後は再試行せず委任を停止します。',
      fieldGateMode: 'ゲートモード',
      fieldMaxRetries: '最大再試行回数',
      sectionIdentity: 'アイデンティティと境界',
      sectionPlan: '計画の生成',
      sectionDelegation: '委任とコンテキスト最小化',
      sectionState: '状態の追跡',
      sectionVerification: '品質の検証',
      sectionRecovery: '例外と復旧',
      statusOrchestratorSaved: 'オーケストレーターを保存しました。次にチャットで `/orchestrate` を実行したときに適用されます。',
      statusOrchestratorCreated: '既定のオーケストレーター定義を作成しました。',
      errorOrchestratorTitle: 'オーケストレーター定義を読み込めませんでした',
      orchestratorBadgeLabel: 'オーケストレーターモードはオンです',
      orchestratorBadgeTitle: 'オーケストレーターモードはオンです。終了するには /orchestrate off を実行してください。',
      orchestratorBadgeAria: 'オーケストレーターモードはオンです。終了するには /orchestrate off を実行してください。',
    }

    /** German copy (Deutsch) for the same keys. */
    const de = {
      nav: 'Agent Soul',
      title: 'Agent Soul',
      intro: 'Jede Agent Soul ist eine Markdown-Datei: YAML-Frontmatter für Routing und Berechtigungen, danach die Prompt-Abschnitte. Speichern schreibt die Datei; der nächste Spawn verwendet sie.',
      newButton: 'Neue Soul',
      refreshButton: 'Aktualisieren',
      refreshBusy: 'Wird aktualisiert…',
      scanLine: 'Letzter Scan {time} · {valid} gültig · {invalid} ungültig',
      scanNever: 'Noch kein Scan · {valid} gültig · {invalid} ungültig',
      listHeading: 'Souls',
      listCount: '{count}',
      listEmptyTitle: 'Noch keine Soul-Dateien',
      listEmptyBody: 'Lege eine an, um einem Teammitglied eine Markdown-definierte Persona und Berechtigungen zu geben.',
      listNoDescription: 'Keine Beschreibung',
      listOpen: '{name} bearbeiten',
      badgeValid: 'Gültig',
      badgeInvalid: 'Ungültig',
      badgeAllTools: 'Alle Tools',
      badgeNoTools: 'Keine Tools',
      badgeTools: '{count} Tools',
      badgeModel: 'Modell: {model}',
      badgeContext: 'Kontext: {context}',
      defaultSoulLabel: 'Standard-Soul',
      defaultSoulHint: 'Wird von spawn_teammate verwendet, wenn agent_type fehlt. Jedes Team-Kind muss eine definierte Soul ausführen.',
      defaultSoulAutoOption: 'Mitgelieferter Standard (generalist)',
      defaultSoulMissingOption: '{name} (nicht im Katalog)',
      badgeDefault: 'Standard',
      defaultWarningTitle: 'Warnung zur Standard-Soul',
      defaultWarningBody: '{message}',
      statusDefaultSaved: 'Standard-Soul auf {name} gesetzt.',
      statusDefaultCleared: 'Auswahl der Standard-Soul aufgehoben.',
      emptyTitle: 'Nichts ausgewählt',
      emptyBody: 'Wähle eine Soul aus der Liste oder lege eine neue an.',
      editorHeading: '{name} bearbeiten',
      dirtyHint: 'Ungespeicherte Änderungen',
      groupIdentity: 'Identität',
      groupRouting: 'Routing & Berechtigungen',
      groupMarkdown: 'Markdown-Abschnitte',
      groupAdvanced: 'Erweitert',
      fieldName: 'Name',
      fieldDescription: 'Beschreibung',
      fieldTools: 'Tools',
      fieldToolsPlaceholder: 'Kommagetrennte Tool-Namen. * erbt alle Tools; leer verweigert alle geerbten Tools.',
      fieldModel: 'Modell',
      fieldModelPlaceholder: 'z. B. deepseek-flash (leer = erben)',
      fieldProvider: 'Anbieter',
      fieldProviderInherit: 'Erben (leer)',
      fieldReasoning: 'Reasoning-Aufwand',
      fieldReasoningPlaceholder: 'z. B. high (leer = erben)',
      fieldContext: 'Kontext',
      fieldContextAbsent: 'Nicht angegeben',
      fieldContextFresh: 'fresh',
      fieldContextFork: 'fork',
      fieldUserInvocable: 'Manuell aufrufbar',
      fieldUserInvocableHint: 'Registriert die Soul zusätzlich als Slash-Befehl.',
      fieldExtraFrontmatter: 'Zusätzliches Frontmatter',
      fieldExtraFrontmatterHint: 'Rohe YAML-Zeilen für Schlüssel, die dieser Editor nicht abbildet. Unverändert übernommen.',
      fieldExtraMarkdown: 'Zusätzliches Markdown',
      fieldExtraMarkdownHint: 'Inhalt außerhalb der vier Abschnitte; er wird zur Einleitung.',
      sectionsHint: 'Jeder Abschnitt hat ein eigenes Textfeld, damit er einzeln kopiert und eingefügt werden kann.',
      sectionRole: 'Rollendefinition',
      sectionInputs: 'Eingaben, die du siehst',
      sectionRules: 'Harte Regeln',
      sectionOutput: 'Ausgabeformat',
      saveButton: 'Speichern',
      savingButton: 'Wird gespeichert…',
      deleteButton: 'Löschen',
      deletingButton: 'Wird gelöscht…',
      confirmDeleteButton: 'Löschen bestätigen',
      cancelButton: 'Abbrechen',
      retryButton: 'Erneut versuchen',
      createButton: 'Erstellen',
      creatingButton: 'Wird erstellt…',
      createHeading: 'Neue Soul',
      createName: 'Name',
      createNamePlaceholder: 'lower-kebab-case, z. B. researcher',
      createHint: 'Erstellt <first soul directory>/<name>.md aus der gewählten Vorlage.',
      createNameRequired: 'Gib zuerst einen Namen ein.',
      confirmDelete: '"{name}" löschen? Die Markdown-Datei wandert in den Papierkorb, wenn der Host das unterstützt.',
      errorTitle: 'Soul-Katalog konnte nicht geladen werden',
      errorBody: 'Die Host-Routen dieser Seite antworten nicht. Prüfe, ob das Plugin aktiv ist, und versuche es erneut.',
      errorDocumentTitle: 'Diese Soul konnte nicht geöffnet werden',
      errorNetwork: 'Netzwerkanfrage fehlgeschlagen.',
      errorCodeInvalid: 'Das Dokument ist ungültig; es wurde nichts gespeichert.',
      errorCodeInvalidName: 'Der Name ist ungültig. Verwende lower-kebab-case, höchstens 64 Zeichen und nicht "lead".',
      errorCodeExists: 'Eine Soul mit diesem Namen existiert bereits.',
      errorCodeNoDirs: 'Es existiert noch kein Soul-Verzeichnis. Prüfe die Plugin-Konfiguration.',
      errorCodeNotFound: 'Die Datei existiert nicht mehr. Aktualisiere die Liste.',
      errorCodeUnsafePath: 'Dieser Pfad liegt außerhalb der konfigurierten Soul-Verzeichnisse.',
      errorCodeInvalidRequest: 'Der Host hat die Anfrage als fehlerhaft abgelehnt.',
      errorCodeInvalidResponse: 'Der Host hat eine unerwartete Antwort geliefert. Bitte die Seite aktualisieren oder erneut versuchen.',
      errorUnknown: 'Die Anfrage ist fehlgeschlagen ({code}).',
      diagnosticsHeading: 'Diagnosen',
      scanDiagnosticsHeading: 'Scan-Diagnosen',
      infoHeading: 'Plugin-Einstellungen & Laufzeit',
      infoPlugin: 'Plugin',
      infoRoot: 'Workspace-Wurzel',
      infoDirs: 'Soul-Verzeichnisse',
      infoDirsEmpty: 'Für diesen Workspace wird kein Soul-Verzeichnis aufgelöst.',
      pageTitle: 'Standard-Agent-Souls verwenden',
      pageDescription: 'Wenn aktiviert, sind die mitgelieferten Standard-Souls und die Orchestrator-Doktrin des Plugins die aktiven Definitionen und lassen sich unter Einstellungen > Agent Soul direkt bearbeiten. Wenn deaktiviert, bleiben sie schreibgeschützte Vorgaben, und Sie passen Kopien im Arbeitsbereich an.',
      toggleLabel: 'Standard-Agent-Souls verwenden',
      cardLabel: 'Standard-Agent-Souls verwenden',
      summary: 'Die mitgelieferten Standard-Souls direkt bearbeiten, statt sie zu kopieren.',
      statusOn: 'An - mitgelieferte Vorgaben sind direkt bearbeitbar',
      statusOff: 'Aus - mitgelieferte Vorgaben sind schreibgeschützt',
      statusUnavailable: 'Nicht verfügbar - mitgelieferte Vorgaben sind deaktiviert (bundled: false)',
      statusNotConfigurable: 'Nicht verfügbar - dieses Profil kann die Einstellung nicht speichern',
      statusApplying: 'Wird angewendet… das Plugin lädt einmal neu',
      statusApplied: 'Angewendet.',
      statusUnverified: 'Gespeichert, aber das Neuladen wurde nicht bestätigt. Bitte die Seite neu laden, um den neuen Wert zu prüfen.',
      statusError: 'Die Plugin-Konfiguration konnte nicht aktualisiert werden.',
      infoBindings: 'Bindungsdatei',
      infoBindingsCount: '{count} gespeicherte Bindungen',
      infoBindingsUnreadable: 'Anzahl nicht verfügbar',
      infoProviders: 'Anbieter',
      infoProvidersEmpty: 'Der Host meldet keine Anbieter.',
      infoCommandPrefix: 'Befehlspräfix',
      infoCommandPrefixNone: 'keins',
      infoDefaultContext: 'Standardkontext',
      infoSpawnProviders: 'Spawn-Anbieter',
      infoLimitsLabel: 'Limits',
      infoLimits: 'Bis zu {definitions} Definitionen · {chars} Prompt-Zeichen',
      infoScanTime: 'Letzter Scan',
      infoScanNever: 'nie',
      infoLiveTeams: 'Aktive Team-Befehle',
      infoLiveTeamsEmpty: 'Keine aktive Team-Sitzung meldet Befehle.',
      infoTeamLead: 'Lead {lead}',
      infoDelegation: 'Delegation',
      infoDelegationHint: 'Starte ein Teammitglied mit dieser Soul:',
      infoDelegationExample: 'spawn_teammate({ …, agent_type: "<name>" })',
      infoMarkdownNote: 'Souls sind reines Markdown (YAML-Frontmatter plus Text). Speichern schreibt die Datei direkt; es gibt keine separate Datenbank.',
      statusLoading: 'Wird geladen…',
      statusRefreshed: 'Von der Festplatte neu geladen.',
      statusSaved: 'Gespeichert. Der nächste Spawn verwendet diese Soul.',
      statusCreated: '{name} erstellt.',
      statusDeleted: '{name} gelöscht.',
      statusSaving: 'Wird gespeichert…',
      statusDeleting: 'Wird gelöscht…',
      statusCreating: 'Wird erstellt…',
      statusOpening: 'Wird geöffnet…',
      searchLabel: 'Souls durchsuchen',
      searchPlaceholder: 'Name, Beschreibung, Quellpfad oder Dateiname durchsuchen',
      filterLabel: 'Souls filtern',
      filterAll: 'Alle',
      filterUser: 'Manuell aufrufbar',
      filterAi: 'Nur KI',
      filterInvalid: 'Ungültig',
      sortLabel: 'Souls sortieren',
      sortName: 'Name',
      sortUpdated: 'Aktualisiert',
      noMatchesTitle: 'Keine passenden Souls',
      noMatchesBody: 'Passe Suche oder Filter an und versuche es erneut.',
      clearFiltersButton: 'Filter zurücksetzen',
      unsavedGuardTitle: 'Ungespeicherte Änderungen',
      unsavedGuardText: '"{name}" hat ungespeicherte Änderungen. Vor dem Fortfahren verwerfen?',
      discardChangesButton: 'Änderungen verwerfen',
      keepEditingButton: 'Weiter bearbeiten',
      draftFoundTitle: 'Ungespeicherten Entwurf wiederherstellen',
      draftFoundText: 'Ein lokal gespeicherter Entwurf von {time} ist neuer als die Datei. Wiederherstellen?',
      restoreDraftButton: 'Entwurf wiederherstellen',
      discardDraftButton: 'Entwurf verwerfen',
      conflictTitle: 'Die Datei wurde auf der Festplatte geändert',
      conflictText: 'Diese Datei wurde vor dem Speichern geändert ({time}). Lade sie neu oder überschreibe sie mit deinen Änderungen.',
      reloadFileButton: 'Datei neu laden',
      overwriteButton: 'Überschreiben',
      fieldErrorSummary: 'Diese Felder korrigieren',
      revertButton: 'Zurücksetzen',
      statusReverted: 'Auf den zuletzt geladenen Inhalt zurückgesetzt.',
      copyButton: 'Kopieren',
      copiedButton: 'Kopiert',
      copyFailed: 'Kopieren in die Zwischenablage fehlgeschlagen.',
      emptyDirsHint: 'Souls sind die Markdown-Dateien in diesen Verzeichnissen.',
      errorCodeConflict: 'Die Datei wurde geändert; es wurde nichts gespeichert.',
      fieldToolsAdvanced: 'Tools (kommagetrennt)',
      fieldToolsAdvancedHint: 'Auswahl und Liste bleiben synchron. * erbt alle Tools; leer verweigert alle.',
      toolsInheritAll: 'Alle Tools erben',
      toolsInheritHint: 'Das Teammitglied darf jedes Tool nutzen, das der Lead teilen kann.',
      toolsNoneHint: 'Keine Tools ausgewählt: Das Teammitglied erbt keine Tools.',
      toolsCustomHint: 'Klicke ein Tool, um es umzuschalten. Namen außerhalb des Live-Katalogs bleiben sichtbar, damit du sie entfernen kannst.',
      toolsCount: '{count} ausgewählt',
      toolsCatalogEmpty: 'Der Host meldet keinen Live-Tool-Katalog; die Auswahl ist leer. Nutze die erweiterte Liste.',
      toolsUnknownHeading: 'Nicht im Live-Katalog',
      toolsUnknownHint: 'Diese Namen bietet der aktive Lead nicht an. Entferne sie, wenn du sie nicht meinst.',
      toolsTeamAlwaysHint: 'Team-Tools sind immer verfügbar und nicht einschränkbar; sie hier zu nennen ist unschädlich, die Matrix überspringt sie.',
      toolsRemove: '{name} entfernen',
      toolsToggle: '{name} umschalten',
      modelInheritOption: 'Vom Lead erben',
      modelNotInCatalog: '{model} (nicht im Katalog)',
      modelPickerHint: 'Wähle eine Route aus dem Live-Katalog; die Rohfelder unter Erweitert bleiben maßgeblich.',
      modelCatalogEmpty: 'Der Host meldet keinen Modellkatalog; bearbeite die Rohfelder unter Erweitert.',
      modelResolvedLabel: 'Aufgelöste Route',
      modelResolvedInherited: 'Vom Lead geerbt',
      advancedModel: 'Modell (Freitext)',
      advancedProvider: 'Anbieter (Freitext)',
      advancedHint: 'Diese Felder haben Vorrang vor den Auswahlen; leer lassen, um zu erben.',
      previewHeading: 'Was das Teammitglied erhält',
      previewHint: 'Schreibfreie Vorschau von Persona, Route, Tools und Prompt-Katalogzeile.',
      previewShow: 'Vorschau anzeigen',
      previewHide: 'Vorschau ausblenden',
      previewLoading: 'Vorschau wird erstellt…',
      previewError: 'Die Vorschau konnte nicht erstellt werden. Das Bearbeiten ist nicht betroffen.',
      previewRetry: 'Vorschau erneut versuchen',
      previewValid: 'Gültig',
      previewInvalid: 'Ungültig — korrigiere die Diagnosen unten.',
      previewPersona: 'Persona',
      previewPersonaHint: 'Zusammengesetzt aus Rollendefinition, Eingaben, harten Regeln und Ausgabeformat.',
      previewResolvedModel: 'Aufgelöstes Modell',
      previewCommand: 'Befehlsstatus',
      previewTools: 'Tool-Matrix',
      previewToolsInheritAll: 'Erbt alle Tools',
      previewToolsDenyAll: 'Erbt keine Tools',
      previewToolUnknown: 'Nicht im Live-Katalog',
      previewCatalogLine: 'Prompt-Katalogzeile',
      previewCatalogEmpty: 'Keine Katalogzeile: Die zusammengesetzte Soul ist ungültig.',
      previewComposed: 'Zusammengesetztes Markdown',
      previewComposedShow: 'Zusammengesetztes Markdown anzeigen',
      previewComposedHide: 'Zusammengesetztes Markdown ausblenden',
      previewDiagnostics: 'Vorschau-Diagnosen',
      copyPersona: 'Persona kopieren',
      copyCatalogLine: 'Katalogzeile kopieren',
      commandStatusRegistered: 'Registriert',
      commandStatusAiOnly: 'Nur KI',
      commandStatusInvalidName: 'Ungültiger Name',
      commandStatusCollision: 'Befehlskollision',
      commandStatusNoLiveLead: 'Kein aktiver Lead',
      commandStatusUnknown: 'Unbekannter Status',
      modeLabel: 'Editor-Modus',
      modeForm: 'Formular',
      modeRaw: 'Roh',
      rawHeading: 'Rohes Markdown',
      rawHint: 'Bearbeite den vollständigen Dateitext. Speichern validiert ihn und lädt das Dokument neu.',
      statusRawSaved: 'Rohes Markdown gespeichert und Dokument neu geladen.',
      pasteButton: 'Markdown einfügen',
      pasteHeading: 'Markdown einfügen oder importieren',
      pasteHint: 'Füge eine vollständige Soul-Datei ein. Parsen schreibt nichts.',
      pasteSourceLabel: 'Markdown-Quelle',
      pastePlaceholder: '---\nname: my-teammate\n---\n…',
      parseButton: 'Parsen',
      parsingButton: 'Wird geparst…',
      importButton: 'In Entwurf importieren',
      createFromPaste: 'Soul erstellen',
      pasteIntoDraftHint: 'Die geparsten Felder ersetzen den aktuellen Entwurf. Erst Speichern schreibt etwas.',
      pasteCreateHint: 'Kein Dokument ausgewählt: Erstelle eine neue Soul aus geparstem Namen und Quelle.',
      pasteEmpty: 'Füge zuerst Markdown ein.',
      pasteParseFirst: 'Parse das eingefügte Markdown, bevor du importierst.',
      pasteMissingName: 'Das geparste Markdown hat keinen gültigen Namen. Wähle ein Dokument zum Importieren oder korrigiere die Eingabe.',
      statusPasted: 'Eingefügtes Markdown in den Entwurf importiert. Prüfe es, dann speichere.',
      statusPasteCreated: '{name} aus dem eingefügten Markdown erstellt.',
      parseHeading: 'Parse-Ergebnis',
      parseValid: 'Das eingefügte Markdown ist eine gültige Soul.',
      parseInvalid: 'Das eingefügte Markdown hat Diagnosen.',
      templatesLabel: 'Vorlage',
      templateBlank: 'Leer',
      templateResearcher: 'Recherche',
      templateCodeReviewer: 'Code-Review',
      templateDocsWriter: 'Dokumentation',
      templateHint: 'Die Vorlage wird im Browser mit diesem Namen zusammengesetzt und als neue Datei gesendet.',
      duplicateButton: 'Duplizieren',
      duplicateHeading: 'Diese Soul duplizieren',
      duplicateName: 'Neuer Name',
      duplicateNamePlaceholder: 'lower-kebab-case, z. B. researcher-copy',
      duplicateSubmit: 'Kopie erstellen',
      duplicatingButton: 'Wird dupliziert…',
      duplicateHint: 'Kopiert die gespeicherte Datei auf der Festplatte; ungespeicherte Änderungen sind nicht enthalten.',
      statusDuplicated: 'Als {name} dupliziert.',
      statusDeletedTrashed: '{name} gelöscht. Die Datei wurde in den Papierkorb verschoben.',
      undoTitle: 'Die Datei ist wiederherstellbar',
      undoText: '„{name}“ wurde in den Papierkorb verschoben. Jetzt wiederherstellen?',
      undoButton: 'Löschen rückgängig machen',
      undoingButton: 'Wird wiederhergestellt…',
      undoDismiss: 'Ausblenden',
      statusRestored: '{name} wiederhergestellt.',
      statusRestoring: 'Wird wiederhergestellt…',
      deleteTrashHint: 'Löschen verschiebt die Datei in einen Papierkorb, wenn der Host das unterstützt; so lässt es sich rückgängig machen.',
      usageSaved: '{count} gespeichert',
      usageLastUsed: 'zuletzt verwendet {time}',
      usageNeverUsed: 'nie verwendet',
      usageActive: 'in Verwendung von {names}',
      commandStatusAria: 'Befehlsstatus: {status}',
      commandStatusHeading: 'Befehl',
      commandStatusUnavailable: 'Vom Host nicht gemeldet',
      catalogLineHeading: 'So sieht es der Lead',
      catalogLineUnavailable: 'Noch keine Katalogzeile gemeldet.',
      healthHeading: 'Laufzeit-Zustand',
      healthHint: 'Katalogweite Budgets und Scan-Befunde. Balken werden rot, wenn das Limit überschritten ist.',
      healthDefinitions: 'Definitionsbudget',
      healthCatalogChars: 'Katalog-Zeichenbudget',
      healthBudgetValue: '{used} von {max} belegt',
      healthBudgetNoLimit: 'Kein Limit gemeldet · {used} belegt',
      healthBudgetUnknown: 'Nutzung nicht gemeldet',
      healthDuplicatesHeading: 'Doppelte Namen',
      healthNoDuplicates: 'Keine doppelten Namen.',
      healthDuplicateLabel: 'Doppelter Name',
      healthInvalidFiles: 'Ungültige Dateien',
      healthScanDiagnostics: 'Scan-Diagnosen',
      healthNoDiagnostics: 'Keine Scan-Diagnosen.',
      healthNotReported: 'Nicht gemeldet',
      healthTeamTools: 'Team-Tool-Oberfläche',
      diagnosticOpenFile: '{file} im Editor öffnen',
      infoLiveTeamMember: '1 Mitglied',
      infoLiveTeamMembers: '{count} Mitglieder',
      infoTeamSpawnNote: 'Änderungen gelten für den nächsten Spawn, nicht für laufende Teammitglieder.',
      closeDialog: 'Dialog schließen',
      resizeHandle: 'Dialoggröße ändern (ziehen oder Pfeiltasten)',
      resetSizeButton: 'Größe zurücksetzen',
      tabSouls: 'Souls',
      tabOrchestrator: 'Orchestrator',
      orchestratorHeading: 'Orchestrator-Definition',
      orchestratorIntro: 'Die Orchestrierungslehre des Leads und ihre Modell-/Tool-Überschreibungen. Subagent-Souls steuern weiterhin die Delegation.',
      orchestratorHint: 'Gilt nach `/orchestrate` in diesem Chat (aktiviert auch Agent Teams); `/orchestrate off` beendet den Modus und deaktiviert Agent Teams. Der Modus wird pro Sitzung gemerkt.',
      orchestratorActivation: 'Chat-Befehle',
      orchestratorCommand: '/orchestrate',
      orchestratorCommandOff: '/orchestrate off',
      orchestratorPath: 'Definitionsdatei',
      orchestratorEditButton: 'Orchestrator bearbeiten',
      orchestratorCreateButton: 'Standard-Orchestrator erstellen',
      orchestratorCreateHint: 'Setzt die sechs kanonischen Abschnitte und die Standardkonfiguration im Browser zusammen und schreibt dann die Datei.',
      orchestratorDialogHint: 'Speichern schreibt die Definitionsdatei. Sie gilt beim nächsten `/orchestrate` in einem Chat.',
      orchestratorMissingTitle: 'Noch keine Orchestrator-Definition',
      orchestratorMissingBody: 'Erstelle die Standarddefinition, um zu beschreiben, wie der Lead plant, delegiert, Zustand verfolgt, Arbeit prüft und sich von Fehlern erholt.',
      orchestratorConfigured: 'Konfiguriert',
      badgeBundled: 'Mitgeliefert',
      bundledSoulNotice: 'Dieser Soul ist eine mitgelieferte Vorgabe des Plugins. Er ist hier schreibgeschützt; dupliziere ihn in ein Soul-Verzeichnis des Arbeitsbereichs, um ihn anzupassen.',
      orchestratorBundledHint: 'Es wird die mitgelieferte Standard-Doktrin des Plugins verwendet. Speichern schreibt eine arbeitsbereichsspezifische Definition an den oben genannten Pfad; wird diese Datei gelöscht, gilt wieder die mitgelieferte Vorgabe.',
      orchestratorUnconfigured: 'Nicht erstellt',
      orchestratorBadgePlan: 'Plan zuerst: {value}',
      orchestratorBadgeGate: 'Gate-Modus: {mode}',
      orchestratorBadgeRetries: 'Max. Wiederholungen: {count}',
      orchestratorBadgePause: 'Bei fatalem Fehler pausieren: {value}',
      valueOn: 'an',
      valueOff: 'aus',
      gateModeStrict: 'strikt',
      gateModeAdvisory: 'beratend',
      gateModeOff: 'aus',
      groupOrchestratorConfig: 'Orchestrator-Konfiguration',
      groupOrchestratorSections: 'Orchestrierungsabschnitte',
      orchestratorConfigHint: 'Routing- und Sicherheitsgrenzen, die bei der Aktivierung gelten. Leeres Modell und leerer Provider behalten den Weg des Leads.',
      orchestratorSectionsHint: 'Jeder kanonische Abschnitt ist ein eigenes Textfeld. Leere Abschnitte werden beim Anwenden übersprungen.',
      fieldPlanFirst: 'Zuerst planen',
      fieldPlanFirstHint: 'Vor der Delegation einen schriftlichen Plan verlangen.',
      fieldPauseOnFatal: 'Bei fatalem Fehler pausieren',
      fieldPauseOnFatalHint: 'Nach einem nicht behebbaren Fehler nicht weiter delegieren, statt es erneut zu versuchen.',
      fieldGateMode: 'Gate-Modus',
      fieldMaxRetries: 'Max. Wiederholungen',
      sectionIdentity: 'Identität & Grenzen',
      sectionPlan: 'Plangenerierung',
      sectionDelegation: 'Delegation & Kontextminimierung',
      sectionState: 'Zustandsverfolgung',
      sectionVerification: 'Qualitätsprüfung',
      sectionRecovery: 'Ausnahmen & Wiederherstellung',
      statusOrchestratorSaved: 'Orchestrator gespeichert. Er gilt beim nächsten `/orchestrate` in einem Chat.',
      statusOrchestratorCreated: 'Die Standard-Orchestrator-Definition wurde erstellt.',
      errorOrchestratorTitle: 'Die Orchestrator-Definition konnte nicht geladen werden',
      orchestratorBadgeLabel: 'Orchestrator-Modus ist an',
      orchestratorBadgeTitle: 'Der Orchestrator-Modus ist an. Mit /orchestrate off beenden.',
      orchestratorBadgeAria: 'Der Orchestrator-Modus ist an. Mit /orchestrate off beenden.',
    }

    /** French copy (français) for the same keys. */
    const fr = {
      nav: 'Agent Soul',
      title: 'Agent Soul',
      intro: 'Chaque Agent Soul est un fichier Markdown : un frontmatter YAML pour le routage et les permissions, puis les sections de prompt. Enregistrer écrit le fichier ; la prochaine création d’équipier l’utilise.',
      newButton: 'Nouvelle Soul',
      refreshButton: 'Actualiser',
      refreshBusy: 'Actualisation…',
      scanLine: 'Dernier scan {time} · {valid} valides · {invalid} invalides',
      scanNever: 'Aucun scan · {valid} valides · {invalid} invalides',
      listHeading: 'Souls',
      listCount: '{count}',
      listEmptyTitle: 'Aucun fichier de Soul',
      listEmptyBody: 'Créez-en un pour donner à un équipier une persona et des permissions définies en Markdown.',
      listNoDescription: 'Aucune description',
      listOpen: 'Modifier {name}',
      badgeValid: 'Valide',
      badgeInvalid: 'Invalide',
      badgeAllTools: 'Tous les outils',
      badgeNoTools: 'Aucun outil',
      badgeTools: '{count} outils',
      badgeModel: 'Modèle : {model}',
      badgeContext: 'Contexte : {context}',
      defaultSoulLabel: 'Soul par défaut',
      defaultSoulHint: 'Utilisée par spawn_teammate lorsque agent_type est omis. Chaque enfant Team doit exécuter une Soul définie.',
      defaultSoulAutoOption: 'Défaut fourni (generalist)',
      defaultSoulMissingOption: '{name} (absent du catalogue)',
      badgeDefault: 'Par défaut',
      defaultWarningTitle: 'Avertissement sur la Soul par défaut',
      defaultWarningBody: '{message}',
      statusDefaultSaved: 'Soul par défaut définie sur {name}.',
      statusDefaultCleared: 'Sélection de la Soul par défaut effacée.',
      emptyTitle: 'Rien de sélectionné',
      emptyBody: 'Sélectionnez une Soul dans la liste ou créez-en une.',
      editorHeading: 'Modification de {name}',
      dirtyHint: 'Modifications non enregistrées',
      groupIdentity: 'Identité',
      groupRouting: 'Routage et permissions',
      groupMarkdown: 'Sections Markdown',
      groupAdvanced: 'Avancé',
      fieldName: 'Nom',
      fieldDescription: 'Description',
      fieldTools: 'Outils',
      fieldToolsPlaceholder: 'Noms d’outils séparés par des virgules. * hérite de tous les outils ; vide refuse tous les outils hérités.',
      fieldModel: 'Modèle',
      fieldModelPlaceholder: 'ex. deepseek-flash (vide = hérité)',
      fieldProvider: 'Fournisseur',
      fieldProviderInherit: 'Hériter (vide)',
      fieldReasoning: 'Effort de raisonnement',
      fieldReasoningPlaceholder: 'ex. high (vide = hérité)',
      fieldContext: 'Contexte',
      fieldContextAbsent: 'Non spécifié',
      fieldContextFresh: 'fresh',
      fieldContextFork: 'fork',
      fieldUserInvocable: 'Appelable manuellement',
      fieldUserInvocableHint: 'Enregistre aussi cette Soul comme commande slash.',
      fieldExtraFrontmatter: 'Frontmatter supplémentaire',
      fieldExtraFrontmatterHint: 'Lignes YAML brutes pour les clés non modélisées par cet éditeur. Conservées telles quelles.',
      fieldExtraMarkdown: 'Markdown supplémentaire',
      fieldExtraMarkdownHint: 'Contenu hors des quatre sections ; il devient le préambule.',
      sectionsHint: 'Chaque section a sa propre zone de texte pour pouvoir être copiée et collée séparément.',
      sectionRole: 'Définition du rôle',
      sectionInputs: 'Entrées que vous verrez',
      sectionRules: 'Règles strictes',
      sectionOutput: 'Format de sortie',
      saveButton: 'Enregistrer',
      savingButton: 'Enregistrement…',
      deleteButton: 'Supprimer',
      deletingButton: 'Suppression…',
      confirmDeleteButton: 'Confirmer la suppression',
      cancelButton: 'Annuler',
      retryButton: 'Réessayer',
      createButton: 'Créer',
      creatingButton: 'Création…',
      createHeading: 'Nouvelle Soul',
      createName: 'Nom',
      createNamePlaceholder: 'lower-kebab-case, ex. researcher',
      createHint: 'Crée <first soul directory>/<name>.md à partir du modèle choisi.',
      createNameRequired: 'Saisissez d’abord un nom.',
      confirmDelete: 'Supprimer « {name} » ? Le fichier Markdown est déplacé dans la corbeille si l’hôte le prend en charge.',
      errorTitle: 'Impossible de charger le catalogue des souls',
      errorBody: 'Les routes de l’hôte pour cette page n’ont pas répondu. Vérifiez que le plugin est actif, puis réessayez.',
      errorDocumentTitle: 'Impossible d’ouvrir cette Soul',
      errorNetwork: 'La requête réseau a échoué.',
      errorCodeInvalid: 'Le document est invalide ; rien n’a été enregistré.',
      errorCodeInvalidName: 'Ce nom n’est pas valide. Utilisez le format lower-kebab-case, 64 caractères maximum, et pas « lead ».',
      errorCodeExists: 'Une Soul portant ce nom existe déjà.',
      errorCodeNoDirs: 'Aucun répertoire d’souls n’existe encore. Vérifiez la configuration du plugin.',
      errorCodeNotFound: 'Le fichier n’existe plus. Actualisez la liste.',
      errorCodeUnsafePath: 'Ce chemin est hors des répertoires d’souls configurés.',
      errorCodeInvalidRequest: 'L’hôte a rejeté la requête comme mal formée.',
      errorCodeInvalidResponse: 'L’hôte a renvoyé une réponse inattendue. Actualisez la page ou réessayez.',
      errorUnknown: 'La requête a échoué ({code}).',
      diagnosticsHeading: 'Diagnostics',
      scanDiagnosticsHeading: 'Diagnostics de scan',
      infoHeading: 'Réglages du plugin et exécution',
      infoPlugin: 'Plugin',
      infoRoot: 'Racine de l’espace de travail',
      infoDirs: 'Répertoires d’souls',
      infoDirsEmpty: 'Aucun répertoire d’souls n’est résolu pour cet espace de travail.',
      pageTitle: 'Utiliser les Agent Souls par défaut',
      pageDescription: 'Lorsque cette option est activée, les âmes par défaut fournies avec le plugin et la doctrine de l’orchestrateur sont les définitions actives et s’ouvrent à la modification dans Réglages > Agent Soul. Lorsqu’elle est désactivée, elles restent des valeurs par défaut en lecture seule et vous personnalisez des copies dans l’espace de travail.',
      toggleLabel: 'Utiliser les agent souls par défaut',
      cardLabel: 'Utiliser les agent souls par défaut',
      summary: 'Modifier sur place les âmes par défaut fournies avec le plugin au lieu de les copier.',
      statusOn: 'Activé - les valeurs par défaut fournies sont modifiables sur place',
      statusOff: 'Désactivé - les valeurs par défaut fournies sont en lecture seule',
      statusUnavailable: 'Indisponible - les valeurs par défaut fournies sont désactivées (bundled: false)',
      statusNotConfigurable: 'Indisponible - ce profil ne peut pas enregistrer ce réglage',
      statusApplying: 'Application… le plugin se recharge une fois',
      statusApplied: 'Appliqué.',
      statusUnverified: 'Enregistré, mais le rechargement n’a pas été confirmé. Rechargez la page pour vérifier la nouvelle valeur.',
      statusError: 'Impossible de mettre à jour la configuration du plugin.',
      infoBindings: 'Fichier de liaisons',
      infoBindingsCount: '{count} liaisons stockées',
      infoBindingsUnreadable: 'Nombre indisponible',
      infoProviders: 'Fournisseurs',
      infoProvidersEmpty: 'L’hôte ne signale aucun fournisseur.',
      infoCommandPrefix: 'Préfixe de commande',
      infoCommandPrefixNone: 'aucun',
      infoDefaultContext: 'Contexte par défaut',
      infoSpawnProviders: 'Fournisseurs de création',
      infoLimitsLabel: 'Limites',
      infoLimits: 'Jusqu’à {definitions} définitions · {chars} caractères de prompt',
      infoScanTime: 'Dernier scan',
      infoScanNever: 'jamais',
      infoLiveTeams: 'Commandes des équipes actives',
      infoLiveTeamsEmpty: 'Aucune session d’équipe active ne signale de commandes.',
      infoTeamLead: 'Lead {lead}',
      infoDelegation: 'Délégation',
      infoDelegationHint: 'Démarrer un équipier avec cette Soul :',
      infoDelegationExample: 'spawn_teammate({ …, agent_type: "<name>" })',
      infoMarkdownNote: 'Les souls sont du Markdown brut (frontmatter YAML et corps). Enregistrer écrit directement le fichier ; il n’y a pas de base de données séparée.',
      statusLoading: 'Chargement…',
      statusRefreshed: 'Rechargé depuis le disque.',
      statusSaved: 'Enregistré. La prochaine création utilisera cette Soul.',
      statusCreated: '{name} créée.',
      statusDeleted: '{name} supprimée.',
      statusSaving: 'Enregistrement…',
      statusDeleting: 'Suppression…',
      statusCreating: 'Création…',
      statusOpening: 'Ouverture…',
      searchLabel: 'Rechercher des souls',
      searchPlaceholder: 'Rechercher par nom, description, chemin de source ou nom de fichier',
      filterLabel: 'Filtrer les souls',
      filterAll: 'Toutes',
      filterUser: 'Appelable manuellement',
      filterAi: 'IA uniquement',
      filterInvalid: 'Invalides',
      sortLabel: 'Trier les souls',
      sortName: 'Nom',
      sortUpdated: 'Mise à jour',
      noMatchesTitle: 'Aucune Soul correspondante',
      noMatchesBody: 'Ajustez la recherche ou les filtres, puis réessayez.',
      clearFiltersButton: 'Effacer les filtres',
      unsavedGuardTitle: 'Modifications non enregistrées',
      unsavedGuardText: '« {name} » a des modifications non enregistrées. Les abandonner avant de continuer ?',
      discardChangesButton: 'Abandonner les modifications',
      keepEditingButton: 'Continuer la modification',
      draftFoundTitle: 'Récupérer un brouillon non enregistré',
      draftFoundText: 'Un brouillon enregistré localement le {time} est plus récent que le fichier. Le restaurer ?',
      restoreDraftButton: 'Restaurer le brouillon',
      discardDraftButton: 'Abandonner le brouillon',
      conflictTitle: 'Le fichier a changé sur le disque',
      conflictText: 'Ce fichier a changé avant votre enregistrement ({time}). Rechargez-le ou écrasez-le avec vos modifications.',
      reloadFileButton: 'Recharger le fichier',
      overwriteButton: 'Écraser',
      fieldErrorSummary: 'Corrigez ces champs',
      revertButton: 'Rétablir',
      statusReverted: 'Contenu du dernier chargement rétabli.',
      copyButton: 'Copier',
      copiedButton: 'Copié',
      copyFailed: 'Impossible de copier dans le presse-papiers.',
      emptyDirsHint: 'Les souls sont les fichiers Markdown de ces répertoires.',
      errorCodeConflict: 'Le fichier a changé ; rien n’a été enregistré.',
      fieldToolsAdvanced: 'Outils (séparés par des virgules)',
      fieldToolsAdvancedHint: 'Le sélecteur et cette liste restent synchronisés. * hérite de tous les outils ; vide refuse tout.',
      toolsInheritAll: 'Hériter de tous les outils',
      toolsInheritHint: 'L’équipier peut utiliser tous les outils que le Lead peut partager.',
      toolsNoneHint: 'Aucun outil sélectionné : l’équipier n’hérite d’aucun outil.',
      toolsCustomHint: 'Cliquez sur un outil pour l’activer ou le désactiver. Les noms absents du catalogue actif restent visibles pour que vous puissiez les retirer.',
      toolsCount: '{count} sélectionnés',
      toolsCatalogEmpty: 'L’hôte ne signale aucun catalogue d’outils actif ; ce sélecteur est vide. Utilisez la liste avancée.',
      toolsUnknownHeading: 'Absent du catalogue actif',
      toolsUnknownHint: 'Ces noms ne sont pas proposés par le Lead actif. Retirez-les sauf si vous les voulez vraiment.',
      toolsTeamAlwaysHint: 'Les outils d’équipe sont toujours disponibles et non restreignables ; les lister ici est sans effet, la matrice les ignore.',
      toolsRemove: 'Retirer {name}',
      toolsToggle: 'Activer ou désactiver {name}',
      modelInheritOption: 'Hériter du Lead',
      modelNotInCatalog: '{model} (absent du catalogue)',
      modelPickerHint: 'Choisissez une route dans le catalogue actif ; les champs bruts sous Avancé restent déterminants.',
      modelCatalogEmpty: 'L’hôte ne signale aucun catalogue de modèles ; modifiez les champs bruts sous Avancé.',
      modelResolvedLabel: 'Route résolue',
      modelResolvedInherited: 'Héritée du Lead',
      advancedModel: 'Modèle (texte libre)',
      advancedProvider: 'Fournisseur (texte libre)',
      advancedHint: 'Ces champs priment sur les sélecteurs ; laissez-les vides pour hériter.',
      previewHeading: 'Ce que recevra l’équipier',
      previewHint: 'Aperçu sans écriture de la persona, de la route, des outils et de la ligne de catalogue du prompt.',
      previewShow: 'Afficher l’aperçu',
      previewHide: 'Masquer l’aperçu',
      previewLoading: 'Composition de l’aperçu…',
      previewError: 'L’aperçu n’a pas pu être composé. La modification n’est pas affectée.',
      previewRetry: 'Réessayer l’aperçu',
      previewValid: 'Valide',
      previewInvalid: 'Invalide — corrigez les diagnostics ci-dessous.',
      previewPersona: 'Persona',
      previewPersonaHint: 'Composée à partir de la définition du rôle, des entrées, des règles strictes et du format de sortie.',
      previewResolvedModel: 'Modèle résolu',
      previewCommand: 'Statut de la commande',
      previewTools: 'Matrice des outils',
      previewToolsInheritAll: 'Hérite de tous les outils',
      previewToolsDenyAll: 'N’hérite d’aucun outil',
      previewToolUnknown: 'Absent du catalogue actif',
      previewCatalogLine: 'Ligne du catalogue de prompts',
      previewCatalogEmpty: 'Aucune ligne de catalogue : la Soul composée est invalide.',
      previewComposed: 'Markdown composé',
      previewComposedShow: 'Afficher le Markdown composé',
      previewComposedHide: 'Masquer le Markdown composé',
      previewDiagnostics: 'Diagnostics de l’aperçu',
      copyPersona: 'Copier la persona',
      copyCatalogLine: 'Copier la ligne de catalogue',
      commandStatusRegistered: 'Enregistré',
      commandStatusAiOnly: 'IA uniquement',
      commandStatusInvalidName: 'Nom invalide',
      commandStatusCollision: 'Collision de commande',
      commandStatusNoLiveLead: 'Aucun Lead actif',
      commandStatusUnknown: 'Statut inconnu',
      modeLabel: 'Mode d’édition',
      modeForm: 'Formulaire',
      modeRaw: 'Brut',
      rawHeading: 'Markdown brut',
      rawHint: 'Modifiez le texte complet du fichier. Enregistrer le valide et recharge le document.',
      statusRawSaved: 'Markdown brut enregistré et document rechargé.',
      pasteButton: 'Coller du Markdown',
      pasteHeading: 'Coller ou importer du Markdown',
      pasteHint: 'Collez un fichier de Soul complet. L’analyse n’écrit rien.',
      pasteSourceLabel: 'Source Markdown',
      pastePlaceholder: '---\nname: my-teammate\n---\n…',
      parseButton: 'Analyser',
      parsingButton: 'Analyse…',
      importButton: 'Importer dans le brouillon',
      createFromPaste: 'Créer la Soul',
      pasteIntoDraftHint: 'Les champs analysés remplacent le brouillon actuel. Rien n’est enregistré avant Enregistrer.',
      pasteCreateHint: 'Aucun document sélectionné : créez une Soul à partir du nom et de la source analysés.',
      pasteEmpty: 'Collez d’abord du Markdown.',
      pasteParseFirst: 'Analysez le Markdown collé avant de l’importer.',
      pasteMissingName: 'Le Markdown analysé n’a pas de nom valide. Sélectionnez un document pour l’import ou corrigez le texte.',
      statusPasted: 'Markdown collé importé dans le brouillon. Vérifiez-le, puis enregistrez.',
      statusPasteCreated: '{name} créée à partir du Markdown collé.',
      parseHeading: 'Résultat de l’analyse',
      parseValid: 'Le Markdown collé est une Soul valide.',
      parseInvalid: 'Le Markdown collé présente des diagnostics.',
      templatesLabel: 'Modèle',
      templateBlank: 'Vierge',
      templateResearcher: 'Chercheur',
      templateCodeReviewer: 'Relecture de code',
      templateDocsWriter: 'Rédaction de docs',
      templateHint: 'Le modèle est composé dans le navigateur avec ce nom et envoyé comme nouveau fichier.',
      duplicateButton: 'Dupliquer',
      duplicateHeading: 'Dupliquer cette Soul',
      duplicateName: 'Nouveau nom',
      duplicateNamePlaceholder: 'lower-kebab-case, ex. researcher-copy',
      duplicateSubmit: 'Créer la copie',
      duplicatingButton: 'Duplication…',
      duplicateHint: 'Copie le fichier enregistré sur le disque ; les modifications non enregistrées ne sont pas incluses.',
      statusDuplicated: 'Dupliquée sous {name}.',
      statusDeletedTrashed: '{name} supprimée. Le fichier a été déplacé dans la corbeille.',
      undoTitle: 'Le fichier est récupérable',
      undoText: '« {name} » a été déplacé dans la corbeille. Le restaurer maintenant ?',
      undoButton: 'Annuler la suppression',
      undoingButton: 'Restauration…',
      undoDismiss: 'Ignorer',
      statusRestored: '{name} restaurée.',
      statusRestoring: 'Restauration…',
      deleteTrashHint: 'La suppression déplace le fichier dans une corbeille si l’hôte le prend en charge, ce qui permet de l’annuler.',
      usageSaved: '{count} enregistré(s)',
      usageLastUsed: 'dernière utilisation {time}',
      usageNeverUsed: 'jamais utilisé',
      usageActive: 'utilisé par {names}',
      commandStatusAria: 'Statut de la commande : {status}',
      commandStatusHeading: 'Commande',
      commandStatusUnavailable: 'Non signalé par l’hôte',
      catalogLineHeading: 'Ce que voit le Lead',
      catalogLineUnavailable: 'Aucune ligne de catalogue signalée pour l’instant.',
      healthHeading: 'Santé de l’exécution',
      healthHint: 'Budgets de tout le catalogue et résultats de scan. Les barres passent au rouge au-delà de la limite.',
      healthDefinitions: 'Budget de définitions',
      healthCatalogChars: 'Budget de caractères du catalogue',
      healthBudgetValue: '{used} sur {max} utilisés',
      healthBudgetNoLimit: 'Aucune limite signalée · {used} utilisés',
      healthBudgetUnknown: 'Utilisation non signalée',
      healthDuplicatesHeading: 'Noms en double',
      healthNoDuplicates: 'Aucun nom en double.',
      healthDuplicateLabel: 'Nom en double',
      healthInvalidFiles: 'Fichiers invalides',
      healthScanDiagnostics: 'Diagnostics de scan',
      healthNoDiagnostics: 'Aucun diagnostic de scan.',
      healthNotReported: 'Non signalé',
      healthTeamTools: 'Surface des outils Team',
      diagnosticOpenFile: 'Ouvrir {file} dans l’éditeur',
      infoLiveTeamMember: '1 membre',
      infoLiveTeamMembers: '{count} membres',
      infoTeamSpawnNote: 'Les modifications s’appliquent à la prochaine création, pas aux équipiers en cours d’exécution.',
      closeDialog: 'Fermer la boîte de dialogue',
      resizeHandle: 'Redimensionner la boîte de dialogue (glisser ou flèches)',
      resetSizeButton: 'Réinitialiser la taille',
      tabSouls: 'Souls',
      tabOrchestrator: 'Orchestrateur',
      orchestratorHeading: 'Définition de l’orchestrateur',
      orchestratorIntro: 'La doctrine d’orchestration du Lead et ses substitutions de modèle et d’outils. Les souls de sous-agents pilotent toujours la délégation.',
      orchestratorHint: 'S’applique après `/orchestrate` dans cette conversation (active aussi Agent Teams) ; `/orchestrate off` quitte le mode et désactive Agent Teams. Le mode est mémorisé pour la session.',
      orchestratorActivation: 'Commandes de conversation',
      orchestratorCommand: '/orchestrate',
      orchestratorCommandOff: '/orchestrate off',
      orchestratorPath: 'Fichier de définition',
      orchestratorEditButton: 'Modifier l’orchestrateur',
      orchestratorCreateButton: 'Créer l’orchestrateur par défaut',
      orchestratorCreateHint: 'Compose les six sections canoniques et la configuration par défaut dans le navigateur, puis écrit le fichier.',
      orchestratorDialogHint: 'L’enregistrement écrit le fichier de définition. Il s’applique au prochain `/orchestrate` dans une conversation.',
      orchestratorMissingTitle: 'Aucune définition d’orchestrateur pour l’instant',
      orchestratorMissingBody: 'Créez la définition par défaut pour décrire comment le Lead planifie, délègue, suit l’état, vérifie le travail et récupère des échecs.',
      orchestratorConfigured: 'Configuré',
      badgeBundled: 'Intégré',
      bundledSoulNotice: 'Cette âme est une valeur par défaut fournie avec le plugin. Elle est en lecture seule ici ; dupliquez-la dans un répertoire d’âmes de l’espace de travail pour la personnaliser.',
      orchestratorBundledHint: 'La doctrine par défaut fournie avec le plugin est utilisée. L’enregistrement écrit une définition propre à l’espace de travail au chemin ci-dessus ; supprimez ce fichier pour revenir à la doctrine intégrée.',
      orchestratorUnconfigured: 'Non créé',
      orchestratorBadgePlan: 'Plan d’abord : {value}',
      orchestratorBadgeGate: 'Mode de contrôle : {mode}',
      orchestratorBadgeRetries: 'Tentatives max : {count}',
      orchestratorBadgePause: 'Pause sur erreur fatale : {value}',
      valueOn: 'activé',
      valueOff: 'désactivé',
      gateModeStrict: 'strict',
      gateModeAdvisory: 'consultatif',
      gateModeOff: 'désactivé',
      groupOrchestratorConfig: 'Configuration de l’orchestrateur',
      groupOrchestratorSections: 'Sections d’orchestration',
      orchestratorConfigHint: 'Routage et limites de sécurité appliqués à l’activation. Un modèle et un fournisseur vides conservent la route du Lead.',
      orchestratorSectionsHint: 'Chaque section canonique a sa propre zone de texte. Les sections vides sont ignorées à l’application du mode.',
      fieldPlanFirst: 'Planifier d’abord',
      fieldPlanFirstHint: 'Exiger un plan écrit avant de déléguer le travail.',
      fieldPauseOnFatal: 'Pause sur erreur fatale',
      fieldPauseOnFatalHint: 'Arrêter de déléguer après un échec irrécupérable au lieu de réessayer.',
      fieldGateMode: 'Mode de contrôle',
      fieldMaxRetries: 'Tentatives max',
      sectionIdentity: 'Identité et limites',
      sectionPlan: 'Génération du plan',
      sectionDelegation: 'Délégation et réduction du contexte',
      sectionState: 'Suivi de l’état',
      sectionVerification: 'Vérification de la qualité',
      sectionRecovery: 'Exceptions et récupération',
      statusOrchestratorSaved: 'Orchestrateur enregistré. Il s’applique au prochain `/orchestrate` dans une conversation.',
      statusOrchestratorCreated: 'La définition d’orchestrateur par défaut a été créée.',
      errorOrchestratorTitle: 'Impossible de charger la définition de l’orchestrateur',
      orchestratorBadgeLabel: 'Mode orchestrateur activé',
      orchestratorBadgeTitle: 'Le mode orchestrateur est activé. Exécutez /orchestrate off pour quitter.',
      orchestratorBadgeAria: 'Le mode orchestrateur est activé. Exécutez /orchestrate off pour quitter.',
    }

    /** Spanish copy (español) for the same keys. */
    const es = {
      nav: 'Agent Soul',
      title: 'Agent Soul',
      intro: 'Cada Agent Soul es un archivo Markdown: frontmatter YAML para enrutamiento y permisos, y luego secciones de prompt. Guardar escribe el archivo; la próxima creación de compañero lo usará.',
      newButton: 'Nueva Soul',
      refreshButton: 'Actualizar',
      refreshBusy: 'Actualizando…',
      scanLine: 'Último escaneo {time} · {valid} válidos · {invalid} no válidos',
      scanNever: 'Sin escaneo todavía · {valid} válidos · {invalid} no válidos',
      listHeading: 'Souls',
      listCount: '{count}',
      listEmptyTitle: 'Todavía no hay archivos de Soul',
      listEmptyBody: 'Crea una para dar a un compañero una persona y permisos definidos en Markdown.',
      listNoDescription: 'Sin descripción',
      listOpen: 'Editar {name}',
      badgeValid: 'Válida',
      badgeInvalid: 'No válida',
      badgeAllTools: 'Todas las herramientas',
      badgeNoTools: 'Sin herramientas',
      badgeTools: '{count} herramientas',
      badgeModel: 'Modelo: {model}',
      badgeContext: 'Contexto: {context}',
      defaultSoulLabel: 'Soul predeterminada',
      defaultSoulHint: 'La usa spawn_teammate cuando se omite agent_type. Cada hijo del Team debe ejecutar una Soul definida.',
      defaultSoulAutoOption: 'Predeterminada incluida (generalist)',
      defaultSoulMissingOption: '{name} (no está en el catálogo)',
      badgeDefault: 'Predeterminada',
      defaultWarningTitle: 'Aviso de Soul predeterminada',
      defaultWarningBody: '{message}',
      statusDefaultSaved: 'Soul predeterminada establecida en {name}.',
      statusDefaultCleared: 'Selección de Soul predeterminada borrada.',
      emptyTitle: 'Nada seleccionado',
      emptyBody: 'Selecciona una Soul de la lista o crea una nueva.',
      editorHeading: 'Editando {name}',
      dirtyHint: 'Cambios sin guardar',
      groupIdentity: 'Identidad',
      groupRouting: 'Enrutamiento y permisos',
      groupMarkdown: 'Secciones Markdown',
      groupAdvanced: 'Avanzado',
      fieldName: 'Nombre',
      fieldDescription: 'Descripción',
      fieldTools: 'Herramientas',
      fieldToolsPlaceholder: 'Nombres de herramientas separados por comas. * hereda todas; vacío niega todas las heredadas.',
      fieldModel: 'Modelo',
      fieldModelPlaceholder: 'p. ej. deepseek-flash (vacío = heredado)',
      fieldProvider: 'Proveedor',
      fieldProviderInherit: 'Heredar (vacío)',
      fieldReasoning: 'Esfuerzo de razonamiento',
      fieldReasoningPlaceholder: 'p. ej. high (vacío = heredado)',
      fieldContext: 'Contexto',
      fieldContextAbsent: 'Sin especificar',
      fieldContextFresh: 'fresh',
      fieldContextFork: 'fork',
      fieldUserInvocable: 'Invocable manualmente',
      fieldUserInvocableHint: 'También registra esta Soul como comando de barra.',
      fieldExtraFrontmatter: 'Frontmatter adicional',
      fieldExtraFrontmatterHint: 'Líneas YAML sin procesar para claves que este editor no modela. Se conservan tal cual.',
      fieldExtraMarkdown: 'Markdown adicional',
      fieldExtraMarkdownHint: 'Contenido fuera de las cuatro secciones; se convierte en el preámbulo.',
      sectionsHint: 'Cada sección tiene su propia área de texto para poder copiarla y pegarla por separado.',
      sectionRole: 'Definición del rol',
      sectionInputs: 'Entradas que verás',
      sectionRules: 'Reglas estrictas',
      sectionOutput: 'Formato de salida',
      saveButton: 'Guardar',
      savingButton: 'Guardando…',
      deleteButton: 'Eliminar',
      deletingButton: 'Eliminando…',
      confirmDeleteButton: 'Confirmar eliminación',
      cancelButton: 'Cancelar',
      retryButton: 'Reintentar',
      createButton: 'Crear',
      creatingButton: 'Creando…',
      createHeading: 'Nueva Soul',
      createName: 'Nombre',
      createNamePlaceholder: 'lower-kebab-case, p. ej. researcher',
      createHint: 'Crea <first soul directory>/<name>.md a partir de la plantilla elegida.',
      createNameRequired: 'Introduce primero un nombre.',
      confirmDelete: '¿Eliminar «{name}»? El archivo Markdown se mueve a la papelera cuando el Host lo admite.',
      errorTitle: 'No se pudo cargar el catálogo de Souls',
      errorBody: 'Las rutas del Host para esta página no respondieron. Comprueba que el plugin esté activo y vuelve a intentarlo.',
      errorDocumentTitle: 'No se pudo abrir esta Soul',
      errorNetwork: 'La solicitud de red falló.',
      errorCodeInvalid: 'El documento no es válido, así que no se guardó nada.',
      errorCodeInvalidName: 'Ese nombre no es válido. Usa lower-kebab-case, como máximo 64 caracteres y no "lead".',
      errorCodeExists: 'Ya existe una Soul con ese nombre.',
      errorCodeNoDirs: 'Todavía no existe ningún directorio de Souls. Revisa la configuración del plugin.',
      errorCodeNotFound: 'El archivo ya no existe. Actualiza la lista.',
      errorCodeUnsafePath: 'Esa ruta está fuera de los directorios de Souls configurados.',
      errorCodeInvalidRequest: 'El Host rechazó la solicitud por estar mal formada.',
      errorCodeInvalidResponse: 'El Host devolvió una respuesta inesperada. Actualiza la página o vuelve a intentarlo.',
      errorUnknown: 'La solicitud falló ({code}).',
      diagnosticsHeading: 'Diagnósticos',
      scanDiagnosticsHeading: 'Diagnósticos del escaneo',
      infoHeading: 'Ajustes del plugin y ejecución',
      infoPlugin: 'Plugin',
      infoRoot: 'Raíz del espacio de trabajo',
      infoDirs: 'Directorios de Souls',
      infoDirsEmpty: 'No se resuelve ningún directorio de Souls para este espacio de trabajo.',
      pageTitle: 'Usar los Agent Souls predeterminados',
      pageDescription: 'Cuando está activado, las almas predeterminadas incluidas con el plugin y la doctrina del orquestador son las definiciones activas y se abren para editar en Ajustes > Agent Soul. Cuando está desactivado, siguen siendo valores predeterminados de solo lectura y personalizas copias en el espacio de trabajo.',
      toggleLabel: 'Usar los agent souls predeterminados',
      cardLabel: 'Usar los agent souls predeterminados',
      summary: 'Editar en el mismo lugar las almas predeterminadas incluidas con el plugin en lugar de copiarlas.',
      statusOn: 'Activado - los valores predeterminados incluidos se editan en el mismo lugar',
      statusOff: 'Desactivado - los valores predeterminados incluidos son de solo lectura',
      statusUnavailable: 'No disponible - los valores predeterminados incluidos están desactivados (bundled: false)',
      statusNotConfigurable: 'No disponible - este perfil no puede guardar este ajuste',
      statusApplying: 'Aplicando… el plugin se recarga una vez',
      statusApplied: 'Aplicado.',
      statusUnverified: 'Guardado, pero no se confirmó la recarga. Recarga la página para verificar el nuevo valor.',
      statusError: 'No se pudo actualizar la configuración del plugin.',
      infoBindings: 'Archivo de vínculos',
      infoBindingsCount: '{count} vínculos guardados',
      infoBindingsUnreadable: 'Recuento no disponible',
      infoProviders: 'Proveedores',
      infoProvidersEmpty: 'El Host no informa de ningún proveedor.',
      infoCommandPrefix: 'Prefijo de comando',
      infoCommandPrefixNone: 'ninguno',
      infoDefaultContext: 'Contexto predeterminado',
      infoSpawnProviders: 'Proveedores de creación',
      infoLimitsLabel: 'Límites',
      infoLimits: 'Hasta {definitions} definiciones · {chars} caracteres de prompt',
      infoScanTime: 'Último escaneo',
      infoScanNever: 'nunca',
      infoLiveTeams: 'Comandos de equipos activos',
      infoLiveTeamsEmpty: 'Ninguna sesión de equipo activa informa de comandos.',
      infoTeamLead: 'Lead {lead}',
      infoDelegation: 'Delegación',
      infoDelegationHint: 'Inicia un compañero con esta Soul:',
      infoDelegationExample: 'spawn_teammate({ …, agent_type: "<name>" })',
      infoMarkdownNote: 'Las Souls son Markdown simple (frontmatter YAML y cuerpo). Guardar escribe el archivo directamente; no hay una base de datos aparte.',
      statusLoading: 'Cargando…',
      statusRefreshed: 'Recargado desde el disco.',
      statusSaved: 'Guardado. La próxima creación usará esta Soul.',
      statusCreated: '{name} creada.',
      statusDeleted: '{name} eliminada.',
      statusSaving: 'Guardando…',
      statusDeleting: 'Eliminando…',
      statusCreating: 'Creando…',
      statusOpening: 'Abriendo…',
      searchLabel: 'Buscar Souls',
      searchPlaceholder: 'Buscar por nombre, descripción, ruta de origen o nombre de archivo',
      filterLabel: 'Filtrar Souls',
      filterAll: 'Todas',
      filterUser: 'Invocable manualmente',
      filterAi: 'Solo IA',
      filterInvalid: 'No válidas',
      sortLabel: 'Ordenar Souls',
      sortName: 'Nombre',
      sortUpdated: 'Actualización',
      noMatchesTitle: 'No hay Souls coincidentes',
      noMatchesBody: 'Ajusta la búsqueda o los filtros y vuelve a intentarlo.',
      clearFiltersButton: 'Borrar filtros',
      unsavedGuardTitle: 'Cambios sin guardar',
      unsavedGuardText: '«{name}» tiene cambios sin guardar. ¿Descartarlos antes de continuar?',
      discardChangesButton: 'Descartar cambios',
      keepEditingButton: 'Seguir editando',
      draftFoundTitle: 'Recuperar un borrador sin guardar',
      draftFoundText: 'Un borrador guardado localmente el {time} es más reciente que el archivo. ¿Restaurarlo?',
      restoreDraftButton: 'Restaurar borrador',
      discardDraftButton: 'Descartar borrador',
      conflictTitle: 'El archivo cambió en el disco',
      conflictText: 'Este archivo cambió antes de guardar ({time}). Recárgalo o sobrescríbelo con tus cambios.',
      reloadFileButton: 'Recargar archivo',
      overwriteButton: 'Sobrescribir',
      fieldErrorSummary: 'Corrige estos campos',
      revertButton: 'Revertir',
      statusReverted: 'Se restauró el último contenido cargado.',
      copyButton: 'Copiar',
      copiedButton: 'Copiado',
      copyFailed: 'No se pudo copiar al portapapeles.',
      emptyDirsHint: 'Las Souls son los archivos Markdown de estos directorios.',
      errorCodeConflict: 'El archivo cambió, así que no se guardó nada.',
      fieldToolsAdvanced: 'Herramientas (separadas por comas)',
      fieldToolsAdvancedHint: 'El selector y esta lista se mantienen sincronizados. * hereda todas; vacío niega todas.',
      toolsInheritAll: 'Heredar todas las herramientas',
      toolsInheritHint: 'El compañero puede usar todas las herramientas que el Lead pueda compartir.',
      toolsNoneHint: 'Ninguna herramienta seleccionada: el compañero no hereda ninguna.',
      toolsCustomHint: 'Haz clic en una herramienta para activarla o desactivarla. Los nombres que faltan del catálogo activo siguen visibles para que puedas quitarlos.',
      toolsCount: '{count} seleccionadas',
      toolsCatalogEmpty: 'El Host no informa de un catálogo de herramientas activo, así que este selector está vacío. Usa la lista avanzada.',
      toolsUnknownHeading: 'Fuera del catálogo activo',
      toolsUnknownHint: 'El Lead activo no ofrece estos nombres. Quítalos a menos que los quieras de verdad.',
      toolsTeamAlwaysHint: 'Las herramientas de equipo siempre están disponibles y no se pueden restringir; listarlas aquí es inocuo y la matriz las omite.',
      toolsRemove: 'Quitar {name}',
      toolsToggle: 'Activar o desactivar {name}',
      modelInheritOption: 'Heredar del Lead',
      modelNotInCatalog: '{model} (fuera del catálogo)',
      modelPickerHint: 'Elige una ruta del catálogo activo; los campos sin procesar de Avanzado siguen siendo la referencia.',
      modelCatalogEmpty: 'El Host no informa de un catálogo de modelos; edita los campos sin procesar de Avanzado.',
      modelResolvedLabel: 'Ruta resuelta',
      modelResolvedInherited: 'Heredada del Lead',
      advancedModel: 'Modelo (texto libre)',
      advancedProvider: 'Proveedor (texto libre)',
      advancedHint: 'Estos campos prevalecen sobre los selectores; déjalos vacíos para heredar.',
      previewHeading: 'Lo que recibirá el compañero',
      previewHint: 'Vista previa sin escritura de la persona, la ruta, las herramientas y la línea del catálogo de prompts.',
      previewShow: 'Mostrar vista previa',
      previewHide: 'Ocultar vista previa',
      previewLoading: 'Componiendo la vista previa…',
      previewError: 'No se pudo componer la vista previa. La edición no se ve afectada.',
      previewRetry: 'Reintentar vista previa',
      previewValid: 'Válida',
      previewInvalid: 'No válida: corrige los diagnósticos de abajo.',
      previewPersona: 'Persona',
      previewPersonaHint: 'Compuesta a partir de la definición del rol, las entradas, las reglas estrictas y el formato de salida.',
      previewResolvedModel: 'Modelo resuelto',
      previewCommand: 'Estado del comando',
      previewTools: 'Matriz de herramientas',
      previewToolsInheritAll: 'Hereda todas las herramientas',
      previewToolsDenyAll: 'No hereda ninguna herramienta',
      previewToolUnknown: 'Fuera del catálogo activo',
      previewCatalogLine: 'Línea del catálogo de prompts',
      previewCatalogEmpty: 'Sin línea de catálogo: la Soul compuesta no es válida.',
      previewComposed: 'Markdown compuesto',
      previewComposedShow: 'Mostrar Markdown compuesto',
      previewComposedHide: 'Ocultar Markdown compuesto',
      previewDiagnostics: 'Diagnósticos de la vista previa',
      copyPersona: 'Copiar persona',
      copyCatalogLine: 'Copiar línea de catálogo',
      commandStatusRegistered: 'Registrado',
      commandStatusAiOnly: 'Solo IA',
      commandStatusInvalidName: 'Nombre no válido',
      commandStatusCollision: 'Colisión de comando',
      commandStatusNoLiveLead: 'Sin Lead activo',
      commandStatusUnknown: 'Estado desconocido',
      modeLabel: 'Modo de edición',
      modeForm: 'Formulario',
      modeRaw: 'Sin procesar',
      rawHeading: 'Markdown sin procesar',
      rawHint: 'Edita el texto completo del archivo. Guardar lo valida y recarga el documento.',
      statusRawSaved: 'Markdown sin procesar guardado y documento recargado.',
      pasteButton: 'Pegar Markdown',
      pasteHeading: 'Pegar o importar Markdown',
      pasteHint: 'Pega un archivo de Soul completo. El análisis no escribe nada.',
      pasteSourceLabel: 'Origen Markdown',
      pastePlaceholder: '---\nname: my-teammate\n---\n…',
      parseButton: 'Analizar',
      parsingButton: 'Analizando…',
      importButton: 'Importar al borrador',
      createFromPaste: 'Crear Soul',
      pasteIntoDraftHint: 'Los campos analizados reemplazan el borrador actual. No se guarda nada hasta pulsar Guardar.',
      pasteCreateHint: 'No hay ningún documento seleccionado: crea una Soul con el nombre y el origen analizados.',
      pasteEmpty: 'Pega primero Markdown.',
      pasteParseFirst: 'Analiza el Markdown pegado antes de importarlo.',
      pasteMissingName: 'El Markdown analizado no tiene un nombre válido. Selecciona un documento para importar o corrige el texto.',
      statusPasted: 'Markdown pegado importado al borrador. Revísalo y luego guarda.',
      statusPasteCreated: '{name} creada a partir del Markdown pegado.',
      parseHeading: 'Resultado del análisis',
      parseValid: 'El Markdown pegado es una Soul válida.',
      parseInvalid: 'El Markdown pegado tiene diagnósticos.',
      templatesLabel: 'Plantilla',
      templateBlank: 'En blanco',
      templateResearcher: 'Investigador',
      templateCodeReviewer: 'Revisor de código',
      templateDocsWriter: 'Redactor de docs',
      templateHint: 'La plantilla se compone en el navegador con este nombre y se envía como archivo nuevo.',
      duplicateButton: 'Duplicar',
      duplicateHeading: 'Duplicar esta Soul',
      duplicateName: 'Nombre nuevo',
      duplicateNamePlaceholder: 'lower-kebab-case, p. ej. researcher-copy',
      duplicateSubmit: 'Crear copia',
      duplicatingButton: 'Duplicando…',
      duplicateHint: 'Copia el archivo guardado en el disco; los cambios sin guardar no se incluyen.',
      statusDuplicated: 'Duplicada como {name}.',
      statusDeletedTrashed: '{name} eliminada. El archivo se movió a la papelera.',
      undoTitle: 'El archivo se puede recuperar',
      undoText: '«{name}» se movió a la papelera. ¿Restaurarlo ahora?',
      undoButton: 'Deshacer eliminación',
      undoingButton: 'Restaurando…',
      undoDismiss: 'Descartar',
      statusRestored: '{name} restaurada.',
      statusRestoring: 'Restaurando…',
      deleteTrashHint: 'Eliminar mueve el archivo a una papelera cuando el Host lo admite, así que puedes deshacerlo.',
      usageSaved: '{count} guardados',
      usageLastUsed: 'último uso {time}',
      usageNeverUsed: 'nunca usado',
      usageActive: 'en uso por {names}',
      commandStatusAria: 'Estado del comando: {status}',
      commandStatusHeading: 'Comando',
      commandStatusUnavailable: 'El Host no lo informa',
      catalogLineHeading: 'Cómo lo ve el Lead',
      catalogLineUnavailable: 'Todavía no se ha informado ninguna línea de catálogo.',
      healthHeading: 'Estado del entorno',
      healthHint: 'Presupuestos de todo el catálogo y hallazgos del escaneo. Las barras se vuelven rojas al superar el límite.',
      healthDefinitions: 'Presupuesto de definiciones',
      healthCatalogChars: 'Presupuesto de caracteres del catálogo',
      healthBudgetValue: '{used} de {max} usados',
      healthBudgetNoLimit: 'Sin límite informado · {used} usados',
      healthBudgetUnknown: 'Uso no informado',
      healthDuplicatesHeading: 'Nombres duplicados',
      healthNoDuplicates: 'No hay nombres duplicados.',
      healthDuplicateLabel: 'Nombre duplicado',
      healthInvalidFiles: 'Archivos no válidos',
      healthScanDiagnostics: 'Diagnósticos del escaneo',
      healthNoDiagnostics: 'No hay diagnósticos del escaneo.',
      healthNotReported: 'No informado',
      healthTeamTools: 'Superficie de herramientas Team',
      diagnosticOpenFile: 'Abrir {file} en el editor',
      infoLiveTeamMember: '1 miembro',
      infoLiveTeamMembers: '{count} miembros',
      infoTeamSpawnNote: 'Los cambios se aplican a la próxima creación, no a los compañeros en ejecución.',
      closeDialog: 'Cerrar el cuadro de diálogo',
      resizeHandle: 'Cambiar el tamaño del diálogo (arrastrar o flechas)',
      resetSizeButton: 'Restablecer tamaño',
      tabSouls: 'Souls',
      tabOrchestrator: 'Orquestador',
      orchestratorHeading: 'Definición del orquestador',
      orchestratorIntro: 'La doctrina de orquestación del Lead y sus sustituciones de modelo y herramientas. Las Souls de subagentes siguen guiando la delegación.',
      orchestratorHint: 'Se aplica tras `/orchestrate` en este chat (también activa Agent Teams); `/orchestrate off` sale del modo y desactiva Agent Teams. El modo se recuerda por sesión.',
      orchestratorActivation: 'Comandos del chat',
      orchestratorCommand: '/orchestrate',
      orchestratorCommandOff: '/orchestrate off',
      orchestratorPath: 'Archivo de definición',
      orchestratorEditButton: 'Editar orquestador',
      orchestratorCreateButton: 'Crear orquestador predeterminado',
      orchestratorCreateHint: 'Compone las seis secciones canónicas y la configuración predeterminada en el navegador y luego escribe el archivo.',
      orchestratorDialogHint: 'Guardar escribe el archivo de definición. Se aplica la próxima vez que se ejecute `/orchestrate` en un chat.',
      orchestratorMissingTitle: 'Aún no hay definición del orquestador',
      orchestratorMissingBody: 'Crea la definición predeterminada para describir cómo el Lead planifica, delega, hace seguimiento del estado, verifica el trabajo y se recupera de fallos.',
      orchestratorConfigured: 'Configurado',
      badgeBundled: 'Integrado',
      bundledSoulNotice: 'Esta alma es un valor predeterminado incluido con el plugin. Aquí es de solo lectura; duplíquela en un directorio de almas del espacio de trabajo para personalizarla.',
      orchestratorBundledHint: 'Se está usando la doctrina predeterminada incluida con el plugin. Guardar escribe una definición propia del espacio de trabajo en la ruta anterior; elimine ese archivo para volver a la definición integrada.',
      orchestratorUnconfigured: 'Sin crear',
      orchestratorBadgePlan: 'Planificar primero: {value}',
      orchestratorBadgeGate: 'Modo de control: {mode}',
      orchestratorBadgeRetries: 'Reintentos máx.: {count}',
      orchestratorBadgePause: 'Pausar en error fatal: {value}',
      valueOn: 'activado',
      valueOff: 'desactivado',
      gateModeStrict: 'estricto',
      gateModeAdvisory: 'consultivo',
      gateModeOff: 'desactivado',
      groupOrchestratorConfig: 'Configuración del orquestador',
      groupOrchestratorSections: 'Secciones de orquestación',
      orchestratorConfigHint: 'Enrutamiento y límites de seguridad aplicados al activar. Un modelo y un proveedor vacíos conservan la ruta del Lead.',
      orchestratorSectionsHint: 'Cada sección canónica tiene su propio área de texto. Las secciones vacías se omiten al aplicar el modo.',
      fieldPlanFirst: 'Planificar primero',
      fieldPlanFirstHint: 'Pedir un plan escrito antes de delegar trabajo.',
      fieldPauseOnFatal: 'Pausar en error fatal',
      fieldPauseOnFatalHint: 'Dejar de delegar tras un fallo irrecuperable en lugar de reintentar.',
      fieldGateMode: 'Modo de control',
      fieldMaxRetries: 'Reintentos máx.',
      sectionIdentity: 'Identidad y límites',
      sectionPlan: 'Generación del plan',
      sectionDelegation: 'Delegación y minimización del contexto',
      sectionState: 'Seguimiento del estado',
      sectionVerification: 'Verificación de calidad',
      sectionRecovery: 'Excepciones y recuperación',
      statusOrchestratorSaved: 'Orquestador guardado. Se aplica la próxima vez que se ejecute `/orchestrate` en un chat.',
      statusOrchestratorCreated: 'Se creó la definición predeterminada del orquestador.',
      errorOrchestratorTitle: 'No se pudo cargar la definición del orquestador',
      orchestratorBadgeLabel: 'Modo orquestador activado',
      orchestratorBadgeTitle: 'El modo orquestador está activado. Ejecuta /orchestrate off para salir.',
      orchestratorBadgeAria: 'El modo orquestador está activado. Ejecuta /orchestrate off para salir.',
    }

    /** Russian copy (русский) for the same keys. */
    const ru = {
      nav: 'Agent Soul',
      title: 'Agent Soul',
      intro: 'Каждая Soul агента — это файл Markdown: YAML-frontmatter для маршрутизации и разрешений, затем разделы промпта. Сохранение записывает файл, и следующее создание участника использует его.',
      newButton: 'Новая Soul',
      refreshButton: 'Обновить',
      refreshBusy: 'Обновление…',
      scanLine: 'Последнее сканирование {time} · {valid} валидных · {invalid} невалидных',
      scanNever: 'Сканирования ещё не было · {valid} валидных · {invalid} невалидных',
      listHeading: 'Souls',
      listCount: '{count}',
      listEmptyTitle: 'Пока нет файлов Souls',
      listEmptyBody: 'Создайте её, чтобы задать участнику персону и разрешения в Markdown.',
      listNoDescription: 'Нет описания',
      listOpen: 'Редактировать {name}',
      badgeValid: 'Валидна',
      badgeInvalid: 'Невалидна',
      badgeAllTools: 'Все инструменты',
      badgeNoTools: 'Без инструментов',
      badgeTools: 'Инструментов: {count}',
      badgeModel: 'Модель: {model}',
      badgeContext: 'Контекст: {context}',
      defaultSoulLabel: 'Soul по умолчанию',
      defaultSoulHint: 'Используется spawn_teammate, когда agent_type не указан. Каждый дочерний участник Team должен работать с определённой Soul.',
      defaultSoulAutoOption: 'Встроенная по умолчанию (generalist)',
      defaultSoulMissingOption: '{name} (нет в каталоге)',
      badgeDefault: 'По умолчанию',
      defaultWarningTitle: 'Предупреждение о Soul по умолчанию',
      defaultWarningBody: '{message}',
      statusDefaultSaved: 'Soul по умолчанию: {name}.',
      statusDefaultCleared: 'Выбор Soul по умолчанию сброшен.',
      emptyTitle: 'Ничего не выбрано',
      emptyBody: 'Выберите Soul в списке или создайте новую.',
      editorHeading: 'Редактирование {name}',
      dirtyHint: 'Несохранённые изменения',
      groupIdentity: 'Идентичность',
      groupRouting: 'Маршрутизация и разрешения',
      groupMarkdown: 'Разделы Markdown',
      groupAdvanced: 'Дополнительно',
      fieldName: 'Имя',
      fieldDescription: 'Описание',
      fieldTools: 'Инструменты',
      fieldToolsPlaceholder: 'Имена инструментов через запятую. * наследует все инструменты; пусто — запрещает все наследуемые.',
      fieldModel: 'Модель',
      fieldModelPlaceholder: 'например, deepseek-flash (пусто — наследовать)',
      fieldProvider: 'Провайдер',
      fieldProviderInherit: 'Наследовать (пусто)',
      fieldReasoning: 'Усилие рассуждения',
      fieldReasoningPlaceholder: 'например, high (пусто — наследовать)',
      fieldContext: 'Контекст',
      fieldContextAbsent: 'Не указано',
      fieldContextFresh: 'fresh',
      fieldContextFork: 'fork',
      fieldUserInvocable: 'Вызывается вручную',
      fieldUserInvocableHint: 'Также регистрирует Soul как slash-команду.',
      fieldExtraFrontmatter: 'Дополнительный frontmatter',
      fieldExtraFrontmatterHint: 'Сырые строки YAML для ключей, которые не поддерживает этот редактор. Сохраняются как есть.',
      fieldExtraMarkdown: 'Дополнительный Markdown',
      fieldExtraMarkdownHint: 'Содержимое вне четырёх разделов; становится вступлением.',
      sectionsHint: 'У каждого раздела своё текстовое поле, чтобы его можно было скопировать и вставить отдельно.',
      sectionRole: 'Определение роли',
      sectionInputs: 'Входные данные, которые вы увидите',
      sectionRules: 'Жёсткие правила',
      sectionOutput: 'Формат вывода',
      saveButton: 'Сохранить',
      savingButton: 'Сохранение…',
      deleteButton: 'Удалить',
      deletingButton: 'Удаление…',
      confirmDeleteButton: 'Подтвердить удаление',
      cancelButton: 'Отмена',
      retryButton: 'Повторить',
      createButton: 'Создать',
      creatingButton: 'Создание…',
      createHeading: 'Новая Soul',
      createName: 'Имя',
      createNamePlaceholder: 'lower-kebab-case, например researcher',
      createHint: 'Создаёт <first soul directory>/<name>.md из выбранного шаблона.',
      createNameRequired: 'Сначала введите имя.',
      confirmDelete: 'Удалить «{name}»? Файл Markdown переместится в корзину, если Host это поддерживает.',
      errorTitle: 'Не удалось загрузить каталог Souls',
      errorBody: 'Маршруты Host для этой страницы не ответили. Проверьте, что плагин активен, и повторите попытку.',
      errorDocumentTitle: 'Не удалось открыть эту Soul',
      errorNetwork: 'Сетевой запрос не удался.',
      errorCodeInvalid: 'Документ невалиден, поэтому ничего не сохранено.',
      errorCodeInvalidName: 'Имя недопустимо. Используйте lower-kebab-case, не более 64 символов и не "lead".',
      errorCodeExists: 'Soul с таким именем уже существует.',
      errorCodeNoDirs: 'Каталог Souls ещё не существует. Проверьте конфигурацию плагина.',
      errorCodeNotFound: 'Файл больше не существует. Обновите список.',
      errorCodeUnsafePath: 'Этот путь находится вне настроенных каталогов Souls.',
      errorCodeInvalidRequest: 'Host отклонил запрос как некорректный.',
      errorCodeInvalidResponse: 'Хост вернул неожиданный ответ. Обновите страницу или повторите попытку.',
      errorUnknown: 'Запрос не выполнен ({code}).',
      diagnosticsHeading: 'Диагностика',
      scanDiagnosticsHeading: 'Диагностика сканирования',
      infoHeading: 'Настройки плагина и среда выполнения',
      infoPlugin: 'Плагин',
      infoRoot: 'Корень рабочей области',
      infoDirs: 'Каталоги Souls',
      infoDirsEmpty: 'Для этой рабочей области не найдено ни одного каталога Souls.',
      pageTitle: 'Использовать Agent Souls по умолчанию',
      pageDescription: 'Когда включено, встроенные души плагина и доктрина оркестратора по умолчанию являются действующими определениями и открываются для редактирования в «Настройки > Agent Soul». Когда выключено, это значения по умолчанию только для чтения, а копии настраиваются в рабочей области.',
      toggleLabel: 'Использовать agent souls по умолчанию',
      cardLabel: 'Использовать agent souls по умолчанию',
      summary: 'Редактировать встроенные души плагина на месте, а не копировать их.',
      statusOn: 'Включено — встроенные значения по умолчанию редактируются на месте',
      statusOff: 'Выключено — встроенные значения по умолчанию только для чтения',
      statusUnavailable: 'Недоступно — встроенные значения по умолчанию отключены (bundled: false)',
      statusNotConfigurable: 'Недоступно — этот профиль не может сохранить настройку',
      statusApplying: 'Применение… плагин перезагрузится один раз',
      statusApplied: 'Применено.',
      statusUnverified: 'Сохранено, но перезагрузка не подтверждена. Обновите страницу, чтобы проверить новое значение.',
      statusError: 'Не удалось обновить конфигурацию плагина.',
      infoBindings: 'Файл привязок',
      infoBindingsCount: 'Сохранено привязок: {count}',
      infoBindingsUnreadable: 'Количество недоступно',
      infoProviders: 'Провайдеры',
      infoProvidersEmpty: 'Host не сообщает провайдеров.',
      infoCommandPrefix: 'Префикс команды',
      infoCommandPrefixNone: 'нет',
      infoDefaultContext: 'Контекст по умолчанию',
      infoSpawnProviders: 'Провайдеры создания',
      infoLimitsLabel: 'Лимиты',
      infoLimits: 'До {definitions} определений · {chars} символов промпта',
      infoScanTime: 'Последнее сканирование',
      infoScanNever: 'никогда',
      infoLiveTeams: 'Команды активных Team-сессий',
      infoLiveTeamsEmpty: 'Ни одна активная Team-сессия не сообщает команды.',
      infoTeamLead: 'Lead {lead}',
      infoDelegation: 'Делегирование',
      infoDelegationHint: 'Запустите участника с этой Soul:',
      infoDelegationExample: 'spawn_teammate({ …, agent_type: "<name>" })',
      infoMarkdownNote: 'Souls — это обычный Markdown (YAML-frontmatter и тело). Сохранение записывает файл напрямую; отдельной базы данных нет.',
      statusLoading: 'Загрузка…',
      statusRefreshed: 'Перезагружено с диска.',
      statusSaved: 'Сохранено. Следующее создание использует эту Soul.',
      statusCreated: '{name} создана.',
      statusDeleted: '{name} удалена.',
      statusSaving: 'Сохранение…',
      statusDeleting: 'Удаление…',
      statusCreating: 'Создание…',
      statusOpening: 'Открытие…',
      searchLabel: 'Поиск Souls',
      searchPlaceholder: 'Искать по имени, описанию, пути источника или имени файла',
      filterLabel: 'Фильтр Souls',
      filterAll: 'Все',
      filterUser: 'Вызываемые вручную',
      filterAi: 'Только ИИ',
      filterInvalid: 'Невалидные',
      sortLabel: 'Сортировка Souls',
      sortName: 'Имя',
      sortUpdated: 'Обновление',
      noMatchesTitle: 'Нет подходящих Souls',
      noMatchesBody: 'Измените поиск или фильтры и повторите попытку.',
      clearFiltersButton: 'Сбросить фильтры',
      unsavedGuardTitle: 'Несохранённые изменения',
      unsavedGuardText: 'В «{name}» есть несохранённые изменения. Отменить их, чтобы продолжить?',
      discardChangesButton: 'Отменить изменения',
      keepEditingButton: 'Продолжить редактирование',
      draftFoundTitle: 'Восстановить несохранённый черновик',
      draftFoundText: 'Локальный черновик от {time} новее файла. Восстановить его?',
      restoreDraftButton: 'Восстановить черновик',
      discardDraftButton: 'Отменить черновик',
      conflictTitle: 'Файл изменился на диске',
      conflictText: 'Этот файл изменился до сохранения ({time}). Перезагрузите его или перезапишите своими изменениями.',
      reloadFileButton: 'Перезагрузить файл',
      overwriteButton: 'Перезаписать',
      fieldErrorSummary: 'Исправьте эти поля',
      revertButton: 'Откатить',
      statusReverted: 'Возвращено последнее загруженное содержимое.',
      copyButton: 'Копировать',
      copiedButton: 'Скопировано',
      copyFailed: 'Не удалось скопировать в буфер обмена.',
      emptyDirsHint: 'Souls — это файлы Markdown в этих каталогах.',
      errorCodeConflict: 'Файл изменился, поэтому ничего не сохранено.',
      fieldToolsAdvanced: 'Инструменты (через запятую)',
      fieldToolsAdvancedHint: 'Выбор и список синхронизированы. * наследует все инструменты; пусто — запрещает все.',
      toolsInheritAll: 'Наследовать все инструменты',
      toolsInheritHint: 'Участник может использовать все инструменты, которые Lead может предоставить.',
      toolsNoneHint: 'Инструменты не выбраны: участник не наследует ни одного.',
      toolsCustomHint: 'Нажмите на инструмент, чтобы переключить его. Имена вне живого каталога остаются видимыми, чтобы их можно было убрать.',
      toolsCount: 'Выбрано: {count}',
      toolsCatalogEmpty: 'Host не сообщает живой каталог инструментов, поэтому выбор пуст. Используйте расширенный список.',
      toolsUnknownHeading: 'Нет в живом каталоге',
      toolsUnknownHint: 'Активный Lead не предлагает эти имена. Уберите их, если они не нужны.',
      toolsTeamAlwaysHint: 'Инструменты команды всегда доступны и не могут быть ограничены; перечислять их здесь безвредно — матрица их пропускает.',
      toolsRemove: 'Убрать {name}',
      toolsToggle: 'Переключить {name}',
      modelInheritOption: 'Наследовать от Lead',
      modelNotInCatalog: '{model} (нет в каталоге)',
      modelPickerHint: 'Выберите маршрут из живого каталога; сырые поля в «Дополнительно» остаются главными.',
      modelCatalogEmpty: 'Host не сообщает каталог моделей; отредактируйте сырые поля в «Дополнительно».',
      modelResolvedLabel: 'Разрешённый маршрут',
      modelResolvedInherited: 'Унаследовано от Lead',
      advancedModel: 'Модель (свободный текст)',
      advancedProvider: 'Провайдер (свободный текст)',
      advancedHint: 'Эти поля важнее выбора; оставьте пустыми, чтобы наследовать.',
      previewHeading: 'Что получит участник',
      previewHint: 'Предпросмотр без записи: персона, маршрут, инструменты и строка каталога промптов.',
      previewShow: 'Показать предпросмотр',
      previewHide: 'Скрыть предпросмотр',
      previewLoading: 'Составление предпросмотра…',
      previewError: 'Не удалось составить предпросмотр. Редактирование не затронуто.',
      previewRetry: 'Повторить предпросмотр',
      previewValid: 'Валидно',
      previewInvalid: 'Невалидно — исправьте диагностику ниже.',
      previewPersona: 'Персона',
      previewPersonaHint: 'Составлена из определения роли, входных данных, жёстких правил и формата вывода.',
      previewResolvedModel: 'Разрешённая модель',
      previewCommand: 'Статус команды',
      previewTools: 'Матрица инструментов',
      previewToolsInheritAll: 'Наследует все инструменты',
      previewToolsDenyAll: 'Не наследует инструменты',
      previewToolUnknown: 'Нет в живом каталоге',
      previewCatalogLine: 'Строка каталога промптов',
      previewCatalogEmpty: 'Нет строки каталога: составленная Soul невалидна.',
      previewComposed: 'Составленный Markdown',
      previewComposedShow: 'Показать составленный Markdown',
      previewComposedHide: 'Скрыть составленный Markdown',
      previewDiagnostics: 'Диагностика предпросмотра',
      copyPersona: 'Копировать персону',
      copyCatalogLine: 'Копировать строку каталога',
      commandStatusRegistered: 'Зарегистрирована',
      commandStatusAiOnly: 'Только ИИ',
      commandStatusInvalidName: 'Недопустимое имя',
      commandStatusCollision: 'Коллизия команд',
      commandStatusNoLiveLead: 'Нет активного Lead',
      commandStatusUnknown: 'Неизвестный статус',
      modeLabel: 'Режим редактора',
      modeForm: 'Форма',
      modeRaw: 'Исходник',
      rawHeading: 'Исходный Markdown',
      rawHint: 'Редактируйте полный текст файла. Сохранение проверяет его и перезагружает документ.',
      statusRawSaved: 'Исходный Markdown сохранён, документ перезагружен.',
      pasteButton: 'Вставить Markdown',
      pasteHeading: 'Вставить или импортировать Markdown',
      pasteHint: 'Вставьте полный файл Soul. Разбор ничего не записывает.',
      pasteSourceLabel: 'Исходный Markdown',
      pastePlaceholder: '---\nname: my-teammate\n---\n…',
      parseButton: 'Разобрать',
      parsingButton: 'Разбор…',
      importButton: 'Импортировать в черновик',
      createFromPaste: 'Создать Soul',
      pasteIntoDraftHint: 'Разобранные поля заменят текущий черновик. Ничего не сохраняется до нажатия «Сохранить».',
      pasteCreateHint: 'Документ не выбран: создайте новую Soul из разобранных имени и источника.',
      pasteEmpty: 'Сначала вставьте Markdown.',
      pasteParseFirst: 'Разберите вставленный Markdown перед импортом.',
      pasteMissingName: 'В разобранном Markdown нет допустимого имени. Выберите документ для импорта или исправьте текст.',
      statusPasted: 'Вставленный Markdown импортирован в черновик. Проверьте его и сохраните.',
      statusPasteCreated: '{name} создана из вставленного Markdown.',
      parseHeading: 'Результат разбора',
      parseValid: 'Вставленный Markdown — валидная Soul.',
      parseInvalid: 'В вставленном Markdown есть диагностика.',
      templatesLabel: 'Шаблон',
      templateBlank: 'Пустой',
      templateResearcher: 'Исследователь',
      templateCodeReviewer: 'Ревьюер кода',
      templateDocsWriter: 'Автор документации',
      templateHint: 'Шаблон составляется в браузере с этим именем и отправляется как новый файл.',
      duplicateButton: 'Дублировать',
      duplicateHeading: 'Дублировать эту Soul',
      duplicateName: 'Новое имя',
      duplicateNamePlaceholder: 'lower-kebab-case, например researcher-copy',
      duplicateSubmit: 'Создать копию',
      duplicatingButton: 'Дублирование…',
      duplicateHint: 'Копирует сохранённый файл на диске; несохранённые изменения не включаются.',
      statusDuplicated: 'Дублирована как {name}.',
      statusDeletedTrashed: '{name} удалена. Файл перемещён в корзину.',
      undoTitle: 'Файл можно восстановить',
      undoText: '«{name}» перемещена в корзину. Восстановить сейчас?',
      undoButton: 'Отменить удаление',
      undoingButton: 'Восстановление…',
      undoDismiss: 'Скрыть',
      statusRestored: '{name} восстановлена.',
      statusRestoring: 'Восстановление…',
      deleteTrashHint: 'Удаление перемещает файл в корзину, если Host это поддерживает, поэтому его можно вернуть.',
      usageSaved: 'Сохранено: {count}',
      usageLastUsed: 'последнее использование {time}',
      usageNeverUsed: 'не использовалась',
      usageActive: 'используется: {names}',
      commandStatusAria: 'Статус команды: {status}',
      commandStatusHeading: 'Команда',
      commandStatusUnavailable: 'Host не сообщает',
      catalogLineHeading: 'Как это видит Lead',
      catalogLineUnavailable: 'Строка каталога пока не передана.',
      healthHeading: 'Состояние среды',
      healthHint: 'Бюджеты всего каталога и результаты сканирования. При превышении лимита полосы становятся красными.',
      healthDefinitions: 'Бюджет определений',
      healthCatalogChars: 'Бюджет символов каталога',
      healthBudgetValue: 'Использовано {used} из {max}',
      healthBudgetNoLimit: 'Лимит не указан · использовано {used}',
      healthBudgetUnknown: 'Использование не передано',
      healthDuplicatesHeading: 'Повторяющиеся имена',
      healthNoDuplicates: 'Повторяющихся имён нет.',
      healthDuplicateLabel: 'Повторяющееся имя',
      healthInvalidFiles: 'Невалидные файлы',
      healthScanDiagnostics: 'Диагностика сканирования',
      healthNoDiagnostics: 'Диагностики сканирования нет.',
      healthNotReported: 'Не передано',
      healthTeamTools: 'Поверхность инструментов Team',
      diagnosticOpenFile: 'Открыть {file} в редакторе',
      infoLiveTeamMember: '1 участник',
      infoLiveTeamMembers: 'Участников: {count}',
      infoTeamSpawnNote: 'Изменения применяются к следующему созданию, а не к работающим участникам.',
      closeDialog: 'Закрыть диалог',
      resizeHandle: 'Изменить размер диалога (перетаскивание или стрелки)',
      resetSizeButton: 'Сбросить размер',
      tabSouls: 'Souls',
      tabOrchestrator: 'Оркестратор',
      orchestratorHeading: 'Определение оркестратора',
      orchestratorIntro: 'Доктрина оркестрации Lead и переопределения модели и инструментов. Souls субагентов по-прежнему управляют делегированием.',
      orchestratorHint: 'Применяется после `/orchestrate` в этом чате (также включает Agent Teams); `/orchestrate off` выходит из режима и отключает Agent Teams. Режим запоминается для сессии.',
      orchestratorActivation: 'Команды чата',
      orchestratorCommand: '/orchestrate',
      orchestratorCommandOff: '/orchestrate off',
      orchestratorPath: 'Файл определения',
      orchestratorEditButton: 'Изменить оркестратор',
      orchestratorCreateButton: 'Создать оркестратор по умолчанию',
      orchestratorCreateHint: 'Собирает шесть канонических разделов и конфигурацию по умолчанию в браузере, затем записывает файл.',
      orchestratorDialogHint: 'Сохранение записывает файл определения. Он применяется при следующем запуске `/orchestrate` в чате.',
      orchestratorMissingTitle: 'Определения оркестратора пока нет',
      orchestratorMissingBody: 'Создайте определение по умолчанию, чтобы описать, как Lead планирует, делегирует, отслеживает состояние, проверяет работу и восстанавливается после сбоев.',
      orchestratorConfigured: 'Настроен',
      badgeBundled: 'Встроенный',
      bundledSoulNotice: 'Эта душа — встроенное значение плагина по умолчанию. Здесь она доступна только для чтения; скопируйте её в каталог душ рабочего пространства, чтобы настроить.',
      orchestratorBundledHint: 'Используется встроенная доктрина плагина по умолчанию. Сохранение запишет определение для текущего рабочего пространства по указанному выше пути; удалите этот файл, чтобы вернуться к встроенной доктрине.',
      orchestratorUnconfigured: 'Не создан',
      orchestratorBadgePlan: 'Сначала план: {value}',
      orchestratorBadgeGate: 'Режим контроля: {mode}',
      orchestratorBadgeRetries: 'Макс. повторов: {count}',
      orchestratorBadgePause: 'Пауза при фатальной ошибке: {value}',
      valueOn: 'вкл.',
      valueOff: 'выкл.',
      gateModeStrict: 'строгий',
      gateModeAdvisory: 'советующий',
      gateModeOff: 'выключен',
      groupOrchestratorConfig: 'Конфигурация оркестратора',
      groupOrchestratorSections: 'Разделы оркестрации',
      orchestratorConfigHint: 'Маршрутизация и ограничения безопасности, применяемые при активации. Пустые модель и провайдер сохраняют маршрут Lead.',
      orchestratorSectionsHint: 'Каждый канонический раздел — отдельное текстовое поле. Пустые разделы пропускаются при применении режима.',
      fieldPlanFirst: 'Сначала план',
      fieldPlanFirstHint: 'Требовать письменный план перед делегированием работы.',
      fieldPauseOnFatal: 'Пауза при фатальной ошибке',
      fieldPauseOnFatalHint: 'Останавливать делегирование после неисправимого сбоя вместо повторной попытки.',
      fieldGateMode: 'Режим контроля',
      fieldMaxRetries: 'Макс. повторов',
      sectionIdentity: 'Идентичность и границы',
      sectionPlan: 'Генерация плана',
      sectionDelegation: 'Делегирование и минимизация контекста',
      sectionState: 'Отслеживание состояния',
      sectionVerification: 'Проверка качества',
      sectionRecovery: 'Исключения и восстановление',
      statusOrchestratorSaved: 'Оркестратор сохранён. Он применяется при следующем запуске `/orchestrate` в чате.',
      statusOrchestratorCreated: 'Определение оркестратора по умолчанию создано.',
      errorOrchestratorTitle: 'Не удалось загрузить определение оркестратора',
      orchestratorBadgeLabel: 'Режим оркестратора включён',
      orchestratorBadgeTitle: 'Режим оркестратора включён. Чтобы выйти, выполните /orchestrate off.',
      orchestratorBadgeAria: 'Режим оркестратора включён. Чтобы выйти, выполните /orchestrate off.',
    }

    /** Portuguese copy (português) for the same keys. */
    const pt = {
      nav: 'Agent Soul',
      title: 'Agent Soul',
      intro: 'Cada Agent Soul é um arquivo Markdown: frontmatter YAML para roteamento e permissões, depois as seções de prompt. Salvar grava o arquivo; a próxima criação de companheiro o usará.',
      newButton: 'Nova Soul',
      refreshButton: 'Atualizar',
      refreshBusy: 'Atualizando…',
      scanLine: 'Último escaneamento {time} · {valid} válidas · {invalid} inválidas',
      scanNever: 'Nenhum escaneamento ainda · {valid} válidas · {invalid} inválidas',
      listHeading: 'Souls',
      listCount: '{count}',
      listEmptyTitle: 'Ainda não há arquivos de Soul',
      listEmptyBody: 'Crie uma para dar a um companheiro uma persona e permissões definidas em Markdown.',
      listNoDescription: 'Sem descrição',
      listOpen: 'Editar {name}',
      badgeValid: 'Válida',
      badgeInvalid: 'Inválida',
      badgeAllTools: 'Todas as ferramentas',
      badgeNoTools: 'Sem ferramentas',
      badgeTools: '{count} ferramentas',
      badgeModel: 'Modelo: {model}',
      badgeContext: 'Contexto: {context}',
      defaultSoulLabel: 'Soul padrão',
      defaultSoulHint: 'Usada por spawn_teammate quando agent_type é omitido. Todo filho do Team deve executar uma Soul definida.',
      defaultSoulAutoOption: 'Padrão incluída (generalist)',
      defaultSoulMissingOption: '{name} (fora do catálogo)',
      badgeDefault: 'Padrão',
      defaultWarningTitle: 'Aviso da Soul padrão',
      defaultWarningBody: '{message}',
      statusDefaultSaved: 'Soul padrão definida como {name}.',
      statusDefaultCleared: 'Seleção da Soul padrão limpa.',
      emptyTitle: 'Nada selecionado',
      emptyBody: 'Selecione uma Soul na lista ou crie uma nova.',
      editorHeading: 'Editando {name}',
      dirtyHint: 'Alterações não salvas',
      groupIdentity: 'Identidade',
      groupRouting: 'Roteamento e permissões',
      groupMarkdown: 'Seções Markdown',
      groupAdvanced: 'Avançado',
      fieldName: 'Nome',
      fieldDescription: 'Descrição',
      fieldTools: 'Ferramentas',
      fieldToolsPlaceholder: 'Nomes de ferramentas separados por vírgulas. * herda todas; vazio nega todas as herdadas.',
      fieldModel: 'Modelo',
      fieldModelPlaceholder: 'ex. deepseek-flash (vazio = herdado)',
      fieldProvider: 'Provedor',
      fieldProviderInherit: 'Herdar (vazio)',
      fieldReasoning: 'Esforço de raciocínio',
      fieldReasoningPlaceholder: 'ex. high (vazio = herdado)',
      fieldContext: 'Contexto',
      fieldContextAbsent: 'Não especificado',
      fieldContextFresh: 'fresh',
      fieldContextFork: 'fork',
      fieldUserInvocable: 'Invocável manualmente',
      fieldUserInvocableHint: 'Também registra esta Soul como comando de barra.',
      fieldExtraFrontmatter: 'Frontmatter extra',
      fieldExtraFrontmatterHint: 'Linhas YAML cruas para chaves que este editor não modela. Preservadas como estão.',
      fieldExtraMarkdown: 'Markdown extra',
      fieldExtraMarkdownHint: 'Conteúdo fora das quatro seções; ele se torna o preâmbulo.',
      sectionsHint: 'Cada seção tem sua própria área de texto para poder ser copiada e colada separadamente.',
      sectionRole: 'Definição da função',
      sectionInputs: 'Entradas que você verá',
      sectionRules: 'Regras rígidas',
      sectionOutput: 'Formato de saída',
      saveButton: 'Salvar',
      savingButton: 'Salvando…',
      deleteButton: 'Excluir',
      deletingButton: 'Excluindo…',
      confirmDeleteButton: 'Confirmar exclusão',
      cancelButton: 'Cancelar',
      retryButton: 'Tentar novamente',
      createButton: 'Criar',
      creatingButton: 'Criando…',
      createHeading: 'Nova Soul',
      createName: 'Nome',
      createNamePlaceholder: 'lower-kebab-case, ex. researcher',
      createHint: 'Cria <first soul directory>/<name>.md a partir do modelo escolhido.',
      createNameRequired: 'Digite um nome primeiro.',
      confirmDelete: 'Excluir "{name}"? O arquivo Markdown vai para a lixeira quando o Host oferece suporte.',
      errorTitle: 'Não foi possível carregar o catálogo de Souls',
      errorBody: 'As rotas do Host para esta página não responderam. Verifique se o plugin está ativo e tente novamente.',
      errorDocumentTitle: 'Não foi possível abrir esta Soul',
      errorNetwork: 'A requisição de rede falhou.',
      errorCodeInvalid: 'O documento é inválido, então nada foi salvo.',
      errorCodeInvalidName: 'Esse nome não é válido. Use lower-kebab-case, no máximo 64 caracteres e não "lead".',
      errorCodeExists: 'Já existe uma Soul com esse nome.',
      errorCodeNoDirs: 'Ainda não existe nenhum diretório de Souls. Verifique a configuração do plugin.',
      errorCodeNotFound: 'O arquivo não existe mais. Atualize a lista.',
      errorCodeUnsafePath: 'Esse caminho está fora dos diretórios de Souls configurados.',
      errorCodeInvalidRequest: 'O Host rejeitou a requisição por estar malformada.',
      errorCodeInvalidResponse: 'O Host retornou uma resposta inesperada. Atualize a página ou tente novamente.',
      errorUnknown: 'A requisição falhou ({code}).',
      diagnosticsHeading: 'Diagnósticos',
      scanDiagnosticsHeading: 'Diagnósticos do escaneamento',
      infoHeading: 'Configurações do plugin e execução',
      infoPlugin: 'Plugin',
      infoRoot: 'Raiz do workspace',
      infoDirs: 'Diretórios de Souls',
      infoDirsEmpty: 'Nenhum diretório de Souls é resolvido para este workspace.',
      pageTitle: 'Usar Agent Souls Padrão',
      pageDescription: 'Quando ativado, as almas padrão incluídas no plugin e a doutrina do orquestrador são as definições ativas e abrem para edição em Configurações > Agent Soul. Quando desativado, continuam sendo padrões somente leitura e você personaliza cópias no espaço de trabalho.',
      toggleLabel: 'Usar agent souls padrão',
      cardLabel: 'Usar agent souls padrão',
      summary: 'Editar no local as almas padrão incluídas no plugin em vez de copiá-las.',
      statusOn: 'Ativado - os padrões incluídos são editáveis no local',
      statusOff: 'Desativado - os padrões incluídos são somente leitura',
      statusUnavailable: 'Indisponível - os padrões incluídos estão desativados (bundled: false)',
      statusNotConfigurable: 'Indisponível - este perfil não pode salvar esta configuração',
      statusApplying: 'Aplicando… o plugin recarrega uma vez',
      statusApplied: 'Aplicado.',
      statusUnverified: 'Salvo, mas a recarga não foi confirmada. Atualize a página para verificar o novo valor.',
      statusError: 'Não foi possível atualizar a configuração do plugin.',
      infoBindings: 'Arquivo de vínculos',
      infoBindingsCount: '{count} vínculos salvos',
      infoBindingsUnreadable: 'Contagem indisponível',
      infoProviders: 'Provedores',
      infoProvidersEmpty: 'O Host não informa provedores.',
      infoCommandPrefix: 'Prefixo de comando',
      infoCommandPrefixNone: 'nenhum',
      infoDefaultContext: 'Contexto padrão',
      infoSpawnProviders: 'Provedores de criação',
      infoLimitsLabel: 'Limites',
      infoLimits: 'Até {definitions} definições · {chars} caracteres de prompt',
      infoScanTime: 'Último escaneamento',
      infoScanNever: 'nunca',
      infoLiveTeams: 'Comandos das equipes ativas',
      infoLiveTeamsEmpty: 'Nenhuma sessão de equipe ativa informa comandos.',
      infoTeamLead: 'Lead {lead}',
      infoDelegation: 'Delegação',
      infoDelegationHint: 'Inicie um companheiro com esta Soul:',
      infoDelegationExample: 'spawn_teammate({ …, agent_type: "<name>" })',
      infoMarkdownNote: 'Souls são Markdown simples (frontmatter YAML e corpo). Salvar grava o arquivo diretamente; não há um banco de dados separado.',
      statusLoading: 'Carregando…',
      statusRefreshed: 'Recarregado do disco.',
      statusSaved: 'Salvo. A próxima criação usará esta Soul.',
      statusCreated: '{name} criada.',
      statusDeleted: '{name} excluída.',
      statusSaving: 'Salvando…',
      statusDeleting: 'Excluindo…',
      statusCreating: 'Criando…',
      statusOpening: 'Abrindo…',
      searchLabel: 'Pesquisar Souls',
      searchPlaceholder: 'Pesquisar nome, descrição, caminho de origem ou nome de arquivo',
      filterLabel: 'Filtrar Souls',
      filterAll: 'Todas',
      filterUser: 'Invocável manualmente',
      filterAi: 'Somente IA',
      filterInvalid: 'Inválidas',
      sortLabel: 'Ordenar Souls',
      sortName: 'Nome',
      sortUpdated: 'Atualização',
      noMatchesTitle: 'Nenhuma Soul correspondente',
      noMatchesBody: 'Ajuste a pesquisa ou os filtros e tente novamente.',
      clearFiltersButton: 'Limpar filtros',
      unsavedGuardTitle: 'Alterações não salvas',
      unsavedGuardText: '"{name}" tem alterações não salvas. Descartá-las antes de continuar?',
      discardChangesButton: 'Descartar alterações',
      keepEditingButton: 'Continuar editando',
      draftFoundTitle: 'Recuperar um rascunho não salvo',
      draftFoundText: 'Um rascunho salvo localmente em {time} é mais recente que o arquivo. Restaurá-lo?',
      restoreDraftButton: 'Restaurar rascunho',
      discardDraftButton: 'Descartar rascunho',
      conflictTitle: 'O arquivo mudou no disco',
      conflictText: 'Este arquivo mudou antes de você salvar ({time}). Recarregue-o ou sobrescreva-o com suas alterações.',
      reloadFileButton: 'Recarregar arquivo',
      overwriteButton: 'Sobrescrever',
      fieldErrorSummary: 'Corrija estes campos',
      revertButton: 'Reverter',
      statusReverted: 'Revertido para o último conteúdo carregado.',
      copyButton: 'Copiar',
      copiedButton: 'Copiado',
      copyFailed: 'Não foi possível copiar para a área de transferência.',
      emptyDirsHint: 'As Souls são os arquivos Markdown destes diretórios.',
      errorCodeConflict: 'O arquivo mudou, então nada foi salvo.',
      fieldToolsAdvanced: 'Ferramentas (separadas por vírgulas)',
      fieldToolsAdvancedHint: 'O seletor e esta lista ficam sincronizados. * herda todas; vazio nega todas.',
      toolsInheritAll: 'Herdar todas as ferramentas',
      toolsInheritHint: 'O companheiro pode usar todas as ferramentas que o Lead puder compartilhar.',
      toolsNoneHint: 'Nenhuma ferramenta selecionada: o companheiro não herda nenhuma.',
      toolsCustomHint: 'Clique em uma ferramenta para ativá-la ou desativá-la. Nomes ausentes do catálogo ativo continuam visíveis para você removê-los.',
      toolsCount: '{count} selecionadas',
      toolsCatalogEmpty: 'O Host não informa um catálogo de ferramentas ativo, então este seletor está vazio. Use a lista avançada.',
      toolsUnknownHeading: 'Fora do catálogo ativo',
      toolsUnknownHint: 'O Lead ativo não oferece esses nomes. Remova-os a menos que você realmente os queira.',
      toolsTeamAlwaysHint: 'As ferramentas de equipe estão sempre disponíveis e não podem ser restringidas; listá-las aqui é inofensivo e a matriz as ignora.',
      toolsRemove: 'Remover {name}',
      toolsToggle: 'Ativar ou desativar {name}',
      modelInheritOption: 'Herdar do Lead',
      modelNotInCatalog: '{model} (fora do catálogo)',
      modelPickerHint: 'Escolha uma rota do catálogo ativo; os campos crus em Avançado continuam valendo.',
      modelCatalogEmpty: 'O Host não informa um catálogo de modelos; edite os campos crus em Avançado.',
      modelResolvedLabel: 'Rota resolvida',
      modelResolvedInherited: 'Herdada do Lead',
      advancedModel: 'Modelo (texto livre)',
      advancedProvider: 'Provedor (texto livre)',
      advancedHint: 'Estes campos prevalecem sobre os seletores; deixe-os vazios para herdar.',
      previewHeading: 'O que o companheiro receberá',
      previewHint: 'Prévia sem gravação da persona, rota, ferramentas e linha do catálogo de prompts.',
      previewShow: 'Mostrar prévia',
      previewHide: 'Ocultar prévia',
      previewLoading: 'Compondo a prévia…',
      previewError: 'Não foi possível compor a prévia. A edição não é afetada.',
      previewRetry: 'Tentar prévia novamente',
      previewValid: 'Válida',
      previewInvalid: 'Inválida — corrija os diagnósticos abaixo.',
      previewPersona: 'Persona',
      previewPersonaHint: 'Composta a partir da definição da função, entradas, regras rígidas e formato de saída.',
      previewResolvedModel: 'Modelo resolvido',
      previewCommand: 'Status do comando',
      previewTools: 'Matriz de ferramentas',
      previewToolsInheritAll: 'Herda todas as ferramentas',
      previewToolsDenyAll: 'Não herda nenhuma ferramenta',
      previewToolUnknown: 'Fora do catálogo ativo',
      previewCatalogLine: 'Linha do catálogo de prompts',
      previewCatalogEmpty: 'Sem linha de catálogo: a Soul composta é inválida.',
      previewComposed: 'Markdown composto',
      previewComposedShow: 'Mostrar Markdown composto',
      previewComposedHide: 'Ocultar Markdown composto',
      previewDiagnostics: 'Diagnósticos da prévia',
      copyPersona: 'Copiar persona',
      copyCatalogLine: 'Copiar linha do catálogo',
      commandStatusRegistered: 'Registrado',
      commandStatusAiOnly: 'Somente IA',
      commandStatusInvalidName: 'Nome inválido',
      commandStatusCollision: 'Colisão de comando',
      commandStatusNoLiveLead: 'Nenhum Lead ativo',
      commandStatusUnknown: 'Status desconhecido',
      modeLabel: 'Modo de edição',
      modeForm: 'Formulário',
      modeRaw: 'Bruto',
      rawHeading: 'Markdown bruto',
      rawHint: 'Edite o texto completo do arquivo. Salvar valida e recarrega o documento.',
      statusRawSaved: 'Markdown bruto salvo e documento recarregado.',
      pasteButton: 'Colar Markdown',
      pasteHeading: 'Colar ou importar Markdown',
      pasteHint: 'Cole um arquivo de Soul completo. A análise não grava nada.',
      pasteSourceLabel: 'Origem Markdown',
      pastePlaceholder: '---\nname: my-teammate\n---\n…',
      parseButton: 'Analisar',
      parsingButton: 'Analisando…',
      importButton: 'Importar para o rascunho',
      createFromPaste: 'Criar Soul',
      pasteIntoDraftHint: 'Os campos analisados substituem o rascunho atual. Nada é salvo até você clicar em Salvar.',
      pasteCreateHint: 'Nenhum documento selecionado: crie uma Soul com o nome e a origem analisados.',
      pasteEmpty: 'Cole Markdown primeiro.',
      pasteParseFirst: 'Analise o Markdown colado antes de importar.',
      pasteMissingName: 'O Markdown analisado não tem um nome válido. Selecione um documento para importar ou corrija o texto.',
      statusPasted: 'Markdown colado importado para o rascunho. Revise e depois salve.',
      statusPasteCreated: '{name} criada a partir do Markdown colado.',
      parseHeading: 'Resultado da análise',
      parseValid: 'O Markdown colado é uma Soul válida.',
      parseInvalid: 'O Markdown colado tem diagnósticos.',
      templatesLabel: 'Modelo',
      templateBlank: 'Em branco',
      templateResearcher: 'Pesquisador',
      templateCodeReviewer: 'Revisor de código',
      templateDocsWriter: 'Redator de docs',
      templateHint: 'O modelo é composto no navegador com este nome e enviado como novo arquivo.',
      duplicateButton: 'Duplicar',
      duplicateHeading: 'Duplicar esta Soul',
      duplicateName: 'Novo nome',
      duplicateNamePlaceholder: 'lower-kebab-case, ex. researcher-copy',
      duplicateSubmit: 'Criar cópia',
      duplicatingButton: 'Duplicando…',
      duplicateHint: 'Copia o arquivo salvo no disco; alterações não salvas não são incluídas.',
      statusDuplicated: 'Duplicada como {name}.',
      statusDeletedTrashed: '{name} excluída. O arquivo foi movido para a lixeira.',
      undoTitle: 'O arquivo é recuperável',
      undoText: '"{name}" foi movido para a lixeira. Restaurá-lo agora?',
      undoButton: 'Desfazer exclusão',
      undoingButton: 'Restaurando…',
      undoDismiss: 'Ignorar',
      statusRestored: '{name} restaurada.',
      statusRestoring: 'Restaurando…',
      deleteTrashHint: 'Excluir move o arquivo para uma lixeira quando o Host oferece suporte, então você pode desfazer.',
      usageSaved: '{count} salvos',
      usageLastUsed: 'último uso {time}',
      usageNeverUsed: 'nunca usado',
      usageActive: 'em uso por {names}',
      commandStatusAria: 'Status do comando: {status}',
      commandStatusHeading: 'Comando',
      commandStatusUnavailable: 'Não informado pelo Host',
      catalogLineHeading: 'Como o Lead vê',
      catalogLineUnavailable: 'Nenhuma linha de catálogo informada ainda.',
      healthHeading: 'Saúde da execução',
      healthHint: 'Orçamentos de todo o catálogo e achados do escaneamento. As barras ficam vermelhas acima do limite.',
      healthDefinitions: 'Orçamento de definições',
      healthCatalogChars: 'Orçamento de caracteres do catálogo',
      healthBudgetValue: '{used} de {max} usados',
      healthBudgetNoLimit: 'Nenhum limite informado · {used} usados',
      healthBudgetUnknown: 'Uso não informado',
      healthDuplicatesHeading: 'Nomes duplicados',
      healthNoDuplicates: 'Nenhum nome duplicado.',
      healthDuplicateLabel: 'Nome duplicado',
      healthInvalidFiles: 'Arquivos inválidos',
      healthScanDiagnostics: 'Diagnósticos do escaneamento',
      healthNoDiagnostics: 'Nenhum diagnóstico do escaneamento.',
      healthNotReported: 'Não informado',
      healthTeamTools: 'Superfície de ferramentas Team',
      diagnosticOpenFile: 'Abrir {file} no editor',
      infoLiveTeamMember: '1 membro',
      infoLiveTeamMembers: '{count} membros',
      infoTeamSpawnNote: 'As alterações valem para a próxima criação, não para companheiros em execução.',
      closeDialog: 'Fechar a caixa de diálogo',
      resizeHandle: 'Redimensionar a caixa de diálogo (arrastar ou setas)',
      resetSizeButton: 'Redefinir tamanho',
      tabSouls: 'Souls',
      tabOrchestrator: 'Orquestrador',
      orchestratorHeading: 'Definição do orquestrador',
      orchestratorIntro: 'A doutrina de orquestração do Lead e suas substituições de modelo e ferramentas. As Souls de subagentes continuam conduzindo a delegação.',
      orchestratorHint: 'Aplica-se após `/orchestrate` neste chat (também ativa o Agent Teams); `/orchestrate off` encerra e desativa o Agent Teams. O modo é lembrado por sessão.',
      orchestratorActivation: 'Comandos do chat',
      orchestratorCommand: '/orchestrate',
      orchestratorCommandOff: '/orchestrate off',
      orchestratorPath: 'Arquivo de definição',
      orchestratorEditButton: 'Editar orquestrador',
      orchestratorCreateButton: 'Criar orquestrador padrão',
      orchestratorCreateHint: 'Compõe as seis seções canônicas e a configuração padrão no navegador e então grava o arquivo.',
      orchestratorDialogHint: 'Salvar grava o arquivo de definição. Ele se aplica na próxima vez que `/orchestrate` for executado em um chat.',
      orchestratorMissingTitle: 'Ainda não há definição do orquestrador',
      orchestratorMissingBody: 'Crie a definição padrão para descrever como o Lead planeja, delega, acompanha o estado, verifica o trabalho e se recupera de falhas.',
      orchestratorConfigured: 'Configurado',
      badgeBundled: 'Embutido',
      bundledSoulNotice: 'Esta alma é um padrão incluído no plugin. Aqui ela é somente leitura; duplique-a em um diretório de almas do espaço de trabalho para personalizá-la.',
      orchestratorBundledHint: 'Usando a doutrina padrão incluída no plugin. Salvar grava uma definição específica do espaço de trabalho no caminho acima; exclua esse arquivo para voltar à doutrina incluída.',
      orchestratorUnconfigured: 'Não criado',
      orchestratorBadgePlan: 'Planejar primeiro: {value}',
      orchestratorBadgeGate: 'Modo de controle: {mode}',
      orchestratorBadgeRetries: 'Tentativas máx.: {count}',
      orchestratorBadgePause: 'Pausar em erro fatal: {value}',
      valueOn: 'ativado',
      valueOff: 'desativado',
      gateModeStrict: 'estrito',
      gateModeAdvisory: 'consultivo',
      gateModeOff: 'desativado',
      groupOrchestratorConfig: 'Configuração do orquestrador',
      groupOrchestratorSections: 'Seções de orquestração',
      orchestratorConfigHint: 'Roteamento e limites de segurança aplicados na ativação. Modelo e provedor vazios mantêm a rota do Lead.',
      orchestratorSectionsHint: 'Cada seção canônica tem sua própria área de texto. Seções vazias são ignoradas ao aplicar o modo.',
      fieldPlanFirst: 'Planejar primeiro',
      fieldPlanFirstHint: 'Exigir um plano escrito antes de delegar trabalho.',
      fieldPauseOnFatal: 'Pausar em erro fatal',
      fieldPauseOnFatalHint: 'Parar de delegar após uma falha irrecuperável em vez de tentar novamente.',
      fieldGateMode: 'Modo de controle',
      fieldMaxRetries: 'Tentativas máx.',
      sectionIdentity: 'Identidade e limites',
      sectionPlan: 'Geração do plano',
      sectionDelegation: 'Delegação e minimização de contexto',
      sectionState: 'Acompanhamento de estado',
      sectionVerification: 'Verificação de qualidade',
      sectionRecovery: 'Exceções e recuperação',
      statusOrchestratorSaved: 'Orquestrador salvo. Ele se aplica na próxima vez que `/orchestrate` for executado em um chat.',
      statusOrchestratorCreated: 'A definição padrão do orquestrador foi criada.',
      errorOrchestratorTitle: 'Não foi possível carregar a definição do orquestrador',
      orchestratorBadgeLabel: 'Modo orquestrador ativado',
      orchestratorBadgeTitle: 'O modo orquestrador está ativado. Execute /orchestrate off para sair.',
      orchestratorBadgeAria: 'O modo orquestrador está ativado. Execute /orchestrate off para sair.',
    }

    /** Session-header badge id: a fresh entry following Creator mode (agent-preset, -10). */
    const ORCHESTRATOR_BADGE_ID = 'agent-soul-orchestrator'

    /**
     * Compact, noninteractive status badge for durable Orchestrator mode.
     *
     * The Host derives the value from the same command-log fold the
     * `/orchestrate` runtime reads, so the badge cannot disagree with the mode.
     * It renders only for a root Lead Session (a child/teammate Session carries
     * a subagent address) and only while the folded mode is exactly `on`.
     *
     * Both framework hooks are called unconditionally, before either return.
     * Styles are an inline object on the badge so the page keeps its single
     * `<style>` element, and every color/radius comes from a theme token.
     */
    function OrchestratorModeBadge(props) {
      const mode = props.useProjection('agentSoulOrchestrator')
      const subagent = props.useSession(function (snapshot) { return snapshot.subagent })
      if (mode !== 'on' || subagent !== null) return null
      return h('span', {
        className: 'agent-soul-orchestrator-badge',
        title: props.t('orchestratorBadgeTitle'),
        'aria-label': props.t('orchestratorBadgeAria'),
        role: 'status',
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '1px 7px',
          border: '0.5px solid var(--dsw-alias-state-success-primary)',
          borderRadius: 'var(--dsw-radius-sm)',
          background: 'var(--dsw-alias-bg-layer-2)',
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: '11px',
          lineHeight: '16px',
          whiteSpace: 'nowrap',
        },
      },
        h('span', {
          'aria-hidden': 'true',
          style: {
            flex: '0 0 auto',
            width: '6px',
            height: '6px',
            borderRadius: 'var(--dsw-radius-sm)',
            background: 'var(--dsw-alias-state-success-primary)',
          },
        }),
        h('span', null, props.t('orchestratorBadgeLabel')))
    }

    /** Host error codes to their localized headline. */
    const FAILURE_KEYS = {
      network: 'errorNetwork',
      invalid: 'errorCodeInvalid',
      conflict: 'errorCodeConflict',
      'invalid-name': 'errorCodeInvalidName',
      exists: 'errorCodeExists',
      'no-dirs': 'errorCodeNoDirs',
      'not-found': 'errorCodeNotFound',
      'unsafe-path': 'errorCodeUnsafePath',
      'invalid-request': 'errorCodeInvalidRequest',
      'invalid-response': 'errorCodeInvalidResponse',
    }

    /** localStorage key prefix for one document's unsaved draft. */
    const DRAFT_PREFIX = 'dsh.agent-soul.draft:'

    /** Field-error keys in the order the Host's validator reports them. */
    const FIELD_ERROR_ORDER = [
      'name', 'description', 'tools', 'model', 'provider', 'reasoningEffort', 'context', 'body',
    ]

    /** Field-error key → the DOM id suffix of its control. */
    const FIELD_CONTROL_SUFFIX = {
      name: 'name',
      description: 'description',
      tools: 'tools',
      model: 'model',
      provider: 'provider',
      reasoningEffort: 'reasoning',
      context: 'context',
      body: 'section-role',
    }

    /** Debounce for the live, no-write preview while the draft changes. */
    const PREVIEW_DEBOUNCE_MS = 500

    /**
     * Read the tool names out of the canonical comma-string draft value.
     * `'*'` (inherit all) and `''` (deny all) carry no individual names.
     * @param {unknown} value - fields.tools as stored in the draft.
     * @returns {string[]} deduplicated tool names in declaration order.
     */
    function parseToolNames(value) {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text === '' || text === '*') return []
      const seen = new Set()
      const names = []
      for (const part of text.split(',')) {
        const name = part.trim()
        if (name === '' || seen.has(name)) continue
        seen.add(name)
        names.push(name)
      }
      return names
    }

    /** The canonical comma-string for a tool-name list ('' means deny all). */
    function formatToolNames(names) {
      if (!Array.isArray(names) || names.length === 0) return ''
      return names.join(', ')
    }

    /** Add or remove one tool from a comma-string value, keeping it canonical. */
    function toggleToolName(value, name) {
      const tool = String(name)
      const names = parseToolNames(value)
      const at = names.indexOf(tool)
      if (at === -1) names.push(tool)
      else names.splice(at, 1)
      return formatToolNames(names)
    }

    /** Classify the tools draft value: inherit all, deny all, or a custom list. */
    function toolModeOf(value) {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text === '*') return 'all'
      if (text === '') return 'none'
      return 'custom'
    }

    /** Default inline name for the duplicate action. */
    function duplicateNameFor(name) {
      const base = String(name === null || name === undefined ? '' : name).trim()
      const candidate = (base === '' ? 'soul' : base) + '-copy'
      return candidate.length > 64 ? candidate.slice(0, 64) : candidate
    }

    /**
     * Prompt bodies for the four New-soul templates. They are document
     * content (not UI chrome), so they stay English like the Host's canonical
     * skeleton; only the labels around them are localized.
     */
    const TEMPLATE_CONTENT = {
      blank: {
        description: 'The {name} teammate. Replace this sentence with one sentence describing when to use it.',
        role: 'You are the "{name}" teammate. Describe your role, the perspective you take, and what you are responsible for.',
        inputs: 'Describe the task message and workspace context you expect from the lead.',
        rules: '- List the hard rules you always follow.\n- Keep each rule concrete and checkable.',
        output: 'Describe the exact structure of your final reply.',
        userInvocable: false,
      },
      researcher: {
        description: 'Researches a question in the workspace and returns cited findings.',
        role: 'You are the researcher teammate. Investigate the question with the tools you have, separate evidence from inference, and report only what you verified.',
        inputs: 'A research question, the relevant workspace paths, and any constraints from the lead.',
        rules: '- Cite the file paths, commands, or sources behind every finding.\n- Mark what you could not verify as unknown instead of guessing.\n- Keep a short evidence log while you work.',
        output: 'Findings first, then the evidence behind each finding, then open questions and a recommended next step.',
        userInvocable: true,
      },
      'code-reviewer': {
        description: 'Reviews a diff or file set for real defects, regressions, and missing tests.',
        role: 'You are the code reviewer teammate. Read the change in context, look for defects that would affect users or maintainers, and separate must-fix problems from optional suggestions.',
        inputs: 'A diff or changed file set, the surrounding code, and the commands the author used to test it.',
        rules: '- Report only defects you can point to in the code.\n- Order findings by severity.\n- Name the missing test when a risk is uncovered.',
        output: 'A findings list (severity, path and line, why it matters, suggested fix), then a short verdict.',
        userInvocable: true,
      },
      'docs-writer': {
        description: 'Turns a change or decision into clear documentation for its readers.',
        role: 'You are the docs writer teammate. Explain the change for the people who will use or maintain it, in the vocabulary the codebase already uses.',
        inputs: 'The change, its motivation, and the audience that needs the documentation.',
        rules: '- Do not invent behavior; verify it in the code and the tests.\n- Prefer a task-oriented structure over a feature list.\n- Keep examples short and runnable.',
        output: 'A draft that opens with the reader’s problem, then the workflow, then caveats and links.',
        userInvocable: true,
      },
    }

    /**
     * Compose valid soul Markdown for one template and the chosen name.
     * The result is sent as `source` to POST create, which validates it again.
     * @param {string} name - the requested lower-kebab-case name.
     * @param {string} template - one TEMPLATE_CONTENT key.
     * @returns {string} complete Markdown source.
     */
    function composeTemplateSource(name, template) {
      const soulName = String(name === null || name === undefined ? '' : name).trim()
      const content = Object.prototype.hasOwnProperty.call(TEMPLATE_CONTENT, template)
        ? TEMPLATE_CONTENT[template]
        : TEMPLATE_CONTENT.blank
      const fill = function (text) { return text.replace(/\{name\}/g, soulName) }
      const lines = [
        '---',
        'name: ' + JSON.stringify(soulName),
        'description: ' + JSON.stringify(fill(content.description)),
        'context: fresh',
      ]
      if (content.userInvocable) lines.push('user-invocable: true')
      lines.push('---', '',
        '## Role Definition', fill(content.role), '',
        '## Inputs You Will See', fill(content.inputs), '',
        '## Hard Rules', fill(content.rules), '',
        '## Output Format', fill(content.output), '')
      return lines.join('\n')
    }

    /**
     * Canonical order of the six orchestrator sections. The Host composes them
     * in this order, and an unknown heading in the file stays in extra markdown.
     */
    const ORCHESTRATOR_SECTION_KEYS = [
      'identity', 'plan', 'delegation', 'state', 'verification', 'recovery',
    ]

    /** Default configuration for a definition created from the browser. */
    const ORCHESTRATOR_DEFAULT_FIELDS = {
      name: 'orchestrator',
      model: '',
      provider: '',
      reasoningEffort: '',
      tools: '*',
      planFirst: true,
      gateMode: 'strict',
      maxRetries: 2,
      pauseOnFatal: true,
    }

    /** The documented gate modes; anything else normalizes to `strict`. */
    const ORCHESTRATOR_GATE_MODES = ['strict', 'advisory', 'off']

    /** Editable orchestrator config keys, in validation-summary order. */
    const ORCHESTRATOR_ERROR_KEYS = [
      'name', 'model', 'provider', 'reasoningEffort', 'tools',
      'planFirst', 'gateMode', 'maxRetries', 'pauseOnFatal',
      'identity', 'plan', 'delegation', 'state', 'verification', 'recovery',
      'extraMarkdown', 'body',
    ]

    /** Control id suffix per orchestrator field, for error-summary focus. */
    const ORCHESTRATOR_CONTROL_SUFFIX = {
      name: 'orch-name',
      model: 'orch-model',
      provider: 'orch-provider',
      reasoningEffort: 'orch-reasoning',
      tools: 'orch-tools',
      planFirst: 'orch-plan-first',
      gateMode: 'orch-gate-mode',
      maxRetries: 'orch-max-retries',
      pauseOnFatal: 'orch-pause-on-fatal',
      identity: 'orch-section-identity',
      plan: 'orch-section-plan',
      delegation: 'orch-section-delegation',
      state: 'orch-section-state',
      verification: 'orch-section-verification',
      recovery: 'orch-section-recovery',
      extraMarkdown: 'orch-section-extra-markdown',
      body: 'orch-section-identity',
    }

    /**
     * Document content for a browser-composed default definition. Like the
     * soul templates this is file content (not UI chrome), so it stays in
     * English; only the labels around it are localized.
     */
    const ORCHESTRATOR_TEMPLATE_CONTENT = {
      identity: 'You are the Lead’s orchestration layer. Keep the human’s goal and the workspace boundaries in view, and prefer small, explicit steps over one broad instruction.',
      plan: 'Before delegating, write a short plan: the goal, the ordered steps, the owner of each step, and the evidence that will prove completion. Revisit the plan when new evidence arrives.',
      delegation: 'Delegate one self-contained task per teammate. Pass only the context the teammate needs, name the exact deliverable, and do not duplicate context the workspace already holds.',
      state: 'Track active teammates, their tasks, and their status in short notes. Update the notes after every handoff or result, and keep the human-facing summary current.',
      verification: 'Check every result against the plan before accepting it. Verify claims in the workspace, ask for missing evidence, and mark unverifiable work as unresolved.',
      recovery: 'When a teammate fails or stalls, capture the failure, decide whether to retry, reassign, or finish the work directly, and record that decision.',
    }

    /**
     * Compose the default orchestrator definition client-side: the six
     * canonical sections plus the default config fields. The result is sent as
     * `{ fields, sections }` to the orchestrator POST route.
     * @returns {{ fields: object, sections: object }} editable definition parts.
     */
    function composeOrchestratorTemplate() {
      const fields = Object.assign({}, ORCHESTRATOR_DEFAULT_FIELDS)
      const sections = { extraMarkdown: '' }
      for (const key of ORCHESTRATOR_SECTION_KEYS) {
        sections[key] = ORCHESTRATOR_TEMPLATE_CONTENT[key]
      }
      return { fields: fields, sections: sections }
    }

    /**
     * Normalize the documented orchestrator fields defensively: a missing or
     * out-of-range value keeps the default so the dialog always renders.
     * @param {unknown} value - `orchestrator.fields` from the Host.
     * @returns {object} complete editable fields.
     */
    function normalizeOrchestratorFields(value) {
      const fields = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const name = typeof fields.name === 'string' && fields.name.trim() !== ''
        ? fields.name
        : ORCHESTRATOR_DEFAULT_FIELDS.name
      let maxRetries = ORCHESTRATOR_DEFAULT_FIELDS.maxRetries
      const retries = typeof fields.maxRetries === 'number'
        ? fields.maxRetries
        : parseInt(fields.maxRetries, 10)
      if (typeof retries === 'number' && isFinite(retries)) {
        maxRetries = Math.max(0, Math.min(10, Math.round(retries)))
      }
      let tools = ORCHESTRATOR_DEFAULT_FIELDS.tools
      if (typeof fields.tools === 'string') tools = fields.tools
      else if (Array.isArray(fields.tools)) {
        tools = formatToolNames(fields.tools.filter(function (tool) {
          return typeof tool === 'string' && tool !== ''
        }))
      }
      return {
        name: name,
        model: typeof fields.model === 'string' ? fields.model : '',
        provider: typeof fields.provider === 'string' ? fields.provider : '',
        reasoningEffort: typeof fields.reasoningEffort === 'string' ? fields.reasoningEffort : '',
        tools: tools,
        planFirst: fields.planFirst === undefined
          ? ORCHESTRATOR_DEFAULT_FIELDS.planFirst
          : fields.planFirst === true,
        gateMode: ORCHESTRATOR_GATE_MODES.indexOf(fields.gateMode) === -1
          ? ORCHESTRATOR_DEFAULT_FIELDS.gateMode
          : fields.gateMode,
        maxRetries: maxRetries,
        pauseOnFatal: fields.pauseOnFatal === undefined
          ? ORCHESTRATOR_DEFAULT_FIELDS.pauseOnFatal
          : fields.pauseOnFatal === true,
      }
    }

    /**
     * Normalize the documented orchestrator sections.
     * @param {unknown} value - `orchestrator.sections` from the Host.
     * @returns {object} one string per canonical section plus extra markdown.
     */
    function normalizeOrchestratorSections(value) {
      const sections = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const result = { extraMarkdown: typeof sections.extraMarkdown === 'string' ? sections.extraMarkdown : '' }
      for (const key of ORCHESTRATOR_SECTION_KEYS) {
        result[key] = typeof sections[key] === 'string' ? sections[key] : ''
      }
      return result
    }

    /**
     * Defensive view of one orchestrator GET/POST payload.
     *
     * `bundled` and `sourcePath` describe the effective document origin (a
     * packaged default versus a workspace file); the Orchestrator tab renders
     * its Bundled badge and hint from them, so they must survive normalization.
     *
     * @param {unknown} value - the `orchestrator` object.
     * @returns {object} complete definition state for the page.
     */
    function normalizeOrchestrator(value) {
      const record = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
      return {
        path: typeof record.path === 'string' ? record.path : '',
        configured: record.configured === true,
        bundled: record.bundled === true,
        sourcePath: typeof record.sourcePath === 'string' ? record.sourcePath : null,
        source: typeof record.source === 'string' ? record.source : '',
        valid: record.valid !== false,
        diagnostics: Array.isArray(record.diagnostics) ? record.diagnostics : [],
        fields: normalizeOrchestratorFields(record.fields),
        sections: normalizeOrchestratorSections(record.sections),
      }
    }

    /** Stable dirty-tracking snapshot of a normalized orchestrator draft. */
    function snapshotOrchestrator(record) {
      if (record === null || record === undefined) return null
      return JSON.stringify({
        fields: normalizeOrchestratorFields(record.fields),
        sections: normalizeOrchestratorSections(record.sections),
      })
    }

    /** Localized label for one gate mode. */
    function gateModeLabel(t, mode) {
      if (mode === 'advisory') return t('gateModeAdvisory')
      if (mode === 'off') return t('gateModeOff')
      return t('gateModeStrict')
    }

    /**
     * Extract inline field errors from a failed orchestrator save. The Host
     * sends either `fieldErrors` or diagnostics with a `field` key.
     * @param {{ diagnostics: unknown[], fieldErrors?: object }} failure - normalized failure.
     * @returns {Record<string, string>} errors keyed by editable field.
     */
    function orchestratorFieldErrorsOf(failure) {
      const errors = {}
      if (failure.fieldErrors !== null && typeof failure.fieldErrors === 'object'
        && !Array.isArray(failure.fieldErrors)) {
        for (const key of ORCHESTRATOR_ERROR_KEYS) {
          if (typeof failure.fieldErrors[key] === 'string' && failure.fieldErrors[key] !== '') {
            errors[key] = failure.fieldErrors[key]
          }
        }
      }
      for (const item of failure.diagnostics) {
        if (item === null || typeof item !== 'object') continue
        const field = typeof item.field === 'string' ? item.field : ''
        const message = typeof item.message === 'string' ? item.message : ''
        if (field === '' || message === '') continue
        if (ORCHESTRATOR_ERROR_KEYS.indexOf(field) !== -1 && errors[field] === undefined) {
          errors[field] = message
        }
      }
      return errors
    }

    /** Localized label for one preview command status. */
    function commandStatusLabel(t, status) {
      if (status === 'registered') return t('commandStatusRegistered')
      if (status === 'ai-only') return t('commandStatusAiOnly')
      if (status === 'invalid-name') return t('commandStatusInvalidName')
      if (status === 'collision') return t('commandStatusCollision')
      if (status === 'no-live-lead') return t('commandStatusNoLiveLead')
      return t('commandStatusUnknown')
    }

    /** localStorage key for one document's draft (never throws). */
    function draftStorageKey(file) {
      return DRAFT_PREFIX + String(file)
    }

    /**
     * Read one stored draft; malformed JSON and blocked storage yield null.
     *
     * Records written by earlier versions carry only `fields`/`sections`/
     * `savedAt`; the raw-mode keys are optional, so those records still restore
     * as a form draft. Any present key is type-checked so a tampered or partial
     * record cannot put a non-string where the editor renders one.
     *
     * @param {string} file - the document the draft belongs to.
     * @returns {{ fields: object, sections: object, savedAt: number,
     *   mode: 'form' | 'raw', rawSource: string | null, baseHash: string | null } | null}
     */
    function readStoredDraft(file) {
      try {
        const raw = window.localStorage.getItem(draftStorageKey(file))
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        if (parsed.fields === null || typeof parsed.fields !== 'object' || Array.isArray(parsed.fields)) return null
        if (parsed.sections === null || typeof parsed.sections !== 'object' || Array.isArray(parsed.sections)) return null
        const rawSource = typeof parsed.rawSource === 'string' ? parsed.rawSource : null
        const baseHash = typeof parsed.baseHash === 'string' && parsed.baseHash !== '' ? parsed.baseHash : null
        return {
          fields: parsed.fields,
          sections: parsed.sections,
          savedAt: typeof parsed.savedAt === 'number' && isFinite(parsed.savedAt) ? parsed.savedAt : 0,
          // Raw mode is only restorable with the source it applies to.
          mode: parsed.mode === 'raw' && rawSource !== null ? 'raw' : 'form',
          rawSource: rawSource,
          baseHash: baseHash,
        }
      } catch (error) {
        return null
      }
    }

    /**
     * Persist one dirty draft, including the raw-mode source, the mode needed to
     * restore it, and the file hash the draft was based on. Storage failures are
     * silently ignored.
     *
     * @param {string} file - the document the draft belongs to.
     * @param {{ fields: object, sections: object, mode?: 'form' | 'raw',
     *   rawSource?: string | null, baseHash?: string | null }} draft
     * @returns {void}
     */
    function writeStoredDraft(file, draft) {
      try {
        window.localStorage.setItem(draftStorageKey(file), JSON.stringify({
          fields: draft.fields,
          sections: draft.sections,
          savedAt: Date.now(),
          mode: draft.mode === 'raw' ? 'raw' : 'form',
          rawSource: typeof draft.rawSource === 'string' ? draft.rawSource : null,
          baseHash: typeof draft.baseHash === 'string' ? draft.baseHash : null,
        }))
      } catch (error) {
        // Private mode or a full quota: unsaved edits still live in memory.
      }
    }

    /** Clear one stored draft; storage failures are silently ignored. */
    function clearStoredDraft(file) {
      try {
        window.localStorage.removeItem(draftStorageKey(file))
      } catch (error) {
        // Nothing else to do when storage is unavailable.
      }
    }

    /**
     * Clear the draft written by this save, but never a newer different draft
     * written by another view while the request was in flight. A delayed write
     * of the exact saved snapshot is safe to remove.
     */
    function clearStoredDraftAfterSave(file, savedDraftSnapshot, saveStartedAt) {
      const stored = readStoredDraft(file)
      if (stored !== null && stored.savedAt > saveStartedAt) {
        const storedSnapshot = JSON.stringify({ fields: stored.fields, sections: stored.sections })
        if (savedDraftSnapshot === null || storedSnapshot !== savedDraftSnapshot) return
      }
      clearStoredDraft(file)
    }

    /** localStorage key for the resizable editor dialog size (P3). */
    const EDITOR_SIZE_KEY = 'dsh.agent-soul.editor-size'

    /** Clamp bounds for the dialog: never smaller than a usable form. */
    const EDITOR_SIZE_MIN_WIDTH = 520
    const EDITOR_SIZE_MIN_HEIGHT = 420

    /** Viewport fractions the dialog may never exceed. */
    const EDITOR_SIZE_MAX_VW = 0.96
    const EDITOR_SIZE_MAX_VH = 0.92

    /** Current viewport box the dialog size is clamped against (never throws). */
    function editorSizeBounds() {
      const viewportWidth = typeof window !== 'undefined' && isFinite(window.innerWidth)
        ? window.innerWidth
        : 1280
      const viewportHeight = typeof window !== 'undefined' && isFinite(window.innerHeight)
        ? window.innerHeight
        : 900
      return {
        width: Math.max(240, Math.round(viewportWidth * EDITOR_SIZE_MAX_VW)),
        height: Math.max(240, Math.round(viewportHeight * EDITOR_SIZE_MAX_VH)),
      }
    }

    /**
     * Clamp one dialog size into the documented min/max range. The viewport
     * maximum wins over the minimum so a small window never overflows.
     * @param {{ width: number, height: number }} size - requested size.
     * @returns {{ width: number, height: number }} the clamped size.
     */
    function clampEditorSize(size) {
      const bounds = editorSizeBounds()
      const width = typeof size.width === 'number' && isFinite(size.width) ? size.width : bounds.width
      const height = typeof size.height === 'number' && isFinite(size.height) ? size.height : bounds.height
      return {
        width: Math.round(Math.max(Math.min(EDITOR_SIZE_MIN_WIDTH, bounds.width), Math.min(bounds.width, width))),
        height: Math.round(Math.max(Math.min(EDITOR_SIZE_MIN_HEIGHT, bounds.height), Math.min(bounds.height, height))),
      }
    }

    /**
     * The default dialog size: min(1100px, 94vw) wide and 86vh tall, clamped.
     * @returns {{ width: number, height: number }} the default size.
     */
    function defaultEditorSize() {
      const viewportWidth = typeof window !== 'undefined' && isFinite(window.innerWidth)
        ? window.innerWidth
        : 1280
      const viewportHeight = typeof window !== 'undefined' && isFinite(window.innerHeight)
        ? window.innerHeight
        : 900
      return clampEditorSize({
        width: Math.min(1100, Math.round(viewportWidth * 0.94)),
        height: Math.round(viewportHeight * 0.86),
      })
    }

    /** Read the persisted dialog size; absent or malformed storage yields the default. */
    function readStoredEditorSize() {
      try {
        const raw = window.localStorage.getItem(EDITOR_SIZE_KEY)
        if (raw === null) return defaultEditorSize()
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return defaultEditorSize()
        if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') {
          return defaultEditorSize()
        }
        return clampEditorSize(parsed)
      } catch (error) {
        return defaultEditorSize()
      }
    }

    /** Persist one dialog size; storage failures are silently ignored. */
    function writeStoredEditorSize(size) {
      try {
        window.localStorage.setItem(EDITOR_SIZE_KEY, JSON.stringify({
          width: Math.round(size.width),
          height: Math.round(size.height),
        }))
      } catch (error) {
        // Private mode or a full quota: the size still applies to this view.
      }
    }

    /**
     * Copy text with the async Clipboard API, then a legacy selection fallback.
     * @param {string} text - text to place on the clipboard.
     * @returns {Promise<boolean>} whether a copy mechanism reported success.
     */
    async function copyToClipboard(text) {
      const value = String(text)
      if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined
        && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(value)
          return true
        } catch (error) {
          // Permission denied: fall through to the selection fallback.
        }
      }
      const active = document.activeElement
      const inputSelection = active !== null && typeof active === 'object'
        && typeof active.selectionStart === 'number' && typeof active.selectionEnd === 'number'
        ? {
          start: active.selectionStart,
          end: active.selectionEnd,
          direction: typeof active.selectionDirection === 'string' ? active.selectionDirection : undefined,
        }
        : null
      const selection = typeof document.getSelection === 'function' ? document.getSelection() : null
      const ranges = []
      if (selection !== null && typeof selection.getRangeAt === 'function') {
        for (let index = 0; index < selection.rangeCount; index += 1) {
          try {
            const range = selection.getRangeAt(index)
            ranges.push(typeof range.cloneRange === 'function' ? range.cloneRange() : range)
          } catch (error) {
            // An unavailable range is skipped without blocking the copy.
          }
        }
      }
      let area = null
      try {
        area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
        document.documentElement.appendChild(area)
        area.focus()
        area.select()
        const copied = typeof document.execCommand === 'function'
          && document.execCommand('copy')
        return copied === true
      } catch (error) {
        return false
      } finally {
        // Every restoration step is independent: a DOM/Selection failure must
        // not leak the textarea or strand focus in the removed fallback node.
        if (area !== null && area.parentNode !== null && area.parentNode !== undefined) {
          try {
            area.parentNode.removeChild(area)
          } catch (error) {
            // A detached node needs no further cleanup.
          }
        }
        if (active !== null && active !== undefined && active.isConnected !== false
          && typeof active.focus === 'function') {
          try {
            active.focus({ preventScroll: true })
          } catch (error) {
            try {
              active.focus()
            } catch (error) {
              // A detached or inert prior control cannot receive focus.
            }
          }
        }
        if (inputSelection !== null && typeof active.setSelectionRange === 'function') {
          try {
            active.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction)
          } catch (error) {
            // Non-text controls and detached inputs do not expose a selection.
          }
        }
        if (selection !== null && typeof selection.removeAllRanges === 'function'
          && typeof selection.addRange === 'function') {
          try {
            selection.removeAllRanges()
            for (const range of ranges) selection.addRange(range)
          } catch (error) {
            // The copy result still stands when Selection restoration is denied.
          }
        }
      }
    }

    /** The first field error in canonical order, null when there is none. */
    function firstFieldError(fieldErrors) {
      for (const key of FIELD_ERROR_ORDER) {
        if (typeof fieldErrors[key] === 'string' && fieldErrors[key] !== '') return key
      }
      return null
    }

    /** Human label for one field-error key. */
    function fieldErrorLabel(t, key) {
      if (key === 'name') return t('fieldName')
      if (key === 'description') return t('fieldDescription')
      if (key === 'tools') return t('fieldTools')
      if (key === 'model') return t('fieldModel')
      if (key === 'provider') return t('fieldProvider')
      if (key === 'reasoningEffort') return t('fieldReasoning')
      if (key === 'context') return t('fieldContext')
      if (key === 'gateMode') return t('fieldGateMode')
      if (key === 'maxRetries') return t('fieldMaxRetries')
      if (key === 'planFirst') return t('fieldPlanFirst')
      if (key === 'pauseOnFatal') return t('fieldPauseOnFatal')
      if (key === 'identity') return t('sectionIdentity')
      if (key === 'plan') return t('sectionPlan')
      if (key === 'delegation') return t('sectionDelegation')
      if (key === 'state') return t('sectionState')
      if (key === 'verification') return t('sectionVerification')
      if (key === 'recovery') return t('sectionRecovery')
      if (key === 'extraMarkdown') return t('fieldExtraMarkdown')
      return t('groupMarkdown')
    }

    /** One inline stylesheet: the shipped Settings material and tokens. */
    const STYLES = `
.agent-soul-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
}
.agent-soul-page * {
  box-sizing: border-box;
}
.agent-soul-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.agent-soul-title {
  margin: 0;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.agent-soul-intro {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.agent-soul-toolbar-spacer {
  flex: 1 1 auto;
}
.agent-soul-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-settings-card-fill);
  align-self: flex-start;
}
.agent-soul-tab {
  appearance: none;
  box-sizing: border-box;
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.agent-soul-tab[aria-selected='true'] {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
@media (hover: hover) {
  .agent-soul-tab:hover:not([aria-selected='true']) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.agent-soul-tab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-tabpanel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.agent-soul-orchestrator-path {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  min-width: 0;
}
.agent-soul-orchestrator-path .agent-soul-code-block {
  flex: 1 1 320px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-soul-orchestrator-hint {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2);
}
.agent-soul-command-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.agent-soul-command {
  padding: 1px 8px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.agent-soul-scan {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-status {
  margin: 0;
  min-height: 18px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}
.agent-soul-status-success {
  color: var(--dsw-alias-state-success-primary);
}
.agent-soul-status-error {
  color: var(--dsw-alias-state-error-primary);
}
.agent-soul-card {
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  background: var(--dsw-alias-settings-card-fill);
  border-radius: var(--dsw-radius-xl);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.agent-soul-card-title {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.agent-soul-card-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.agent-soul-count {
  margin-left: auto;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-soul-list-card {
  appearance: none;
  width: 100%;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  transition: border-color 0.16s, background 0.16s;
}
@media (hover: hover) {
  .agent-soul-list-card:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.agent-soul-list-card:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-list-card[aria-pressed='true'] {
  background: var(--dsw-alias-bg-module-platform);
  border-color: var(--dsw-alias-state-business-primary);
}
.agent-soul-list-name {
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-soul-list-desc {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.agent-soul-list-desc-empty {
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-default-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.agent-soul-default-row .agent-soul-field-hint {
  flex: 1 1 220px;
  margin: 0;
}
.agent-soul-default-select {
  min-width: 200px;
  max-width: 280px;
}
.agent-soul-list-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-soul-list-hint {
  padding: 2px 0;
}
.agent-soul-list-hint .agent-soul-empty-title {
  font-size: 13px;
}
.agent-soul-list-hint .agent-soul-empty-body {
  font-size: 12px;
  line-height: 18px;
}
.agent-soul-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.agent-soul-chip {
  appearance: none;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  padding: 3px 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.agent-soul-chip[aria-pressed='true'] {
  background: var(--dsw-alias-bg-module-platform);
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary);
}
.agent-soul-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-sort-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.agent-soul-sort-label {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-soul-skeleton-card,
.agent-soul-skeleton-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
}
.agent-soul-skeleton-editor {
  padding: 14px 16px;
}
.agent-soul-skeleton-line {
  display: block;
  height: 10px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-bg-layer-2);
  animation: agent-soul-skeleton-pulse 1.4s ease-in-out infinite;
}
.agent-soul-skeleton-line-title {
  width: 55%;
  height: 14px;
}
.agent-soul-skeleton-line-short {
  width: 35%;
}
@keyframes agent-soul-skeleton-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
@media (prefers-reduced-motion: reduce) {
  .agent-soul-skeleton-line {
    animation: none;
  }
}
.agent-soul-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.agent-soul-badge {
  max-width: 100%;
  padding: 1px 6px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-soul-badge-ok {
  border-color: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-state-success-primary);
}
.agent-soul-badge-error {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}
.agent-soul-editor-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 16px;
  max-height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  scrollbar-gutter: stable;
}
.agent-soul-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
}
.agent-soul-group-head {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  min-width: 0;
}
.agent-soul-field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  width: 100%;
  min-width: 0;
}
.agent-soul-field {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.agent-soul-field-wide {
  grid-column: 1 / -1;
}
.agent-soul-field-label {
  display: block;
  width: 100%;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.agent-soul-field-hint {
  margin: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-field-error {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  overflow-wrap: anywhere;
}
.agent-soul-error-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2);
}
.agent-soul-error-summary-title {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-state-error-primary);
}
.agent-soul-error-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-soul-error-link {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  text-decoration: underline;
  color: var(--dsw-alias-state-error-primary);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.agent-soul-error-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-input,
.agent-soul-select,
.agent-soul-textarea {
  box-sizing: border-box;
  width: 100%;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  padding: 6px 10px;
}
.agent-soul-input,
.agent-soul-select {
  height: 32px;
}
.agent-soul-textarea {
  display: block;
  width: 100%;
  min-height: 150px;
  resize: vertical;
}
.agent-soul-textarea-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 18px;
}
.agent-soul-input::placeholder,
.agent-soul-textarea::placeholder {
  color: var(--dsw-alias-label-dimmed);
}
.agent-soul-input:focus,
.agent-soul-select:focus,
.agent-soul-textarea:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-checkbox-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.agent-soul-checkbox {
  margin: 3px 0 0;
  accent-color: var(--dsw-alias-state-business-primary);
}
.agent-soul-checkbox-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.agent-soul-checkbox-label {
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.agent-soul-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.agent-soul-actions-spacer {
  flex: 1 1 auto;
}
.agent-soul-action-bar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 10px 0 2px;
  border-top: 0.5px solid var(--dsw-alias-settings-card-stroke);
  background: var(--dsw-alias-settings-card-fill);
}
.agent-soul-dirty-badge {
  padding: 1px 8px;
  border: 0.5px solid var(--dsw-alias-state-warn-label);
  border-radius: var(--dsw-radius-xs);
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-state-warn-label);
  white-space: nowrap;
}
.agent-soul-dirty {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-warn-label);
}
.agent-soul-delete-prompt {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  overflow-wrap: anywhere;
}
.agent-soul-primary-button,
.agent-soul-secondary-button,
.agent-soul-danger-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-md);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.agent-soul-primary-button {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
@media (hover: hover) {
  .agent-soul-primary-button:hover:not(:disabled) {
    background: var(--dsw-alias-button-primary-hover);
  }
}
.agent-soul-secondary-button {
  border: 0.5px solid var(--dsw-alias-border-l3);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}
@media (hover: hover) {
  .agent-soul-secondary-button:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.agent-soul-danger-button {
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
}
@media (hover: hover) {
  .agent-soul-danger-button:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-danger);
  }
}
.agent-soul-primary-button:disabled,
.agent-soul-secondary-button:disabled,
.agent-soul-danger-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.agent-soul-primary-button:focus-visible,
.agent-soul-secondary-button:focus-visible,
.agent-soul-danger-button:focus-visible,
.agent-soul-list-card:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.agent-soul-empty-title {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.agent-soul-empty-body {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-muted {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-code-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.agent-soul-copy-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.agent-soul-copy-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-copy-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
  min-width: 0;
}
.agent-soul-copy-button {
  appearance: none;
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  padding: 2px 8px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  white-space: nowrap;
}
@media (hover: hover) {
  .agent-soul-copy-button:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.agent-soul-copy-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xs);
  padding: 1px 6px;
  overflow-wrap: anywhere;
}
.agent-soul-code-block {
  display: block;
  margin: 0;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.agent-soul-info-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-soul-info-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.agent-soul-info-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-info-value {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.agent-soul-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.agent-soul-team-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.agent-soul-team {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.agent-soul-team-lead {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-diagnostics {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.agent-soul-diagnostic {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-warn-label);
  overflow-wrap: anywhere;
}
.agent-soul-error-card {
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-settings-card-fill);
  border-radius: var(--dsw-radius-xl);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.agent-soul-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2);
}
.agent-soul-banner-warn {
  border-color: var(--dsw-alias-state-warn-label);
}
.agent-soul-banner-error {
  border-color: var(--dsw-alias-state-error-primary);
}
.agent-soul-banner-copy {
  display: flex;
  flex: 1 1 240px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.agent-soul-banner-title {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.agent-soul-banner-text {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.agent-soul-banner-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.agent-soul-skeleton-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-soul-error-title {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-state-error-primary);
}
.agent-soul-error-body {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.agent-soul-chip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.agent-soul-chip-warning {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}
.agent-soul-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.agent-soul-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  min-width: 0;
}
.agent-soul-panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.agent-soul-panel-title {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.agent-soul-panel-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.agent-soul-panel-textarea {
  min-height: 260px;
}
.agent-soul-mode-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.agent-soul-mode-label {
  margin-right: 2px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-inline-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}
.agent-soul-pre {
  margin: 0;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 280px;
  overflow: auto;
}
.agent-soul-pre-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.agent-soul-preview-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.agent-soul-preview-line {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  min-width: 0;
}
.agent-soul-preview-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-preview-value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.agent-soul-preview-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.agent-soul-raw-textarea {
  min-height: 380px;
}
.agent-soul-template-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.agent-soul-warning-note {
  color: var(--dsw-alias-state-warn-label);
}
.agent-soul-list-usage {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}
.agent-soul-badge-active {
  border-color: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-state-success-primary);
}
.agent-soul-editor-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.agent-soul-meta-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  min-width: 0;
}
.agent-soul-meta-label {
  font-size: 11px;
  line-height: 17px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-meta-value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.agent-soul-catalog-row {
  align-items: flex-start;
  flex-wrap: wrap;
  width: 100%;
}
.agent-soul-catalog-line {
  flex: 1 1 100%;
  min-width: 0;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.agent-soul-health-budgets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.agent-soul-budget {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.agent-soul-budget-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.agent-soul-budget-label {
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.agent-soul-budget-value {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-progress {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3);
}
.agent-soul-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  transition: width 0.16s;
}
.agent-soul-progress-fill-warn {
  background: var(--dsw-alias-state-error-primary);
}
.agent-soul-health-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.agent-soul-health-count {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-soul-health-count-label {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.agent-soul-health-count-value {
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.agent-soul-health-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.agent-soul-health-duplicate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
}
.agent-soul-diagnostic-link {
  appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-state-warn-label);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.agent-soul-diagnostic-link:hover {
  color: var(--dsw-alias-label-primary);
}
.agent-soul-diagnostic-link:focus-visible {
  outline: none;
  border-radius: var(--dsw-radius-xs);
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2vw;
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 72%, transparent);
}
.agent-soul-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  max-width: 96vw;
  max-height: 92vh;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 40px color-mix(in srgb, var(--dsw-alias-bg-overlay) 62%, transparent);
  outline: none;
  overflow: hidden;
}
.agent-soul-dialog:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-dialog-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px 12px;
  padding: 12px 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.agent-soul-dialog-heading {
  display: flex;
  flex: 1 1 240px;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.agent-soul-dialog-title {
  margin: 0;
  min-width: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}
.agent-soul-dialog-path {
  flex: 1 1 100%;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-soul-dialog-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.agent-soul-dialog-close {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
@media (hover: hover) {
  .agent-soul-dialog-close:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.agent-soul-dialog-reset {
  appearance: none;
  box-sizing: border-box;
  height: 28px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
}
@media (hover: hover) {
  .agent-soul-dialog-reset:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.agent-soul-dialog-close:focus-visible,
.agent-soul-dialog-reset:focus-visible,
.agent-soul-dialog-resize:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.agent-soul-dialog-resize {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 4;
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-bottom-right-radius: var(--dsw-radius-xl);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: nwse-resize;
  touch-action: none;
}
.agent-soul-dialog-resize::before {
  content: '';
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--dsw-alias-border-l3);
  border-bottom: 2px solid var(--dsw-alias-border-l3);
}
.agent-soul-dialog-resize::after {
  content: '';
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 12px;
  height: 12px;
  border-right: 2px solid var(--dsw-alias-border-l2);
  border-bottom: 2px solid var(--dsw-alias-border-l2);
}
.agent-soul-dialog-notices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 30vh;
  overflow-y: auto;
  padding: 10px 16px 0;
  background: var(--dsw-alias-bg-layer-1);
}
.agent-soul-dialog-footer {
  position: sticky;
  bottom: 0;
  z-index: 3;
  margin-top: 0;
  padding: 10px 40px 10px 16px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.agent-soul-dialog-status {
  margin: 0;
}
@media (max-width: 720px) {
  .agent-soul-dialog-backdrop {
    padding: 8px;
  }
  .agent-soul-dialog {
    max-width: calc(100vw - 16px);
    max-height: 92vh;
  }
  .agent-soul-field-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .agent-soul-info-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  .agent-soul-preview-line {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  .agent-soul-inline-form {
    grid-template-columns: minmax(0, 1fr);
  }
}
`
    /**
     * Styles for the Plugins-page row configuration page. The Plugins page
     * mounts that registration outside the Agent Soul page, whose single
     * `<style>` element is not present there, so the entry ships its own
     * token-only sheet. Every class is prefixed `agent-soul-cfg-`, and every
     * color (the border color included) and radius comes from a `--dsw-*`
     * theme token.
     */
    const CONFIG_STYLES = `
.agent-soul-cfg-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-settings-card-fill);
}
.agent-soul-cfg-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}
.agent-soul-cfg-description {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.agent-soul-cfg-control {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.agent-soul-cfg-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.agent-soul-cfg-switch-disabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}
.agent-soul-cfg-checkbox {
  margin: 0;
  accent-color: var(--dsw-alias-state-business-primary);
}
.agent-soul-cfg-checkbox:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.agent-soul-cfg-status {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.agent-soul-cfg-status-error {
  color: var(--dsw-alias-state-error-primary);
}
`
    /**
     * Read one JSON response as the documented payload, raising the typed
     * failure shape for non-OK answers.
     * @param {Response} response - the fetch response.
     * @returns {Promise<any>} the parsed payload.
     */
    async function readJson(response) {
      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }
      if (response.ok) return payload
      const failure = { code: 'http', message: '', diagnostics: [], status: response.status }
      if (payload !== null && typeof payload === 'object') {
        if (typeof payload.code === 'string' && payload.code !== '') failure.code = payload.code
        if (typeof payload.message === 'string' && payload.message !== '') {
          failure.message = payload.message
        } else {
          failure.message = 'HTTP ' + response.status
        }
        if (Array.isArray(payload.diagnostics)) failure.diagnostics = payload.diagnostics
        if (typeof payload.currentHash === 'string') failure.currentHash = payload.currentHash
        if (typeof payload.currentModifiedAt === 'number') failure.currentModifiedAt = payload.currentModifiedAt
        if (payload.fieldErrors !== null && typeof payload.fieldErrors === 'object'
          && !Array.isArray(payload.fieldErrors)) {
          failure.fieldErrors = payload.fieldErrors
        }
      } else {
        failure.message = 'HTTP ' + response.status
      }
      // 409 is the Host conflict answer; keep it typed even without a JSON body.
      if (response.status === 409) failure.code = 'conflict'
      throw failure
    }

    /**
     * Validate one successful `GET agent-soul/overview` body.
     *
     * The page renders rows, settings, runtime health, and the orchestrator and
     * preference cards from these blocks, so a payload missing them is a Host
     * contract failure — reported through the error card — rather than an empty
     * catalog or a stuck skeleton.
     *
     * @param {unknown} payload - the parsed response body.
     * @returns {{ code: string, message: string, diagnostics: unknown[] } | null}
     *   the typed failure, or null for the documented shape.
     */
    function overviewPayloadFailure(payload) {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return { code: 'invalid-response', message: '', diagnostics: [] }
      }
      if (!Array.isArray(payload.documents)) return { code: 'invalid-response', message: '', diagnostics: [] }
      if (payload.plugin === null || typeof payload.plugin !== 'object') {
        return { code: 'invalid-response', message: '', diagnostics: [] }
      }
      if (payload.settings === null || typeof payload.settings !== 'object') {
        return { code: 'invalid-response', message: '', diagnostics: [] }
      }
      if (payload.runtime === null || typeof payload.runtime !== 'object') {
        return { code: 'invalid-response', message: '', diagnostics: [] }
      }
      return null
    }

    /**
     * One save path for the single orchestrator definition: the browser sends
     * the editable `{ fields, sections }` split, never a raw source, so the
     * Host validates and re-reads exactly one state.
     * @param {object} fields - orchestrator fields.
     * @param {object} sections - six canonical sections plus extra markdown.
     * @returns {Promise<any>} the parsed `{ ok, orchestrator }` payload.
     */
    async function postOrchestrator(fields, sections, root) {
      return readJson(await fetch('agent-soul/orchestrator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields: fields, sections: sections, root: root }),
      }))
    }

    /**
     * Normalize any thrown value into the `{ code, message, diagnostics }` shape.
     * @param {unknown} error - the thrown value.
     * @returns {{ code: string, message: string, diagnostics: unknown[] }} the failure.
     */
    function failureOf(error) {
      if (error !== null && typeof error === 'object' && typeof error.code === 'string') {
        const failure = {
          code: error.code,
          message: typeof error.message === 'string' ? error.message : '',
          diagnostics: Array.isArray(error.diagnostics) ? error.diagnostics : [],
        }
        if (typeof error.status === 'number') failure.status = error.status
        if (typeof error.currentHash === 'string') failure.currentHash = error.currentHash
        if (typeof error.currentModifiedAt === 'number') failure.currentModifiedAt = error.currentModifiedAt
        if (error.fieldErrors !== null && typeof error.fieldErrors === 'object'
          && !Array.isArray(error.fieldErrors)) {
          failure.fieldErrors = error.fieldErrors
        }
        return failure
      }
      return {
        code: 'network',
        message: error !== null && typeof error === 'object' && typeof error.message === 'string'
          ? error.message
          : '',
        diagnostics: [],
      }
    }

    /**
     * Localized headline for one failure, with the Host's own message appended.
     * @param {Function} t - the bound translate function.
     * @param {{ code: string, message: string }} failure - the normalized failure.
     * @returns {string} display text.
     */
    function failureText(t, failure) {
      const key = FAILURE_KEYS[failure.code]
      const headline = key === undefined ? t('errorUnknown', { code: failure.code }) : t(key)
      return failure.message === '' ? headline : headline + ' ' + failure.message
    }

    /**
     * Editable parts of one document, serialized for dirty tracking.
     * @param {object} document - a DocumentDetail.
     * @returns {string} stable snapshot key.
     */
    function snapshotDraft(document) {
      return JSON.stringify({ fields: document.fields, sections: document.sections })
    }

    /**
     * Locale-aware clock/date for a scan timestamp.
     * @param {unknown} value - epoch milliseconds.
     * @returns {string | null} the formatted timestamp, null when absent.
     */
    function formatTimestamp(value) {
      if (typeof value !== 'number' || !isFinite(value)) return null
      try {
        return new Date(value).toLocaleString()
      } catch (error) {
        return null
      }
    }

    /**
     * Compact age for a binding timestamp: a relative phrase while the use is
     * recent, otherwise the locale-aware absolute time.
     * @param {unknown} value - epoch milliseconds.
     * @returns {string | null} the formatted age, null when absent.
     */
    function formatUsageTime(value) {
      if (typeof value !== 'number' || !isFinite(value) || value <= 0) return null
      const elapsed = Date.now() - value
      if (elapsed >= 0 && elapsed < 604800000
        && typeof Intl === 'object' && Intl !== null
        && typeof Intl.RelativeTimeFormat === 'function') {
        try {
          const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
          const minutes = Math.round(elapsed / 60000)
          if (minutes < 60) return format.format(-minutes, 'minute')
          const hours = Math.round(elapsed / 3600000)
          if (hours < 24) return format.format(-hours, 'hour')
          return format.format(-Math.round(elapsed / 86400000), 'day')
        } catch (error) {
          // An unsupported locale falls back to the absolute timestamp.
        }
      }
      return formatTimestamp(value)
    }

    /**
     * Defensive read of a `commandStatus` payload.
     * @param {unknown} value - the document's commandStatus object.
     * @returns {{ name: string, status: string, message: string } | null} the typed status.
     */
    function commandStatusOf(value) {
      if (value === null || typeof value !== 'object') return null
      const status = typeof value.status === 'string' ? value.status : ''
      if (status === '') return null
      return {
        name: typeof value.name === 'string' ? value.name : '',
        status: status,
        message: typeof value.message === 'string' ? value.message : '',
      }
    }

    /** Badge modifier for one command status. */
    function commandStatusModifier(status) {
      if (status === 'registered') return 'agent-soul-badge-ok'
      if (status === 'collision' || status === 'invalid-name') return 'agent-soul-badge-error'
      return undefined
    }

    /** Slash form of a command name, without doubling a leading slash. */
    function commandInvocation(name) {
      const text = typeof name === 'string' ? name.trim() : ''
      if (text === '') return ''
      return text.charAt(0) === '/' ? text : '/' + text
    }

    /**
     * One labelled budget, rendered as a progress bar. A missing, zero or
     * non-finite maximum renders muted text instead of a bar, so the page never
     * divides by zero (or by a non-number).
     * @param {Function} t - the bound translate function.
     * @param {string} label - localized budget name.
     * @param {unknown} used - reported usage.
     * @param {unknown} max - reported limit.
     * @param {string} key - React key.
     * @returns {object} a React node.
     */
    function budgetBar(t, label, used, max, key) {
      const usedValue = typeof used === 'number' && isFinite(used) && used >= 0 ? used : null
      const maxValue = typeof max === 'number' && isFinite(max) && max > 0 ? max : null
      if (maxValue === null) {
        return h('div', { key: key, className: 'agent-soul-budget' },
          h('div', { className: 'agent-soul-budget-head' },
            h('span', { className: 'agent-soul-budget-label' }, label),
            h('span', { className: 'agent-soul-budget-value agent-soul-muted' },
              usedValue === null
                ? t('healthBudgetUnknown')
                : t('healthBudgetNoLimit', { used: usedValue }))))
      }
      const percent = usedValue === null
        ? 0
        : Math.min(100, Math.max(0, (usedValue / maxValue) * 100))
      const over = usedValue !== null && usedValue > maxValue
      return h('div', { key: key, className: 'agent-soul-budget' },
        h('div', { className: 'agent-soul-budget-head' },
          h('span', { className: 'agent-soul-budget-label' }, label),
          h('span', {
            className: over
              ? 'agent-soul-budget-value agent-soul-warning-note'
              : 'agent-soul-budget-value',
          }, usedValue === null
            ? t('healthBudgetUnknown')
            : t('healthBudgetValue', { used: usedValue, max: maxValue }))),
        h('div', {
          className: 'agent-soul-progress',
          role: 'progressbar',
          'aria-label': label,
          'aria-valuemin': 0,
          'aria-valuemax': maxValue,
          'aria-valuenow': usedValue === null ? 0 : Math.min(usedValue, maxValue),
        },
          h('div', {
            className: over
              ? 'agent-soul-progress-fill agent-soul-progress-fill-warn'
              : 'agent-soul-progress-fill',
            style: { width: percent + '%' },
          })))
    }

    /**
     * Resolve the document a scan diagnostic names, if any.
     * @param {object[]} documents - the overview document summaries.
     * @param {unknown} item - one scan diagnostic.
     * @returns {object | null} the matching document summary.
     */
    function diagnosticDocument(documents, item) {
      if (item === null || typeof item !== 'object') return null
      const source = typeof item.source === 'string' ? item.source.trim() : ''
      if (source === '') return null
      // Scan diagnostics carry the root-relative label while other producers may
      // name the absolute path; accept both, plus a leading "./" spelling.
      const normalized = source.replace(/^\.\//u, '')
      for (const document of documents) {
        if (document === null || typeof document !== 'object') continue
        const label = typeof document.label === 'string' ? document.label.replace(/^\.\//u, '') : ''
        if (source === document.sourcePath || source === document.file
          || normalized === document.sourcePath || normalized === document.file
          || normalized === label) return document
      }
      return null
    }

    /**
     * One diagnostic entry as readable text.
     * @param {unknown} item - a diagnostic with optional `source` and `message`.
     * @returns {string} display text.
     */
    function diagnosticText(item) {
      if (item === null || typeof item !== 'object') {
        return item === null || item === undefined ? '' : String(item)
      }
      const message = typeof item.message === 'string' ? item.message : ''
      const source = typeof item.source === 'string' && item.source !== '' ? item.source + ': ' : ''
      return source + message
    }

    /** One pill-shaped list badge; `key` seats it inside a keyed badge array. */
    function badge(text, modifier, key, title) {
      return h('span', {
        key: key,
        className: modifier === undefined
          ? 'agent-soul-badge'
          : 'agent-soul-badge ' + modifier,
        title: typeof title === 'string' && title !== '' ? title : undefined,
      }, text)
    }

    /** One `<code>`-styled value. */
    function codeValue(text) {
      return h('code', { className: 'agent-soul-code' }, String(text))
    }

    /** A column of `<code>`-styled values. */
    function codeList(values) {
      return h('div', { className: 'agent-soul-code-list' }, values.map(function (value, index) {
        return h('code', { key: index, className: 'agent-soul-code' }, String(value))
      }))
    }

    /** Muted single-line value. */
    function muted(text) {
      return h('span', { className: 'agent-soul-muted' }, text)
    }

    /** One label/value row of the settings card. */
    function infoRow(label, value) {
      return h('div', { className: 'agent-soul-info-row' },
        h('span', { className: 'agent-soul-info-label' }, label),
        h('span', { className: 'agent-soul-info-value' }, value))
    }

    /** Diagnostics list used by the preview panel and the editor. */
    function diagnosticsList(title, items) {
      return h('div', { className: 'agent-soul-group' },
        h('h4', { className: 'agent-soul-group-head' }, title),
        h('ul', { className: 'agent-soul-diagnostics' }, items.map(function (item, index) {
          return h('li', { key: index, className: 'agent-soul-diagnostic' }, diagnosticText(item))
        })))
    }

    /** Build the `aria-describedby` list for one control. */
    function describedBy(config) {
      const ids = []
      if (config.hint !== undefined) ids.push(config.id + '-hint')
      if (config.error !== undefined) ids.push(config.id + '-error')
      if (typeof config.describedBy === 'string' && config.describedBy !== '') ids.push(config.describedBy)
      return ids.length === 0 ? undefined : ids.join(' ')
    }

    /** `aria-invalid` for a control with a field error or an explicit invalid flag. */
    function ariaInvalid(config) {
      return config.error !== undefined || config.invalid === true ? true : undefined
    }

    /** Label + hint + error + control shell shared by the editor fields. */
    function fieldShell(id, label, hint, control, error, errorId) {
      return h('div', { className: 'agent-soul-field' },
        h('label', { className: 'agent-soul-field-label', htmlFor: id }, label),
        hint === undefined ? null : h('p', { className: 'agent-soul-field-hint', id: id + '-hint' }, hint),
        control,
        error === undefined
          ? null
          : h('p', { className: 'agent-soul-field-error', id: errorId, role: 'alert' }, error))
    }

    /** Single-line text field. */
    function textInput(config) {
      return fieldShell(config.id, config.label, config.hint, h('input', {
        id: config.id,
        className: 'agent-soul-input',
        type: 'text',
        value: config.value === null || config.value === undefined ? '' : String(config.value),
        placeholder: config.placeholder,
        disabled: config.disabled === true,
        'aria-invalid': ariaInvalid(config),
        'aria-describedby': describedBy(config),
        onChange: function (event) {
          if (config.disabled === true) return
          config.onChange(event.target.value)
        },
      }), config.error, config.id + '-error')
    }

    /** Bounded integer field (the orchestrator's max-retries, 0–10). */
    function numberInput(config) {
      return fieldShell(config.id, config.label, config.hint, h('input', {
        id: config.id,
        className: 'agent-soul-input',
        type: 'number',
        min: config.min === undefined ? 0 : config.min,
        max: config.max === undefined ? 10 : config.max,
        step: 1,
        inputMode: 'numeric',
        value: config.value === null || config.value === undefined ? '' : String(config.value),
        disabled: config.disabled === true,
        'aria-invalid': ariaInvalid(config),
        'aria-describedby': describedBy(config),
        onChange: function (event) {
          if (config.disabled === true) return
          config.onChange(event.target.value)
        },
      }), config.error, config.id + '-error')
    }

    /** Multi-line text field; every Markdown section is one of these. */
    function textArea(config) {
      return fieldShell(config.id, config.label, config.hint, h('textarea', {
        id: config.id,
        className: config.mono === true
          ? 'agent-soul-textarea agent-soul-textarea-mono'
          : 'agent-soul-textarea',
        value: config.value === null || config.value === undefined ? '' : String(config.value),
        rows: config.rows === undefined ? 4 : config.rows,
        placeholder: config.placeholder,
        disabled: config.disabled === true,
        'aria-invalid': ariaInvalid(config),
        'aria-describedby': describedBy(config),
        onChange: function (event) {
          if (config.disabled === true) return
          config.onChange(event.target.value)
        },
      }), config.error, config.id + '-error')
    }

    /** Enum/select field. */
    function selectInput(config) {
      return fieldShell(config.id, config.label, config.hint, h('select', {
        id: config.id,
        className: 'agent-soul-select',
        value: config.value === null || config.value === undefined ? '' : String(config.value),
        disabled: config.disabled === true,
        'aria-invalid': ariaInvalid(config),
        'aria-describedby': describedBy(config),
        onChange: function (event) {
          if (config.disabled === true) return
          config.onChange(event.target.value)
        },
      }, config.options.map(function (option) {
        return h('option', { key: option.value, value: option.value }, option.label)
      })), config.error, config.id + '-error')
    }

    // Page-local wrappers add busyLocked without repeating it at every field.
    const sharedTextInput = textInput
    const sharedNumberInput = numberInput
    const sharedTextArea = textArea
    const sharedSelectInput = selectInput

    /** Focusable controls used by the modal's Tab / Shift+Tab focus trap. */
    const DIALOG_FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

    /** Visible, enabled controls in their current dialog tab order. */
    function dialogFocusableElements(dialog) {
      return Array.prototype.slice.call(dialog.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR))
        .filter(function (node) {
          return node.hidden !== true && node.getAttribute('aria-hidden') !== 'true'
        })
    }

    /** Whether Escape belongs to a nested menu/listbox rather than this dialog. */
    function nestedMenuOwnsEscape(target, dialog) {
      if (target === null || target === undefined || typeof target.closest !== 'function') return false
      const nested = target.closest('[role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"]')
      return nested !== null && nested !== undefined && nested !== dialog
        && dialog !== null && typeof dialog.contains === 'function' && dialog.contains(nested)
    }

    /**
     * Resolve the current main Session's cwd. SessionListState has no main id:
     * the main view is the summary retained by `retainedBy.mainView`. A scoped
     * sessionId is more specific; a sole listed cwd preserves single-workspace
     * installations. Multiple unassociated workspaces deliberately return ''.
     */
    function currentSessionCwd(state, preferredSessionId) {
      if (state === null || typeof state !== 'object') return ''
      const byId = state.byId !== null && typeof state.byId === 'object' ? state.byId : {}
      const cwdOf = function (summary) {
        return summary !== null && typeof summary === 'object' && typeof summary.cwd === 'string'
          ? summary.cwd.trim()
          : ''
      }
      if (typeof preferredSessionId === 'string' && preferredSessionId !== '') {
        const preferred = cwdOf(byId[preferredSessionId])
        if (preferred !== '') return preferred
      }
      const summaries = Object.keys(byId).map(function (key) { return byId[key] })
      for (const summary of summaries) {
        const retainedBy = summary !== null && typeof summary === 'object' && summary.retainedBy !== null
          && typeof summary.retainedBy === 'object' ? summary.retainedBy : {}
        if (typeof retainedBy.mainView === 'number' && retainedBy.mainView > 0) {
          const current = cwdOf(summary)
          if (current !== '') return current
        }
      }
      const listedIds = Array.isArray(state.ids) ? state.ids : []
      const roots = []
      for (const sessionId of listedIds) {
        const root = cwdOf(byId[sessionId])
        if (root !== '' && roots.indexOf(root) === -1) roots.push(root)
      }
      return roots.length === 1 ? roots[0] : ''
    }

    /**
     * Plugins-page row whose configuration this bundle contributes, keyed by
     * `<package name>#<row id>` as the bundle's own patch declares the row.
     */
    const PLUGIN_ROW_CONFIG_KEY = '@local/dsh-agent-soul#agent-soul-team'

    /** Route the packaged-defaults toggle reads and writes (profile-wide). */
    const CONFIG_ROUTE = 'agent-soul/config'

    /** Poll cadence after a successful write: the Loader reloads the row once. */
    const CONFIG_POLL_INTERVAL_MS = 1200
    const CONFIG_POLL_ATTEMPTS = 6

    /**
     * Normalize the `config` block of `GET/POST agent-soul/config`. A missing
     * flag stays conservative: not editable, packaged catalog enabled, and
     * never writable unless the Host said so.
     * @param {any} payload - the route payload.
     * @returns {{ bundledEditable: boolean, bundled: boolean, configurable: boolean } | null}
     *   the normalized block, or null when the answer carries none.
     */
    function normalizeConfigBlock(payload) {
      if (payload === null || typeof payload !== 'object') return null
      const block = payload.config !== null && typeof payload.config === 'object' ? payload.config : null
      if (block === null) return null
      return {
        bundledEditable: block.bundledEditable === true,
        bundled: block.bundled !== false,
        configurable: block.configurable === true,
      }
    }

    /**
     * The Host message for a failed read or write, or the localized fallback
     * when the failure carried none.
     * @param {Function} t - the bound translate function.
     * @param {unknown} error - a thrown failure.
     * @returns {string} display text.
     */
    function configFailureText(t, error) {
      const failure = failureOf(error)
      return failure.message === '' ? t('statusError') : failure.message
    }

    /**
     * The profile-wide state of the packaged-defaults switch.
     *
     * The setting lives in the profile patch, not in this page, so every mounted
     * control (the Settings card and the Plugins row page) reads and writes the
     * same record: a write started in one is visible in the other without a
     * remount, and neither can show a value the other has already replaced.
     *
     * `phase` is the honest write lifecycle: `saving` (POST in flight),
     * `applying` (POST accepted, waiting for a GET that shows the new value),
     * `applied` (a GET confirmed it), `unknown` (the write was accepted but no
     * read ever confirmed it), or `error` (the write itself failed).
     */
    const configState = {
      block: null,
      phase: 'loading',
      failure: '',
      requested: null,
      writeActive: false,
      listeners: new Set(),
    }

    /** Merge one config-state patch and wake every mounted control. */
    function configStateSet(patch) {
      Object.assign(configState, patch)
      for (const listener of Array.from(configState.listeners)) {
        try {
          listener()
        } catch (error) {
          // A broken control must not stop the shared state from settling.
        }
      }
    }

    /** Subscribe one control to the shared config state; returns the remover. */
    function subscribeConfigState(listener) {
      configState.listeners.add(listener)
      return function () { configState.listeners.delete(listener) }
    }

    /**
     * Listeners for settled packaged-defaults writes: the page re-reads
     * everything the effective flag can change (catalog rows, the open
     * document, the orchestrator tab). `verified` is false when the write was
     * accepted but no read confirmed it.
     */
    const configSettledListeners = new Set()

    /** Tell every page listener that one write settled. */
    function notifyConfigSettled(change) {
      for (const listener of Array.from(configSettledListeners)) {
        try {
          listener(change)
        } catch (error) {
          // A page refresh must not break the switch that reported the write.
        }
      }
    }

    /** Subscribe one page to settled writes; returns the remover. */
    function subscribeConfigSettled(listener) {
      configSettledListeners.add(listener)
      return function () { configSettledListeners.delete(listener) }
    }

    /**
     * Read and write the packaged-defaults mode and project one display state.
     *
     * The write lands in the profile patch, so the Loader reloads this plugin
     * row once; the hook therefore polls the read route a few times after a
     * successful save. Only a read that shows the written value is reported as
     * applied — a mismatched or unreadable poll ends in `unknown` so the switch
     * never claims an application nobody observed. Timers and late answers are
     * dropped on unmount.
     *
     * @param {Function} t - the bound translate function.
     * @returns {{ checked: boolean, disabled: boolean, status: string, error: boolean,
     *   onChange: (event: any) => void }} the switch contract.
     */
    function useDefaultSoulsConfig(t) {
      const [, setRevision] = React.useState(0)
      const alive = React.useRef(true)
      const timer = React.useRef(null)
      const ownsWrite = React.useRef(false)
      const config = configState.block
      const phase = configState.phase
      const failure = configState.failure
      const setConfig = React.useCallback(function setConfig(next) {
        configStateSet({ block: next })
      }, [])
      const setPhase = React.useCallback(function setPhase(next) {
        configStateSet({ phase: next })
      }, [])
      const setFailure = React.useCallback(function setFailure(next) {
        configStateSet({ failure: next })
      }, [])

      const load = React.useCallback(async function load() {
        if (configState.block === null && configState.phase !== 'saving' && configState.phase !== 'applying') {
          setPhase('loading')
          setFailure('')
        }
        try {
          const payload = await readJson(await fetch(CONFIG_ROUTE, { headers: { accept: 'application/json' } }))
          if (!alive.current) return
          const block = normalizeConfigBlock(payload)
          if (block === null) {
            setPhase('error')
            setFailure(t('statusError'))
            return
          }
          const current = configState.phase
          if (current === 'saving' || current === 'applying') {
            // A write is in flight here, or an earlier page was reloaded before
            // it finished. Report the block, then settle an interrupted write
            // from this read instead of leaving "Applying..." forever.
            setConfig(block)
            if (!configState.writeActive) {
              if (configState.requested !== null && block.bundledEditable === configState.requested) {
                setPhase('applied')
              } else {
                setPhase('unknown')
              }
            }
            return
          }
          setConfig(block)
          setFailure('')
          setPhase('ready')
        } catch (error) {
          if (!alive.current) return
          setPhase('error')
          setFailure(configFailureText(t, error))
        }
      }, [t, setConfig, setFailure, setPhase])

      React.useEffect(function () {
        alive.current = true
        void load()
        return function () {
          alive.current = false
        }
      }, [load])

      // Mount-scoped subscription: either control may be the writer, and both
      // render from the same record.
      React.useEffect(function () {
        return subscribeConfigState(function () {
          setRevision(function (revision) { return revision + 1 })
        })
      }, [])

      // Unmount only: a write started here must not leave the other control (or
      // the next mount) showing "Applying..." with no poll behind it.
      React.useEffect(function () {
        return function () {
          if (timer.current !== null) {
            clearTimeout(timer.current)
            timer.current = null
          }
          if (!ownsWrite.current) return
          ownsWrite.current = false
          if (configState.phase === 'saving' || configState.phase === 'applying') {
            configStateSet({ writeActive: false, phase: 'unknown' })
          }
        }
      }, [])

      const poll = function poll(requested, attempt) {
        if (!alive.current) return
        timer.current = setTimeout(async function () {
          timer.current = null
          if (!alive.current) return
          let block = null
          let matched = false
          try {
            const payload = await readJson(await fetch(CONFIG_ROUTE, { headers: { accept: 'application/json' } }))
            block = normalizeConfigBlock(payload)
            matched = block !== null && block.bundledEditable === requested
          } catch (error) {
            block = null
            matched = false
          }
          if (!alive.current) return
          if (block !== null) setConfig(block)
          if (matched) {
            ownsWrite.current = false
            configStateSet({ phase: 'applied', requested: requested, writeActive: false, failure: '' })
            notifyConfigSettled({ verified: true, bundledEditable: requested })
            return
          }
          if (attempt >= CONFIG_POLL_ATTEMPTS) {
            // Exhausted without a read that shows the written value: never
            // report success, and never invent one from the POST alone.
            ownsWrite.current = false
            configStateSet({ phase: 'unknown', requested: requested, writeActive: false })
            notifyConfigSettled({ verified: false, bundledEditable: requested })
            return
          }
          poll(requested, attempt + 1)
        }, CONFIG_POLL_INTERVAL_MS)
      }

      const toggle = React.useCallback(async function toggle(next) {
        if (config === null || config.bundled === false || !config.configurable) return
        if (configState.writeActive) return
        ownsWrite.current = true
        setPhase('saving')
        setFailure('')
        configStateSet({ requested: next === true, writeActive: true })
        try {
          const payload = await readJson(await fetch(CONFIG_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bundledEditable: next === true }),
          }))
          if (!alive.current) return
          const block = normalizeConfigBlock(payload)
          if (block !== null) setConfig(block)
          setPhase('applying')
          poll(next === true, 1)
        } catch (error) {
          if (!alive.current) return
          ownsWrite.current = false
          configStateSet({ writeActive: false })
          setPhase('error')
          setFailure(configFailureText(t, error))
        }
      }, [config, t])

      const busy = phase === 'loading' || phase === 'saving' || phase === 'applying'
      const blocked = config === null || config.bundled === false || !config.configurable
      const checked = config !== null && config.bundledEditable === true
      let status = ''
      if (phase === 'loading') status = t('statusLoading')
      else if (phase === 'saving') status = t('statusSaving')
      else if (phase === 'applying') status = t('statusApplying')
      else if (phase === 'applied') status = t('statusApplied')
      else if (phase === 'unknown') status = t('statusUnverified')
      else if (phase === 'error') status = failure === '' ? t('statusError') : failure
      else if (config === null) status = t('statusError')
      else if (config.bundled === false) status = t('statusUnavailable')
      else if (!config.configurable) status = t('statusNotConfigurable')
      else status = config.bundledEditable ? t('statusOn') : t('statusOff')

      return {
        checked: checked,
        disabled: busy || blocked,
        status: status,
        error: phase === 'error' || phase === 'unknown',
        onChange: function (event) {
          if (busy || config === null || config.bundled === false || !config.configurable) return
          void toggle(event.target.checked)
        },
      }
    }

    /**
     * The packaged-defaults switch inside the Settings card row. The row label
     * already names the setting, so the checkbox carries that copy as its
     * accessible name instead of a second visible label.
     */
    function DefaultSoulsCardControl(props) {
      const t = typeof props.t === 'function' ? props.t : function (key) { return key }
      const control = useDefaultSoulsConfig(t)
      const inputId = React.useId() + '-default-souls'
      return h('div', { className: 'agent-soul-stack' },
        h('div', { className: 'agent-soul-checkbox-row' },
          h('input', {
            id: inputId,
            className: 'agent-soul-checkbox',
            type: 'checkbox',
            checked: control.checked,
            disabled: control.disabled,
            'aria-label': t('toggleLabel'),
            onChange: control.onChange,
          })),
        h('span', {
          className: control.error ? 'agent-soul-field-error' : 'agent-soul-field-hint',
          role: 'status',
        }, control.status))
    }

    /**
     * The row configuration page the Plugins page opens for this bundle's row.
     * It draws its own title because that page shows the row's name above the
     * contribution, and ships its own stylesheet because the Agent Soul page is
     * not mounted there.
     */
    function DefaultSoulsConfigPage(props) {
      const t = typeof props.t === 'function' ? props.t : function (key) { return key }
      const control = useDefaultSoulsConfig(t)
      const inputId = React.useId() + '-default-souls'
      return h('section', { className: 'agent-soul-cfg-page', 'aria-label': t('pageTitle') },
        h('style', { key: 'agent-soul-cfg-styles' }, CONFIG_STYLES),
        h('h3', { className: 'agent-soul-cfg-title' }, t('pageTitle')),
        h('p', { className: 'agent-soul-cfg-description' }, t('pageDescription')),
        h('div', { className: 'agent-soul-cfg-control' },
          h('label', {
            className: 'agent-soul-cfg-switch' + (control.disabled ? ' agent-soul-cfg-switch-disabled' : ''),
            htmlFor: inputId,
          },
            h('input', {
              id: inputId,
              className: 'agent-soul-cfg-checkbox',
              type: 'checkbox',
              checked: control.checked,
              disabled: control.disabled,
              onChange: control.onChange,
            }),
            h('span', null, t('toggleLabel'))),
          h('p', {
            className: 'agent-soul-cfg-status' + (control.error ? ' agent-soul-cfg-status-error' : ''),
            role: 'status',
          }, control.status)))
    }

    /**
     * One `plugins.row.config` entry: the one-line summary the row page uses
     * when the package description is absent, and the page itself otherwise.
     * The branch is hook-free so the two views never share a hook order.
     */
    function DefaultSoulsConfigEntry(props) {
      const t = typeof props.t === 'function' ? props.t : function (key) { return key }
      if (props.view === 'summary') return t('summary')
      return h(DefaultSoulsConfigPage, { t: t })
    }

    /**
     * Settings → "Agent Soul": catalog list, per-section editor, and the
     * plugin settings/runtime card. Every state is derived from the overview,
     * the selected document draft, and the one status line.
     */
    function AgentSoulPage(props) {
      const t = typeof props.t === 'function' ? props.t : function (key) { return key }
      const preferredSessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const selectCurrentSessionCwd = React.useCallback(function (state) {
        return currentSessionCwd(state, preferredSessionId)
      }, [preferredSessionId])
      const sessionRoot = typeof props.useSessions === 'function'
        ? props.useSessions(selectCurrentSessionCwd)
        : ''
      const baseId = React.useId()
      const id = function (name) { return baseId + '-' + name }

      const [activeTab, setActiveTab] = React.useState('souls')
      const [overview, setOverview] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [overviewError, setOverviewError] = React.useState(null)
      const [orchestrator, setOrchestrator] = React.useState(null)
      const [orchestratorDraft, setOrchestratorDraft] = React.useState(null)
      const [orchestratorBaseline, setOrchestratorBaseline] = React.useState(null)
      const [orchestratorLoading, setOrchestratorLoading] = React.useState(false)
      const [orchestratorError, setOrchestratorError] = React.useState(null)
      const [orchestratorFieldErrors, setOrchestratorFieldErrors] = React.useState({})
      const [selected, setSelected] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [baseline, setBaseline] = React.useState(null)
      const [documentError, setDocumentError] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [status, setStatus] = React.useState(null)
      const [dialogMode, setDialogMode] = React.useState(null)
      const [editorSize, setEditorSize] = React.useState(readStoredEditorSize)
      const [newName, setNewName] = React.useState('')
      const [confirmDelete, setConfirmDelete] = React.useState(false)
      const [pendingAction, setPendingAction] = React.useState(null)
      const [draftOffer, setDraftOffer] = React.useState(null)
      const [fieldErrors, setFieldErrors] = React.useState({})
      const [conflict, setConflict] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [sortMode, setSortMode] = React.useState('name')
      const [copied, setCopied] = React.useState('')
      const [mode, setMode] = React.useState('form')
      const [rawSource, setRawSource] = React.useState('')
      const [baselineSource, setBaselineSource] = React.useState('')
      const [rawDiagnostics, setRawDiagnostics] = React.useState([])
      const [duplicateOpen, setDuplicateOpen] = React.useState(false)
      const [duplicateName, setDuplicateName] = React.useState('')
      const [pasteSource, setPasteSource] = React.useState('')
      const [pasteResult, setPasteResult] = React.useState(null)
      const [template, setTemplate] = React.useState('blank')
      const [undo, setUndo] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [previewOpen, setPreviewOpen] = React.useState(true)
      const [previewLoading, setPreviewLoading] = React.useState(false)
      const [previewError, setPreviewError] = React.useState(null)
      const [previewNonce, setPreviewNonce] = React.useState(0)
      const [composedOpen, setComposedOpen] = React.useState(false)
      const previewSeq = React.useRef(0)
      const openSeq = React.useRef(0)
      const parseSeq = React.useRef(0)
      const overviewSeq = React.useRef(0)
      const orchestratorSeq = React.useRef(0)
      const dialogRef = React.useRef(null)
      const returnFocusRef = React.useRef(null)
      const resizeStopRef = React.useRef(null)
      // Pin the first session-associated root (or Host overview fallback). Later
      // session switches must not silently move unsaved edits to another root.
      const workspaceRootRef = React.useRef(sessionRoot)
      const workspaceRootSourceRef = React.useRef(sessionRoot === '' ? 'pending' : 'session')
      // The newest render, readable from module-level callbacks and async
      // handlers: a background refresh must never act on stale state.
      const selectedRef = React.useRef(null)
      const dialogModeRef = React.useRef(null)
      const dirtyRef = React.useRef(false)
      const orchestratorRef = React.useRef(null)
      const orchestratorDirtyRef = React.useRef(false)
      const busyRef = React.useRef('')
      const dirty = draft !== null && baseline !== null
        && (snapshotDraft(draft) !== baseline
          || (mode === 'raw' && rawSource !== baselineSource))

      /** Focus one control by the same id the form rendered. */
      const focusField = React.useCallback(function focusField(key) {
        const suffix = FIELD_CONTROL_SUFFIX[key]
        if (suffix === undefined) return
        try {
          const node = document.getElementById(baseId + '-' + suffix)
          if (node !== null && typeof node.focus === 'function') node.focus()
        } catch (error) {
          // A detached field cannot take focus; the summary link still names it.
        }
      }, [baseId])

      /** Focus one orchestrator control by its rendered id suffix. */
      const focusOrchestratorField = React.useCallback(function focusOrchestratorField(key) {
        const suffix = ORCHESTRATOR_CONTROL_SUFFIX[key]
        if (suffix === undefined) return
        try {
          const node = document.getElementById(baseId + '-' + suffix)
          if (node !== null && typeof node.focus === 'function') node.focus()
        } catch (error) {
          // A detached field cannot take focus; the summary link still names it.
        }
      }, [baseId])

      /**
       * Remember the invoking control, then open the modal editor dialog.
       * Every open path (select, create, import, restore) funnels through here
       * so focus can return to the right place on close.
       * @param {'document'|'create'|'import'|'orchestrator'} mode - dialog content to show.
       * @param {Element | null} [origin] - the control that opened the dialog.
       */
      const enterDialog = function (mode, origin) {
        const active = typeof document !== 'undefined' ? document.activeElement : null
        if (origin !== undefined && origin !== null) {
          returnFocusRef.current = origin
        } else if (returnFocusRef.current === null) {
          returnFocusRef.current = active
        }
        if (mode !== 'document') openSeq.current += 1
        if (mode !== 'import') parseSeq.current += 1
        if ((mode !== 'document' && busy === 'document') || (mode !== 'import' && busy === 'parse')) {
          setBusy('')
        }
        setDialogMode(mode)
        setConfirmDelete(false)
        setPendingAction(null)
      }

      /** Close the dialog and move focus back to the card that opened it. */
      const closeDialog = function () {
        // A late open/parse response belongs to the closed dialog and must not
        // repopulate it or clear the busy state of a newer operation.
        openSeq.current += 1
        parseSeq.current += 1
        if (busy === 'document' || busy === 'parse') setBusy('')
        if (resizeStopRef.current !== null) {
          resizeStopRef.current()
          resizeStopRef.current = null
        }
        setDialogMode(null)
        setConfirmDelete(false)
        setDuplicateOpen(false)
        setPendingAction(null)
        setPasteSource('')
        setPasteResult(null)
        setNewName('')
        setTemplate('blank')
        setOrchestratorFieldErrors({})
        const origin = returnFocusRef.current
        returnFocusRef.current = null
        window.setTimeout(function () {
          if (origin !== null && origin !== undefined && origin.isConnected !== false
            && typeof origin.focus === 'function') {
            try {
              origin.focus()
              return
            } catch (error) {
              // Fall through to the toolbar button when the card is gone.
            }
          }
          try {
            const fallback = document.getElementById(baseId + '-new-button')
              || document.getElementById(baseId + '-orchestrator-edit')
            if (fallback !== null && typeof fallback.focus === 'function') fallback.focus()
          } catch (error) {
            // A closed page has nowhere to restore focus; closing still succeeds.
          }
        }, 0)
      }

      /** Restore the default dialog size (also offered from the title row). */
      const resetEditorSize = function () {
        setEditorSize(defaultEditorSize())
      }

      /** Grow or shrink the dialog from the keyboard handle. */
      const resizeBy = function (deltaWidth, deltaHeight) {
        setEditorSize(function (current) {
          return clampEditorSize({
            width: current.width + deltaWidth,
            height: current.height + deltaHeight,
          })
        })
      }

      /**
       * Begin a pointer drag on the bottom-right handle. Moves resize the
       * panel within the documented minimum and maximum; the size persists
       * through the effect below.
       */
      const startResize = function (event) {
        if (event !== null && typeof event === 'object'
          && typeof event.preventDefault === 'function') event.preventDefault()
        const startX = typeof event.clientX === 'number' ? event.clientX : 0
        const startY = typeof event.clientY === 'number' ? event.clientY : 0
        const start = clampEditorSize(editorSize)
        const onMove = function (moveEvent) {
          const nextX = typeof moveEvent.clientX === 'number' ? moveEvent.clientX : startX
          const nextY = typeof moveEvent.clientY === 'number' ? moveEvent.clientY : startY
          setEditorSize(clampEditorSize({
            width: start.width + (nextX - startX),
            height: start.height + (nextY - startY),
          }))
        }
        const stop = function () {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', stop)
          window.removeEventListener('pointercancel', stop)
          resizeStopRef.current = null
        }
        if (resizeStopRef.current !== null) resizeStopRef.current()
        resizeStopRef.current = stop
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', stop)
        window.addEventListener('pointercancel', stop)
      }

      /** Arrow keys resize from the handle; Home resets to the default size. */
      const handleResizeKeyDown = function (event) {
        const step = event.shiftKey ? 64 : 24
        let handled = true
        if (event.key === 'ArrowRight') resizeBy(step, 0)
        else if (event.key === 'ArrowLeft') resizeBy(-step, 0)
        else if (event.key === 'ArrowDown') resizeBy(0, step)
        else if (event.key === 'ArrowUp') resizeBy(0, -step)
        else if (event.key === 'Home') resetEditorSize()
        else handled = false
        if (handled && typeof event.preventDefault === 'function') event.preventDefault()
      }

      const loadOverview = React.useCallback(async function loadOverview() {
        const seq = overviewSeq.current + 1
        overviewSeq.current = seq
        const root = workspaceRootRef.current
        setLoading(true)
        setOverviewError(null)
        try {
          const payload = await readJson(await fetch('agent-soul/overview' + '?root=' + encodeURIComponent(root)))
          if (overviewSeq.current !== seq) return false
          // A 200 answer that is not the documented overview is an error, not an
          // empty catalog: the page must show its error card (with the last good
          // rows kept) instead of "No soul files yet" or a skeleton.
          const shapeFailure = overviewPayloadFailure(payload)
          if (shapeFailure !== null) throw shapeFailure
          const hostRoot = payload.plugin !== null && typeof payload.plugin === 'object'
            && typeof payload.plugin.root === 'string' && payload.plugin.root !== ''
            ? payload.plugin.root
            : ''
          if (workspaceRootSourceRef.current === 'pending' && hostRoot !== '') {
            workspaceRootRef.current = hostRoot
            workspaceRootSourceRef.current = 'overview'
          } else if (root !== '' && hostRoot !== '' && hostRoot !== root) {
            // The Host is the validation/canonicalization boundary for a root
            // proposed by the Client session selector.
            workspaceRootRef.current = hostRoot
          }
          setOverview(payload)
          return true
        } catch (error) {
          if (overviewSeq.current !== seq) return false
          setOverviewError(failureOf(error))
          return false
        } finally {
          if (overviewSeq.current === seq) setLoading(false)
        }
      }, [])

      /**
       * Persist the default Agent Soul through the authenticated route, then
       * re-read the overview so the Default badge and warning reflect the Host.
       * `name === null` clears the explicit selection.
       * @param {string | null} name
       * @returns {Promise<void>}
       */
      const requestSetDefault = React.useCallback(async function requestSetDefault(name) {
        setBusy('preferences')
        setStatus(null)
        try {
          const payload = await readJson(await fetch('agent-soul/preferences', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root: workspaceRootRef.current, name: name }),
          }))
          if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
            throw {
              code: 'invalid-request',
              message: payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
                ? payload.message
                : '',
            }
          }
          await loadOverview()
          setStatus({
            kind: 'success',
            text: name === null ? t('statusDefaultCleared') : t('statusDefaultSaved', { name: name }),
          })
        } catch (error) {
          const failure = failureOf(error)
          setStatus({ kind: 'error', text: failureText(t, failure) })
        } finally {
          setBusy('')
        }
      }, [loadOverview, t])

      /**
       * Read the single orchestrator definition. The route answers with a
       * skeleton (`configured:false`) when the file is absent, so the tab can
       * offer Create default instead of treating that as an error.
       */
      const loadOrchestrator = React.useCallback(async function loadOrchestrator() {
        const seq = orchestratorSeq.current + 1
        orchestratorSeq.current = seq
        const root = workspaceRootRef.current
        setOrchestratorLoading(true)
        try {
          const payload = await readJson(await fetch('agent-soul/orchestrator' + '?root=' + encodeURIComponent(root)))
          if (orchestratorSeq.current !== seq) return null
          if (payload === null || typeof payload !== 'object' || payload.orchestrator === undefined) {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          const record = normalizeOrchestrator(payload.orchestrator)
          setOrchestrator(record)
          setOrchestratorDraft(record)
          setOrchestratorBaseline(snapshotOrchestrator(record))
          setOrchestratorFieldErrors({})
          setOrchestratorError(null)
          return record
        } catch (error) {
          if (orchestratorSeq.current !== seq) return null
          setOrchestratorError(failureOf(error))
          return null
        } finally {
          if (orchestratorSeq.current === seq) setOrchestratorLoading(false)
        }
      }, [])

      /**
       * Read one document into the editor.
       *
       * A quiet read is the background refresh after an applied packaged-defaults
       * setting: it keeps the status line and the busy lock alone, a failure
       * leaves the open editor untouched instead of blanking it, and it drops
       * its answer when an edit, another document, or a save started meanwhile.
       *
       * @param {string} file - the document to open.
       * @param {{ quiet?: boolean }} [options] - quiet background refresh.
       * @returns {Promise<boolean>} whether the document was adopted.
       */
      const openDocument = React.useCallback(async function openDocument(file, options) {
        const quiet = options !== undefined && options !== null && options.quiet === true
        const seq = openSeq.current + 1
        openSeq.current = seq
        const root = workspaceRootRef.current
        if (!quiet) {
          setBusy('document')
          setDocumentError(null)
          setStatus({ kind: 'info', text: t('statusOpening') })
        }
        try {
          const payload = await readJson(await fetch(
            'agent-soul/document?file=' + encodeURIComponent(file) + '&root=' + encodeURIComponent(root)))
          if (openSeq.current !== seq) return false
          // A quiet refresh must never adopt an answer over work that started
          // after it: an edit, another document, or a save all win.
          if (quiet && (selectedRef.current !== file || dirtyRef.current || busyRef.current !== '')) return false
          if (payload === null || typeof payload !== 'object' || payload.document === undefined) {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          const fileOfDocument = typeof payload.document.file === 'string' && payload.document.file !== ''
            ? payload.document.file
            : file
          const nextBaseline = snapshotDraft(payload.document)
          const loadedSource = typeof payload.document.source === 'string' ? payload.document.source : ''
          const stored = readStoredDraft(fileOfDocument)
          const modifiedAt = typeof payload.document.modifiedAt === 'number'
            ? payload.document.modifiedAt
            : 0
          const storedSnapshot = stored === null
            ? null
            : JSON.stringify({ fields: stored.fields, sections: stored.sections })
          // A raw-only edit changes no form field, so the stored source decides
          // whether the draft is actually newer than the file it was based on.
          const storedRawDirty = stored !== null && typeof stored.rawSource === 'string'
            && stored.rawSource !== loadedSource
          setSelected(file)
          setDraft(payload.document)
          setBaseline(nextBaseline)
          setBaselineSource(loadedSource)
          setRawSource(loadedSource)
          setRawDiagnostics([])
          setDuplicateOpen(false)
          setPreview(null)
          setPreviewError(null)
          setDraftOffer(stored !== null && stored.savedAt > modifiedAt
            && (storedSnapshot !== nextBaseline || storedRawDirty)
            ? stored
            : null)
          setFieldErrors({})
          setConflict(null)
          setConfirmDelete(false)
          setDocumentError(null)
          if (!quiet) setStatus(null)
          return true
        } catch (error) {
          if (openSeq.current !== seq) return false
          const failure = failureOf(error)
          setDocumentError(failure)
          setStatus({ kind: 'error', text: failureText(t, failure) })
          if (quiet) return false
          setSelected(file)
          setDraft(null)
          setBaseline(null)
          setBaselineSource('')
          setRawSource('')
          setRawDiagnostics([])
          setDuplicateOpen(false)
          setPreview(null)
          setPreviewError(null)
          setDraftOffer(null)
          setFieldErrors({})
          setConflict(null)
          setConfirmDelete(false)
          return false
        } finally {
          if (openSeq.current === seq && !quiet) setBusy('')
        }
      }, [t])

      /**
       * Adopt a DocumentDetail returned by save/create/duplicate/restore: it is
       * the Host's re-read state, so the editor shows exactly what the next scan
       * will see, including the new hash and raw source baseline.
       * @param {object} document - a DocumentDetail payload.
       */
      const adoptDocument = React.useCallback(function adoptDocument(document) {
        if (document === null || typeof document !== 'object') return
        const source = typeof document.source === 'string' ? document.source : ''
        setSelected(typeof document.file === 'string' ? document.file : null)
        setDraft(document)
        setBaseline(snapshotDraft(document))
        setBaselineSource(source)
        setRawSource(source)
        setRawDiagnostics([])
        setDraftOffer(null)
        setFieldErrors({})
        setConflict(null)
        setConfirmDelete(false)
        setDuplicateOpen(false)
        setDocumentError(null)
        setPreview(null)
        setPreviewError(null)
      }, [])

      /**
       * Re-read everything the effective packaged-defaults flag can change: the
       * catalog rows (bundled badges, save/delete enablement), the open document
       * (package ownership), and the orchestrator definition (bundled hint).
       * Unsaved drafts always win: a dirty document or Orchestrator draft is
       * left exactly as it is, and the tab's own refresh path guards the rest.
       * @returns {Promise<void>}
       */
      const refreshAfterConfigChange = React.useCallback(async function refreshAfterConfigChange() {
        await loadOverview()
        // Nothing to invalidate when the Orchestrator tab was never opened, and
        // never replace unsaved Orchestrator edits.
        if (orchestratorRef.current !== null && !orchestratorDirtyRef.current) await loadOrchestrator()
        const file = selectedRef.current
        if (file === null || dialogModeRef.current !== 'document') return
        if (dirtyRef.current || busyRef.current !== '') return
        await openDocument(file, { quiet: true })
      }, [loadOverview, loadOrchestrator, openDocument])

      // A settled toggle (verified or not) invalidates the dependent views:
      // leaving them stale was the visible half of the toggle defect.
      React.useEffect(function () {
        return subscribeConfigSettled(function () {
          void refreshAfterConfigChange()
        })
      }, [refreshAfterConfigChange])

      // The catalog is read once; the only later read from here is the one that
      // adopts a Session association discovered after the first request. The
      // root is pinned exactly once, so a Session switch never re-reads the
      // workspace and never reloads a dirty editor behind the person's back.
      React.useEffect(function () {
        void loadOverview()
        return function () { overviewSeq.current += 1 }
      }, [loadOverview])

      React.useEffect(function () {
        if (sessionRoot === '' || workspaceRootSourceRef.current !== 'pending') return undefined
        workspaceRootRef.current = sessionRoot
        workspaceRootSourceRef.current = 'session'
        // An association that arrives during initial discovery supersedes the
        // pending request. Once an overview root is pinned, edits never move.
        openSeq.current += 1
        parseSeq.current += 1
        setBusy(function (current) {
          return current === 'document' || current === 'parse' ? '' : current
        })
        void loadOverview()
        // A definition read against the still-unknown fallback root is stale
        // once the real Session root is known. A dirty draft is never replaced.
        if (orchestratorRef.current !== null && !orchestratorDirtyRef.current) void loadOrchestrator()
        return function () { overviewSeq.current += 1 }
      }, [loadOverview, loadOrchestrator, sessionRoot])

      // Fetch the single definition when the tab opens (and on every reopen,
      // which is the tab's refresh behavior); nothing else polls it, and a
      // Session root change must never reload a dirty Orchestrator draft.
      React.useEffect(function () {
        if (activeTab !== 'orchestrator') return undefined
        void loadOrchestrator()
        return function () { orchestratorSeq.current += 1 }
      }, [activeTab, loadOrchestrator])

      const refresh = React.useCallback(async function refresh() {
        setStatus(null)
        setDocumentError(null)
        const loaded = await loadOverview()
        if (!loaded) return
        if (selected !== null) {
          const opened = await openDocument(selected)
          if (!opened) return
        }
        setStatus({ kind: 'success', text: t('statusRefreshed') })
      }, [loadOverview, openDocument, selected, t])

      function updateField(key, value) {
        setDraft(function (current) {
          if (current === null) return current
          const fields = Object.assign({}, current.fields)
          fields[key] = value
          return Object.assign({}, current, { fields: fields })
        })
        setDraftOffer(null)
        setFieldErrors(function (current) {
          if (typeof current[key] !== 'string') return current
          const next = Object.assign({}, current)
          delete next[key]
          return next
        })
      }

      function updateSection(key, value) {
        setDraft(function (current) {
          if (current === null) return current
          const sections = Object.assign({}, current.sections)
          sections[key] = value
          return Object.assign({}, current, { sections: sections })
        })
        setDraftOffer(null)
        if (typeof fieldErrors.body === 'string') {
          setFieldErrors(function (current) {
            const next = Object.assign({}, current)
            delete next.body
            return next
          })
        }
      }

      /** Write one orchestrator config field into the editable draft. */
      function updateOrchestratorField(key, value) {
        setOrchestratorDraft(function (current) {
          if (current === null) return current
          const fields = Object.assign({}, current.fields)
          fields[key] = value
          return Object.assign({}, current, { fields: fields })
        })
        setOrchestratorFieldErrors(function (current) {
          if (typeof current[key] !== 'string') return current
          const next = Object.assign({}, current)
          delete next[key]
          return next
        })
      }

      /** Write one of the six canonical orchestrator sections. */
      function updateOrchestratorSection(key, value) {
        setOrchestratorDraft(function (current) {
          if (current === null) return current
          const sections = Object.assign({}, current.sections)
          sections[key] = value
          return Object.assign({}, current, { sections: sections })
        })
        setOrchestratorFieldErrors(function (current) {
          if (typeof current[key] !== 'string') return current
          const next = Object.assign({}, current)
          delete next[key]
          return next
        })
      }

      /** Open the single orchestrator definition in the shared dialog. */
      const openOrchestrator = function (origin) {
        if (orchestrator === null || orchestratorLoading) return
        setOrchestratorDraft(normalizeOrchestrator(orchestrator))
        setOrchestratorFieldErrors({})
        setStatus(null)
        enterDialog('orchestrator', origin)
      }

      /** Restore the loaded orchestrator definition (Revert in the footer). */
      const revertOrchestrator = function () {
        if (orchestrator === null) return
        setOrchestratorDraft(normalizeOrchestrator(orchestrator))
        setOrchestratorFieldErrors({})
        setStatus({ kind: 'success', text: t('statusReverted') })
      }

      /** Save the orchestrator draft; 400 diagnostics stay inline. */
      const saveOrchestrator = React.useCallback(async function saveOrchestrator() {
        if (orchestratorDraft === null) return
        setBusy('orchestrator-save')
        setStatus({ kind: 'info', text: t('statusSaving') })
        try {
          const payload = await postOrchestrator(orchestratorDraft.fields, orchestratorDraft.sections, workspaceRootRef.current)
          if (payload === null || typeof payload !== 'object' || payload.orchestrator === undefined) {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          const record = normalizeOrchestrator(payload.orchestrator)
          // A successful POST wrote the file, even if the answer omits the flag.
          record.configured = true
          setOrchestrator(record)
          setOrchestratorDraft(record)
          setOrchestratorBaseline(snapshotOrchestrator(record))
          setOrchestratorFieldErrors({})
          setOrchestratorError(null)
          setStatus({ kind: 'success', text: t('statusOrchestratorSaved') })
          void loadOverview()
        } catch (error) {
          const failure = failureOf(error)
          setStatus({ kind: 'error', text: failureText(t, failure) })
          const errors = orchestratorFieldErrorsOf(failure)
          setOrchestratorFieldErrors(errors)
          const first = ORCHESTRATOR_ERROR_KEYS.find(function (key) {
            return typeof errors[key] === 'string' && errors[key] !== ''
          })
          if (first !== undefined) {
            window.setTimeout(function () { focusOrchestratorField(first) }, 0)
          }
          if (failure.diagnostics.length > 0) {
            setOrchestratorDraft(function (current) {
              if (current === null) return current
              return Object.assign({}, current, { diagnostics: failure.diagnostics })
            })
          }
        } finally {
          setBusy('')
        }
      }, [orchestratorDraft, focusOrchestratorField, loadOverview, t])

      /**
       * Compose the default definition in the browser and POST it, then open
       * the dialog on the saved result so the person can review it.
       */
      const createDefaultOrchestrator = React.useCallback(async function createDefaultOrchestrator(origin) {
        const template = composeOrchestratorTemplate()
        setBusy('orchestrator-create')
        setStatus({ kind: 'info', text: t('statusCreating') })
        try {
          const payload = await postOrchestrator(template.fields, template.sections, workspaceRootRef.current)
          if (payload === null || typeof payload !== 'object' || payload.orchestrator === undefined) {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          const record = normalizeOrchestrator(payload.orchestrator)
          // A successful POST wrote the file, even if the answer omits the flag.
          record.configured = true
          setOrchestrator(record)
          setOrchestratorDraft(record)
          setOrchestratorBaseline(snapshotOrchestrator(record))
          setOrchestratorFieldErrors({})
          setOrchestratorError(null)
          setStatus({ kind: 'success', text: t('statusOrchestratorCreated') })
          enterDialog('orchestrator', origin)
          void loadOverview()
        } catch (error) {
          setStatus({ kind: 'error', text: failureText(t, failureOf(error)) })
        } finally {
          setBusy('')
        }
      }, [loadOverview, t])

      /** Open the create form inside the shared dialog (create mode). */
      const startCreate = function (origin) {
        enterDialog('create', origin)
        setNewName('')
        setTemplate('blank')
        setDuplicateOpen(false)
        setStatus(null)
      }

      const submitCreate = React.useCallback(async function submitCreate() {
        const name = newName.trim()
        if (name === '') {
          setStatus({ kind: 'error', text: t('createNameRequired') })
          return
        }
        const source = composeTemplateSource(name, template)
        setBusy('create')
        setStatus({ kind: 'info', text: t('statusCreating') })
        try {
          const payload = await readJson(await fetch('agent-soul/create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: name, source: source, root: workspaceRootRef.current }),
          }))
          if (payload === null || typeof payload !== 'object' || payload.document === undefined) {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          setNewName('')
          setTemplate('blank')
          adoptDocument(payload.document)
          setDialogMode('document')
          setMode('form')
          setStatus({ kind: 'success', text: t('statusCreated', { name: name }) })
          void loadOverview()
        } catch (error) {
          setStatus({ kind: 'error', text: failureText(t, failureOf(error)) })
        } finally {
          setBusy('')
        }
      }, [newName, template, adoptDocument, loadOverview, t])

      const saveDocument = React.useCallback(async function saveDocument(expectedHashOverride, expectedMissingOverride) {
        if (draft === null) return
        const rawMode = mode === 'raw'
        const root = workspaceRootRef.current
        const saveStartedAt = Date.now()
        const savedDraftSnapshot = rawMode ? null : snapshotDraft(draft)
        const expectedMissing = expectedMissingOverride === true
        const expectedHash = expectedMissing
          ? undefined
          : (typeof expectedHashOverride === 'string' && expectedHashOverride !== ''
            ? expectedHashOverride
            : (typeof draft.hash === 'string' && draft.hash !== '' ? draft.hash : undefined))
        setBusy('save')
        setStatus({ kind: 'info', text: t('statusSaving') })
        try {
          const request = rawMode
            ? {
              file: draft.file,
              source: rawSource,
              root: root,
              expectedHash: expectedHash,
            }
            : {
              file: draft.file,
              fields: draft.fields,
              sections: draft.sections,
              root: root,
              expectedHash: expectedHash,
            }
          if (expectedMissing) request.expectedMissing = true
          const payload = await readJson(await fetch('agent-soul/document', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
          }))
          if (payload === null || typeof payload !== 'object' || payload.document === undefined) {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          const savedFile = typeof payload.document.file === 'string' ? payload.document.file : draft.file
          clearStoredDraftAfterSave(savedFile, savedDraftSnapshot, saveStartedAt)
          // The response is the Host's re-read document, so raw mode lands back
          // on the composed state the next scan will see.
          adoptDocument(payload.document)
          setStatus({
            kind: 'success',
            text: rawMode ? t('statusRawSaved') : t('statusSaved'),
          })
          void loadOverview()
        } catch (error) {
          const failure = failureOf(error)
          setStatus({ kind: 'error', text: failureText(t, failure) })
          if (failure.code === 'conflict') {
            setFieldErrors({})
            setConflict({
              currentHash: typeof failure.currentHash === 'string' && failure.currentHash !== ''
                ? failure.currentHash
                : null,
              currentModifiedAt: typeof failure.currentModifiedAt === 'number'
                ? failure.currentModifiedAt
                : null,
            })
          } else if (failure.code === 'invalid') {
            const errors = failure.fieldErrors !== undefined ? failure.fieldErrors : {}
            const textErrors = {}
            for (const key of FIELD_ERROR_ORDER) {
              if (typeof errors[key] === 'string' && errors[key] !== '') textErrors[key] = errors[key]
            }
            setFieldErrors(textErrors)
            const first = firstFieldError(textErrors)
            if (first !== null) {
              window.setTimeout(function () { focusField(first) }, 0)
            }
          }
          if (failure.diagnostics.length > 0) {
            if (rawMode) {
              // Raw mode keeps the pasted/edited source and shows the refusal
              // beside it instead of dropping into the split form.
              setRawDiagnostics(failure.diagnostics)
            } else {
              setDraft(function (current) {
                if (current === null) return current
                return Object.assign({}, current, { diagnostics: failure.diagnostics })
              })
            }
          }
        } finally {
          setBusy('')
        }
      }, [draft, mode, rawSource, focusField, adoptDocument, loadOverview, t])

      const deleteDocument = React.useCallback(async function deleteDocument() {
        if (draft === null) return
        const name = draft.fields !== undefined && typeof draft.fields.name === 'string'
          ? draft.fields.name
          : draft.file
        setBusy('delete')
        setStatus({ kind: 'info', text: t('statusDeleting') })
        try {
          const payload = await readJson(await fetch('agent-soul/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: draft.file, root: workspaceRootRef.current }),
          }))
          const trashedFile = payload !== null && typeof payload === 'object'
            && typeof payload.trashedFile === 'string' && payload.trashedFile !== ''
            ? payload.trashedFile
            : null
          setConfirmDelete(false)
          clearStoredDraft(draft.file)
          setSelected(null)
          setDraft(null)
          setBaseline(null)
          setBaselineSource('')
          setRawSource('')
          setRawDiagnostics([])
          setDraftOffer(null)
          setFieldErrors({})
          setConflict(null)
          setDocumentError(null)
          setPreview(null)
          setPreviewError(null)
          if (trashedFile !== null) {
            setUndo({
              trashedFile: trashedFile,
              file: draft.file,
              name: String(name),
            })
            setStatus({
              kind: 'success',
              text: t('statusDeletedTrashed', { name: String(name) }),
            })
          } else {
            setUndo(null)
            // No trash path was returned: say plainly that the file is gone.
            setStatus({ kind: 'success', text: t('statusDeleted', { name: String(name) }) })
          }
          returnFocusRef.current = null
          closeDialog()
          void loadOverview()
        } catch (error) {
          setConfirmDelete(false)
          setStatus({ kind: 'error', text: failureText(t, failureOf(error)) })
        } finally {
          setBusy('')
        }
      }, [draft, loadOverview, t])

      const restoreDocument = React.useCallback(async function restoreDocument() {
        if (undo === null) return
        setBusy('restore')
        setStatus({ kind: 'info', text: t('statusRestoring') })
        try {
          const payload = await readJson(await fetch('agent-soul/restore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ trashedFile: undo.trashedFile, file: undo.file, root: workspaceRootRef.current }),
          }))
          if (payload === null || typeof payload !== 'object' || payload.document === undefined) {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          adoptDocument(payload.document)
          enterDialog('document')
          setMode('form')
          const fields = payload.document.fields !== null && typeof payload.document.fields === 'object'
            ? payload.document.fields
            : {}
          const name = typeof fields.name === 'string' && fields.name !== '' ? fields.name : undo.name
          setUndo(null)
          setStatus({ kind: 'success', text: t('statusRestored', { name: String(name) }) })
          void loadOverview()
        } catch (error) {
          setStatus({ kind: 'error', text: failureText(t, failureOf(error)) })
        } finally {
          setBusy('')
        }
      }, [undo, adoptDocument, loadOverview, t])

      /** Undo a delete, guarding the current draft first when it is dirty. */
      const requestUndo = function () {
        if (undo === null) return
        if (dirty) {
          setPendingAction({ type: 'undo' })
          return
        }
        void restoreDocument()
      }

      const parsePastedMarkdown = React.useCallback(async function parsePastedMarkdown() {
        if (pasteSource.trim() === '') {
          setStatus({ kind: 'error', text: t('pasteEmpty') })
          return
        }
        const parsedSource = pasteSource
        const root = workspaceRootRef.current
        const seq = parseSeq.current + 1
        parseSeq.current = seq
        setPasteResult(null)
        setBusy('parse')
        try {
          const payload = await readJson(await fetch('agent-soul/parse', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: parsedSource, root: root }),
          }))
          if (parseSeq.current !== seq) return
          if (payload === null || typeof payload !== 'object'
            || payload.fields === null || typeof payload.fields !== 'object'
            || payload.sections === null || typeof payload.sections !== 'object') {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          setPasteResult(Object.assign({}, payload, { parsedSource: parsedSource }))
        } catch (error) {
          if (parseSeq.current !== seq) return
          // The pasted text stays in the panel on every failure.
          setPasteResult(null)
          setStatus({ kind: 'error', text: failureText(t, failureOf(error)) })
        } finally {
          if (parseSeq.current === seq) setBusy('')
        }
      }, [pasteSource, t])

      const importPastedMarkdown = React.useCallback(async function importPastedMarkdown() {
        if (pasteResult === null || pasteResult.parsedSource !== pasteSource) {
          setStatus({ kind: 'error', text: t('pasteParseFirst') })
          return
        }
        // Both import and create consume the exact source snapshot that produced
        // these fields, even if the textarea changes in a later render.
        const parsedSource = pasteResult.parsedSource
        if (selected !== null && draft !== null) {
          setDraft(function (current) {
            if (current === null) return current
            return Object.assign({}, current, {
              fields: pasteResult.fields,
              sections: pasteResult.sections,
            })
          })
          setMode('form')
          setFieldErrors({})
          setDraftOffer(null)
          setRawDiagnostics([])
          setDialogMode('document')
          setPasteSource('')
          setPasteResult(null)
          setStatus({ kind: 'success', text: t('statusPasted') })
          return
        }
        const parsedName = pasteResult.fields !== undefined && typeof pasteResult.fields.name === 'string'
          ? pasteResult.fields.name.trim()
          : ''
        if (parsedName === '') {
          setStatus({ kind: 'error', text: t('pasteMissingName') })
          return
        }
        setBusy('paste-create')
        setStatus({ kind: 'info', text: t('statusCreating') })
        try {
          const payload = await readJson(await fetch('agent-soul/create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: parsedName, source: parsedSource, root: workspaceRootRef.current }),
          }))
          if (payload === null || typeof payload !== 'object' || payload.document === undefined) {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          adoptDocument(payload.document)
          setMode('form')
          setDialogMode('document')
          setPasteSource('')
          setPasteResult(null)
          setStatus({ kind: 'success', text: t('statusPasteCreated', { name: parsedName }) })
          void loadOverview()
        } catch (error) {
          setStatus({ kind: 'error', text: failureText(t, failureOf(error)) })
        } finally {
          setBusy('')
        }
      }, [pasteResult, pasteSource, selected, draft, adoptDocument, loadOverview, t])

      const submitDuplicate = React.useCallback(async function submitDuplicate() {
        if (draft === null || dirty) return
        const name = duplicateName.trim()
        if (name === '') {
          setStatus({ kind: 'error', text: t('createNameRequired') })
          return
        }
        setBusy('duplicate')
        setStatus({ kind: 'info', text: t('duplicatingButton') })
        try {
          const payload = await readJson(await fetch('agent-soul/duplicate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: draft.file, name: name, root: workspaceRootRef.current }),
          }))
          if (payload === null || typeof payload !== 'object' || payload.document === undefined) {
            throw { code: 'invalid-request', message: '', diagnostics: [] }
          }
          adoptDocument(payload.document)
          setStatus({ kind: 'success', text: t('statusDuplicated', { name: name }) })
          void loadOverview()
        } catch (error) {
          setStatus({ kind: 'error', text: failureText(t, failureOf(error)) })
        } finally {
          setBusy('')
        }
      }, [draft, dirty, duplicateName, adoptDocument, loadOverview, t])

      /** Throw away the current edits, restoring the last loaded content. */
      const discardEdits = function () {
        if (draft !== null) clearStoredDraft(draft.file)
        parseSeq.current += 1
        setNewName('')
        setTemplate('blank')
        setPasteSource('')
        setPasteResult(null)
        setDraftOffer(null)
        setFieldErrors({})
        setRawDiagnostics([])
        setRawSource(baselineSource)
        setOrchestratorFieldErrors({})
        if (orchestrator !== null) setOrchestratorDraft(normalizeOrchestrator(orchestrator))
        if (draft !== null && baseline !== null) {
          try {
            const loaded = JSON.parse(baseline)
            setDraft(function (current) {
              if (current === null) return current
              return Object.assign({}, current, { fields: loaded.fields, sections: loaded.sections })
            })
          } catch (error) {
            // A corrupt baseline cannot be restored; the pending action still runs.
          }
        }
      }

      /** Continue a guarded action after the person confirmed Discard changes. */
      const continuePendingAction = function () {
        const action = pendingAction
        setPendingAction(null)
        setConflict(null)
        discardEdits()
        if (action === null) return
        if (action.type === 'close') closeDialog()
        else if (action.type === 'open') {
          enterDialog('document', action.origin)
          void openDocument(action.file)
        } else if (action.type === 'refresh') void refresh()
        else if (action.type === 'mode') switchMode(action.mode)
        else if (action.type === 'undo') void restoreDocument()
        else if (action.type === 'paste') startPaste(action.origin)
        else if (action.type === 'tab') {
          if (dialogMode !== null) closeDialog()
          switchTab(action.tab)
        } else if (action.type === 'orchestrator-refresh') void loadOrchestrator()
        else if (action.type === 'orchestrator-create') void createDefaultOrchestrator(action.origin)
        else startCreate(action.origin)
      }

      /** Switch the page tab (Souls / Orchestrator). */
      const switchTab = function (next) {
        if (next === activeTab) return
        setActiveTab(next)
        setStatus(null)
        setPendingAction(null)
        setDocumentError(null)
      }

      /** Tabs are guarded exactly like document navigation. */
      const requestTab = function (next) {
        if (next === activeTab) return
        if (dialogDirty || orchestratorDirty) {
          setPendingAction({ type: 'tab', tab: next })
          return
        }
        switchTab(next)
      }

      /** Reload the single definition, guarded while its draft is dirty. */
      const requestOrchestratorRefresh = function () {
        if (orchestratorDirty) {
          setPendingAction({ type: 'orchestrator-refresh' })
          return
        }
        void loadOrchestrator()
      }

      /** Create the browser-composed default, guarded while its draft is dirty. */
      const requestCreateDefaultOrchestrator = function (origin) {
        if (orchestratorDirty) {
          setPendingAction({ type: 'orchestrator-create', origin: origin })
          return
        }
        void createDefaultOrchestrator(origin)
      }

      /** Open another document in the dialog, or ask before losing current edits. */
      const requestOpen = function (file, origin) {
        if (busyLocked && busy !== 'document') return
        if (file === selected && dialogMode === 'document') return
        if (dialogDirty) {
          setPendingAction({ type: 'open', file: file, origin: origin })
          return
        }
        enterDialog('document', origin)
        void openDocument(file)
      }

      /** Reload the catalog and open document, guarded while dirty. */
      const requestRefresh = function () {
        if (dirty) {
          setPendingAction({ type: 'refresh' })
          return
        }
        void refresh()
      }

      /** Open the paste/import panel inside the dialog (import mode). */
      const startPaste = function (origin) {
        enterDialog('import', origin)
        setPasteSource('')
        setPasteResult(null)
        setDuplicateOpen(false)
        setStatus(null)
      }

      /** Show the paste/import dialog, guarded while the draft is dirty. */
      const requestPaste = function (origin) {
        if (busyLocked) return
        if (dialogDirty) {
          setPendingAction({ type: 'paste', origin: origin })
          return
        }
        startPaste(origin)
      }

      /** Show the create form, guarded while dirty. */
      const requestCreate = function (origin) {
        if (busyLocked) return
        if (dialogDirty) {
          setPendingAction({ type: 'create', origin: origin })
          return
        }
        startCreate(origin)
      }

      /** Apply a Form/Raw switch; both editors start from the loaded source. */
      const switchMode = function (next) {
        if (next === mode) return
        setMode(next)
        setFieldErrors({})
        setConflict(null)
        setRawDiagnostics([])
        setRawSource(baselineSource)
        setPreview(null)
      }

      /** Toggle Form/Raw, guarded while the current mode is dirty. */
      const requestMode = function (next) {
        if (next === mode) return
        if (dirty) {
          setPendingAction({ type: 'mode', mode: next })
          return
        }
        switchMode(next)
      }

      /** Restore the loaded file content (Revert in the sticky bar). */
      const revertDraft = function () {
        if (draft === null || baseline === null) return
        if (mode === 'raw') {
          setRawSource(baselineSource)
          setRawDiagnostics([])
          setStatus({ kind: 'success', text: t('statusReverted') })
          return
        }
        try {
          const loaded = JSON.parse(baseline)
          setDraft(function (current) {
            if (current === null) return current
            return Object.assign({}, current, {
              fields: loaded.fields,
              sections: loaded.sections,
            })
          })
          clearStoredDraft(draft.file)
          setDraftOffer(null)
          setFieldErrors({})
          setStatus({ kind: 'success', text: t('statusReverted') })
        } catch (error) {
          // The in-memory baseline is always JSON; a parse failure cannot strand the page.
        }
      }

      /** Copy one value and remember which copy control reported success. */
      const copyText = async function (value, marker) {
        const copiedNow = await copyToClipboard(value)
        if (copiedNow) {
          setCopied(marker === undefined ? String(value) : marker)
          return
        }
        setStatus({ kind: 'error', text: t('copyFailed') })
      }

      const documents = overview !== null && Array.isArray(overview.documents)
        ? overview.documents
        : []
      const settings = overview !== null && overview.settings !== null && typeof overview.settings === 'object'
        ? overview.settings
        : {}
      const runtime = overview !== null && overview.runtime !== null && typeof overview.runtime === 'object'
        ? overview.runtime
        : {}
      const catalogs = overview !== null && overview.catalogs !== null && typeof overview.catalogs === 'object'
        ? overview.catalogs
        : {}
      const preferences = overview !== null && overview.preferences !== null
        && typeof overview.preferences === 'object'
        ? overview.preferences
        : null
      const preferenceAvailable = preferences !== null && Array.isArray(preferences.available)
        ? preferences.available.filter(function (name) {
          return typeof name === 'string' && name !== ''
        })
        : []
      const preferenceSelected = preferences !== null && typeof preferences.selected === 'string'
        && preferences.selected !== ''
        ? preferences.selected
        : null
      const preferenceEffective = preferences !== null && typeof preferences.effective === 'string'
        && preferences.effective !== ''
        ? preferences.effective
        : null
      const preferenceWarning = preferences !== null && typeof preferences.warning === 'string'
        && preferences.warning !== ''
        ? preferences.warning
        : null
      const preferenceOptions = [{ value: '', label: t('defaultSoulAutoOption') }]
      if (preferenceSelected !== null && preferenceAvailable.indexOf(preferenceSelected) === -1) {
        preferenceOptions.push({
          value: preferenceSelected,
          label: t('defaultSoulMissingOption', { name: preferenceSelected }),
        })
      }
      preferenceAvailable.forEach(function (name) {
        preferenceOptions.push({
          value: name,
          label: name === preferenceEffective ? name + ' · ' + t('badgeDefault') : name,
        })
      })
      const catalogTools = Array.isArray(catalogs.tools) ? catalogs.tools : []
      const catalogModels = Array.isArray(catalogs.models) ? catalogs.models : []
      const catalogSource = typeof catalogs.source === 'string' ? catalogs.source : 'none'
      const orchestratorDirty = orchestratorDraft !== null && orchestratorBaseline !== null
        && snapshotOrchestrator(orchestratorDraft) !== orchestratorBaseline
      const orchestratorDialogDirty = dialogMode === 'orchestrator' && orchestratorDirty
      const parsedPasteName = pasteResult !== null && pasteResult.fields !== undefined
        && typeof pasteResult.fields.name === 'string'
        ? pasteResult.fields.name.trim()
        : ''
      const orchestratorName = orchestratorDraft !== null
        && typeof orchestratorDraft.fields.name === 'string'
        && orchestratorDraft.fields.name.trim() !== ''
        ? orchestratorDraft.fields.name
        : t('orchestratorHeading')
      const draftName = dialogMode === 'orchestrator'
        ? orchestratorName
        : (draft === null
          ? (dialogMode === 'create'
            ? (newName.trim() === '' ? t('createHeading') : newName.trim())
            : (dialogMode === 'import'
              ? (parsedPasteName === '' ? t('pasteHeading') : parsedPasteName)
              : ''))
          : (draft.fields !== undefined && typeof draft.fields.name === 'string' && draft.fields.name !== ''
            ? draft.fields.name
            : String(draft.label || draft.file || '')))
      const createDirty = dialogMode === 'create'
        && (newName.trim() !== '' || template !== 'blank')
      const importDirty = dialogMode === 'import'
        && (pasteSource.trim() !== '' || pasteResult !== null)
      const dialogDirty = dirty || createDirty || importDirty || orchestratorDialogDirty
      const orchestratorErrorEntries = ORCHESTRATOR_ERROR_KEYS.filter(function (key) {
        return typeof orchestratorFieldErrors[key] === 'string' && orchestratorFieldErrors[key] !== ''
      })
      const busyLocked = busy !== ''
      // Mirror the newest render for the module-level callbacks and background
      // refreshes: they must never act on a stale selection or dirty flag.
      selectedRef.current = selected
      dialogModeRef.current = dialogMode
      dirtyRef.current = dirty
      orchestratorRef.current = orchestrator
      orchestratorDirtyRef.current = orchestratorDirty
      busyRef.current = busy
      const textInput = function (config) {
        return sharedTextInput(Object.assign({}, config, { disabled: busyLocked }))
      }
      const numberInput = function (config) {
        return sharedNumberInput(Object.assign({}, config, { disabled: busyLocked }))
      }
      const textArea = function (config) {
        return sharedTextArea(Object.assign({}, config, { disabled: busyLocked }))
      }
      const selectInput = function (config) {
        return sharedSelectInput(Object.assign({}, config, { disabled: busyLocked }))
      }
      const rootPath = overview !== null && overview.plugin !== null && typeof overview.plugin === 'object'
        && typeof overview.plugin.root === 'string'
        ? overview.plugin.root
        : ''
      const resolvedDirs = Array.isArray(settings.resolvedDirs) ? settings.resolvedDirs : []
      const selectedSummary = selected === null
        ? null
        : (documents.find(function (document) {
          return document !== null && typeof document === 'object' && document.file === selected
        }) || null)
      const fieldErrorEntries = FIELD_ERROR_ORDER.filter(function (key) {
        return typeof fieldErrors[key] === 'string' && fieldErrors[key] !== ''
      })

      const searchNeedle = query.trim().toLowerCase()
      const visibleDocuments = documents.filter(function (document) {
        const haystack = [
          document.name,
          document.description,
          document.sourcePath,
          document.label,
          document.file,
        ].filter(function (part) { return typeof part === 'string' }).join(' ').toLowerCase()
        if (searchNeedle !== '' && haystack.indexOf(searchNeedle) === -1) return false
        if (filter === 'user') return document.userInvocable === true
        if (filter === 'ai') return document.userInvocable !== true
        if (filter === 'invalid') return document.valid === false
        return true
      }).sort(function (left, right) {
        if (sortMode === 'updated') {
          const leftAt = typeof left.modifiedAt === 'number' ? left.modifiedAt : 0
          const rightAt = typeof right.modifiedAt === 'number' ? right.modifiedAt : 0
          if (leftAt !== rightAt) return rightAt - leftAt
        }
        const leftName = String(left.name || left.label || left.file || '').toLowerCase()
        const rightName = String(right.name || right.label || right.file || '').toLowerCase()
        return leftName < rightName ? -1 : leftName > rightName ? 1 : 0
      })

      /** Escape and backdrop clicks close through the same dirty guard. */
      const requestCloseDialog = function () {
        // Writes stay atomic with their locked editor. Read/parse operations may
        // be cancelled by closing because their operation ids invalidate them.
        if (busyLocked && busy !== 'document' && busy !== 'parse') return
        if (dialogDirty) {
          setPendingAction({ type: 'close' })
          return
        }
        closeDialog()
      }

      // Persist a dirty draft (form or raw) while the page stays open; successful
      // mutations clear it. The raw source, the mode, and the base hash travel
      // with the form fields so a refresh can restore either editor.
      React.useEffect(function () {
        if (busyLocked) return undefined
        if (draft === null || baseline === null) return undefined
        const file = draft.file
        if (typeof file !== 'string' || file === '') return undefined
        const formDirty = snapshotDraft(draft) !== baseline
        const rawDirty = mode === 'raw' && rawSource !== baselineSource
        if (!formDirty && !rawDirty) return undefined
        const timer = window.setTimeout(function () {
          writeStoredDraft(file, {
            fields: draft.fields,
            sections: draft.sections,
            mode: mode,
            rawSource: rawDirty ? rawSource : null,
            baseHash: typeof draft.hash === 'string' ? draft.hash : null,
          })
        }, 400)
        return function () { window.clearTimeout(timer) }
      }, [draft, baseline, mode, rawSource, baselineSource, busyLocked])

      // Live, no-write preview: debounce while the draft changes and ignore
      // stale answers. A failure only fills the preview panel; editing and the
      // status line are untouched.
      React.useEffect(function () {
        if (!previewOpen || draft === null) {
          previewSeq.current += 1
          setPreviewLoading(false)
          return undefined
        }
        const seq = previewSeq.current + 1
        previewSeq.current = seq
        const timer = window.setTimeout(function () {
          setPreviewLoading(true)
          void (async function () {
            try {
              const request = mode === 'raw'
                ? { file: draft.file, source: rawSource, root: workspaceRootRef.current }
                : { file: draft.file, fields: draft.fields, sections: draft.sections, root: workspaceRootRef.current }
              const payload = await readJson(await fetch('agent-soul/preview', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(request),
              }))
              if (previewSeq.current !== seq) return
              setPreview(payload)
              setPreviewError(null)
            } catch (error) {
              if (previewSeq.current !== seq) return
              setPreview(null)
              setPreviewError(failureOf(error))
            } finally {
              if (previewSeq.current === seq) setPreviewLoading(false)
            }
          })()
        }, PREVIEW_DEBOUNCE_MS)
        return function () {
          previewSeq.current += 1
          window.clearTimeout(timer)
        }
      }, [previewOpen, draft, mode, rawSource, previewNonce])

      // Warn on a real page unload while the editor holds unsaved edits.
      React.useEffect(function () {
        if (!dialogDirty) return undefined
        const warn = function (event) {
          event.preventDefault()
          event.returnValue = ''
          return ''
        }
        window.addEventListener('beforeunload', warn)
        return function () { window.removeEventListener('beforeunload', warn) }
      }, [dialogDirty])

      // Persist the chosen dialog size once resizing settles: a drag updates the
      // size continuously, and writing localStorage on every pointer event is
      // wasted work that can make the drag feel heavy. The helper catches its
      // own storage failures.
      React.useEffect(function () {
        const timer = window.setTimeout(function () { writeStoredEditorSize(editorSize) }, 200)
        return function () { window.clearTimeout(timer) }
      }, [editorSize])

      // Stop any in-flight pointer drag when the dialog unmounts.
      React.useEffect(function () {
        return function () {
          openSeq.current += 1
          parseSeq.current += 1
          orchestratorSeq.current += 1
          if (resizeStopRef.current !== null) {
            resizeStopRef.current()
            resizeStopRef.current = null
          }
        }
      }, [])

      // Move focus into the dialog when it opens; closeDialog restores it.
      React.useEffect(function () {
        if (dialogMode === null) return undefined
        const timer = window.setTimeout(function () {
          const node = dialogRef.current
          if (node !== null && typeof node.focus === 'function') node.focus()
        }, 0)
        return function () { window.clearTimeout(timer) }
      }, [dialogMode])

      // Capture dialog keys before the outer Settings bubble listener. Nested
      // menus still receive Escape at their target; a dialog-bubble sentinel
      // then prevents that same event from closing the outer Settings page.
      React.useEffect(function () {
        if (dialogMode === null) return undefined
        const stopKey = function (event) {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
        }
        const onKeyDown = function (event) {
          const dialog = dialogRef.current
          if (event.key === 'Tab') {
            if (dialog === null) {
              stopKey(event)
              return
            }
            const focusable = dialogFocusableElements(dialog)
            const active = document.activeElement
            const inside = active !== null && typeof dialog.contains === 'function' && dialog.contains(active)
            let destination = null
            if (focusable.length === 0) {
              destination = dialog
            } else if (event.shiftKey && (active === dialog || !inside || active === focusable[0])) {
              destination = focusable[focusable.length - 1]
            } else if (!event.shiftKey
              && (active === dialog || !inside || active === focusable[focusable.length - 1])) {
              destination = focusable[0]
            }
            if (destination !== null) {
              stopKey(event)
              if (typeof destination.focus === 'function') destination.focus()
            }
            return
          }
          if (event.key !== 'Escape') return
          if (event.repeat || event.isComposing || event.keyCode === 229) {
            stopKey(event)
            return
          }
          if (event.defaultPrevented) {
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
            return
          }
          if (nestedMenuOwnsEscape(event.target, dialog)) return
          stopKey(event)
          requestCloseDialog()
        }
        const dialog = dialogRef.current
        const onDialogKeyDown = function (event) {
          if (event.key === 'Escape' && nestedMenuOwnsEscape(event.target, dialog)
            && typeof event.stopPropagation === 'function') {
            event.stopPropagation()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        if (dialog !== null) dialog.addEventListener('keydown', onDialogKeyDown)
        return function () {
          document.removeEventListener('keydown', onKeyDown, true)
          if (dialog !== null) dialog.removeEventListener('keydown', onDialogKeyDown)
        }
      }, [dialogMode, dialogDirty, busy])

      // Let the "Copied" label fall back to "Copy" after a moment.
      React.useEffect(function () {
        if (copied === '') return undefined
        const timer = window.setTimeout(function () { setCopied('') }, 1600)
        return function () { window.clearTimeout(timer) }
      }, [copied])

      const scanText = (function () {
        if (overview === null) return loading ? t('statusLoading') : ''
        const valid = typeof runtime.validCount === 'number' ? runtime.validCount : 0
        const invalid = typeof runtime.invalidCount === 'number' ? runtime.invalidCount : 0
        const time = formatTimestamp(runtime.scannedAt)
        if (time === null) return t('scanNever', { valid: valid, invalid: invalid })
        return t('scanLine', { time: time, valid: valid, invalid: invalid })
      })()

      const header = h('header', { className: 'agent-soul-header' },
        h('h2', { className: 'agent-soul-title' }, t('title')),
        h('p', { className: 'agent-soul-intro' }, t('intro')))

      const toolbar = h('div', { className: 'agent-soul-toolbar' },
        h('button', {
          id: id('new-button'),
          type: 'button',
          className: 'agent-soul-primary-button',
          onClick: function (event) { requestCreate(event.currentTarget) },
          disabled: busyLocked,
          'aria-label': t('newButton'),
        }, t('newButton')),
        h('button', {
          type: 'button',
          className: 'agent-soul-secondary-button',
          onClick: requestRefresh,
          disabled: busyLocked || loading,
          'aria-label': t('refreshButton'),
        }, loading ? t('refreshBusy') : t('refreshButton')),
        h('button', {
          type: 'button',
          className: 'agent-soul-secondary-button',
          onClick: function (event) { requestPaste(event.currentTarget) },
          disabled: busyLocked,
          'aria-haspopup': 'dialog',
          'aria-expanded': dialogMode === 'import',
          'aria-label': t('pasteButton'),
        }, t('pasteButton')),
        h('span', { className: 'agent-soul-toolbar-spacer' }),
        h('p', { className: 'agent-soul-scan' }, scanText))

      const statusLine = h('p', {
        className: status === null
          ? 'agent-soul-status'
          : 'agent-soul-status agent-soul-status-' + status.kind,
        role: 'status',
      }, status === null ? '' : status.text)

      const guardBanner = pendingAction === null ? null : h('section', {
        className: 'agent-soul-banner agent-soul-banner-warn',
        role: 'alert',
        'aria-label': t('unsavedGuardTitle'),
      },
        h('div', { className: 'agent-soul-banner-copy' },
          h('p', { className: 'agent-soul-banner-title' }, t('unsavedGuardTitle')),
          h('p', { className: 'agent-soul-banner-text' },
            t('unsavedGuardText', { name: draftName }))),
        h('div', { className: 'agent-soul-banner-actions' },
          h('button', {
            type: 'button',
            className: 'agent-soul-secondary-button',
            onClick: function () { setPendingAction(null) },
            disabled: busyLocked,
          }, t('keepEditingButton')),
          h('button', {
            type: 'button',
            className: 'agent-soul-danger-button',
            onClick: continuePendingAction,
            disabled: busyLocked,
          }, t('discardChangesButton'))))

      const undoBanner = undo === null ? null : h('section', {
        className: 'agent-soul-banner',
        role: 'status',
        'aria-label': t('undoTitle'),
      },
        h('div', { className: 'agent-soul-banner-copy' },
          h('p', { className: 'agent-soul-banner-title' }, t('undoTitle')),
          h('p', { className: 'agent-soul-banner-text' },
            t('undoText', { name: String(undo.name) }))),
        h('div', { className: 'agent-soul-banner-actions' },
          h('button', {
            type: 'button',
            className: 'agent-soul-primary-button',
            onClick: requestUndo,
            disabled: busyLocked,
          }, busy === 'restore' ? t('undoingButton') : t('undoButton')),
          h('button', {
            type: 'button',
            className: 'agent-soul-secondary-button',
            onClick: function () { setUndo(null) },
            disabled: busyLocked,
          }, t('undoDismiss'))))

      const templateOptions = [
        { id: 'blank', label: t('templateBlank') },
        { id: 'researcher', label: t('templateResearcher') },
        { id: 'code-reviewer', label: t('templateCodeReviewer') },
        { id: 'docs-writer', label: t('templateDocsWriter') },
      ]

      /** Create mode body: the New-soul form opens in the shared dialog. */
      const createPanel = h('div', {
        className: 'agent-soul-group',
        role: 'group',
        'aria-label': t('createHeading'),
      },
        h('p', { className: 'agent-soul-field-hint' }, t('createHint')),
        h('div', {
          className: 'agent-soul-template-row',
          role: 'group',
          'aria-label': t('templatesLabel'),
        },
          h('span', { className: 'agent-soul-sort-label' }, t('templatesLabel')),
          templateOptions.map(function (option) {
            return h('button', {
              key: option.id,
              type: 'button',
              className: 'agent-soul-chip',
              'aria-pressed': template === option.id,
              onClick: function () { setTemplate(option.id) },
              disabled: busyLocked,
            }, option.label)
          })),
        h('p', { className: 'agent-soul-field-hint' }, t('templateHint')),
        textInput({
          id: id('new-name'),
          label: t('createName'),
          value: newName,
          placeholder: t('createNamePlaceholder'),
          onChange: setNewName,
        }))

      const overviewErrorCard = overviewError === null ? null : h('div', {
        className: 'agent-soul-error-card',
        role: 'alert',
      },
        h('h3', { className: 'agent-soul-error-title' }, t('errorTitle')),
        h('p', { className: 'agent-soul-error-body' }, failureText(t, overviewError)),
        h('p', { className: 'agent-soul-muted' }, t('errorBody')),
        h('div', { className: 'agent-soul-actions' },
          h('button', {
            type: 'button',
            className: 'agent-soul-secondary-button',
            onClick: function () { void loadOverview() },
            disabled: loading,
          }, t('retryButton'))))

      const pasteDiagnostics = pasteResult !== null && Array.isArray(pasteResult.diagnostics)
        && pasteResult.diagnostics.length > 0
        ? h('ul', { className: 'agent-soul-diagnostics' }, pasteResult.diagnostics.map(function (item, index) {
          return h('li', { key: index, className: 'agent-soul-diagnostic' }, diagnosticText(item))
        }))
        : null
      /** Import mode body: paste/parse Markdown inside the shared dialog. */
      const pastePanel = h('div', {
        className: 'agent-soul-group',
        role: 'group',
        'aria-label': t('pasteHeading'),
      },
        h('p', { className: 'agent-soul-field-hint' }, t('pasteHint')),
        h('p', { className: 'agent-soul-field-hint' },
          selected !== null && draft !== null ? t('pasteIntoDraftHint') : t('pasteCreateHint')),
        h('div', { className: 'agent-soul-field' },
          h('label', {
            className: 'agent-soul-field-label',
            htmlFor: id('paste-source'),
          }, t('pasteSourceLabel')),
          h('textarea', {
            id: id('paste-source'),
            className: 'agent-soul-textarea agent-soul-textarea-mono agent-soul-panel-textarea',
            rows: 10,
            value: pasteSource,
            placeholder: t('pastePlaceholder'),
            disabled: busyLocked,
            onChange: function (event) {
              if (busyLocked) return
              parseSeq.current += 1
              setPasteSource(event.target.value)
              setPasteResult(null)
            },
          })),
        pasteResult === null ? null : h('div', { className: 'agent-soul-panel' },
          h('div', { className: 'agent-soul-panel-head' },
            h('h4', { className: 'agent-soul-panel-title' }, t('parseHeading')),
            badge(pasteResult.valid === false ? t('parseInvalid') : t('parseValid'),
              pasteResult.valid === false ? 'agent-soul-badge-error' : 'agent-soul-badge-ok')),
          h('p', { className: 'agent-soul-field-hint' },
            parsedPasteName === '' ? t('pasteMissingName') : codeValue(parsedPasteName)),
          pasteDiagnostics))

      const listBody = (function () {
        // A failed overview is never an empty catalog: the error card above owns
        // the message, and a skeleton would imply a load that already failed.
        if (overview === null && overviewError !== null) return null
        if (loading && overview === null) {
          return h('div', { className: 'agent-soul-skeleton-list', 'aria-hidden': 'true' },
            [0, 1, 2, 3].map(function (index) {
              return h('div', { key: index, className: 'agent-soul-skeleton-card' },
                h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-title' }),
                h('span', { className: 'agent-soul-skeleton-line' }),
                h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-short' }))
            }))
        }
        if (documents.length === 0) {
          const copyRow = function (label, value, rowKey) {
            const copiedNow = copied === String(value)
            return h('div', { key: rowKey, className: 'agent-soul-copy-row' },
              h('span', { className: 'agent-soul-copy-label' }, label),
              h('code', { className: 'agent-soul-copy-value' }, String(value)),
              h('button', {
                type: 'button',
                className: 'agent-soul-copy-button',
                onClick: function () { void copyText(value) },
                'aria-label': label + ': ' + (copiedNow ? t('copiedButton') : t('copyButton')),
              }, copiedNow ? t('copiedButton') : t('copyButton')))
          }
          const rows = []
          if (rootPath !== '') rows.push(copyRow(t('infoRoot'), rootPath, 'root'))
          resolvedDirs.forEach(function (dir, index) {
            if (typeof dir !== 'string' || dir === '') return
            rows.push(copyRow(t('infoDirs'), dir, 'dir-' + index))
          })
          return h('div', { className: 'agent-soul-empty' },
            h('p', { className: 'agent-soul-empty-title' }, t('listEmptyTitle')),
            h('p', { className: 'agent-soul-empty-body' }, t('listEmptyBody')),
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: function (event) { requestCreate(event.currentTarget) },
              disabled: busyLocked,
            }, t('newButton')),
            h('div', { className: 'agent-soul-code-list' }, rows),
            resolvedDirs.length === 0 ? h('p', { className: 'agent-soul-muted' }, t('infoDirsEmpty')) : null,
            h('p', { className: 'agent-soul-field-hint' }, t('emptyDirsHint')))
        }
        if (visibleDocuments.length === 0) {
          return h('div', { className: 'agent-soul-empty' },
            h('p', { className: 'agent-soul-empty-title' }, t('noMatchesTitle')),
            h('p', { className: 'agent-soul-empty-body' }, t('noMatchesBody')),
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: function () {
                setQuery('')
                setFilter('all')
              },
            }, t('clearFiltersButton')))
        }
        return h('ul', { className: 'agent-soul-list' }, visibleDocuments.map(function (document, index) {
          const name = typeof document.name === 'string' && document.name !== ''
            ? document.name
            : String(document.label || document.file || '')
          const isSelected = document.file === selected
          const usage = document.usage !== null && typeof document.usage === 'object'
            ? document.usage
            : null
          const usageParts = []
          if (usage !== null) {
            if (typeof usage.storedCount === 'number' && isFinite(usage.storedCount)) {
              usageParts.push(t('usageSaved', { count: usage.storedCount }))
            }
            const lastUsedAt = typeof usage.lastUsedAt === 'number'
              ? formatUsageTime(usage.lastUsedAt)
              : null
            usageParts.push(lastUsedAt === null
              ? t('usageNeverUsed')
              : t('usageLastUsed', { time: lastUsedAt }))
          }
          const activeMembers = usage !== null && Array.isArray(usage.activeMembers)
            ? usage.activeMembers.filter(function (member) {
              return typeof member === 'string' && member !== ''
            })
            : []
          const commandStatus = commandStatusOf(document.commandStatus)
          const badges = [
            h('span', {
              key: 'valid',
              className: document.valid === false
                ? 'agent-soul-badge agent-soul-badge-error'
                : 'agent-soul-badge agent-soul-badge-ok',
            }, document.valid === false ? t('badgeInvalid') : t('badgeValid')),
          ]
          if (document.bundled === true) {
            badges.push(badge(t('badgeBundled'), 'agent-soul-badge-active', 'bundled'))
          }
          if (Array.isArray(document.tools)) {
            badges.push(badge(document.tools.length === 0
              ? t('badgeNoTools')
              : t('badgeTools', { count: document.tools.length }), undefined, 'tools'))
          } else {
            badges.push(badge(t('badgeAllTools'), undefined, 'tools'))
          }
          const model = document.modelResolved || document.model
          if (typeof model === 'string' && model !== '') {
            badges.push(badge(t('badgeModel', { model: model }), undefined, 'model'))
          }
          if (typeof document.context === 'string' && document.context !== '') {
            badges.push(badge(t('badgeContext', { context: document.context }), undefined, 'context'))
          }
          if (typeof document.command === 'string' && document.command !== '') {
            badges.push(badge(document.command, undefined, 'command'))
          }
          if (preferenceEffective !== null && name === preferenceEffective) {
            badges.unshift(badge(t('badgeDefault'), 'agent-soul-badge-active', 'default'))
          }
          if (activeMembers.length > 0) {
            badges.push(badge(t('usageActive', { names: activeMembers.join(', ') }),
              'agent-soul-badge-active', 'usage-active'))
          }
          if (commandStatus !== null) {
            const commandLabel = commandStatusLabel(t, commandStatus.status)
            badges.push(badge(commandLabel, commandStatusModifier(commandStatus.status),
              'command-status', commandStatus.message === ''
                ? t('commandStatusAria', { status: commandLabel })
                : commandStatus.message))
          }
          return h('li', { key: document.file === undefined ? index : document.file },
            h('button', {
              type: 'button',
              className: 'agent-soul-list-card',
              'aria-pressed': isSelected,
              'aria-label': t('listOpen', { name: name }),
              onClick: function (event) { requestOpen(document.file, event.currentTarget) },
            },
              h('span', { className: 'agent-soul-list-name' }, name),
              h('span', {
                className: typeof document.description === 'string' && document.description !== ''
                  ? 'agent-soul-list-desc'
                  : 'agent-soul-list-desc agent-soul-list-desc-empty',
              }, typeof document.description === 'string' && document.description !== ''
                ? document.description
                : t('listNoDescription')),
              usageParts.length === 0
                ? null
                : h('span', { className: 'agent-soul-list-usage' }, usageParts.join(' · ')),
              h('span', { className: 'agent-soul-badges' }, badges)))
        }))
      })()

      const listFilters = [
        { value: 'all', label: t('filterAll') },
        { value: 'user', label: t('filterUser') },
        { value: 'ai', label: t('filterAi') },
        { value: 'invalid', label: t('filterInvalid') },
      ]
      const listSorts = [
        { value: 'name', label: t('sortName') },
        { value: 'updated', label: t('sortUpdated') },
      ]
      const defaultControls = preferences === null ? null : h('div', {
        className: 'agent-soul-default-row',
      },
        h('label', {
          className: 'agent-soul-sort-label',
          htmlFor: id('default-soul'),
        }, t('defaultSoulLabel')),
        h('select', {
          id: id('default-soul'),
          className: 'agent-soul-select agent-soul-default-select',
          value: preferenceSelected === null ? '' : preferenceSelected,
          disabled: busyLocked || loading,
          'aria-describedby': id('default-soul-hint'),
          onChange: function (event) {
            const next = event.target.value === '' ? null : event.target.value
            void requestSetDefault(next)
          },
        }, preferenceOptions.map(function (option) {
          return h('option', { key: option.value, value: option.value }, option.label)
        })),
        h('p', {
          id: id('default-soul-hint'),
          className: 'agent-soul-field-hint',
        }, t('defaultSoulHint')))

      const defaultWarning = preferences === null || preferenceWarning === null ? null : h('section', {
        className: 'agent-soul-banner agent-soul-banner-warn',
        role: 'alert',
        'aria-label': t('defaultWarningTitle'),
      },
        h('div', { className: 'agent-soul-banner-copy' },
          h('p', { className: 'agent-soul-banner-title' }, t('defaultWarningTitle')),
          h('p', { className: 'agent-soul-banner-text' },
            t('defaultWarningBody', { message: preferenceWarning }))))

      const listTools = h('div', { className: 'agent-soul-list-tools' },
        h('input', {
          type: 'search',
          className: 'agent-soul-input',
          value: query,
          placeholder: t('searchPlaceholder'),
          'aria-label': t('searchLabel'),
          onChange: function (event) { setQuery(event.target.value) },
        }),
        h('div', {
          className: 'agent-soul-filter-row',
          role: 'group',
          'aria-label': t('filterLabel'),
        }, listFilters.map(function (chip) {
          return h('button', {
            key: chip.value,
            type: 'button',
            className: 'agent-soul-chip',
            'aria-pressed': filter === chip.value,
            onClick: function () { setFilter(chip.value) },
          }, chip.label)
        })),
        h('div', {
          className: 'agent-soul-sort-row',
          role: 'group',
          'aria-label': t('sortLabel'),
        },
          h('span', { className: 'agent-soul-sort-label' }, t('sortLabel')),
          listSorts.map(function (option) {
            return h('button', {
              key: option.value,
              type: 'button',
              className: 'agent-soul-chip',
              'aria-pressed': sortMode === option.value,
              onClick: function () { setSortMode(option.value) },
            }, option.label)
          })))

      const listCard = h('section', {
        className: 'agent-soul-card',
        'aria-label': t('listHeading'),
      },
        h('div', { className: 'agent-soul-card-head' },
          h('h3', { className: 'agent-soul-card-title' }, t('listHeading')),
          h('span', { className: 'agent-soul-count' }, documents.length === 0
            ? ''
            : t('listCount', { count: visibleDocuments.length }))),
        defaultControls,
        defaultWarning,
        overview === null || documents.length === 0 ? null : listTools,
        overview === null || documents.length === 0 || selected !== null ? null
          : h('div', { className: 'agent-soul-empty agent-soul-list-hint' },
            h('p', { className: 'agent-soul-empty-title' }, t('emptyTitle')),
            h('p', { className: 'agent-soul-empty-body' }, t('emptyBody'))),
        listBody)

      const buildEditorForm = function () {
        const fields = draft.fields !== null && typeof draft.fields === 'object' ? draft.fields : {}
        const sections = draft.sections !== null && typeof draft.sections === 'object' ? draft.sections : {}
        const bundledDocument = draft.bundled === true
        const currentProvider = typeof fields.provider === 'string' ? fields.provider : ''
        const currentModel = typeof fields.model === 'string' ? fields.model : ''
        const currentTools = typeof fields.tools === 'string' ? fields.tools : ''
        const selectedToolNames = parseToolNames(currentTools)
        const toolsMode = toolModeOf(currentTools)
        const catalogToolNames = catalogTools.map(function (tool) {
          return tool !== null && typeof tool === 'object' && typeof tool.name === 'string' ? tool.name : ''
        }).filter(function (name) { return name !== '' })
        const unknownTools = catalogToolNames.length === 0 ? [] : selectedToolNames.filter(function (name) {
          return catalogToolNames.indexOf(name) === -1
        })
        const providerOptions = [{ value: '', label: t('modelInheritOption') }]
        const providerIds = []
        catalogModels.forEach(function (entry) {
          if (entry === null || typeof entry !== 'object') return
          const provider = typeof entry.provider === 'string' ? entry.provider : ''
          if (provider === '' || providerIds.indexOf(provider) !== -1) return
          providerIds.push(provider)
          providerOptions.push({ value: provider, label: provider })
        })
        if (currentProvider !== '' && providerIds.indexOf(currentProvider) === -1) {
          providerOptions.push({ value: currentProvider, label: currentProvider })
        }
        const modelOptions = [{ value: '', label: t('modelInheritOption') }]
        const modelValues = []
        catalogModels.forEach(function (entry) {
          if (entry === null || typeof entry !== 'object') return
          const provider = typeof entry.provider === 'string' ? entry.provider : ''
          const model = typeof entry.model === 'string' ? entry.model : ''
          if (model === '') return
          if (currentProvider !== '' && provider !== currentProvider) return
          if (modelValues.indexOf(model) !== -1) return
          modelValues.push(model)
          const name = typeof entry.name === 'string' && entry.name !== '' ? entry.name : model
          modelOptions.push({
            value: model,
            label: currentProvider === '' && provider !== '' ? name + ' · ' + provider : name,
          })
        })
        if (currentModel !== '' && modelValues.indexOf(currentModel) === -1) {
          modelOptions.push({
            value: currentModel,
            label: t('modelNotInCatalog', { model: currentModel }),
          })
        }
        const contextOptions = [
          { value: '', label: t('fieldContextAbsent') },
          { value: 'fresh', label: t('fieldContextFresh') },
          { value: 'fork', label: t('fieldContextFork') },
        ]
        const currentContext = typeof fields.context === 'string' ? fields.context : ''
        if (currentContext !== '' && !contextOptions.some(function (option) {
          return option.value === currentContext
        })) {
          contextOptions.push({ value: currentContext, label: currentContext })
        }
        const identity = h('div', { className: 'agent-soul-group' },
          h('h4', { className: 'agent-soul-group-head' }, t('groupIdentity')),
          h('div', { className: 'agent-soul-fields' },
            textInput({
              id: id('name'),
              label: t('fieldName'),
              value: typeof fields.name === 'string' ? fields.name : '',
              error: fieldErrors.name,
              onChange: function (value) { updateField('name', value) },
            }),
            textArea({
              id: id('description'),
              label: t('fieldDescription'),
              value: typeof fields.description === 'string' ? fields.description : '',
              rows: 3,
              error: fieldErrors.description,
              onChange: function (value) { updateField('description', value) },
            })))
        const toolPicker = h('div', {
          className: 'agent-soul-field agent-soul-field-wide',
        },
          h('span', { className: 'agent-soul-field-label' }, t('fieldTools')),
          h('p', { className: 'agent-soul-field-hint' }, t('toolsCustomHint')),
          h('div', {
            className: 'agent-soul-chip-row',
            role: 'group',
            'aria-label': t('fieldTools'),
            'data-catalog-source': catalogSource,
          },
            h('button', {
              type: 'button',
              className: 'agent-soul-chip',
              'aria-pressed': toolsMode === 'all',
              onClick: function () { updateField('tools', toolsMode === 'all' ? '' : '*') },
              disabled: busyLocked,
            }, t('toolsInheritAll')),
            catalogToolNames.map(function (name) {
              const tool = catalogTools.find(function (entry) {
                return entry !== null && typeof entry === 'object' && entry.name === name
              })
              const description = tool !== undefined && typeof tool.description === 'string'
                ? tool.description
                : ''
              return h('button', {
                key: 'catalog-tool-' + name,
                type: 'button',
                className: 'agent-soul-chip',
                'aria-pressed': selectedToolNames.indexOf(name) !== -1,
                'aria-label': t('toolsToggle', { name: name }),
                title: description === '' ? undefined : description,
                onClick: function () { updateField('tools', toggleToolName(currentTools, name)) },
                disabled: busyLocked,
              }, name)
            })),
          catalogToolNames.length === 0
            ? h('p', { className: 'agent-soul-field-hint' }, t('toolsCatalogEmpty'))
            : null,
          toolsMode === 'all'
            ? h('p', { className: 'agent-soul-field-hint' }, t('toolsInheritHint'))
            : toolsMode === 'none'
              ? h('p', { className: 'agent-soul-field-hint' }, t('toolsNoneHint'))
              : h('p', { className: 'agent-soul-field-hint' },
                t('toolsCount', { count: selectedToolNames.length })),
          unknownTools.length === 0 ? null : h('div', { className: 'agent-soul-picker' },
            h('span', {
              className: 'agent-soul-field-label agent-soul-warning-note',
            }, t('toolsUnknownHeading')),
            h('div', { className: 'agent-soul-chip-row' }, unknownTools.map(function (name) {
              return h('button', {
                key: 'unknown-tool-' + name,
                type: 'button',
                className: 'agent-soul-chip agent-soul-chip-warning',
                'aria-label': t('toolsRemove', { name: name }),
                onClick: function () {
                  updateField('tools', formatToolNames(selectedToolNames.filter(function (toolName) {
                    return toolName !== name
                  })))
                },
                disabled: busyLocked,
              }, name + ' ×')
            })),
            h('p', { className: 'agent-soul-field-hint' }, t('toolsUnknownHint'))))
        const modelPicker = h('div', {
          className: 'agent-soul-field agent-soul-field-wide agent-soul-picker',
        },
          h('p', { className: 'agent-soul-field-hint' }, t('modelPickerHint')),
          h('div', { className: 'agent-soul-field-grid' },
            selectInput({
              id: id('model-provider'),
              label: t('fieldProvider'),
              value: currentProvider,
              options: providerOptions,
              onChange: function (value) { updateField('provider', value) },
            }),
            selectInput({
              id: id('model-model'),
              label: t('fieldModel'),
              value: currentModel,
              options: modelOptions,
              onChange: function (value) {
                updateField('model', value)
                if (value === '' || currentProvider !== '') return
                const entry = catalogModels.find(function (candidate) {
                  return candidate !== null && typeof candidate === 'object'
                    && candidate.model === value
                })
                if (entry !== undefined && typeof entry.provider === 'string' && entry.provider !== '') {
                  updateField('provider', entry.provider)
                }
              },
            })),
          catalogModels.length === 0
            ? h('p', { className: 'agent-soul-field-hint' }, t('modelCatalogEmpty'))
            : null,
          preview !== null
            ? h('p', { className: 'agent-soul-field-hint' },
              t('modelResolvedLabel') + ': ',
              preview.resolvedModel !== null && typeof preview.resolvedModel === 'object'
                ? codeValue(String(preview.resolvedModel.provider || '?')
                  + '/' + String(preview.resolvedModel.model || '?'))
                : t('modelResolvedInherited'))
            : null)
        const routing = h('div', { className: 'agent-soul-group' },
          h('h4', { className: 'agent-soul-group-head' }, t('groupRouting')),
          h('div', { className: 'agent-soul-fields' },
            toolPicker,
            modelPicker,
            h('div', { className: 'agent-soul-field-grid' },
              textInput({
                id: id('reasoning'),
                label: t('fieldReasoning'),
                value: typeof fields.reasoningEffort === 'string' ? fields.reasoningEffort : '',
                placeholder: t('fieldReasoningPlaceholder'),
                error: fieldErrors.reasoningEffort,
                onChange: function (value) { updateField('reasoningEffort', value) },
              }),
              selectInput({
                id: id('context'),
                label: t('fieldContext'),
                value: currentContext,
                options: contextOptions,
                error: fieldErrors.context,
                onChange: function (value) { updateField('context', value) },
              }),
              h('div', { className: 'agent-soul-field-wide' },
                h('div', { className: 'agent-soul-checkbox-row' },
                  h('input', {
                    id: id('user-invocable'),
                    className: 'agent-soul-checkbox',
                    type: 'checkbox',
                    checked: fields.userInvocable === true,
                    disabled: busyLocked,
                    onChange: function (event) {
                      if (busyLocked) return
                      updateField('userInvocable', event.target.checked)
                    },
                  }),
                  h('label', { className: 'agent-soul-checkbox-text', htmlFor: id('user-invocable') },
                    h('span', { className: 'agent-soul-checkbox-label' }, t('fieldUserInvocable')),
                    h('span', { className: 'agent-soul-field-hint' }, t('fieldUserInvocableHint'))))))))
        const markdown = h('div', { className: 'agent-soul-group' },
          h('h4', { className: 'agent-soul-group-head' }, t('groupMarkdown')),
          h('p', { className: 'agent-soul-field-hint' }, t('sectionsHint')),
          typeof fieldErrors.body === 'string' && fieldErrors.body !== ''
            ? h('p', { className: 'agent-soul-field-error', id: id('body-error'), role: 'alert' },
              fieldErrors.body)
            : null,
          h('div', { className: 'agent-soul-fields' },
            textArea({
              id: id('section-role'),
              label: t('sectionRole'),
              value: typeof sections.role === 'string' ? sections.role : '',
              rows: 6,
              invalid: typeof fieldErrors.body === 'string' && fieldErrors.body !== '',
              describedBy: typeof fieldErrors.body === 'string' && fieldErrors.body !== ''
                ? id('body-error')
                : undefined,
              onChange: function (value) { updateSection('role', value) },
            }),
            textArea({
              id: id('section-inputs'),
              label: t('sectionInputs'),
              value: typeof sections.inputs === 'string' ? sections.inputs : '',
              rows: 5,
              onChange: function (value) { updateSection('inputs', value) },
            }),
            textArea({
              id: id('section-rules'),
              label: t('sectionRules'),
              value: typeof sections.rules === 'string' ? sections.rules : '',
              rows: 5,
              onChange: function (value) { updateSection('rules', value) },
            }),
            textArea({
              id: id('section-output'),
              label: t('sectionOutput'),
              value: typeof sections.output === 'string' ? sections.output : '',
              rows: 5,
              onChange: function (value) { updateSection('output', value) },
            }),
            textArea({
              id: id('section-extra-markdown'),
              label: t('fieldExtraMarkdown'),
              hint: t('fieldExtraMarkdownHint'),
              value: typeof sections.extraMarkdown === 'string' ? sections.extraMarkdown : '',
              rows: 4,
              onChange: function (value) { updateSection('extraMarkdown', value) },
            })))
        const advanced = h('div', { className: 'agent-soul-group' },
          h('h4', { className: 'agent-soul-group-head' }, t('groupAdvanced')),
          h('p', { className: 'agent-soul-field-hint' }, t('advancedHint')),
          h('div', { className: 'agent-soul-fields' },
            textInput({
              id: id('tools'),
              label: t('fieldToolsAdvanced'),
              hint: t('fieldToolsAdvancedHint'),
              value: currentTools,
              placeholder: t('fieldToolsPlaceholder'),
              error: fieldErrors.tools,
              onChange: function (value) { updateField('tools', value) },
            }),
            h('div', { className: 'agent-soul-field-grid' },
              textInput({
                id: id('model'),
                label: t('advancedModel'),
                value: currentModel,
                placeholder: t('fieldModelPlaceholder'),
                error: fieldErrors.model,
                onChange: function (value) { updateField('model', value) },
              }),
              textInput({
                id: id('provider'),
                label: t('advancedProvider'),
                value: currentProvider,
                placeholder: t('fieldProviderInherit'),
                error: fieldErrors.provider,
                onChange: function (value) { updateField('provider', value) },
              })),
            textArea({
              id: id('extra-frontmatter'),
              label: t('fieldExtraFrontmatter'),
              hint: t('fieldExtraFrontmatterHint'),
              value: typeof fields.extraFrontmatter === 'string' ? fields.extraFrontmatter : '',
              rows: 4,
              mono: true,
              onChange: function (value) { updateField('extraFrontmatter', value) },
            })))
        const documentDiagnostics = Array.isArray(draft.diagnostics) && draft.diagnostics.length > 0
          ? diagnosticsList(t('diagnosticsHeading'), draft.diagnostics)
          : null
        const fieldErrorSummary = mode === 'raw' || fieldErrorEntries.length === 0 ? null : h('div', {
          className: 'agent-soul-error-summary',
          role: 'alert',
        },
          h('p', { className: 'agent-soul-error-summary-title' }, t('fieldErrorSummary')),
          h('ul', { className: 'agent-soul-error-list' }, fieldErrorEntries.map(function (key) {
            return h('li', { key: key },
              h('button', {
                type: 'button',
                className: 'agent-soul-error-link',
                onClick: function () { focusField(key) },
              }, fieldErrorLabel(t, key) + ': ' + fieldErrors[key]))
          })))

        const copyControl = function (label, value, marker) {
          const copiedNow = copied === marker
          const text = value === null || value === undefined ? '' : String(value)
          return h('button', {
            type: 'button',
            className: 'agent-soul-copy-button',
            onClick: function () { void copyText(text, marker) },
            disabled: text === '',
            'aria-label': label + ': ' + (copiedNow ? t('copiedButton') : t('copyButton')),
          }, copiedNow ? t('copiedButton') : label)
        }
        const previewLine = function (label, value) {
          return h('div', { className: 'agent-soul-preview-line' },
            h('span', { className: 'agent-soul-preview-label' }, label),
            h('span', { className: 'agent-soul-preview-value' }, value))
        }
        const previewCommand = preview !== null && preview.command !== null
          && typeof preview.command === 'object'
          ? preview.command
          : null
        const commandStatus = previewCommand !== null && typeof previewCommand.status === 'string'
          ? previewCommand.status
          : ''
        const commandModifier = commandStatus === 'registered'
          ? 'agent-soul-badge-ok'
          : (commandStatus === 'collision' || commandStatus === 'invalid-name'
            ? 'agent-soul-badge-error'
            : undefined)
        const commandValue = previewCommand === null
          ? muted(t('commandStatusNoLiveLead'))
          : h(React.Fragment, null,
            typeof previewCommand.name === 'string' && previewCommand.name !== ''
              ? codeValue('/' + previewCommand.name)
              : null,
            badge(commandStatusLabel(t, commandStatus), commandModifier))
        const hasEffectiveTools = preview !== null
          && (preview.effectiveTools === null || Array.isArray(preview.effectiveTools))
        const previewToolNames = hasEffectiveTools && Array.isArray(preview.effectiveTools)
          ? preview.effectiveTools.filter(function (name) { return typeof name === 'string' && name !== '' })
          : selectedToolNames
        const previewToolsMode = hasEffectiveTools
          ? (preview.effectiveTools === null ? 'all' : (previewToolNames.length === 0 ? 'none' : 'custom'))
          : toolsMode
        const previewTools = previewToolsMode === 'all'
          ? muted(t('previewToolsInheritAll'))
          : previewToolsMode === 'none'
            ? muted(t('previewToolsDenyAll'))
            : h(React.Fragment, null, previewToolNames.map(function (name) {
              const known = catalogToolNames.indexOf(name) !== -1
              return h('span', {
                key: 'preview-tool-' + name,
                className: known
                  ? 'agent-soul-badge'
                  : 'agent-soul-badge agent-soul-badge-error',
                title: known ? undefined : t('previewToolUnknown'),
              }, name)
            }))
        const previewPanel = h('div', { className: 'agent-soul-panel' },
          h('div', { className: 'agent-soul-panel-head' },
            h('h4', { className: 'agent-soul-panel-title' }, t('previewHeading')),
            h('span', { className: 'agent-soul-actions-spacer' }),
            h('button', {
              type: 'button',
              className: 'agent-soul-copy-button',
              'aria-expanded': previewOpen,
              onClick: function () { setPreviewOpen(!previewOpen) },
            }, previewOpen ? t('previewHide') : t('previewShow'))),
          h('p', { className: 'agent-soul-field-hint' }, t('previewHint')),
          previewOpen ? h(React.Fragment, null,
            previewLoading ? h('p', { className: 'agent-soul-muted' }, t('previewLoading')) : null,
            previewError === null ? null : h('div', { className: 'agent-soul-panel' },
              h('p', { className: 'agent-soul-field-error', role: 'alert' }, t('previewError')),
              h('div', { className: 'agent-soul-panel-actions' },
                h('button', {
                  type: 'button',
                  className: 'agent-soul-secondary-button',
                  onClick: function () { setPreviewNonce(previewNonce + 1) },
                  disabled: busyLocked,
                }, t('previewRetry')))),
            preview === null ? null : h(React.Fragment, null,
              h('div', { className: 'agent-soul-badges' },
                badge(preview.valid === false ? t('previewInvalid') : t('previewValid'),
                  preview.valid === false ? 'agent-soul-badge-error' : 'agent-soul-badge-ok')),
              h('div', { className: 'agent-soul-preview-lines' },
                previewLine(t('previewResolvedModel'),
                  preview.resolvedModel !== null && typeof preview.resolvedModel === 'object'
                    ? codeValue(String(preview.resolvedModel.provider || '?')
                      + '/' + String(preview.resolvedModel.model || '?'))
                    : muted(t('modelResolvedInherited'))),
                previewLine(t('previewCommand'), commandValue),
                previewLine(t('previewTools'), previewTools)),
              h('div', { className: 'agent-soul-group' },
                h('div', { className: 'agent-soul-panel-head' },
                  h('h5', { className: 'agent-soul-panel-title' }, t('previewPersona')),
                  copyControl(t('copyPersona'), preview.persona, 'preview-persona')),
                h('p', { className: 'agent-soul-field-hint' }, t('previewPersonaHint')),
                h('pre', {
                  className: 'agent-soul-pre',
                }, typeof preview.persona === 'string' && preview.persona !== ''
                  ? preview.persona
                  : '—')),
              h('div', { className: 'agent-soul-group' },
                h('div', { className: 'agent-soul-panel-head' },
                  h('h5', { className: 'agent-soul-panel-title' }, t('previewCatalogLine')),
                  copyControl(t('copyCatalogLine'), preview.catalogLine, 'preview-catalog')),
                h('pre', {
                  className: 'agent-soul-pre agent-soul-pre-mono',
                }, typeof preview.catalogLine === 'string' && preview.catalogLine !== ''
                  ? preview.catalogLine
                  : t('previewCatalogEmpty'))),
              Array.isArray(preview.diagnostics) && preview.diagnostics.length > 0
                ? diagnosticsList(t('previewDiagnostics'), preview.diagnostics)
                : null,
              h('div', { className: 'agent-soul-group' },
                h('h5', { className: 'agent-soul-panel-title' }, t('previewComposed')),
                h('button', {
                  type: 'button',
                  className: 'agent-soul-copy-button',
                  'aria-expanded': composedOpen,
                  onClick: function () { setComposedOpen(!composedOpen) },
                }, composedOpen ? t('previewComposedHide') : t('previewComposedShow')),
                composedOpen ? h('pre', {
                  className: 'agent-soul-pre agent-soul-pre-mono',
                }, typeof preview.composedSource === 'string' ? preview.composedSource : '') : null)))
            : null)

        // List/document-level runtime values are authoritative here and are
        // available before the debounced preview answers; the preview is the
        // fallback while a newly created file is absent from the overview.
        // The catalog line is the same bullet the preview copies.
        const summaryStatus = selectedSummary === null
          ? null
          : commandStatusOf(selectedSummary.commandStatus)
        const detailStatus = summaryStatus !== null ? summaryStatus : commandStatusOf(previewCommand)
        const summaryCatalog = selectedSummary !== null && typeof selectedSummary.catalogLine === 'string'
          ? selectedSummary.catalogLine
          : null
        const previewCatalog = preview !== null && typeof preview.catalogLine === 'string'
          ? preview.catalogLine
          : null
        const detailCatalog = summaryCatalog !== null ? summaryCatalog : previewCatalog
        const detailStatusLabel = detailStatus === null
          ? ''
          : commandStatusLabel(t, detailStatus.status)
        const editorMeta = h('div', { className: 'agent-soul-editor-meta' },
          h('div', { className: 'agent-soul-meta-row' },
            h('span', { className: 'agent-soul-meta-label' }, t('commandStatusHeading')),
            h('span', { className: 'agent-soul-meta-value' },
              detailStatus === null
                ? muted(t('commandStatusUnavailable'))
                : h(React.Fragment, null,
                  commandInvocation(detailStatus.name) === ''
                    ? null
                    : codeValue(commandInvocation(detailStatus.name)),
                  badge(detailStatusLabel, commandStatusModifier(detailStatus.status),
                    'editor-command', detailStatus.message === ''
                      ? t('commandStatusAria', { status: detailStatusLabel })
                      : detailStatus.message),
                  detailStatus.message === '' ? null : muted(detailStatus.message)))),
          h('div', { className: 'agent-soul-meta-row' },
            h('span', { className: 'agent-soul-meta-label' }, t('catalogLineHeading')),
            h('div', { className: 'agent-soul-meta-value agent-soul-catalog-row' },
              detailCatalog === null || detailCatalog === ''
                ? muted(detailCatalog === null ? t('catalogLineUnavailable') : t('previewCatalogEmpty'))
                : h('pre', { className: 'agent-soul-catalog-line' }, detailCatalog),
              copyControl(t('copyCatalogLine'), detailCatalog === null ? '' : detailCatalog,
                'editor-catalog'))))

        const modeBar = h('div', {
          className: 'agent-soul-mode-row',
          role: 'group',
          'aria-label': t('modeLabel'),
        },
          h('span', { className: 'agent-soul-mode-label' }, t('modeLabel')),
          h('button', {
            type: 'button',
            className: 'agent-soul-chip',
            'aria-pressed': mode === 'form',
            onClick: function () { requestMode('form') },
            disabled: busyLocked,
          }, t('modeForm')),
          h('button', {
            type: 'button',
            className: 'agent-soul-chip',
            'aria-pressed': mode === 'raw',
            onClick: function () { requestMode('raw') },
            disabled: busyLocked,
          }, t('modeRaw')))

        const rawPanel = h('div', { className: 'agent-soul-group' },
          h('h4', { className: 'agent-soul-group-head' }, t('rawHeading')),
          h('p', { className: 'agent-soul-field-hint' }, t('rawHint')),
          h('div', { className: 'agent-soul-field' },
            h('label', {
              className: 'agent-soul-field-label',
              htmlFor: id('raw-source'),
            }, t('rawHeading')),
            h('textarea', {
              id: id('raw-source'),
              className: 'agent-soul-textarea agent-soul-textarea-mono agent-soul-raw-textarea',
              rows: 18,
              value: rawSource,
              spellCheck: false,
              disabled: busyLocked,
              onChange: function (event) {
                if (busyLocked) return
                setRawSource(event.target.value)
                setRawDiagnostics([])
              },
            })),
          Array.isArray(rawDiagnostics) && rawDiagnostics.length > 0
            ? diagnosticsList(t('diagnosticsHeading'), rawDiagnostics)
            : null)

        const duplicatePanel = !duplicateOpen ? null : h('div', { className: 'agent-soul-panel' },
          h('h4', { className: 'agent-soul-panel-title' }, t('duplicateHeading')),
          h('p', { className: 'agent-soul-field-hint' }, t('duplicateHint')),
          h('div', { className: 'agent-soul-inline-form' },
            textInput({
              id: id('duplicate-name'),
              label: t('duplicateName'),
              value: duplicateName,
              placeholder: t('duplicateNamePlaceholder'),
              onChange: setDuplicateName,
            }),
            h('div', { className: 'agent-soul-panel-actions' },
              h('button', {
                type: 'button',
                className: 'agent-soul-primary-button',
                onClick: function () { void submitDuplicate() },
                disabled: busyLocked || dirty || duplicateName.trim() === '',
              }, busy === 'duplicate' ? t('duplicatingButton') : t('duplicateSubmit')),
              h('button', {
                type: 'button',
                className: 'agent-soul-secondary-button',
                onClick: function () { setDuplicateOpen(false) },
                disabled: busyLocked,
              }, t('cancelButton')))))

        const bundledNotice = !bundledDocument ? null : h('section', {
          className: 'agent-soul-banner',
          role: 'status',
          'aria-label': t('badgeBundled'),
        },
          h('div', { className: 'agent-soul-banner-copy' },
            h('p', { className: 'agent-soul-banner-title' }, t('badgeBundled')),
            h('p', { className: 'agent-soul-banner-text' }, t('bundledSoulNotice'))))

        const draftBanner = draftOffer === null ? null : h('section', {
          className: 'agent-soul-banner',
          role: 'status',
          'aria-label': t('draftFoundTitle'),
        },
          h('div', { className: 'agent-soul-banner-copy' },
            h('p', { className: 'agent-soul-banner-title' }, t('draftFoundTitle')),
            h('p', { className: 'agent-soul-banner-text' },
              t('draftFoundText', {
                time: formatTimestamp(draftOffer.savedAt) || '?',
              }))),
          h('div', { className: 'agent-soul-banner-actions' },
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: function () {
                const offer = draftOffer
                if (offer === null) return
                setDraft(function (current) {
                  if (current === null) return current
                  return Object.assign({}, current, {
                    fields: offer.fields,
                    sections: offer.sections,
                  })
                })
                if (offer.mode === 'raw' && typeof offer.rawSource === 'string') {
                  // The stored raw text is the edit; the stored form fields only
                  // carry the baseline it was taken from.
                  setMode('raw')
                  setRawSource(offer.rawSource)
                  setRawDiagnostics([])
                  setPreview(null)
                } else {
                  setMode('form')
                  setRawSource(baselineSource)
                }
                setDraftOffer(null)
                setFieldErrors({})
              },
              disabled: busyLocked,
            }, t('restoreDraftButton')),
            h('button', {
              type: 'button',
              className: 'agent-soul-danger-button',
              onClick: function () {
                clearStoredDraft(draft.file)
                setDraftOffer(null)
              },
              disabled: busyLocked,
            }, t('discardDraftButton'))))

        const conflictBanner = conflict === null ? null : h('section', {
          className: 'agent-soul-banner agent-soul-banner-error',
          role: 'alert',
          'aria-label': t('conflictTitle'),
        },
          h('div', { className: 'agent-soul-banner-copy' },
            h('p', { className: 'agent-soul-banner-title' }, t('conflictTitle')),
            h('p', { className: 'agent-soul-banner-text' },
              t('conflictText', {
                time: formatTimestamp(conflict.currentModifiedAt) || '?',
              }))),
          h('div', { className: 'agent-soul-banner-actions' },
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: function () {
                clearStoredDraft(draft.file)
                setConflict(null)
                setDraftOffer(null)
                setFieldErrors({})
                if (selected !== null) void openDocument(selected)
              },
              disabled: busyLocked,
            }, t('reloadFileButton')),
            h('button', {
              type: 'button',
              className: 'agent-soul-primary-button',
              onClick: function () { void saveDocument(conflict.currentHash, conflict.currentHash === null) },
              disabled: busyLocked,
            }, t('overwriteButton'))))

        const deleteControl = confirmDelete
          ? h(React.Fragment, null,
            h('span', { className: 'agent-soul-delete-prompt' },
              t('confirmDelete', { name: draftName })),
            h('button', {
              type: 'button',
              className: 'agent-soul-danger-button',
              onClick: function () { void deleteDocument() },
              disabled: busyLocked,
            }, busy === 'delete' ? t('deletingButton') : t('confirmDeleteButton')),
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: function () { setConfirmDelete(false) },
              disabled: busyLocked,
            }, t('cancelButton')))
          : h('button', {
            type: 'button',
            className: 'agent-soul-danger-button',
            onClick: function () { setConfirmDelete(true) },
            disabled: busyLocked,
            title: t('deleteTrashHint'),
          }, t('deleteButton'))
        const actions = h('div', {
          className: 'agent-soul-action-bar agent-soul-dialog-footer',
          role: 'toolbar',
          'aria-label': t('editorHeading', { name: draftName }),
        },
          dirty ? h('span', { className: 'agent-soul-dirty agent-soul-dirty-badge' },
            t('dirtyHint')) : null,
          h('span', { className: 'agent-soul-actions-spacer' }),
          h('button', {
            type: 'button',
            className: 'agent-soul-primary-button',
            onClick: function () { void saveDocument() },
            disabled: busyLocked || bundledDocument,
            title: bundledDocument ? t('bundledSoulNotice') : undefined,
          }, busy === 'save' ? t('savingButton') : t('saveButton')),
          h('button', {
            type: 'button',
            className: 'agent-soul-secondary-button',
            onClick: revertDraft,
            disabled: busyLocked || !dirty,
          }, t('revertButton')),
          h('button', {
            type: 'button',
            className: 'agent-soul-secondary-button',
            onClick: function () {
              setDuplicateName(duplicateNameFor(draftName))
              setDuplicateOpen(true)
            },
            disabled: busyLocked || dirty,
          }, t('duplicateButton')),
          bundledDocument ? null : deleteControl)
        return {
          notices: h(React.Fragment, null, bundledNotice, draftBanner, conflictBanner, fieldErrorSummary),
          body: h(React.Fragment, null,
            editorMeta,
            modeBar,
            mode === 'raw'
              ? rawPanel
              : h(React.Fragment, null, identity, routing, markdown, advanced),
            previewPanel,
            duplicatePanel,
            documentDiagnostics),
          footer: actions,
        }
      }

      /**
       * Orchestrator mode body: six canonical section textareas plus the
       * config fields, all inside the same resizable P3 dialog and footer.
       * @returns {{ notices: object, body: object, footer: object }} dialog parts.
       */
      const buildOrchestratorForm = function () {
        const record = orchestratorDraft
        const fields = record !== null && record.fields !== null && typeof record.fields === 'object'
          ? record.fields
          : normalizeOrchestratorFields(null)
        const sections = record !== null && record.sections !== null && typeof record.sections === 'object'
          ? record.sections
          : normalizeOrchestratorSections(null)
        const currentTools = typeof fields.tools === 'string' ? fields.tools : ''
        const selectedToolNames = parseToolNames(currentTools)
        const toolsMode = toolModeOf(currentTools)
        const catalogToolNames = catalogTools.map(function (tool) {
          return tool !== null && typeof tool === 'object' && typeof tool.name === 'string' ? tool.name : ''
        }).filter(function (name) { return name !== '' })
        const teamToolNames = Array.isArray(catalogs.teamTools)
          ? catalogs.teamTools.filter(function (name) {
            return typeof name === 'string' && name !== ''
          })
          : []
        const unknownTools = catalogToolNames.length === 0 ? [] : selectedToolNames.filter(function (name) {
          // Team collaboration/task tools are kept automatically for every
          // teammate; listing one is harmless, so it is explained, not warned
          // about as unknown.
          return catalogToolNames.indexOf(name) === -1 && teamToolNames.indexOf(name) === -1
        })
        const listedTeamTools = selectedToolNames.filter(function (name) {
          return teamToolNames.indexOf(name) !== -1
        })
        const currentProvider = typeof fields.provider === 'string' ? fields.provider : ''
        const currentModel = typeof fields.model === 'string' ? fields.model : ''
        // The orchestrator route uses the same live provider/model catalogs as the
        // soul editor, so the two dialogs pick routes the same way.
        const providerOptions = [{ value: '', label: t('modelInheritOption') }]
        const providerIds = []
        catalogModels.forEach(function (entry) {
          if (entry === null || typeof entry !== 'object') return
          const provider = typeof entry.provider === 'string' ? entry.provider : ''
          if (provider === '' || providerIds.indexOf(provider) !== -1) return
          providerIds.push(provider)
          providerOptions.push({ value: provider, label: provider })
        })
        if (currentProvider !== '' && providerIds.indexOf(currentProvider) === -1) {
          providerOptions.push({ value: currentProvider, label: currentProvider })
        }
        const modelOptions = [{ value: '', label: t('modelInheritOption') }]
        const modelValues = []
        catalogModels.forEach(function (entry) {
          if (entry === null || typeof entry !== 'object') return
          const provider = typeof entry.provider === 'string' ? entry.provider : ''
          const model = typeof entry.model === 'string' ? entry.model : ''
          if (model === '') return
          if (currentProvider !== '' && provider !== currentProvider) return
          if (modelValues.indexOf(model) !== -1) return
          modelValues.push(model)
          const name = typeof entry.name === 'string' && entry.name !== '' ? entry.name : model
          modelOptions.push({
            value: model,
            label: currentProvider === '' && provider !== '' ? name + ' · ' + provider : name,
          })
        })
        if (currentModel !== '' && modelValues.indexOf(currentModel) === -1) {
          modelOptions.push({
            value: currentModel,
            label: t('modelNotInCatalog', { model: currentModel }),
          })
        }
        const gateOptions = [
          { value: 'strict', label: t('gateModeStrict') },
          { value: 'advisory', label: t('gateModeAdvisory') },
          { value: 'off', label: t('gateModeOff') },
        ]
        const checkboxField = function (suffix, label, hint, checked, onChange) {
          return h('div', { className: 'agent-soul-field-wide' },
            h('div', { className: 'agent-soul-checkbox-row' },
              h('input', {
                id: id(suffix),
                className: 'agent-soul-checkbox',
                type: 'checkbox',
                checked: checked === true,
                disabled: busyLocked,
                onChange: function (event) {
                  if (busyLocked) return
                  onChange(event.target.checked)
                },
              }),
              h('label', { className: 'agent-soul-checkbox-text', htmlFor: id(suffix) },
                h('span', { className: 'agent-soul-checkbox-label' }, label),
                h('span', { className: 'agent-soul-field-hint' }, hint))))
        }
        const toolsPicker = h('div', {
          className: 'agent-soul-field agent-soul-field-wide',
        },
          h('span', { className: 'agent-soul-field-label' }, t('fieldTools')),
          h('p', { className: 'agent-soul-field-hint' }, t('toolsCustomHint')),
          h('div', {
            className: 'agent-soul-chip-row',
            role: 'group',
            'aria-label': t('fieldTools'),
            'data-catalog-source': catalogSource,
          },
            h('button', {
              type: 'button',
              className: 'agent-soul-chip',
              'aria-pressed': toolsMode === 'all',
              onClick: function () {
                updateOrchestratorField('tools', toolsMode === 'all' ? '' : '*')
              },
              disabled: busyLocked,
            }, t('toolsInheritAll')),
            catalogToolNames.map(function (name) {
              const tool = catalogTools.find(function (entry) {
                return entry !== null && typeof entry === 'object' && entry.name === name
              })
              const description = tool !== undefined && typeof tool.description === 'string'
                ? tool.description
                : ''
              return h('button', {
                key: 'orch-tool-' + name,
                type: 'button',
                className: 'agent-soul-chip',
                'aria-pressed': selectedToolNames.indexOf(name) !== -1,
                'aria-label': t('toolsToggle', { name: name }),
                title: description === '' ? undefined : description,
                onClick: function () {
                  updateOrchestratorField('tools', toggleToolName(currentTools, name))
                },
                disabled: busyLocked,
              }, name)
            })),
          catalogToolNames.length === 0
            ? h('p', { className: 'agent-soul-field-hint' }, t('toolsCatalogEmpty'))
            : null,
          toolsMode === 'all'
            ? h('p', { className: 'agent-soul-field-hint' }, t('toolsInheritHint'))
            : toolsMode === 'none'
              ? h('p', { className: 'agent-soul-field-hint' }, t('toolsNoneHint'))
              : h('p', { className: 'agent-soul-field-hint' },
                t('toolsCount', { count: selectedToolNames.length })),
          textInput({
            id: id('orch-tools'),
            label: t('fieldToolsAdvanced'),
            hint: t('fieldToolsAdvancedHint'),
            value: currentTools,
            placeholder: t('fieldToolsPlaceholder'),
            error: orchestratorFieldErrors.tools,
            onChange: function (value) { updateOrchestratorField('tools', value) },
          }),
          unknownTools.length === 0 ? null : h('div', { className: 'agent-soul-picker' },
            h('span', {
              className: 'agent-soul-field-label agent-soul-warning-note',
            }, t('toolsUnknownHeading')),
            h('div', { className: 'agent-soul-chip-row' }, unknownTools.map(function (name) {
              return h('button', {
                key: 'orch-unknown-tool-' + name,
                type: 'button',
                className: 'agent-soul-chip agent-soul-chip-warning',
                'aria-label': t('toolsRemove', { name: name }),
                onClick: function () {
                  updateOrchestratorField('tools', formatToolNames(selectedToolNames.filter(
                    function (toolName) { return toolName !== name })))
                },
                disabled: busyLocked,
              }, name + ' ×')
            })),
            h('p', { className: 'agent-soul-field-hint' }, t('toolsUnknownHint'))),
          listedTeamTools.length === 0
            ? null
            : h('p', { className: 'agent-soul-field-hint' }, t('toolsTeamAlwaysHint')))
        const configGroup = h('div', { className: 'agent-soul-group' },
          h('h4', { className: 'agent-soul-group-head' }, t('groupOrchestratorConfig')),
          h('p', { className: 'agent-soul-field-hint' }, t('orchestratorConfigHint')),
          h('div', { className: 'agent-soul-fields' },
            h('div', { className: 'agent-soul-field-grid' },
              textInput({
                id: id('orch-name'),
                label: t('fieldName'),
                value: fields.name,
                error: orchestratorFieldErrors.name,
                onChange: function (value) { updateOrchestratorField('name', value) },
              }),
              selectInput({
                id: id('orch-provider'),
                label: t('fieldProvider'),
                value: currentProvider,
                options: providerOptions,
                error: orchestratorFieldErrors.provider,
                onChange: function (value) { updateOrchestratorField('provider', value) },
              }),
              selectInput({
                id: id('orch-model'),
                label: t('fieldModel'),
                value: currentModel,
                options: modelOptions,
                error: orchestratorFieldErrors.model,
                onChange: function (value) {
                  updateOrchestratorField('model', value)
                  if (value === '' || currentProvider !== '') return
                  const entry = catalogModels.find(function (candidate) {
                    return candidate !== null && typeof candidate === 'object' && candidate.model === value
                  })
                  if (entry !== undefined && typeof entry.provider === 'string' && entry.provider !== '') {
                    updateOrchestratorField('provider', entry.provider)
                  }
                },
              }),
              textInput({
                id: id('orch-reasoning'),
                label: t('fieldReasoning'),
                value: fields.reasoningEffort,
                placeholder: t('fieldReasoningPlaceholder'),
                error: orchestratorFieldErrors.reasoningEffort,
                onChange: function (value) { updateOrchestratorField('reasoningEffort', value) },
              })),
            catalogModels.length === 0
              ? h('p', { className: 'agent-soul-field-hint' }, t('modelCatalogEmpty'))
              : null,
            toolsPicker,
            h('div', { className: 'agent-soul-field-grid' },
              selectInput({
                id: id('orch-gate-mode'),
                label: t('fieldGateMode'),
                value: fields.gateMode,
                options: gateOptions,
                error: orchestratorFieldErrors.gateMode,
                onChange: function (value) { updateOrchestratorField('gateMode', value) },
              }),
              numberInput({
                id: id('orch-max-retries'),
                label: t('fieldMaxRetries'),
                value: fields.maxRetries,
                min: 0,
                max: 10,
                error: orchestratorFieldErrors.maxRetries,
                onChange: function (value) {
                  const text = String(value).trim()
                  const parsed = parseInt(text, 10)
                  updateOrchestratorField('maxRetries',
                    Number.isInteger(parsed) ? Math.max(0, Math.min(10, parsed)) : 0)
                },
              })),
            h('div', { className: 'agent-soul-field-grid' },
              checkboxField('orch-plan-first', t('fieldPlanFirst'), t('fieldPlanFirstHint'),
                fields.planFirst === true,
                function (checked) { updateOrchestratorField('planFirst', checked) }),
              checkboxField('orch-pause-on-fatal', t('fieldPauseOnFatal'), t('fieldPauseOnFatalHint'),
                fields.pauseOnFatal === true,
                function (checked) { updateOrchestratorField('pauseOnFatal', checked) }))))
        const sectionGroup = h('div', { className: 'agent-soul-group' },
          h('h4', { className: 'agent-soul-group-head' }, t('groupOrchestratorSections')),
          h('p', { className: 'agent-soul-field-hint' }, t('orchestratorSectionsHint')),
          typeof orchestratorFieldErrors.body === 'string' && orchestratorFieldErrors.body !== ''
            ? h('p', { className: 'agent-soul-field-error', id: id('orch-body-error'), role: 'alert' },
              orchestratorFieldErrors.body)
            : null,
          h('div', { className: 'agent-soul-fields' },
            textArea({
              id: id('orch-section-identity'),
              label: t('sectionIdentity'),
              value: sections.identity,
              rows: 5,
              error: orchestratorFieldErrors.identity,
              onChange: function (value) { updateOrchestratorSection('identity', value) },
            }),
            textArea({
              id: id('orch-section-plan'),
              label: t('sectionPlan'),
              value: sections.plan,
              rows: 5,
              error: orchestratorFieldErrors.plan,
              onChange: function (value) { updateOrchestratorSection('plan', value) },
            }),
            textArea({
              id: id('orch-section-delegation'),
              label: t('sectionDelegation'),
              value: sections.delegation,
              rows: 5,
              error: orchestratorFieldErrors.delegation,
              onChange: function (value) { updateOrchestratorSection('delegation', value) },
            }),
            textArea({
              id: id('orch-section-state'),
              label: t('sectionState'),
              value: sections.state,
              rows: 4,
              error: orchestratorFieldErrors.state,
              onChange: function (value) { updateOrchestratorSection('state', value) },
            }),
            textArea({
              id: id('orch-section-verification'),
              label: t('sectionVerification'),
              value: sections.verification,
              rows: 4,
              error: orchestratorFieldErrors.verification,
              onChange: function (value) { updateOrchestratorSection('verification', value) },
            }),
            textArea({
              id: id('orch-section-recovery'),
              label: t('sectionRecovery'),
              value: sections.recovery,
              rows: 4,
              error: orchestratorFieldErrors.recovery,
              onChange: function (value) { updateOrchestratorSection('recovery', value) },
            }),
            textArea({
              id: id('orch-section-extra-markdown'),
              label: t('fieldExtraMarkdown'),
              hint: t('fieldExtraMarkdownHint'),
              value: sections.extraMarkdown,
              rows: 4,
              error: orchestratorFieldErrors.extraMarkdown,
              onChange: function (value) { updateOrchestratorSection('extraMarkdown', value) },
            })))
        const fieldErrorSummary = orchestratorErrorEntries.length === 0 ? null : h('div', {
          className: 'agent-soul-error-summary',
          role: 'alert',
        },
          h('p', { className: 'agent-soul-error-summary-title' }, t('fieldErrorSummary')),
          h('ul', { className: 'agent-soul-error-list' }, orchestratorErrorEntries.map(function (key) {
            return h('li', { key: key },
              h('button', {
                type: 'button',
                className: 'agent-soul-error-link',
                onClick: function () { focusOrchestratorField(key) },
              }, fieldErrorLabel(t, key) + ': ' + orchestratorFieldErrors[key]))
          })))
        const documentDiagnostics = record !== null && Array.isArray(record.diagnostics)
          && record.diagnostics.length > 0
          ? diagnosticsList(t('diagnosticsHeading'), record.diagnostics)
          : null
        const footer = h('div', {
          className: 'agent-soul-action-bar agent-soul-dialog-footer',
          role: 'toolbar',
          'aria-label': t('orchestratorHeading'),
        },
          orchestratorDirty
            ? h('span', { className: 'agent-soul-dirty agent-soul-dirty-badge' }, t('dirtyHint'))
            : null,
          h('span', { className: 'agent-soul-actions-spacer' }),
          h('button', {
            type: 'button',
            className: 'agent-soul-primary-button',
            onClick: function () { void saveOrchestrator() },
            disabled: busyLocked,
          }, busy === 'orchestrator-save' ? t('savingButton') : t('saveButton')),
          h('button', {
            type: 'button',
            className: 'agent-soul-secondary-button',
            onClick: revertOrchestrator,
            disabled: busyLocked || !orchestratorDirty,
          }, t('revertButton')),
          h('button', {
            type: 'button',
            className: 'agent-soul-secondary-button',
            onClick: requestCloseDialog,
            disabled: busyLocked,
          }, t('cancelButton')))
        return {
          notices: h(React.Fragment, null, fieldErrorSummary),
          body: h(React.Fragment, null,
            h('p', { className: 'agent-soul-field-hint' }, t('orchestratorDialogHint')),
            configGroup,
            sectionGroup,
            documentDiagnostics),
          footer: footer,
        }
      }

      // One centered, resizable dialog serves edit, create, import and
      // orchestrator modes. The overlay and panel are token-only; the chosen
      // size persists locally.
      const dialog = dialogMode === null ? null : (function () {
        const dialogFile = dialogMode === 'orchestrator'
          ? (orchestratorDraft !== null ? String(orchestratorDraft.path || '') : '')
          : (dialogMode !== 'document'
            ? ''
            : (draft !== null
              ? String(draft.file || '')
              : (selected === null ? '' : String(selected))))
        const dialogTitle = dialogMode === 'orchestrator'
          ? t('orchestratorHeading')
          : (dialogMode === 'create'
            ? t('createHeading')
            : (dialogMode === 'import'
              ? t('pasteHeading')
              : (draftName === '' ? t('statusOpening') : t('editorHeading', { name: draftName }))))
        const dialogBadge = dialogMode === 'orchestrator'
          ? (orchestratorDraft === null
            ? null
            : (orchestratorDraft.configured
              ? badge(orchestratorDraft.valid === false ? t('badgeInvalid') : t('badgeValid'),
                orchestratorDraft.valid === false
                  ? 'agent-soul-badge-error'
                  : 'agent-soul-badge-ok')
              : badge(t('orchestratorUnconfigured'))))
          : (dialogMode === 'document' && draft !== null
            ? badge(draft.valid === false ? t('badgeInvalid') : t('badgeValid'),
              draft.valid === false ? 'agent-soul-badge-error' : 'agent-soul-badge-ok')
            : null)
        let dialogBody = null
        let dialogFooter = null
        let dialogNotices = null
        if (dialogMode === 'create') {
          dialogBody = createPanel
          dialogFooter = h('div', {
            className: 'agent-soul-action-bar agent-soul-dialog-footer',
            role: 'toolbar',
            'aria-label': t('createHeading'),
          },
            createDirty ? h('span', { className: 'agent-soul-dirty agent-soul-dirty-badge' },
              t('dirtyHint')) : null,
            h('span', { className: 'agent-soul-actions-spacer' }),
            h('button', {
              type: 'button',
              className: 'agent-soul-primary-button',
              onClick: function () { void submitCreate() },
              disabled: busyLocked || newName.trim() === '',
            }, busy === 'create' ? t('creatingButton') : t('createButton')),
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: requestCloseDialog,
              disabled: busyLocked,
            }, t('cancelButton')))
        } else if (dialogMode === 'import') {
          dialogBody = pastePanel
          dialogFooter = h('div', {
            className: 'agent-soul-action-bar agent-soul-dialog-footer',
            role: 'toolbar',
            'aria-label': t('pasteHeading'),
          },
            importDirty ? h('span', { className: 'agent-soul-dirty agent-soul-dirty-badge' },
              t('dirtyHint')) : null,
            h('span', { className: 'agent-soul-actions-spacer' }),
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: function () { void parsePastedMarkdown() },
              disabled: busyLocked || pasteSource.trim() === '',
            }, busy === 'parse' ? t('parsingButton') : t('parseButton')),
            h('button', {
              type: 'button',
              className: 'agent-soul-primary-button',
              onClick: function () { void importPastedMarkdown() },
              disabled: busyLocked || pasteResult === null,
            }, busy === 'paste-create'
              ? t('creatingButton')
              : (selected !== null && draft !== null ? t('importButton') : t('createFromPaste'))),
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: requestCloseDialog,
              disabled: busyLocked,
            }, t('cancelButton')))
        } else if (dialogMode === 'orchestrator') {
          if (orchestratorDraft !== null) {
            const orchestratorContent = buildOrchestratorForm()
            dialogBody = orchestratorContent.body
            dialogNotices = orchestratorContent.notices
            dialogFooter = orchestratorContent.footer
          } else {
            dialogBody = h('div', { className: 'agent-soul-skeleton-editor', 'aria-hidden': 'true' },
              h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-title' }),
              h('span', { className: 'agent-soul-skeleton-line' }),
              h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-short' }))
            dialogFooter = h('div', {
              className: 'agent-soul-action-bar agent-soul-dialog-footer',
              role: 'toolbar',
              'aria-label': t('orchestratorHeading'),
            },
              h('span', { className: 'agent-soul-actions-spacer' }),
              h('button', {
                type: 'button',
                className: 'agent-soul-secondary-button',
                onClick: requestCloseDialog,
                disabled: busyLocked,
              }, t('cancelButton')))
          }
        } else if (documentError !== null) {
          dialogBody = h(React.Fragment, null, h('div', {
            className: 'agent-soul-error-card',
            role: 'alert',
          },
            h('h3', { className: 'agent-soul-error-title' }, t('errorDocumentTitle')),
            h('p', { className: 'agent-soul-error-body' }, failureText(t, documentError)),
            h('div', { className: 'agent-soul-actions' },
              h('button', {
                type: 'button',
                className: 'agent-soul-secondary-button',
                onClick: function () {
                  if (selected !== null) void openDocument(selected)
                },
                disabled: busyLocked,
              }, t('retryButton')))))
          dialogFooter = h('div', {
            className: 'agent-soul-action-bar agent-soul-dialog-footer',
            role: 'toolbar',
            'aria-label': t('errorDocumentTitle'),
          },
            h('span', { className: 'agent-soul-actions-spacer' }),
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: requestCloseDialog,
              disabled: busyLocked,
            }, t('cancelButton')))
        } else if (draft !== null) {
          const editorContent = buildEditorForm()
          dialogBody = editorContent.body
          dialogNotices = editorContent.notices
          dialogFooter = editorContent.footer
        } else {
          dialogBody = h(React.Fragment, null,
            h('div', {
              className: 'agent-soul-skeleton-editor',
              'aria-hidden': 'true',
              'aria-busy': true,
            },
              h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-title' }),
              h('span', { className: 'agent-soul-skeleton-line' }),
              h('span', { className: 'agent-soul-skeleton-line' }),
              h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-short' }),
              h('span', { className: 'agent-soul-skeleton-line' })))
          dialogFooter = h('div', {
            className: 'agent-soul-action-bar agent-soul-dialog-footer',
            role: 'toolbar',
            'aria-label': t('statusLoading'),
          },
            h('span', { className: 'agent-soul-actions-spacer' }),
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: requestCloseDialog,
              disabled: busyLocked,
            }, t('cancelButton')))
        }
        return h('div', {
          className: 'agent-soul-dialog-backdrop',
          onMouseDown: function (event) {
            if (event.target !== event.currentTarget) return
            requestCloseDialog()
          },
        },
          h('div', {
            className: 'agent-soul-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': id('dialog-title'),
            tabIndex: -1,
            ref: dialogRef,
            style: {
              width: editorSize.width + 'px',
              height: editorSize.height + 'px',
            },
          },
            h('div', { className: 'agent-soul-dialog-head' },
              h('div', { className: 'agent-soul-dialog-heading' },
                h('h2', {
                  className: 'agent-soul-dialog-title',
                  id: id('dialog-title'),
                }, dialogTitle),
                dialogBadge,
                dialogFile === '' ? null : h('span', {
                  className: 'agent-soul-dialog-path',
                  title: dialogFile,
                }, dialogFile)),
              h('div', { className: 'agent-soul-dialog-head-actions' },
                h('button', {
                  type: 'button',
                  className: 'agent-soul-dialog-reset',
                  onClick: resetEditorSize,
                  'aria-label': t('resetSizeButton'),
                  title: t('resetSizeButton'),
                }, t('resetSizeButton')),
                h('button', {
                  type: 'button',
                  className: 'agent-soul-dialog-close',
                  onClick: requestCloseDialog,
                  'aria-label': t('closeDialog'),
                  title: t('closeDialog'),
                }, '×'))),
            status === null && pendingAction === null && dialogNotices === null ? null : h('div', {
              className: 'agent-soul-dialog-notices',
            }, statusLine, guardBanner, dialogNotices),
            h('div', { className: 'agent-soul-editor-body' }, dialogBody),
            dialogFooter,
            h('button', {
              type: 'button',
              className: 'agent-soul-dialog-resize',
              'aria-label': t('resizeHandle'),
              title: t('resizeHandle'),
              onPointerDown: startResize,
              onKeyDown: handleResizeKeyDown,
            })))
      })()

      // Runtime health is rendered defensively: the Host may omit it, a budget
      // may have a zero/absent maximum, and every count may be missing.
      const healthCard = (function () {
        if (overview === null) return null
        const health = runtime.health !== null && typeof runtime.health === 'object'
          ? runtime.health
          : null
        const definitions = health !== null && health.definitions !== null
          && typeof health.definitions === 'object'
          ? health.definitions
          : {}
        const catalogChars = health !== null && health.catalogChars !== null
          && typeof health.catalogChars === 'object'
          ? health.catalogChars
          : {}
        const duplicates = health !== null && Array.isArray(health.duplicates)
          ? health.duplicates.filter(function (name) { return typeof name === 'string' && name !== '' })
          : []
        const scanDiagnostics = Array.isArray(overview.diagnostics) ? overview.diagnostics : []
        const invalidFiles = health !== null && typeof health.invalidFiles === 'number'
          ? health.invalidFiles
          : (typeof runtime.invalidCount === 'number' ? runtime.invalidCount : null)
        const diagnosticCount = health !== null && typeof health.diagnostics === 'number'
          ? health.diagnostics
          : scanDiagnostics.length
        const teamTools = health !== null && health.teamTools !== null
          && typeof health.teamTools === 'object'
          ? health.teamTools
          : null
        const teamToolsWarning = teamTools !== null && teamTools.ok === false
          ? h('div', { className: 'agent-soul-group' },
            h('h4', { className: 'agent-soul-group-head' }, t('healthTeamTools')),
            h('p', { className: 'agent-soul-warning-note' },
              typeof teamTools.message === 'string' ? teamTools.message : ''),
            typeof teamTools.fix === 'string' && teamTools.fix !== ''
              ? h('pre', { className: 'agent-soul-catalog-line' }, teamTools.fix)
              : null)
          : null
        const countNode = function (value) {
          return value === null
            ? muted(t('healthNotReported'))
            : h('strong', { className: 'agent-soul-health-count-value' }, String(value))
        }
        const duplicatesValue = health === null
          ? muted(t('healthNotReported'))
          : (duplicates.length === 0
            ? muted(t('healthNoDuplicates'))
            : h('ul', { className: 'agent-soul-health-list' }, duplicates.map(function (name, index) {
              return h('li', { key: index, className: 'agent-soul-health-duplicate' },
                codeValue(name),
                h('span', { className: 'agent-soul-warning-note' }, t('healthDuplicateLabel')))
            })))
        const diagnosticsValue = scanDiagnostics.length === 0
          ? muted(t('healthNoDiagnostics'))
          : h('ul', { className: 'agent-soul-diagnostics' }, scanDiagnostics.map(function (item, index) {
            const matched = diagnosticDocument(documents, item)
            if (matched === null) {
              return h('li', { key: index, className: 'agent-soul-diagnostic' }, diagnosticText(item))
            }
            const fileLabel = typeof matched.label === 'string' && matched.label !== ''
              ? matched.label
              : String(matched.file || '')
            return h('li', { key: index, className: 'agent-soul-diagnostic' },
              h('button', {
                type: 'button',
                className: 'agent-soul-diagnostic-link',
                onClick: function () { requestOpen(matched.file) },
                'aria-label': t('diagnosticOpenFile', { file: fileLabel }),
              }, diagnosticText(item)))
          }))
        return h('section', {
          className: 'agent-soul-card',
          'aria-label': t('healthHeading'),
        },
          h('h3', { className: 'agent-soul-card-title' }, t('healthHeading')),
          h('p', { className: 'agent-soul-field-hint' }, t('healthHint')),
          h('div', { className: 'agent-soul-health-budgets' },
            budgetBar(t, t('healthDefinitions'), definitions.used, definitions.max, 'definitions'),
            budgetBar(t, t('healthCatalogChars'), catalogChars.used, catalogChars.max, 'catalog-chars')),
          h('div', { className: 'agent-soul-health-counts' },
            h('div', { className: 'agent-soul-health-count' },
              h('span', { className: 'agent-soul-health-count-label' }, t('healthInvalidFiles')),
              countNode(invalidFiles)),
            h('div', { className: 'agent-soul-health-count' },
              h('span', { className: 'agent-soul-health-count-label' }, t('healthScanDiagnostics')),
              countNode(diagnosticCount))),
          h('div', { className: 'agent-soul-group' },
            h('h4', { className: 'agent-soul-group-head' }, t('healthDuplicatesHeading')),
            duplicatesValue),
          h('div', { className: 'agent-soul-group' },
            h('h4', { className: 'agent-soul-group-head' }, t('scanDiagnosticsHeading')),
            diagnosticsValue),
          teamToolsWarning)
      })()

      const infoCard = (function () {
        if (overview === null) {
          if (overviewError !== null) return null
          if (loading) {
            return h('section', { className: 'agent-soul-card', 'aria-busy': true },
              h('div', { className: 'agent-soul-skeleton-info', 'aria-hidden': 'true' },
                h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-title' }),
                h('span', { className: 'agent-soul-skeleton-line' }),
                h('span', { className: 'agent-soul-skeleton-line' }),
                h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-short' })))
          }
          return h('section', { className: 'agent-soul-card' },
            h('p', { className: 'agent-soul-muted' }, t('statusLoading')))
        }
        const plugin = overview.plugin !== null && typeof overview.plugin === 'object' ? overview.plugin : {}
        const resolvedDirs = Array.isArray(settings.resolvedDirs)
          ? settings.resolvedDirs
          : (Array.isArray(settings.dirs) ? settings.dirs : [])
        const providers = Array.isArray(settings.providers) ? settings.providers : []
        const providerNames = providers.map(function (provider) {
          if (provider === null || typeof provider !== 'object') return ''
          return typeof provider.name === 'string' && provider.name !== ''
            ? provider.name
            : (typeof provider.id === 'string' ? provider.id : '')
        }).filter(function (name) { return name !== '' })
        const bindingsPath = typeof settings.bindingsPath === 'string' && settings.bindingsPath !== ''
          ? settings.bindingsPath
          : (typeof settings.bindingsFile === 'string' ? settings.bindingsFile : '')
        const bindingsCount = typeof runtime.bindingsCount === 'number' ? runtime.bindingsCount : null
        const commandPrefix = typeof settings.commandPrefix === 'string' ? settings.commandPrefix : ''
        const liveTeams = Array.isArray(runtime.liveTeams) ? runtime.liveTeams : []
        const scanTime = formatTimestamp(runtime.scannedAt)
        const limits = t('infoLimits', {
          definitions: typeof settings.maxDefinitions === 'number' ? settings.maxDefinitions : '?',
          chars: typeof settings.maxPromptChars === 'number' ? settings.maxPromptChars : '?',
        })
        const pluginLine = [
          typeof plugin.name === 'string' ? plugin.name : '',
          typeof plugin.version === 'string' ? plugin.version : '',
        ].filter(function (part) { return part !== '' }).join(' · ')
        const liveTeamsValue = liveTeams.length === 0
          ? muted(t('infoLiveTeamsEmpty'))
          : h('div', { className: 'agent-soul-stack' },
            h('div', { className: 'agent-soul-team-list' }, liveTeams.map(function (team, index) {
              const commands = team !== null && typeof team === 'object' && Array.isArray(team.commands)
                ? team.commands
                : []
              const lead = team !== null && typeof team === 'object' && typeof team.lead === 'string'
                ? team.lead
                : ''
              const memberCount = team !== null && typeof team === 'object'
                && typeof team.memberCount === 'number' && isFinite(team.memberCount)
                ? team.memberCount
                : null
              return h('div', { key: index, className: 'agent-soul-team' },
                h('span', { className: 'agent-soul-team-lead' }, t('infoTeamLead', { lead: lead })),
                memberCount === null
                  ? null
                  : h('span', { className: 'agent-soul-badge' }, memberCount === 1
                    ? t('infoLiveTeamMember')
                    : t('infoLiveTeamMembers', { count: memberCount })),
                h('span', { className: 'agent-soul-badges' }, commands.map(function (command, commandIndex) {
                  const name = command !== null && typeof command === 'object' && typeof command.name === 'string'
                    ? command.name
                    : ''
                  return h('code', {
                    key: commandIndex,
                    className: 'agent-soul-code',
                    title: command !== null && typeof command === 'object'
                      && typeof command.description === 'string'
                      ? command.description
                      : undefined,
                  }, '/' + commandPrefix + name)
                })))
            })),
            h('p', { className: 'agent-soul-field-hint' }, t('infoTeamSpawnNote')))
        return h('section', {
          className: 'agent-soul-card',
          'aria-label': t('infoHeading'),
        },
          h('h3', { className: 'agent-soul-card-title' }, t('infoHeading')),
          h('div', { className: 'agent-soul-info-rows' },
            infoRow(t('infoPlugin'), pluginLine === '' ? muted('—') : pluginLine),
            infoRow(t('infoRoot'), codeValue(typeof plugin.root === 'string' ? plugin.root : '')),
            infoRow(t('infoDirs'), resolvedDirs.length === 0
              ? muted(t('infoDirsEmpty'))
              : codeList(resolvedDirs)),
            infoRow(t('cardLabel'), h(DefaultSoulsCardControl, { t: t })),
            infoRow(t('infoBindings'), h('div', { className: 'agent-soul-stack' },
              codeValue(bindingsPath),
              h('span', { className: 'agent-soul-muted' }, bindingsCount === null
                ? t('infoBindingsUnreadable')
                : t('infoBindingsCount', { count: bindingsCount })))),
            infoRow(t('infoProviders'), providerNames.length === 0
              ? muted(t('infoProvidersEmpty'))
              : providerNames.join(' · ')),
            infoRow(t('infoCommandPrefix'), commandPrefix === ''
              ? muted(t('infoCommandPrefixNone'))
              : codeValue(commandPrefix)),
            infoRow(t('infoDefaultContext'), String(settings.defaultContext || t('fieldContextAbsent'))),
            infoRow(t('infoSpawnProviders'), String(settings.freshProvider || '?') + ' / ' + String(settings.forkProvider || '?')),
            infoRow(t('infoLimitsLabel'), limits),
            infoRow(t('infoScanTime'), scanTime === null ? muted(t('infoScanNever')) : scanTime),
            infoRow(t('infoLiveTeams'), liveTeamsValue),
            infoRow(t('infoDelegation'), h('div', { className: 'agent-soul-stack' },
              h('span', { className: 'agent-soul-field-hint' }, t('infoDelegationHint')),
              h('code', { className: 'agent-soul-code-block' }, t('infoDelegationExample'))))),
          h('p', { className: 'agent-soul-field-hint' }, t('infoMarkdownNote')))
      })()

      // The Orchestrator tab: one definition card with its path, badges,
      // diagnostics, activation hint and the two dialog actions. The GET route
      // answers with a skeleton when the file is absent, so an absent file is
      // an unconfigured state rather than an error.
      const orchestratorPanel = (function () {
        if (orchestratorError !== null) {
          return h('section', {
            className: 'agent-soul-card',
            'aria-label': t('orchestratorHeading'),
          },
            h('div', { className: 'agent-soul-error-card', role: 'alert' },
              h('h3', { className: 'agent-soul-error-title' }, t('errorOrchestratorTitle')),
              h('p', { className: 'agent-soul-error-body' }, failureText(t, orchestratorError)),
              h('p', { className: 'agent-soul-muted' }, t('errorBody')),
              h('div', { className: 'agent-soul-actions' },
                h('button', {
                  type: 'button',
                  className: 'agent-soul-secondary-button',
                  onClick: function () { void loadOrchestrator() },
                  disabled: orchestratorLoading,
                }, t('retryButton')))))
        }
        if (orchestrator === null) {
          return h('section', { className: 'agent-soul-card', 'aria-busy': true },
            h('h3', { className: 'agent-soul-card-title' }, t('orchestratorHeading')),
            h('div', { className: 'agent-soul-skeleton-info', 'aria-hidden': 'true' },
              h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-title' }),
              h('span', { className: 'agent-soul-skeleton-line' }),
              h('span', { className: 'agent-soul-skeleton-line' }),
              h('span', { className: 'agent-soul-skeleton-line agent-soul-skeleton-line-short' })),
            h('p', { className: 'agent-soul-muted' }, t('statusLoading')))
        }
        const record = orchestrator
        const fields = record.fields
        const toolsMode = toolModeOf(fields.tools)
        const toolNames = parseToolNames(fields.tools)
        const badges = [
          badge(record.configured ? t('orchestratorConfigured') : t('orchestratorUnconfigured'),
            undefined, 'configured'),
        ]
        if (record.configured) {
          badges.push(badge(record.valid === false ? t('badgeInvalid') : t('badgeValid'),
            record.valid === false ? 'agent-soul-badge-error' : 'agent-soul-badge-ok',
            'valid'))
          badges.push(badge(t('fieldName') + ': ' + fields.name, undefined, 'name'))
          badges.push(badge(t('badgeModel', {
            model: fields.model !== '' ? fields.model : t('modelResolvedInherited'),
          }), undefined, 'model'))
          badges.push(badge(toolsMode === 'all'
            ? t('badgeAllTools')
            : (toolsMode === 'none' ? t('badgeNoTools') : t('badgeTools', { count: toolNames.length })),
          undefined, 'tools'))
          badges.push(badge(t('orchestratorBadgePlan', {
            value: fields.planFirst ? t('valueOn') : t('valueOff'),
          }), undefined, 'plan-first'))
          badges.push(badge(t('orchestratorBadgeGate', {
            mode: gateModeLabel(t, fields.gateMode),
          }), undefined, 'gate-mode'))
          badges.push(badge(t('orchestratorBadgeRetries', { count: fields.maxRetries }),
            undefined, 'max-retries'))
          badges.push(badge(t('orchestratorBadgePause', {
            value: fields.pauseOnFatal ? t('valueOn') : t('valueOff'),
          }), undefined, 'pause-on-fatal'))
        }
        if (record.bundled === true) {
          badges.push(badge(t('badgeBundled'), 'agent-soul-badge-active', 'bundled'))
        }
        const missing = record.configured ? null : h('div', { className: 'agent-soul-empty' },
          h('p', { className: 'agent-soul-empty-title' }, t('orchestratorMissingTitle')),
          h('p', { className: 'agent-soul-empty-body' }, t('orchestratorMissingBody')),
          h('p', { className: 'agent-soul-field-hint' }, t('orchestratorCreateHint')))
        const diagnostics = Array.isArray(record.diagnostics) && record.diagnostics.length > 0
          ? diagnosticsList(t('diagnosticsHeading'), record.diagnostics)
          : null
        const activation = h('div', { className: 'agent-soul-orchestrator-hint' },
          h('div', { className: 'agent-soul-command-row' },
            h('span', { className: 'agent-soul-sort-label' }, t('orchestratorActivation')),
            h('code', { className: 'agent-soul-command' }, t('orchestratorCommand')),
            h('code', { className: 'agent-soul-command' }, t('orchestratorCommandOff'))),
          h('p', { className: 'agent-soul-field-hint' }, t('orchestratorHint')))
        return h('section', {
          className: 'agent-soul-card',
          'aria-label': t('orchestratorHeading'),
        },
          h('div', { className: 'agent-soul-card-head' },
            h('h3', { className: 'agent-soul-card-title' }, t('orchestratorHeading')),
            h('span', { className: 'agent-soul-toolbar-spacer' }),
            h('button', {
              type: 'button',
              className: 'agent-soul-secondary-button',
              onClick: requestOrchestratorRefresh,
              disabled: busyLocked || orchestratorLoading,
            }, orchestratorLoading ? t('refreshBusy') : t('refreshButton'))),
          h('p', { className: 'agent-soul-field-hint' }, t('orchestratorIntro')),
          h('div', { className: 'agent-soul-orchestrator-path' },
            h('span', { className: 'agent-soul-sort-label' }, t('orchestratorPath')),
            h('code', {
              className: 'agent-soul-code-block',
              title: record.path === '' ? undefined : record.path,
            }, record.path === '' ? '—' : record.path)),
          h('div', { className: 'agent-soul-badges' }, badges),
          record.bundled === true
            ? h('p', { className: 'agent-soul-field-hint' }, t('orchestratorBundledHint'))
            : null,
          missing,
          diagnostics,
          activation,
          h('div', { className: 'agent-soul-actions' },
            h('button', {
              id: id('orchestrator-edit'),
              type: 'button',
              className: 'agent-soul-primary-button',
              onClick: function (event) { openOrchestrator(event.currentTarget) },
              disabled: busyLocked || orchestratorLoading,
              'aria-haspopup': 'dialog',
              'aria-expanded': dialogMode === 'orchestrator',
            }, t('orchestratorEditButton')),
            record.configured
              ? null
              : h('button', {
                type: 'button',
                className: 'agent-soul-secondary-button',
                onClick: function (event) { requestCreateDefaultOrchestrator(event.currentTarget) },
                disabled: busyLocked || orchestratorLoading,
              }, busy === 'orchestrator-create'
                ? t('creatingButton')
                : t('orchestratorCreateButton'))))
      })()

      const handleTabKeyDown = function (event, current) {
        if (event.defaultPrevented || event.isComposing
          || event.altKey || event.ctrlKey || event.metaKey) return
        let next = ''
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          next = current === 'souls' ? 'orchestrator' : 'souls'
        } else if (event.key === 'Home') {
          next = 'souls'
        } else if (event.key === 'End') {
          next = 'orchestrator'
        }
        if (next === '') return
        event.preventDefault()
        const destination = document.getElementById(baseId + '-tab-' + next)
        if (destination !== null && typeof destination.focus === 'function') destination.focus()
        // Arrow/Home/End activation has exactly the same unsaved-edit guard as
        // pointer activation; it never calls switchTab directly.
        requestTab(next)
      }

      const tabs = h('div', {
        className: 'agent-soul-tabs',
        role: 'tablist',
        'aria-label': t('title'),
      },
        h('button', {
          type: 'button',
          id: id('tab-souls'),
          className: 'agent-soul-tab',
          role: 'tab',
          tabIndex: activeTab === 'souls' ? 0 : -1,
          'aria-selected': activeTab === 'souls',
          'aria-controls': id('tabpanel-souls'),
          onKeyDown: function (event) { handleTabKeyDown(event, 'souls') },
          onClick: function () { requestTab('souls') },
        }, t('tabSouls')),
        h('button', {
          type: 'button',
          id: id('tab-orchestrator'),
          className: 'agent-soul-tab',
          role: 'tab',
          tabIndex: activeTab === 'orchestrator' ? 0 : -1,
          'aria-selected': activeTab === 'orchestrator',
          'aria-controls': id('tabpanel-orchestrator'),
          onKeyDown: function (event) { handleTabKeyDown(event, 'orchestrator') },
          onClick: function () { requestTab('orchestrator') },
        }, t('tabOrchestrator')))

      const pageNotices = h(React.Fragment, null,
        dialogMode === null ? statusLine : null,
        dialogMode === null ? guardBanner : null)

      return h(React.Fragment, null,
        h('style', { key: 'agent-soul-styles' }, STYLES),
        h('div', { className: 'agent-soul-page' },
          header,
          tabs,
          activeTab === 'souls'
            ? h('div', {
              id: id('tabpanel-souls'),
              className: 'agent-soul-tabpanel',
              role: 'tabpanel',
              'aria-labelledby': id('tab-souls'),
            },
              toolbar,
              pageNotices,
              undoBanner,
              overviewErrorCard,
              listCard,
              healthCard,
              infoCard,
            )
            : h('div', {
              id: id('tabpanel-orchestrator'),
              className: 'agent-soul-tabpanel',
              role: 'tabpanel',
              'aria-labelledby': id('tab-orchestrator'),
            },
              pageNotices,
              orchestratorPanel),
          dialog))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, {
            en: en,
            zh: zh,
            ja: ja,
            de: de,
            fr: fr,
            es: es,
            ru: ru,
            pt: pt,
          })
        }, 'dsh-agent-soul: settings page dictionaries')
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: SECTION_ID,
            order: 30,
            label: function () { return ctx.locale.bind(NS)('nav') },
            locale: NS,
          }, AgentSoulPage)
        })
        ctx.slots.inject('plugins.row.config', function () {
          return ctx.slots.register({
            name: 'plugins.row.config',
            key: PLUGIN_ROW_CONFIG_KEY,
            locale: NS,
          }, DefaultSoulsConfigEntry)
        })
        ctx.slots.inject('conversation.session.header.actions', function () {
          return ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: ORCHESTRATOR_BADGE_ID,
            order: -5,
            locale: NS,
          }, OrchestratorModeBadge)
        })
      },
    }
  },
})
