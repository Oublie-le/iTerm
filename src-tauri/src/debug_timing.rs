#[cfg(debug_assertions)]
use std::{
    fs::{File, OpenOptions},
    io::Write,
    sync::{Mutex, OnceLock},
    time::Instant,
};

#[cfg(debug_assertions)]
static DEBUG_LOG_FILE: OnceLock<Option<Mutex<File>>> = OnceLock::new();

#[cfg(debug_assertions)]
pub(crate) struct DebugTimer {
    name: String,
    started: Instant,
}

#[cfg(not(debug_assertions))]
pub(crate) struct DebugTimer;

impl DebugTimer {
    #[cfg(debug_assertions)]
    pub(crate) fn start(name: impl Into<String>) -> Self {
        let name = name.into();
        write_debug_line(&format!(
            "[iterm-debug] operation={name} phase=start thread={:?}",
            std::thread::current().id()
        ));
        Self {
            name,
            started: Instant::now(),
        }
    }

    #[cfg(not(debug_assertions))]
    pub(crate) fn start(_name: impl Into<String>) -> Self {
        Self
    }
}

#[cfg(debug_assertions)]
impl Drop for DebugTimer {
    fn drop(&mut self) {
        write_debug_line(&format!(
            "[iterm-debug] operation={} phase=end elapsed_ms={} thread={:?}",
            self.name,
            self.started.elapsed().as_millis(),
            std::thread::current().id()
        ));
    }
}

#[cfg(debug_assertions)]
fn write_debug_line(line: &str) {
    eprintln!("{line}");
    let file = DEBUG_LOG_FILE.get_or_init(|| {
        let path = std::env::temp_dir().join(format!("iterm-debug-{}.log", std::process::id()));
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()
            .map(Mutex::new)
    });
    if let Some(file) = file {
        if let Ok(mut file) = file.lock() {
            let _ = writeln!(file, "{line}");
        }
    }
}
