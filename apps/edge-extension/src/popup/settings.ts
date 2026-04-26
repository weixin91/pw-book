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

export function generatePassword(settings: PasswordGeneratorSettings): string {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "23456789";
  const numbersAll = "0123456789";
  const special = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const ambiguous = "0O1lI";

  let resultChars: string[] = [];

  if (settings.includeNumbers && settings.minNumbers > 0) {
    const numPool = settings.excludeAmbiguous ? numbers : numbersAll;
    for (let i = 0; i < settings.minNumbers; i++) {
      resultChars.push(numPool[randomIndex(numPool.length)]);
    }
  }

  if (settings.includeSpecial && settings.minSpecial > 0) {
    for (let i = 0; i < settings.minSpecial; i++) {
      resultChars.push(special[randomIndex(special.length)]);
    }
  }

  let charset = "";
  if (settings.includeLowercase) charset += lowercase;
  if (settings.includeUppercase) charset += uppercase;
  if (settings.includeNumbers) charset += settings.excludeAmbiguous ? numbers : numbersAll;
  if (settings.includeSpecial) charset += special;

  if (settings.excludeAmbiguous) {
    for (const ch of ambiguous) {
      charset = charset.replaceAll(ch, "");
    }
  }

  if (charset.length === 0) return "";

  const remaining = Math.max(0, settings.length - resultChars.length);
  for (let i = 0; i < remaining; i++) {
    resultChars.push(charset[randomIndex(charset.length)]);
  }

  for (let i = resultChars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [resultChars[i], resultChars[j]] = [resultChars[j], resultChars[i]];
  }

  return resultChars.join("");
}

function randomIndex(max: number): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % max;
}
