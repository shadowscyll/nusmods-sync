import { NUSMODS_STORAGE_EVENT, NUSMODS_STORAGE_KEY } from '../shared/constants';

type BridgeWindow = Window & { __nusmodsSyncStorageBridge?: boolean };
const bridgeWindow = window as BridgeWindow;

if (!bridgeWindow.__nusmodsSyncStorageBridge) {
  bridgeWindow.__nusmodsSyncStorageBridge = true;
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key: string, value: string): void {
    originalSetItem.call(this, key, value);
    if (this === window.localStorage && key === NUSMODS_STORAGE_KEY) {
      window.dispatchEvent(new Event(NUSMODS_STORAGE_EVENT));
    }
  };
}
