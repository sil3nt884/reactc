// Appended to a bundled synchronous page. Shared by both compilers.
__write(NativeApp.page.start());
while (true) {
  try {
    const command = __read();
    if (command === undefined) break;
    __write(NativeApp.page.handle(command));
  } catch (error) {
    __write({version:1,type:'error',error:error.message});
  }
}
