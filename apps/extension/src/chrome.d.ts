// Only the pieces of the extension API this project uses. A full typings package would be
// mostly unused surface, and the repository keeps its dependencies deliberately small.
type Listener<T extends unknown[]> = { addListener(fn: (...args: T) => void): void };

declare namespace chrome {
  namespace runtime {
    const lastError: { message?: string } | undefined;
    function sendMessage<T>(message: unknown): Promise<T>;
    const onMessage: {
      addListener(fn: (message: any, sender: { tab?: { id?: number; url?: string } }, respond: (response?: unknown) => void) => boolean | void): void;
    };
  }
  namespace storage {
    type Area = { get(keys: string | string[] | null): Promise<Record<string, any>>; set(items: Record<string, unknown>): Promise<void>; remove(keys: string | string[]): Promise<void> };
    const session: Area;
    const local: Area;
  }
  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
    function setTitle(details: { title: string; tabId?: number }): Promise<void>;
  }
  namespace tabs {
    type Tab = { id?: number; url?: string };
    function query(info: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
  }
  namespace scripting {
    function executeScript(injection: { target: { tabId: number; allFrames?: boolean }; files: string[] }): Promise<unknown>;
    function registerContentScripts(scripts: { id: string; matches: string[]; js: string[]; runAt?: string; persistAcrossSessions?: boolean }[]): Promise<void>;
    function unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
    function getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<{ id: string }[]>;
  }
  namespace permissions {
    function request(permissions: { origins: string[] }): Promise<boolean>;
    function contains(permissions: { origins: string[] }): Promise<boolean>;
    function remove(permissions: { origins: string[] }): Promise<boolean>;
  }
  namespace webNavigation {
    const onHistoryStateUpdated: Listener<[{ tabId: number; url: string; frameId: number }]>;
  }
}
