mod debug_timing;
mod logging;
mod process;
mod serial;
mod storage;

use debug_timing::DebugTimer;
use process::ProcessRegistry;
use serial::SerialRegistry;
use storage::PersistentStore;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _run_timer = DebugTimer::start("app_run");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let _setup_timer = DebugTimer::start("app_setup");
            let store = PersistentStore::open(app.handle()).map_err(std::io::Error::other)?;
            app.manage(store);
            Ok(())
        })
        .manage(SerialRegistry::default())
        .manage(ProcessRegistry::default())
        .invoke_handler(tauri::generate_handler![
            logging::open_log_directory,
            logging::open_log_file,
            process::open_ssh_session,
            process::list_external_tools,
            process::list_ssh_config_hosts,
            process::list_adb_devices,
            process::open_adb_session,
            process::close_process_session,
            process::resize_process_session,
            process::write_process_bytes,
            process::start_process_log,
            process::set_process_log_paused,
            process::stop_process_log,
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
            storage::load_persistent_items,
            storage::save_persistent_items,
            storage::remove_persistent_item,
            storage::clear_persistent_items,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run iTerm");
}
