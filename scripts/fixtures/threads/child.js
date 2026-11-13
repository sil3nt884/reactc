// A forked child: answers one message, then exits with code 3. In reactc this
// ends only the child's thread; the parent keeps running.
process.on('message', message => {
  process.send({ doubled: message.n * 2, connected: process.connected, args: process.argv.slice(2) });
  setTimeout(() => process.exit(3), 10);
});
