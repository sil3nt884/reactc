// node:child_process for reactc servers on Windows: shell commands (exec,
// execSync, and shell: true) run through %ComSpec% (cmd.exe) as Node does:
// cmd.exe /d /s /c "<command>", passed verbatim. Everything else is Porffor's.
import * as base from 'node:child_process';
import { forkThread } from 'node:worker_threads';

export * from 'node:child_process';

const real = base.default ?? base;

function shellFor(options) {
  const shell = options && typeof options.shell === 'string' ? options.shell : (process.env.ComSpec || 'cmd.exe');
  return shell;
}

function shellCommand(command, options) {
  const shell = shellFor(options);
  // cmd.exe needs Node's /d /s /c form; other shells take -c like on POSIX.
  if (/(?:^|[\\/])cmd(?:\.exe)?$/i.test(shell)) return [shell, ['/d', '/s', '/c', '"' + command + '"']];
  return [shell, ['-c', command]];
}

function withoutShell(options) {
  if (!options) return options;
  const copy = { ...options };
  delete copy.shell;
  return copy;
}

// Node joins file and arguments with spaces when a shell runs them.
function commandLine(file, args) {
  return args && args.length ? file + ' ' + args.join(' ') : file;
}

function splitArgs(args, options) {
  return Array.isArray(args) ? [args, options] : [[], args];
}

export function execSync(command, options) {
  const [file, args] = shellCommand(command, options);
  return real.execFileSync(file, args, withoutShell(options));
}

export function exec(command, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = undefined;
  }
  const [file, args] = shellCommand(command, options);
  return real.execFile(file, args, withoutShell(options), callback);
}

export function spawn(file, args, options) {
  [args, options] = splitArgs(args, options);
  if (options && options.shell) {
    const [shell, shellArgs] = shellCommand(commandLine(file, args), options);
    return real.spawn(shell, shellArgs, withoutShell(options));
  }
  return real.spawn(file, args, options);
}

export function spawnSync(file, args, options) {
  [args, options] = splitArgs(args, options);
  if (options && options.shell) {
    const [shell, shellArgs] = shellCommand(commandLine(file, args), options);
    return real.spawnSync(shell, shellArgs, withoutShell(options));
  }
  return real.spawnSync(file, args, options);
}

export function execFileSync(file, args, options) {
  [args, options] = splitArgs(args, options);
  if (options && options.shell) {
    const [shell, shellArgs] = shellCommand(commandLine(file, args), options);
    return real.execFileSync(shell, shellArgs, withoutShell(options));
  }
  return real.execFileSync(file, args, options);
}

// fork() of a literal module path runs it as a native thread.
export function fork(spec, args, options) {
  return forkThread(spec, args, options);
}

const childProcess = { ...real, exec, execSync, spawn, spawnSync, execFileSync, fork };
export default childProcess;
