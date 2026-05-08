/**
 * Retorna uma mensagem de saudação
 * @param name - Nome da pessoa (opcional)
 * @returns Mensagem de saudação
 */
export function helloWorld(name?: string): string {
  if (name) {
    return `Hello, ${name}!`;
  }
  return 'Hello, World!';
}
