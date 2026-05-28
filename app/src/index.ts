/**
 * @hous3-digital/vesta-sdk
 *
 * SDK JavaScript/TypeScript para integração com a vesta-api-stellar.
 *
 * ## Uso rápido
 * ```typescript
 * import { VestaSDK } from '@hous3-digital/vesta-sdk';
 *
 * const sdk = new VestaSDK({
 *   apiKey: 'vesta_live_abc123',
 * });
 *
 * // Emite VC e registra no Passkey do dispositivo
 * const issued = await sdk.issueCredential({ ... });
 *
 * // Valida on-chain via ZK (recupera VC pelo Passkey automaticamente)
 * const result = await sdk.validateCredential({
 *   privateInputs: { cpf: '...', birthDate: '...', fullName: '...' },
 *   verifierId: 'verifier_bradesco',
 *   minKycLevel: 2,
 * });
 * ```
 */

export { VestaSDK } from './vesta-sdk';
export { VestaSDKError } from './http/client';
export { VestaEnvironment } from './types';

export type {
  // Configuração
  VestaSDKConfig,

  // Tipos da VC
  VestaVC,
  VestaVCIssuer,
  VestaVCCredentialSubject,
  VestaVCProof,
  KycLevel,
  Groth16Proof,

  // Requests
  IssueCredentialRequest,
  ValidateCredentialRequest,
  VerifyCredentialRequest,
  RevokeCredentialRequest,
  SubmitProofRequest,

  // Responses
  IssueCredentialResponse,
  VerifyCredentialResponse,
  RevokeCredentialResponse,
  GenerateAndSubmitResponse,
  ZkProofDetails,
  StellarTransactionDetails,
  AttestationDetails,

  // Passkey / Armazenamento
  StoredCredential,
  PasskeyRegistrationResult,

  // Smart Enroll
  SmartEnrollParams,
  SmartEnrollResult,
} from './types';
