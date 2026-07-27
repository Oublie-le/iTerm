import {
  Cable,
  ChevronDown,
  CirclePlus,
  Copy,
  Download,
  Folder,
  Network,
  Pencil,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
  Upload,
  Usb,
} from "lucide-react";
import type {
  AdbDeviceDescriptor,
  RuntimeSession,
  SerialPortDescriptor,
  SessionProfile,
} from "../lib/types";
import { sessionTargetLabel } from "../lib/types";
import { useI18n } from "../lib/i18n";

interface SessionSidebarProps {
  profiles: SessionProfile[];
  ports: SerialPortDescriptor[];
  adbDevices: AdbDeviceDescriptor[];
  sessions: RuntimeSession[];
  filter: string;
  onFilterChange: (value: string) => void;
  onNew: () => void;
  onOpen: (profile: SessionProfile) => void;
  onEdit: (profile: SessionProfile) => void;
  onDuplicate: (profile: SessionProfile) => void;
  onDelete: (profile: SessionProfile) => void;
  onRefresh: () => void;
  onExport: () => void;
  onImport: () => void;
}

export function SessionSidebar({
  profiles,
  ports,
  adbDevices,
  sessions,
  filter,
  onFilterChange,
  onNew,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onRefresh,
  onExport,
  onImport,
}: SessionSidebarProps) {
  const { t } = useI18n();
  const targetLabels = {
    sshUnset: t("profile.target.sshUnset"),
    adbUnset: t("profile.target.adbUnset"),
    serialUnset: t("profile.target.serialUnset"),
  };
  const visibleProfiles = profiles.filter((profile) =>
    `${profile.name} ${profile.group} ${profile.protocol} ${sessionTargetLabel(profile, targetLabels)}`
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
        <span>{t("sidebar.title")}</span>
        <div className="dock-actions">
          <button
            className="icon-button"
            title={t("sidebar.import")}
            aria-label={t("sidebar.import")}
            onClick={onImport}
          >
            <Upload size={15} />
          </button>
          <button
            className="icon-button"
            title={t("sidebar.export")}
            aria-label={t("sidebar.export")}
            onClick={onExport}
            disabled={profiles.length === 0}
          >
            <Download size={15} />
          </button>
          <button
            className="icon-button"
            title={t("sidebar.new")}
            onClick={onNew}
          >
            <CirclePlus size={17} />
          </button>
        </div>
      </header>

      <div className="sidebar-search">
        <Search size={15} />
        <input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={t("sidebar.filter")}
          aria-label={t("sidebar.filter")}
        />
        <button
          className="icon-button"
          title={t("sidebar.refresh")}
          onClick={onRefresh}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="session-tree">
        <div className="tree-group">
          <div className="tree-group-label">
            <ChevronDown size={15} />
            <Folder size={16} />
            <span>{t("sidebar.saved")}</span>
            <span className="tree-count">{visibleProfiles.length}</span>
          </div>
          {visibleProfiles.length === 0 ? (
            <button className="empty-tree-action" onClick={onNew}>
              <CirclePlus size={16} />
              {t("sidebar.empty")}
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
                    title={t("sidebar.interactionHint")}
                  >
                    <span
                      className={`connection-dot state-${runtime?.state ?? "disconnected"}`}
                    />
                    <ProfileIcon size={16} />
                    <span className="tree-session-text">
                      <strong>{profile.name}</strong>
                      <small>{sessionTargetLabel(profile, targetLabels)}</small>
                    </span>
                  </button>
                  <div className="tree-session-actions">
                    <button
                      onClick={() => onEdit(profile)}
                      title={t("sidebar.edit", { name: profile.name })}
                      aria-label={t("sidebar.edit", { name: profile.name })}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => onDuplicate(profile)}
                      title={t("sidebar.duplicate", { name: profile.name })}
                      aria-label={t("sidebar.duplicate", {
                        name: profile.name,
                      })}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={() => onDelete(profile)}
                      title={t("sidebar.delete", { name: profile.name })}
                      aria-label={t("sidebar.delete", { name: profile.name })}
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
            <span>{t("sidebar.available")}</span>
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

        <div className="tree-group port-group">
          <div className="tree-group-label">
            <ChevronDown size={15} />
            <Smartphone size={16} />
            <span>{t("sidebar.adb")}</span>
            <span className="tree-count">{adbDevices.length}</span>
          </div>
          {adbDevices.map((device) => (
            <div key={device.id} className="tree-port">
              <Smartphone size={14} />
              <span>
                <strong>{device.model || device.product || device.id}</strong>
                <small>
                  {device.id} · {device.state}
                </small>
              </span>
            </div>
          ))}
        </div>
      </div>

      <footer className="sidebar-footer">
        <span>
          {t("sidebar.deviceCount", {
            count: ports.length + adbDevices.length,
          })}
        </span>
        <button onClick={onNew}>
          <CirclePlus size={15} />
          {t("sidebar.new")}
        </button>
      </footer>
    </aside>
  );
}
