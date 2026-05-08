# SDK (Pacote) — Desenvolvimento e Uso

Este `README` descreve o **pacote SDK** que vive em `app/`: como configurar, desenvolver, testar e consumir.

Para documentação do repositório/template (fluxo de contribuição e CI/CD), veja `../README.md`.

## 1) Configuração inicial do pacote

1. Renomeie `package.json.example` para `package.json`.
2. Ajuste os campos principais:
   - `name` no escopo da organização (ex.: `@hous3-digital/nome-do-pacote`)
   - `description`
   - `repository`, `author`, `bugs`, `homepage`

## 2) Estrutura do pacote

```text
app/
├── src/
│   └── index.ts          # API pública do pacote
├── __test__/
│   └── index.test.ts     # Testes unitários
├── jest.config.js
├── tsconfig.json
├── tsconfig.eslint.json
├── eslint.config.mjs
└── package.json
```

## 3) Desenvolvimento local

### Scripts

- `yarn build`: compila TypeScript para `dist/`
- `yarn test`: executa testes
- `yarn test:watch`: testes em modo watch
- `yarn test:coverage`: cobertura de testes
- `yarn lint`: valida lint
- `yarn lint:fix`: corrige lint automaticamente

### Fluxo recomendado

```bash
yarn
yarn lint
yarn build
yarn test
```

## 4) Como um dev externo instala e usa o SDK

### Pré-requisitos

- Node.js 22+
- npm ou yarn
- Token GitHub com `read:packages`

### Autenticação para GitHub Packages

No projeto consumidor, crie `.npmrc`:

```ini
@hous3-digital:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=SEU_GITHUB_TOKEN
```

### Instalação

```bash
npm install @hous3-digital/nome-do-pacote
```

ou

```bash
yarn add @hous3-digital/nome-do-pacote
```

### Primeiro uso

```typescript
import { suaFuncao } from '@hous3-digital/nome-do-pacote';

const resultado = suaFuncao();
console.log(resultado);
```

## 5) Publicação do pacote

A publicação acontece via pipeline do repositório (não manualmente no dev local):

1. Merge em `staging` gera pre-release.
2. Promoção de release para `main` dispara release final.
3. Publicação no GitHub Packages (e opcionalmente npmjs.com).

## 6) Troubleshooting rápido

### Testes falhando

```bash
yarn
yarn build
yarn test
```

### Erros de lint

```bash
yarn lint
yarn lint:fix
```
