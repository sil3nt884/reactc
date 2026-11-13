// The native page driver reserves stdout for JSON protocol messages.
function diagnostic(...args) {
  globalThis.console.error(...args);
}

const nativeConsole = {
  log: diagnostic,
  info: diagnostic,
  debug: diagnostic,
  warn: diagnostic,
  error: diagnostic,
};

export { nativeConsole as console };
