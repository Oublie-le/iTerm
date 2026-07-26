use chrono::{DateTime, Local};
use encoding_rs::{Decoder, Encoding};
use serde::{Deserialize, Serialize};
use serialport::{
    ClearBuffer, DataBits, FlowControl, Parity, SerialPort, SerialPortType, StopBits,
};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, BufWriter, Read, Write},
    path::PathBuf,
    sync::{
        mpsc::{self, Receiver, Sender, TryRecvError},
        Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, AppHandle, Manager, State};

const WRITE_REPLY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct SerialRegistry {
    sessions: Mutex<HashMap<String, SessionHandle>>,
}

struct SessionHandle {
    port_path: String,
    commands: Sender<SessionCommand>,
}

enum SessionCommand {
    Write(Vec<u8>, Sender<Result<usize, String>>),
    SetDtr(bool, Sender<Result<(), String>>),
    SetRts(bool, Sender<Result<(), String>>),
    Break(u64, Sender<Result<(), String>>),
    Clear(ClearBuffer, Sender<Result<(), String>>),
    StartLog(LogStartSpec, Sender<Result<String, String>>),
    SetLogPaused(bool, Sender<Result<(), String>>),
    StopLog(Sender<Result<(), String>>),
    Close,
}

struct LogStartSpec {
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

struct SessionLogger {
    writer: BufWriter<File>,
    mode: LogMode,
    decoder: Decoder,
    paused: bool,
    starts_new_line: bool,
    path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortDescriptor {
    path: String,
    display_name: String,
    port_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    vid: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    product: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionRequest {
    session_id: String,
    #[allow(dead_code)]
    profile_id: String,
    port_path: String,
    baud_rate: u32,
    data_bits: u8,
    parity: String,
    stop_bits: String,
    flow_control: String,
    read_timeout_ms: u64,
    dtr_on_open: bool,
    rts_on_open: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextRequest {
    session_id: String,
    text: String,
    encoding: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextManyRequest {
    session_ids: Vec<String>,
    text: String,
    encoding: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    session_id: String,
    byte_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteBytesRequest {
    session_id: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLogRequest {
    session_id: String,
    session_name: String,
    mode: String,
    encoding: String,
    append: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SerialEvent {
    State {
        #[serde(rename = "sessionId")]
        session_id: String,
        state: ConnectionState,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Data {
        #[serde(rename = "sessionId")]
        session_id: String,
        sequence: u64,
        #[serde(rename = "receivedAtMs")]
        received_at_ms: u128,
        bytes: Vec<u8>,
    },
    Error {
        #[serde(rename = "sessionId")]
        session_id: String,
        code: String,
        message: String,
        recoverable: bool,
    },
    Log {
        #[serde(rename = "sessionId")]
        session_id: String,
        state: LogState,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Disconnected,
    Opening,
    Connected,
    DeviceLost,
    Error,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LogState {
    Recording,
    Paused,
    Stopped,
    Error,
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortDescriptor>, String> {
    let ports =
        serialport::available_ports().map_err(|error| format!("无法枚举串口设备：{error}"))?;

    Ok(ports
        .into_iter()
        .map(|port| {
            let fallback_name = port
                .port_name
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(&port.port_name)
                .to_string();

            match port.port_type {
                SerialPortType::UsbPort(info) => SerialPortDescriptor {
                    path: port.port_name,
                    display_name: info
                        .product
                        .clone()
                        .or_else(|| info.manufacturer.clone())
                        .unwrap_or(fallback_name),
                    port_type: "usb".into(),
                    vid: Some(info.vid),
                    pid: Some(info.pid),
                    serial_number: info.serial_number,
                    manufacturer: info.manufacturer,
                    product: info.product,
                },
                SerialPortType::PciPort => SerialPortDescriptor {
                    path: port.port_name,
                    display_name: fallback_name,
                    port_type: "pci".into(),
                    vid: None,
                    pid: None,
                    serial_number: None,
                    manufacturer: None,
                    product: None,
                },
                SerialPortType::BluetoothPort => SerialPortDescriptor {
                    path: port.port_name,
                    display_name: fallback_name,
                    port_type: "bluetooth".into(),
                    vid: None,
                    pid: None,
                    serial_number: None,
                    manufacturer: None,
                    product: None,
                },
                SerialPortType::Unknown => SerialPortDescriptor {
                    path: port.port_name,
                    display_name: fallback_name,
                    port_type: "unknown".into(),
                    vid: None,
                    pid: None,
                    serial_number: None,
                    manufacturer: None,
                    product: None,
                },
            }
        })
        .collect())
}

#[tauri::command]
pub fn open_serial_session(
    request: OpenSessionRequest,
    on_event: Channel<SerialEvent>,
    registry: State<'_, SerialRegistry>,
) -> Result<(), String> {
    if request.port_path.trim().is_empty() {
        return Err("串口路径不能为空。".into());
    }

    {
        let sessions = registry
            .sessions
            .lock()
            .map_err(|_| "串口会话注册表已损坏。")?;
        if sessions.contains_key(&request.session_id) {
            return Err("该会话已打开，请先断开后再重连。".into());
        }
        if sessions
            .values()
            .any(|handle| handle.port_path == request.port_path)
        {
            return Err(format!("串口 {} 已被另一个会话占用。", request.port_path));
        }
    }

    send_event(
        &on_event,
        SerialEvent::State {
            session_id: request.session_id.clone(),
            state: ConnectionState::Opening,
            message: Some(format!("正在打开 {}…", request.port_path)),
        },
    );

    let data_bits = parse_data_bits(request.data_bits)?;
    let parity = parse_parity(&request.parity)?;
    let stop_bits = parse_stop_bits(&request.stop_bits)?;
    let flow_control = parse_flow_control(&request.flow_control)?;
    let read_timeout = Duration::from_millis(request.read_timeout_ms.clamp(1, 2_000));

    let mut port = serialport::new(&request.port_path, request.baud_rate)
        .data_bits(data_bits)
        .parity(parity)
        .stop_bits(stop_bits)
        .flow_control(flow_control)
        .timeout(read_timeout)
        .open()
        .map_err(|error| format!("无法打开串口 {}：{error}", request.port_path))?;

    port.write_data_terminal_ready(request.dtr_on_open)
        .map_err(|error| format!("设置 DTR 失败：{error}"))?;
    port.write_request_to_send(request.rts_on_open)
        .map_err(|error| format!("设置 RTS 失败：{error}"))?;

    let (command_tx, command_rx) = mpsc::channel();
    registry
        .sessions
        .lock()
        .map_err(|_| "串口会话注册表已损坏。")?
        .insert(
            request.session_id.clone(),
            SessionHandle {
                port_path: request.port_path.clone(),
                commands: command_tx,
            },
        );

    let session_id = request.session_id;
    let port_path = request.port_path;
    thread::Builder::new()
        .name(format!("serial-{session_id}"))
        .spawn(move || serial_worker(session_id, port_path, port, command_rx, on_event))
        .map_err(|error| format!("无法启动串口读取线程：{error}"))?;

    Ok(())
}

#[tauri::command]
pub fn close_serial_session(
    session_id: String,
    registry: State<'_, SerialRegistry>,
) -> Result<(), String> {
    let handle = registry
        .sessions
        .lock()
        .map_err(|_| "串口会话注册表已损坏。")?
        .remove(&session_id);

    if let Some(handle) = handle {
        let _ = handle.commands.send(SessionCommand::Close);
    }
    Ok(())
}

#[tauri::command]
pub fn write_serial_text(
    request: WriteTextRequest,
    registry: State<'_, SerialRegistry>,
) -> Result<usize, String> {
    let payload = encode_text(&request.text, &request.encoding)?;
    write_bytes(&registry, &request.session_id, payload)
}

#[tauri::command]
pub fn write_serial_text_many(
    request: WriteTextManyRequest,
    registry: State<'_, SerialRegistry>,
) -> Result<Vec<WriteResult>, String> {
    let payload = encode_text(&request.text, &request.encoding)?;
    let mut results = Vec::with_capacity(request.session_ids.len());
    for session_id in request.session_ids {
        let byte_count = write_bytes(&registry, &session_id, payload.clone())?;
        results.push(WriteResult {
            session_id,
            byte_count,
        });
    }
    Ok(results)
}

#[tauri::command]
pub fn write_serial_bytes(
    request: WriteBytesRequest,
    registry: State<'_, SerialRegistry>,
) -> Result<usize, String> {
    write_bytes(&registry, &request.session_id, request.bytes)
}

#[tauri::command]
pub fn set_serial_signal(
    session_id: String,
    signal: String,
    enabled: bool,
    registry: State<'_, SerialRegistry>,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    let command = match signal.as_str() {
        "dtr" => SessionCommand::SetDtr(enabled, reply_tx),
        "rts" => SessionCommand::SetRts(enabled, reply_tx),
        _ => return Err(format!("未知的串口信号：{signal}")),
    };
    send_command(&registry, &session_id, command)?;
    receive_reply(reply_rx, "设置信号")
}

#[tauri::command]
pub fn send_serial_break(
    session_id: String,
    duration_ms: u64,
    registry: State<'_, SerialRegistry>,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    send_command(
        &registry,
        &session_id,
        SessionCommand::Break(duration_ms.clamp(1, 5_000), reply_tx),
    )?;
    receive_reply(reply_rx, "发送 Break")
}

#[tauri::command]
pub fn clear_serial_buffers(
    session_id: String,
    target: String,
    registry: State<'_, SerialRegistry>,
) -> Result<(), String> {
    let buffer = parse_clear_buffer(&target)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    send_command(
        &registry,
        &session_id,
        SessionCommand::Clear(buffer, reply_tx),
    )?;
    receive_reply(reply_rx, "清空串口缓冲")
}

#[tauri::command]
pub fn start_serial_log(
    request: StartLogRequest,
    app: AppHandle,
    registry: State<'_, SerialRegistry>,
) -> Result<String, String> {
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
    let path = directory.join(default_log_file_name(&request.session_name));

    let (reply_tx, reply_rx) = mpsc::channel();
    send_command(
        &registry,
        &request.session_id,
        SessionCommand::StartLog(
            LogStartSpec {
                path,
                mode,
                encoding,
                append: request.append,
            },
            reply_tx,
        ),
    )?;
    receive_reply(reply_rx, "开始日志")
}

#[tauri::command]
pub fn set_serial_log_paused(
    session_id: String,
    paused: bool,
    registry: State<'_, SerialRegistry>,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    send_command(
        &registry,
        &session_id,
        SessionCommand::SetLogPaused(paused, reply_tx),
    )?;
    receive_reply(
        reply_rx,
        if paused {
            "暂停日志"
        } else {
            "继续日志"
        },
    )
}

#[tauri::command]
pub fn stop_serial_log(
    session_id: String,
    registry: State<'_, SerialRegistry>,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    send_command(&registry, &session_id, SessionCommand::StopLog(reply_tx))?;
    receive_reply(reply_rx, "停止日志")
}

fn serial_worker(
    session_id: String,
    port_path: String,
    mut port: Box<dyn SerialPort>,
    commands: Receiver<SessionCommand>,
    on_event: Channel<SerialEvent>,
) {
    send_event(
        &on_event,
        SerialEvent::State {
            session_id: session_id.clone(),
            state: ConnectionState::Connected,
            message: Some(format!("{port_path} 已连接")),
        },
    );

    let mut sequence = 0_u64;
    let mut buffer = vec![0_u8; 16 * 1024];
    let mut logger: Option<SessionLogger> = None;

    loop {
        loop {
            match commands.try_recv() {
                Ok(command) => {
                    if handle_command(command, port.as_mut(), &mut logger, &session_id, &on_event) {
                        send_event(
                            &on_event,
                            SerialEvent::State {
                                session_id: session_id.clone(),
                                state: ConnectionState::Disconnected,
                                message: Some("串口会话已关闭。".into()),
                            },
                        );
                        if let Some(mut active_logger) = logger.take() {
                            let _ = active_logger.writer.flush();
                        }
                        let _ = port.clear(ClearBuffer::All);
                        return;
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }

        match port.read(&mut buffer) {
            Ok(0) => {}
            Ok(count) => {
                sequence += 1;
                if let Some(active_logger) = logger.as_mut() {
                    if let Err(error) = active_logger.write(&buffer[..count]) {
                        let path = active_logger.path.display().to_string();
                        logger = None;
                        send_event(
                            &on_event,
                            SerialEvent::Log {
                                session_id: session_id.clone(),
                                state: LogState::Error,
                                path: Some(path),
                                message: Some(error),
                            },
                        );
                    }
                }
                send_event(
                    &on_event,
                    SerialEvent::Data {
                        session_id: session_id.clone(),
                        sequence,
                        received_at_ms: unix_time_ms(),
                        bytes: buffer[..count].to_vec(),
                    },
                );
            }
            Err(error)
                if error.kind() == io::ErrorKind::TimedOut
                    || error.kind() == io::ErrorKind::WouldBlock => {}
            Err(error) => {
                let recoverable = matches!(
                    error.kind(),
                    io::ErrorKind::NotFound
                        | io::ErrorKind::BrokenPipe
                        | io::ErrorKind::UnexpectedEof
                        | io::ErrorKind::ConnectionReset
                        | io::ErrorKind::ConnectionAborted
                );
                send_event(
                    &on_event,
                    SerialEvent::Error {
                        session_id: session_id.clone(),
                        code: if recoverable {
                            "DEVICE_LOST".into()
                        } else {
                            "READ_FAILED".into()
                        },
                        message: format!("读取串口 {port_path} 失败：{error}"),
                        recoverable,
                    },
                );
                send_event(
                    &on_event,
                    SerialEvent::State {
                        session_id: session_id.clone(),
                        state: if recoverable {
                            ConnectionState::DeviceLost
                        } else {
                            ConnectionState::Error
                        },
                        message: Some("串口读取已停止。".into()),
                    },
                );
                return;
            }
        }
    }
}

fn handle_command(
    command: SessionCommand,
    port: &mut dyn SerialPort,
    logger: &mut Option<SessionLogger>,
    session_id: &str,
    on_event: &Channel<SerialEvent>,
) -> bool {
    match command {
        SessionCommand::Write(bytes, reply) => {
            let result = port
                .write_all(&bytes)
                .and_then(|_| port.flush())
                .map(|_| bytes.len())
                .map_err(|error| format!("写入串口失败：{error}"));
            let _ = reply.send(result);
            false
        }
        SessionCommand::SetDtr(enabled, reply) => {
            let result = port
                .write_data_terminal_ready(enabled)
                .map_err(|error| format!("设置 DTR 失败：{error}"));
            let _ = reply.send(result);
            false
        }
        SessionCommand::SetRts(enabled, reply) => {
            let result = port
                .write_request_to_send(enabled)
                .map_err(|error| format!("设置 RTS 失败：{error}"));
            let _ = reply.send(result);
            false
        }
        SessionCommand::Break(duration_ms, reply) => {
            let result = port
                .set_break()
                .map_err(|error| format!("设置 Break 失败：{error}"))
                .and_then(|_| {
                    thread::sleep(Duration::from_millis(duration_ms));
                    port.clear_break()
                        .map_err(|error| format!("清除 Break 失败：{error}"))
                });
            let _ = reply.send(result);
            false
        }
        SessionCommand::Clear(buffer, reply) => {
            let result = port
                .clear(buffer)
                .map_err(|error| format!("清空串口缓冲失败：{error}"));
            let _ = reply.send(result);
            false
        }
        SessionCommand::StartLog(spec, reply) => {
            let result = SessionLogger::open(spec).map(|new_logger| {
                let path = new_logger.path.display().to_string();
                *logger = Some(new_logger);
                send_event(
                    on_event,
                    SerialEvent::Log {
                        session_id: session_id.to_string(),
                        state: LogState::Recording,
                        path: Some(path.clone()),
                        message: None,
                    },
                );
                path
            });
            let _ = reply.send(result);
            false
        }
        SessionCommand::SetLogPaused(paused, reply) => {
            let result = logger
                .as_mut()
                .ok_or_else(|| "当前会话没有活动日志。".to_string())
                .map(|active_logger| {
                    active_logger.paused = paused;
                    send_event(
                        on_event,
                        SerialEvent::Log {
                            session_id: session_id.to_string(),
                            state: if paused {
                                LogState::Paused
                            } else {
                                LogState::Recording
                            },
                            path: Some(active_logger.path.display().to_string()),
                            message: None,
                        },
                    );
                });
            let _ = reply.send(result);
            false
        }
        SessionCommand::StopLog(reply) => {
            let result = if let Some(mut active_logger) = logger.take() {
                active_logger
                    .writer
                    .flush()
                    .map_err(|error| format!("刷新日志文件失败：{error}"))
            } else {
                Ok(())
            };
            if result.is_ok() {
                send_event(
                    on_event,
                    SerialEvent::Log {
                        session_id: session_id.to_string(),
                        state: LogState::Stopped,
                        path: None,
                        message: None,
                    },
                );
            }
            let _ = reply.send(result);
            false
        }
        SessionCommand::Close => true,
    }
}

impl SessionLogger {
    fn open(spec: LogStartSpec) -> Result<Self, String> {
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

    fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
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

fn write_bytes(
    registry: &State<'_, SerialRegistry>,
    session_id: &str,
    bytes: Vec<u8>,
) -> Result<usize, String> {
    if bytes.is_empty() {
        return Ok(0);
    }
    let (reply_tx, reply_rx) = mpsc::channel();
    send_command(registry, session_id, SessionCommand::Write(bytes, reply_tx))?;
    receive_reply(reply_rx, "写入串口")
}

fn encode_text(text: &str, encoding_label: &str) -> Result<Vec<u8>, String> {
    let label = encoding_label.trim().to_ascii_lowercase();
    let encoding = Encoding::for_label(label.as_bytes())
        .ok_or_else(|| format!("不支持字符编码：{encoding_label}"))?;
    let (payload, _, had_errors) = encoding.encode(text);
    if had_errors {
        return Err(format!("文本包含无法由 {encoding_label} 表示的字符。"));
    }
    Ok(payload.into_owned())
}

fn send_command(
    registry: &State<'_, SerialRegistry>,
    session_id: &str,
    command: SessionCommand,
) -> Result<(), String> {
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| "串口会话注册表已损坏。")?;
    let handle = sessions
        .get(session_id)
        .ok_or_else(|| "串口会话不存在或已经关闭。".to_string())?;
    handle
        .commands
        .send(command)
        .map_err(|_| "串口读取线程已经退出，请重新连接。".into())
}

fn receive_reply<T>(receiver: Receiver<Result<T, String>>, action: &str) -> Result<T, String> {
    receiver
        .recv_timeout(WRITE_REPLY_TIMEOUT)
        .map_err(|_| format!("{action}超时。"))?
}

fn send_event(channel: &Channel<SerialEvent>, event: SerialEvent) {
    let _ = channel.send(event);
}

fn parse_data_bits(value: u8) -> Result<DataBits, String> {
    match value {
        5 => Ok(DataBits::Five),
        6 => Ok(DataBits::Six),
        7 => Ok(DataBits::Seven),
        8 => Ok(DataBits::Eight),
        _ => Err(format!("不支持的数据位：{value}")),
    }
}

fn parse_parity(value: &str) -> Result<Parity, String> {
    match value {
        "none" => Ok(Parity::None),
        "odd" => Ok(Parity::Odd),
        "even" => Ok(Parity::Even),
        "mark" | "space" => Err(format!(
            "当前串口库不支持 {} 校验，请选择 none、odd 或 even。",
            value
        )),
        _ => Err(format!("未知的校验方式：{value}")),
    }
}

fn parse_stop_bits(value: &str) -> Result<StopBits, String> {
    match value {
        "1" => Ok(StopBits::One),
        "2" => Ok(StopBits::Two),
        "1.5" => Err("当前串口库不支持 1.5 个停止位。".into()),
        _ => Err(format!("未知的停止位：{value}")),
    }
}

fn parse_flow_control(value: &str) -> Result<FlowControl, String> {
    match value {
        "none" => Ok(FlowControl::None),
        "hardware" => Ok(FlowControl::Hardware),
        "software" => Ok(FlowControl::Software),
        _ => Err(format!("未知的流控方式：{value}")),
    }
}

fn parse_clear_buffer(value: &str) -> Result<ClearBuffer, String> {
    match value {
        "input" => Ok(ClearBuffer::Input),
        "output" => Ok(ClearBuffer::Output),
        "all" => Ok(ClearBuffer::All),
        _ => Err(format!("未知的串口缓冲区：{value}")),
    }
}

fn unix_time_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_line_settings() {
        assert!(matches!(parse_data_bits(8), Ok(DataBits::Eight)));
        assert!(matches!(parse_parity("even"), Ok(Parity::Even)));
        assert!(matches!(parse_stop_bits("2"), Ok(StopBits::Two)));
        assert!(matches!(
            parse_flow_control("hardware"),
            Ok(FlowControl::Hardware)
        ));
        assert!(matches!(parse_clear_buffer("all"), Ok(ClearBuffer::All)));
    }

    #[test]
    fn rejects_platform_dependent_settings() {
        assert!(parse_parity("mark").is_err());
        assert!(parse_parity("space").is_err());
        assert!(parse_stop_bits("1.5").is_err());
    }

    #[test]
    fn timestamp_is_in_unix_milliseconds() {
        assert!(unix_time_ms() > 1_700_000_000_000);
    }

    #[test]
    fn encodes_text_once_for_synchronized_writes() {
        assert_eq!(encode_text("ABC", "utf-8").unwrap(), b"ABC");
        assert_eq!(encode_text("你好", "gbk").unwrap().len(), 4);
        assert!(encode_text("🙂", "windows-1252").is_err());
    }

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

    #[test]
    fn enumerates_local_ports_without_error() {
        let ports = list_serial_ports().expect("serial port enumeration should succeed");
        println!("enumerated {} local serial ports", ports.len());
    }

    fn temporary_log_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "iterm-{label}-{}-{}.log",
            std::process::id(),
            unix_time_ms()
        ))
    }
}
