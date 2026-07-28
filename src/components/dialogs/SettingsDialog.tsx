import React, { useState } from 'react';
import { GeneralSettings } from '../settings/GeneralSettings';
import { PermissionsSettings } from '../settings/PermissionsSettings';
import { EnvironmentSettings } from '../settings/EnvironmentSettings';
import { AdvancedSettings } from '../settings/AdvancedSettings';
import { HooksSettings } from '../settings/HooksSettings';
import { SlashCommandsSettings } from '../settings/SlashCommandsSettings';
import { ProxySettings } from '../settings/ProxySettings';
import { StorageSettings } from '../settings/StorageSettings';
import { LlmProviderSettings } from '../settings/LlmProviderSettings';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const TABS = [
  { id: 'general', label: 'General', icon: '⚙' },
  { id: 'permissions', label: 'Permissions', icon: '🔒' },
  { id: 'environment', label: 'Environment', icon: '📦' },
  { id: 'advanced', label: 'Advanced', icon: '🔧' },
  { id: 'hooks', label: 'Hooks', icon: '🪝' },
  { id: 'commands', label: 'Commands', icon: '/' },
  { id: 'proxy', label: 'Proxy', icon: '🌐' },
  { id: 'storage', label: 'Storage', icon: '💾' },
  { id: 'llm', label: 'LLM Providers', icon: '🤖' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabId>('general');

  if (!isOpen) return null;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general': return <GeneralSettings />;
      case 'permissions': return <PermissionsSettings />;
      case 'environment': return <EnvironmentSettings />;
      case 'advanced': return <AdvancedSettings />;
      case 'hooks': return <HooksSettings />;
      case 'commands': return <SlashCommandsSettings />;
      case 'proxy': return <ProxySettings />;
      case 'storage': return <StorageSettings />;
      case 'llm': return <LlmProviderSettings />;
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxHeight: '85vh' }}>
        <div className="dialog-header">
          <h3 className="dialog-title">Settings</h3>
          <button className="dialog-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="dialog-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`dialog-tab ${activeTab === tab.id ? 'dialog-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              style={{ flex: 'none', padding: '6px 10px', fontSize: 12 }}
            >
              <span style={{ marginRight: 4 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="dialog-body" style={{ minHeight: 300 }}>
          {renderTabContent()}
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
