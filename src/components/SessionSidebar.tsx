import {
  Cable,
  ChevronDown,
  CirclePlus,
  Copy,
  Folder,
  Network,
  Pencil,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
  Usb,
} from "lucide-react";
import type {
  RuntimeSession,
  SerialPortDescriptor,
  SessionProfile,
} from "../lib/types";
import { sessionTargetLabel } from "../lib/types";

interface SessionSidebarProps {
  profiles: SessionProfile[];
  ports: SerialPortDescriptor[];
  sessions: RuntimeSession[];
  filter: string;
  onFilterChange: (value: string) => void;
  onNew: () => void;
  onOpen: (profile: SessionProfile) => void;
  onEdit: (profile: SessionProfile) => void;
  onDuplicate: (profile: SessionProfile) => void;
  onDelete: (profile: SessionProfile) => void;
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
  onDuplicate,
  onDelete,
  onRefresh,
}: SessionSidebarProps) {
  const visibleProfiles = profiles.filter((profile) =>
    `${profile.name} ${profile.group} ${profile.protocol} ${sessionTargetLabel(profile)}`
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase()),
  );

  const protocolIcon = (profile: SessionProfile) => {
    if (profile.protocol === "ssh") return Network;
    if (profile.protocol === "adb") return Smartphone;
    return Cable;
  };

  return (
    <aside className="session-sidebar">
      <header className="dock-title">
        <span className="dock-title-mark" />
        <span>会话管理器</span>
        <button className="icon-button" title="新建会话" onClick={onNew}>
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
            <span>保存的会话</span>
            <span className="tree-count">{visibleProfiles.length}</span>
          </div>
          {visibleProfiles.length === 0 ? (
            <button className="empty-tree-action" onClick={onNew}>
              <CirclePlus size={16} />
              新建第一个会话
            </button>
          ) : (
            visibleProfiles.map((profile) => {
              const runtime = sessions.find(
                (session) => session.profileId === profile.id,
              );
              const ProfileIcon = protocolIcon(profile);
              return (
                <div key={profile.id} className="tree-session-row">
                  <button
                    className="tree-session"
                    onDoubleClick={() => onOpen(profile)}
                    onClick={() => (runtime ? onOpen(profile) : onEdit(profile))}
                    title="双击连接，单击打开或编辑"
                  >
                    <span
                      className={`connection-dot state-${runtime?.state ?? "disconnected"}`}
                    />
                    <ProfileIcon size={16} />
                    <span className="tree-session-text">
                      <strong>{profile.name}</strong>
                      <small>{sessionTargetLabel(profile)}</small>
                    </span>
                  </button>
                  <div className="tree-session-actions">
                    <button
                      onClick={() => onEdit(profile)}
                      title={`编辑 ${profile.name}`}
                      aria-label={`编辑 ${profile.name}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => onDuplicate(profile)}
                      title={`复制 ${profile.name}`}
                      aria-label={`复制 ${profile.name}`}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={() => onDelete(profile)}
                      title={`删除 ${profile.name}`}
                      aria-label={`删除 ${profile.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
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
