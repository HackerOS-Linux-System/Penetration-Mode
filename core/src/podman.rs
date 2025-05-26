pub fn cleanup_tmp_session(session_id: &str) {
    let session_dir = format!("/tmp/penmode-session-{}", session_id);
    std::fs::remove_dir_all(&session_dir).ok();
}
