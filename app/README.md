# Exemplo de Consumo - @marcosvile/math-utils

Esta é uma aplicação de exemplo que demonstra como consumir o pacote `@marcosvile/math-utils` publicado no GitHub Packages.

## Como executar

### 1. Configure a autenticação

Crie um arquivo `.npmrc` nesta pasta:

```ini
@marcosvile:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=SEU_NPM_TOKEN
```

**Importante:** Substitua `SEU_NPM_TOKEN` pelo seu Personal Access Token do GitHub.

### 2. Instale as dependências

```bash
npm install
```

### 3. Execute a aplicação

```bash
npm start
```

## O que esta aplicação faz

O arquivo `app.js` demonstra:

- Importação do pacote `@marcosvile/math-utils`
- Uso da função `multiplicar()`
- Uso da função `dividir()`
- Tratamento de erro para divisão por zero

## Documentação

Para mais informações sobre como usar o pacote, consulte o [README principal](../README.md).
