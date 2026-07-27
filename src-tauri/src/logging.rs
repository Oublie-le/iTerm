use chrono::{DateTime, Local};
use encoding_rs::{Decoder, Encoding};
use serde::Deserialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{BufWriter, Write},
    path::PathBuf,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLogRequest {
    pub session_id: String,
    pub session_name: String,
    pub mode: String,
    pub encoding: String,
    pub append: bool,
    #[serde(default)]
    pub max_file_size_mib: u64,
    #[serde(default = "default_rotate_count")]
    pub rotate_count: u32,
}

pub struct LogStartSpec {
    path: PathBuf,
    mode: LogMode,
    encoding: &'static Encoding,
    append: bool,
    max_bytes: Option<u64>,
    rotate_count: usize,
}

#[derive(Clone, Copy)]
enum LogMode {
    Raw,
    Text,
}

pub struct SessionLogger {
    writer: Option<BufWriter<File>>,
    mode: LogMode,
    decoder: Decoder,
    paused: bool,
    starts_new_line: bool,
    path: PathBuf,
    bytes_written: u64,
    max_bytes: Option<u64>,
    rotate_count: usize,
}

pub fn build_log_spec(app: &AppHandle, request: &StartLogRequest) -> Result<LogStartSpec, String> {
    let mode = match request.mode.as_str() {
        "raw" => LogMode::Raw,
        "text" => LogMode::Text,
        _ => return Err(format!("未知的日志模式：{}", request.mode)),
    };
    let label = request.encoding.trim().to_ascii_lowercase();
    let encoding = Encoding::for_label(label.as_bytes())
        .ok_or_else(|| format!("不支持字符编码：{}", request.encoding))?;
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("无法确定日志目录：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建日志目录：{error}"))?;
    let max_bytes = if request.max_file_size_mib == 0 {
        None
    } else {
        Some(
            request
                .max_file_size_mib
                .checked_mul(1024 * 1024)
                .ok_or_else(|| "日志文件大小限制过大。".to_string())?,
        )
    };
    Ok(LogStartSpec {
        path: directory.join(default_log_file_name(&request.session_name)),
        mode,
        encoding,
        append: request.append,
        max_bytes,
        rotate_count: request.rotate_count.min(20) as usize,
    })
}

impl SessionLogger {
    pub fn open(spec: LogStartSpec) -> Result<Self, String> {
        let mut options = OpenOptions::new();
        options.create(true).write(true);
        if spec.append {
            options.append(true);
        } else {
            options.truncate(true);
        }
        let file = options
            .open(&spec.path)
            .map_err(|error| format!("无法打开日志文件 {}：{error}", spec.path.display()))?;
        let bytes_written = if spec.append {
            file.metadata().map(|metadata| metadata.len()).unwrap_or(0)
        } else {
            0
        };
        Ok(Self {
            writer: Some(BufWriter::new(file)),
            mode: spec.mode,
            decoder: spec.encoding.new_decoder_without_bom_handling(),
            paused: false,
            starts_new_line: true,
            path: spec.path,
            bytes_written,
            max_bytes: spec.max_bytes,
            rotate_count: spec.rotate_count,
        })
    }

    pub fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.paused || bytes.is_empty() {
            return Ok(());
        }

        let payload = match self.mode {
            LogMode::Raw => bytes.to_vec(),
            LogMode::Text => {
                let capacity = self
                    .decoder
                    .max_utf8_buffer_length(bytes.len())
                    .ok_or_else(|| "接收数据过大，无法写入文本日志。".to_string())?;
                let mut decoded = String::with_capacity(capacity);
                let (_, read, _) = self.decoder.decode_to_string(bytes, &mut decoded, false);
                if read != bytes.len() {
                    return Err("文本日志解码缓冲区不足。".into());
                }
                let timestamp: DateTime<Local> = Local::now();
                let prefix = format!("[{}] ", timestamp.format("%Y-%m-%d %H:%M:%S%.3f"));
                let mut rendered = String::with_capacity(decoded.len() + prefix.len());
                for character in decoded.chars() {
                    if self.starts_new_line {
                        rendered.push_str(&prefix);
                        self.starts_new_line = false;
                    }
                    rendered.push(character);
                    if character == '\n' {
                        self.starts_new_line = true;
                    }
                }
                rendered.into_bytes()
            }
        };
        self.rotate_if_needed(payload.len() as u64)?;
        let writer = self
            .writer
            .as_mut()
            .ok_or_else(|| "日志文件已经关闭。".to_string())?;
        writer
            .write_all(&payload)
            .map_err(|error| format!("写入日志失败：{error}"))?;
        writer
            .flush()
            .map_err(|error| format!("刷新日志文件失败：{error}"))?;
        self.bytes_written = self.bytes_written.saturating_add(payload.len() as u64);
        Ok(())
    }

    pub fn path_string(&self) -> String {
        self.path.display().to_string()
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }

    pub fn finish(mut self) -> Result<(), String> {
        self.writer
            .take()
            .map(|mut writer| {
                writer
                    .flush()
                    .map_err(|error| format!("刷新日志文件失败：{error}"))
            })
            .unwrap_or(Ok(()))
    }

    fn rotate_if_needed(&mut self, incoming_bytes: u64) -> Result<(), String> {
        let Some(max_bytes) = self.max_bytes else {
            return Ok(());
        };
        if self.bytes_written == 0 || self.bytes_written.saturating_add(incoming_bytes) <= max_bytes
        {
            return Ok(());
        }
        if let Some(mut writer) = self.writer.take() {
            writer
                .flush()
                .map_err(|error| format!("轮转前刷新日志失败：{error}"))?;
        }
        rotate_files(&self.path, self.rotate_count)?;
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)
            .map_err(|error| format!("轮转后重新打开日志 {} 失败：{error}", self.path.display()))?;
        self.writer = Some(BufWriter::new(file));
        self.bytes_written = 0;
        Ok(())
    }
}

fn rotate_files(path: &PathBuf, rotate_count: usize) -> Result<(), String> {
    if rotate_count == 0 {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|error| format!("清理已满日志 {} 失败：{error}", path.display()))?;
        }
        return Ok(());
    }

    let oldest = rotated_path(path, rotate_count);
    if oldest.exists() {
        fs::remove_file(&oldest)
            .map_err(|error| format!("删除旧日志 {} 失败：{error}", oldest.display()))?;
    }
    for index in (1..rotate_count).rev() {
        let source = rotated_path(path, index);
        if source.exists() {
            let target = rotated_path(path, index + 1);
            fs::rename(&source, &target).map_err(|error| {
                format!(
                    "轮转日志 {} 到 {} 失败：{error}",
                    source.display(),
                    target.display()
                )
            })?;
        }
    }
    if path.exists() {
        let target = rotated_path(path, 1);
        fs::rename(path, &target).map_err(|error| {
            format!(
                "轮转日志 {} 到 {} 失败：{error}",
                path.display(),
                target.display()
            )
        })?;
    }
    Ok(())
}

fn rotated_path(path: &PathBuf, index: usize) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(format!(".{index}"));
    PathBuf::from(value)
}

const fn default_rotate_count() -> u32 {
    3
}

fn default_log_file_name(session_name: &str) -> String {
    let safe_name = sanitize_file_stem(session_name);
    format!(
        "{}_{}.log",
        safe_name,
        Local::now().format("%Y-%m-%d_%H-%M-%S")
    )
}

fn sanitize_file_stem(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = sanitized.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "serial".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_default_log_file_names() {
        let name = default_log_file_name("Board/COM:1?");
        assert!(name.starts_with("Board_COM_1_"));
        assert!(name.ends_with(".log"));
        assert_eq!(sanitize_file_stem(" ... "), "serial");
    }

    #[test]
    fn raw_logger_preserves_every_byte() {
        let path = temporary_log_path("raw");
        let mut logger = SessionLogger::open(LogStartSpec {
            path: path.clone(),
            mode: LogMode::Raw,
            encoding: encoding_rs::UTF_8,
            append: false,
            max_bytes: None,
            rotate_count: 3,
        })
        .unwrap();
        logger.write(&[0x00, 0xff, 0x0d, 0x0a]).unwrap();
        drop(logger);

        assert_eq!(fs::read(&path).unwrap(), [0x00, 0xff, 0x0d, 0x0a]);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn text_logger_decodes_multibyte_characters_across_chunks() {
        let path = temporary_log_path("text");
        let mut logger = SessionLogger::open(LogStartSpec {
            path: path.clone(),
            mode: LogMode::Text,
            encoding: Encoding::for_label(b"gbk").unwrap(),
            append: false,
            max_bytes: None,
            rotate_count: 3,
        })
        .unwrap();
        logger.write(&[0xc4]).unwrap();
        logger.write(&[0xe3, b'\n']).unwrap();
        drop(logger);

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("你\n"));
        assert_eq!(content.matches('[').count(), 1);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rotates_logs_at_the_configured_size() {
        let path = temporary_log_path("rotate");
        let mut logger = SessionLogger::open(LogStartSpec {
            path: path.clone(),
            mode: LogMode::Raw,
            encoding: encoding_rs::UTF_8,
            append: false,
            max_bytes: Some(4),
            rotate_count: 2,
        })
        .unwrap();

        logger.write(b"abcd").unwrap();
        logger.write(b"e").unwrap();
        logger.write(b"fghi").unwrap();
        logger.finish().unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"fghi");
        assert_eq!(fs::read(rotated_path(&path, 1)).unwrap(), b"e");
        assert_eq!(fs::read(rotated_path(&path, 2)).unwrap(), b"abcd");
        fs::remove_file(&path).unwrap();
        fs::remove_file(rotated_path(&path, 1)).unwrap();
        fs::remove_file(rotated_path(&path, 2)).unwrap();
    }

    fn temporary_log_path(label: &str) -> PathBuf {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        std::env::temp_dir().join(format!(
            "iterm-{label}-{}-{}.log",
            std::process::id(),
            timestamp
        ))
    }
}
