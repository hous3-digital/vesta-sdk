# Template para Pacotes TypeScript

Este repositório serve como um modelo (_template_) para a criação de novos pacotes Node.js utilizando TypeScript. O objetivo é padronizar o desenvolvimento, a automação de CI/CD e a publicação de pacotes no GitHub Packages da organização.

O template está pré-configurado com:

- **Estrutura de Projeto:** O código-fonte do pacote está localizado no diretório `app/`.
- **TypeScript:** Configuração otimizada para compilação e geração de tipos (`.d.ts`).
- **Testes Automatizados:** Jest configurado com suporte a TypeScript para testes unitários.
- **Linting:** ESLint configurado com regras para TypeScript.
- **CI/CD com GitHub Actions:** Workflows automatizados para lint, testes, security scan, versionamento semântico e publicação.
- **Segurança:** Workflows seguindo melhores práticas de segurança (permissões mínimas, proteção contra template injection).
- **Versionamento Semântico:** Utiliza [Conventional Commits](https://www.conventionalcommits.org/) para gerar releases automaticamente.
- **Publicação Multi-Registro:** Suporta publicação no GitHub Packages e opcionalmente no npmjs.com.

## Como Usar este Template

1. **Crie um novo repositório:** No GitHub, clique no botão **"Use this template"** para criar um novo repositório a partir deste modelo.
2. **Clone o novo repositório:**

   ```bash
   git clone https://github.com/hous3-digital/seu-novo-pacote.git
   ```

3. **Configure o pacote:** O desenvolvimento do pacote ocorre inteiramente dentro do diretório `app/`.

## Configuração do Pacote

Acesse o diretório `app/` para configurar seu pacote.

```bash
cd app
```

### 1. Crie e configure o `package.json`

Dentro do diretório `app/`, renomeie o arquivo `package.json.example` para `package.json`. Em seguida, ajuste os seguintes campos:

- **`name`**: Defina o nome do seu pacote, seguindo o escopo `@hous3-digital`.

  ```json
  "name": "@hous3-digital/nome-do-pacote"
  ```

- **`description`**: Forneça uma breve descrição do que o pacote faz.
- **`repository`**: Atualize a URL para o novo repositório.

  ```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/hous3-digital/seu-novo-pacote.git"
  }
  ```

- **`author`**, **`bugs`**, **`homepage`**: Atualize conforme necessário.

### 2. Configurando o `.npmrc` para Consumo

Para que outros projetos possam instalar este pacote privado, eles precisarão de um arquivo `.npmrc` na raiz do projeto consumidor com o seguinte conteúdo:

```ini
@hous3-digital:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=SEU_GITHUB_TOKEN
```

**Importante:**

- `SEU_GITHUB_TOKEN` deve ser substituído por um **Personal Access Token (PAT)** do GitHub com a permissão `read:packages`.
- Para gerar seu PAT, siga as instruções na [documentação oficial do GitHub](https://docs.github.com/pt/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token).

## Estrutura do Projeto

O desenvolvimento do pacote ocorre dentro do diretório `app/`:

```text
app/
├── src/
│   └── index.ts          # Ponto de entrada do seu pacote
├── __test__/
│   └── index.test.ts     # Testes unitários
├── .eslintrc.json        # Configuração do ESLint
├── .eslintignore         # Arquivos ignorados pelo ESLint
├── jest.config.js        # Configuração do Jest
├── tsconfig.json         # Configurações do TypeScript para build
├── tsconfig.eslint.json  # Configurações do TypeScript para linting
├── .npmignore            # Define quais arquivos NÃO devem ser publicados
└── package.json          # Metadados e dependências do pacote
```

- **`app/src/`**: Contém o código-fonte TypeScript do seu pacote.
- **`app/__test__/`**: Contém os testes unitários usando Jest.
- **`app/dist/`**: (Gerado na compilação) Contém o código JavaScript transpilado e os arquivos de definição de tipo (`.d.ts`) que serão publicados.

## Desenvolvimento

### Scripts Disponíveis

No diretório `app/`, você pode executar:

- **`yarn build`**: Compila o código TypeScript para JavaScript
- **`yarn test`**: Executa os testes com Jest
- **`yarn test:watch`**: Executa os testes em modo watch
- **`yarn test:coverage`**: Gera relatório de cobertura de código
- **`yarn lint`**: Verifica o código com ESLint
- **`yarn lint:fix`**: Corrige automaticamente problemas de linting

### Exemplo de Uso

```typescript
// app/src/index.ts
export function somar(a: number, b: number): number {
  return a + b;
}

// app/__test__/index.test.ts
import { somar } from '../src/index';

describe('somar', () => {
  it('deve somar dois números', () => {
    expect(somar(2, 3)).toBe(5);
  });
});
```

## Publicação e Consumo do Pacote

### Onde Encontrar o Pacote

Após a publicação automática pelo workflow `main-workflow`, o pacote estará disponível no GitHub Packages.

Você pode encontrá-lo na página de pacotes do repositório, em uma URL semelhante a esta:
`https://github.com/hous3-digital/seu-novo-pacote/packages`

### Como Consumir o Pacote

Para utilizar o pacote em outro projeto, siga os passos abaixo:

#### 1. Configure o `.npmrc`

Na raiz do projeto que irá consumir o pacote, crie um arquivo `.npmrc` com o seguinte conteúdo para autenticar no registro do GitHub Packages:

```ini
@hous3-digital:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=SEU_GITHUB_TOKEN
```

**Importante:** Substitua `SEU_GITHUB_TOKEN` por um **Personal Access Token (PAT)** do GitHub com a permissão `read:packages`.

#### 2. Instale o pacote

Execute o comando de instalação usando `npm` ou `yarn`:

```bash
npm install @hous3-digital/nome-do-pacote
```

ou

```bash
yarn add @hous3-digital/nome-do-pacote
```

Agora você pode importar e usar as funcionalidades do pacote no seu projeto.

## Fluxo de CI/CD

O template inclui um pipeline de CI/CD robusto e seguro com os seguintes workflows:

### 1. `feature-workflow`

- **Gatilho:** Push em branches `feat/**`, `fix/**` ou `chore/**`.
- **Pipeline:**
  1. **Install**: Instala dependências
  2. **Lint**: Verifica código com ESLint
  3. **Security Scan**: Auditoria de dependências
  4. **Test**: Compila e executa testes
  5. **Pull Request**: Cria/atualiza PR para `staging`
- **Segurança:** Permissões mínimas por job, proteção contra template injection

### 2. `staging-workflow`

- **Gatilho:** Push na branch `staging`.
- **Pipeline:**
  1. Executa todos os checks (lint, security, testes)
  2. Compila o código TypeScript
  3. Gera uma **pre-release** no GitHub (ex: `v1.0.0-staging.1`)
- **Nota:** Pre-releases são úteis para validação antes da produção

### 3. `release-workflow`

- **Gatilho:** Conclusão bem-sucedida do `staging-workflow`.
- **Ações:**
  - Cria uma branch de release (ex: `release/v1.0.0-staging.1`)
  - Abre um Pull Request da branch de release para a `main`
- **Validação:** Executa apenas se o workflow anterior foi bem-sucedido na branch `staging`

### 4. `main-workflow`

- **Gatilho:** Push na branch `main` (após o merge do PR de release).
- **Pipeline:**
  1. Executa todos os checks (lint, security, testes)
  2. Usa `semantic-release` para analisar commits e criar **release de produção**
  3. **Publica o pacote** no GitHub Packages
  4. (Opcional) Publica no npmjs.com se configurado

### Publicação Multi-Registro

#### GitHub Packages (Padrão)

Sempre publica automaticamente no GitHub Packages após release.

#### npmjs.com (Opcional)

Para habilitar publicação no npmjs.com:

1. **Criar token no npmjs.com:**
   - Acesse <https://www.npmjs.com/settings/[seu-usuario]/tokens>
   - Crie um token do tipo "Automation"

2. **Adicionar secret no GitHub:**
   - Settings → Secrets and variables → Actions
   - Adicione `NPM_TOKEN` com o token do npm

3. **Adicionar variável no GitHub:**
   - Settings → Secrets and variables → Actions → Variables
   - Adicione `PUBLISH_TO_NPM` com valor `true`

### Características de Segurança

Os workflows implementam as seguintes práticas de segurança:

- ✅ **Permissões Mínimas**: Cada job tem apenas as permissões necessárias
- ✅ **Proteção de Credenciais**: `persist-credentials: false` em todos os checkouts
- ✅ **Template Injection Protection**: Variáveis do GitHub são sanitizadas
- ✅ **Workflow Validation**: Triggers validam origem e estado dos workflows anteriores

## Versionamento Semântico

O versionamento é automatizado com base nos **Conventional Commits**. Use os seguintes prefixos em suas mensagens de commit:

- `fix:`: Gera uma versão de **PATCH** (ex: 1.0.0 → 1.0.1).
- `feat:`: Gera uma versão **MINOR** (ex: 1.0.0 → 1.1.0).
- `BREAKING CHANGE:` (no rodapé do commit) ou `!` após o tipo (`feat!:`) gera uma versão **MAJOR** (ex: 1.0.0 → 2.0.0).

**Exemplo de commit:**

```bash
git commit -m "feat: adiciona nova função de cálculo"
```

## Troubleshooting

### Testes Falhando

Se os testes estiverem falhando localmente:

```bash
cd app
yarn install
yarn build
yarn test
```

### Erros de Lint

Para verificar e corrigir problemas de linting:

```bash
cd app
yarn lint          # Verifica problemas
yarn lint:fix      # Corrige automaticamente
```

### Publicação Falhando

1. Verifique se a versão já existe no registro
2. Confirme que os secrets estão configurados corretamente
3. Verifique os logs do workflow no GitHub Actions

## Recursos Adicionais

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Release](https://semantic-release.gitbook.io/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [ESLint TypeScript](https://typescript-eslint.io/)
- [GitHub Packages](https://docs.github.com/en/packages)
- [Trusted Publishing Guide](.github/TRUSTED_PUBLISHING.md)
