var MessageTarget = /* @__PURE__ */ ((MessageTarget2) => {
  MessageTarget2["Offscreen"] = "offscreen";
  MessageTarget2["ContentScript"] = "content_script";
  MessageTarget2["Background"] = "background";
  return MessageTarget2;
})(MessageTarget || {});
const BACKGROUND_MESSAGE_TYPES = {
  SWITCH_SEMANTIC_MODEL: "switch_semantic_model",
  GET_MODEL_STATUS: "get_model_status",
  UPDATE_MODEL_STATUS: "update_model_status",
  GET_STORAGE_STATS: "get_storage_stats",
  CLEAR_ALL_DATA: "clear_all_data",
  GET_SERVER_STATUS: "get_server_status",
  REFRESH_SERVER_STATUS: "refresh_server_status",
  SERVER_STATUS_CHANGED: "server_status_changed",
  INITIALIZE_SEMANTIC_ENGINE: "initialize_semantic_engine",
  // Record & Replay background control and queries
  RR_START_RECORDING: "rr_start_recording",
  RR_STOP_RECORDING: "rr_stop_recording",
  RR_PAUSE_RECORDING: "rr_pause_recording",
  RR_RESUME_RECORDING: "rr_resume_recording",
  RR_GET_RECORDING_STATUS: "rr_get_recording_status",
  RR_LIST_FLOWS: "rr_list_flows",
  RR_FLOWS_CHANGED: "rr_flows_changed",
  RR_GET_FLOW: "rr_get_flow",
  RR_DELETE_FLOW: "rr_delete_flow",
  RR_PUBLISH_FLOW: "rr_publish_flow",
  RR_UNPUBLISH_FLOW: "rr_unpublish_flow",
  RR_RUN_FLOW: "rr_run_flow",
  RR_SAVE_FLOW: "rr_save_flow",
  RR_EXPORT_FLOW: "rr_export_flow",
  RR_EXPORT_ALL: "rr_export_all",
  RR_IMPORT_FLOW: "rr_import_flow",
  RR_LIST_RUNS: "rr_list_runs",
  // Triggers
  RR_LIST_TRIGGERS: "rr_list_triggers",
  RR_SAVE_TRIGGER: "rr_save_trigger",
  RR_DELETE_TRIGGER: "rr_delete_trigger",
  RR_REFRESH_TRIGGERS: "rr_refresh_triggers",
  // Scheduling
  RR_SCHEDULE_FLOW: "rr_schedule_flow",
  RR_UNSCHEDULE_FLOW: "rr_unschedule_flow",
  RR_LIST_SCHEDULES: "rr_list_schedules",
  // Element marker management
  ELEMENT_MARKER_LIST_ALL: "element_marker_list_all",
  ELEMENT_MARKER_LIST_FOR_URL: "element_marker_list_for_url",
  ELEMENT_MARKER_SAVE: "element_marker_save",
  ELEMENT_MARKER_UPDATE: "element_marker_update",
  ELEMENT_MARKER_DELETE: "element_marker_delete",
  ELEMENT_MARKER_VALIDATE: "element_marker_validate",
  ELEMENT_MARKER_START: "element_marker_start_from_popup",
  // Element picker (human-in-the-loop element selection)
  ELEMENT_PICKER_UI_EVENT: "element_picker_ui_event",
  ELEMENT_PICKER_FRAME_EVENT: "element_picker_frame_event",
  // Web editor (in-page visual editing)
  WEB_EDITOR_TOGGLE: "web_editor_toggle",
  WEB_EDITOR_APPLY: "web_editor_apply",
  WEB_EDITOR_STATUS_QUERY: "web_editor_status_query",
  // Web editor <-> AgentChat integration (Phase 1.1)
  WEB_EDITOR_APPLY_BATCH: "web_editor_apply_batch",
  WEB_EDITOR_TX_CHANGED: "web_editor_tx_changed",
  WEB_EDITOR_HIGHLIGHT_ELEMENT: "web_editor_highlight_element",
  // Web editor <-> AgentChat integration (Phase 2 - Revert)
  WEB_EDITOR_REVERT_ELEMENT: "web_editor_revert_element",
  // Web editor <-> AgentChat integration - Selection sync
  WEB_EDITOR_SELECTION_CHANGED: "web_editor_selection_changed",
  // Web editor <-> AgentChat integration - Clear selection (sidepanel -> web-editor)
  WEB_EDITOR_CLEAR_SELECTION: "web_editor_clear_selection",
  // Web editor <-> AgentChat integration - Cancel execution
  WEB_EDITOR_CANCEL_EXECUTION: "web_editor_cancel_execution",
  // Web editor props (Phase 7.1.6 early injection)
  WEB_EDITOR_PROPS_REGISTER_EARLY_INJECTION: "web_editor_props_register_early_injection",
  // Web editor props - open source file in VSCode
  WEB_EDITOR_OPEN_SOURCE: "web_editor_open_source",
  // Quick Panel <-> AgentChat integration
  QUICK_PANEL_SEND_TO_AI: "quick_panel_send_to_ai",
  QUICK_PANEL_CANCEL_AI: "quick_panel_cancel_ai",
  // Quick Panel Search - Tabs bridge
  QUICK_PANEL_TABS_QUERY: "quick_panel_tabs_query",
  QUICK_PANEL_TAB_ACTIVATE: "quick_panel_tab_activate",
  QUICK_PANEL_TAB_CLOSE: "quick_panel_tab_close"
};
const OFFSCREEN_MESSAGE_TYPES = {
  SIMILARITY_ENGINE_INIT: "similarityEngineInit",
  SIMILARITY_ENGINE_COMPUTE: "similarityEngineCompute",
  SIMILARITY_ENGINE_BATCH_COMPUTE: "similarityEngineBatchCompute",
  SIMILARITY_ENGINE_STATUS: "similarityEngineStatus",
  // GIF encoding
  GIF_ADD_FRAME: "gifAddFrame",
  GIF_FINISH: "gifFinish",
  GIF_RESET: "gifReset"
};
var SendMessageType = /* @__PURE__ */ ((SendMessageType2) => {
  SendMessageType2["ScreenshotPreparePageForCapture"] = "preparePageForCapture";
  SendMessageType2["ScreenshotGetPageDetails"] = "getPageDetails";
  SendMessageType2["ScreenshotGetElementDetails"] = "getElementDetails";
  SendMessageType2["ScreenshotScrollPage"] = "scrollPage";
  SendMessageType2["ScreenshotResetPageAfterCapture"] = "resetPageAfterCapture";
  SendMessageType2["WebFetcherGetHtmlContent"] = "getHtmlContent";
  SendMessageType2["WebFetcherGetTextContent"] = "getTextContent";
  SendMessageType2["ClickElement"] = "clickElement";
  SendMessageType2["FillElement"] = "fillElement";
  SendMessageType2["GetInteractiveElements"] = "getInteractiveElements";
  SendMessageType2["NetworkSendRequest"] = "sendPureNetworkRequest";
  SendMessageType2["SimulateKeyboard"] = "simulateKeyboard";
  SendMessageType2["SimilarityEngineInit"] = "similarityEngineInit";
  SendMessageType2["SimilarityEngineComputeBatch"] = "similarityEngineComputeBatch";
  return SendMessageType2;
})(SendMessageType || {});
export {
  BACKGROUND_MESSAGE_TYPES as B,
  MessageTarget as M,
  OFFSCREEN_MESSAGE_TYPES as O,
  SendMessageType as S
};
