use rusqlite::{params, Connection};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

const DATABASE_FILE_NAME: &str = "iterm-state.sqlite3";
const CURRENT_SCHEMA_VERSION: i64 = 1;
const MAX_VALUE_BYTES: usize = 10 * 1024 * 1024;
const ALLOWED_STORAGE_KEYS: [&str; 5] = [
    "iterm.profiles.v1",
    "serialterm.profiles.v1",
    "iterm.preferences.v1",
    "iterm.workspace.v1",
    "iterm.senders.v1",
];

pub struct PersistentStore {
    connection: Mutex<Connection>,
}

impl PersistentStore {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
        fs::create_dir_all(&directory).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
        Self::open_path(directory.join(DATABASE_FILE_NAME))
    }

    fn open_path(path: PathBuf) -> Result<Self, String> {
        let mut connection =
            Connection::open(&path).map_err(|error| format!("无法打开配置数据库：{error}"))?;
        configure_connection(&connection)?;
        migrate_database(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    fn open_in_memory() -> Result<Self, String> {
        let mut connection =
            Connection::open_in_memory().map_err(|error| format!("无法创建测试数据库：{error}"))?;
        configure_connection(&connection)?;
        migrate_database(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn load_items(&self) -> Result<BTreeMap<String, String>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "配置数据库锁已损坏。".to_string())?;
        let mut statement = connection
            .prepare("SELECT storage_key, value_json FROM persistent_items ORDER BY storage_key")
            .map_err(|error| format!("无法读取配置数据库：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("无法查询配置数据库：{error}"))?;
        let mut items = BTreeMap::new();
        for row in rows {
            let (key, value) = row.map_err(|error| format!("配置数据库记录无效：{error}"))?;
            items.insert(key, value);
        }
        Ok(items)
    }

    fn save_items(&self, items: BTreeMap<String, String>) -> Result<(), String> {
        for (key, value) in &items {
            validate_item(key, value)?;
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "配置数据库锁已损坏。".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始配置保存事务：{error}"))?;
        let updated_at_ms = unix_time_ms();
        for (key, value) in items {
            transaction
                .execute(
                    "INSERT INTO persistent_items (storage_key, value_json, updated_at_ms)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(storage_key) DO UPDATE SET
                       value_json = excluded.value_json,
                       updated_at_ms = excluded.updated_at_ms",
                    params![key, value, updated_at_ms],
                )
                .map_err(|error| format!("无法保存配置项：{error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("无法提交配置保存事务：{error}"))
    }

    fn remove_item(&self, key: &str) -> Result<(), String> {
        validate_key(key)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "配置数据库锁已损坏。".to_string())?;
        connection
            .execute(
                "DELETE FROM persistent_items WHERE storage_key = ?1",
                params![key],
            )
            .map_err(|error| format!("无法删除配置项：{error}"))?;
        Ok(())
    }
}

#[tauri::command]
pub fn load_persistent_items(
    store: State<'_, PersistentStore>,
) -> Result<BTreeMap<String, String>, String> {
    store.load_items()
}

#[tauri::command]
pub fn save_persistent_items(
    items: BTreeMap<String, String>,
    store: State<'_, PersistentStore>,
) -> Result<(), String> {
    store.save_items(items)
}

#[tauri::command]
pub fn remove_persistent_item(
    key: String,
    store: State<'_, PersistentStore>,
) -> Result<(), String> {
    store.remove_item(&key)
}

fn configure_connection(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("无法设置配置数据库超时：{error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("无法启用配置数据库外键：{error}"))?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("无法启用配置数据库 WAL：{error}"))?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| format!("无法设置配置数据库同步模式：{error}"))
}

fn migrate_database(connection: &mut Connection) -> Result<(), String> {
    let version = connection
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .map_err(|error| format!("无法读取配置数据库版本：{error}"))?;
    if version > CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "配置数据库版本 {version} 高于当前支持的 {CURRENT_SCHEMA_VERSION}，请升级 iTerm。"
        ));
    }
    if version == CURRENT_SCHEMA_VERSION {
        return Ok(());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始配置数据库迁移：{error}"))?;
    if version == 0 {
        transaction
            .execute_batch(
                "CREATE TABLE persistent_items (
                   storage_key TEXT PRIMARY KEY NOT NULL,
                   value_json TEXT NOT NULL,
                   updated_at_ms INTEGER NOT NULL
                 ) STRICT;",
            )
            .map_err(|error| format!("无法创建配置数据库结构：{error}"))?;
    }
    transaction
        .pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)
        .map_err(|error| format!("无法更新配置数据库版本：{error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("无法提交配置数据库迁移：{error}"))
}

fn validate_item(key: &str, value: &str) -> Result<(), String> {
    validate_key(key)?;
    if value.len() > MAX_VALUE_BYTES {
        return Err(format!(
            "配置项 {key} 超出 {} MiB 限制。",
            MAX_VALUE_BYTES / 1024 / 1024
        ));
    }
    Ok(())
}

fn validate_key(key: &str) -> Result<(), String> {
    if !ALLOWED_STORAGE_KEYS.contains(&key) {
        return Err(format!("不允许持久化配置项：{key}"));
    }
    Ok(())
}

fn unix_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_new_database_to_current_schema() {
        let store = PersistentStore::open_in_memory().expect("database should open");
        let connection = store.connection.lock().unwrap();
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn saves_replaces_and_removes_items_atomically() {
        let store = PersistentStore::open_in_memory().expect("database should open");
        store
            .save_items(BTreeMap::from([
                ("iterm.profiles.v1".into(), "[{\"id\":\"one\"}]".into()),
                ("iterm.workspace.v1".into(), "{\"sidebarOpen\":true}".into()),
            ]))
            .unwrap();
        store
            .save_items(BTreeMap::from([(
                "iterm.profiles.v1".into(),
                "[{\"id\":\"two\"}]".into(),
            )]))
            .unwrap();

        let items = store.load_items().unwrap();
        assert_eq!(items["iterm.profiles.v1"], "[{\"id\":\"two\"}]");
        assert_eq!(items.len(), 2);

        store.remove_item("iterm.workspace.v1").unwrap();
        assert!(!store
            .load_items()
            .unwrap()
            .contains_key("iterm.workspace.v1"));
    }

    #[test]
    fn rejects_unknown_keys_and_oversized_values() {
        let store = PersistentStore::open_in_memory().expect("database should open");
        assert!(store
            .save_items(BTreeMap::from([("arbitrary.key".into(), "{}".into())]))
            .is_err());
        assert!(store
            .save_items(BTreeMap::from([(
                "iterm.profiles.v1".into(),
                "x".repeat(MAX_VALUE_BYTES + 1),
            )]))
            .is_err());
    }
}
