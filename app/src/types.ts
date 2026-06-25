/**
 * Tipos públicos do @hous3-digital/vesta-sdk
 *
 * Todos os tipos aqui espelham exatamente os contratos da vesta-api-stellar,
 * permitindo integração segura entre o SDK e a API sem discrepâncias de schema.
 */

// ─── Enums e primitivos ───────────────────────────────────────────────────────

/**
 * Ambiente de execução do SDK.
 * Determina a URL base da API Vesta.
 *
 * @example
 * const sdk = new VestaSDK({
 *   apiKey: 'key',
 *   environment: VestaEnvironment.PRODUCTION,
 * });
 */
export enum VestaEnvironment {
  /** Ambiente de homologação — https://vesta.trust-staging.com */
  STAGING = 'staging',
  /** Ambiente de produção — https://vesta.trust.com */
  PRODUCTION = 'production',
}

/**
 * Nível de KYC suportado pela Vesta.
 * - basic: verificação documental simples
 * - intermediate: validação adicional (ex: comprovante de renda)
 * - complete: biometria + documento + validação Serasa/SPC
 */
export type KycLevel = 'basic' | 'intermediate' | 'complete';

// ─── Estrutura da VC ──────────────────────────────────────────────────────────

/** Emissor da credencial verificável (banco, fintech ou órgão regulador). */
export interface VestaVCIssuer {
  /** DID do emissor — ex: "did:web:vesta.id:issuers:bradesco" */
  id: string;
  /** Nome legível do emissor — ex: "Banco Bradesco S.A." */
  name: string;
}

/** Dados do sujeito da credencial. Todos os campos de PII são Poseidon hashes. */
export interface VestaVCCredentialSubject {
  /** DID do usuário titular — ex: "did:key:z6Mk..." */
  id: string;
  /** Hash Poseidon do CPF (campo BN254 Fr). Nunca o CPF em claro. */
  cpf_hash: string;
  /** Hash Poseidon da data de nascimento (YYYYMMDD). */
  birth_date_hash: string;
  /** Hash Poseidon do nome completo em maiúsculas. */
  full_name_hash: string;
  /** Nível do KYC aprovado pelo emissor. */
  kyc_level: KycLevel;
  /** Provedor que realizou a verificação — ex: "serasa" */
  kyc_provider: string;
  /** Método utilizado na verificação — ex: "biometric_plus_document" */
  kyc_method: string;
  /** Nacionalidade ISO 3166-1 alpha-2 — ex: "BR" */
  nationality: string;
}

/** Assinatura criptográfica da VC emitida pelo issuer. */
export interface VestaVCProof {
  /** Tipo de assinatura — ex: "PoseidonSignature2024" */
  type: string;
  /** Timestamp ISO 8601 de criação da assinatura. */
  created: string;
  /** Referência ao método de verificação do emissor. */
  verificationMethod: string;
  /** Propósito da prova — sempre "assertionMethod" para VCs. */
  proofPurpose: string;
  /** Valor da assinatura codificado em base64url ou formato específico. */
  proofValue: string;
}

/**
 * Credencial Verificável no padrão W3C + extensões Vesta.
 * Produzida pela API após emissão bem-sucedida.
 */
export interface VestaVC {
  '@context': string[];
  /** URN UUID único da VC — ex: "urn:uuid:550e8400-..." */
  id: string;
  /** Tipos da VC — sempre inclui "VerifiableCredential" e "VestaKYCCredential". */
  type: string[];
  issuer: VestaVCIssuer;
  /** Data de emissão ISO 8601. */
  issuance_date: string;
  /** Data de expiração ISO 8601. */
  expiration_date: string;
  credential_subject: VestaVCCredentialSubject;
  proof: VestaVCProof;
}

/**
 * Prova Groth16 no formato retornado pelo snarkjs.
 * Pontos em coordenadas projetivas como strings decimais.
 */
export interface Groth16Proof {
  /** Ponto G1 da prova — [X, Y, Z] como strings decimais. */
  pi_a: string[];
  /** Ponto G2 da prova — [[X_c0, X_c1], [Y_c0, Y_c1], Z] como strings decimais. */
  pi_b: string[][];
  /** Ponto G1 da prova — [X, Y, Z] como strings decimais. */
  pi_c: string[];
  protocol?: string;
  curve?: string;
}

// ─── Configuração do SDK ──────────────────────────────────────────────────────

/**
 * Configuração necessária para instanciar o VestaSDK.
 *
 * @example
 * const sdk = new VestaSDK({
 *   apiUrl: 'https://vesta.trust-staging.com',
 *   apiKey: 'vesta_live_abc123',
 *   issuerId: 'bradesco',
 * });
 */
export interface VestaSDKConfig {
  /**
   * Chave de API do integrador (banco/fintech).
   * Análogo à publishable key do Stripe — incluída no header X-Api-Key.
   */
  apiKey: string;
  /** ID do emissor enviado no corpo das requisições de emissão de credencial. */
  issuerId?: string;
  /**
   * Ambiente de execução. Determina a URL base da API.
   * Padrão: `VestaEnvironment.STAGING`.
   */
  environment?: VestaEnvironment;
  /**
   * Relying Party ID para WebAuthn.
   * Padrão: window.location.hostname.
   * Deve ser igual ao domínio onde o SDK está sendo executado.
   */
  rpId?: string;
}

// ─── Requests ─────────────────────────────────────────────────────────────────

/**
 * Parâmetros para emitir uma nova credencial verificável.
 * Os dados de PII aqui são enviados ao backend, que calcula os hashes
 * e gera a VC — nunca são armazenados ou retornados pela API.
 */
export interface IssueCredentialRequest {
  /** CPF do titular com ou sem formatação — ex: "123.456.789-00" ou "12345678900". */
  cpf: string;
  /** Nome completo do titular. */
  fullName: string;
  /** Data de nascimento no formato YYYY-MM-DD — ex: "1990-03-15". */
  birthDate: string;
  /** Nível de KYC a ser registrado na credencial. */
  kycLevel: KycLevel;
  /** Método utilizado na verificação — ex: "biometric_plus_document". */
  kycMethod: string;
  /** Nacionalidade ISO 3166-1 alpha-2 (padrão: "BR"). */
  nationality?: string;
  /** Validade da credencial em dias (padrão: 365, máximo: 3650). */
  expirationDays?: number;
}

/**
 * Parâmetros para validar uma credencial existente via prova ZK on-chain.
 *
 * O SDK recupera internamente a VC e o vcHash via autenticação Passkey.
 * O cliente nunca precisa conhecer ou manipular esses valores.
 */
export interface ValidateCredentialRequest {
  /**
   * Inputs privados do circuito ZK (witnesses).
   * Enviados ao backend para gerar a prova Groth16 — nunca armazenados.
   */
  privateInputs: {
    /** CPF do titular sem formatação — ex: "12345678900". */
    cpf: string;
    /** Data de nascimento no formato YYYYMMDD — ex: "19900315". */
    birthDate: string;
    /** Nome completo em maiúsculas — ex: "JOAO SILVA". */
    fullName: string;
  };
  /** Identificador do verificador — ex: "verifier_bradesco". */
  verifierId: string;
  /** Nível mínimo de KYC exigido: 1=basic, 2=intermediate, 3=complete. */
  minKycLevel: number;
}

/** Parâmetros para consultar o status de uma credencial pelo hash. */
export interface VerifyCredentialRequest {
  /** Hash SHA-256 da VC em hex. */
  vcHash: string;
}

/** Parâmetros para revogar uma credencial. */
export interface RevokeCredentialRequest {
  /** Hash SHA-256 da VC em hex. */
  vcHash: string;
  /** Motivo da revogação (opcional) — ex: "fraudulent_documents". */
  reason?: string;
}

/**
 * Parâmetros para submeter uma prova Groth16 já gerada externamente.
 * Use este método quando a geração da prova ocorre fora do SDK.
 */
export interface SubmitProofRequest {
  /** Prova Groth16 no formato snarkjs. */
  proof: Groth16Proof;
  /** Sinais públicos do circuito ZK como strings decimais. */
  publicSignals: string[];
  /** Identificador do verificador. */
  verifierId: string;
  /** Hash SHA-256 da VC associada à prova. */
  vcHash: string;
}

// ─── Responses ────────────────────────────────────────────────────────────────

/**
 * Resposta da emissão de credencial.
 * Inclui o `passkeyCredentialId` criado pelo SDK no dispositivo do usuário.
 */
export interface IssueCredentialResponse {
  /** Credencial Verificável emitida. */
  vc: VestaVC;
  /** Hash SHA-256 da VC — identificador único do lado do backend. */
  vcHash: string;
  /** ID interno da credencial no banco de dados da API. */
  credentialId: string;
  /** Status atual — sempre "approved" em caso de sucesso. */
  status: string;
  /** Data de expiração ISO 8601. */
  expiresAt: string;
  /** Indica se a credencial já existia (re-emissão). */
  alreadyExisted: boolean;
}

/** Resposta da consulta de status de uma credencial. */
export interface VerifyCredentialResponse {
  /** Indica se a credencial está válida e ativa. */
  valid: boolean;
  /** Hash SHA-256 da VC consultada. */
  vcHash: string;
  /** Nível de KYC (presente se válida). */
  kycLevel?: KycLevel;
  /** ID do emissor (presente se válida). */
  issuerId?: string;
  /** Data de expiração ISO 8601 (presente se válida). */
  expiresAt?: string;
  /** Nonce para uso em desafio ZK (presente se válida). */
  challengeNonce?: string;
  /** Motivo da invalidação: "revoked" | "expired" (presente se inválida). */
  reason?: string;
}

/** Resposta da revogação de credencial. */
export interface RevokeCredentialResponse {
  /** Indica sucesso da operação. */
  success: boolean;
  /** Hash SHA-256 da VC revogada. */
  vcHash: string;
  /** Status atualizado — sempre "revoked" em caso de sucesso. */
  status: string;
  /** Motivo registrado ou null. */
  reason: string | null;
}

/** Detalhes da prova ZK gerada e submetida ao Soroban. */
export interface ZkProofDetails {
  /** Protocolo usado — sempre "groth16". */
  protocol: string;
  /** Curva elíptica — sempre "bn128" (BN254). */
  curve: string;
  /** Sinais públicos da prova (outputs do circuito). */
  publicSignals: string[];
  /** Hash SHA-256 da prova para auditoria. */
  proofHash: string;
  /** Indica se a prova foi gerada em mock mode (sem circuito real). */
  mock: boolean;
}

/** Detalhes da transação submetida à Stellar. */
export interface StellarTransactionDetails {
  /** Hash da transação Stellar. */
  txHash: string;
  /** Número do ledger em que a transação foi confirmada. */
  ledger: number;
  /** ID do contrato Soroban que executou a verificação. */
  contractId: string;
  /** Rede utilizada — ex: "stellar:soroban:testnet". */
  network: string;
  /** Indica se a transação foi simulada em mock mode. */
  mock: boolean;
}

/** Attestation on-chain registrada após verificação bem-sucedida. */
export interface AttestationDetails {
  /** ID interno da attestation. */
  id: string;
  /** Hash SHA-256 da VC verificada. */
  vcHash: string;
  /** Identificador do verificador. */
  verifierId: string;
  /** Nível de KYC verificado. */
  kycLevel: KycLevel;
  /**
   * Endereço Stellar (G...) da wallet do usuário que assinou a tx, quando
   * o issuer está com `privyEnabled = true`. Null no fluxo legado interno.
   */
  userWalletAddress: string | null;
  /** Timestamp ISO 8601 de criação. */
  createdAt: string;
}

/**
 * Requisição da fase 1 do fluxo de validação on-chain.
 * Não exposta diretamente — usada internamente pelo SDK em `validateCredential`.
 */
export interface PrepareProofRequest {
  vc: VestaVC;
  privateInputs: {
    cpf: string;
    birthDate: string;
    fullName: string;
  };
  verifierId: string;
  minKycLevel: number;
  challenge: string;
}

/**
 * Resposta da fase 1. O SDK usa `requiresUserSignature` para decidir
 * se deve assinar via Privy ou apenas repassar o XDR.
 */
export interface PrepareProofResponse {
  prepareSessionId: string;
  unsignedTxXdr: string;
  requiresUserSignature: boolean;
  userWalletAddress: string | null;
  zkProof: ZkProofDetails;
}

/**
 * Requisição da fase 2. Inclui o XDR assinado e (opcionalmente) o identity
 * token Privy quando a fase 1 indicou `requiresUserSignature: true`.
 */
export interface SubmitSignedProofRequest {
  prepareSessionId: string;
  signedTxXdr: string;
  privyIdentityToken?: string;
}

/** Resposta completa da geração e submissão de prova ZK. */
export interface GenerateAndSubmitResponse {
  /** Resultado da verificação on-chain — true se a prova é válida. */
  verified: boolean;
  /** Detalhes da prova ZK Groth16 gerada. */
  zkProof: ZkProofDetails;
  /** Detalhes da transação na rede Stellar. */
  stellar: StellarTransactionDetails;
  /** Attestation registrada on-chain. */
  attestation: AttestationDetails;
}

// ─── Passkey / Armazenamento ──────────────────────────────────────────────────

/**
 * Credencial armazenada localmente no IndexedDB do browser.
 * O acesso é protegido por autenticação WebAuthn (Passkey).
 */
export interface StoredCredential {
  /** Credencial Verificável completa. */
  vc: VestaVC;
  /** Hash SHA-256 da VC — chave primária no IndexedDB. */
  vcHash: string;
  /** Timestamp ISO 8601 de quando a credencial foi armazenada. */
  storedAt: string;
  /**
   * ID do WebAuthn credential criado durante o registro.
   * Codificado em base64url — usado em `allowCredentials` na autenticação.
   */
  passkeyCredentialId: string;
  /**
   * Challenge emitido pelo servidor e usado na assertion WebAuthn de autenticação.
   * Presente apenas quando `authenticate()` é chamado com challenge server-side.
   * Deve ser enviado de volta na requisição à API para verificação anti-replay.
   */
  challengeUsed?: string;
}

/** Resultado do registro de um Passkey para uma credencial. */
export interface PasskeyRegistrationResult {
  /** ID do WebAuthn credential criado (base64url). */
  passkeyCredentialId: string;
  /** Hash SHA-256 da VC associada ao passkey. */
  vcHash: string;
}

// ─── Smart Enroll ─────────────────────────────────────────────────────────────

/**
 * Parâmetros para o fluxo inteligente de cadastro/autenticação.
 *
 * O SDK decide internamente se criará uma nova VC (usuário novo)
 * ou validará a VC existente no dispositivo (usuário recorrente).
 */
export interface SmartEnrollParams {
  /**
   * Dados de identidade do usuário — usados apenas se nenhuma VC
   * existir no dispositivo (fluxo de novo cadastro + KYC).
   */
  userData: IssueCredentialRequest;
  /**
   * Inputs privados do circuito ZK (witnesses) — usados apenas se
   * já existir uma VC no dispositivo (fluxo de validação on-chain).
   * Devem corresponder exatamente aos dados usados na criação da VC original.
   */
  privateInputs: {
    /** CPF sem formatação — ex: "12345678900". */
    cpf: string;
    /** Data de nascimento YYYYMMDD — ex: "19900315". */
    birthDate: string;
    /** Nome em maiúsculas sem acento — ex: "JOAO SILVA". */
    fullName: string;
  };
  /** Identificador do verificador — ex: "verifier_bradesco". */
  verifierId: string;
  /** Nível mínimo de KYC exigido: 1=basic, 2=intermediate, 3=complete. */
  minKycLevel: number;
}

/**
 * Resultado do fluxo inteligente de cadastro/autenticação.
 */
export interface SmartEnrollResult {
  /** Indica se o usuário foi autenticado com sucesso. */
  authenticated: boolean;
  /**
   * `true` se o usuário não tinha VC no dispositivo e uma nova foi criada.
   * `false` se uma VC existente foi usada para autenticar.
   */
  isNewUser: boolean;
  /** Hash SHA-256 da VC emitida ou validada. */
  vcHash: string;
  /**
   * Hash da transação Stellar (presente apenas quando `isNewUser: false`,
   * pois apenas a validação ZK gera uma TX on-chain).
   */
  txHash?: string;
  /** Indica se a operação foi simulada em mock mode. */
  mock: boolean;
}
