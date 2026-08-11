type BrowserGlobal = typeof globalThis & {
  browser?: typeof chrome;
  chrome?: typeof chrome;
};

// Tests import pure modules outside an extension context, so resolution is
// intentionally non-throwing until an API member is actually used.
export const webext = ((globalThis as BrowserGlobal).browser ??
  (globalThis as BrowserGlobal).chrome) as typeof chrome;
