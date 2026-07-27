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
}

pub struct LogStartSpec {
    path: PathBuf,
    mode: LogMode,
    encoding: &'static Encoding,
    append: bool,
}

#[derive(Clone, Copy)]
enum LogMode {
    Raw,
    Text,
}

pub struct SessionLogger {
    writer: BufWriter<File>,
    mode: LogMode,
    decoder: Decoder,
    paused: bool,
    starts_new_line: bool,
    path: PathBuf,
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
    Ok(LogStartSpec {
        path: directory.join(default_log_file_name(&request.session_name)),
        mode,
        encoding,
        append: request.append,
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
        Ok(Self {
            writer: BufWriter::new(file),
            mode: spec.mode,
            decoder: spec.encoding.new_decoder_without_bom_handling(),
            paused: false,
            starts_new_line: true,
            path: spec.path,
        })
    }

    pub fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.paused || bytes.is_empty() {
            return Ok(());
        }

        match self.mode {
            LogMode::Raw => self
                .writer
                .write_all(bytes)
                .map_err(|error| format!("写入原始日志失败：{error}"))?,
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
                self.writer
                    .write_all(rendered.as_bytes())
                    .map_err(|error| format!("写入文本日志失败：{error}"))?;
            }
        }
        self.writer
            .flush()
            .map_err(|error| format!("刷新日志文件失败：{error}"))
    }

    pub fn path_string(&self) -> String {
        self.path.display().to_string()
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }

    pub fn finish(mut self) -> Result<(), String> {
        self.writer
            .flush()
            .map_err(|error| format!("刷新日志文件失败：{error}"))
    }
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
