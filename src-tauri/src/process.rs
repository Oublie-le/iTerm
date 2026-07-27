use crate::{
    logging::{build_log_spec, LogStartSpec, SessionLogger, StartLogRequest},
    serial::{ConnectionState, LogState, SerialEvent},
};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        mpsc::{self, Receiver, Sender, TryRecvError},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, State};

const COMMAND_REPLY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct ProcessRegistry {
    sessions: Arc<Mutex<HashMap<String, ProcessHandle>>>,
}

struct ProcessHandle {
    commands: Sender<ProcessCommand>,
}

enum ProcessCommand {
    Write(Vec<u8>, Sender<Result<usize, String>>),
    Resize(PtySize, Sender<Result<(), String>>),
    StartLog(LogStartSpec, Sender<Result<String, String>>),
    SetLogPaused(bool, Sender<Result<(), String>>),
    StopLog(Sender<Result<(), String>>),
    Close,
}

enum ProcessOutput {
    Data(Vec<u8>),
    Closed,
    Failed(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSshRequest {
    session_id: String,
    host: String,
    port: u16,
    username: String,
    auth_mode: String,
    private_key_path: String,
    strict_host_key_checking: bool,
    keep_alive_seconds: u64,
    term_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAdbRequest {
    session_id: String,
    device_id: String,
    shell: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdbDeviceDescriptor {
    id: String,
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    product: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    device: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transport_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalToolStatus {
    id: String,
    label: String,
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    install_hint: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    alias: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    host_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    identity_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    proxy_jump: Option<String>,
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteProcessRequest {
    session_id: String,
    bytes: Vec<u8>,
}

#[tauri::command]
pub fn open_ssh_session(
    request: OpenSshRequest,
    on_event: Channel<SerialEvent>,
    registry: State<'_, ProcessRegistry>,
) -> Result<(), String> {
    validate_ssh_request(&request)?;
    ensure_session_available(&registry, &request.session_id)?;

    let target = ssh_target(&request.username, &request.host);
    let mut command = CommandBuilder::new("ssh");
    command.args(ssh_arguments(&request));
    command.arg(&target);
    command.env("TERM", &request.term_type);

    let message = format!("正在连接 SSH {target}:{}…", request.port);
    let _ = on_event.send(SerialEvent::State {
        session_id: request.session_id.clone(),
        state: ConnectionState::Opening,
        message: Some(message),
    });

    start_process_session(
        &registry,
        request.session_id,
        format!("SSH {target}:{}", request.port),
        command,
        "ssh",
        on_event,
    )
}

#[tauri::command]
pub fn list_adb_devices() -> Result<Vec<AdbDeviceDescriptor>, String> {
    let output = Command::new("adb")
        .args(["devices", "-l"])
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "找不到 adb 命令，请安装 Android SDK Platform Tools。".to_string()
            } else {
                format!("无法执行 adb devices：{error}")
            }
        })?;
    if !output.status.success() {
        return Err(format!(
            "adb devices 执行失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(parse_adb_devices(&String::from_utf8_lossy(&output.stdout)))
}

#[tauri::command]
pub fn list_external_tools() -> Vec<ExternalToolStatus> {
    vec![
        inspect_external_tool(
            "ssh",
            "OpenSSH 客户端",
            &["-V"],
            "macOS/Linux 请安装系统 OpenSSH Client；Windows 请在“可选功能”中启用 OpenSSH 客户端。",
        ),
        inspect_external_tool(
            "adb",
            "Android Platform Tools",
            &["version"],
            "请安装 Android SDK Platform Tools，并将 adb 所在目录加入系统 PATH。",
        ),
    ]
}

#[tauri::command]
pub fn list_ssh_config_hosts() -> Result<Vec<SshConfigHost>, String> {
    let Some(config_path) = ssh_config_path() else {
        return Ok(Vec::new());
    };
    let source = match fs::read_to_string(&config_path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "无法读取 SSH 配置 {}：{error}",
                config_path.display()
            ))
        }
    };
    let mut hosts = parse_ssh_config(&source, &config_path);
    hosts.sort_by(|left, right| {
        left.alias
            .to_ascii_lowercase()
            .cmp(&right.alias.to_ascii_lowercase())
    });
    hosts.dedup_by(|left, right| left.alias.eq_ignore_ascii_case(&right.alias));
    Ok(hosts)
}

#[tauri::command]
pub fn open_adb_session(
    request: OpenAdbRequest,
    on_event: Channel<SerialEvent>,
    registry: State<'_, ProcessRegistry>,
) -> Result<(), String> {
    validate_argument("ADB 设备 ID", &request.device_id)?;
    if request.device_id.starts_with('-') {
        return Err("ADB 设备 ID 不能以连字符开头。".into());
    }
    ensure_session_available(&registry, &request.session_id)?;

    let mut command = CommandBuilder::new("adb");
    command.args(adb_arguments(&request));

    let label = format!("ADB {}", request.device_id);
    let _ = on_event.send(SerialEvent::State {
        session_id: request.session_id.clone(),
        state: ConnectionState::Opening,
        message: Some(format!("正在打开 {label} Shell…")),
    });
    start_process_session(
        &registry,
        request.session_id,
        label,
        command,
        "adb",
        on_event,
    )
}

#[tauri::command]
pub fn close_process_session(
    session_id: String,
    registry: State<'_, ProcessRegistry>,
) -> Result<(), String> {
    let handle = registry
        .sessions
        .lock()
        .map_err(|_| "命令会话注册表已损坏。")?
        .remove(&session_id);
    if let Some(handle) = handle {
        let _ = handle.commands.send(ProcessCommand::Close);
    }
    Ok(())
}

#[tauri::command]
pub fn write_process_bytes(
    request: WriteProcessRequest,
    registry: State<'_, ProcessRegistry>,
) -> Result<usize, String> {
    if request.bytes.is_empty() {
        return Ok(0);
    }
    let (reply_tx, reply_rx) = mpsc::channel();
    send_process_command(
        &registry,
        &request.session_id,
        ProcessCommand::Write(request.bytes, reply_tx),
    )?;
    receive_process_reply(reply_rx, "写入 SSH/ADB 会话")
}

#[tauri::command]
pub fn resize_process_session(
    session_id: String,
    cols: u16,
    rows: u16,
    registry: State<'_, ProcessRegistry>,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    send_process_command(
        &registry,
        &session_id,
        ProcessCommand::Resize(terminal_size(cols, rows), reply_tx),
    )?;
    receive_process_reply(reply_rx, "调整 SSH/ADB 终端尺寸")
}

#[tauri::command]
pub fn start_process_log(
    request: StartLogRequest,
    app: AppHandle,
    registry: State<'_, ProcessRegistry>,
) -> Result<String, String> {
    let spec = build_log_spec(&app, &request)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    send_process_command(
        &registry,
        &request.session_id,
        ProcessCommand::StartLog(spec, reply_tx),
    )?;
    receive_process_reply(reply_rx, "开始 SSH/ADB 日志")
}

#[tauri::command]
pub fn set_process_log_paused(
    session_id: String,
    paused: bool,
    registry: State<'_, ProcessRegistry>,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    send_process_command(
        &registry,
        &session_id,
        ProcessCommand::SetLogPaused(paused, reply_tx),
    )?;
    receive_process_reply(
        reply_rx,
        if paused {
            "暂停 SSH/ADB 日志"
        } else {
            "继续 SSH/ADB 日志"
        },
    )
}

#[tauri::command]
pub fn stop_process_log(
    session_id: String,
    registry: State<'_, ProcessRegistry>,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    send_process_command(&registry, &session_id, ProcessCommand::StopLog(reply_tx))?;
    receive_process_reply(reply_rx, "停止 SSH/ADB 日志")
}

fn validate_ssh_request(request: &OpenSshRequest) -> Result<(), String> {
    validate_argument("SSH 主机", &request.host)?;
    if request.host.starts_with('-') {
        return Err("SSH 主机不能以连字符开头。".into());
    }
    if !request.username.is_empty() {
        validate_argument("SSH 用户名", &request.username)?;
        if request.username.contains('@') || request.username.starts_with('-') {
            return Err("SSH 用户名不能包含 @ 或以连字符开头。".into());
        }
    }
    match request.auth_mode.as_str() {
        "agent" | "password" => {}
        "privateKey" => {
            if request.private_key_path.trim().is_empty() {
                return Err("使用私钥认证时必须填写私钥路径。".into());
            }
        }
        value => return Err(format!("未知的 SSH 认证方式：{value}")),
    }
    Ok(())
}

fn ssh_config_path() -> Option<PathBuf> {
    let home = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".ssh").join("config"))
}

fn parse_ssh_config(source: &str, source_path: &Path) -> Vec<SshConfigHost> {
    let mut hosts = Vec::new();
    let mut current_host_indexes = Vec::new();
    let source_label = source_path.to_string_lossy().into_owned();

    for raw_line in source.lines() {
        let line = strip_ssh_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }
        let Some((keyword, raw_value)) = split_ssh_directive(line) else {
            continue;
        };
        let keyword = keyword.to_ascii_lowercase();
        let value = unquote_ssh_value(raw_value.trim());

        if keyword == "host" {
            current_host_indexes.clear();
            for alias in value.split_whitespace().filter(|alias| {
                !alias.starts_with('-')
                    && !alias.starts_with('!')
                    && !alias.contains('*')
                    && !alias.contains('?')
                    && !alias.chars().any(char::is_control)
            }) {
                hosts.push(SshConfigHost {
                    alias: alias.to_string(),
                    host_name: None,
                    user: None,
                    port: None,
                    identity_files: Vec::new(),
                    proxy_jump: None,
                    source: source_label.clone(),
                });
                current_host_indexes.push(hosts.len() - 1);
            }
            continue;
        }
        if keyword == "match" {
            current_host_indexes.clear();
            continue;
        }

        for index in &current_host_indexes {
            let host = &mut hosts[*index];
            match keyword.as_str() {
                "hostname" if host.host_name.is_none() => {
                    host.host_name = non_empty_ssh_value(value);
                }
                "user" if host.user.is_none() => {
                    host.user = non_empty_ssh_value(value);
                }
                "port" if host.port.is_none() => {
                    host.port = value.parse::<u16>().ok().filter(|port| *port > 0);
                }
                "identityfile" => {
                    if !value.is_empty() && !host.identity_files.iter().any(|item| item == value) {
                        host.identity_files.push(value.to_string());
                    }
                }
                "proxyjump" if host.proxy_jump.is_none() => {
                    host.proxy_jump = non_empty_ssh_value(value);
                }
                _ => {}
            }
        }
    }
    hosts
}

fn split_ssh_directive(line: &str) -> Option<(&str, &str)> {
    line.split_once(char::is_whitespace)
        .or_else(|| line.split_once('='))
        .map(|(keyword, value)| (keyword.trim_end_matches('='), value.trim_start_matches('=')))
}

fn strip_ssh_comment(line: &str) -> &str {
    let mut quote = None;
    for (index, character) in line.char_indices() {
        match character {
            '"' | '\'' if quote == Some(character) => quote = None,
            '"' | '\'' if quote.is_none() => quote = Some(character),
            '#' if quote.is_none() => return &line[..index],
            _ => {}
        }
    }
    line
}

fn unquote_ssh_value(value: &str) -> &str {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return &value[1..value.len() - 1];
        }
    }
    value
}

fn non_empty_ssh_value(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

fn validate_argument(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label}不能为空。"));
    }
    if value.chars().any(char::is_whitespace) || value.chars().any(char::is_control) {
        return Err(format!("{label}不能包含空白或控制字符。"));
    }
    Ok(())
}

fn ssh_target(username: &str, host: &str) -> String {
    if username.is_empty() {
        host.to_string()
    } else {
        format!("{username}@{host}")
    }
}

fn ssh_arguments(request: &OpenSshRequest) -> Vec<String> {
    let mut arguments = vec![
        "-tt".into(),
        "-p".into(),
        request.port.to_string(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        format!(
            "ServerAliveInterval={}",
            request.keep_alive_seconds.min(3_600)
        ),
    ];
    match request.auth_mode.as_str() {
        "password" => {
            arguments.push("-o".into());
            arguments.push("BatchMode=no".into());
            arguments.push("-o".into());
            arguments.push("PreferredAuthentications=keyboard-interactive,password".into());
            arguments.push("-o".into());
            arguments.push("PubkeyAuthentication=no".into());
        }
        "privateKey" => {
            arguments.push("-o".into());
            arguments.push("BatchMode=yes".into());
            arguments.push("-i".into());
            arguments.push(request.private_key_path.clone());
            arguments.push("-o".into());
            arguments.push("IdentitiesOnly=yes".into());
        }
        _ => {
            arguments.push("-o".into());
            arguments.push("BatchMode=yes".into());
        }
    }
    arguments.push("-o".into());
    if request.strict_host_key_checking {
        arguments.push("StrictHostKeyChecking=yes".into());
    } else {
        arguments.push("StrictHostKeyChecking=no".into());
        arguments.push("-o".into());
        arguments.push("UserKnownHostsFile=/dev/null".into());
    }
    arguments
}

fn adb_arguments(request: &OpenAdbRequest) -> Vec<String> {
    let mut arguments = vec![
        "-s".into(),
        request.device_id.clone(),
        "shell".into(),
        "-tt".into(),
    ];
    if !request.shell.trim().is_empty() {
        arguments.push(request.shell.clone());
    }
    arguments
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(1, 1_000),
        cols: cols.clamp(1, 1_000),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn parse_adb_devices(output: &str) -> Vec<AdbDeviceDescriptor> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || trimmed.starts_with("List of devices")
                || trimmed.starts_with('*')
            {
                return None;
            }
            let mut fields = trimmed.split_whitespace();
            let id = fields.next()?.to_string();
            let state = fields.next().unwrap_or("unknown").to_string();
            let mut descriptor = AdbDeviceDescriptor {
                id,
                state,
                product: None,
                model: None,
                device: None,
                transport_id: None,
            };
            for field in fields {
                let Some((key, value)) = field.split_once(':') else {
                    continue;
                };
                match key {
                    "product" => descriptor.product = Some(value.into()),
                    "model" => descriptor.model = Some(value.replace('_', " ")),
                    "device" => descriptor.device = Some(value.into()),
                    "transport_id" => descriptor.transport_id = Some(value.into()),
                    _ => {}
                }
            }
            Some(descriptor)
        })
        .collect()
}

fn inspect_external_tool(
    executable: &str,
    label: &str,
    arguments: &[&str],
    install_hint: &str,
) -> ExternalToolStatus {
    match Command::new(executable).args(arguments).output() {
        Ok(output) => ExternalToolStatus {
            id: executable.into(),
            label: label.into(),
            available: true,
            version: first_output_line(&output.stdout)
                .or_else(|| first_output_line(&output.stderr)),
            install_hint: install_hint.into(),
        },
        Err(_) => ExternalToolStatus {
            id: executable.into(),
            label: label.into(),
            available: false,
            version: None,
            install_hint: install_hint.into(),
        },
    }
}

fn first_output_line(output: &[u8]) -> Option<String> {
    String::from_utf8_lossy(output)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(240).collect())
}

fn ensure_session_available(
    registry: &State<'_, ProcessRegistry>,
    session_id: &str,
) -> Result<(), String> {
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| "命令会话注册表已损坏。")?;
    if sessions.contains_key(session_id) {
        Err("该 SSH/ADB 会话已经打开，请先断开。".into())
    } else {
        Ok(())
    }
}

fn start_process_session(
    registry: &State<'_, ProcessRegistry>,
    session_id: String,
    label: String,
    command: CommandBuilder,
    executable: &str,
    on_event: Channel<SerialEvent>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("无法为 {label} 创建伪终端：{error}"))?;
    let child = pair.slave.spawn_command(command).map_err(|error| {
        format!("无法在伪终端中启动 {executable}：{error}。请确认系统已安装并可执行该命令。")
    })?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("{label} 终端输出不可用：{error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("{label} 终端输入不可用：{error}"))?;

    let (command_tx, command_rx) = mpsc::channel();
    registry
        .sessions
        .lock()
        .map_err(|_| "命令会话注册表已损坏。")?
        .insert(
            session_id.clone(),
            ProcessHandle {
                commands: command_tx,
            },
        );

    let sessions = Arc::clone(&registry.sessions);
    thread::Builder::new()
        .name(format!("process-{session_id}"))
        .spawn(move || {
            process_worker(
                session_id,
                label,
                child,
                writer,
                reader,
                pair.master,
                command_rx,
                on_event,
                sessions,
            )
        })
        .map_err(|error| format!("无法启动 SSH/ADB 读取线程：{error}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn process_worker(
    session_id: String,
    label: String,
    mut child: Box<dyn Child + Send + Sync>,
    mut writer: Box<dyn Write + Send>,
    reader: Box<dyn Read + Send>,
    master: Box<dyn MasterPty + Send>,
    commands: Receiver<ProcessCommand>,
    on_event: Channel<SerialEvent>,
    sessions: Arc<Mutex<HashMap<String, ProcessHandle>>>,
) {
    let (output_tx, output_rx) = mpsc::channel();
    spawn_reader(reader, output_tx);

    let _ = on_event.send(SerialEvent::State {
        session_id: session_id.clone(),
        state: ConnectionState::Connected,
        message: Some(format!("{label} 已启动")),
    });

    let mut sequence = 0_u64;
    let mut reader_closed = false;
    let mut requested_close = false;
    let mut logger: Option<SessionLogger> = None;
    let exit_status = loop {
        loop {
            match commands.try_recv() {
                Ok(ProcessCommand::Write(bytes, reply)) => {
                    let result = writer
                        .write_all(&bytes)
                        .and_then(|_| writer.flush())
                        .map(|_| bytes.len())
                        .map_err(|error| format!("写入 {label} 失败：{error}"));
                    let _ = reply.send(result);
                }
                Ok(ProcessCommand::Resize(size, reply)) => {
                    let result = master
                        .resize(size)
                        .map_err(|error| format!("调整 {label} 终端尺寸失败：{error}"));
                    let _ = reply.send(result);
                }
                Ok(ProcessCommand::StartLog(spec, reply)) => {
                    let result = SessionLogger::open(spec).map(|new_logger| {
                        let path = new_logger.path_string();
                        logger = Some(new_logger);
                        let _ = on_event.send(SerialEvent::Log {
                            session_id: session_id.clone(),
                            state: LogState::Recording,
                            path: Some(path.clone()),
                            message: None,
                        });
                        path
                    });
                    let _ = reply.send(result);
                }
                Ok(ProcessCommand::SetLogPaused(paused, reply)) => {
                    let result = logger
                        .as_mut()
                        .ok_or_else(|| "当前会话没有活动日志。".to_string())
                        .map(|active_logger| {
                            active_logger.set_paused(paused);
                            let _ = on_event.send(SerialEvent::Log {
                                session_id: session_id.clone(),
                                state: if paused {
                                    LogState::Paused
                                } else {
                                    LogState::Recording
                                },
                                path: Some(active_logger.path_string()),
                                message: None,
                            });
                        });
                    let _ = reply.send(result);
                }
                Ok(ProcessCommand::StopLog(reply)) => {
                    let result = logger.take().map(SessionLogger::finish).unwrap_or(Ok(()));
                    if result.is_ok() {
                        let _ = on_event.send(SerialEvent::Log {
                            session_id: session_id.clone(),
                            state: LogState::Stopped,
                            path: None,
                            message: None,
                        });
                    }
                    let _ = reply.send(result);
                }
                Ok(ProcessCommand::Close) => {
                    requested_close = true;
                    let _ = child.kill();
                    break;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    requested_close = true;
                    let _ = child.kill();
                    break;
                }
            }
        }

        match output_rx.recv_timeout(Duration::from_millis(10)) {
            Ok(ProcessOutput::Data(bytes)) => {
                sequence += 1;
                if let Some(active_logger) = logger.as_mut() {
                    if let Err(message) = active_logger.write(&bytes) {
                        let path = active_logger.path_string();
                        logger = None;
                        let _ = on_event.send(SerialEvent::Log {
                            session_id: session_id.clone(),
                            state: LogState::Error,
                            path: Some(path),
                            message: Some(message),
                        });
                    }
                }
                let _ = on_event.send(SerialEvent::Data {
                    session_id: session_id.clone(),
                    sequence,
                    received_at_ms: unix_time_ms(),
                    bytes,
                });
            }
            Ok(ProcessOutput::Closed) => reader_closed = true,
            Ok(ProcessOutput::Failed(message)) => {
                let _ = on_event.send(SerialEvent::Error {
                    session_id: session_id.clone(),
                    code: "PROCESS_READ_FAILED".into(),
                    message,
                    recoverable: false,
                });
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => reader_closed = true,
        }

        match child.try_wait() {
            Ok(Some(status)) if reader_closed || requested_close => break Some(status),
            Ok(Some(_)) => {}
            Ok(None) if requested_close => break child.wait().ok(),
            Ok(None) => {}
            Err(_) => break None,
        }
    };

    if let Ok(mut active_sessions) = sessions.lock() {
        active_sessions.remove(&session_id);
    }
    if let Some(active_logger) = logger.take() {
        let result = active_logger.finish();
        let _ = on_event.send(SerialEvent::Log {
            session_id: session_id.clone(),
            state: if result.is_ok() {
                LogState::Stopped
            } else {
                LogState::Error
            },
            path: None,
            message: result.err(),
        });
    }

    if requested_close {
        let _ = on_event.send(SerialEvent::State {
            session_id,
            state: ConnectionState::Disconnected,
            message: Some(format!("{label} 已断开。")),
        });
    } else if exit_status.as_ref().is_some_and(|status| status.success()) {
        let _ = on_event.send(SerialEvent::State {
            session_id,
            state: ConnectionState::Disconnected,
            message: Some(format!("{label} 已结束。")),
        });
    } else {
        let status = exit_status
            .map(|value| value.to_string())
            .unwrap_or_else(|| "未知状态".into());
        let _ = on_event.send(SerialEvent::Error {
            session_id,
            code: "PROCESS_EXITED".into(),
            message: format!("{label} 异常退出（{status}）。"),
            recoverable: false,
        });
    }
}

fn spawn_reader(mut reader: Box<dyn Read + Send>, output: Sender<ProcessOutput>) {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = output.send(ProcessOutput::Closed);
                    return;
                }
                Ok(count) => {
                    if output
                        .send(ProcessOutput::Data(buffer[..count].to_vec()))
                        .is_err()
                    {
                        return;
                    }
                }
                Err(error) => {
                    if error.raw_os_error() == Some(5) {
                        let _ = output.send(ProcessOutput::Closed);
                        return;
                    }
                    let _ = output.send(ProcessOutput::Failed(format!(
                        "读取 SSH/ADB 输出失败：{error}"
                    )));
                    let _ = output.send(ProcessOutput::Closed);
                    return;
                }
            }
        }
    });
}

fn send_process_command(
    registry: &State<'_, ProcessRegistry>,
    session_id: &str,
    command: ProcessCommand,
) -> Result<(), String> {
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| "命令会话注册表已损坏。")?;
    let handle = sessions
        .get(session_id)
        .ok_or_else(|| "SSH/ADB 会话不存在或已经关闭。".to_string())?;
    handle
        .commands
        .send(command)
        .map_err(|_| "SSH/ADB 会话进程已经退出，请重新连接。".to_string())
}

fn receive_process_reply<T>(
    receiver: Receiver<Result<T, String>>,
    action: &str,
) -> Result<T, String> {
    receiver
        .recv_timeout(COMMAND_REPLY_TIMEOUT)
        .map_err(|_| format!("{action}超时。"))?
}

fn unix_time_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> OpenSshRequest {
        OpenSshRequest {
            session_id: "session".into(),
            host: "example.com".into(),
            port: 22,
            username: "root".into(),
            auth_mode: "agent".into(),
            private_key_path: String::new(),
            strict_host_key_checking: true,
            keep_alive_seconds: 30,
            term_type: "xterm-256color".into(),
        }
    }

    #[test]
    fn builds_safe_ssh_target_and_arguments() {
        let value = request();
        assert_eq!(ssh_target(&value.username, &value.host), "root@example.com");
        assert!(ssh_arguments(&value).contains(&"BatchMode=yes".to_string()));
        assert!(ssh_arguments(&value).contains(&"ServerAliveInterval=30".to_string()));
        assert!(ssh_arguments(&value).contains(&"StrictHostKeyChecking=yes".to_string()));
    }

    #[test]
    fn parses_named_ssh_hosts_without_reading_key_contents() {
        let config = r#"
            Host *
              ServerAliveInterval 20

            Host production prod
              HostName 10.0.0.12
              User deploy
              Port 2222
              IdentityFile "~/.ssh/prod key"
              ProxyJump bastion

            Host *.internal !blocked.internal
              User ignored
        "#;
        let hosts = parse_ssh_config(config, Path::new("/home/test/.ssh/config"));

        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].alias, "production");
        assert_eq!(hosts[0].host_name.as_deref(), Some("10.0.0.12"));
        assert_eq!(hosts[0].user.as_deref(), Some("deploy"));
        assert_eq!(hosts[0].port, Some(2222));
        assert_eq!(hosts[0].identity_files, vec!["~/.ssh/prod key"]);
        assert_eq!(hosts[0].proxy_jump.as_deref(), Some("bastion"));
        assert_eq!(hosts[1].alias, "prod");
    }

    #[test]
    fn supports_equals_syntax_and_ignores_inline_comments() {
        let config = "Host=lab # board\n  HostName=lab.local\n  User root\n";
        let hosts = parse_ssh_config(config, Path::new("config"));

        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "lab");
        assert_eq!(hosts[0].host_name.as_deref(), Some("lab.local"));
        assert_eq!(hosts[0].user.as_deref(), Some("root"));
    }

    #[test]
    fn adds_private_key_and_relaxed_host_key_options() {
        let mut value = request();
        value.auth_mode = "privateKey".into();
        value.private_key_path = "/tmp/test-key".into();
        value.strict_host_key_checking = false;
        let arguments = ssh_arguments(&value);
        assert!(arguments.contains(&"/tmp/test-key".to_string()));
        assert!(arguments.contains(&"StrictHostKeyChecking=no".to_string()));
    }

    #[test]
    fn enables_interactive_password_authentication_without_a_stored_secret() {
        let mut value = request();
        value.auth_mode = "password".into();
        let arguments = ssh_arguments(&value);

        assert!(validate_ssh_request(&value).is_ok());
        assert!(arguments.contains(&"BatchMode=no".to_string()));
        assert!(arguments
            .contains(&"PreferredAuthentications=keyboard-interactive,password".to_string()));
        assert!(arguments.contains(&"PubkeyAuthentication=no".to_string()));
        assert!(!arguments
            .iter()
            .any(|argument| argument.contains("Password=")));
    }

    #[test]
    fn clamps_terminal_size_to_supported_range() {
        let minimum = terminal_size(0, 0);
        assert_eq!((minimum.cols, minimum.rows), (1, 1));

        let maximum = terminal_size(u16::MAX, u16::MAX);
        assert_eq!((maximum.cols, maximum.rows), (1_000, 1_000));
    }

    #[test]
    fn rejects_option_like_or_whitespace_hosts() {
        let mut value = request();
        value.host = "-oProxyCommand=bad".into();
        assert!(validate_ssh_request(&value).is_err());
        value.host = "bad host".into();
        assert!(validate_ssh_request(&value).is_err());
    }

    #[test]
    fn parses_adb_device_states_and_metadata() {
        let output = "List of devices attached\n\
                      emulator-5554 device product:sdk_gphone model:Pixel_8 device:emu transport_id:1\n\
                      ABC123 unauthorized usb:1-2\n\
                      192.168.1.2:5555 offline\n";
        let devices = parse_adb_devices(output);
        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0].id, "emulator-5554");
        assert_eq!(devices[0].model.as_deref(), Some("Pixel 8"));
        assert_eq!(devices[1].state, "unauthorized");
        assert_eq!(devices[2].state, "offline");
    }

    #[test]
    fn extracts_and_limits_external_tool_version_lines() {
        assert_eq!(
            first_output_line(b"\nOpenSSH_9.9 test\nsecond line").as_deref(),
            Some("OpenSSH_9.9 test")
        );
        assert_eq!(first_output_line(b" \n\t"), None);
        assert_eq!(
            first_output_line(&vec![b'a'; 300])
                .expect("version line")
                .chars()
                .count(),
            240
        );
    }

    #[test]
    fn forces_a_pty_for_interactive_adb_shells() {
        let request = OpenAdbRequest {
            session_id: "session".into(),
            device_id: "emulator-5554".into(),
            shell: String::new(),
        };
        assert_eq!(
            adb_arguments(&request),
            ["-s", "emulator-5554", "shell", "-tt"]
        );
    }

    #[test]
    fn creates_a_native_pty_and_captures_output() {
        let pty = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        #[cfg(unix)]
        let command = {
            let mut command = CommandBuilder::new("/bin/sh");
            command.args(["-c", "printf PTY_OK"]);
            command
        };
        #[cfg(windows)]
        let command = {
            let mut command = CommandBuilder::new("cmd.exe");
            command.args(["/C", "echo PTY_OK"]);
            command
        };
        let mut reader = pty.master.try_clone_reader().unwrap();
        let mut child = pty.slave.spawn_command(command).unwrap();
        drop(pty.slave);

        let mut output = Vec::new();
        let mut buffer = [0_u8; 256];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => output.extend_from_slice(&buffer[..count]),
                Err(error) if error.raw_os_error() == Some(5) => break,
                Err(error) => panic!("failed to read PTY output: {error}"),
            }
        }
        assert!(child.wait().unwrap().success());
        assert!(String::from_utf8_lossy(&output).contains("PTY_OK"));
    }

    #[test]
    fn writes_resizes_and_reads_an_interactive_pty() {
        let pty = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        pty.master
            .resize(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();

        #[cfg(unix)]
        let command = {
            let mut command = CommandBuilder::new("/bin/sh");
            command.args(["-c", "IFS= read -r line; printf 'ECHO:%s' \"$line\""]);
            command
        };
        #[cfg(windows)]
        let command = {
            let mut command = CommandBuilder::new("cmd.exe");
            command.args(["/V:ON", "/Q", "/C", "set /p line= & echo ECHO:!line!"]);
            command
        };

        let mut reader = pty.master.try_clone_reader().unwrap();
        let mut writer = pty.master.take_writer().unwrap();
        let mut child = pty.slave.spawn_command(command).unwrap();
        drop(pty.slave);

        writer.write_all(b"roundtrip\r\n").unwrap();
        writer.flush().unwrap();
        drop(writer);

        let mut output = Vec::new();
        let mut buffer = [0_u8; 256];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => output.extend_from_slice(&buffer[..count]),
                Err(error) if error.raw_os_error() == Some(5) => break,
                Err(error) => panic!("failed to read PTY roundtrip output: {error}"),
            }
        }
        assert!(child.wait().unwrap().success());
        assert!(String::from_utf8_lossy(&output).contains("ECHO:roundtrip"));
    }
}
