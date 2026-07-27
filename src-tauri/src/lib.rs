mod logging;
mod process;
mod serial;

use process::ProcessRegistry;
use serial::SerialRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SerialRegistry::default())
        .manage(ProcessRegistry::default())
        .invoke_handler(tauri::generate_handler![
            process::open_ssh_session,
            process::list_adb_devices,
            process::open_adb_session,
            process::close_process_session,
            process::write_process_bytes,
            serial::list_serial_ports,
            serial::open_serial_session,
            serial::close_serial_session,
            serial::write_serial_text,
            serial::write_serial_text_many,
            serial::write_serial_bytes,
            serial::set_serial_signal,
            serial::send_serial_break,
            serial::clear_serial_buffers,
            serial::start_serial_log,
            serial::set_serial_log_paused,
            serial::stop_serial_log,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run iTerm");
}
