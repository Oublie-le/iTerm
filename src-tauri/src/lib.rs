mod serial;

use serial::SerialRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SerialRegistry::default())
        .invoke_handler(tauri::generate_handler![
            serial::list_serial_ports,
            serial::open_serial_session,
            serial::close_serial_session,
            serial::write_serial_text,
            serial::write_serial_text_many,
            serial::write_serial_bytes,
            serial::set_serial_signal,
            serial::send_serial_break,
            serial::start_serial_log,
            serial::set_serial_log_paused,
            serial::stop_serial_log,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run iTerm");
}
