import { createHttpClient, resolveBaseUrl } from './http/client';
import { CredentialsService } from './credentials/credentials.service';
import { ProofsService } from './proofs/proofs.service';
import { PasskeyService } from './passkey/passkey.service';
import type {
  GenerateAndSubmitResponse,
  IssueCredentialRequest,
  IssueCredentialResponse,
  PasskeyRegistrationResult,
  RevokeCredentialRequest,
  RevokeCredentialResponse,
  SmartEnrollParams,
  SmartEnrollResult,
  StoredCredential,
  SubmitProofRequest,
  ValidateCredentialRequest,
  VestaSDKConfig,
  VerifyCredentialRequest,
  VerifyCredentialResponse,
} from './types';

/**
 * Ponto de entrada principal do `@hous3-digital/vesta-sdk`.
 *
 * Orquestra os três serviços internos (credentials, proofs, passkey) e expõe
 * uma API de alto nível para emissão, validação e gerenciamento de
 * Credenciais Verificáveis Vesta com armazenamento protegido por Passkey.
 *
 * ## Uso básico
 * ```typescript
 * import { VestaSDK, VestaEnvironment } from '@hous3-digital/vesta-sdk';
 *
 * const sdk = new VestaSDK({
 *   apiKey: 'vesta_live_abc123',
 *   issuerId: 'bradesco',
 *   environment: VestaEnvironment.PRODUCTION,
 * });
 *
 * // 1. Emitir e registrar credencial no Passkey do dispositivo
 * const issued = await sdk.issueCredential({
 *   cpf: '12345678900',
 *   fullName: 'João da Silva',
 *   birthDate: '1990-03-15',
 *   kycLevel: 'complete',
 *   kycMethod: 'biometric_plus_document',
 * });
 *
 * // 2. Validar credencial on-chain via prova ZK (o SDK recupera a VC via Passkey)
 * const result = await sdk.validateCredential({
 *   privateInputs: { cpf: '12345678900', birthDate: '19900315', fullName: 'JOAO SILVA' },
 *   verifierId: 'verifier_bradesco',
 *   minKycLevel: 2,
 * });
 * console.log(result.verified); // true
 * ```
 */
export class VestaSDK {
  private readonly credentials: CredentialsService;
  private readonly proofs: ProofsService;
  private readonly passkey: PasskeyService;
  private _busy = false;

  /**
   * Instancia o SDK com as configurações do integrador.
   *
   * @param config - API key, environment, issuer ID e rpId opcionais.
   *
   * @example
   * const sdk = new VestaSDK({
   *   apiKey: 'vesta_live_abc123',
   *   environment: VestaEnvironment.PRODUCTION,
   * });
   */
  constructor(config: VestaSDKConfig) {
    const http = createHttpClient(config);
    const baseUrl = resolveBaseUrl(config);
    this.credentials = new CredentialsService(http, config.issuerId);
    this.proofs = new ProofsService(http);
    this.passkey = new PasskeyService(config.rpId, baseUrl);
  }

  // ─── Mutex — proteção contra chamadas simultâneas ─────────────────────────

  /**
   * Executa uma operação garantindo que apenas uma operação multi-step
   * rode por vez. Previne duplicação por double-click.
   */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    if (this._busy) {
      throw new Error(
        'VestaSDK: Operação em andamento. Aguarde a conclusão antes de chamar novamente.',
      );
    }
    this._busy = true;
    try {
      return await fn();
    } finally {
      this._busy = false;
    }
  }

  // ─── 1. Emissão ───────────────────────────────────────────────────────────

  /**
   * Emite uma nova Credencial Verificável e a armazena no Passkey do dispositivo.
   *
   * Este método combina dois passos automaticamente:
   * 1. Chama `POST /credentials` para emitir a VC no backend.
   * 2. Registra um Passkey no dispositivo do usuário associado à VC emitida.
   *
   * O browser exibirá o prompt nativo de criação de Passkey após a emissão.
   *
   * @param req - Dados de identidade e KYC do titular.
   * @returns Resposta da API com a VC emitida, mais o `passkeyCredentialId` criado.
   * @throws {VestaSDKError} 400 se os dados forem inválidos.
   * @throws {VestaSDKError} 401 se a API key for inválida.
   * @throws {VestaSDKError} 409 se o CPF já possuir credencial ativa.
   * @throws {Error} Se o usuário cancelar o prompt de criação do Passkey.
   * @throws {Error} Se outra operação já estiver em andamento (double-click).
   */
  async issueCredential(
    req: IssueCredentialRequest,
  ): Promise<IssueCredentialResponse & PasskeyRegistrationResult> {
    return this.guard(() => this._issueCredential(req));
  }

  private async _issueCredential(
    req: IssueCredentialRequest,
  ): Promise<IssueCredentialResponse & PasskeyRegistrationResult> {
    const issueResponse = await this.credentials.issue(req);

    let passkeyResult: PasskeyRegistrationResult;
    try {
      passkeyResult = await this.passkey.register(issueResponse.vc, issueResponse.vcHash);
    } catch (err) {
      throw new Error(
        `Credencial emitida (vcHash: ${issueResponse.vcHash.slice(0, 16)}...) ` +
        `mas o registro do Passkey falhou: ${(err as Error).message}`,
        { cause: err },
      );
    }

    return { ...issueResponse, ...passkeyResult };
  }

  // ─── 2. Validação on-chain ────────────────────────────────────────────────

  /**
   * Valida uma credencial on-chain na rede Stellar via prova ZK Groth16.
   *
   * O SDK autentica o usuário via Passkey para recuperar a VC internamente —
   * o cliente **não precisa conhecer ou fornecer o vcHash**.
   *
   * @param req - Inputs privados do circuito ZK, verifierId e minKycLevel.
   * @returns Resultado da verificação com detalhes da prova ZK e transação Stellar.
   * @throws {Error} Se o usuário cancelar o prompt de autenticação Passkey.
   * @throws {VestaSDKError} 400 se o nível de KYC for insuficiente.
   * @throws {VestaSDKError} 422 se a VC estiver expirada.
   * @throws {Error} Se outra operação já estiver em andamento (double-click).
   */
  async validateCredential(req: ValidateCredentialRequest): Promise<GenerateAndSubmitResponse> {
    return this.guard(() => this._validateCredential(req));
  }

  private async _validateCredential(req: ValidateCredentialRequest): Promise<GenerateAndSubmitResponse> {
    const stored = await this.passkey.authenticate();

    if (!stored.challengeUsed) {
      throw new Error(
        'VestaSDK: Challenge não foi obtido durante a autenticação Passkey. ' +
        'Isso indica uma falha no endpoint GET /public/auth/challenge.',
      );
    }

    return this.proofs.generateAndSubmit(
      stored.vc,
      req.privateInputs,
      req.verifierId,
      req.minKycLevel,
      stored.challengeUsed,
    );
  }

  // ─── 3. Consulta de status ────────────────────────────────────────────────

  /**
   * Consulta o status de uma credencial pelo seu hash SHA-256.
   *
   * Não requer autenticação — pode ser chamado por verificadores para checar
   * validade antes de iniciar o fluxo ZK.
   *
   * @param req - Objeto com o `vcHash` a ser verificado.
   * @returns Status de validade, nível de KYC e nonce de desafio (se válida).
   * @throws {VestaSDKError} 404 se a credencial não existir.
   */
  async checkCredentialStatus(req: VerifyCredentialRequest): Promise<VerifyCredentialResponse> {
    return this.credentials.verify(req);
  }

  // ─── 4. Revogação ────────────────────────────────────────────────────────

  /**
   * Revoga uma credencial existente, tornando-a permanentemente inválida.
   *
   * Após a revogação, todas as verificações ZK dessa VC falharão.
   *
   * @param req - Hash da VC a revogar e motivo opcional.
   * @returns Confirmação da revogação.
   * @throws {VestaSDKError} 404 se a credencial não existir.
   * @throws {VestaSDKError} 400 se a credencial já estiver revogada.
   */
  async revokeCredential(req: RevokeCredentialRequest): Promise<RevokeCredentialResponse> {
    return this.credentials.revoke(req);
  }

  // ─── 5. Recuperação local via Passkey ────────────────────────────────────

  /**
   * Autentica o usuário via Passkey e retorna a VC armazenada no dispositivo.
   *
   * @returns StoredCredential com a VC completa e metadados de armazenamento.
   * @throws {Error} Se o usuário cancelar a autenticação.
   * @throws {Error} Se não houver credencial armazenada para o Passkey autenticado.
   */
  async getStoredCredential(): Promise<StoredCredential> {
    return this.passkey.authenticate();
  }

  // ─── 6. Submissão de prova externa ───────────────────────────────────────

  /**
   * Submete uma prova Groth16 já gerada externamente ao contrato Soroban.
   *
   * @param req - Prova pré-computada, sinais públicos, verifierId e vcHash.
   * @returns Resultado da verificação on-chain.
   * @throws {VestaSDKError} 404 se a credencial referenciada não existir.
   * @throws {VestaSDKError} 422 se a credencial estiver expirada.
   */
  async submitProof(req: SubmitProofRequest): Promise<GenerateAndSubmitResponse> {
    return this.proofs.submit(req);
  }

  // ─── 7. Utilitários ──────────────────────────────────────────────────────

  /**
   * Verifica se o dispositivo e browser suportam WebAuthn/Passkeys.
   */
  isPasskeySupported(): boolean {
    return this.passkey.isSupported();
  }

  /**
   * Remove uma credencial do armazenamento local do dispositivo.
   *
   * @param vcHash - Hash SHA-256 da VC a remover do armazenamento local.
   */
  async deleteStoredCredential(vcHash: string): Promise<void> {
    return this.passkey.deleteStored(vcHash);
  }

  /**
   * Lista os vcHashes de todas as credenciais armazenadas no dispositivo.
   */
  async listStoredCredentials(): Promise<string[]> {
    return this.passkey.getStoredHashes();
  }

  // ─── 8. Smart Enroll ─────────────────────────────────────────────────────

  /**
   * Verifica se há alguma Credencial Verificável armazenada no dispositivo.
   *
   * Use este método para decidir na UI se o fluxo de KYC deve ser exibido
   * antes de chamar `smartEnroll()`.
   */
  async hasStoredCredential(): Promise<boolean> {
    const hashes = await this.passkey.getStoredHashes();
    return hashes.length > 0;
  }

  /**
   * Fluxo inteligente de cadastro/autenticação — o coração do SDK.
   *
   * O SDK decide automaticamente qual fluxo executar com base na presença
   * de uma VC no dispositivo:
   *
   * **Usuário novo (sem VC):** Emite VC + registra Passkey.
   * **Usuário recorrente (VC existente):** Autentica via Passkey + valida on-chain.
   *
   * @param params - Dados para criação de nova VC e/ou validação da existente.
   * @returns Resultado com status de autenticação, se é novo usuário e txHash opcional.
   * @throws {VestaSDKError} Se a API retornar erro.
   * @throws {Error} Se o usuário cancelar o prompt de Passkey.
   * @throws {Error} Se outra operação já estiver em andamento (double-click).
   */
  async smartEnroll(params: SmartEnrollParams): Promise<SmartEnrollResult> {
    return this.guard(() => this._smartEnroll(params));
  }

  private async _smartEnroll(params: SmartEnrollParams): Promise<SmartEnrollResult> {
    const hasVC = await this.hasStoredCredential();

    if (!hasVC) {
      // ── Fluxo novo usuário: emite VC + registra Passkey ──────────────────
      const issued = await this._issueCredential(params.userData);
      return {
        authenticated: true,
        isNewUser: true,
        vcHash: issued.vcHash,
        mock: false,
      };
    }

    // ── Fluxo usuário recorrente: valida VC existente on-chain ────────────
    const validation = await this._validateCredential({
      privateInputs: params.privateInputs,
      verifierId: params.verifierId,
      minKycLevel: params.minKycLevel,
    } as ValidateCredentialRequest);

    return {
      authenticated: validation.verified,
      isNewUser: false,
      vcHash: validation.attestation.vcHash,
      txHash: validation.stellar.txHash,
      mock: validation.stellar.mock,
    };
  }
}
