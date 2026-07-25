import type { AppLanguage } from './language';

const english = {
  'settings.title': 'Settings',
  'settings.eyebrow': 'Workbench preferences',
  'settings.sections': 'Settings sections',
  'settings.tabs.general': 'General',
  'settings.tabs.notifications': 'Notifications',
  'settings.tabs.demo': 'Demo',
  'settings.tabs.about': 'About',
  'settings.general.description': 'Local application defaults',
  'settings.theme.label': 'Theme',
  'settings.theme.description': 'Application appearance',
  'settings.theme.system': 'System',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.language.label': 'Language',
  'settings.language.description': 'Interface language',
  'settings.language.english': 'English',
  'settings.language.chinese': 'Simplified Chinese',
  'settings.startup.label': 'Start on System Startup',
  'settings.startup.description': 'Launch Astra Nexus after signing in',
  'settings.comingSoon': 'Coming soon',
  'settings.directory.label': 'Default Project Directory',
  'settings.directory.description': 'Selected independently when adding each project',
  'settings.directory.value': 'Per-project folder picker',
} as const;

export type TranslationKey = keyof typeof english;
export type TranslationParams = Record<string, string | number>;

const chinese: Record<TranslationKey, string> = {
  'settings.title': '设置',
  'settings.eyebrow': '工作台偏好设置',
  'settings.sections': '设置分区',
  'settings.tabs.general': '通用',
  'settings.tabs.notifications': '通知',
  'settings.tabs.demo': '演示',
  'settings.tabs.about': '关于',
  'settings.general.description': '本地应用默认设置',
  'settings.theme.label': '主题',
  'settings.theme.description': '应用外观',
  'settings.theme.system': '跟随系统',
  'settings.theme.dark': '深色',
  'settings.theme.light': '浅色',
  'settings.language.label': '语言',
  'settings.language.description': '界面语言',
  'settings.language.english': 'English',
  'settings.language.chinese': '简体中文',
  'settings.startup.label': '开机启动',
  'settings.startup.description': '登录系统后启动 Astra Nexus',
  'settings.comingSoon': '即将推出',
  'settings.directory.label': '默认项目目录',
  'settings.directory.description': '添加每个项目时单独选择',
  'settings.directory.value': '按项目选择文件夹',
};

const messages: Record<AppLanguage, Record<TranslationKey, string>> = {
  en: english,
  'zh-CN': chinese,
};

export function translate(
  language: AppLanguage,
  key: TranslationKey,
  params: TranslationParams = {},
): string {
  return Object.entries(params).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    messages[language][key],
  );
}
