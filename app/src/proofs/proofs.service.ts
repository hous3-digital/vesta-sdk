import type { HttpClient } from '../http/client';
import type { GenerateAndSubmitResponse, SubmitProofRequest, VestaVC } from '../types';

/**
 * Payload interno enviado ao endpoint /proofs/generate-and-submit.
 * Não exportado — consumidores usam `ValidateCredentialRequest` via `VestaSDK`.
 */
interface GenerateAndSubmitPayload {
  vc: VestaVC;
  privateInputs: {
    cpf: string;
    birthDate: string;
    fullName: string;
  };
  verifierId: string;
  minKycLevel: number;
  /**
   * Challenge emitido pelo servidor via GET /auth/challenge e usado na
   * assertion WebAuthn. Enviado à API para verificação anti-replay.
   * A API valida e consome o challenge (one-time use) — campo obrigatório.
   */
  challenge: string;
}

/**
 * Serviço responsável pela submissão de provas ZK à vesta-api.
 *
 * Encapsula os endpoints `/proofs/generate-and-submit` e `/proofs/submit`,
 * que executam o pipeline completo de verificação Groth16/BN254 on-chain
 * na rede Stellar Soroban.
 *
 * @internal Não instanciar diretamente — use o `VestaSDK` como ponto de entrada.
 */
export class ProofsService {
  /**
   * @param http - Cliente HTTP pré-configurado com API key e URL base.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Solicita ao backend a geração de uma prova ZK Groth16 e sua submissão
   * imediata ao contrato Soroban na rede Stellar.
   *
   * O backend executa o pipeline completo:
   * 1. Calcula os inputs do circuito a partir dos dados privados e da VC.
   * 2. Gera a prova via snarkjs com os artefatos compilados do circuito.
   * 3. Submete a prova ao contrato Soroban e aguarda confirmação on-chain.
   * 4. Persiste a attestation no banco de dados.
   *
   * @param vc - Credencial Verificável recuperada do armazenamento local.
   * @param privateInputs - Dados privados do titular (witnesses do circuito ZK).
   * @param verifierId - Identificador do verificador — ex: "verifier_bradesco".
   * @param minKycLevel - Nível mínimo de KYC exigido: 1=basic, 2=intermediate, 3=complete.
   * @param challenge - Challenge de uso único obtido via GET /public/auth/challenge (anti-replay).
   * @returns Resultado da verificação com detalhes da prova ZK, transação Stellar e attestation.
   * @throws {VestaSDKError} 400 se os dados forem inválidos ou o nível de KYC for insuficiente.
   * @throws {VestaSDKError} 401 se a API key for inválida.
   * @throws {VestaSDKError} 422 se a VC estiver expirada.
   *
   * @example
   * const result = await service.generateAndSubmit(storedVC.vc, storedVC.vcHash, {
   *   cpf: '12345678900',
   *   birthDate: '19900315',
   *   fullName: 'JOAO SILVA',
   * }, 'verifier_bradesco', 2);
   * console.log(result.verified); // true
   * console.log(result.stellar.txHash); // "55e787..."
   */
  async generateAndSubmit(
    vc: VestaVC,
    privateInputs: { cpf: string; birthDate: string; fullName: string },
    verifierId: string,
    minKycLevel: number,
    challenge: string,
  ): Promise<GenerateAndSubmitResponse> {
    const payload: GenerateAndSubmitPayload = {
      vc,
      privateInputs,
      verifierId,
      minKycLevel,
      challenge,
    };

    return this.http.post<GenerateAndSubmitPayload, GenerateAndSubmitResponse>(
      '/public/proof/generate-and-submit',
      payload,
    );
  }

  /**
   * Submete uma prova Groth16 já gerada externamente ao contrato Soroban.
   *
   * Use este método quando a geração da prova ZK ocorre fora do SDK —
   * por exemplo, em um ambiente seguro do lado do servidor.
   *
   * @param req - Prova pré-computada, sinais públicos, verifier e vcHash.
   * @returns Resultado da verificação on-chain com transação Stellar e attestation.
   * @throws {VestaSDKError} 401 se a API key for inválida.
   * @throws {VestaSDKError} 404 se a credencial referenciada não existir.
   * @throws {VestaSDKError} 422 se a credencial não estiver aprovada ou estiver expirada.
   *
   * @example
   * const result = await service.submit({
   *   proof: externalProof,
   *   publicSignals: ['2', '1'],
   *   verifierId: 'verifier_bradesco',
   *   vcHash: 'a1b2c3...',
   *   minKycLevel: 2,
   * });
   */
  async submit(req: SubmitProofRequest): Promise<GenerateAndSubmitResponse> {
    return this.http.post<SubmitProofRequest, GenerateAndSubmitResponse>(
      '/public/proof/submit',
      req,
    );
  }
}
