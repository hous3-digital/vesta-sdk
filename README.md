# Template de SDK TypeScript (Repositório)

Este `README` descreve **como usar e evoluir este repositório/template**.

Para documentação do pacote em si (desenvolvimento e consumo do SDK), veja `app/README.md`.

## Documentação separada

- **Repositório/template (este arquivo):** estrutura, contribuição, CI/CD e release.
- **Pacote SDK:** `app/README.md`.

## Objetivo do repositório

Padronizar a criação de pacotes Node.js com TypeScript na HOUS3, incluindo:

- estrutura base em `app/`
- lint, build e testes automatizados
- versionamento semântico com Conventional Commits
- workflows de release e publicação no GitHub Packages (e opcionalmente npmjs.com)

## Estrutura de alto nível

```text
.
├── .github/workflows/   # Pipelines de CI/CD
├── app/                 # Código e configuração do pacote SDK
└── README.md            # Guia do repositório/template
```

## Como usar este template

1. No GitHub, clique em **Use this template**.
2. Crie seu novo repositório a partir deste modelo.
3. Clone o novo repositório.
4. Siga a configuração do pacote em `app/README.md`.

## Como contribuir (dev HOUS3)

### Fluxo de branches

1. Crie branch a partir de `develop` (`feat/*`, `fix/*`, `chore/*`).
2. Abra PR para `staging`.
3. Após homologação, promova `staging` para `main` via fluxo de release.

### Validação local antes do PR

No diretório `app/`:

```bash
yarn
yarn lint
yarn build
yarn test
```

### Padrão de commit

Use **Conventional Commits** (em inglês):

- `feat:` → versão minor
- `fix:` → versão patch
- `feat!:` ou `BREAKING CHANGE:` → versão major

## CI/CD e publicação

### Workflows

- `feature-workflow`: valida feature/fix/chore e abre/atualiza PR para `staging`.
- `staging-workflow`: roda checks e gera pre-release.
- `release-workflow`: prepara PR de release para `main`.
- `main-workflow`: release final + publicação do pacote.

### Publicação

- **Padrão:** GitHub Packages.
- **Opcional:** npmjs.com com `NPM_TOKEN` e `PUBLISH_TO_NPM=true`.

## Checklist de release

- [ ] CI verde
- [ ] Commits no padrão Conventional Commits
- [ ] PR revisado/aprovado
- [ ] Secrets/variáveis de publicação configurados

## Recursos úteis

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Release](https://semantic-release.gitbook.io/)
- [GitHub Packages](https://docs.github.com/en/packages)
- [Guia de Trusted Publishing](.github/TRUSTED_PUBLISHING.md)
