'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { 
  Settings, 
  Database, 
  Server, 
  ShieldAlert, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Trash2, 
  X,
  HardDrive,
  Edit,
  FileCode2,
  Users,
  Key,
  Activity,
  Compass,
  CloudLightning,
  RefreshCw,
  RotateCcw,
  Briefcase
} from 'lucide-react';
import { api, ClusterConfig, InfluxServerConfig, K6Template, K6TemplateType, User, UserWorkspaceMembership, WorkspaceGroupMapping, SSOConfig, APIToken, RunDefaults } from '@/services/api';
import { RUNNER_IMAGE_PLACEHOLDER } from '@/utils/clusterImage';
import { usePreferences, ColorPalette, Language, Theme, CustomPalette, defaultPalettes } from '@/components/PreferencesContext';
import PaletteEditorModal from '@/components/PaletteEditorModal';
import K6ScriptEditor from '@/components/K6ScriptEditor';
import LocalContextPicker, { localClusterName, sortLocalContexts } from '@/components/LocalContextPicker';
import { scriptHasStages } from '@/utils/k6ScriptStages';

type SettingsTab = 'kubernetes' | 'influxdb' | 'templates' | 'security' | 'users' | 'workspaces' | 'appearance';
const ADMIN_ONLY_TABS: SettingsTab[] = ['kubernetes', 'influxdb', 'templates', 'users', 'workspaces'];

export default function SettingsPage() {
  const {
    t,
    lang,
    colorPalette,
    setColorPalette,
    palettes,
    addCustomPalette,
    deleteCustomPalette,
    resetToDefaultPalettes,
    isBuiltinPalette,
  } = usePreferences();
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('kubernetes');
  const pathname = usePathname();
  const [isPaletteModalOpen, setIsPaletteModalOpen] = useState(false);
  const [editingPalette, setEditingPalette] = useState<CustomPalette | null>(null);
  const [paletteDuplicateMode, setPaletteDuplicateMode] = useState(false);
  const [defaultPaletteForNewUsers, setDefaultPaletteForNewUsers] = useState<ColorPalette>('royal-vibrant');
  const [defaultLanguageForNewUsers, setDefaultLanguageForNewUsers] = useState<Language>('en');
  const [defaultThemeForNewUsers, setDefaultThemeForNewUsers] = useState<Theme>('light');
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const requestConfirm = (title: string, message: React.ReactNode, onConfirm: () => void | Promise<void>) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      onConfirm: async () => {
        setConfirmDialog(null);
        await onConfirm();
      }
    });
  };

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  
  // K8s Clusters settings state
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [deletingCluster, setDeletingCluster] = useState<ClusterConfig | null>(null);
  const [confirmClusterName, setConfirmClusterName] = useState('');
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // AWS EKS Discovery states
  const [discoveryConfig, setDiscoveryConfig] = useState<any>(null);
  const [discoveredClusters, setDiscoveredClusters] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoverySuccess, setDiscoverySuccess] = useState<string | null>(null);
  const [selectedDiscovered, setSelectedDiscovered] = useState<string[]>([]);
  
  const [newCluster, setNewCluster] = useState({
    name: '',
    api_server_url: '',
    auth_type: 'token',
    raw_secret: '',
    ca_cert_base64: '',
    aws_account_id: '',
  });
  const [allowedNamespaces, setAllowedNamespaces] = useState<string[]>([]);
  const [customNamespaceInput, setCustomNamespaceInput] = useState('');
  const [discoveredNamespaces, setDiscoveredNamespaces] = useState<string[]>([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null);
  
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState('');

  // Local contexts settings state
  const [localContexts, setLocalContexts] = useState<{ context_name: string; cluster_name: string; api_server_url: string; is_current: boolean }[]>([]);
  const [loadingContexts, setLoadingContexts] = useState(false);

  const loadLocalContexts = async () => {
    try {
      setLoadingContexts(true);
      const data = await api.getLocalContexts();
      const contexts = sortLocalContexts(data.contexts || []);
      setLocalContexts(contexts);
      
      setNewCluster(prev => {
        if (prev.auth_type !== 'local') return prev;
        const saved = isEditing ? clusters.find(cluster => cluster.id === editingClusterId) : undefined;
        const selectedContext = prev.raw_secret || saved?.local_context;
        const selected = selectedContext
          ? contexts.find(context => context.context_name === selectedContext)
          : isEditing
            ? contexts.find(context => context.api_server_url === prev.api_server_url)
            : contexts.find(context => context.context_name === data.current_context) || contexts[0];
        if (!selected) return prev;
        return {
          ...prev,
          raw_secret: selected.context_name,
          api_server_url: selected.api_server_url,
          name: prev.name || localClusterName(selected),
        };
      });
    } catch (err) {
      console.error('Failed to load local contexts', err);
    } finally {
      setLoadingContexts(false);
    }
  };

  useEffect(() => {
    if (newCluster.auth_type === 'local' && isModalOpen) {
      loadLocalContexts();
    }
  }, [newCluster.auth_type, isModalOpen]);

  // InfluxDB settings state
  const [influxServers, setInfluxServers] = useState<InfluxServerConfig[]>([]);
  const [loadingInfluxServers, setLoadingInfluxServers] = useState(false);
  const [isInfluxModalOpen, setIsInfluxModalOpen] = useState(false);
  const [isEditingInflux, setIsEditingInflux] = useState(false);
  const [editingInfluxId, setEditingInfluxId] = useState<string | null>(null);

  const [influxConfig, setInfluxConfig] = useState({
    name: '',
    version: 'v2',
    url: '',
    token: '',
    org: '',
    bucket: '',
    username: '',
    password: '',
    method: 'POST',
    has_token: false,
    has_password: false
  });
  const [useInfluxAuth, setUseInfluxAuth] = useState(false);
  const [savingInflux, setSavingInflux] = useState(false);
  const [influxSuccess, setInfluxSuccess] = useState('');
  const [influxError, setInfluxError] = useState('');
  const [testingInflux, setTestingInflux] = useState(false);
  const [influxTestSuccess, setInfluxTestSuccess] = useState('');
  const [influxTestError, setInfluxTestError] = useState('');

  const loadInfluxServers = async () => {
    try {
      setLoadingInfluxServers(true);
      const list = await api.getInfluxServers();
      setInfluxServers(list || []);
    } catch (err) {
      console.error('Failed to load InfluxDB servers', err);
    } finally {
      setLoadingInfluxServers(false);
    }
  };

  const handleStartAddInflux = () => {
    setIsEditingInflux(false);
    setEditingInfluxId(null);
    setInfluxConfig({
      name: '',
      version: 'v2',
      url: '',
      token: '',
      org: '',
      bucket: '',
      username: '',
      password: '',
      method: 'POST',
    has_token: false,
    has_password: false
    });
    setUseInfluxAuth(false);
    setInfluxSuccess('');
    setInfluxError('');
    setInfluxTestSuccess('');
    setInfluxTestError('');
    setIsInfluxModalOpen(true);
  };

  const handleStartEditInflux = (server: InfluxServerConfig) => {
    setIsEditingInflux(true);
    setEditingInfluxId(server.id);
    setInfluxConfig({
      name: server.name,
      version: server.version,
      url: server.url,
      token: server.token || '',
      org: server.org || '',
      bucket: server.bucket,
      username: server.username || '',
      password: server.password || '',
      method: server.method || 'POST',
      has_token: !!server.has_token,
      has_password: !!server.has_password
    });
    setUseInfluxAuth(!!(server.username || server.has_password));
    setInfluxSuccess('');
    setInfluxError('');
    setInfluxTestSuccess('');
    setInfluxTestError('');
    setIsInfluxModalOpen(true);
  };

  const handleSaveInfluxServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setInfluxSuccess('');
    setInfluxError('');
    setSavingInflux(true);

    try {
      const payload = {
        ...influxConfig,
        username: useInfluxAuth ? influxConfig.username : '',
        password: useInfluxAuth ? influxConfig.password : ''
      };

      const res = await api.setInfluxConfig(payload);
      if (res && res.warning) {
        setInfluxSuccess(`${t('influxSavedSuccess')} ${res.warning}`);
      } else {
        setInfluxSuccess(t('influxSavedSuccess'));
      }
      await loadUniqueInfluxConfig();
    } catch (err: any) {
      setInfluxError(err.message || t('influxSettingsError'));
    } finally {
      setSavingInflux(false);
    }
  };

  const handleDeleteInfluxServer = async (id: string, name: string) => {
    requestConfirm(
      t('deleteInfluxServerTitle'),
      <span>{t('deleteInfluxServerConfirm', { name })}</span>,
      async () => {
        try {
          await api.deleteInfluxServer(id);
          await loadInfluxServers();
          showToast(t('influxDeletedSuccess', { name }), 'success');
        } catch (err: any) {
          showToast(err.message || t('influxDeleteError'), 'error');
        }
      }
    );
  };

  const handleActivateInfluxServer = async (id: string) => {
    try {
      await api.activateInfluxServer(id);
      await loadInfluxServers();
      showToast(t('influxActivatedSuccess'), 'success');
    } catch (err: any) {
      showToast(err.message || t('influxActivateError'), 'error');
    }
  };

  const handleTestInfluxConfig = async (e: React.MouseEvent) => {
    e.preventDefault();
    setInfluxTestSuccess('');
    setInfluxTestError('');
    setTestingInflux(true);

    try {
      const payload = {
        ...influxConfig,
        username: useInfluxAuth ? influxConfig.username : '',
        password: useInfluxAuth ? influxConfig.password : ''
      };
      await api.testInfluxConfig(payload);
      setInfluxTestSuccess(t('influxTestVerified'));
    } catch (err: any) {
      setInfluxTestError(err.message || t('influxTestFailed'));
    } finally {
      setTestingInflux(false);
    }
  };

  // K6 Run Templates state
  const [templates, setTemplates] = useState<K6Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [isSaveAsNewTemplateModalOpen, setIsSaveAsNewTemplateModalOpen] = useState(false);
  const [saveAsNewTemplateName, setSaveAsNewTemplateName] = useState('');
  const [saveAsNewTemplateError, setSaveAsNewTemplateError] = useState('');

  const DEFAULT_SCRIPT_TEMPLATE = `import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  vus: 1,
  duration: '10s',
};

export default function () {
  http.get('https://test.k6.io');
  sleep(1);
}`;

  const [templateConfig, setTemplateConfig] = useState({
    name: '',
    template_type: 'testrun' as K6TemplateType,
    parallelism: 1,
    script_name: 'k6-test-script',
    script_file: 'test.js',
    runner_image: '',
    cpu_limit: '10m',
    mem_limit: '16Mi',
    script_content: DEFAULT_SCRIPT_TEMPLATE,
    schedule_enabled: false,
    schedule_cron_expression: '0 11 * * *',
    schedule_active: true,
    schedule_cluster_id: '',
    schedule_namespace: '',
  });
  const [templateScheduleNamespaces, setTemplateScheduleNamespaces] = useState<string[]>([]);

  const templateTypeLabel = (type: K6TemplateType | string) => {
    switch (type) {
      case 'cronjob':
        return t('templateTypeCronJob');
      case 'job':
        return t('templateTypeJob');
      default:
        return t('templateTypeTestRun');
    }
  };

  const loadTemplateScheduleNamespaces = async (clusterId: string) => {
    if (!clusterId) {
      setTemplateScheduleNamespaces([]);
      return;
    }
    try {
      const ns = await api.getNamespaces(clusterId);
      setTemplateScheduleNamespaces(ns || []);
    } catch {
      setTemplateScheduleNamespaces([]);
    }
  };

  const loadTemplates = async () => {
    try {
      setLoadingTemplates(true);
      const list = await api.getTemplates();
      setTemplates(list || []);
    } catch (err) {
      console.error('Failed to load templates', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleStartAddTemplate = () => {
    setIsEditingTemplate(false);
    setEditingTemplateId(null);
    const defaultClusterId = clusters[0]?.id || '';
    setTemplateConfig({
      name: '',
      template_type: 'testrun',
      parallelism: 1,
      script_name: 'k6-test-script',
      script_file: 'test.js',
      runner_image: '',
      cpu_limit: '10m',
      mem_limit: '16Mi',
      script_content: DEFAULT_SCRIPT_TEMPLATE,
      schedule_enabled: false,
      schedule_cron_expression: '0 11 * * *',
      schedule_active: true,
      schedule_cluster_id: defaultClusterId,
      schedule_namespace: 'default',
    });
    if (defaultClusterId) {
      loadTemplateScheduleNamespaces(defaultClusterId);
    }
    setTemplateError('');
    setIsTemplateModalOpen(true);
  };

  const handleStartEditTemplate = (tmpl: K6Template) => {
    setIsEditingTemplate(true);
    setEditingTemplateId(tmpl.id);
    setTemplateConfig({
      name: tmpl.name,
      template_type: tmpl.template_type || 'testrun',
      parallelism: tmpl.parallelism || 1,
      script_name: tmpl.script_name,
      script_file: tmpl.script_file,
      runner_image: tmpl.runner_image || '',
      cpu_limit: tmpl.cpu_limit,
      mem_limit: tmpl.mem_limit,
      script_content: tmpl.script_content,
      schedule_enabled: tmpl.schedule_enabled || false,
      schedule_cron_expression: tmpl.schedule_cron_expression || '0 11 * * *',
      schedule_active: tmpl.schedule_active !== false,
      schedule_cluster_id: tmpl.schedule_cluster_id || clusters[0]?.id || '',
      schedule_namespace: tmpl.schedule_namespace || 'default',
    });
    if (tmpl.schedule_cluster_id || clusters[0]?.id) {
      loadTemplateScheduleNamespaces(tmpl.schedule_cluster_id || clusters[0]?.id || '');
    }
    setTemplateError('');
    setIsTemplateModalOpen(true);
  };

  const handleSaveTemplateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setTemplateError('');
    setSavingTemplate(true);

    try {
      if (isEditingTemplate && editingTemplateId) {
        await api.updateTemplate(editingTemplateId, templateConfig);
      } else {
        await api.createTemplate(templateConfig);
      }
      setIsTemplateModalOpen(false);
      await loadTemplates();
    } catch (err: any) {
      setTemplateError(err.message || t('templateSaveError'));
    } finally {
      setSavingTemplate(false);
    }
  };

  const openSaveAsNewTemplateModal = () => {
    const baseName = templateConfig.name.trim();
    if (!baseName) {
      setTemplateError(t('allFieldsRequired'));
      return;
    }

    const original = templates.find((tmpl) => tmpl.id === editingTemplateId);
    const defaultName =
      original && baseName === original.name.trim()
        ? `${baseName} (copy)`
        : baseName;

    setSaveAsNewTemplateName(defaultName);
    setSaveAsNewTemplateError('');
    setIsSaveAsNewTemplateModalOpen(true);
  };

  const handleConfirmSaveAsNewTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveAsNewTemplateError('');

    const name = saveAsNewTemplateName.trim();
    if (!name) {
      setSaveAsNewTemplateError(t('allFieldsRequired'));
      return;
    }

    setSavingTemplate(true);
    try {
      await api.createTemplate({ ...templateConfig, name });
      setIsSaveAsNewTemplateModalOpen(false);
      setIsTemplateModalOpen(false);
      setIsEditingTemplate(false);
      setEditingTemplateId(null);
      await loadTemplates();
      showToast(t('templateSavedAsNewSuccess', { name }), 'success');
    } catch (err: any) {
      setSaveAsNewTemplateError(err.message || t('templateSaveError'));
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (id: string, name: string) => {
    requestConfirm(
      t('deleteTemplateTitle'),
      <span>{t('deleteTemplateConfirm', { name })}</span>,
      async () => {
        try {
          await api.deleteTemplate(id);
          await loadTemplates();
          showToast(t('templateDeletedSuccess', { name }), 'success');
        } catch (err: any) {
          showToast(err.message || t('templateDeleteError'), 'error');
        }
      }
    );
  };

  // User Management state
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [newUserAccount, setNewUserAccount] = useState({
    username: '',
    password: '',
    role: 'editor'
  });
  const [editUserAccount, setEditUserAccount] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    role: 'editor'
  });
  const [userError, setUserError] = useState('');
  const [savingUser, setSavingUser] = useState(false);

  // Workspaces state
  const [workspacesList, setWorkspacesList] = useState<{ id: string; name: string; created_at: string }[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState({ id: '', name: '' });
  const [workspaceError, setWorkspaceError] = useState('');
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState<{ id: string; name: string } | null>(null);
  const [confirmWorkspaceName, setConfirmWorkspaceName] = useState('');

  const deletingWorkspaceClustersCount = deletingWorkspace 
    ? clusters.filter(c => c.workspace_id === deletingWorkspace.id).length 
    : 0;
  const deletingWorkspaceTemplatesCount = deletingWorkspace 
    ? templates.filter(t => t.workspace_id === deletingWorkspace.id).length 
    : 0;

  const [selectedWorkspaceForMembers, setSelectedWorkspaceForMembers] = useState<string>('');
  const [workspaceMembers, setWorkspaceMembers] = useState<{ workspace_id: string; username: string; role: string; source?: string }[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [newMemberUsername, setNewMemberUsername] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('viewer');
  const [workspaceGroupMappings, setWorkspaceGroupMappings] = useState<WorkspaceGroupMapping[]>([]);
  const [loadingGroupMappings, setLoadingGroupMappings] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupRole, setNewGroupRole] = useState('viewer');
  const [editUserWorkspaces, setEditUserWorkspaces] = useState<UserWorkspaceMembership[]>([]);
  const [loadingEditUserWorkspaces, setLoadingEditUserWorkspaces] = useState(false);
  const [newUserWorkspaceId, setNewUserWorkspaceId] = useState('');
  const [newUserWorkspaceRole, setNewUserWorkspaceRole] = useState('viewer');

  // API Tokens state
  const [apiTokens, setApiTokens] = useState<APIToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenRole, setNewTokenRole] = useState('editor');
  const [newTokenExpiry, setNewTokenExpiry] = useState(0); // 0 = Never
  const [generatedToken, setGeneratedToken] = useState<APIToken | null>(null);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  // Self-service personal tokens state (available to all authenticated users)
  const [myTokens, setMyTokens] = useState<APIToken[]>([]);
  const [loadingMyTokens, setLoadingMyTokens] = useState(false);
  const [myTokenName, setMyTokenName] = useState('');
  const [myTokenExpiry, setMyTokenExpiry] = useState(7);
  const [myTokenMCPReadOnly, setMyTokenMCPReadOnly] = useState(false);
  const [myGeneratedToken, setMyGeneratedToken] = useState<APIToken | null>(null);
  const [isMyTokenModalOpen, setIsMyTokenModalOpen] = useState(false);
  const [copiedMyToken, setCopiedMyToken] = useState(false);
  const [myTokenRevokeTarget, setMyTokenRevokeTarget] = useState<APIToken | null>(null);
  const [myTokenCreating, setMyTokenCreating] = useState(false);
  const [myTokenError, setMyTokenError] = useState('');

  // SSO state
  const [ssoConfig, setSsoConfig] = useState<SSOConfig>({
    name: '',
    enabled: false,
    issuer_url: '',
    client_id: '',
    client_secret: '',
    redirect_uri: typeof window !== 'undefined' ? `${window.location.origin}/login` : 'http://localhost:3000/login',
    admin_groups: '',
    editor_groups: ''
  });
  const [loadingSSO, setLoadingSSO] = useState(false);
  const [ssoSuccess, setSsoSuccess] = useState('');
  const [ssoError, setSsoError] = useState('');
  const [savingSSO, setSavingSSO] = useState(false);

  // Run Defaults state
  const DEFAULT_OUTPUT_ARGS = '--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s';
  const [runDefaults, setRunDefaults] = useState<RunDefaults>({
    output_args: DEFAULT_OUTPUT_ARGS,
    use_output:  false,
    use_image:   false,
    image_url:   '',
    env_vars:    [],
  });
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsSuccess, setDefaultsSuccess] = useState(false);
  const [defaultsError, setDefaultsError] = useState('');

  const loadRunDefaults = async () => {
    try {
      const d = await api.getRunDefaults();
      setRunDefaults({
        ...d,
        env_vars: d.env_vars || [],
      });
    } catch (err) {
      console.error('Failed to load run defaults', err);
    }
  };

  const handleAddDefaultEnv = () => {
    setRunDefaults(d => ({ ...d, env_vars: [...d.env_vars, { key: '', value: '' }] }));
  };

  const handleUpdateDefaultEnv = (index: number, field: 'key' | 'value', value: string) => {
    setRunDefaults(d => ({
      ...d,
      env_vars: d.env_vars.map((entry, idx) => (
        idx === index ? { ...entry, [field]: value } : entry
      )),
    }));
  };

  const handleRemoveDefaultEnv = (index: number) => {
    setRunDefaults(d => ({
      ...d,
      env_vars: d.env_vars.filter((_, idx) => idx !== index),
    }));
  };

  const handleSaveRunDefaults = async (e: React.FormEvent) => {
    e.preventDefault();
    setDefaultsError('');
    setDefaultsSuccess(false);
    setSavingDefaults(true);
    try {
      await api.saveRunDefaults(runDefaults);
      setDefaultsSuccess(true);
      setTimeout(() => setDefaultsSuccess(false), 3000);
    } catch (err: any) {
      setDefaultsError(err.message || t('defaultsSaveError'));
    } finally {
      setSavingDefaults(false);
    }
  };

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const list = await api.getUsers();
      setUsers(list || []);
    } catch (err) {
      console.error('Failed to load users', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadWorkspaces = async () => {
    try {
      setLoadingWorkspaces(true);
      const list = await api.getWorkspaces();
      setWorkspacesList(list || []);
      if (list && list.length > 0 && !selectedWorkspaceForMembers) {
        setSelectedWorkspaceForMembers(list[0].id);
      }
    } catch (err) {
      console.error('Failed to load workspaces', err);
    } finally {
      setLoadingWorkspaces(false);
    }
  };

  const loadWorkspaceMembers = async (wsId: string) => {
    if (!wsId) return;
    try {
      setLoadingMembers(true);
      const list = await api.getWorkspaceMembers(wsId);
      setWorkspaceMembers(list || []);
    } catch (err) {
      console.error('Failed to load workspace members', err);
    } finally {
      setLoadingMembers(false);
    }
  };

  const loadWorkspaceGroupMappings = async (wsId: string) => {
    if (!wsId) return;
    try {
      setLoadingGroupMappings(true);
      const list = await api.getWorkspaceGroupMappings(wsId);
      setWorkspaceGroupMappings(list || []);
    } catch (err) {
      console.error('Failed to load workspace group mappings', err);
    } finally {
      setLoadingGroupMappings(false);
    }
  };

  const handleSaveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setWorkspaceError('');
    setSavingWorkspace(true);
    try {
      await api.createWorkspace(newWorkspace.id, newWorkspace.name);
      setIsWorkspaceModalOpen(false);
      setNewWorkspace({ id: '', name: '' });
      await loadWorkspaces();
      showToast(t('workspaceCreatedSuccess') || 'Workspace created successfully', 'success');
    } catch (err: any) {
      setWorkspaceError(err.message || 'Failed to save workspace');
    } finally {
      setSavingWorkspace(false);
    }
  };

  const handleSaveWorkspaceGroupMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkspaceForMembers || !newGroupName.trim()) return;
    try {
      await api.addWorkspaceGroupMapping(selectedWorkspaceForMembers, newGroupName.trim(), newGroupRole);
      setNewGroupName('');
      await loadWorkspaceGroupMappings(selectedWorkspaceForMembers);
      showToast(t('workspaceGroupAddedSuccess'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to add SSO group mapping', 'error');
    }
  };

  const handleDeleteWorkspaceGroupMapping = async (idpGroup: string) => {
    if (!selectedWorkspaceForMembers) return;
    try {
      await api.deleteWorkspaceGroupMapping(selectedWorkspaceForMembers, idpGroup);
      await loadWorkspaceGroupMappings(selectedWorkspaceForMembers);
      showToast(t('workspaceGroupRemovedSuccess'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove SSO group mapping', 'error');
    }
  };

  const handleDeleteWorkspaceMember = async (username: string) => {
    if (!selectedWorkspaceForMembers) return;
    try {
      await api.deleteWorkspaceMember(selectedWorkspaceForMembers, username);
      await loadWorkspaceMembers(selectedWorkspaceForMembers);
      await loadUsers();
      showToast(t('workspaceMemberRemovedSuccess'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove member', 'error');
    }
  };

  const loadEditUserWorkspaces = async (username: string) => {
    try {
      setLoadingEditUserWorkspaces(true);
      const list = await api.getUserWorkspaces(username);
      setEditUserWorkspaces(list || []);
    } catch (err) {
      console.error('Failed to load user workspaces', err);
      setEditUserWorkspaces([]);
    } finally {
      setLoadingEditUserWorkspaces(false);
    }
  };

  const handleAddUserWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUserAccount.username || !newUserWorkspaceId) return;
    try {
      await api.addWorkspaceMember(newUserWorkspaceId, editUserAccount.username, newUserWorkspaceRole);
      setNewUserWorkspaceId('');
      await loadEditUserWorkspaces(editUserAccount.username);
      await loadUsers();
      showToast(t('workspaceMemberAddedSuccess') || 'Member added successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to add workspace access', 'error');
    }
  };

  const handleRemoveUserWorkspace = async (workspaceId: string) => {
    if (!editUserAccount.username) return;
    try {
      await api.deleteWorkspaceMember(workspaceId, editUserAccount.username);
      await loadEditUserWorkspaces(editUserAccount.username);
      await loadUsers();
      showToast(t('workspaceMemberRemovedSuccess'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove workspace access', 'error');
    }
  };

  const handleSaveWorkspaceMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkspaceForMembers || !newMemberUsername) return;
    try {
      await api.addWorkspaceMember(selectedWorkspaceForMembers, newMemberUsername, newMemberRole);
      setNewMemberUsername('');
      await loadWorkspaceMembers(selectedWorkspaceForMembers);
      await loadUsers();
      showToast(t('workspaceMemberAddedSuccess') || 'Member added successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to add member', 'error');
    }
  };

  useEffect(() => {
    if (selectedWorkspaceForMembers) {
      loadWorkspaceMembers(selectedWorkspaceForMembers);
      loadWorkspaceGroupMappings(selectedWorkspaceForMembers);
    }
  }, [selectedWorkspaceForMembers]);

  const handleDeleteWorkspaceClick = async (wsId: string, wsName: string) => {
    if (wsId === 'default') {
      showToast(t('cannotDeleteDefaultWorkspace') || 'Cannot delete the default workspace', 'error');
      return;
    }
    setConfirmWorkspaceName('');
    setDeletingWorkspace({ id: wsId, name: wsName });
  };

  const confirmDeleteWorkspace = async () => {
    if (!deletingWorkspace) return;
    const wsId = deletingWorkspace.id;
    try {
      await api.deleteWorkspace(wsId);
      if (selectedWorkspaceForMembers === wsId) {
        setSelectedWorkspaceForMembers('');
        setWorkspaceMembers([]);
      }
      setDeletingWorkspace(null);
      setConfirmWorkspaceName('');
      const activeWs = localStorage.getItem('active_workspace_id');
      if (activeWs === wsId) {
        localStorage.setItem('active_workspace_id', 'default');
        window.location.reload();
      } else {
        await loadWorkspaces();
      }
      showToast(t('workspaceDeletedSuccess') || 'Workspace deleted successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete workspace', 'error');
    }
  };

  const loadSSOConfig = async () => {
    try {
      setLoadingSSO(true);
      const config = await api.getSSOConfig();
      if (config) {
        setSsoConfig({
          name: config.name || '',
          enabled: config.enabled,
          issuer_url: config.issuer_url || '',
          client_id: config.client_id || '',
          client_secret: config.client_secret || '',
          has_client_secret: config.has_client_secret,
          redirect_uri: config.redirect_uri || (typeof window !== 'undefined' ? `${window.location.origin}/login` : 'http://localhost:3000/login'),
          admin_groups: config.admin_groups !== undefined ? config.admin_groups : '',
          editor_groups: config.editor_groups !== undefined ? config.editor_groups : ''
        });
      }
    } catch (err) {
      console.error('Failed to load SSO configuration', err);
    } finally {
      setLoadingSSO(false);
    }
  };

  const [influxEnvDefined, setInfluxEnvDefined] = useState(false);

  const loadUniqueInfluxConfig = async () => {
    try {
      const config = await api.getInfluxConfig();
      if (config) {
        setInfluxConfig({
          name: config.name || t('defaultInfluxName'),
          version: config.version || 'v2',
          url: config.url || '',
          token: config.token || '',
          org: config.org || '',
          bucket: config.bucket || '',
          username: config.username || '',
          password: config.password || '',
          method: config.method || 'POST',
          has_token: !!config.has_token,
          has_password: !!config.has_password
        });
        setUseInfluxAuth(!!(config.username || config.has_password));
        setInfluxEnvDefined(!!config.env_defined);
      }
    } catch (err) {
      console.error('Failed to load InfluxDB config', err);
    }
  };

  const handleStartAddUser = () => {
    setNewUserAccount({
      username: '',
      password: '',
      role: 'editor'
    });
    setUserError('');
    setIsUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError('');
    setSavingUser(true);

    try {
      await api.createUser(newUserAccount);
      setIsUserModalOpen(false);
      await loadUsers();
    } catch (err: any) {
      setUserError(err.message || t('userSaveError'));
    } finally {
      setSavingUser(false);
    }
  };

  const handleStartEditUser = (user: User) => {
    setEditUserAccount({
      username: user.username,
      password: '',
      confirmPassword: '',
      role: user.role,
    });
    setNewUserWorkspaceId('');
    setNewUserWorkspaceRole('viewer');
    setUserError('');
    setIsEditUserModalOpen(true);
    loadEditUserWorkspaces(user.username);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError('');

    if (editUserAccount.password && editUserAccount.password !== editUserAccount.confirmPassword) {
      setUserError(t('passwordMismatch'));
      return;
    }

    setSavingUser(true);
    try {
      const payload: { role: string; password?: string } = { role: editUserAccount.role };
      if (editUserAccount.password.trim()) {
        payload.password = editUserAccount.password;
      }
      await api.updateUser(editUserAccount.username, payload);
      setIsEditUserModalOpen(false);
      await loadUsers();
      showToast(t('userUpdatedSuccess'), 'success');
    } catch (err: any) {
      setUserError(err.message || t('userSaveError'));
    } finally {
      setSavingUser(false);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (username === 'admin') {
      showToast(t('cannotDeleteAdmin'), 'error');
      return;
    }
    requestConfirm(
      t('deleteUserTitle'),
      <span>{t('deleteUserConfirm', { name: username })}</span>,
      async () => {
        try {
          await api.deleteUser(username);
          await loadUsers();
          showToast(t('userDeletedSuccess', { name: username }), 'success');
        } catch (err: any) {
          showToast(err.message || t('userDeleteError'), 'error');
        }
      }
    );
  };

  const handleSaveSSO = async (e: React.FormEvent) => {
    e.preventDefault();
    setSsoSuccess('');
    setSsoError('');
    setSavingSSO(true);

    try {
      await api.saveSSOConfig(ssoConfig);
      setSsoSuccess(t('ssoSavedSuccess'));
      await loadSSOConfig();
    } catch (err: any) {
      setSsoError(err.message || t('ssoSaveError'));
    } finally {
      setSavingSSO(false);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const role = localStorage.getItem('role');
      setIsAdmin(role === 'administrator');
    }
  }, []);

  useEffect(() => {
    if (isAdmin === null || pathname !== '/settings') return;
    setActiveSettingsTab(isAdmin ? 'kubernetes' : 'security');
  }, [pathname, isAdmin]);

  useEffect(() => {
    if (isAdmin === null) return;
    if (!isAdmin && ADMIN_ONLY_TABS.includes(activeSettingsTab)) {
      setActiveSettingsTab('security');
    }
  }, [isAdmin, activeSettingsTab]);

  const handleSaveCustomPalette = (palette: CustomPalette) => {
    const wasEditing = Boolean(editingPalette) && !paletteDuplicateMode;
    addCustomPalette(palette);
    setIsPaletteModalOpen(false);
    setEditingPalette(null);
    setPaletteDuplicateMode(false);
    setColorPalette(palette.id);
    showToast(wasEditing ? t('paletteUpdatedSuccess') : t('paletteAddedSuccess'), 'success');
  };

  const handleEditPaletteClick = (e: React.MouseEvent, palette: CustomPalette, displayName: string) => {
    e.stopPropagation();
    if (isBuiltinPalette(palette.id)) {
      setEditingPalette({
        ...palette,
        name: `${displayName} (${t('custom')})`,
      });
      setPaletteDuplicateMode(true);
    } else {
      setEditingPalette(palette);
      setPaletteDuplicateMode(false);
    }
    setIsPaletteModalOpen(true);
  };

  const handleDeletePaletteClick = (e: React.MouseEvent, palette: CustomPalette, displayName: string) => {
    e.stopPropagation();
    requestConfirm(
      t('deletePaletteTitle'),
      <span>{t('deletePaletteConfirm', { name: displayName })}</span>,
      () => {
        deleteCustomPalette(palette.id);
        showToast(t('paletteDeletedSuccess'), 'info');
      }
    );
  };

  const settingsTabs: { id: SettingsTab; label: string; icon: typeof Server; adminOnly?: boolean }[] = [
    { id: 'kubernetes', label: t('k8sClusters'), icon: Server, adminOnly: true },
    { id: 'influxdb', label: t('influxdb'), icon: Database, adminOnly: true },
    { id: 'templates', label: t('k6RunTemplates'), icon: FileCode2, adminOnly: true },
    { id: 'security', label: t('apiTokens'), icon: Key },
    { id: 'users', label: t('userManagement'), icon: Users, adminOnly: true },
    { id: 'workspaces', label: t('workspaces') || 'Workspaces', icon: Briefcase, adminOnly: true },
    { id: 'appearance', label: t('colorPalette'), icon: Activity },
  ];

  const visibleSettingsTabs = settingsTabs.filter((tab) => isAdmin || !tab.adminOnly);

  const loadAPITokens = async () => {
    try {
      setLoadingTokens(true);
      const list = await api.getAPITokens();
      setApiTokens(list || []);
    } catch (err) {
      console.error('Failed to load API tokens', err);
    } finally {
      setLoadingTokens(false);
    }
  };

  const handleGenerateAPIToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName) return;
    try {
      const tok = await api.createAPIToken(newTokenName, newTokenRole, newTokenExpiry);
      setGeneratedToken(tok);
      setIsTokenModalOpen(true);
      setNewTokenName('');
      setNewTokenRole('editor');
      setNewTokenExpiry(0);
      await loadAPITokens();
    } catch (err: any) {
      showToast(err.message || t('tokenGenerateError'), 'error');
    }
  };

  const handleDeleteAPIToken = async (tokenHash: string, name: string) => {
    requestConfirm(
      t('deleteTokenTitle'),
      <span>{t('deleteTokenConfirm', { name })}</span>,
      async () => {
        try {
          await api.deleteAPIToken(tokenHash);
          await loadAPITokens();
          showToast(t('tokenDeletedSuccess', { name }), 'success');
        } catch (err: any) {
          showToast(err.message || t('tokenDeleteError'), 'error');
        }
      }
    );
  };

  // --- Self-service (personal) token handlers ---
  const loadMyTokens = async () => {
    try {
      setLoadingMyTokens(true);
      const list = await api.listMyTokens();
      setMyTokens(list || []);
    } catch (err) {
      console.error('Failed to load personal tokens', err);
    } finally {
      setLoadingMyTokens(false);
    }
  };

  const handleCreateMyToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myTokenName) return;
    setMyTokenCreating(true);
    setMyTokenError('');
    try {
      const tok = await api.createMyToken(myTokenName, myTokenExpiry, myTokenMCPReadOnly ? ["clusters:read", "tests:read", "metrics:read", "logs:read"] : undefined);
      setMyGeneratedToken(tok);
      setIsMyTokenModalOpen(true);
      setMyTokenName('');
      setMyTokenExpiry(7);
      await loadMyTokens();
    } catch (err: any) {
      setMyTokenError(err.message || t('personalTokenCreateFailed'));
    } finally {
      setMyTokenCreating(false);
    }
  };

  const handleRevokeMyToken = (tok: APIToken) => {
    setMyTokenRevokeTarget(tok);
  };

  const confirmRevokeMyToken = async () => {
    if (!myTokenRevokeTarget) return;
    try {
      await api.revokeMyToken(myTokenRevokeTarget.token_hash);
      showToast(t('personalTokenRevokeSuccess'), 'success');
      await loadMyTokens();
    } catch (err: any) {
      showToast(err.message || t('personalTokenRevokeFailed'), 'error');
    } finally {
      setMyTokenRevokeTarget(null);
    }
  };

  const loadDiscoveryConfig = async () => {
    try {
      const cfg = await api.getEKSDiscoveryConfig();
      setDiscoveryConfig(cfg);
    } catch (err) {
      console.error('Failed to load EKS discovery config', err);
    }
  };

  const handleScanEKS = async () => {
    setScanning(true);
    setDiscoveryError(null);
    setDiscoverySuccess(null);
    try {
      const list = await api.discoverEKSClusters();
      setDiscoveredClusters(list || []);
      // Pre-select clusters that are not already registered
      setSelectedDiscovered(list ? list.filter(c => !c.already_registered).map(c => c.api_server_url) : []);
    } catch (err: any) {
      setDiscoveryError(err.message || 'Failed to scan EKS clusters');
    } finally {
      setScanning(false);
    }
  };

  const handleSyncEKS = async () => {
    if (selectedDiscovered.length === 0) return;
    setSyncing(true);
    setDiscoveryError(null);
    setDiscoverySuccess(null);
    try {
      const toSync = discoveredClusters.filter(c => selectedDiscovered.includes(c.api_server_url));
      // Map to default environment based on cluster name or sandbox
      const toSyncWithEnv = toSync.map(c => ({
        ...c,
        environment: c.name.toLowerCase().includes('prod') ? 'prod' : (c.name.toLowerCase().includes('stage') ? 'stage' : 'sandbox')
      }));
      const res = await api.syncDiscoveredEKSClusters(toSyncWithEnv);
      if (res.success) {
        setDiscoverySuccess(t('discoverSuccess') || `Successfully synced ${res.count} EKS cluster(s)!`);
        setDiscoveredClusters([]);
        setSelectedDiscovered([]);
        // Reload clusters list
        const clusterList = await api.getClusters();
        setClusters(clusterList || []);
      }
    } catch (err: any) {
      setDiscoveryError(err.message || 'Failed to sync EKS clusters');
    } finally {
      setSyncing(false);
    }
  };

  const loadAppearanceSettings = async () => {
    try {
      const settings = await api.getAppearanceSettings();
      if (settings.default_color_palette) {
        setDefaultPaletteForNewUsers(settings.default_color_palette as ColorPalette);
      }
      if (settings.default_language) {
        setDefaultLanguageForNewUsers(settings.default_language as Language);
      }
      if (settings.default_theme) {
        setDefaultThemeForNewUsers(settings.default_theme as Theme);
      }
    } catch (err) {
      console.error('Failed to load appearance settings', err);
    }
  };

  const handleSaveAppearanceDefaults = async () => {
    setSavingAppearance(true);
    try {
      await api.saveAppearanceSettings({
        default_color_palette: defaultPaletteForNewUsers,
        default_language: defaultLanguageForNewUsers,
        default_theme: defaultThemeForNewUsers,
      });
      showToast(t('appearanceDefaultsSavedSuccess'), 'success');
    } catch (err: any) {
      showToast(err.message || t('defaultsSaveError'), 'error');
    } finally {
      setSavingAppearance(false);
    }
  };

  const loadSettingsData = async () => {
    if (!isAdmin) return;
    try {
      setLoadingClusters(true);
      const clusterList = await api.getClusters();
      setClusters(clusterList || []);

      await loadUniqueInfluxConfig();
      await loadTemplates();
      await loadUsers();
      await loadSSOConfig();
      await loadAPITokens();
      await loadRunDefaults();
      await loadDiscoveryConfig();
      await loadWorkspaces();
      await loadAppearanceSettings();
    } catch (err) {
      console.error('Failed to load settings data', err);
    } finally {
      setLoadingClusters(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadSettingsData();
    }
  }, [isAdmin]);

  // Load personal tokens for all authenticated users on mount.
  useEffect(() => {
    if (isAdmin !== null) {
      loadMyTokens();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleStartEdit = async (c: ClusterConfig) => {
    setEditingClusterId(c.id);
    setIsEditing(true);
    setNewCluster({
      name: c.name,
      api_server_url: c.api_server_url,
      auth_type: c.auth_type,
      raw_secret: '', // leave empty if not updating the secret
      ca_cert_base64: c.ca_cert_base64 || '',
      aws_account_id: c.aws_account_id || '',
    });
    const initialNamespaces = c.namespaces ? c.namespaces.split(',').map(s => s.trim()).filter(Boolean) : [];
    setAllowedNamespaces(initialNamespaces);
    setDiscoveredNamespaces([]);
    setIsModalOpen(true);

    setLoadingNamespaces(true);
    try {
      const list = await api.getNamespaces(c.id);
      setDiscoveredNamespaces(list || []);
      // If the cluster has no whitelisted namespaces configured yet,
      // pre-populate with the ones discovered with k6s=enabled.
      if (initialNamespaces.length === 0 && list && list.length > 0) {
        setAllowedNamespaces(list);
      }
    } catch (err) {
      console.error('Failed to fetch cluster namespaces', err);
    } finally {
      setLoadingNamespaces(false);
    }
  };

  const handleStartAdd = () => {
    setIsEditing(false);
    setEditingClusterId(null);
    setNewCluster({
      name: '',
      api_server_url: '',
      auth_type: 'token',
      raw_secret: '',
      ca_cert_base64: '',
      aws_account_id: '',
    });
    setAllowedNamespaces([]);
    setDiscoveredNamespaces([]);
    setIsModalOpen(true);
  };

  const handleRegisterCluster = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');

    // Require raw_secret if registering a new cluster (except for in-cluster type)
    if (!isEditing && newCluster.auth_type !== 'in-cluster' && !newCluster.raw_secret) {
      setRegError(t('authCredentialsRequired'));
      return;
    }

    setRegistering(true);

    try {
      const namespacesStr = allowedNamespaces.filter(Boolean).join(',');
      const payload = {
        ...newCluster,
        aws_account_id: newCluster.auth_type === 'local' ? '' : newCluster.aws_account_id,
        namespaces: namespacesStr
      };

      if (isEditing && editingClusterId) {
        await api.updateCluster(editingClusterId, payload);
      } else {
        await api.registerCluster(payload);
      }
      
      setIsModalOpen(false);
      setIsEditing(false);
      setEditingClusterId(null);
      setNewCluster({
        name: '',
        api_server_url: '',
        auth_type: 'token',
        raw_secret: '',
        ca_cert_base64: '',
        aws_account_id: '',
      });
      setAllowedNamespaces([]);
      const clusterList = await api.getClusters();
      setClusters(clusterList || []);
    } catch (err: any) {
      setRegError(err.message || t('k8sSettingsError'));
    } finally {
      setRegistering(false);
    }
  };

  const handleDeleteCluster = async (id: string, name: string) => {
    const cluster = clusters.find(c => c.id === id);
    if (cluster) {
      setConfirmClusterName('');
      setDeletingCluster(cluster);
    }
  };

  const confirmDeleteCluster = async () => {
    if (!deletingCluster) return;
    try {
      await api.deleteCluster(deletingCluster.id);
      showToast(t('clusterDeletedSuccess', { name: deletingCluster.name }), 'success');
      setDeletingCluster(null);
      setConfirmClusterName('');
      const clusterList = await api.getClusters();
      setClusters(clusterList || []);
    } catch (err: any) {
      showToast(err.message || t('clusterDeleteError'), 'error');
    }
  };


  if (isAdmin === null) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-slate-500">
        {t('verification')}
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Title */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
          <Settings className="w-8 h-8 text-purple-400" />
          <span>{isAdmin ? t('settingsTitle') : t('personalSettingsTitle')}</span>
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          {isAdmin ? t('settingsSub') : t('personalSettingsSub')}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 overflow-x-auto no-scrollbar gap-2 shrink-0">
        {visibleSettingsTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSettingsTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSettingsTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 text-xs font-semibold whitespace-nowrap cursor-pointer transition ${
                isActive
                  ? 'border-purple-500 text-purple-300'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeSettingsTab === 'kubernetes' && isAdmin && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {/* Left Column: K8s Clusters definitions */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Server className="w-5 h-5 text-purple-400" />
                <span>{t('k8sClusters')}</span>
              </h3>
              <button
                onClick={handleStartAdd}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer hover:scale-102 active:scale-98 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('addCluster')}</span>
              </button>
            </div>

            {loadingClusters ? (
              <div className="py-12 text-center text-slate-500 text-xs">{t('loading')}</div>
            ) : clusters.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">{t('noClustersDefined')}</div>
            ) : (
              <div className="space-y-3">
                {clusters.map((c) => (
                  <div 
                    key={c.id} 
                    className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="p-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl shrink-0">
                        <HardDrive className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <p className="text-xs font-semibold text-slate-200 truncate">{c.name}</p>
                          {c.namespaces && (
                            <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700/50 rounded-md text-[8px] font-mono">
                              {c.namespaces.split(',').length} NS
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono truncate">{c.api_server_url}</p>
                      </div>
                    </div>

                    <div className="flex space-x-1 shrink-0">
                      <button
                        onClick={() => handleStartEdit(c)}
                        title={t('editCluster')}
                        className="p-2 border border-transparent hover:border-purple-500/25 hover:bg-purple-500/10 text-slate-500 hover:text-purple-400 rounded-xl transition cursor-pointer"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteCluster(c.id, c.name)}
                        title={t('deleteCluster')}
                        className="p-2 border border-transparent hover:border-red-500/25 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AWS EKS Auto-Discovery Section */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Compass className="w-5 h-5 text-purple-400 animate-spin-slow" />
                <span>{t('awsEksDiscovery') || 'EKS Auto-Discovery'}</span>
              </h3>
              {discoveryConfig?.enabled ? (
                <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-md text-[10px] font-bold uppercase tracking-wider">
                  {t('awsEksDiscoveryConfigured') || 'Auto-discovery Configured'}
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700/50 rounded-md text-[10px] font-bold uppercase tracking-wider">
                  {t('awsEksDiscoveryNotConfigured') || 'Inactive'}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400">
              {t('awsEksDiscoveryDesc') || 'Discover EKS clusters automatically using IAM assume role across multi-accounts and multi-regions.'}
            </p>

            {discoveryConfig?.enabled ? (
              <div className="space-y-4">
                {/* Show Configured Accounts */}
                <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Configured Accounts & Regions</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {discoveryConfig.accounts?.map((acc: any, index: number) => (
                      <div key={index} className="p-3 bg-slate-900/60 border border-slate-800/40 rounded-xl space-y-1">
                        <div className="flex items-center space-x-2 text-purple-400">
                          <CloudLightning className="w-3.5 h-3.5" />
                          <span className="text-xs font-mono font-bold">{acc.account_id}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {acc.regions?.map((reg: string, rIdx: number) => (
                            <span key={rIdx} className="px-1.5 py-0.5 bg-slate-800 border border-slate-700/50 text-[9px] font-mono text-slate-400 rounded-md">
                              {reg}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <p className="text-[10px] text-slate-500">
                      External ID: <strong className="font-mono text-purple-400">{discoveryConfig.external_id}</strong>
                      {' · '}
                      Role: <strong className="font-mono text-purple-400">{discoveryConfig.role_name}</strong>
                    </p>
                    <button
                      type="button"
                      onClick={handleScanEKS}
                      disabled={scanning}
                      className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white text-xs font-semibold rounded-xl transition hover:scale-102 active:scale-98 shadow-md disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
                      <span>{scanning ? (t('scanning') || 'Scanning...') : (t('scanEKS') || 'Scan AWS Accounts')}</span>
                    </button>
                  </div>
                </div>

                {/* Error or Success banners */}
                {discoveryError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{discoveryError}</span>
                  </div>
                )}
                {discoverySuccess && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs flex items-center gap-2 animate-fadeIn">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{discoverySuccess}</span>
                  </div>
                )}

                {/* Discovered clusters listing */}
                {discoveredClusters.length > 0 && (
                  <div className="space-y-3 animate-fadeIn">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                      <span>{t('discoveredClusters') || 'Discovered Clusters'}</span>
                      <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-md text-[9px]">
                        {discoveredClusters.length} Found
                      </span>
                    </h4>

                    <div className="border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-950/40">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-900/60 border-b border-slate-800 text-slate-500 font-bold uppercase tracking-wider text-[9px]">
                            <th className="p-3 w-10 text-center">Select</th>
                            <th className="p-3">Cluster Name</th>
                            <th className="p-3">AWS Account</th>
                            <th className="p-3">Region</th>
                            <th className="p-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900">
                          {discoveredClusters.map((cluster) => (
                            <tr key={cluster.api_server_url} className="hover:bg-slate-900/20">
                              <td className="p-3 text-center">
                                <input
                                  type="checkbox"
                                  disabled={cluster.already_registered}
                                  checked={selectedDiscovered.includes(cluster.api_server_url)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedDiscovered(prev => [...prev, cluster.api_server_url]);
                                    } else {
                                      setSelectedDiscovered(prev => prev.filter(url => url !== cluster.api_server_url));
                                    }
                                  }}
                                  className="w-4 h-4 rounded border-slate-800 text-purple-600 bg-slate-950 focus:ring-purple-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="p-3">
                                <div className="font-semibold text-slate-200">{cluster.name}</div>
                                <div className="text-[10px] text-slate-500 font-mono truncate max-w-xs">{cluster.api_server_url}</div>
                              </td>
                              <td className="p-3 text-slate-400 font-mono">{cluster.aws_account_id}</td>
                              <td className="p-3 text-slate-400 font-mono">{cluster.region}</td>
                              <td className="p-3">
                                {cluster.already_registered ? (
                                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md text-[9px] font-semibold">
                                    Registered
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-md text-[9px] font-semibold">
                                    New EKS
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={handleSyncEKS}
                        disabled={syncing || selectedDiscovered.length === 0}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white text-xs font-semibold rounded-xl transition hover:scale-102 active:scale-98 shadow-md disabled:opacity-50"
                      >
                        {syncing ? (t('syncing') || 'Syncing...') : (t('syncSelected') || 'Sync Selected EKS Clusters')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-slate-950/20 border border-dashed border-slate-850 rounded-2xl flex flex-col items-center justify-center text-center p-6 space-y-2">
                <AlertCircle className="w-8 h-8 text-slate-500" />
                <p className="text-xs text-slate-400">
                  {t('awsEksDiscoveryNotConfigured') || 'EKS auto-discovery is currently not configured.'}
                </p>
                <p className="text-[10px] text-slate-600 max-w-sm">
                  Please define the <code className="font-mono text-slate-500">AWS_ACCOUNTS_DISCOVERY</code> environment variable in your backend deployment to trigger auto-discovery.
                  Optional: <code className="font-mono text-slate-500">AWS_ACCOUNTS_DISCOVERY_ROLE</code> (default <code className="font-mono text-slate-500">StratosEKSDiscoveryRole</code>) and <code className="font-mono text-slate-500">AWS_ACCOUNTS_DISCOVERY_EXTERNAL_ID</code>.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeSettingsTab === 'influxdb' && isAdmin && (
        <div className="max-w-4xl bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-purple-400" />
              <span>{t('influxConfigTitle')}</span>
            </h3>
            {influxEnvDefined && (
              <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-md text-[10px] font-bold uppercase tracking-wider">
                {t('configuredViaEnv')}
              </span>
            )}
          </div>

          {influxSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs">
              {influxSuccess}
            </div>
          )}
          {influxError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
              {influxError}
            </div>
          )}
          {influxTestSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs">
              {influxTestSuccess}
            </div>
          )}
          {influxTestError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
              {influxTestError}
            </div>
          )}

          <form onSubmit={handleSaveInfluxServer} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('url')}</label>
                <input
                  type="url"
                  required
                  disabled={influxEnvDefined}
                  placeholder="http://influxdb.monitoring.svc:8086"
                  value={influxConfig.url}
                  onChange={(e) => setInfluxConfig({ ...influxConfig, url: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono disabled:opacity-55 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('version')}</label>
                <select
                  disabled={influxEnvDefined}
                  value={influxConfig.version}
                  onChange={(e) => setInfluxConfig({ ...influxConfig, version: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                >
                  <option value="v2">v2 (Flux)</option>
                  <option value="v1">v1 (InfluxQL)</option>
                </select>
              </div>
            </div>

            {influxConfig.version === 'v2' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('org')}</label>
                  <input
                    type="text"
                    required
                    disabled={influxEnvDefined}
                    placeholder="k6-monitoring"
                    value={influxConfig.org}
                    onChange={(e) => setInfluxConfig({ ...influxConfig, org: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('bucket')}</label>
                  <input
                    type="text"
                    required
                    disabled={influxEnvDefined}
                    placeholder="k6"
                    value={influxConfig.bucket}
                    onChange={(e) => setInfluxConfig({ ...influxConfig, bucket: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('databaseBucket')}</label>
                  <input
                    type="text"
                    required
                    disabled={influxEnvDefined}
                    placeholder="k6"
                    value={influxConfig.bucket}
                    onChange={(e) => setInfluxConfig({ ...influxConfig, bucket: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('httpQueryMethod')}</label>
                  <select
                    disabled={influxEnvDefined}
                    value={influxConfig.method}
                    onChange={(e) => setInfluxConfig({ ...influxConfig, method: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                  >
                    <option value="POST">{t('postRecommended')}</option>
                    <option value="GET">{t('getMethod')}</option>
                  </select>
                </div>
              </div>
            )}

            {influxConfig.version === 'v2' ? (
              <div className="animate-fadeIn">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('apiAuthToken')}</label>
                <input
                  type="password"
                  required={!influxConfig.has_token}
                  disabled={influxEnvDefined}
                  placeholder={t('leaveBlankToKeepSecret')}
                  value={influxConfig.token}
                  onChange={(e) => setInfluxConfig({ ...influxConfig, token: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono disabled:opacity-55 disabled:cursor-not-allowed"
                />
              </div>
            ) : (
              <div className="space-y-4 animate-fadeIn">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="useInfluxAuthCheck"
                    disabled={influxEnvDefined}
                    checked={useInfluxAuth}
                    onChange={(e) => setUseInfluxAuth(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-800 text-purple-600 bg-slate-950 focus:ring-purple-500 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                  <label htmlFor="useInfluxAuthCheck" className="text-xs font-semibold text-slate-400 cursor-pointer select-none">
                    {t('useBasicAuth')}
                  </label>
                </div>

                {useInfluxAuth && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('username')}</label>
                      <input
                        type="text"
                        required
                        disabled={influxEnvDefined}
                        placeholder="admin"
                        value={influxConfig.username}
                        onChange={(e) => setInfluxConfig({ ...influxConfig, username: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('password')}</label>
                      <input
                        type="password"
                        required={!influxConfig.has_password}
                        disabled={influxEnvDefined}
                        placeholder={t('leaveBlankToKeepPassword')}
                        value={influxConfig.password}
                        onChange={(e) => setInfluxConfig({ ...influxConfig, password: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono disabled:opacity-55 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {!influxEnvDefined && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <button
                  type="button"
                  onClick={handleTestInfluxConfig}
                  disabled={testingInflux}
                  className="py-2.5 bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-semibold shadow-md cursor-pointer transition disabled:opacity-50"
                >
                  {testingInflux ? t('testing') : t('testConn')}
                </button>
                <button
                  type="submit"
                  disabled={savingInflux}
                  className="py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer transition hover:scale-102 active:scale-98 disabled:opacity-50"
                >
                  {savingInflux ? t('saving') : t('saveConfiguration')}
                </button>
              </div>
            )}
          </form>
        </div>
      )}


      {activeSettingsTab === 'templates' && isAdmin && (
        <div className="space-y-8">
          {/* Run Defaults Section */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-purple-400" />
                <span>{t('runDefaults')}</span>
              </h3>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{t('runDefaultsSub')}</span>
            </div>

            <p className="text-xs text-slate-400">
              {t('runDefaultsDesc')}
            </p>

            <form onSubmit={handleSaveRunDefaults} className="space-y-5">
              {/* Output Option */}
              <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl space-y-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    onClick={() => setRunDefaults(d => ({ ...d, use_output: !d.use_output }))}
                    className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer flex-shrink-0 ${runDefaults.use_output ? 'bg-gradient-to-r from-purple-600 to-pink-500' : 'bg-slate-700'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${runDefaults.use_output ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                  <span className="text-sm font-semibold text-slate-200">{t('addOutputByDefault')}</span>
                </label>
                <p className="text-xs text-slate-500 pl-13">
                  {t('addOutputByDefaultDesc')}
                </p>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{t('outputArgument')}</label>
                  <input
                    type="text"
                    value={runDefaults.output_args}
                    onChange={e => setRunDefaults(d => ({ ...d, output_args: e.target.value }))}
                    placeholder="--out influxdb=http://..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:border-purple-500 outline-none"
                  />
                </div>
              </div>

              {/* Default Runner Image */}
              <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl space-y-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    onClick={() => setRunDefaults(d => ({ ...d, use_image: !d.use_image }))}
                    className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer flex-shrink-0 ${runDefaults.use_image ? 'bg-gradient-to-r from-purple-600 to-pink-500' : 'bg-slate-700'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${runDefaults.use_image ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                  <span className="text-sm font-semibold text-slate-200">{t('useCustomImageByDefault')}</span>
                </label>
                <p className="text-xs text-slate-500">
                  {t('useCustomImageByDefaultDesc')}
                </p>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{t('runnerImagePath')}</label>
                  <input
                    type="text"
                    value={runDefaults.image_url}
                    onChange={e => setRunDefaults(d => ({ ...d, image_url: e.target.value }))}
                    placeholder={RUNNER_IMAGE_PLACEHOLDER}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:border-purple-500 outline-none"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">
                    {t('runDefaultsImageHint')}
                  </p>
                </div>
              </div>

              {/* Default Environment Variables */}
              <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{t('runDefaultsEnv')}</p>
                    <p className="text-xs text-slate-500">{t('runDefaultsEnvDesc')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddDefaultEnv}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-850 border border-slate-800 text-slate-300 rounded-xl text-xs font-semibold shadow-md cursor-pointer transition hover:scale-102 active:scale-98"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('runDefaultsEnvAdd')}</span>
                  </button>
                </div>

                {runDefaults.env_vars.length > 0 && (
                  <div className="space-y-2">
                    {runDefaults.env_vars.map((entry, index) => (
                      <div key={`default-env-${index}`} className="flex flex-col md:flex-row gap-2">
                        <input
                          type="text"
                          value={entry.key}
                          onChange={(e) => handleUpdateDefaultEnv(index, 'key', e.target.value)}
                          placeholder={t('runDefaultsEnvKeyPlaceholder')}
                          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:border-purple-500 outline-none"
                        />
                        <div className="flex-1 flex gap-2">
                          <input
                            type="text"
                            value={entry.value}
                            onChange={(e) => handleUpdateDefaultEnv(index, 'value', e.target.value)}
                            placeholder={t('runDefaultsEnvValuePlaceholder')}
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:border-purple-500 outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveDefaultEnv(index)}
                            className="px-2.5 py-2 bg-slate-900 border border-slate-800 text-slate-400 rounded-xl hover:text-rose-400 hover:border-rose-500/30 transition"
                            aria-label={t('delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {defaultsError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">{defaultsError}</div>
              )}
              {defaultsSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  {t('runDefaultsSavedSuccess')}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingDefaults}
                  className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg cursor-pointer disabled:opacity-50 hover:scale-102 active:scale-98 transition"
                >
                  {savingDefaults ? t('saving') : t('saveDefaults')}
                </button>
              </div>
            </form>
          </div>

          {/* K6 Run Templates Section */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-purple-400" />
                <span>{t('k6RunTemplates')}</span>
              </h3>
              <button
                onClick={handleStartAddTemplate}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer hover:scale-102 active:scale-98 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('addTemplate')}</span>
              </button>
            </div>

            {loadingTemplates ? (
              <div className="py-12 text-center text-slate-500 text-xs">{t('loading')}</div>
            ) : templates.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">{t('none')}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templates.map((tmpl) => (
                  <div 
                    key={tmpl.id} 
                    className="flex flex-col justify-between p-5 bg-slate-950/40 border border-slate-800/60 rounded-2xl space-y-4"
                  >
                    <div className="flex items-start justify-between min-w-0">
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="p-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl shrink-0">
                          <FileCode2 className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold text-slate-200 truncate">{tmpl.name}</p>
                            <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 shrink-0">
                              {templateTypeLabel(tmpl.template_type || 'testrun')}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 font-mono truncate">{tmpl.script_name} ({tmpl.script_file})</p>
                          {tmpl.runner_image && (
                            <p className="text-[10px] text-slate-500 font-mono truncate">{t('runnerImage')}: {tmpl.runner_image}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex space-x-1 shrink-0">
                        <button
                          onClick={() => handleStartEditTemplate(tmpl)}
                          title={t('editTemplate')}
                          className="p-2 border border-transparent hover:border-purple-500/25 hover:bg-purple-500/10 text-slate-500 hover:text-purple-400 rounded-xl transition cursor-pointer"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(tmpl.id, tmpl.name)}
                          title={t('deleteTemplate')}
                          className="p-2 border border-transparent hover:border-red-500/25 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className={`grid gap-2 text-[10px] bg-slate-950/60 p-3 rounded-xl border border-slate-900 text-slate-400 font-medium ${tmpl.template_type === 'testrun' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                      {tmpl.template_type === 'testrun' && (
                        <div>
                          <span className="text-slate-500 block text-[8px] uppercase tracking-wider">{t('parallelism')}</span>
                          <span className="text-slate-300 font-semibold">{tmpl.parallelism} {t('runners')}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase tracking-wider">{t('cpuLimit')}</span>
                        <span className="text-slate-300 font-semibold">{tmpl.cpu_limit}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase tracking-wider">{t('memoryLimit')}</span>
                        <span className="text-slate-300 font-semibold">{tmpl.mem_limit}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSettingsTab === 'users' && isAdmin && (
        <div className="space-y-8 max-w-4xl">
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" />
                <span>{t('userManagement')}</span>
              </h3>
              <button
                onClick={handleStartAddUser}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer hover:scale-102 active:scale-98 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('addUser')}</span>
              </button>
            </div>

            {loadingUsers ? (
              <div className="py-12 text-center text-slate-500 text-xs">{t('loading')}</div>
            ) : users.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">{t('none')}</div>
            ) : (
              <div className="space-y-3">
                {users.map((usr) => (
                  <div 
                    key={usr.username} 
                    className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="p-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl shrink-0">
                        <Users className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">{usr.username}</p>
                        <p className="text-[10px] text-slate-500 font-mono truncate">{t('role')}: <strong className="font-semibold capitalize text-purple-400">{usr.role}</strong></p>
                        {usr.workspaces && usr.workspaces.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {usr.workspaces.map((ws) => (
                              <span
                                key={`${usr.username}-${ws.workspace_id}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-0.5 text-[10px] text-slate-300"
                                title={`${ws.role} · ${ws.source === 'sso' ? t('membershipSourceSSO') : t('membershipSourceManual')}`}
                              >
                                <Briefcase className="w-3 h-3 text-purple-400" />
                                <span className="truncate max-w-[120px]">{ws.workspace_name || ws.workspace_id}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-slate-600 mt-1">{t('noUserWorkspaces')}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex space-x-1 shrink-0">
                      <button
                        onClick={() => handleStartEditUser(usr)}
                        title={t('editUser')}
                        className="p-2 border border-transparent hover:border-purple-500/25 hover:bg-purple-500/10 text-slate-500 hover:text-purple-400 rounded-xl transition cursor-pointer"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(usr.username)}
                        disabled={usr.username === 'admin'}
                        title={t('deleteUser')}
                        className="p-2 border border-transparent hover:border-red-500/25 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SSO Setup Panel */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-purple-400" />
                <span>{t('oidcSsoSetup')}</span>
              </h3>
            </div>

            {ssoSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs animate-fadeIn">
                {ssoSuccess}
              </div>
            )}
            {ssoError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs animate-fadeIn">
                {ssoError}
              </div>
            )}

            <form onSubmit={handleSaveSSO} className="space-y-4">
              <div className="flex items-center space-x-2.5 py-1">
                <input
                  type="checkbox"
                  id="enableSSOCheckbox"
                  checked={ssoConfig.enabled}
                  onChange={(e) => setSsoConfig({ ...ssoConfig, enabled: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-800 text-purple-600 bg-slate-950 focus:ring-purple-500 cursor-pointer"
                />
                <label htmlFor="enableSSOCheckbox" className="text-xs font-semibold text-slate-300 cursor-pointer select-none">
                  {t('enableOidcSsoLabel') || 'Enable OIDC Single Sign-On (SSO)'}
                </label>
              </div>

              {ssoConfig.enabled && (
                <div className="space-y-4 animate-fadeIn bg-slate-950/20 border border-slate-800/30 p-5 rounded-2xl">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('ssoUserName')}</label>
                      <input
                        type="text"
                        placeholder="e.g. Okta, Keycloak, Auth0 (default is 'SSO')"
                        value={ssoConfig.name}
                        onChange={(e) => setSsoConfig({ ...ssoConfig, name: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('oidcIssuerUrl') || 'OIDC Issuer URL'}</label>
                      <input
                        type="url"
                        placeholder="https://keycloak.company.local/realms/myrealm"
                        value={ssoConfig.issuer_url}
                        onChange={(e) => setSsoConfig({ ...ssoConfig, issuer_url: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('clientId') || 'Client ID'}</label>
                      <input
                        type="text"
                        placeholder="k6-bedrock-dashboard"
                        value={ssoConfig.client_id}
                        onChange={(e) => setSsoConfig({ ...ssoConfig, client_id: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('clientSecret') || 'Client Secret'}</label>
                      <input
                        type="password"
                        placeholder={t('leaveBlankToKeepSecret')}
                        value={ssoConfig.client_secret || ''}
                        onChange={(e) => setSsoConfig({ ...ssoConfig, client_secret: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('url') || 'Redirect URI'}</label>
                      <input
                        type="text"
                        value={ssoConfig.redirect_uri}
                        onChange={(e) => setSsoConfig({ ...ssoConfig, redirect_uri: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('administrator') || 'Admin Groups'}</label>
                      <input
                        type="text"
                        placeholder="group-devops-admin, infra-ext-users"
                        value={ssoConfig.admin_groups || ''}
                        onChange={(e) => setSsoConfig({ ...ssoConfig, admin_groups: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={savingSSO}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {savingSSO ? t('savingSsoSettings') : t('saveSsoSettings')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeSettingsTab === 'security' && (
        <div className="space-y-8">
          {/* My Tokens — Self-Service Section (visible to all authenticated users) */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Key className="w-5 h-5 text-emerald-400" />
                  <span>{t('myTokens')}</span>
                </h3>
                <p className="text-slate-500 text-xs mt-1">{t('myTokensSubtitle')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Token creation form */}
              <div className="bg-slate-950/40 border border-slate-800/60 rounded-2xl p-5 space-y-4 lg:col-span-1">
                <h4 className="text-sm font-semibold text-white">{t('createPersonalToken')}</h4>
                <form onSubmit={handleCreateMyToken} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('personalTokenName')}</label>
                    <input
                      id="personal-token-name"
                      type="text"
                      required
                      placeholder="e.g. CI Pipeline"
                      value={myTokenName}
                      onChange={(e) => setMyTokenName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-emerald-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      {t('personalTokenExpiry')} — <span className="text-emerald-400">{t('personalTokenMaxDays')}</span>
                    </label>
                    <select
                      id="personal-token-expiry"
                      value={myTokenExpiry}
                      onChange={(e) => setMyTokenExpiry(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-emerald-500 outline-none font-sans"
                    >
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-start gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={myTokenMCPReadOnly} onChange={e => setMyTokenMCPReadOnly(e.target.checked)} className="mt-0.5" />
                    <span>{t('mcpReadOnlyToken')}</span>
                  </label>

                  {myTokenError && (
                    <p className="text-red-400 text-xs">{myTokenError}</p>
                  )}

                  <button
                    id="create-personal-token-btn"
                    type="submit"
                    disabled={myTokenCreating}
                    className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 text-white rounded-xl text-xs font-semibold shadow-md hover:scale-102 active:scale-98 transition cursor-pointer disabled:opacity-50"
                  >
                    {myTokenCreating ? t('loading') : t('createPersonalToken')}
                  </button>
                </form>
              </div>

              {/* Personal tokens list */}
              <div className="lg:col-span-2 space-y-3">
                {loadingMyTokens ? (
                  <div className="py-12 text-center text-slate-500 text-xs">{t('loading')}</div>
                ) : myTokens.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">{t('myTokensEmpty')}</div>
                ) : (
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2">
                    {myTokens.map((tok) => {
                      const isExpired = tok.expires_at ? new Date(tok.expires_at) < new Date() : false;
                      return (
                        <div
                          key={tok.token_hash}
                          className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl"
                        >
                          <div className="flex items-center space-x-3 min-w-0">
                            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl shrink-0">
                              <Key className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center space-x-2">
                                <p className="text-xs font-semibold text-slate-200 truncate">{tok.name}</p>
                                <span className={`px-1.5 py-0.5 border rounded-md text-[8px] font-semibold uppercase tracking-wider ${
                                  isExpired
                                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                }`}>
                                  {isExpired ? t('tokenExpired') : t('tokenActive')}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[9px] text-slate-500 font-mono">
                                <span>{t('createdAt')}: {new Date(tok.created_at).toLocaleDateString(lang)}</span>
                                {tok.expires_at && (
                                  <span className={isExpired ? 'text-red-400 font-semibold' : 'text-slate-400 font-semibold'}>
                                    {t('expiresAt')}: {new Date(tok.expires_at).toLocaleDateString(lang)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex space-x-1 shrink-0">
                            <button
                              id={`revoke-my-token-${tok.token_hash.slice(0, 8)}`}
                              onClick={() => handleRevokeMyToken(tok)}
                              title={t('revokeToken')}
                              className="p-2 border border-transparent hover:border-red-500/25 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {isAdmin && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {/* API Tokens Section */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Key className="w-5 h-5 text-purple-400" />
                  <span>{t('apiTokens')}</span>
                </h3>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Token Generation Form */}
                <div className="bg-slate-950/40 border border-slate-800/60 rounded-2xl p-5 space-y-4 lg:col-span-1">
                  <h4 className="text-sm font-semibold text-white">{t('generateToken')}</h4>
                  <form onSubmit={handleGenerateAPIToken} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('tokenName')}</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. CI/CD Integration"
                        value={newTokenName}
                        onChange={(e) => setNewTokenName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('role')}</label>
                        <select
                          value={newTokenRole}
                          onChange={(e) => setNewTokenRole(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-sans"
                        >
                          <option value="viewer">{t('viewer')}</option>
                          <option value="editor">{t('editor')}</option>
                          <option value="administrator">{t('administrator')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('expiry')}</label>
                        <select
                          value={newTokenExpiry}
                          onChange={(e) => setNewTokenExpiry(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-sans"
                        >
                          <option value={0}>{t('never')}</option>
                          <option value={7}>{t('days7')}</option>
                          <option value={30}>{t('days30')}</option>
                          <option value={90}>{t('days90')}</option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md hover:scale-102 active:scale-98 transition cursor-pointer"
                    >
                      {t('create')}
                    </button>
                  </form>
                </div>

                {/* Tokens List */}
                <div className="lg:col-span-2 space-y-3">
                  {loadingTokens ? (
                    <div className="py-12 text-center text-slate-500 text-xs">{t('loading')}</div>
                  ) : apiTokens.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 text-xs">{t('none')}</div>
                  ) : (
                    <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2">
                      {apiTokens.map((tok) => {
                        const isExpired = tok.expires_at ? new Date(tok.expires_at) < new Date() : false;
                        return (
                          <div 
                            key={tok.token_hash} 
                            className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl"
                          >
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className="p-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl shrink-0">
                                <Key className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center space-x-2">
                                  <p className="text-xs font-semibold text-slate-200 truncate">{tok.name}</p>
                                  <span className="px-1.5 py-0.5 bg-slate-800 text-purple-400 border border-purple-500/20 rounded-md text-[8px] font-semibold uppercase tracking-wider">
                                    {tok.role}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[9px] text-slate-500 font-mono">
                                  <span>{t('createdAt')}: {new Date(tok.created_at).toLocaleDateString(lang)}</span>
                                  <span>
                                    {t('expiresAt')}: {tok.expires_at ? (
                                      <span className={isExpired ? "text-red-400 font-semibold" : "text-slate-400 font-semibold"}>
                                        {new Date(tok.expires_at).toLocaleDateString(lang)} {isExpired && `(${t('inactive')})`}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 font-semibold">{t('never')}</span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex space-x-1 shrink-0">
                              <button
                                onClick={() => handleDeleteAPIToken(tok.token_hash, tok.name)}
                                title={t('deleteApiToken')}
                                className="p-2 border border-transparent hover:border-red-500/25 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Generated API Token Dialog Modal */}
      {isTokenModalOpen && generatedToken && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>{t('tokenGeneratedSuccess')}</span>
            </h3>
            
            <p className="text-slate-300 text-xs">
              {t('tokenNotice')}
            </p>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs break-all text-purple-400 select-all relative flex items-center justify-between gap-4">
              <span>{generatedToken.token}</span>
              <button
                onClick={() => {
                  if (generatedToken.token) {
                    navigator.clipboard.writeText(generatedToken.token);
                    setCopiedToken(true);
                    setTimeout(() => setCopiedToken(false), 2000);
                  }
                }}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-[10px] font-semibold shrink-0 cursor-pointer transition active:scale-95"
              >
                {copiedToken ? t('copied') : t('copy')}
              </button>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  setIsTokenModalOpen(false);
                  setGeneratedToken(null);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Personal Token Created Dialog Modal */}
      {isMyTokenModalOpen && myGeneratedToken && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>{t('personalTokenCreateSuccess')}</span>
            </h3>

            <p className="text-slate-300 text-xs">
              {t('personalTokenCreatedOnce')}
            </p>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs break-all text-emerald-400 select-all relative flex items-center justify-between gap-4">
              <span>{myGeneratedToken.token}</span>
              <button
                id="copy-my-token-btn"
                onClick={() => {
                  if (myGeneratedToken.token) {
                    navigator.clipboard.writeText(myGeneratedToken.token);
                    setCopiedMyToken(true);
                    setTimeout(() => setCopiedMyToken(false), 2000);
                  }
                }}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-[10px] font-semibold shrink-0 cursor-pointer transition active:scale-95"
              >
                {copiedMyToken ? t('copied') : t('copy')}
              </button>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                id="close-my-token-modal-btn"
                onClick={() => {
                  setIsMyTokenModalOpen(false);
                  setMyGeneratedToken(null);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Personal Token Revoke Confirmation Dialog */}
      {myTokenRevokeTarget && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-5">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>{t('revokeToken')}</span>
            </h3>
            <p className="text-slate-400 text-xs">
              {t('revokeTokenConfirm').replace('{name}', myTokenRevokeTarget.name)}
            </p>
            <div className="flex justify-end gap-3">
              <button
                id="cancel-revoke-my-token-btn"
                onClick={() => setMyTokenRevokeTarget(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition"
              >
                {t('cancel')}
              </button>
              <button
                id="confirm-revoke-my-token-btn"
                onClick={confirmRevokeMyToken}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold cursor-pointer transition"
              >
                {t('revokeToken')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Cluster Modal */}

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl p-8 shadow-2xl relative">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">
              {isEditing ? t('editK8sCluster') : t('addCluster')}
            </h3>
            <p className="text-slate-400 text-xs mb-6">
              {isEditing 
                ? t('updateClusterDesc')
                : t('addClusterDesc')}
            </p>

            {regError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {regError}
              </div>
            )}

            <form onSubmit={handleRegisterCluster} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('clusterName')}</label>
                <input
                  type="text"
                  required
                  placeholder="K8s-Prod-Cluster"
                  value={newCluster.name}
                  onChange={(e) => setNewCluster({ ...newCluster, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                />
              </div>

              {newCluster.auth_type !== 'in-cluster' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('apiServerUrl')}</label>
                  <input
                    type="text"
                    required
                    placeholder="https://abc123xyz.yl4.us-west-2.eks.amazonaws.com"
                    value={newCluster.api_server_url}
                    onChange={(e) => setNewCluster({ ...newCluster, api_server_url: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                  />
                </div>
              )}

              {newCluster.auth_type !== 'local' && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('awsAccountId')}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder={t('awsAccountIdPlaceholder')}
                  value={newCluster.aws_account_id}
                  onChange={(e) => setNewCluster({ ...newCluster, aws_account_id: e.target.value.replace(/\D/g, '') })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none font-mono"
                />
                <p className="text-[10px] text-slate-600 mt-1">{t('awsAccountIdDesc')}</p>
              </div>

              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={newCluster.auth_type === 'local' || newCluster.auth_type === 'in-cluster' ? "col-span-2" : ""}>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('authType')}</label>
                  <select
                    value={newCluster.auth_type}
                    onChange={(e) => setNewCluster({ ...newCluster, auth_type: e.target.value, raw_secret: '' })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                  >
                    <option value="in-cluster">{t('authInClusterSA')}</option>
                    <option value="token">{t('authServiceAccountToken')}</option>
                    <option value="kubeconfig">{t('authKubeconfigYaml')}</option>
                    <option value="local">{t('authLocalKubeconfig')}</option>
                  </select>
                </div>
                {newCluster.auth_type !== 'local' && newCluster.auth_type !== 'in-cluster' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('caCertDesc')}</label>
                    <input
                      type="text"
                      placeholder="LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t..."
                      value={newCluster.ca_cert_base64}
                      onChange={(e) => setNewCluster({ ...newCluster, ca_cert_base64: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                    />
                  </div>
                )}
              </div>

              {newCluster.auth_type === 'in-cluster' ? (
                <div className="p-3.5 bg-purple-500/5 border border-purple-500/10 rounded-2xl">
                  <p className="text-xs text-purple-300 font-medium">
                    {t('authInClusterSA')}
                  </p>
                </div>
              ) : newCluster.auth_type === 'local' ? (
                <div>
                  {loadingContexts ? (
                    <div className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-500">
                      {t('loading')}
                    </div>
                  ) : localContexts.length === 0 ? (
                    <div className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-red-400">
                      {t('connectionFailed')}
                    </div>
                  ) : (
                    <LocalContextPicker
                      contexts={localContexts}
                      value={newCluster.raw_secret}
                      required={!isEditing}
                      onChange={context => setNewCluster(prev => ({
                        ...prev,
                        raw_secret: context?.context_name || '',
                        api_server_url: context?.api_server_url || prev.api_server_url,
                        name: !prev.name || localContexts.some(item => localClusterName(item) === prev.name)
                          ? (context ? localClusterName(context) : '')
                          : prev.name,
                      }))}
                    />
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                    {newCluster.auth_type === 'token' ? t('secretToken') : t('kubeconfigYaml')}
                  </label>
                  <textarea
                    required={!isEditing}
                    rows={4}
                    placeholder={
                      isEditing
                        ? t('leaveBlankCredentials')
                        : newCluster.auth_type === 'token'
                        ? 'eyJhbGciOiJSUzI1NiIsImt...'
                        : 'apiVersion: v1\nclusters:\n...'
                    }
                    value={newCluster.raw_secret}
                    onChange={(e) => setNewCluster({ ...newCluster, raw_secret: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none font-mono text-xs"
                  />
                </div>
              )}

              {/* Allowed Namespaces Whitelist */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-400">
                  {t('namespaceLabel')}
                </label>
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-3">
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    {t('allNamespaces')}
                  </p>
                  
                  {/* Common namespace presets and added namespaces */}
                  {loadingNamespaces ? (
                    <div className="text-xs text-slate-500 animate-pulse py-1">{t('loading')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {discoveredNamespaces.map((ns) => {
                        const isChecked = allowedNamespaces.includes(ns);
                        return (
                          <label 
                            key={ns}
                            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs cursor-pointer select-none transition-all duration-200 ${
                              isChecked
                                ? 'bg-purple-500/10 border-purple-500/40 text-purple-300'
                                : 'bg-slate-900 border-slate-800/80 text-slate-500 hover:text-slate-400 hover:bg-slate-800/40'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setAllowedNamespaces(allowedNamespaces.filter(n => n !== ns));
                                } else {
                                  setAllowedNamespaces([...allowedNamespaces, ns]);
                                }
                              }}
                            />
                            <span>{ns}</span>
                          </label>
                        );
                      })}

                      {/* Show manually added custom namespaces */}
                      {allowedNamespaces
                        .filter((ns) => !discoveredNamespaces.includes(ns))
                        .map((ns) => (
                          <label
                            key={ns}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border bg-purple-500/10 border-purple-500/40 text-purple-300 text-xs cursor-pointer select-none transition-all duration-200"
                          >
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={true}
                              onChange={() => {
                                setAllowedNamespaces(allowedNamespaces.filter((n) => n !== ns));
                              }}
                            />
                            <span>{ns}</span>
                            <X className="w-3 h-3 hover:text-purple-100 shrink-0 ml-0.5" />
                          </label>
                        ))}
                      
                      {!isEditing && allowedNamespaces.length === 0 && (
                        <div className="text-[11px] text-slate-500 py-1">
                          {t('none')}
                        </div>
                      )}
                      {isEditing && discoveredNamespaces.length === 0 && (
                        <div className="text-[11px] text-purple-400/90 py-1">
                          {t('none')}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Add custom namespace input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={t('addCustomNamespace')}
                      value={customNamespaceInput}
                      onChange={(e) => setCustomNamespaceInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = customNamespaceInput.trim().toLowerCase();
                          if (val && !allowedNamespaces.includes(val)) {
                            setAllowedNamespaces([...allowedNamespaces, val]);
                            setCustomNamespaceInput('');
                          }
                        }
                      }}
                      className="flex-1 bg-slate-900 border border-slate-800/80 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-purple-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = customNamespaceInput.trim().toLowerCase();
                        if (val && !allowedNamespaces.includes(val)) {
                          setAllowedNamespaces([...allowedNamespaces, val]);
                          setCustomNamespaceInput('');
                        }
                      }}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer border border-slate-700/50 transition active:scale-95"
                    >
                      {t('create')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl text-sm font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-sm font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {registering ? t('validating') : t('submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* K6 Template Add/Edit Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className={`bg-slate-900 border border-slate-800 rounded-3xl w-full ${scriptHasStages(templateConfig.script_content) ? 'max-w-5xl' : 'max-w-2xl'} p-8 shadow-2xl relative transition-all duration-300`}>
            <button
              onClick={() => setIsTemplateModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">
              {isEditingTemplate ? t('editK6Template') : t('addK6RunTemplate')}
            </h3>

            {templateError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {templateError}
              </div>
            )}

            <form onSubmit={handleSaveTemplateConfig} className="space-y-4">
              <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('templateType')}</label>
                    <select
                      value={templateConfig.template_type}
                      onChange={(e) => {
                        const nextType = e.target.value as K6TemplateType;
                        setTemplateConfig((prev) => ({
                          ...prev,
                          template_type: nextType,
                          parallelism: nextType === 'testrun' ? Math.max(prev.parallelism || 1, 1) : 0,
                          schedule_enabled: nextType === 'testrun' ? prev.schedule_enabled : false,
                        }));
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                    >
                      <option value="testrun">{t('templateTypeTestRun')}</option>
                      <option value="cronjob">{t('templateTypeCronJob')}</option>
                      <option value="job">{t('templateTypeJob')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('templateName')}</label>
                    <input
                      type="text"
                      required
                      placeholder="E.g., High Load API Test"
                      value={templateConfig.name}
                      onChange={(e) => setTemplateConfig((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                    />
                  </div>

                  <div className={`grid gap-4 ${templateConfig.template_type === 'testrun' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {templateConfig.template_type === 'testrun' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('parallelism')}</label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          required
                          value={templateConfig.parallelism}
                          onChange={(e) => setTemplateConfig((prev) => ({ ...prev, parallelism: Number(e.target.value) }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('scriptConfigMapName')}</label>
                      <input
                        type="text"
                        required
                        placeholder="k6-test-script"
                        value={templateConfig.script_name}
                        onChange={(e) => setTemplateConfig((prev) => ({ ...prev, script_name: e.target.value }))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('jsFilename')}</label>
                      <input
                        type="text"
                        required
                        placeholder="test.js"
                        value={templateConfig.script_file}
                        onChange={(e) => setTemplateConfig((prev) => ({ ...prev, script_file: e.target.value }))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('cpuLimit')}</label>
                      <input
                        type="text"
                        required
                        placeholder="10m"
                        value={templateConfig.cpu_limit}
                        onChange={(e) => setTemplateConfig((prev) => ({ ...prev, cpu_limit: e.target.value }))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('memoryLimit')}</label>
                      <input
                        type="text"
                        required
                        placeholder="16Mi"
                        value={templateConfig.mem_limit}
                        onChange={(e) => setTemplateConfig((prev) => ({ ...prev, mem_limit: e.target.value }))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('runnerImage')}</label>
                    <input
                      type="text"
                      placeholder="123456789012.dkr.ecr.us-west-2.amazonaws.com/xk6:latest"
                      value={templateConfig.runner_image}
                      onChange={(e) => setTemplateConfig((prev) => ({ ...prev, runner_image: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                    />
                  </div>

                  <K6ScriptEditor
                    script={templateConfig.script_content}
                    onChange={(script_content) => setTemplateConfig((prev) => ({ ...prev, script_content }))}
                    editorKey={editingTemplateId || 'new-template'}
                    layout="split"
                    height="280px"
                  />

                  {templateConfig.template_type === 'testrun' && (
                    <div className="space-y-3 border border-slate-800 rounded-2xl p-4 bg-slate-950/40">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-300">{t('templateScheduleSection')}</p>
                          <p className="text-[10px] text-slate-500">{t('templateScheduleSectionDesc')}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={templateConfig.schedule_enabled}
                          onChange={(e) => setTemplateConfig((prev) => ({ ...prev, schedule_enabled: e.target.checked }))}
                          className="w-4 h-4 accent-purple-500"
                        />
                      </div>

                      {templateConfig.schedule_enabled && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('cronExpression')}</label>
                            <input
                              type="text"
                              required
                              value={templateConfig.schedule_cron_expression}
                              onChange={(e) => setTemplateConfig((prev) => ({ ...prev, schedule_cron_expression: e.target.value }))}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none font-mono"
                            />
                            <p className="text-[10px] text-slate-500 mt-1">{t('cronRoundHourError')}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('templateScheduleCluster')}</label>
                              <select
                                required
                                value={templateConfig.schedule_cluster_id}
                                onChange={(e) => {
                                  const clusterId = e.target.value;
                                  setTemplateConfig((prev) => ({ ...prev, schedule_cluster_id: clusterId, schedule_namespace: '' }));
                                  loadTemplateScheduleNamespaces(clusterId);
                                }}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                              >
                                <option value="">{t('clusterLabel')}</option>
                                {clusters.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('templateScheduleNamespace')}</label>
                              <select
                                required
                                value={templateConfig.schedule_namespace}
                                onChange={(e) => setTemplateConfig((prev) => ({ ...prev, schedule_namespace: e.target.value }))}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                              >
                                {templateScheduleNamespaces.map(ns => (
                                  <option key={ns} value={ns}>{ns}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={templateConfig.schedule_active}
                              onChange={(e) => setTemplateConfig((prev) => ({ ...prev, schedule_active: e.target.checked }))}
                              className="w-4 h-4 accent-purple-500"
                            />
                            {t('templateScheduleActive')}
                          </label>
                        </div>
                      )}
                    </div>
                  )}
              </div>

              <div className={`flex gap-3 pt-4 ${isEditingTemplate ? 'flex-col sm:flex-row' : ''}`}>
                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(false)}
                  className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                {isEditingTemplate && (
                  <button
                    type="button"
                    onClick={openSaveAsNewTemplateModal}
                    disabled={savingTemplate}
                    className="flex-1 py-3 border border-purple-500/40 hover:bg-purple-500/10 text-purple-300 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                  >
                    {savingTemplate ? t('saving') : t('saveAsNewTemplate')}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={savingTemplate}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {savingTemplate ? t('saving') : t('saveTemplate')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save template as new — name prompt */}
      {isSaveAsNewTemplateModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-8 shadow-2xl relative">
            <button
              type="button"
              onClick={() => setIsSaveAsNewTemplateModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">{t('saveAsNewTemplateTitle')}</h3>
            <p className="text-slate-400 text-xs mb-6">{t('saveAsNewTemplateDesc')}</p>

            {saveAsNewTemplateError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {saveAsNewTemplateError}
              </div>
            )}

            <form onSubmit={handleConfirmSaveAsNewTemplate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('templateName')}</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={saveAsNewTemplateName}
                  onChange={(e) => setSaveAsNewTemplateName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSaveAsNewTemplateModalOpen(false)}
                  className="flex-1 py-3 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={savingTemplate}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {savingTemplate ? t('saving') : t('saveAsNewTemplate')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-8 shadow-2xl relative">
            <button
              onClick={() => setIsUserModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">{t('addLocalUser')}</h3>

            {userError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {userError}
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('username')}</label>
                <input
                  type="text"
                  required
                  placeholder="E.g., testeditor"
                  value={newUserAccount.username}
                  onChange={(e) => setNewUserAccount({ ...newUserAccount, username: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('password')}</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={newUserAccount.password}
                  onChange={(e) => setNewUserAccount({ ...newUserAccount, password: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('roleAuthorization')}</label>
                <select
                  value={newUserAccount.role}
                  onChange={(e) => setNewUserAccount({ ...newUserAccount, role: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                >
                  <option value="viewer">{t('viewerReadOnly')}</option>
                  <option value="editor">{t('editorRoleDesc')}</option>
                  <option value="administrator">{t('administrator')}</option>
                </select>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {savingUser ? t('adding') : t('addUser')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-slideUp">
          <div className={`flex items-center space-x-3 px-4 py-3 rounded-2xl border shadow-lg backdrop-blur-md transition-all duration-300 ${
            toast.type === 'success' 
              ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-300' 
              : toast.type === 'error'
              ? 'bg-red-950/80 border-red-500/30 text-red-300'
              : 'bg-blue-950/80 border-blue-500/30 text-blue-300'
          }`}>
            <span className="w-2 h-2 rounded-full animate-ping bg-current" />
            <span className="text-xs font-semibold">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Custom Confirmation Dialog */}
      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">{confirmDialog.title}</h3>
            <p className="text-slate-400 text-xs leading-normal">{confirmDialog.message}</p>
            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 py-2 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer hover:from-purple-500 hover:to-pink-400"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* K8s Cluster Deletion Confirmation Modal */}
      {deletingCluster && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-red-500/20 rounded-3xl w-full max-w-md p-8 shadow-2xl relative">
            <button
              onClick={() => {
                setDeletingCluster(null);
                setConfirmClusterName('');
              }}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer animate-pulse"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 text-red-400 mb-4">
              <ShieldAlert className="w-6 h-6 text-red-500 animate-bounce" />
              <h3 className="text-xl font-bold text-white">{t('deleteClusterTitle')}</h3>
            </div>

            <div className="space-y-4">
              <p className="text-slate-300 text-sm leading-relaxed">
                {t('deleteClusterConfirmPrefix')}{' '}
                <strong className="font-bold text-red-400">"{deletingCluster.name}"</strong>
                {t('deleteClusterConfirmSuffix')}
              </p>

              <div className="p-3 critical-warning-box rounded-xl text-xs leading-relaxed">
                {t('deleteClusterWarning')}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-400">
                  {t('deleteClusterTypePrompt')}
                </label>
                <input
                  type="text"
                  required
                  placeholder={deletingCluster.name}
                  value={confirmClusterName}
                  onChange={(e) => setConfirmClusterName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none font-mono"
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setDeletingCluster(null);
                    setConfirmClusterName('');
                  }}
                  className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteCluster}
                  disabled={confirmClusterName !== deletingCluster.name}
                  className="flex-1 py-3 bg-gradient-to-r from-red-600 to-rose-500 text-white btn-text-always-light rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:from-red-500 hover:to-rose-400"
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Workspace Deletion Confirmation Modal */}
      {deletingWorkspace && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-red-500/20 rounded-3xl w-full max-w-md p-8 shadow-2xl relative">
            <button
              onClick={() => {
                setDeletingWorkspace(null);
                setConfirmWorkspaceName('');
              }}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer animate-pulse"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 text-red-400 mb-4">
              <ShieldAlert className="w-6 h-6 text-red-500 animate-bounce" />
              <h3 className="text-xl font-bold text-white">{t('deleteWorkspaceTitle') || 'Delete Workspace'}</h3>
            </div>

            <div className="space-y-4">
              <p className="text-slate-300 text-sm leading-relaxed">
                {t('deleteWorkspaceConfirmPrefix') || 'Are you sure you want to delete workspace'}{' '}
                <strong className="font-bold text-red-400">"{deletingWorkspace.name}"</strong>?
              </p>

              <div className="p-4 bg-red-950/20 border border-red-500/10 rounded-2xl text-xs space-y-2">
                <p className="font-semibold text-red-400">⚠️ {t('deleteWorkspaceWarningTitle') || 'Critical Warning: The following resources will be permanently removed:'}</p>
                <ul className="list-disc list-inside text-slate-400 space-y-1 mt-1.5 font-bold">
                  <li>
                    <strong className="text-slate-300">{deletingWorkspaceClustersCount}</strong> {t('k8sClusters') || 'Kubernetes Clusters'}
                  </li>
                  <li>
                    <strong className="text-slate-300">{deletingWorkspaceTemplatesCount}</strong> {t('k6RunTemplates') || 'K6 Run Templates'}
                  </li>
                  <li>
                    {t('workspaceUsersRevocation') || 'All user membership mappings and roles for this workspace'}
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-400">
                  {t('deleteWorkspaceTypePrompt') || 'Type the name of the workspace to confirm:'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={deletingWorkspace.name}
                  value={confirmWorkspaceName}
                  onChange={(e) => setConfirmWorkspaceName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none font-mono"
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setDeletingWorkspace(null);
                    setConfirmWorkspaceName('');
                  }}
                  className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteWorkspace}
                  disabled={confirmWorkspaceName !== deletingWorkspace.name}
                  className="flex-1 py-3 bg-gradient-to-r from-red-600 to-rose-500 text-white btn-text-always-light rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:from-red-500 hover:to-rose-400"
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSettingsTab === 'appearance' && (
        <div className="max-w-5xl space-y-6 animate-fadeIn">
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-r from-purple-600 to-pink-500 animate-pulse shrink-0" />
                  <span>{t('colorPalette')}</span>
                </h3>
                <p className="text-slate-400 text-xs mt-1">
                  {t('paletteChoiceDesc')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingPalette(null);
                    setPaletteDuplicateMode(false);
                    setIsPaletteModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-slate-950/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-200 rounded-xl transition cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-purple-400" />
                  <span>{t('addCustomPalette')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetToDefaultPalettes();
                    showToast(t('paletteResetSuccess'), 'success');
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-slate-950/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-400 hover:text-slate-200 rounded-xl transition cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-slate-500" />
                  <span>{t('resetColors')}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {palettes.map((palette) => {
                const isSelected = colorPalette === palette.id;
                const displayName = isBuiltinPalette(palette.id) ? (t(palette.name) || palette.name) : palette.name;
                return (
                  <div key={palette.id} className="relative group w-full">
                    <button
                      type="button"
                      onClick={() => setColorPalette(palette.id)}
                      className={`w-full flex flex-col items-center justify-between p-4 rounded-2xl border transition-all duration-300 hover:scale-102 cursor-pointer ${
                        isSelected
                          ? 'bg-slate-950 border-purple-500/40 shadow-lg shadow-purple-500/5'
                          : 'bg-slate-950/40 border-slate-800/60 hover:bg-slate-950/80 hover:border-slate-800'
                      }`}
                    >
                      <div className="flex space-x-2 mb-3">
                        <span className="w-6 h-6 rounded-full border border-slate-900" style={{ backgroundColor: palette.colors.primary }} />
                        <span className="w-6 h-6 rounded-full border border-slate-900" style={{ backgroundColor: palette.colors.accent }} />
                      </div>
                      <span className="text-xs font-semibold text-slate-200 text-center">{displayName}</span>
                      {isSelected && (
                        <span className="mt-2 text-[9px] font-bold text-purple-400 uppercase tracking-wider">
                          {t('active')}
                        </span>
                      )}
                    </button>
                    <div className="absolute top-2 right-2 flex space-x-1 z-10">
                      <button
                        type="button"
                        onClick={(e) => handleEditPaletteClick(e, palette, displayName)}
                        className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-purple-400 rounded-lg shadow-md cursor-pointer"
                        title={isBuiltinPalette(palette.id) ? t('duplicatePaletteTitle') : t('edit')}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      {!isBuiltinPalette(palette.id) && (
                        <button
                          type="button"
                          onClick={(e) => handleDeletePaletteClick(e, palette, displayName)}
                          className="p-1.5 bg-slate-950 hover:bg-red-950/85 border border-slate-800 hover:border-red-900/60 text-slate-400 hover:text-red-400 rounded-lg shadow-md cursor-pointer"
                          title={t('delete')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {isAdmin && (
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">{t('defaultsForNewUsers')}</h3>
              <p className="text-slate-400 text-xs mt-1">
                {t('defaultsForNewUsersDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('defaultLanguageForNewUsers')}</label>
                <select
                  value={defaultLanguageForNewUsers}
                  onChange={(e) => setDefaultLanguageForNewUsers(e.target.value as Language)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                >
                  <option value="en">English</option>
                  <option value="fr">Français</option>
                  <option value="he">עברית</option>
                  <option value="zh">中文</option>
                  <option value="es">Español</option>
                  <option value="de">Deutsch</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('defaultThemeForNewUsers')}</label>
                <select
                  value={defaultThemeForNewUsers}
                  onChange={(e) => setDefaultThemeForNewUsers(e.target.value as Theme)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                >
                  <option value="light">{t('themeLight')}</option>
                  <option value="dark">{t('themeDark')}</option>
                  <option value="system">{t('themeSystem')}</option>
                </select>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">{t('defaultPaletteForNewUsers')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {defaultPalettes.map((palette) => {
                const isSelected = defaultPaletteForNewUsers === palette.id;
                const displayName = t(palette.name) || palette.name;
                return (
                  <button
                    key={`default-${palette.id}`}
                    type="button"
                    onClick={() => setDefaultPaletteForNewUsers(palette.id as ColorPalette)}
                    className={`w-full flex flex-col items-center justify-between p-4 rounded-2xl border transition-all duration-300 hover:scale-102 cursor-pointer ${
                      isSelected
                        ? 'bg-slate-950 border-cyan-500/40 shadow-lg shadow-cyan-500/5'
                        : 'bg-slate-950/40 border-slate-800/60 hover:bg-slate-950/80 hover:border-slate-800'
                    }`}
                  >
                    <div className="flex space-x-2 mb-3">
                      <span className="w-6 h-6 rounded-full border border-slate-900" style={{ backgroundColor: palette.colors.primary }} />
                      <span className="w-6 h-6 rounded-full border border-slate-900" style={{ backgroundColor: palette.colors.accent }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-200 text-center">{displayName}</span>
                    {isSelected && (
                      <span className="mt-2 text-[9px] font-bold text-cyan-400 uppercase tracking-wider">
                        {t('default')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleSaveAppearanceDefaults}
                disabled={savingAppearance}
                className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
              >
                {savingAppearance ? t('saving') : t('save')}
              </button>
            </div>
          </div>
          )}
        </div>
      )}

      <PaletteEditorModal
        open={isPaletteModalOpen}
        editingPalette={editingPalette}
        duplicateMode={paletteDuplicateMode}
        onClose={() => {
          setIsPaletteModalOpen(false);
          setEditingPalette(null);
          setPaletteDuplicateMode(false);
        }}
        onSave={handleSaveCustomPalette}
        t={t}
      />

      {/* Edit User Modal */}
      {isEditUserModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsEditUserModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">{t('editUser')}</h3>
            <p className="text-slate-400 text-xs mb-4">{t('editUserDesc')}</p>

            {userError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {userError}
              </div>
            )}

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('username')}</label>
                <input
                  type="text"
                  readOnly
                  value={editUserAccount.username}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-400 outline-none cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('newPassword')}</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={editUserAccount.password}
                  onChange={(e) => setEditUserAccount({ ...editUserAccount, password: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">{t('leaveBlankToKeepPassword')}</p>
              </div>

              {editUserAccount.password && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('confirmPassword')}</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={editUserAccount.confirmPassword}
                    onChange={(e) => setEditUserAccount({ ...editUserAccount, confirmPassword: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('roleAuthorization')}</label>
                <select
                  value={editUserAccount.role}
                  onChange={(e) => setEditUserAccount({ ...editUserAccount, role: e.target.value })}
                  disabled={editUserAccount.username === 'admin'}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none disabled:opacity-60"
                >
                  <option value="viewer">{t('viewerReadOnly')}</option>
                  <option value="editor">{t('editorRoleDesc')}</option>
                  <option value="administrator">{t('administrator')}</option>
                </select>
              </div>

              <div className="space-y-4 border-t border-slate-800 pt-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{t('userWorkspaces')}</h4>
                  <p className="text-[10px] text-slate-500 mt-1">{t('workspaceGroupMappingsDesc')}</p>
                </div>

                {loadingEditUserWorkspaces ? (
                  <div className="py-4 text-center text-slate-500 text-xs">{t('loading')}</div>
                ) : editUserWorkspaces.length === 0 ? (
                  <div className="py-4 text-center text-slate-500 text-xs">{t('noUserWorkspaces')}</div>
                ) : (
                  <div className="space-y-2">
                    {editUserWorkspaces.map((membership) => (
                      <div key={membership.workspace_id} className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-800/60 rounded-xl">
                        <div>
                          <p className="text-xs font-semibold text-slate-200">{membership.workspace_name || membership.workspace_id}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {membership.role} · {membership.source === 'sso' ? t('membershipSourceSSO') : t('membershipSourceManual')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveUserWorkspace(membership.workspace_id)}
                          className="p-2 text-slate-500 hover:text-red-400 transition cursor-pointer"
                          title={t('delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleAddUserWorkspace} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="md:col-span-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('workspaces')}</label>
                    <select
                      value={newUserWorkspaceId}
                      onChange={(e) => setNewUserWorkspaceId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                    >
                      <option value="">{t('workspaces')}</option>
                      {workspacesList.map((ws) => (
                        <option key={ws.id} value={ws.id}>{ws.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('role')}</label>
                    <select
                      value={newUserWorkspaceRole}
                      onChange={(e) => setNewUserWorkspaceRole(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                    >
                      <option value="viewer">{t('viewer')}</option>
                      <option value="editor">{t('editor')}</option>
                      <option value="administrator">{t('administrator')}</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={!newUserWorkspaceId}
                    className="w-full py-2.5 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                  >
                    {t('addMember')}
                  </button>
                </form>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditUserModalOpen(false)}
                  className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {savingUser ? t('saving') : t('saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeSettingsTab === 'workspaces' && isAdmin && (
        <div className="space-y-8 max-w-5xl">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Workspaces List */}
            <div className="lg:col-span-1 bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-purple-400" />
                  <span>{t('workspaces') || 'Workspaces'}</span>
                </h3>
                <button
                  onClick={() => {
                    setWorkspaceError('');
                    setIsWorkspaceModalOpen(true);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer hover:scale-102 active:scale-98 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('createWorkspace') || 'Create'}</span>
                </button>
              </div>

              {loadingWorkspaces ? (
                <div className="py-12 text-center text-slate-500 text-xs">{t('loading')}</div>
              ) : workspacesList.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">{t('none')}</div>
              ) : (
                <div className="space-y-2">
                  {workspacesList.map((ws) => {
                    const isSelected = selectedWorkspaceForMembers === ws.id;
                    return (
                      <div 
                        key={ws.id}
                        onClick={() => setSelectedWorkspaceForMembers(ws.id)}
                        className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                          isSelected 
                            ? 'bg-slate-950/60 border-purple-500/40 text-white' 
                            : 'bg-slate-950/20 border-slate-800/60 text-slate-400 hover:border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{ws.name}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-1 truncate">ID: {ws.id}</p>
                        </div>
                        {ws.id !== 'default' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteWorkspaceClick(ws.id, ws.name);
                            }}
                            className="p-1.5 border border-transparent hover:border-red-500/25 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-lg transition cursor-pointer shrink-0"
                            title={t('delete') || 'Delete'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: Workspace Members & Management */}
            <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" />
                <span>{t('workspaceMembers') || 'Workspace Members'}</span>
              </h3>

              {selectedWorkspaceForMembers ? (
                <div className="space-y-6">
                  {/* Add Member Form */}
                  <form onSubmit={handleSaveWorkspaceMember} className="bg-slate-950/40 border border-slate-800/60 p-5 rounded-2xl space-y-4">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{t('addWorkspaceMember') || 'Add Workspace Member'}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('username') || 'Username'}</label>
                        <input
                          type="text"
                          required
                          placeholder="Enter username"
                          value={newMemberUsername}
                          onChange={(e) => setNewMemberUsername(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('role') || 'Role'}</label>
                        <select
                          value={newMemberRole}
                          onChange={(e) => setNewMemberRole(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none cursor-pointer"
                        >
                          <option value="viewer">{t('viewer') || 'Viewer'}</option>
                          <option value="editor">{t('editor') || 'Editor'}</option>
                          <option value="administrator">{t('administrator') || 'Administrator'}</option>
                        </select>
                      </div>
                      <div>
                        <button
                          type="submit"
                          className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer hover:scale-102 active:scale-98 transition"
                        >
                          {t('addMember') || 'Add Member'}
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Members List */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{t('currentMembers') || 'Current Members'}</h4>
                    {loadingMembers ? (
                      <div className="py-8 text-center text-slate-500 text-xs">{t('loading')}</div>
                    ) : workspaceMembers.length === 0 ? (
                      <div className="py-8 text-center text-slate-500 text-xs">{t('noWorkspaceMembers') || 'No members added to this workspace yet.'}</div>
                    ) : (
                      <div className="space-y-2.5">
                        {workspaceMembers.map((member) => (
                          <div 
                            key={member.username} 
                            className="flex items-center justify-between p-3.5 bg-slate-950/40 border border-slate-800/60 rounded-xl"
                          >
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className="p-2 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg shrink-0">
                                <Users className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-200 truncate">{member.username}</p>
                                <p className="text-[9px] text-slate-500 font-mono mt-0.5">
                                  {t('role')}: <strong className="font-semibold text-purple-400 uppercase">{member.role}</strong>
                                  {' · '}
                                  {member.source === 'sso' ? t('membershipSourceSSO') : t('membershipSourceManual')}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteWorkspaceMember(member.username)}
                              className="p-2 text-slate-500 hover:text-red-400 transition cursor-pointer shrink-0"
                              title={t('delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 border-t border-slate-800 pt-6">
                    <div>
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{t('workspaceGroupMappings')}</h4>
                      <p className="text-[10px] text-slate-500 mt-1">{t('workspaceGroupMappingsDesc')}</p>
                    </div>

                    <form onSubmit={handleSaveWorkspaceGroupMapping} className="bg-slate-950/40 border border-slate-800/60 p-5 rounded-2xl space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div className="md:col-span-2 space-y-2">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('idpGroupName')}</label>
                          <input
                            type="text"
                            required
                            placeholder="platform-editors"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('role')}</label>
                          <select
                            value={newGroupRole}
                            onChange={(e) => setNewGroupRole(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none cursor-pointer"
                          >
                            <option value="viewer">{t('viewer')}</option>
                            <option value="editor">{t('editor')}</option>
                            <option value="administrator">{t('administrator')}</option>
                          </select>
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer"
                      >
                        {t('addWorkspaceGroupMapping')}
                      </button>
                    </form>

                    {loadingGroupMappings ? (
                      <div className="py-6 text-center text-slate-500 text-xs">{t('loading')}</div>
                    ) : workspaceGroupMappings.length === 0 ? (
                      <div className="py-6 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl">
                        {t('none')}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {workspaceGroupMappings.map((mapping) => (
                          <div
                            key={`${mapping.workspace_id}-${mapping.idp_group}`}
                            className="flex items-center justify-between p-3.5 bg-slate-950/40 border border-slate-800/60 rounded-xl"
                          >
                            <div>
                              <p className="text-xs font-semibold text-slate-200 font-mono">{mapping.idp_group}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {t('role')}: <strong className="text-purple-400 uppercase">{mapping.role}</strong>
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteWorkspaceGroupMapping(mapping.idp_group)}
                              className="p-2 text-slate-500 hover:text-red-400 transition cursor-pointer"
                              title={t('delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-24 text-center text-slate-500 border border-dashed border-slate-800 rounded-3xl text-xs">
                  {t('selectWorkspaceToManage') || 'Select a workspace from the list to manage its members.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Workspace Modal */}
      {isWorkspaceModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-8 shadow-2xl relative">
            <button
              onClick={() => setIsWorkspaceModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">{t('createWorkspace') || 'Create Workspace'}</h3>

            {workspaceError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {workspaceError}
              </div>
            )}

            <form onSubmit={handleSaveWorkspace} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('workspaceId') || 'Workspace ID'}</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. platform-team"
                  value={newWorkspace.id}
                  onChange={(e) => setNewWorkspace({ ...newWorkspace, id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('workspaceName') || 'Workspace Name'}</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Platform Team"
                  value={newWorkspace.name}
                  onChange={(e) => setNewWorkspace({ ...newWorkspace, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                />
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={savingWorkspace}
                  className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {savingWorkspace ? t('creating') || 'Creating...' : t('create') || 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
