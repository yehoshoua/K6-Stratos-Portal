'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supplementalStrings } from '@/i18n/strings';
import { api } from '@/services/api';
import { paletteContrastVariables } from '@/utils/colorContrast';

export type Language = 'en' | 'fr' | 'he' | 'zh' | 'es' | 'de';
export type Theme = 'light' | 'dark' | 'system';
export type ColorPalette = 'royal-vibrant' | 'golden-harvest' | 'cyber-neon' | 'gradient-blues' | string;

export const ALLOWED_PALETTE_IDS: ColorPalette[] = [
  'royal-vibrant',
  'golden-harvest',
  'cyber-neon',
  'gradient-blues',
];

export const FALLBACK_PALETTE_ID: ColorPalette = 'royal-vibrant';
export const FALLBACK_LANGUAGE: Language = 'en';
export const FALLBACK_THEME: Theme = 'light';

const allowedLanguageSet = new Set<string>(['en', 'fr', 'he', 'zh', 'es', 'de']);
const allowedThemeSet = new Set<string>(['light', 'dark', 'system']);

export interface CustomPalette {
  id: string;
  name: string;
  colors: {
    primary: string;
    primaryHover: string;
    primaryLight: string;
    primaryLightest: string;
    primaryDark: string;
    accent: string;
    accentHover: string;
    accentLight: string;
    accentLightest: string;
    accentDark: string;
    backgroundDark: string;
    backgroundLight: string;
  };
}

interface PreferencesContextType {
  lang: Language;
  theme: Theme;
  colorPalette: ColorPalette;
  setLang: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  setColorPalette: (palette: ColorPalette) => void;
  palettes: CustomPalette[];
  addCustomPalette: (palette: CustomPalette) => void;
  deleteCustomPalette: (id: string) => void;
  resetToDefaultPalettes: () => void;
  isBuiltinPalette: (id: string) => boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const translations = {
  en: {
    dashboard: "Dashboard",
    reports: "Reports",
    k8sClusters: "K8s Clusters",
    crdControl: "K6s TestRun CRDs",
    influxdb: "InfluxDB Analytics",
    schedules: "CronJob / Job",
    settings: "Settings",
    logout: "Log out",
    connected: "Connected",
    activeAgent: "K8s Agent Active",
    secureSession: "Secured TLS 1.3 Session",
    syncTime: "Last sync",
    addCluster: "Add Cluster",
    welcome: "Welcome to K6 Stratos",
    subWelcome: "Kubernetes & Performance Observability Portal",
    username: "Username",
    password: "Password",
    login: "Log In",
    ssoLogin: "Sign in with SSO",
    localLogin: "Local Login",
    ssoLoginTab: "SSO Authentication",
    defaultAccount: "Default Admin Credentials",
    verifyConn: "Verify Connection",
    status: "Status",
    save: "Save",
    cancel: "Cancel",
    clusterName: "Cluster Name",
    apiServerUrl: "API Server URL",
    authType: "Authentication Type",
    caCert: "CA Certificate (Optional, Base64)",
    crdDetails: "CRD Details",
    specObject: "Kubernetes Spec Object",
    limits: "Resource Limits (Runner)",
    newTest: "New Test",
    runs: "Runs in InfluxDB",
    telemetry: "Telemetry",
    maxVal: "Maximum Value",
    avgVal: "Average Value",
    minVal: "Minimum Value",
    settingsTitle: "Platform Settings",
    settingsSub: "Define Kubernetes clusters and InfluxDB telemetry credentials.",
    awsEksDiscovery: "EKS Auto-Discovery",
    awsEksDiscoveryDesc: "Discover EKS clusters automatically using IAM assume role across multi-accounts and multi-regions.",
    awsEksDiscoveryConfigured: "Auto-discovery configured via environment.",
    awsEksDiscoveryNotConfigured: "Auto-discovery is not configured. Define AWS_ACCOUNTS_DISCOVERY in the backend environment.",
    scanEKS: "Scan AWS Accounts",
    syncSelected: "Sync Selected EKS Clusters",
    discoveredClusters: "Discovered Clusters",
    influxConfigTitle: "InfluxDB Database Connection",
    influxConfigSub: "Configure parameters used to query performance runs.",
    url: "URL",
    token: "Token",
    org: "Organization",
    bucket: "Bucket",
    accessForbidden: "Access Forbidden",
    adminRequired: "Administrator privileges are required to view this page.",
    theme: "Theme",
    lang: "Language",
    testConn: "Test Connection",
    runners: "Runners",
    stage: "Stage",
    createdOn: "Created On",
    details: "Details",
    crdList: "k6s.k6.io resources",
    noResources: "No Custom Resource K6 present in this namespace.",
    selectRes: "Select a resource to display its details.",
    instantiateK6: "Instantiate K6 Test",
    launchSpecDesc: "Create a Custom Resource `K6` that deploys the test architecture on the cluster.",
    runName: "Run Name (Resource Name)",
    parallelism: "Parallelism (Runners)",
    scriptConfigMap: "Script ConfigMap",
    jsFile: "JS File",
    cpuLimit: "CPU Limit",
    memLimit: "RAM Limit",
    scheduleTest: "Schedule this test",
    cronExpression: "Cron expression",
    cronExample: "Example: */5 * * * *",
    cronRequired: "Cron expression is required to schedule a test.",
    cronInvalid: "Cron expression must have exactly 5 fields.",
    scheduleRequiresScript: "Select a template or use manual script to schedule.",
    scheduleCreated: "Schedule created successfully!",
    scriptSource: "Script Configuration Method",
    manualScript: "Write script manually",
    existingScript: "Use existing ConfigMap",
    selectConfigMap: "Select Script ConfigMap",
    newConfigMap: "New ConfigMap",
    configMapName: "ConfigMap Name",
    jsFileName: "JS File Name",
    cmContent: "Initial JS Script",
    creatingConfigMap: "Creating...",
    duplicateFrom: "Duplicate from existing (Optional)",
    deploying: "Deploying...",
    deploy: "Deploy",
    clustersK8s: "K8s Clusters",
    inspectClusters: "Inspect K8s API Server connectivity, infrastructure pod health, and secure configurations.",
    k8sVersion: "Kubernetes Version",
    awsRegion: "AWS Region",
    authMech: "Authentication Mechanism",
    registeredOn: "Registered On",
    active: "Active",
    checking: "Checking...",
    fail: "Failed",
    securityCheck: "Security Controls & Status",
    aesActive: "AES-256-GCM encryption active at rest",
    tlsChecked: "Kubernetes CA certificate verified",
    rbacLimit: "RBAC access restricted to test namespace",
    totalClusters: "Total K8s Clusters",
    k6SuccessRate: "K6 Success Rate",
    activeTests: "Active Tests",
    influxTelemetries: "InfluxDB Telemetries",
    recentRuns: "Recent performance runs",
    addClusterDesc: "Register cluster configuration. Sensitive credentials are encrypted via AES-256-GCM.",
    caCertDesc: "CA Certificate (Optional, Base64)",
    secretToken: "Access Token (Bearer)",
    kubeconfigYaml: "Kubeconfig (YAML Content)",
    validating: "Validating...",
    submit: "Submit",
    defaultMockCluster: "Mock Environment",
    registeredK8sClusters: "Your K8s Clusters",
    operatorStatus: "Operator Status",
    recommendations: "Help & Recommendations",
    recDesc: "Use the K6s TestRun CRDs menu to schedule and monitor load runs. Consolidated performance metrics are automatically pushed to InfluxDB and viewable in the InfluxDB Analytics panel.",
    metricsTitle: "InfluxDB Analytics",
    metricsSub: "Visualize historical load runs and track http request rates and user counts.",
    metricRateToggle: "Latency (http_req_duration)",
    metricVUsToggle: "Active Users (vus)",
    metricErrorToggle: "Error Rate (http_req_failed)",
    valMax: "Peak Value",
    valAvg: "Average",
    valMin: "Minimum",
    chartLoading: "Loading telemetry...",
    chartNoData: "No telemetry records found.",
    chartSelectRun: "Select a test run to load performance curves.",
    savedClusters: "Connected Clusters",
    operational: "Operational",
    testRunLabel: "Test Run",
    influxSettingsSuccess: "InfluxDB configuration updated successfully.",
    influxSettingsError: "Failed to update InfluxDB configuration.",
    k8sSettingsError: "Failed to save cluster configuration.",
    k8sLoadError: "Failed to load Kubernetes clusters.",
    deleteClusterTitle: "Delete Kubernetes Cluster",
    deleteClusterConfirmPrefix: "Are you sure you want to delete the K8S Cluster",
    deleteClusterConfirmSuffix: "?",
    deleteClusterWarning: "This action cannot be undone. This will permanently delete the cluster connection and remove it from your dashboard settings.",
    deleteClusterTypePrompt: "Please type the cluster name to confirm:",
    deleteTemplateTitle: "Delete Template",
    deleteTemplateConfirm: "Are you sure you want to delete the template \"{name}\"?",
    deleteUserTitle: "Delete User",
    deleteUserConfirm: "Are you sure you want to delete the user \"{name}\"?",
    cannotDeleteAdmin: "Cannot delete the main admin account.",
    apiTokens: "API Tokens",
    generateToken: "Generate Token",
    tokenName: "Token Name",
    expiry: "Expiration",
    role: "Role",
    create: "Create",
    never: "Never",
    days7: "7 Days",
    days30: "30 Days",
    days90: "90 Days",
    createdAt: "Created At",
    expiresAt: "Expires At",
    tokenCopied: "Token copied to clipboard!",
    copy: "Copy",
    tokenNotice: "Save this token now! It will not be shown again.",
    deleteTokenTitle: "Delete API Token",
    deleteTokenConfirm: "Are you sure you want to delete the API Token \"{name}\"?",
    colorPalette: "Color Palette",
    paletteDefault: "Purple & Pink (Default)",
    paletteOceanBlue: "Ocean Blue Serenity",
    paletteGradientBlues: "Gradient Blues",
    paletteBlueSerenity: "Blue Serenity",
    paletteGoldenHarvest: "Golden Harvest",
    paletteNeonEmerald: "Neon Emerald & Mint",
    paletteSunsetGlow: "Sunset Gold & Orange",
    paletteCyberNeon: "Cyber Purple & Neon Pink",
    paletteRoyalVibrant: "Royal Blue & Cyan",
    resetColors: "Reset to Default Palettes",
    addCustomPalette: "+ Add Custom Palette",
    customPaletteTitle: "Add Custom Palette",
    editCustomPalette: "Edit Custom Palette",
    paletteName: "Palette Name",
    primaryColor: "Primary Color",
    primaryHover: "Primary Hover",
    primaryLight: "Primary Light",
    primaryLightest: "Primary Lightest",
    primaryDark: "Primary Dark",
    accentColor: "Accent Color",
    accentHover: "Accent Hover",
    accentLight: "Accent Light",
    accentLightest: "Accent Lightest",
    accentDark: "Accent Dark",
    backgroundDark: "Dark Background Color",
    backgroundLight: "Light Background Color",
    createPalette: "Create Palette",
    deletePaletteTitle: "Delete Custom Palette",
    deletePaletteConfirm: "Are you sure you want to delete the custom palette \"{name}\"?",
    ...supplementalStrings.en,
  },
  fr: {
    dashboard: "Tableau de bord",
    reports: "Rapports",
    k8sClusters: "Clusters K8s",
    crdControl: "CRDs K6s TestRun",
    influxdb: "Analyses InfluxDB",
    schedules: "CronJob / Job",
    settings: "Paramètres",
    logout: "Se déconnecter",
    connected: "Connecté",
    activeAgent: "Agent K8s Actif",
    secureSession: "Session TLS 1.3 Sécurisée",
    syncTime: "Dernière synchro",
    addCluster: "Ajouter un Cluster",
    welcome: "Bienvenue sur K6 Stratos",
    subWelcome: "Portail d'Observabilité Kubernetes & Performance",
    username: "Identifiant",
    password: "Mot de passe",
    login: "Se connecter",
    ssoLogin: "Se connecter via le SSO",
    localLogin: "Connexion Locale",
    ssoLoginTab: "Authentification SSO",
    defaultAccount: "Compte par défaut",
    verifyConn: "Tester la connexion",
    status: "Statut",
    save: "Valider",
    cancel: "Annuler",
    clusterName: "Nom du Cluster",
    apiServerUrl: "Adresse de l'API Server (URL)",
    authType: "Type de Connexion",
    caCert: "Certificat CA (Optionnel, Base64)",
    crdDetails: "Détails du CRD",
    specObject: "Objet Spec Kubernetes",
    limits: "Limites de Ressources (Runner)",
    newTest: "Nouveau Test",
    runs: "Runs dans InfluxDB",
    telemetry: "Télémétrie",
    maxVal: "Valeur Maximale",
    avgVal: "Valeur Moyenne",
    minVal: "Valeur Minimale",
    settingsTitle: "Paramètres de la Plateforme",
    settingsSub: "Définissez les clusters Kubernetes et les identifiants de télémétrie InfluxDB.",
    awsEksDiscovery: "Auto-découverte EKS",
    awsEksDiscoveryDesc: "Découvrez automatiquement les clusters EKS via l'assume role IAM sur plusieurs comptes et régions.",
    awsEksDiscoveryConfigured: "Auto-découverte configurée via l'environnement.",
    awsEksDiscoveryNotConfigured: "L'auto-découverte n'est pas configurée. Définissez la variable AWS_ACCOUNTS_DISCOVERY dans le backend.",
    scanEKS: "Scanner les comptes AWS",
    syncSelected: "Synchroniser les EKS sélectionnés",
    discoveredClusters: "Clusters découverts",
    influxConfigTitle: "Connexion Base InfluxDB",
    influxConfigSub: "Configurez les paramètres utilisés pour requêter les runs de performance.",
    url: "URL",
    token: "Token",
    org: "Organisation",
    bucket: "Bucket",
    accessForbidden: "Accès Interdit",
    adminRequired: "Les privilèges d'administrateur sont requis pour accéder à cette page.",
    theme: "Thème",
    lang: "Langue",
    testConn: "Tester la connexion",
    runners: "Exécuteurs",
    stage: "Étape",
    createdOn: "Créé le",
    details: "Détails",
    crdList: "Ressources k6s.k6.io",
    noResources: "Aucune ressource Custom Resource K6 présente dans ce namespace.",
    selectRes: "Sélectionnez une ressource pour afficher ses détails.",
    instantiateK6: "Instancier un Test K6",
    launchSpecDesc: "Créez une ressource Custom Resource `K6` qui déploiera l'architecture de test sur le cluster sélectionné.",
    runName: "Nom du Run (Ressource Name)",
    parallelism: "Parallélisme (Runners)",
    scriptConfigMap: "ConfigMap de Script",
    jsFile: "Fichier JS",
    cpuLimit: "Limites CPU",
    memLimit: "Limites RAM",
    scheduleTest: "Planifier ce test",
    cronExpression: "Expression cron",
    cronExample: "Exemple : */5 * * * *",
    cronRequired: "L'expression cron est requise pour planifier un test.",
    cronInvalid: "L'expression cron doit contenir exactement 5 champs.",
    scheduleRequiresScript: "Sélectionnez un modèle ou utilisez un script manuel pour planifier.",
    scheduleCreated: "Planification créée avec succès !",
    scriptSource: "Méthode de configuration du script",
    manualScript: "Écrire le script manuellement",
    existingScript: "Utiliser une ConfigMap existante",
    selectConfigMap: "Sélectionner la ConfigMap du Script",
    newConfigMap: "Nouvelle ConfigMap",
    configMapName: "Nom de la ConfigMap",
    jsFileName: "Nom du fichier JS",
    cmContent: "Script JS Initial",
    creatingConfigMap: "Création...",
    duplicateFrom: "Dupliquer depuis l'existant (Optionnel)",
    deploying: "Déploiement...",
    deploy: "Déployer",
    clustersK8s: "Clusters K8s",
    inspectClusters: "Inspectez la connectivité de l'API Server, les états des pods d'infrastructure et les configurations sécurisées.",
    k8sVersion: "Version Kubernetes",
    awsRegion: "Région AWS",
    authMech: "Mécanisme d'Authentification",
    registeredOn: "Enregistré le",
    active: "Actif",
    checking: "Vérification...",
    fail: "Échec",
    securityCheck: "Contrôles de Sécurité & Statut",
    aesActive: "Chiffrement AES-256-GCM actif en base de données",
    tlsChecked: "Certificat CA Kubernetes vérifié",
    rbacLimit: "Accès RBAC limité au namespace de test",
    totalClusters: "Clusters K8s Connectés",
    k6SuccessRate: "Taux de Succès K6",
    activeTests: "Tests Actifs",
    influxTelemetries: "Télémétries InfluxDB",
    recentRuns: "Runs récents de performance",
    addClusterDesc: "Enregistrez vos configurations de cluster. Les credentials sensibles sont chiffrés à l'aide d'une clé AES-256-GCM.",
    caCertDesc: "Certificat CA (Optionnel, Base64)",
    secretToken: "Token d'accès (Bearer)",
    kubeconfigYaml: "Kubeconfig (Contenu YAML)",
    validating: "Validation...",
    submit: "Valider",
    defaultMockCluster: "Environnement Mocké",
    registeredK8sClusters: "Vos Clusters Kubernetes",
    operatorStatus: "Statut des Opérateurs",
    recommendations: "Aide & Recommandations",
    recDesc: "Utilisez les menus CRDs K6 Operator pour planifier et suivre vos exécutions de tests de charge. Les résultats de performance consolidés seront automatiquement agrégés dans InfluxDB et consultables via le panneau Analyses InfluxDB.",
    metricsTitle: "Analyses InfluxDB",
    metricsSub: "Visualisez les performances historiques et suivez l'évolution des requêtes HTTP et de la charge utilisateurs.",
    metricRateToggle: "Latence (http_req_duration)",
    metricVUsToggle: "Utilisateurs (vus)",
    metricErrorToggle: "Taux d'erreur (http_req_failed)",
    valMax: "Valeur Maximale",
    valAvg: "Moyenne",
    valMin: "Valeur Minimale",
    chartLoading: "Chargement du graphique...",
    chartNoData: "Pas de données graphiques.",
    chartSelectRun: "Sélectionnez un test run pour charger les graphes de télémétrie.",
    savedClusters: "Clusters Connectés",
    operational: "Opérationnels",
    testRunLabel: "Test Run",
    influxSettingsSuccess: "Configuration InfluxDB mise à jour avec succès.",
    influxSettingsError: "Échec de la mise à jour de la configuration InfluxDB.",
    k8sSettingsError: "Échec de la configuration du cluster.",
    k8sLoadError: "Échec du chargement des clusters Kubernetes.",
    deleteClusterTitle: "Supprimer le Cluster Kubernetes",
    deleteClusterConfirmPrefix: "Êtes-vous sûr de vouloir supprimer le cluster K8S",
    deleteClusterConfirmSuffix: " ?",
    deleteClusterWarning: "Cette action est irréversible. Cela supprimera définitivement la connexion au cluster et la retirera des paramètres de votre tableau de bord.",
    deleteClusterTypePrompt: "Veuillez saisir le nom du cluster pour confirmer :",
    deleteTemplateTitle: "Supprimer le modèle",
    deleteTemplateConfirm: "Êtes-vous sûr de vouloir supprimer le modèle \"{name}\" ?",
    deleteUserTitle: "Supprimer l'utilisateur",
    deleteUserConfirm: "Êtes-vous sûr de vouloir supprimer l'utilisateur \"{name}\" ?",
    cannotDeleteAdmin: "Impossible de supprimer le compte administrateur principal.",
    apiTokens: "Tokens API",
    generateToken: "Générer un token",
    tokenName: "Nom du token",
    expiry: "Expiration",
    role: "Rôle",
    create: "Créer",
    never: "Jamais",
    days7: "7 Jours",
    days30: "30 Jours",
    days90: "90 Jours",
    createdAt: "Créé le",
    expiresAt: "Expire le",
    tokenCopied: "Token copié dans le presse-papiers !",
    copy: "Copier",
    tokenNotice: "Enregistrez ce token maintenant ! Il ne sera plus affiché.",
    deleteTokenTitle: "Supprimer le token API",
    deleteTokenConfirm: "Êtes-vous sûr de vouloir supprimer le token API \"{name}\" ?",
    colorPalette: "Palette de Couleurs",
    paletteDefault: "Violet & Rose (Défaut)",
    paletteOceanBlue: "Bleu Océan Sérénité",
    paletteGradientBlues: "Dégradés de Bleu",
    paletteBlueSerenity: "Bleu Sérénité",
    paletteGoldenHarvest: "Moisson Dorée",
    paletteNeonEmerald: "Émeraude Néon & Menthe",
    paletteSunsetGlow: "Coucher de Soleil & Orange",
    paletteCyberNeon: "Violet Cyber & Rose Néon",
    paletteRoyalVibrant: "Bleu Royal & Cyan",
    resetColors: "Réinitialiser les Palettes",
    addCustomPalette: "+ Palette personnalisée",
    customPaletteTitle: "Ajouter une palette personnalisée",
    editCustomPalette: "Modifier la palette personnalisée",
    paletteName: "Nom de la palette",
    primaryColor: "Couleur principale",
    primaryHover: "Survol principal",
    primaryLight: "Clair principal",
    primaryLightest: "Très clair principal",
    primaryDark: "Sombre principal",
    accentColor: "Couleur d'accent",
    accentHover: "Survol d'accent",
    accentLight: "Clair d'accent",
    accentLightest: "Très clair d'accent",
    accentDark: "Sombre d'accent",
    backgroundDark: "Couleur de fond sombre",
    backgroundLight: "Couleur de fond claire",
    createPalette: "Créer la palette",
    deletePaletteTitle: "Supprimer la palette personnalisée",
    deletePaletteConfirm: "Êtes-vous sûr de vouloir supprimer la palette personnalisée \"{name}\" ?",
    ...supplementalStrings.fr,
  },
  he: {
    dashboard: "לוח בקרה",
    reports: "דוחות",
    k8sClusters: "K8s Clusters",
    crdControl: "K6s TestRun CRDs",
    influxdb: "אנליטיקת InfluxDB",
    schedules: "CronJob / Job",
    settings: "הגדרות",
    logout: "התנתק",
    connected: "מחובר",
    activeAgent: "סוכן K8s פעיל",
    secureSession: "סשן TLS 1.3 מאובטח",
    syncTime: "סנכרון אחרון",
    addCluster: "הוסף אשכול",
    welcome: "ברוכים הבאים ל-K6 Stratos",
    subWelcome: "פורטל ניטור ביצועים וקיברנטיס",
    username: "שם משתמש",
    password: "סיסמה",
    login: "התחבר",
    ssoLogin: "התחברות באמצעות SSO",
    localLogin: "התחברות מקומית",
    ssoLoginTab: "אימות SSO",
    defaultAccount: "חשבון מנהל ברירת מחדל",
    verifyConn: "בדוק חיבור",
    status: "סטטוס",
    save: "שמור",
    cancel: "ביטול",
    clusterName: "שם האשכול",
    apiServerUrl: "כתובת שרת ה-API",
    authType: "סוג אימות",
    caCert: "אישור CA (אופציונלי, Base64)",
    crdDetails: "פרטי CRD",
    specObject: "אובייקט Spec של קיברנטיס",
    limits: "מגבלות משאבים (Runner)",
    newTest: "בדיקה חדשה",
    runs: "הרצות ב-InfluxDB",
    telemetry: "טלמטריה",
    maxVal: "ערך מקסימלי",
    avgVal: "ערך ממוצע",
    minVal: "ערך מינימלי",
    settingsTitle: "הגדרות פלטפורמה",
    settingsSub: "הגדר אשכולות קיברנטיס ופרטי גישה ל-InfluxDB.",
    awsEksDiscovery: "גילוי אוטומטי של EKS",
    awsEksDiscoveryDesc: "גלה אשכולות EKS באופן אוטומטי באמצעות AssumeRole של IAM בין מספר חשבונות ואזורים.",
    awsEksDiscoveryConfigured: "גילוי אוטומטי מוגדר באמצעות הסביבה.",
    awsEksDiscoveryNotConfigured: "גילוי אוטומטי אינו מוגדר. הגדר את AWS_ACCOUNTS_DISCOVERY בסביבת ה-backend.",
    scanEKS: "סרוק חשבונות AWS",
    syncSelected: "סנכרן אשכולות EKS שנבחרו",
    discoveredClusters: "אשכולות שהתגלו",
    influxConfigTitle: "חיבור למסד נתונים InfluxDB",
    influxConfigSub: "הגדר פרמטרים לשאילתות הרצת ביצועים.",
    url: "כתובת URL",
    token: "אסימון (Token)",
    org: "ארגון (Org)",
    bucket: "באקט (Bucket)",
    accessForbidden: "הגישה נחסמה",
    adminRequired: "נדרשות הרשאות מנהל כדי לצפות בדף זה.",
    theme: "ערכת נושא",
    lang: "שפה",
    testConn: "בדוק חיבור",
    runners: "רצים",
    stage: "שלב",
    createdOn: "נוצר ב",
    details: "פרטים",
    crdList: "משאבי k6s.k6.io",
    noResources: "אין משאבי K6 בNamespace זה.",
    selectRes: "בחר משאב להצגת פרטים.",
    instantiateK6: "צור בדיקת K6 חדשה",
    launchSpecDesc: "צור משאב K6 חדש לפריסת בדיקת העומס באשכול.",
    runName: "שם הבדיקה",
    parallelism: "מקביליות (Runners)",
    scriptConfigMap: "Script ConfigMap",
    jsFile: "קובץ JS",
    cpuLimit: "מגבלת CPU",
    memLimit: "מגבלת RAM",
    scheduleTest: "תזמן את הבדיקה",
    cronExpression: "ביטוי Cron",
    cronExample: "דוגמה: */5 * * * *",
    cronRequired: "נדרש ביטוי Cron כדי לתזמן בדיקה.",
    cronInvalid: "ביטוי Cron חייב להכיל בדיוק 5 שדות.",
    scheduleRequiresScript: "יש לבחור תבנית או להשתמש בסקריפט ידני כדי לתזמן.",
    scheduleCreated: "התזמון נוצר בהצלחה!",
    scriptSource: "שיטת הגדרת הסקריפט",
    manualScript: "כתיבת סקריפט ידנית",
    existingScript: "שימוש ב-ConfigMap קיים",
    selectConfigMap: "בחר ConfigMap של סקריפט",
    newConfigMap: "ConfigMap חדש",
    configMapName: "שם ה-ConfigMap",
    jsFileName: "שם קובץ JS",
    cmContent: "סקריפט JS ראשוני",
    creatingConfigMap: "יוצר...",
    duplicateFrom: "שכפול מתוך קיים (אופציונלי)",
    deploying: "פורס...",
    deploy: "פרוס בדיקה",
    clustersK8s: "K8s Clusters",
    inspectClusters: "בדוק חיבור לשרת ה-API של K8s, בריאות הפודים והגדרות אבטחה.",
    k8sVersion: "גרסת קיברנטיס",
    awsRegion: "אזור AWS",
    authMech: "מנגנון אימות",
    registeredOn: "נרשם ב",
    active: "פעיל",
    checking: "בודק...",
    fail: "נכשל",
    securityCheck: "בקרות אבטחה וסטטוס",
    aesActive: "הצפנת AES-256-GCM פעילה",
    tlsChecked: "אישור CA של קיברנטיס מאומת",
    rbacLimit: "גישת RBAC מוגבלת לNamespace של הבדיקה",
    totalClusters: "סך הכל K8s Clusters",
    k6SuccessRate: "שיעור הצלחה K6",
    activeTests: "בדיקות פעילות",
    influxTelemetries: "חיבורי InfluxDB",
    recentRuns: "הרצות ביצועים אחרונות",
    addClusterDesc: "רשום הגדרות אשכול. פרטי גישה רגישים מוצפנים ב-AES-256-GCM.",
    caCertDesc: "אישור CA (אופציונלי, Base64)",
    secretToken: "אסימון גישה (Bearer)",
    kubeconfigYaml: "קובץ Kubeconfig (תוכן YAML)",
    validating: "מאמת...",
    submit: "שלח",
    defaultMockCluster: "סביבה מדומה",
    registeredK8sClusters: "אשכולות הקיברנטיס שלך",
    operatorStatus: "סטטוס מפעילים (Operators)",
    recommendations: "עזרה והמלצות",
    recDesc: "השתמש בתפריט CRDs של K6 Operator כדי לתזמן ולעקוב אחר בדיקות עומס. מדדי ביצועים נשמרים ב-InfluxDB וזמינים בדף אנליטיקת InfluxDB.",
    metricsTitle: "אנליטיקת InfluxDB",
    metricsSub: "צפה בהרצות ביצועים היסטוריות ועקוב אחר קצב בקשות HTTP וכמות משתמשים.",
    metricRateToggle: "זמן תגובה (http_req_duration)",
    metricVUsToggle: "משתמשים פעילים (vus)",
    metricErrorToggle: "שיעור שגיאות (http_req_failed)",
    valMax: "ערך שיא",
    valAvg: "ממוצע",
    valMin: "מינימום",
    chartLoading: "טוען נתונים...",
    chartNoData: "לא נמצאו נתוני טלמטריה.",
    chartSelectRun: "בחר הרצה לטעינת גרף ביצועים.",
    savedClusters: "אשכולות מחוברים",
    operational: "פעיל ומבצעי",
    testRunLabel: "הרצת בדיקה",
    influxSettingsSuccess: "הגדרות InfluxDB עודכנו בהצלחה.",
    influxSettingsError: "עדכון הגדרות InfluxDB נכשל.",
    k8sSettingsError: "שמירת הגדרות האשכול נכשלה.",
    k8sLoadError: "טעינת אשכולות קיברנטיס נכשלה.",
    deleteClusterTitle: "מחיקת אשכול קיברנטיס",
    deleteClusterConfirmPrefix: "האם אתה בטוח שברצונך למחוק את אשכול ה-K8S",
    deleteClusterConfirmSuffix: "?",
    deleteClusterWarning: "פעולה זו אינה הפיכה. היא תמחק לצמיתות את החיבור לאשכול ותסיר אותו מהגדרות לוח הבקרה.",
    deleteClusterTypePrompt: "אנא הקלד את שם האשכול כדי לאשר:",
    deleteTemplateTitle: "מחיקת תבנית",
    deleteTemplateConfirm: "האם אתה בטוח שברצונך למחוק את התבנית \"{name}\"?",
    deleteUserTitle: "מחיקת משתמש",
    deleteUserConfirm: "האם אתה בטוח שברצונך למחוק את המשתמש \"{name}\"?",
    cannotDeleteAdmin: "לא ניתן למחוק את חשבון המנהל הראשי.",
    apiTokens: "אסימוני API",
    generateToken: "צור אסימון",
    tokenName: "שם האסימון",
    expiry: "תפוגה",
    role: "תפקיד",
    create: "צור",
    never: "אף פעם",
    days7: "7 ימים",
    days30: "30 ימים",
    days90: "90 ימים",
    createdAt: "נוצר ב-",
    expiresAt: "פג ב-",
    tokenCopied: "האסימון הועתק ללוח!",
    copy: "העתק",
    tokenNotice: "שמור אסימון זה כעת! הוא לא יוצג שוב.",
    deleteTokenTitle: "מחק אסימון API",
    deleteTokenConfirm: "האם אתה בטוח שברצונך למחוק את אסימון ה-API \"{name}\"?",
    colorPalette: "פלטת צבעים",
    paletteDefault: "סגול וורוד (ברירת מחדל)",
    paletteOceanBlue: "שלוות כחול אוקיינוס",
    paletteGradientBlues: "כחולים מדורגים",
    paletteBlueSerenity: "שלווה כחולה",
    paletteGoldenHarvest: "קציר הזהב",
    paletteNeonEmerald: "ברקת ניאון ומנטה",
    paletteSunsetGlow: "זהב שקיעה וכתום",
    paletteCyberNeon: "סגול סייבר וורוד ניאון",
    paletteRoyalVibrant: "כחול מלכותי וציאן",
    resetColors: "אפס לפלטות ברירת מחדל",
    addCustomPalette: "+ הוסף פלטה מותאמת אישית",
    customPaletteTitle: "הוסף פלטה מותאמת אישית",
    editCustomPalette: "ערוך פלטה מותאמת אישית",
    paletteName: "שם הפלטה",
    primaryColor: "צבע ראשי",
    primaryHover: "צבע מעבר ראשי",
    primaryLight: "צבע בהיר ראשי",
    primaryLightest: "צבע בהיר ביותר ראשי",
    primaryDark: "צבע כהה ראשי",
    accentColor: "צבע הדגשה",
    accentHover: "צבע מעבר הדגשה",
    accentLight: "צבע בהיר הדגשה",
    accentLightest: "צבע בהיר ביותר הדגשה",
    accentDark: "צבע כהה הדגשה",
    backgroundDark: "צבע רקע כהה",
    backgroundLight: "צבע רקע בהיר",
    createPalette: "צור פלטה",
    deletePaletteTitle: "מחק פלטה מותאמת אישית",
    deletePaletteConfirm: "האם אתה בטוח שברצונך למחוק את הפלטה המותאמת אישית \"{name}\"?",
    ...supplementalStrings.he,
  },
  zh: {
    dashboard: "仪表板",
    reports: "报告",
    k8sClusters: "K8s 集群",
    crdControl: "K6s TestRun CRDs",
    influxdb: "InfluxDB 分析",
    schedules: "CronJob / Job",
    settings: "设置",
    logout: "登出",
    connected: "已连接",
    activeAgent: "K8s 代理已激活",
    secureSession: "安全 TLS 1.3 会话",
    syncTime: "上次同步",
    addCluster: "添加集群",
    welcome: "欢迎使用 K6 Stratos",
    subWelcome: "Kubernetes 与性能观测门户",
    username: "用户名",
    password: "密码",
    login: "登录",
    ssoLogin: "通过 SSO 登录",
    localLogin: "本地登录",
    ssoLoginTab: "SSO 身份验证",
    defaultAccount: "默认管理员账户",
    verifyConn: "测试连接",
    status: "状态",
    save: "保存",
    cancel: "取消",
    clusterName: "集群名称",
    apiServerUrl: "API 服务器 URL",
    authType: "认证类型",
    caCert: "CA 证书（可选，Base64）",
    crdDetails: "CRD 详情",
    specObject: "Kubernetes Spec 对象",
    limits: "资源限制 (Runner)",
    newTest: "新建测试",
    runs: "InfluxDB 运行记录",
    telemetry: "遥测",
    maxVal: "最大值",
    avgVal: "平均值",
    minVal: "最小值",
    settingsTitle: "平台设置",
    settingsSub: "定义 Kubernetes 集群与 InfluxDB 遥测凭据。",
    awsEksDiscovery: "EKS 自动发现",
    awsEksDiscoveryDesc: "在多账号、多区域下使用 IAM AssumeRole 自动发现 EKS 集群。",
    awsEksDiscoveryConfigured: "已通过环境变量配置自动发现。",
    awsEksDiscoveryNotConfigured: "未配置自动发现。请在后端环境中定义 AWS_ACCOUNTS_DISCOVERY。",
    scanEKS: "扫描 AWS 账号",
    syncSelected: "同步选中的 EKS 集群",
    discoveredClusters: "发现的的集群",
    influxConfigTitle: "InfluxDB 数据库连接",
    influxConfigSub: "配置用于查询性能运行记录的参数。",
    url: "URL地址",
    token: "访问令牌 (Token)",
    org: "组织 (Org)",
    bucket: "存储桶 (Bucket)",
    accessForbidden: "拒绝访问",
    adminRequired: "查看此页面需要管理员权限。",
    theme: "主题",
    lang: "语言",
    testConn: "测试连接",
    runners: "执行器 (Runners)",
    stage: "阶段",
    createdOn: "创建时间",
    details: "详情",
    crdList: "k6s.k6.io 资源列表",
    noResources: "在此命名空间中未找到 K6 自定义资源。",
    selectRes: "选择一个资源以显示其详细信息。",
    instantiateK6: "实例化 K6 测试",
    launchSpecDesc: "创建一个自定义资源 `K6`，在集群上部署负载测试架构。",
    runName: "测试运行名称",
    parallelism: "并发数 (Runners)",
    scriptConfigMap: "脚本 ConfigMap",
    jsFile: "JS 脚本文件",
    cpuLimit: "CPU 限制",
    memLimit: "内存限制",
    scheduleTest: "计划此测试",
    cronExpression: "Cron 表达式",
    cronExample: "示例：*/5 * * * *",
    cronRequired: "计划测试需要填写 Cron 表达式。",
    cronInvalid: "Cron 表达式必须正好包含 5 个字段。",
    scheduleRequiresScript: "请先选择模板或使用手动脚本以便计划运行。",
    scheduleCreated: "计划创建成功！",
    scriptSource: "脚本配置方式",
    manualScript: "手动编写脚本",
    existingScript: "使用现有 ConfigMap",
    selectConfigMap: "选择脚本 ConfigMap",
    newConfigMap: "新建 ConfigMap",
    configMapName: "ConfigMap 名称",
    jsFileName: "JS 文件名称",
    cmContent: "初始 JS 脚本",
    creatingConfigMap: "创建中...",
    duplicateFrom: "从现有复制 (可选)",
    deploying: "部署中...",
    deploy: "部署测试",
    clustersK8s: "K8s 集群",
    inspectClusters: "检查 K8s API 服务器连接性、基础设施 Pod 健康状况和安全配置。",
    k8sVersion: "Kubernetes 版本",
    awsRegion: "AWS 区域",
    authMech: "认证机制",
    registeredOn: "注册时间",
    active: "正常运行",
    checking: "检查中...",
    fail: "失败",
    securityCheck: "安全控制与状态",
    aesActive: "AES-256-GCM 静态加密已启用",
    tlsChecked: "Kubernetes CA 证书已验证",
    rbacLimit: "RBAC 权限仅限于测试命名空间",
    totalClusters: "K8s 集群总数",
    k6SuccessRate: "K6 测试成功率",
    activeTests: "活动测试数",
    influxTelemetries: "InfluxDB 连接数",
    recentRuns: "最近的性能测试",
    addClusterDesc: "注册集群配置。敏感凭据已通过 AES-256-GCM 加密。",
    caCertDesc: "CA 证书 (Base64)",
    secretToken: "访问令牌 (Bearer)",
    kubeconfigYaml: "Kubeconfig (YAML 格式)",
    validating: "验证中...",
    submit: "提交",
    defaultMockCluster: "模拟环境",
    registeredK8sClusters: "您的 Kubernetes 集群",
    operatorStatus: "算子组件状态",
    recommendations: "使用帮助与建议",
    recDesc: "使用 K6s TestRun CRDs 菜单调度和监视负载测试。汇总的性能指标会自动写入 InfluxDB，并可在 InfluxDB 分析面板中查看。",
    metricsTitle: "InfluxDB 数据分析",
    metricsSub: "可视化历史测试运行，跟踪 HTTP 请求速率和活跃用户数。",
    metricRateToggle: "请求延迟 (http_req_duration)",
    metricVUsToggle: "活跃用户数 (vus)",
    metricErrorToggle: "错误率 (http_req_failed)",
    valMax: "峰值",
    valAvg: "平均值",
    valMin: "最小值",
    chartLoading: "加载遥测数据中...",
    chartNoData: "未找到遥测记录。",
    chartSelectRun: "选择一个测试运行记录以加载性能曲线图。",
    savedClusters: "已连接的集群",
    operational: "正常就绪",
    testRunLabel: "测试运行",
    influxSettingsSuccess: "InfluxDB 配置更新成功。",
    influxSettingsError: "更新 InfluxDB 配置失败。",
    k8sSettingsError: "保存集群配置失败。",
    k8sLoadError: "加载 Kubernetes 集群失败。",
    deleteClusterTitle: "删除 Kubernetes 集群",
    deleteClusterConfirmPrefix: "您确定要删除 K8S 集群",
    deleteClusterConfirmSuffix: "吗？",
    deleteClusterWarning: "此操作无法撤销。这将永久删除集群连接并从您的仪表板设置中移除。",
    deleteClusterTypePrompt: "请输入集群名称以进行确认：",
    deleteTemplateTitle: "删除模板",
    deleteTemplateConfirm: "您确定要删除模板 \"{name}\" 吗？",
    deleteUserTitle: "删除用户",
    deleteUserConfirm: "您确定要删除用户 \"{name}\" 吗？",
    cannotDeleteAdmin: "无法删除主管理员账户。",
    apiTokens: "API 令牌",
    generateToken: "生成令牌",
    tokenName: "令牌名称",
    expiry: "有效期",
    role: "角色",
    create: "生成",
    never: "永不过期",
    days7: "7 天",
    days30: "30 天",
    days90: "90 天",
    createdAt: "创建于",
    expiresAt: "过期时间",
    tokenCopied: "令牌已复制到剪贴板！",
    copy: "复制",
    tokenNotice: "请立即保存此令牌！它将不再显示。",
    deleteTokenTitle: "删除 API 令牌",
    deleteTokenConfirm: "确定要删除 API 令牌 \"{name}\" 吗？",
    colorPalette: "色彩调色板",
    paletteDefault: "紫与粉 (默认)",
    paletteOceanBlue: "海洋之蓝 (Ocean Blue Serenity)",
    paletteGradientBlues: "渐变之蓝 (Gradient Blues)",
    paletteBlueSerenity: "宁静之蓝 (Blue Serenity)",
    paletteGoldenHarvest: "金色麦浪 (Golden Harvest)",
    paletteNeonEmerald: "霓虹祖母绿与薄荷 (Neon Emerald & Mint)",
    paletteSunsetGlow: "落日余晖金与橙 (Sunset Gold & Orange)",
    paletteCyberNeon: "赛博紫与霓虹粉 (Cyber Purple & Neon Pink)",
    paletteRoyalVibrant: "皇家蓝与青色 (Royal Blue & Cyan)",
    resetColors: "重置为默认调色板",
    addCustomPalette: "+ 添加自定义调色板",
    customPaletteTitle: "添加自定义调色板",
    editCustomPalette: "编辑自定义调色板",
    paletteName: "调色板名称",
    primaryColor: "主色",
    primaryHover: "主色悬停",
    primaryLight: "主色浅色",
    primaryLightest: "主色最浅色",
    primaryDark: "主色深色",
    accentColor: "强调色",
    accentHover: "强调色悬停",
    accentLight: "强调色浅色",
    accentLightest: "强调色最浅色",
    accentDark: "强调色深色",
    backgroundDark: "深色背景颜色",
    backgroundLight: "浅色背景颜色",
    createPalette: "创建调色板",
    deletePaletteTitle: "删除自定义调色板",
    deletePaletteConfirm: "确定要删除自定义调色板 \"{name}\" 吗？",
    ...supplementalStrings.zh,
  },
  es: {
    dashboard: "Tablero",
    reports: "Informes",
    k8sClusters: "Clústeres K8s",
    crdControl: "K6s TestRun CRDs",
    influxdb: "Análisis InfluxDB",
    schedules: "CronJob / Job",
    settings: "Ajustes",
    logout: "Cerrar sesión",
    connected: "Conectado",
    activeAgent: "Agente K8s activo",
    secureSession: "Sesión segura TLS 1.3",
    syncTime: "Última sincronización",
    addCluster: "Añadir clúster",
    welcome: "Bienvenido a K6 Stratos",
    subWelcome: "Portal de observabilidad de Kubernetes y rendimiento",
    username: "Nombre de usuario",
    password: "Contraseña",
    login: "Iniciar sesión",
    ssoLogin: "Iniciar sesión con SSO",
    localLogin: "Inicio de sesión local",
    ssoLoginTab: "Autenticación SSO",
    defaultAccount: "Credenciales de administrador por defecto",
    verifyConn: "Verificar conexión",
    status: "Estado",
    save: "Guardar",
    cancel: "Cancelar",
    clusterName: "Nombre del clúster",
    apiServerUrl: "URL del servidor de API",
    authType: "Tipo de autenticación",
    caCert: "Certificado CA (Opcional, Base64)",
    crdDetails: "Detalles del CRD",
    specObject: "Objeto Kubernetes Spec",
    limits: "Límites de recursos (Runner)",
    newTest: "Nueva prueba",
    runs: "Ejecuciones en InfluxDB",
    telemetry: "Telemetría",
    maxVal: "Valor máximo",
    avgVal: "Valor promedio",
    minVal: "Valor mínimo",
    settingsTitle: "Ajustes de la plataforma",
    settingsSub: "Defina clústeres Kubernetes y credenciales de telemetría InfluxDB.",
    awsEksDiscovery: "Auto-descubrimiento de EKS",
    awsEksDiscoveryDesc: "Descubra clústeres EKS automáticamente usando assume role de IAM en múltiples cuentas y regiones.",
    awsEksDiscoveryConfigured: "Auto-descubrimiento configurado a través del entorno.",
    awsEksDiscoveryNotConfigured: "El auto-descubrimiento no está configurado. Defina AWS_ACCOUNTS_DISCOVERY en el entorno del backend.",
    scanEKS: "Escanear cuentas de AWS",
    syncSelected: "Sincronizar clústeres EKS seleccionados",
    discoveredClusters: "Clústeres descubiertos",
    influxConfigTitle: "Conexión a base de datos InfluxDB",
    influxConfigSub: "Configure los parámetros utilizados para consultar las ejecuciones de rendimiento.",
    url: "URL",
    token: "Token",
    org: "Organización",
    bucket: "Bucket",
    accessForbidden: "Acceso prohibido",
    adminRequired: "Se requieren privilegios de administrador para ver esta página.",
    theme: "Tema",
    lang: "Idioma",
    testConn: "Probar conexión",
    runners: "Ejecutores (Runners)",
    stage: "Etapa",
    createdOn: "Creado el",
    details: "Detalles",
    crdList: "Recursos k6s.k6.io",
    noResources: "No hay recursos K6 personalizados en este espacio de nombres.",
    selectRes: "Seleccione un recurso para mostrar sus detalles.",
    instantiateK6: "Instanciar prueba K6",
    launchSpecDesc: "Cree un recurso personalizado `K6` que despliegue la arquitectura de prueba en el clúster.",
    runName: "Nombre de ejecución",
    parallelism: "Paralelismo (Runners)",
    scriptConfigMap: "ConfigMap de script",
    jsFile: "Archivo JS",
    cpuLimit: "Límite de CPU",
    memLimit: "Límite de RAM",
    scheduleTest: "Programar esta prueba",
    cronExpression: "Expresión Cron",
    cronExample: "Ejemplo: */5 * * * *",
    cronRequired: "Se requiere una expresión Cron para programar una prueba.",
    cronInvalid: "La expresión Cron debe tener exactamente 5 campos.",
    scheduleRequiresScript: "Seleccione una plantilla o use un script manual para programar.",
    scheduleCreated: "¡Programación creada correctamente!",
    scriptSource: "Método de configuración del script",
    manualScript: "Escribir script manualmente",
    existingScript: "Usar ConfigMap existente",
    selectConfigMap: "Seleccionar ConfigMap de script",
    newConfigMap: "Nuevo ConfigMap",
    configMapName: "Nombre del ConfigMap",
    jsFileName: "Nombre del archivo JS",
    cmContent: "Script JS inicial",
    creatingConfigMap: "Creando...",
    duplicateFrom: "Duplicar desde existente (Opcional)",
    deploying: "Desplegando...",
    deploy: "Desplegar",
    clustersK8s: "Clústeres K8s",
    inspectClusters: "Verifique la conectividad del servidor de API K8s, la salud de los pods de infraestructura y las configuraciones de seguridad.",
    k8sVersion: "Versión de Kubernetes",
    awsRegion: "Región AWS",
    authMech: "Mecanismo de autenticación",
    registeredOn: "Registrado el",
    active: "Activo",
    checking: "Comprobando...",
    fail: "Fallo",
    securityCheck: "Controles y estado de seguridad",
    aesActive: "Cifrado AES-256-GCM activo en reposo",
    tlsChecked: "Certificado CA de Kubernetes verificado",
    rbacLimit: "Acceso RBAC restringido al espacio de nombres de la prueba",
    totalClusters: "Clústeres K8s totales",
    k6SuccessRate: "Tasa de éxito de K6",
    activeTests: "Pruebas activas",
    influxTelemetries: "Telemetrías InfluxDB",
    recentRuns: "Ejecuciones de rendimiento recientes",
    addClusterDesc: "Registre la configuración del clúster. Las credenciales sensibles se cifran mediante AES-256-GCM.",
    caCertDesc: "Certificado CA (Opcional, Base64)",
    secretToken: "Token de acceso (Bearer)",
    kubeconfigYaml: "Kubeconfig (Contenido YAML)",
    validating: "Validando...",
    submit: "Enviar",
    defaultMockCluster: "Entorno simulado",
    registeredK8sClusters: "Sus clústeres K8s",
    operatorStatus: "Estado del operador",
    recommendations: "Ayuda y recomendaciones",
    recDesc: "Use el menú K6s TestRun CRDs para programar y monitorear las ejecuciones de carga. Las métricas de rendimiento consolidadas se envían automáticamente a InfluxDB y se pueden ver en el panel de análisis de InfluxDB.",
    metricsTitle: "Análisis InfluxDB",
    metricsSub: "Visualice las ejecuciones históricas y realice un seguimiento de las tasas de solicitudes HTTP y el recuento de usuarios.",
    metricRateToggle: "Latencia (http_req_duration)",
    metricVUsToggle: "Usuarios activos (vus)",
    metricErrorToggle: "Tasa de errores (http_req_failed)",
    valMax: "Valor máximo",
    valAvg: "Promedio",
    valMin: "Valor mínimo",
    chartLoading: "Cargando telemetría...",
    chartNoData: "No se encontraron registros de telemetría.",
    chartSelectRun: "Seleccione una ejecución de prueba para cargar las curvas de rendimiento.",
    savedClusters: "Clústeres conectados",
    operational: "Operativo",
    testRunLabel: "Ejecución de prueba",
    influxSettingsSuccess: "Configuración de InfluxDB actualizada correctamente.",
    influxSettingsError: "Error al actualizar la configuración de InfluxDB.",
    k8sSettingsError: "Error al guardar la configuración del clúster.",
    k8sLoadError: "Error al cargar los clústeres de Kubernetes.",
    deleteClusterTitle: "Eliminar clúster de Kubernetes",
    deleteClusterConfirmPrefix: "¿Está seguro de que desea eliminar el clúster K8s",
    deleteClusterConfirmSuffix: "?",
    deleteClusterWarning: "Esta acción no se puede deshacer. Esto eliminará permanentemente la conexión del clúster y la eliminará de los ajustes de su panel.",
    deleteClusterTypePrompt: "Escriba el nombre del clúster para confirmar:",
    deleteTemplateTitle: "Eliminar plantilla",
    deleteTemplateConfirm: "¿Está seguro de que desea eliminar la plantilla \"{name}\"?",
    deleteUserTitle: "Eliminar usuario",
    deleteUserConfirm: "¿Está seguro de que desea eliminar al usuario \"{name}\"?",
    cannotDeleteAdmin: "No se puede eliminar la cuenta de administrador principal.",
    apiTokens: "Tokens de API",
    generateToken: "Generar token",
    tokenName: "Nombre del token",
    expiry: "Vencimiento",
    role: "Rol",
    create: "Crear",
    never: "Nunca",
    days7: "7 días",
    days30: "30 días",
    days90: "90 días",
    createdAt: "Creado el",
    expiresAt: "Vence el",
    tokenCopied: "¡Token copiado al portapapeles!",
    copy: "Copiar",
    tokenNotice: "¡Guarde este token ahora! No se mostrará de nuevo.",
    deleteTokenTitle: "Eliminar token de API",
    deleteTokenConfirm: "¿Está seguro de que desea eliminar el token de API \"{name}\"?",
    colorPalette: "Paleta de colores",
    paletteDefault: "Morado y rosa (Predeterminado)",
    paletteOceanBlue: "Azul océano (Ocean Blue Serenity)",
    paletteGradientBlues: "Azules degradados (Gradient Blues)",
    paletteBlueSerenity: "Serenidad azul (Blue Serenity)",
    paletteGoldenHarvest: "Cosecha dorada (Golden Harvest)",
    paletteNeonEmerald: "Esmeralda neón y menta",
    paletteSunsetGlow: "Oro atardecer y naranja",
    paletteCyberNeon: "Púrpura cyber y rosa neón",
    paletteRoyalVibrant: "Azul real y cian",
    resetColors: "Restablecer paletas por defecto",
    addCustomPalette: "+ Añadir paleta personalizada",
    customPaletteTitle: "Añadir paleta personalizada",
    editCustomPalette: "Editar paleta personalizada",
    paletteName: "Nombre de la paleta",
    primaryColor: "Color primario",
    primaryHover: "Primario al pasar el cursor",
    primaryLight: "Primario claro",
    primaryLightest: "Primario muy claro",
    primaryDark: "Primario oscuro",
    accentColor: "Color de acento",
    accentHover: "Acento al pasar el cursor",
    accentLight: "Acento claro",
    accentLightest: "Acento muy claro",
    accentDark: "Acento oscuro",
    backgroundDark: "Color de fondo oscuro",
    backgroundLight: "Color de fondo claro",
    createPalette: "Crear paleta",
    deletePaletteTitle: "Eliminar paleta personalizada",
    deletePaletteConfirm: "¿Está seguro de que desea eliminar la paleta personalizada \"{name}\"?",
    ...supplementalStrings.es,
  },
  de: {
    dashboard: "Dashboard",
    reports: "Berichte",
    k8sClusters: "K8s-Cluster",
    crdControl: "K6s TestRun CRDs",
    influxdb: "InfluxDB-Analysen",
    schedules: "CronJob / Job",
    settings: "Einstellungen",
    logout: "Abmelden",
    connected: "Verbunden",
    activeAgent: "K8s-Agent aktiv",
    secureSession: "Sichere TLS 1.3 Sitzung",
    syncTime: "Letzte Synchronisierung",
    addCluster: "Cluster hinzufügen",
    welcome: "Willkommen bei K6 Stratos",
    subWelcome: "Kubernetes- und Performance-Beobachtungsportal",
    username: "Benutzername",
    password: "Passwort",
    login: "Anmelden",
    ssoLogin: "Mit SSO anmelden",
    localLogin: "Lokale Anmeldung",
    ssoLoginTab: "SSO-Authentifizierung",
    defaultAccount: "Standard-Admin-Anmeldedaten",
    verifyConn: "Verbindung überprüfen",
    status: "Speichern",
    save: "Speichern",
    cancel: "Abbrechen",
    clusterName: "Clustername",
    apiServerUrl: "API-Server-URL",
    authType: "Authentifizierungstyp",
    caCert: "CA-Zertifikat (Optional, Base64)",
    crdDetails: "CRD-Details",
    specObject: "Kubernetes-Spec-Objekt",
    limits: "Ressourcenlimits (Runner)",
    newTest: "Neuer Test",
    runs: "Läufe in InfluxDB",
    telemetry: "Telemetrie",
    maxVal: "Maximaler Wert",
    avgVal: "Durchschnittlicher Wert",
    minVal: "Minimaler Wert",
    settingsTitle: "Plattform-Einstellungen",
    settingsSub: "Definieren Sie Kubernetes-Cluster und InfluxDB-Telemetrie-Anmeldedaten.",
    awsEksDiscovery: "EKS Auto-Discovery",
    awsEksDiscoveryDesc: "Entdecken Sie EKS-Cluster automatisch mithilfe von IAM AssumeRole über mehrere Konten und Regionen hinweg.",
    awsEksDiscoveryConfigured: "Auto-Discovery über Umgebung konfiguriert.",
    awsEksDiscoveryNotConfigured: "Auto-Discovery ist nicht konfiguriert. Definieren Sie AWS_ACCOUNTS_DISCOVERY in der Backend-Umgebung.",
    scanEKS: "AWS-Konten scannen",
    syncSelected: "Ausgewählte EKS-Cluster synchronisieren",
    discoveredClusters: "Entdeckte Cluster",
    influxConfigTitle: "InfluxDB-Datenbankverbindung",
    influxConfigSub: "Konfigurieren Sie Parameter, die zum Abfragen von Leistungsläufen verwendet werden.",
    url: "URL",
    token: "Token",
    org: "Organisation",
    bucket: "Bucket",
    accessForbidden: "Zugriff verboten",
    adminRequired: "Administratorrechte sind erforderlich, um diese Seite anzuzeigen.",
    theme: "Design",
    lang: "Sprache",
    testConn: "Verbindung testen",
    runners: "Runner",
    stage: "Stufe",
    createdOn: "Erstellt am",
    details: "Details",
    crdList: "k6s.k6.io-Ressourcen",
    noResources: "Keine benutzerdefinierten K6-Ressourcen in diesem Namespace vorhanden.",
    selectRes: "Wählen Sie eine Ressource aus, um deren Details anzuzeigen.",
    instantiateK6: "K6-Test instanziieren",
    launchSpecDesc: "Erstellen Sie eine benutzerdefinierte Ressource `K6`, die die Testarchitektur auf dem Cluster bereitstellt.",
    runName: "Laufname",
    parallelism: "Parallelität (Runner)",
    scriptConfigMap: "Skript-ConfigMap",
    jsFile: "JS-Datei",
    cpuLimit: "CPU-Limit",
    memLimit: "RAM-Limit",
    scheduleTest: "Diesen Test planen",
    cronExpression: "Cron-Ausdruck",
    cronExample: "Beispiel: */5 * * * *",
    cronRequired: "Ein Cron-Ausdruck ist erforderlich, um einen Test zu planen.",
    cronInvalid: "Der Cron-Ausdruck muss genau 5 Felder enthalten.",
    scheduleRequiresScript: "Wählen Sie eine Vorlage oder verwenden Sie ein manuelles Skript zum Planen.",
    scheduleCreated: "Zeitplan erfolgreich erstellt!",
    scriptSource: "Skriptkonfigurationsmethode",
    manualScript: "Skript manuell schreiben",
    existingScript: "Vorhandene ConfigMap verwenden",
    selectConfigMap: "Skript-ConfigMap auswählen",
    newConfigMap: "Neue ConfigMap",
    configMapName: "ConfigMap-Name",
    jsFileName: "JS-Dateiname",
    cmContent: "Initiales JS-Skript",
    creatingConfigMap: "Wird erstellt...",
    duplicateFrom: "Von vorhandenem duplizieren (Optional)",
    deploying: "Wird bereitgestellt...",
    deploy: "Bereitstellen",
    clustersK8s: "K8s-Cluster",
    inspectClusters: "Überprüfen Sie die Konnektivität des K8s-API-Servers, den Zustand der Infrastruktur-Pods und die Sicherheitskonfigurationen.",
    k8sVersion: "Kubernetes-Version",
    awsRegion: "AWS-Region",
    authMech: "Authentifizierungsmechanismus",
    registeredOn: "Registriert am",
    active: "Aktiv",
    checking: "Wird überprüft...",
    fail: "Fehlgeschlagen",
    securityCheck: "Sicherheitskontrollen und Status",
    aesActive: "AES-256-GCM-Verschlüsselung im Ruhezustand aktiv",
    tlsChecked: "Kubernetes-CA-Zertifikat verifiziert",
    rbacLimit: "RBAC-Zugriff auf Test-Namespace beschränkt",
    totalClusters: "K8s-Cluster insgesamt",
    k6SuccessRate: "K6-Erfolgsquote",
    activeTests: "Aktive Tests",
    influxTelemetries: "InfluxDB-Telemetrien",
    recentRuns: "Jüngste Leistungsläufe",
    addClusterDesc: "Registrieren Sie die Clusterkonfiguration. Sensible Anmeldedaten werden mit AES-256-GCM verschlüsselt.",
    caCertDesc: "CA-Zertifikat (Optional, Base64)",
    secretToken: "Zugriffstoken (Bearer)",
    kubeconfigYaml: "Kubeconfig (YAML-Inhalt)",
    validating: "Validierung...",
    submit: "Absenden",
    defaultMockCluster: "Mock-Umgebung",
    registeredK8sClusters: "Ihre K8s-Cluster",
    operatorStatus: "Operator-Status",
    recommendations: "Hilfe & Empfehlungen",
    recDesc: "Verwenden Sie das K6s TestRun CRDs-Menü, um Lastläufe zu planen und zu überwachen. Konsolidierte Leistungsmetriken werden automatisch an InfluxDB übertragen und können im InfluxDB-Analyse-Panel angezeigt werden.",
    metricsTitle: "InfluxDB-Analysen",
    metricsSub: "Visualisieren Sie historische Läufe und verfolgen Sie HTTP-Anforderungsraten und Benutzerzahlen.",
    metricRateToggle: "Latenz (http_req_duration)",
    metricVUsToggle: "Aktive Benutzer (vus)",
    metricErrorToggle: "Fehlerrate (http_req_failed)",
    valMax: "Maximaler Wert",
    valAvg: "Mittelwert",
    valMin: "Minimaler Wert",
    chartLoading: "Telemetrie wird geladen...",
    chartNoData: "Keine Telemetriedaten gefunden.",
    chartSelectRun: "Wählen Sie einen Testlauf aus, um die Leistungskurven zu laden.",
    savedClusters: "Verbundene Cluster",
    operational: "Betriebsbereit",
    testRunLabel: "Testlauf",
    influxSettingsSuccess: "InfluxDB-Konfiguration erfolgreich aktualisiert.",
    influxSettingsError: "Fehler beim Aktualisieren der InfluxDB-Konfiguration.",
    k8sSettingsError: "Fehler beim Speichern der Clusterkonfiguration.",
    k8sLoadError: "Fehler beim Laden der Kubernetes-Cluster.",
    deleteClusterTitle: "Kubernetes-Cluster löschen",
    deleteClusterConfirmPrefix: "Sind Sie sicher, dass Sie den K8S-Cluster löschen möchten",
    deleteClusterConfirmSuffix: "?",
    deleteClusterWarning: "Diese Aktion kann nicht rückgängig gemacht werden. Dadurch wird die Clusterverbindung dauerhaft gelöscht und aus Ihren Dashboard-Einstellungen entfernt.",
    deleteClusterTypePrompt: "Bitte geben Sie den Clusternamen zur Bestätigung ein:",
    deleteTemplateTitle: "Vorlage löschen",
    deleteTemplateConfirm: "Sind Sie sicher, dass Sie die Vorlage \"{name}\" löschen möchten?",
    deleteUserTitle: "Benutzer löschen",
    deleteUserConfirm: "Sind Sie sicher, dass Sie den Benutzer \"{name}\" löschen möchten?",
    cannotDeleteAdmin: "Das Haupt-Admin-Konto kann nicht gelöscht werden.",
    apiTokens: "API-Token",
    generateToken: "Token generieren",
    tokenName: "Token-Name",
    expiry: "Ablauf",
    role: "Rolle",
    create: "Erstellen",
    never: "Nie",
    days7: "7 Tage",
    days30: "30 Tage",
    days90: "90 Tage",
    createdAt: "Erstellt am",
    expiresAt: "Läuft ab am",
    tokenCopied: "Token in die Zwischenablage kopiert!",
    copy: "Kopieren",
    tokenNotice: "Speichern Sie dieses Token jetzt! Es wird nicht wieder angezeigt.",
    deleteTokenTitle: "API-Token löschen",
    deleteTokenConfirm: "Sind Sie sicher, dass Sie das API-Token \"{name}\" löschen möchten?",
    colorPalette: "Farbpalette",
    paletteDefault: "Lila & Pink (Standard)",
    paletteOceanBlue: "Ozeanblau-Gelassenheit",
    paletteGradientBlues: "Farbverlauf Blautöne",
    paletteBlueSerenity: "Blaue Gelassenheit",
    paletteGoldenHarvest: "Goldene Ernte",
    paletteNeonEmerald: "Neon-Smaragd & Minze",
    paletteSunsetGlow: "Sonnenuntergangsgold & Orange",
    paletteCyberNeon: "Cyber-Violett & Neon-Pink",
    paletteRoyalVibrant: "Königsblau & Cyan",
    resetColors: "Auf Standardpaletten zurücksetzen",
    addCustomPalette: "+ Benutzerdefinierte Palette hinzufügen",
    customPaletteTitle: "Benutzerdefinierte Palette hinzufügen",
    editCustomPalette: "Benutzerdefinierte Palette bearbeiten",
    paletteName: "Palettenname",
    primaryColor: "Primärfarbe",
    primaryHover: "Primärfarbe Hover",
    primaryLight: "Primärfarbe hell",
    primaryLightest: "Primärfarbe sehr hell",
    primaryDark: "Primärfarbe dunkel",
    accentColor: "Akzentfarbe",
    accentHover: "Akzentfarbe Hover",
    accentLight: "Akzentfarbe hell",
    accentLightest: "Akzentfarbe sehr hell",
    accentDark: "Akzentfarbe dunkel",
    backgroundDark: "Dunkle Hintergrundfarbe",
    backgroundLight: "Helle Hintergrundfarbe",
    createPalette: "Palette erstellen",
    deletePaletteTitle: "Benutzerdefinierte Palette löschen",
    deletePaletteConfirm: "Sind Sie sicher, dass Sie die benutzerdefinierte Palette \"{name}\" löschen möchten?",
    ...supplementalStrings.de,
  },
};
export const defaultPalettes: CustomPalette[] = [
  {
    id: 'royal-vibrant',
    name: 'paletteRoyalVibrant',
    colors: {
      primary: '#3b82f6',
      primaryHover: '#2563eb',
      primaryLight: '#60a5fa',
      primaryLightest: '#0c0d0d',
      primaryDark: '#1e3a8a',
      accent: '#06b6d4',
      accentHover: '#0891b2',
      accentLight: '#22d3ee',
      accentLightest: '#cffafe',
      accentDark: '#0e7490',
      backgroundDark: '#0e1a3f',
      backgroundLight: '#e5ecf5'
    }
  },
  {
    id: 'golden-harvest',
    name: 'paletteGoldenHarvest',
    colors: {
      primary: '#edc531',
      primaryHover: '#a47e1b',
      primaryLight: '#ffe169',
      primaryLightest: '#fbf6cf',
      primaryDark: '#5d4508',
      accent: '#ffe169',
      accentHover: '#edc531',
      accentLight: '#fbf6cf',
      accentLightest: '#fffae0',
      accentDark: '#7a5a0c',
      backgroundDark: '#090d16',
      backgroundLight: '#f1f5f9'
    }
  },
  {
    id: 'cyber-neon',
    name: 'paletteCyberNeon',
    colors: {
      primary: '#c084fc',
      primaryHover: '#a855f7',
      primaryLight: '#e9d5ff',
      primaryLightest: '#f3e8ff',
      primaryDark: '#6b21a8',
      accent: '#f472b6',
      accentHover: '#ec4899',
      accentLight: '#fbcfe8',
      accentLightest: '#fdf2f8',
      accentDark: '#9d174d',
      backgroundDark: '#0a0515',
      backgroundLight: '#faf5ff'
    }
  },
  {
    id: 'gradient-blues',
    name: 'paletteGradientBlues',
    colors: {
      primary: '#0a9396',
      primaryHover: '#005f73',
      primaryLight: '#94d2bd',
      primaryLightest: '#cae9e0',
      primaryDark: '#003d4c',
      accent: '#94d2bd',
      accentHover: '#0a9396',
      accentLight: '#cae9e0',
      accentLightest: '#e9d8a6',
      accentDark: '#005f73',
      backgroundDark: '#090d16',
      backgroundLight: '#f1f5f9'
    }
  }
];

const allowedPaletteSet = new Set<string>(ALLOWED_PALETTE_IDS);

export function isBuiltinPaletteId(id: string): boolean {
  return allowedPaletteSet.has(id);
}

function loadCustomPalettes(): CustomPalette[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem('pref-custom-palettes');
    if (!saved) return [];
    const parsed = JSON.parse(saved) as CustomPalette[];
    return parsed.filter((p) => p.id && !isBuiltinPaletteId(p.id));
  } catch {
    return [];
  }
}

function mergePalettes(customPalettes: CustomPalette[]): CustomPalette[] {
  return [...defaultPalettes, ...customPalettes.filter((p) => !isBuiltinPaletteId(p.id))];
}

function resolvePalette(saved: string | null, serverDefault: string, knownIds: Set<string>): ColorPalette {
  if (saved && knownIds.has(saved)) {
    return saved;
  }
  if (knownIds.has(serverDefault)) {
    return serverDefault;
  }
  if (allowedPaletteSet.has(serverDefault)) {
    return serverDefault;
  }
  return FALLBACK_PALETTE_ID;
}

function resolveLanguage(saved: string | null, serverDefault: string): Language {
  if (saved && allowedLanguageSet.has(saved)) {
    return saved as Language;
  }
  if (allowedLanguageSet.has(serverDefault)) {
    return serverDefault as Language;
  }
  return FALLBACK_LANGUAGE;
}

function resolveTheme(saved: string | null, serverDefault: string): Theme {
  if (saved && allowedThemeSet.has(saved)) {
    return saved as Theme;
  }
  if (allowedThemeSet.has(serverDefault)) {
    return serverDefault as Theme;
  }
  return FALLBACK_THEME;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(FALLBACK_LANGUAGE);
  const [theme, setThemeState] = useState<Theme>(FALLBACK_THEME);
  const [colorPalette, setColorPaletteState] = useState<ColorPalette>(FALLBACK_PALETTE_ID);
  const [palettes, setPalettes] = useState<CustomPalette[]>(defaultPalettes);

  // Load from local storage and server default palette
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedLang = localStorage.getItem('pref-lang');
    const savedTheme = localStorage.getItem('pref-theme');
    const savedPalette = localStorage.getItem('pref-palette');
    const customPalettes = loadCustomPalettes();
    const mergedPalettes = mergePalettes(customPalettes);
    const knownPaletteIds = new Set(mergedPalettes.map((p) => p.id));
    setPalettes(mergedPalettes);
    if (customPalettes.length > 0) {
      localStorage.setItem('pref-custom-palettes', JSON.stringify(customPalettes));
    }

    const applyAppearanceDefaults = (settings: {
      default_color_palette: string;
      default_language: string;
      default_theme: string;
    }) => {
      const resolvedLang = resolveLanguage(savedLang, settings.default_language);
      const resolvedTheme = resolveTheme(savedTheme, settings.default_theme);
      const resolvedPalette = resolvePalette(savedPalette, settings.default_color_palette, knownPaletteIds);

      setLangState(resolvedLang);
      setThemeState(resolvedTheme);
      setColorPaletteState(resolvedPalette);

      if (!savedLang || !allowedLanguageSet.has(savedLang)) {
        localStorage.setItem('pref-lang', resolvedLang);
      }
      if (!savedTheme || !allowedThemeSet.has(savedTheme)) {
        localStorage.setItem('pref-theme', resolvedTheme);
      }
      if (!savedPalette || !knownPaletteIds.has(savedPalette)) {
        localStorage.setItem('pref-palette', resolvedPalette);
      }
    };

    api.getAppearanceSettings()
      .then((settings) => applyAppearanceDefaults(settings))
      .catch(() => applyAppearanceDefaults({
        default_color_palette: FALLBACK_PALETTE_ID,
        default_language: FALLBACK_LANGUAGE,
        default_theme: FALLBACK_THEME,
      }));
  }, []);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('pref-lang', newLang);
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('pref-theme', newTheme);
  };

  const setColorPalette = (newPalette: ColorPalette) => {
    setColorPaletteState(newPalette);
    localStorage.setItem('pref-palette', newPalette);
  };

  const persistCustomPalettes = (customOnly: CustomPalette[]) => {
    localStorage.setItem('pref-custom-palettes', JSON.stringify(customOnly));
    setPalettes(mergePalettes(customOnly));
  };

  const addCustomPalette = (palette: CustomPalette) => {
    const customOnly = palettes
      .filter((p) => !isBuiltinPaletteId(p.id))
      .filter((p) => p.id !== palette.id);
    customOnly.push(palette);
    persistCustomPalettes(customOnly);
  };

  const deleteCustomPalette = (id: string) => {
    if (isBuiltinPaletteId(id)) return;
    const customOnly = palettes.filter((p) => !isBuiltinPaletteId(p.id) && p.id !== id);
    persistCustomPalettes(customOnly);
    if (colorPalette === id) {
      const nextPalette = defaultPalettes[0]?.id || FALLBACK_PALETTE_ID;
      setColorPalette(nextPalette);
    }
  };

  const resetToDefaultPalettes = () => {
    persistCustomPalettes([]);
    setColorPalette(FALLBACK_PALETTE_ID);
  };

  const isBuiltinPalette = (id: string) => isBuiltinPaletteId(id);

  // Sync theme with document element attribute
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.setAttribute('data-theme', 'system');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  // Sync color palette with document element attribute & inject dynamic colors if custom
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-palette', colorPalette);

    const updateColors = () => {
      let activeTheme = theme;
      if (theme === 'system') {
        activeTheme = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }

      root.setAttribute('data-color-scheme', activeTheme);
      const palette = palettes.find((p) => p.id === colorPalette);
      if (palette) {
        root.style.setProperty('--primary-dark', palette.colors.primaryDark, 'important');
        root.style.setProperty('--primary-hover', palette.colors.primaryHover, 'important');
        root.style.setProperty('--primary', palette.colors.primary, 'important');
        root.style.setProperty('--primary-light', palette.colors.primaryLight, 'important');
        root.style.setProperty('--primary-lightest', palette.colors.primaryLightest, 'important');
        root.style.setProperty('--accent-dark', palette.colors.accentDark, 'important');
        root.style.setProperty('--accent-hover', palette.colors.accentHover, 'important');
        root.style.setProperty('--accent', palette.colors.accent, 'important');
        root.style.setProperty('--accent-light', palette.colors.accentLight, 'important');
        root.style.setProperty('--accent-lightest', palette.colors.accentLightest, 'important');
        
        const contrastVariables = paletteContrastVariables(palette.colors);
        for (const [key, value] of Object.entries(contrastVariables)) root.style.setProperty(key, value);
        const bg = contrastVariables[`--ui-background-${activeTheme}`];
        if (bg) {
          root.style.setProperty('--color-slate-950', bg, 'important');
        }
      } else {
        for (const key of ['--ui-background-light', '--ui-background-dark', '--ui-primary-fill', '--ui-accent-fill', '--ui-primary-text-light', '--ui-primary-text-dark', '--ui-accent-text-light', '--ui-accent-text-dark']) root.style.removeProperty(key);
        // Clear custom properties
        root.style.removeProperty('--primary-dark');
        root.style.removeProperty('--primary-hover');
        root.style.removeProperty('--primary');
        root.style.removeProperty('--primary-light');
        root.style.removeProperty('--primary-lightest');
        root.style.removeProperty('--accent-dark');
        root.style.removeProperty('--accent-hover');
        root.style.removeProperty('--accent');
        root.style.removeProperty('--accent-light');
        root.style.removeProperty('--accent-lightest');
        root.style.removeProperty('--color-slate-950');
      }
    };

    updateColors();

    if (theme === 'system' && typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => updateColors();
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [colorPalette, palettes, theme]);

  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = translations[lang] || translations['en'];
    let text = (dict as Record<string, string>)[key] || key;
    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
      });
    }
    return text;
  };

  return (
    <PreferencesContext.Provider
      value={{
        lang,
        theme,
        colorPalette,
        setLang,
        setTheme,
        setColorPalette,
        palettes,
        addCustomPalette,
        deleteCustomPalette,
        resetToDefaultPalettes,
        isBuiltinPalette,
        t,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}
