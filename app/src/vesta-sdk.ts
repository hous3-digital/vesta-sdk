import { createHttpClient } from './http/client';
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
 * import { VestaSDK } from '@hous3-digital/vesta-sdk';
 *
 * const sdk = new VestaSDK({
 *   apiUrl: 'https://api.vesta.id',
 *   apiKey: 'vesta_live_abc123',
 *   issuerId: 'bradesco',
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

  /**
   * Instancia o SDK com as configurações do integrador.
   *
   * @param config - URL da API, API key, issuer ID e rpId opcionais.
   *
   * @example
   * const sdk = new VestaSDK({
   *   apiUrl: 'https://api.vesta.id',
   *   apiKey: 'vesta_live_abc123',
   * });
   */
  constructor(config: VestaSDKConfig) {
    const http = createHttpClient(config);
    this.credentials = new CredentialsService(http);
    this.proofs = new ProofsService(http);
    this.passkey = new PasskeyService(config.rpId);
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
   * @throws {Error} Se o usuário cancelar o prompt de criação do Passkey.
   *   Neste caso, a VC foi emitida mas não foi armazenada no dispositivo.
   *
   * @example
   * const issued = await sdk.issueCredential({
   *   cpf: '12345678900',
   *   fullName: 'João da Silva',
   *   birthDate: '1990-03-15',
   *   kycLevel: 'complete',
   *   kycMethod: 'biometric_plus_document',
   * });
   * console.log('VC emitida:', issued.vcHash);
   * console.log('Passkey criado:', issued.passkeyCredentialId);
   */
  async issueCredential(
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
   * O processo completo:
   * 1. Solicita autenticação via Passkey (prompt nativo do browser).
   * 2. Recupera a VC armazenada no IndexedDB usando o vcHash da assertion.
   * 3. Envia a VC, os inputs privados e os parâmetros de verificação ao backend.
   * 4. O backend gera a prova ZK Groth16 e submete ao contrato Soroban.
   * 5. Retorna o resultado da verificação on-chain.
   *
   * @param req - Inputs privados do circuito ZK, verifierId e minKycLevel.
   *   **Não inclui vcHash ou vc** — recuperados automaticamente via Passkey.
   * @returns Resultado da verificação com detalhes da prova ZK e transação Stellar.
   * @throws {Error} Se o usuário cancelar o prompt de autenticação Passkey.
   * @throws {Error} Se não houver credencial armazenada para o Passkey autenticado.
   * @throws {VestaSDKError} 400 se o nível de KYC for insuficiente.
   * @throws {VestaSDKError} 401 se a API key for inválida.
   * @throws {VestaSDKError} 422 se a VC estiver expirada.
   *
   * @example
   * const result = await sdk.validateCredential({
   *   privateInputs: {
   *     cpf: '12345678900',
   *     birthDate: '19900315',   // YYYYMMDD
   *     fullName: 'JOAO SILVA',  // maiúsculas
   *   },
   *   verifierId: 'verifier_bradesco',
   *   minKycLevel: 2,
   * });
   * if (result.verified) {
   *   console.log('KYC verificado on-chain!', result.stellar.txHash);
   * }
   */
  async validateCredential(req: ValidateCredentialRequest): Promise<GenerateAndSubmitResponse> {
    // Autentica via Passkey e recupera a VC internamente
    const stored = await this.passkey.authenticate();

    return this.proofs.generateAndSubmit(
      stored.vc,
      stored.vcHash,
      req.privateInputs,
      req.verifierId,
      req.minKycLevel,
      req.subjectDid,
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
   *
   * @example
   * const status = await sdk.checkCredentialStatus({ vcHash: 'a1b2c3...' });
   * if (!status.valid) {
   *   console.warn('Motivo:', status.reason); // "revoked" | "expired"
   * }
   */
  async checkCredentialStatus(req: VerifyCredentialRequest): Promise<VerifyCredentialResponse> {
    return this.credentials.verify(req);
  }

  // ─── 4. Revogação ────────────────────────────────────────────────────────

  /**
   * Revoga uma credencial existente, tornando-a permanentemente inválida.
   *
   * Após a revogação, todas as verificações ZK dessa VC falharão.
   * A operação é irreversível no backend — a credencial local no IndexedDB
   * permanece e deve ser removida manualmente via `deleteStoredCredential`.
   *
   * @param req - Hash da VC a revogar e motivo opcional.
   * @returns Confirmação da revogação.
   * @throws {VestaSDKError} 401 se a API key for inválida.
   * @throws {VestaSDKError} 404 se a credencial não existir.
   * @throws {VestaSDKError} 400 se a credencial já estiver revogada.
   *
   * @example
   * await sdk.revokeCredential({
   *   vcHash: 'a1b2c3...',
   *   reason: 'fraudulent_documents',
   * });
   */
  async revokeCredential(req: RevokeCredentialRequest): Promise<RevokeCredentialResponse> {
    return this.credentials.revoke(req);
  }

  // ─── 5. Recuperação local via Passkey ────────────────────────────────────

  /**
   * Autentica o usuário via Passkey e retorna a VC armazenada no dispositivo.
   *
   * O browser exibirá o prompt nativo de autenticação.
   * O usuário seleciona o Passkey desejado, e o SDK recupera
   * automaticamente a VC associada do IndexedDB.
   *
   * @returns StoredCredential com a VC completa e metadados de armazenamento.
   * @throws {Error} Se o usuário cancelar a autenticação.
   * @throws {Error} Se não houver credencial armazenada para o Passkey autenticado.
   * @throws {Error} Se WebAuthn não for suportado no ambiente.
   *
   * @example
   * const stored = await sdk.getStoredCredential();
   * console.log('VC:', stored.vc.id);
   * console.log('Armazenada em:', stored.storedAt);
   */
  async getStoredCredential(): Promise<StoredCredential> {
    return this.passkey.authenticate();
  }

  // ─── 6. Submissão de prova externa ───────────────────────────────────────

  /**
   * Submete uma prova Groth16 já gerada externamente ao contrato Soroban.
   *
   * Use este método quando a geração da prova ZK ocorre fora do SDK —
   * por exemplo, em um ambiente seguro do lado do servidor ou em um
   * circuito customizado.
   *
   * @param req - Prova pré-computada, sinais públicos, verifierId e vcHash.
   * @returns Resultado da verificação on-chain.
   * @throws {VestaSDKError} 401 se a API key for inválida.
   * @throws {VestaSDKError} 404 se a credencial referenciada não existir.
   * @throws {VestaSDKError} 422 se a credencial estiver expirada.
   *
   * @example
   * const result = await sdk.submitProof({
   *   proof: myGroth16Proof,
   *   publicSignals: ['2', '1'],
   *   verifierId: 'verifier_bradesco',
   *   vcHash: 'a1b2c3...',
   *   minKycLevel: 2,
   * });
   */
  async submitProof(req: SubmitProofRequest): Promise<GenerateAndSubmitResponse> {
    return this.proofs.submit(req);
  }

  // ─── 7. Utilitários ──────────────────────────────────────────────────────

  /**
   * Verifica se o dispositivo e browser suportam WebAuthn/Passkeys.
   *
   * @returns `true` se Passkeys estiverem disponíveis.
   *
   * @example
   * if (!sdk.isPasskeySupported()) {
   *   // Mostrar mensagem de fallback ou alternativa
   * }
   */
  isPasskeySupported(): boolean {
    return this.passkey.isSupported();
  }

  /**
   * Remove uma credencial do armazenamento local do dispositivo.
   *
   * Atenção: remove apenas o IndexedDB — o WebAuthn credential no autenticador
   * não é removido automaticamente.
   *
   * @param vcHash - Hash SHA-256 da VC a remover do armazenamento local.
   *
   * @example
   * await sdk.deleteStoredCredential('a1b2c3...');
   */
  async deleteStoredCredential(vcHash: string): Promise<void> {
    return this.passkey.deleteStored(vcHash);
  }

  /**
   * Lista os vcHashes de todas as credenciais armazenadas no dispositivo.
   *
   * @returns Array de vcHashes presentes no IndexedDB local.
   *
   * @example
   * const hashes = await sdk.listStoredCredentials();
   * console.log(`${hashes.length} credencial(is) no dispositivo.`);
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
   *
   * @returns `true` se pelo menos uma VC estiver armazenada no IndexedDB.
   *
   * @example
   * const needsKyc = !(await sdk.hasStoredCredential());
   * if (needsKyc) showKycModal();
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
   * **Usuário novo (sem VC no dispositivo):**
   * 1. Emite uma nova VC via `POST /credentials` usando `params.userData`.
   * 2. Registra um Passkey no dispositivo vinculado à nova VC.
   * 3. Retorna `{ isNewUser: true, authenticated: true }`.
   *
   * **Usuário recorrente (VC existente no dispositivo):**
   * 1. Solicita autenticação via Passkey (biometria/PIN do dispositivo).
   * 2. Recupera a VC armazenada automaticamente via `userHandle`.
   * 3. Gera prova ZK Groth16 e verifica on-chain na Stellar via `POST /proofs/generate-and-submit`.
   * 4. Retorna `{ isNewUser: false, authenticated: result.verified, txHash }`.
   *
   * **Importante:** Para o melhor UX, chame `hasStoredCredential()` antes
   * para saber se o modal de KYC deve ser exibido, depois chame `smartEnroll()`.
   *
   * @param params - Dados para criação de nova VC e/ou validação da existente.
   * @returns Resultado com status de autenticação, se é novo usuário e txHash opcional.
   * @throws {VestaSDKError} Se a API retornar erro.
   * @throws {Error} Se o usuário cancelar o prompt de Passkey.
   *
   * @example
   * // 1. Checar antes para mostrar modal de KYC na UI
   * const needsKyc = !(await sdk.hasStoredCredential());
   * if (needsKyc) showKycModal();
   *
   * // 2. Executar fluxo (criação ou validação, decidido internamente)
   * const result = await sdk.smartEnroll({
   *   userData: {
   *     cpf: '12345678900', fullName: 'João da Silva',
   *     birthDate: '1990-03-15', kycLevel: 'complete',
   *     kycMethod: 'biometric_plus_document',
   *   },
   *   privateInputs: { cpf: '12345678900', birthDate: '19900315', fullName: 'JOAO SILVA' },
   *   verifierId: 'verifier_banco_vesta',
   *   minKycLevel: 2,
   * });
   *
   * hideKycModal();
   * if (result.authenticated) showSuccessScreen(result);
   */
  async smartEnroll(params: SmartEnrollParams): Promise<SmartEnrollResult> {
    const hasVC = await this.hasStoredCredential();

    if (!hasVC) {
      // ── Fluxo novo usuário: emite VC + registra Passkey ──────────────────
      const issued = await this.issueCredential(params.userData);
      return {
        authenticated: true,
        isNewUser: true,
        vcHash: issued.vcHash,
        mock: false,
      };
    }

    // ── Fluxo usuário recorrente: valida VC existente on-chain ────────────
    const validation = await this.validateCredential({
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
