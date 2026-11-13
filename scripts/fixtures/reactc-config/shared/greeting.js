// Shared by the server and the client.
export const PORT = 5055;

export function greeting(name) {
  return 'Hello, ' + (name || 'there') + '!';
}
