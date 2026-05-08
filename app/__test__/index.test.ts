import { helloWorld } from '../src/index';

describe('helloWorld', () => {
  it('deve retornar "Hello, World!" sem argumentos', () => {
    expect(helloWorld()).toBe('Hello, World!');
  });

  it('deve retornar saudação personalizada com nome', () => {
    expect(helloWorld('TypeScript')).toBe('Hello, TypeScript!');
  });

  it('deve retornar saudação personalizada com outro nome', () => {
    expect(helloWorld('Desenvolvedor')).toBe('Hello, Desenvolvedor!');
  });
});
