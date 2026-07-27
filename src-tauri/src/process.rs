use crate::{
    logging::{build_log_spec, LogStartSpec, SessionLogger, StartLogRequest},
    serial::{ConnectionState, LogState, SerialEvent},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
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
    let mut command = Command::new("ssh");
    command
        .args(ssh_arguments(&request))
        .arg(&target)
        .env("TERM", &request.term_type)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console_window(&mut command);

    let message = format!("正在连接 SSH {target}:{}…", request.port);
    let _ = on_event.send(SerialEvent::State {
        session_id: request.session_id.clone(),
        state: ConnectionState::Opening,
        message: Some(message),
    });

    let child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "找不到 ssh 命令，请安装或启用系统 OpenSSH 客户端。".to_string()
        } else {
            format!("无法启动 ssh：{error}")
        }
    })?;

    start_process_session(
        &registry,
        request.session_id,
        format!("SSH {target}:{}", request.port),
        child,
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

    let mut command = Command::new("adb");
    command.args(adb_arguments(&request));
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console_window(&mut command);

    let label = format!("ADB {}", request.device_id);
    let _ = on_event.send(SerialEvent::State {
        session_id: request.session_id.clone(),
        state: ConnectionState::Opening,
        message: Some(format!("正在打开 {label} Shell…")),
    });
    let child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "找不到 adb 命令，请安装 Android SDK Platform Tools。".to_string()
        } else {
            format!("无法启动 adb：{error}")
        }
    })?;
    start_process_session(&registry, request.session_id, label, child, on_event)
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
        "agent" => {}
        "privateKey" => {
            if request.private_key_path.trim().is_empty() {
                return Err("使用私钥认证时必须填写私钥路径。".into());
            }
        }
        value => return Err(format!("未知的 SSH 认证方式：{value}")),
    }
    Ok(())
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
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        format!(
            "ServerAliveInterval={}",
            request.keep_alive_seconds.min(3_600)
        ),
    ];
    if request.auth_mode == "privateKey" {
        arguments.push("-i".into());
        arguments.push(request.private_key_path.clone());
        arguments.push("-o".into());
        arguments.push("IdentitiesOnly=yes".into());
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
    mut child: Child,
    on_event: Channel<SerialEvent>,
) -> Result<(), String> {
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| format!("{label} 标准输入不可用。"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{label} 标准输出不可用。"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{label} 错误输出不可用。"))?;

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
                session_id, label, child, stdin, stdout, stderr, command_rx, on_event, sessions,
            )
        })
        .map_err(|error| format!("无法启动 SSH/ADB 读取线程：{error}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn process_worker<R1, R2>(
    session_id: String,
    label: String,
    mut child: Child,
    mut stdin: ChildStdin,
    stdout: R1,
    stderr: R2,
    commands: Receiver<ProcessCommand>,
    on_event: Channel<SerialEvent>,
    sessions: Arc<Mutex<HashMap<String, ProcessHandle>>>,
) where
    R1: Read + Send + 'static,
    R2: Read + Send + 'static,
{
    let (output_tx, output_rx) = mpsc::channel();
    spawn_reader(stdout, output_tx.clone());
    spawn_reader(stderr, output_tx);

    let _ = on_event.send(SerialEvent::State {
        session_id: session_id.clone(),
        state: ConnectionState::Connected,
        message: Some(format!("{label} 已启动")),
    });

    let mut sequence = 0_u64;
    let mut closed_readers = 0_u8;
    let mut requested_close = false;
    let mut logger: Option<SessionLogger> = None;
    let exit_status = loop {
        loop {
            match commands.try_recv() {
                Ok(ProcessCommand::Write(bytes, reply)) => {
                    let result = stdin
                        .write_all(&bytes)
                        .and_then(|_| stdin.flush())
                        .map(|_| bytes.len())
                        .map_err(|error| format!("写入 {label} 失败：{error}"));
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
            Ok(ProcessOutput::Closed) => closed_readers = closed_readers.saturating_add(1),
            Ok(ProcessOutput::Failed(message)) => {
                let _ = on_event.send(SerialEvent::Error {
                    session_id: session_id.clone(),
                    code: "PROCESS_READ_FAILED".into(),
                    message,
                    recoverable: false,
                });
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => closed_readers = 2,
        }

        match child.try_wait() {
            Ok(Some(status)) if closed_readers >= 2 || requested_close => break Some(status),
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
    } else if exit_status.is_some_and(|status| status.success()) {
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

fn spawn_reader<R>(mut reader: R, output: Sender<ProcessOutput>)
where
    R: Read + Send + 'static,
{
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

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_console_window(_: &mut Command) {}

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
}
