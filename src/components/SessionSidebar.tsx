import {
  Cable,
  ChevronDown,
  CirclePlus,
  Folder,
  RefreshCw,
  Search,
  Usb,
} from "lucide-react";
import type {
  RuntimeSession,
  SerialPortDescriptor,
  SessionProfile,
} from "../lib/types";

interface SessionSidebarProps {
  profiles: SessionProfile[];
  ports: SerialPortDescriptor[];
  sessions: RuntimeSession[];
  filter: string;
  onFilterChange: (value: string) => void;
  onNew: () => void;
  onOpen: (profile: SessionProfile) => void;
  onEdit: (profile: SessionProfile) => void;
  onRefresh: () => void;
}

export function SessionSidebar({
  profiles,
  ports,
  sessions,
  filter,
  onFilterChange,
  onNew,
  onOpen,
  onEdit,
  onRefresh,
}: SessionSidebarProps) {
  const visibleProfiles = profiles.filter((profile) =>
    `${profile.name} ${profile.group} ${profile.serial.portPath}`
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase()),
  );

  return (
    <aside className="session-sidebar">
      <header className="dock-title">
        <span className="dock-title-mark" />
        <span>会话管理器</span>
        <button className="icon-button" title="新建串口会话" onClick={onNew}>
          <CirclePlus size={17} />
        </button>
      </header>

      <div className="sidebar-search">
        <Search size={15} />
        <input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="筛选会话"
          aria-label="筛选会话"
        />
        <button className="icon-button" title="刷新串口" onClick={onRefresh}>
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="session-tree">
        <div className="tree-group">
          <div className="tree-group-label">
            <ChevronDown size={15} />
            <Folder size={16} />
            <span>串口会话</span>
            <span className="tree-count">{visibleProfiles.length}</span>
          </div>
          {visibleProfiles.length === 0 ? (
            <button className="empty-tree-action" onClick={onNew}>
              <CirclePlus size={16} />
              新建第一个串口会话
            </button>
          ) : (
            visibleProfiles.map((profile) => {
              const runtime = sessions.find(
                (session) => session.profileId === profile.id,
              );
              return (
                <button
                  key={profile.id}
                  className="tree-session"
                  onDoubleClick={() => onOpen(profile)}
                  onClick={() => (runtime ? onOpen(profile) : onEdit(profile))}
                  title="双击连接，单击编辑"
                >
                  <span
                    className={`connection-dot state-${runtime?.state ?? "disconnected"}`}
                  />
                  <Cable size={16} />
                  <span className="tree-session-text">
                    <strong>{profile.name}</strong>
                    <small>
                      {profile.serial.portPath || "尚未选择设备"} ·{" "}
                      {profile.serial.baudRate}
                    </small>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="tree-group port-group">
          <div className="tree-group-label">
            <ChevronDown size={15} />
            <Usb size={16} />
            <span>可用设备</span>
            <span className="tree-count">{ports.length}</span>
          </div>
          {ports.map((port) => (
            <button
              key={port.path}
              className="tree-port"
              title={`${port.path}${port.serialNumber ? ` · ${port.serialNumber}` : ""}`}
              onDoubleClick={onNew}
            >
              <Usb size={14} />
              <span>
                <strong>{port.displayName}</strong>
                <small>{port.path}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <footer className="sidebar-footer">
        <span>{ports.length} 个设备</span>
        <button onClick={onNew}>
          <CirclePlus size={15} />
          新建会话
        </button>
      </footer>
    </aside>
  );
}
