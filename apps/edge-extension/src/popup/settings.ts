// 密码生成器设置持久化
// 使用 chrome.storage.local 存储用户偏好

const SETTINGS_KEY = "passwordGeneratorSettings";

export interface PasswordGeneratorSettings {
  length: number;
  includeUppercase: boolean;
  includeLowercase: boolean;
  includeNumbers: boolean;
  includeSpecial: boolean;
  excludeAmbiguous: boolean;
  minNumbers: number;
  minSpecial: number;
}

const DEFAULTS: PasswordGeneratorSettings = {
  length: 16,
  includeUppercase: true,
  includeLowercase: true,
  includeNumbers: true,
  includeSpecial: true,
  excludeAmbiguous: true,
  minNumbers: 1,
  minSpecial: 1,
};

export const PasswordGeneratorSettingsService = {
  async load(): Promise<PasswordGeneratorSettings> {
    try {
      const result = await chrome.storage.local.get(SETTINGS_KEY);
      const saved = result[SETTINGS_KEY] as PasswordGeneratorSettings | undefined;
      return { ...DEFAULTS, ...saved };
    } catch {
      return { ...DEFAULTS };
    }
  },

  async save(settings: PasswordGeneratorSettings): Promise<void> {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  },
};
