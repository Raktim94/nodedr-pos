// Loaded with `node --require` into every child process the Windows Store
// desktop shell starts (backend and Next.js server).
//
// The shell keeps a pipe open to each child's stdin. When the shell exits —
// cleanly, by crash, or by being killed — Windows closes that pipe and the
// child sees EOF and exits too, so no node.exe is ever left running in the
// background. The shell can also ask for a graceful stop by writing "shutdown".
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  const hook = global.__nodedrShutdownHook;
  const done = () => process.exit(0);
  setTimeout(done, 4000).unref(); // never hang on a stuck hook
  Promise.resolve()
    .then(() => hook && hook())
    .catch(() => {})
    .then(done);
}

process.stdin.on('data', (buf) => {
  if (buf.toString().includes('shutdown')) stop();
});
process.stdin.on('end', stop);
process.stdin.on('close', stop);
process.stdin.on('error', stop);
process.stdin.resume();
