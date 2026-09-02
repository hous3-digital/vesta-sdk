# @hous3-digital/vesta-sdk

SDK JavaScript/TypeScript para integração com a **Vesta** — plataforma de Credenciais Verificáveis com provas de conhecimento-zero (ZK) e registro on-chain na rede Stellar/Soroban.

## O que é a Vesta

A Vesta emite, armazena e valida **Credenciais Verificáveis (VCs)** de KYC para bancos e fintechs. O fluxo central:

1. O integrador emite uma VC via API — os dados de PII são convertidos em Poseidon hashes e nunca armazenados em claro.
2. A VC é armazenada no backend e mantida como cache no dispositivo; o acesso e a recuperação em outro dispositivo são protegidos por **Passkey (WebAuthn)**.
3. Na autenticação, o SDK autentica o usuário via Passkey, gera uma prova **ZK Groth16** e a submete ao contrato **Soroban** na Stellar para verificação on-chain.

---

## Instalação

### Pré-requisitos

- Node.js 22+
- Token GitHub com permissão `read:packages`

### Configurar o registro

No projeto consumidor, crie ou edite `.npmrc`:

```ini
@hous3-digital:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=SEU_GITHUB_TOKEN
```

### Instalar o pacote

```bash
npm install @hous3-digital/vesta-sdk
# ou
yarn add @hous3-digital/vesta-sdk
```

---

## Início rápido

```typescript
import { VestaSDK, VestaEnvironment } from '@hous3-digital/vesta-sdk';

const sdk = new VestaSDK({
  apiKey: 'vesta_live_abc123',
  issuerId: 'bradesco',
  environment: VestaEnvironment.PRODUCTION,
});

// 1. Emitir credencial e registrar Passkey no dispositivo
const issued = await sdk.issueCredential({
  cpf: '12345678900',
  fullName: 'João da Silva',
  birthDate: '1990-03-15',
  kycLevel: 'complete',
  kycMethod: 'biometric_plus_document',
});

// 2. Validar credencial on-chain via prova ZK
const result = await sdk.validateCredential({
  privateInputs: {
    cpf: '12345678900',
    birthDate: '19900315',
    fullName: 'JOAO SILVA',
  },
  verifierId: 'verifier_bradesco',
  minKycLevel: 2,
});

console.log(result.verified); // true
console.log(result.stellar.txHash); // hash da TX na Stellar
```

---

## Smart Enroll — fluxo unificado

Por padrão, `smartEnroll` decide automaticamente o caminho com base na presença de uma VC no dispositivo. Para login explícito, `mode: 'authenticate'` aciona diretamente o Passkey descobrível e recupera a VC do backend caso o IndexedDB esteja vazio:

| Situação | Fluxo executado |
|---|---|
| Sem VC no dispositivo | Emite VC + registra Passkey (novo usuário) |
| VC existente | Autentica via Passkey + valida on-chain (usuário recorrente) |
| `mode: 'authenticate'` e Passkey sincronizado | Autentica, restaura a VC local e valida on-chain |

```typescript
const result = await sdk.smartEnroll({
  mode: 'authenticate', // use no botão "Entrar"; omita para descoberta automática local
  userData: {
    cpf: '12345678900',
    fullName: 'João da Silva',
    birthDate: '1990-03-15',
    kycLevel: 'complete',
    kycMethod: 'biometric_plus_document',
  },
  privateInputs: {
    cpf: '12345678900',
    birthDate: '19900315',
    fullName: 'JOAO SILVA',
  },
  verifierId: 'verifier_bradesco',
  minKycLevel: 2,
});

console.log(result.authenticated); // true
console.log(result.isNewUser);     // true (primeiro acesso) | false (recorrente)
```

---

## API de referência

### `new VestaSDK(config)`

| Campo | Tipo | Padrão | Descrição |
|---|---|---|---|
| `apiKey` | `string` | — | Chave de API do integrador (obrigatório) |
| `issuerId` | `string` | — | ID do emissor enviado nas requisições de emissão |
| `environment` | `VestaEnvironment` | `STAGING` | Ambiente de execução |
| `rpId` | `string` | `window.location.hostname` | Relying Party ID para WebAuthn |

### Métodos

| Método | Descrição |
|---|---|
| `issueCredential(req)` | Emite VC e registra Passkey no dispositivo |
| `validateCredential(req)` | Autentica via Passkey e valida on-chain via ZK |
| `smartEnroll(params)` | Fluxo unificado: emissão ou validação conforme contexto |
| `checkCredentialStatus(req)` | Consulta status de uma VC pelo `vcHash` |
| `revokeCredential(req)` | Revoga uma credencial permanentemente |
| `getStoredCredential()` | Retorna a VC armazenada localmente via Passkey |
| `submitProof(req)` | Submete prova Groth16 gerada externamente |
| `listStoredCredentials()` | Lista os `vcHash` armazenados no dispositivo |
| `deleteStoredCredential(vcHash)` | Remove uma VC do armazenamento local |
| `hasStoredCredential()` | Verifica se há alguma VC armazenada |
| `isPasskeySupported()` | Verifica suporte a WebAuthn/Passkeys no ambiente |

### Ambientes

| Valor | URL |
|---|---|
| `VestaEnvironment.STAGING` | `https://vesta.trust-staging.com` |
| `VestaEnvironment.PRODUCTION` | `https://vesta.trust.com` |

### Tratamento de erros

O SDK lança `VestaSDKError` para falhas da API e erros de rede:

```typescript
import { VestaSDKError } from '@hous3-digital/vesta-sdk';

try {
  await sdk.issueCredential(params);
} catch (err) {
  if (err instanceof VestaSDKError) {
    console.error(`[${err.statusCode}] ${err.apiMessage}`);
    // statusCode === 0  → timeout ou erro de rede
    // statusCode === 401 → API key inválida
    // statusCode === 409 → CPF já possui credencial ativa
  }
}
```

---

## Estrutura do repositório

```text
.
├── .github/
│   └── workflows/        # Pipelines de CI/CD
├── app/                  # Código-fonte e configuração do pacote SDK
│   ├── src/
│   │   ├── credentials/  # Emissão, consulta e revogação de VCs
│   │   ├── http/         # Cliente HTTP com autenticação e timeout
│   │   ├── passkey/      # WebAuthn: registro e autenticação via Passkey
│   │   ├── proofs/       # Geração e submissão de provas ZK Groth16
│   │   ├── types.ts      # Tipos públicos do SDK
│   │   ├── vesta-sdk.ts  # Classe principal VestaSDK
│   │   └── index.ts      # API pública exportada
│   └── __test__/         # Testes unitários
└── README.md
```

---

## Desenvolvimento local

No diretório `app/`:

```bash
yarn          # instala dependências
yarn lint     # valida lint
yarn build    # compila TypeScript para dist/ (CJS + ESM)
yarn test     # executa testes unitários
```

Scripts disponíveis:

| Script | Descrição |
|---|---|
| `yarn build` | Compila para `dist/cjs` e `dist/esm` |
| `yarn test` | Executa suite de testes com Jest |
| `yarn test:watch` | Testes em modo watch |
| `yarn test:coverage` | Relatório de cobertura |
| `yarn lint` | Valida lint com ESLint |
| `yarn lint:fix` | Corrige problemas de lint automaticamente |

---

## Contribuição

### Fluxo de branches

1. Crie branch a partir de `develop` com prefixo `feat/*`, `fix/*` ou `chore/*`.
2. Abra PR para `staging` — o workflow de feature abre o PR automaticamente após CI verde.
3. Após homologação em staging (pre-release gerado), promova para `main` via workflow de release.

### Padrão de commits

Use **Conventional Commits** em inglês:

| Prefixo | Efeito na versão |
|---|---|
| `feat:` | minor |
| `fix:` | patch |
| `feat!:` / `BREAKING CHANGE:` | major |

### Validação antes do PR

```bash
cd app
yarn
yarn lint
yarn build
yarn test
```

---

## CI/CD e publicação

| Workflow | Trigger | Ação |
|---|---|---|
| `feature-workflow` | push em `feat/**`, `fix/**`, `chore/**` | lint + security scan + testes + abre PR para `staging` |
| `staging-workflow` | push em `staging` | checks + pre-release semântico |
| `release-workflow` | manual/automático | prepara PR de release para `main` |
| `main-workflow` | push em `main` | release final + publicação no GitHub Packages |

**Publicação padrão:** GitHub Packages (`@hous3-digital` scope, acesso restrito).  
**Publicação opcional no npmjs.com:** defina a variável de repositório `PUBLISH_TO_NPM=true` e o secret `NPM_TOKEN`.

---

## Checklist de release

- [ ] CI verde em todos os workflows
- [ ] Commits no padrão Conventional Commits
- [ ] PR revisado e aprovado
- [ ] Secrets de publicação configurados (`GITHUB_TOKEN` com `packages:write`)

---

## Recursos

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Release](https://semantic-release.gitbook.io/)
- [GitHub Packages — Node.js](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)
- [WebAuthn — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)
- [Stellar Soroban](https://soroban.stellar.org/)
